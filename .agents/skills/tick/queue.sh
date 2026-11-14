#!/usr/bin/env bash
# The deterministic half of the tick skill: every GitHub query and label write.
#
#   queue.sh next               sweep stale claims, apply caps, print one action line
#   queue.sh claim <n>          ready-for-agent -> in-progress, with a claim comment
#   queue.sh release <n> <why>  in-progress -> ready-for-agent (launch failed)
#   queue.sh escalate <n> <c>   in-progress -> ready-for-human, posting comment <c>
#   queue.sh note <n> <text>    comment on the issue
#   queue.sh plan-open <cat>    open a planning issue for a planner run; prints its number
#   queue.sh plan-done <n> <s>  close a planning issue as completed, posting summary <s>
#   queue.sh plan-abort <n> <w> close a planning issue as not planned (launch failed, stuck)
#
# `next` prints exactly one line on stdout: `LAUNCH <n> <title>`, `PLAN <category>`, or
# `NOOP <reason>`. An empty frontier is a call to plan, not a stop.
# Everything else goes to stderr. Any failure exits non-zero before reporting success:
# every query is a standalone assignment, because set -e ignores a failing $(...) inside
# `for ... in` or a test, which would read a failed query as "nothing found".
# Config is read from TICK_REF (default origin/main), so a tick run from any checkout
# obeys what has landed. Tests: test-queue.sh.
set -euo pipefail
shopt -s inherit_errexit # $(cmd_next) in plan-open must fail closed too

REPO=Scott-Poole/card-game
API=repos/$REPO
CLAIMED=in-progress
QUEUE=ready-for-agent
HUMAN=ready-for-human
PLANNING=planning

log() { printf '%s\n' "$*" >&2; }

config() {
	git show "${TICK_REF:-origin/main}:.agents/skills/tick/config.json"
}

comment() { gh api --method POST "$API/issues/$1/comments" -f "body=$2" --silent; }
labels_of() { gh api "$API/issues/$1" --jq '[.labels[].name] | join(" ")'; }
ever_claimed() {
	gh api "$API/issues/$1/events?per_page=100" --jq \
		"[.[] | select(.event == \"labeled\" and .label.name == \"$CLAIMED\")] | length > 0"
}

# transition <n> <add> <remove>: add first, then remove, then verify, so a failure
# never leaves a ticket with neither label. Either label may be empty. Removing an
# absent label (HTTP 404) is fine; any other error aborts.
transition() {
	local n=$1 add=$2 remove=$3 err labels
	if [[ -n $add ]]; then
		gh api --method POST "$API/issues/$n/labels" -f "labels[]=$add" --silent
	fi
	if [[ -n $remove ]] && ! err=$(gh api --method DELETE "$API/issues/$n/labels/$remove" --silent 2>&1); then
		if [[ $err != *"HTTP 404"* ]]; then
			log "removing $remove from #$n failed: $err"
			return 1
		fi
	fi
	labels=" $(labels_of "$n") "
	if [[ -n $add && $labels != *" $add "* ]] || [[ -n $remove && $labels == *" $remove "* ]]; then
		log "#$n labels after transition are [$labels]; wanted +$add -$remove"
		return 1
	fi
}

cmd_next() {
	local cfg enabled max_wip max_daily max_escalated stale_hours
	cfg=$(config)
	enabled=$(jq -r '.enabled' <<<"$cfg")
	max_wip=$(jq -r '.maxInProgress' <<<"$cfg")
	max_daily=$(jq -r '.maxDailyClaims' <<<"$cfg")
	max_escalated=$(jq -r '.maxEscalated' <<<"$cfg")
	stale_hours=$(jq -r '.staleHours' <<<"$cfg")

	if [[ $enabled != true ]]; then
		echo "NOOP disabled in config"
		return
	fi

	# Every in-progress ticket holds a slot, stale or not: a stale thread may still be
	# alive, so its slot frees only when Scott clears the claim. Stale claims also get
	# ready-for-human, once, so he hears about them.
	local now n claimed_at labels claimed wip=0
	now=$(date -u +%s)
	claimed=$(gh api "$API/issues?state=open&labels=$CLAIMED&per_page=100" \
		--jq '.[] | select(.pull_request == null) | .number')
	for n in $claimed; do
		wip=$((wip + 1))
		labels=" $(labels_of "$n") "
		[[ $labels == *" $HUMAN "* ]] && continue
		claimed_at=$(gh api "$API/issues/$n/events?per_page=100" --jq \
			"[.[] | select(.event == \"labeled\" and .label.name == \"$CLAIMED\") | .created_at | fromdateiso8601] | max // 0")
		if ((now - claimed_at > stale_hours * 3600)); then
			transition "$n" "$HUMAN" ""
			comment "$n" "tick: claimed over ${stale_hours}h ago and not merged. Added \`$HUMAN\`; the claim keeps its slot until you remove \`$CLAIMED\` or close the ticket. Check the work-ticket thread linked above before you do."
			log "stale: #$n -> $HUMAN"
		fi
	done

	# Tickets automation handed to Scott: ready-for-human with a claim in their history.
	# Tickets planned for humans never carried a claim, so they don't count.
	local human was_claimed escalated=0
	human=$(gh api "$API/issues?state=open&labels=$HUMAN&per_page=100" \
		--jq '.[] | select(.pull_request == null) | .number')
	for n in $human; do
		was_claimed=$(ever_claimed "$n")
		if [[ $was_claimed == true ]]; then
			escalated=$((escalated + 1))
		fi
	done
	if ((escalated >= max_escalated)); then
		echo "NOOP $escalated ticket(s) waiting on Scott (cap $max_escalated)"
		return
	fi

	# Frontier: queued leaf tickets with no open blocker, unassigned, oldest first.
	# Specs carry the queue label too; having sub-issues marks them as parents.
	local pick
	pick=$(gh api "$API/issues?state=open&labels=$QUEUE&sort=created&direction=asc&per_page=100" --jq "
		[.[] | select(
			.pull_request == null
			and (.assignees | length) == 0
			and ((.sub_issues_summary.total // 0) == 0)
			and ((.issue_dependencies_summary.blocked_by // 0) == 0)
			and (any(.labels[]; .name == \"$CLAIMED\" or .name == \"$HUMAN\") | not)
		)] | first // empty | \"\(.number) \(.title)\"")
	if [[ -z $pick ]]; then
		plan_next "$cfg" "$now" "$stale_hours"
		return
	fi

	if ((wip >= max_wip)); then
		echo "NOOP $wip ticket(s) in progress (cap $max_wip)"
		return
	fi

	local today claims
	today=$(date -u +%Y-%m-%d)
	claims=$(gh api --paginate "$API/issues/events?per_page=100" --jq \
		".[] | select(.event == \"labeled\" and .label.name == \"$CLAIMED\" and (.created_at | startswith(\"$today\"))) | .id" | wc -l)
	if ((claims >= max_daily)); then
		echo "NOOP $claims claim(s) today (cap $max_daily, UTC day)"
		return
	fi

	echo "LAUNCH $pick"
}

# plan_next <cfg> <now> <stale hours>: the frontier is empty, so start a planner unless one
# is running or today's runs are spent. Planners ignore the WIP and claim caps: they only
# file tickets, so they refill the queue while an implementer works. A planning issue
# (label `planning`, title `Plan: <category>`) marks each run; it is open while the planner
# runs. Stale ones are closed so a dead planner can't block planning forever.
plan_next() {
	local cfg=$1 now=$2 stale_hours=$3 enabled max_daily runs n created today ran_today
	enabled=$(jq -r '.planning.enabled // false' <<<"$cfg")
	if [[ $enabled != true ]]; then
		echo "NOOP frontier empty; planning disabled in config"
		return
	fi
	max_daily=$(jq -r '.planning.maxDailyRuns' <<<"$cfg")
	runs=$(planning_runs)

	for n in $(jq -r '.[] | select(.state == "open") | .number' <<<"$runs"); do
		created=$(jq -r --argjson n "$n" '.[] | select(.number == $n) | .created_at | fromdateiso8601' <<<"$runs")
		if ((now - created > stale_hours * 3600)); then
			comment "$n" "tick: planner open over ${stale_hours}h; closing so planning can resume. Tickets it filed stay filed."
			gh api --method PATCH "$API/issues/$n" -f state=closed -f state_reason=not_planned --silent
			log "stale planner: #$n closed"
		else
			echo "NOOP frontier empty; planner #$n running"
			return
		fi
	done

	today=$(date -u +%Y-%m-%d)
	ran_today=$(jq --arg d "$today" '[.[] | select(.created_at | startswith($d))] | length' <<<"$runs")
	if ((ran_today >= max_daily)); then
		echo "NOOP frontier empty; $ran_today plan run(s) today (cap $max_daily, UTC day)"
		return
	fi

	# Least recently run category; never run beats any run, ties go to config order.
	local pick
	pick=$(jq -rn --argjson cfg "$cfg" --argjson runs "$runs" '
		$cfg.planning.categories | to_entries | map(
			.value as $c | {c: $c, i: .key, last: ([$runs[] | select(.title == "Plan: \($c)") | .created_at | fromdateiso8601] | max // 0)}
		) | sort_by(.last, .i) | first.c')
	echo "PLAN $pick"
}

# Planning issues, newest first: [{number, state, title, created_at}]. Only the newest 100
# count; a category last run before them reads as never run, which is the right answer.
planning_runs() {
	gh api "$API/issues?state=all&labels=$PLANNING&sort=created&direction=desc&per_page=100" \
		--jq '[.[] | select(.pull_request == null) | {number, state, title, created_at}]'
}

# plan-open re-runs the whole `next` decision instead of trusting an earlier one, so the
# switches, caps, and rotation hold even when two ticks interleave. GitHub has no lock, so
# a race can still create two issues; the lowest-numbered open one wins and the other
# closes itself before any planner launches.
cmd_plan_open() {
	local cat=$1 act n first
	act=$(cmd_next)
	if [[ $act != "PLAN $cat" ]]; then
		log "refusing to plan $cat: next says [$act]"
		exit 1
	fi
	n=$(gh api --method POST "$API/issues" -f "title=Plan: $cat" -f "labels[]=$PLANNING" \
		-f "body=tick: a \`$cat\` planner run, opened $(date -u +%Y-%m-%dT%H:%MZ). The planner files tickets per the \`plan\` skill, lists them here, and closes this issue. A closed planning issue means its planner stops filing." \
		--jq .number)
	first=$(planning_runs | jq -r '[.[] | select(.state == "open") | .number] | min // empty')
	if [[ -n $first && $first != "$n" ]]; then
		cmd_plan_close "$n" "tick: lost a race to planner #$first; closing before launch." not_planned
		log "refusing to plan $cat: planner #$first opened first"
		exit 1
	fi
	log "planning issue #$n opened for $cat"
	echo "$n"
}

cmd_plan_close() {
	local n=$1 summary=$2 reason=$3 labels
	labels=" $(labels_of "$n") "
	if [[ $labels != *" $PLANNING "* ]]; then
		log "refusing to close #$n: not a planning issue (labels [$labels])"
		exit 1
	fi
	comment "$n" "$summary"
	gh api --method PATCH "$API/issues/$n" -f state=closed -f "state_reason=$reason" --silent
	log "planning issue #$n closed ($reason)"
}

cmd_claim() {
	local n=$1 labels
	labels=" $(labels_of "$n") "
	if [[ $labels == *" $CLAIMED "* || $labels != *" $QUEUE "* ]]; then
		log "refusing to claim #$n: labels are [$labels]"
		exit 1
	fi
	transition "$n" "$CLAIMED" "$QUEUE"
	comment "$n" "tick: claimed $(date -u +%Y-%m-%dT%H:%MZ); launching a work-ticket thread."
	log "claimed #$n"
}

cmd_release() {
	transition "$1" "$QUEUE" "$CLAIMED"
	comment "$1" "tick: released claim, back in the queue. Reason: $2"
	log "released #$1"
}

cmd_escalate() {
	transition "$1" "$HUMAN" "$CLAIMED"
	comment "$1" "$2"
	log "escalated #$1"
}

case ${1:-} in
next) cmd_next ;;
claim) cmd_claim "${2:?issue number}" ;;
release) cmd_release "${2:?issue number}" "${3:?reason}" ;;
escalate) cmd_escalate "${2:?issue number}" "${3:?comment}" ;;
note) comment "${2:?issue number}" "${3:?text}" ;;
plan-open) cmd_plan_open "${2:?category}" ;;
plan-done) cmd_plan_close "${2:?issue number}" "${3:?summary}" completed ;;
plan-abort) cmd_plan_close "${2:?issue number}" "${3:?reason}" not_planned ;;
*)
	log "usage: queue.sh next | claim <n> | release <n> <why> | escalate <n> <comment> | note <n> <text> | plan-open <category> | plan-done <n> <summary> | plan-abort <n> <why>"
	exit 2
	;;
esac
