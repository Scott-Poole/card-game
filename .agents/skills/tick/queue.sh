#!/usr/bin/env bash
# The deterministic half of the tick skill: every GitHub query and label write.
#
#   queue.sh next [n...]        apply caps, print one action line; n... are the tickets this
#                               run already claimed
#   queue.sh parent-done <child> close its completed parent, listing children once
#   queue.sh claim <n>          ready-for-agent -> in-progress, with a claim comment
#   queue.sh release <n> <why>  in-progress -> ready-for-agent;
#                               refuses a ticket that no longer holds in-progress
#   queue.sh alive <n> [nudged] record that the claim's thread lives; resets its stale clock
#   queue.sh resume-info <n>    print `THREAD <link|none> CLAIMS <k>` from the ticket's history
#   queue.sh escalate <n> <c>   in-progress -> needs-triage; <c> must start `## Needs you`
#   queue.sh note <n> <text>    comment on the issue
#   queue.sh plan-open <cat> [n...]  open a planning issue (n... as for next); prints its number
#   queue.sh plan-done <n> <s>  close a planning issue as completed, posting summary <s>
#   queue.sh plan-abort <n> <w> close a planning issue as not planned (launch failed, stuck)
#
# `next` prints exactly one line on stdout: `CHECK <n> <nudges> <title>` (a claim with no sign
# of life for staleHours: the tick asks T3 whether its thread lives, then runs `alive` or
# `release`), `LAUNCH <n> <title>`, `PLAN <category>`, or `NOOP <reason>`. An empty frontier
# is a call to plan, not a stop. `needs-triage` means not yet ready.
# Escalations carry a `## Needs you` comment; a stale claim alone is not an escalation.
# Everything else goes to stderr. Any failure exits non-zero before reporting success:
# every query is a standalone assignment, because set -e ignores a failing $(...) inside
# `for ... in` or a test, which would read a failed query as "nothing found".
# Config is read from TICK_REF (default origin/main), so a tick run from any checkout
# obeys what has landed. Tests: test-queue.sh.
#
# A tick calls `next` repeatedly within one run, seconds apart, and GitHub's listings can
# lag a label write. So the caller passes the tickets it claimed this run, and `next`
# counts them itself: each holds a WIP slot and a daily claim whether or not the listings
# show it yet, and none is offered again.
set -euo pipefail
shopt -s inherit_errexit # $(cmd_next) in plan-open must fail closed too

REPO=Scott-Poole/card-game
API=repos/$REPO
CLAIMED=in-progress
QUEUE=ready-for-agent
TRIAGE=needs-triage
PLANNING=planning
ALIVE_MARK='<!-- queue:alive -->'
NUDGE_MARK='<!-- queue:nudge -->'

log() { printf '%s\n' "$*" >&2; }

# Rollback for the label writes that must not be left half done. A command arms it with the
# label to add back and the labels to remove again; if the script then exits for any reason
# (a failed write, a failed verification, a failed lookup) the EXIT trap restores them, adding
# before removing so a ticket never ends with neither. Success, or a deliberate end state,
# disarms it.
ROLLBACK_N=
ROLLBACK_ADD=()
ROLLBACK_DEL=()
arm() { ROLLBACK_N=$1; ROLLBACK_ADD=("${@:2:1}"); ROLLBACK_DEL=("${@:3}"); }
disarm() { ROLLBACK_N=; }
rollback() {
	[[ -n $ROLLBACK_N ]] || return 0
	local l n=$ROLLBACK_N
	disarm
	for l in "${ROLLBACK_ADD[@]}"; do [[ -z $l ]] || transition "$n" "$l" "" || true; done
	for l in "${ROLLBACK_DEL[@]}"; do [[ -z $l ]] || transition "$n" "" "$l" || true; done
	log "labels of #$n restored after a failure"
}
trap rollback EXIT

config() {
	git show "${TICK_REF:-origin/main}:.agents/skills/tick/config.json"
}

comment() { gh api --method POST "$API/issues/$1/comments" -f "body=$2" --silent; }
labels_of() { gh api "$API/issues/$1" --jq '[.labels[].name] | join(" ")'; }
# Trusted comments only: the repo is public, so a stranger's comment can't hold a claim open.
TRUSTED='select(.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR")'

# heartbeat_at <n>: epoch of the newest trusted `alive` comment, 0 when none.
heartbeat_at() {
	local times
	times=$(gh api --paginate "$API/issues/$1/comments?per_page=100" --jq \
		".[] | $TRUSTED | select(.body | contains(\"$ALIVE_MARK\")) | .created_at | fromdateiso8601")
	printf '%s\n' "$times" | sort -n | tail -1 | awk '{print $1 + 0}'
}

# claim_started <n>: epoch the current claim began, 0 when unknown. Only `claim` posts a
# trusted `tick: claimed <date>` comment (not the retired sweep's `tick: claimed over 8h ago`),
# so that comment is the anchor: a rollback that puts the
# in-progress label back leaves a newer label event, which must not move the claim start past
# a handoff posted in between. Tickets without that comment fall back to the newest
# in-progress label event. Both lookups are paginated: a ticket resumed many times outgrows
# one page.
claim_started() {
	local comment_times event_times at
	comment_times=$(gh api --paginate "$API/issues/$1/comments?per_page=100" --jq \
		".[] | $TRUSTED | select(.body | test(\"^tick: claimed [0-9]\")) | .created_at | fromdateiso8601") || return 1
	at=$(printf '%s\n' "$comment_times" | sort -n | tail -1 | awk '{print $1 + 0}')
	if ((at > 0)); then
		echo "$at"
		return 0
	fi
	event_times=$(gh api --paginate "$API/issues/$1/events?per_page=100" --jq \
		".[] | select(.event == \"labeled\" and .label.name == \"$CLAIMED\") | .created_at | fromdateiso8601") || return 1
	printf '%s\n' "$event_times" | sort -n | tail -1 | awk '{print $1 + 0}'
}

# nudges <n> <since>: how many times the tick woke this claim's thread since epoch <since>
# (the claim's start), so a hand-back or a new claim begins with a fresh budget.
nudges() {
	local hits
	hits=$(gh api --paginate "$API/issues/$1/comments?per_page=100" --jq \
		".[] | $TRUSTED | select(.body | contains(\"$NUDGE_MARK\")) | select((.created_at | fromdateiso8601) >= $2) | 1")
	printf '%s\n' "$hits" | grep -c 1 || true
}

# transition <n> <add> <remove>: add first, then remove, then verify, so a failure
# never leaves a ticket with neither label. Either label may be empty. Removing an
# absent label (HTTP 404) is fine; any other error aborts.
transition() {
	local n=$1 add=$2 remove=$3 err labels
	if [[ -n $add ]]; then
		gh api --method POST "$API/issues/$n/labels" -f "labels[]=$add" --silent || return 1
	fi
	if [[ -n $remove ]] && ! err=$(gh api --method DELETE "$API/issues/$n/labels/$remove" --silent 2>&1); then
		if [[ $err != *"HTTP 404"* ]]; then
			log "removing $remove from #$n failed: $err"
			return 1
		fi
	fi
	labels=" $(labels_of "$n") " || return 1
	if [[ -n $add && $labels != *" $add "* ]] || [[ -n $remove && $labels == *" $remove "* ]]; then
		log "#$n labels after transition are [$labels]; wanted +$add -$remove"
		return 1
	fi
}

cmd_next() {
	local cfg enabled max_wip max_daily stale_hours n run run_json claimed
	run=("$@")
	for n in "${run[@]}"; do
		[[ $n =~ ^[0-9]+$ ]] || { log "next: claimed ticket [$n] is not an issue number"; return 1; }
	done
	run_json=$(printf '%s\n' "${run[@]}" | jq -sc .)
	cfg=$(config)
	enabled=$(jq -r '.enabled' <<<"$cfg")
	max_wip=$(jq -r '.maxInProgress' <<<"$cfg")
	max_daily=$(jq -r '.maxDailyClaims' <<<"$cfg")
	stale_hours=$(jq -r '.staleHours' <<<"$cfg")

	if [[ $enabled != true ]]; then
		echo "NOOP disabled in config"
		return
	fi

	# Every in-progress ticket holds a slot. A claim with no sign of life for stale_hours
	# (neither the claim label nor a heartbeat that recent) is surfaced as CHECK: queue.sh
	# can't see T3, so the tick reads the thread and runs `alive` or `release`. A claim is
	# never relabelled needs-triage on age: a live thread isn't waiting on Scott. The one
	# exception is any claim that already carries a trusted `## Needs you` comment, stale or
	# not: its thread decided to hand off and `escalate` failed between the comment and the
	# labels, so the labels are finished here, releasing its WIP slot without offering an unresolvable CHECK.
	local now n claimed_at beat last rc wip=0 check="" check_since=0 listed labels candidates
	now=$(date -u +%s)
	claimed=$(gh api "$API/issues?state=open&labels=$CLAIMED&per_page=100" \
		--jq '.[] | select(.pull_request == null) | .number')
	# Candidates: every listed claim, plus this run's own claims (the listing may lag them).
	candidates=$(printf '%s\n' $claimed "${run[@]}" | grep -v '^$' | sort -un || true)
	for n in $candidates; do
		listed=0
		grep -qx "$n" <<<"$claimed" && listed=1
		if ((listed)); then
			wip=$((wip + 1))
		else
			labels=" $(labels_of "$n") "
			# Handed to Scott meanwhile (an escalation this run finished): no slot, nothing to check.
			if [[ $labels == *" $TRIAGE "* && $labels != *" $CLAIMED "* ]]; then
				continue
			fi
			wip=$((wip + 1))
			# A claim the listing lags and a direct read doesn't show either holds a slot only.
			[[ $labels == *" $CLAIMED "* ]] || continue
		fi
		# Triage has several writers. Its holding label releases a claim even before
		# an escalation comment lands, or when triage was requested directly.
		labels=" $(labels_of "$n") "
		if [[ $labels == *" $TRIAGE "* ]]; then
			transition "$n" "" "$QUEUE"
			transition "$n" "" "$CLAIMED"
			wip=$((wip - 1))
			log "released #$n for triage"
			continue
		fi
		claimed_at=$(claim_started "$n") || return 1
		rc=0
		handoff_since_claim "$n" || rc=$?
		case $rc in
		0)
			# Its thread escalated. Normally finish the swap `escalate` started; if Scott has
			# already answered and swapped needs-triage for ready-for-agent, the thread is
			# dead and the dead claim just comes off, so the hand-back resumes the ticket.
			labels=" $(labels_of "$n") "
			if [[ $labels == *" $TRIAGE "* || $labels != *" $QUEUE "* ]]; then
				transition "$n" "$TRIAGE" "$QUEUE"
				transition "$n" "" "$CLAIMED"
				log "completed the pending escalation of #$n"
			else
				transition "$n" "" "$CLAIMED"
				log "dropped #$n's claim: its escalation was handed back"
			fi
			wip=$((wip - 1))
			continue
			;;
		1) ;;
		*) log "handoff lookup for #$n failed"; return 1 ;;
		esac
		printf '%s\n' "${run[@]}" | grep -qx "$n" && continue # claimed seconds ago: not stale
		beat=$(heartbeat_at "$n")
		last=$((claimed_at > beat ? claimed_at : beat))
		if ((now - last > stale_hours * 3600)) && { [[ -z $check ]] || ((n < check)); }; then
			check=$n check_since=$claimed_at
		fi
	done
	if [[ -n $check ]]; then
		local title count
		title=$(gh api "$API/issues/$check" --jq .title)
		count=$(nudges "$check" "$check_since")
		echo "CHECK $check $count $title"
		return
	fi

	# Frontier: queued leaf tickets with no open blocker, unassigned, oldest first.
	# Specs carry the queue label too; having sub-issues marks them as parents.
	local pick
	pick=$(gh api "$API/issues?state=open&labels=$QUEUE&sort=created&direction=asc&per_page=100" --jq "
		$run_json as \$run | [.[] | select(
			.pull_request == null
			and ((.number | IN(\$run[])) | not)
			and (.assignees | length) == 0
			and ((.sub_issues_summary.total // 0) == 0)
			and ((.issue_dependencies_summary.blocked_by // 0) == 0)
			and (any(.labels[]; .name == \"$CLAIMED\" or .name == \"$TRIAGE\") | not)
		)] | first // empty | \"\(.number) \(.title)\"")
	if [[ -z $pick ]]; then
		plan_next "$cfg" "$now" "$stale_hours"
		return
	fi

	if ((wip >= max_wip)); then
		echo "NOOP $wip ticket(s) in progress (cap $max_wip)"
		return
	fi

	# Today's claims, plus this run's claims the events listing doesn't show yet.
	local today events claims
	today=$(date -u +%Y-%m-%d)
	events=$(gh api --paginate "$API/issues/events?per_page=100" --jq \
		".[] | select(.event == \"labeled\" and .label.name == \"$CLAIMED\" and (.created_at | startswith(\"$today\"))) | {issue: .issue.number}")
	claims=$(jq -s --argjson run "$run_json" 'length + ($run - map(.issue) | length)' <<<"$events")
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
	shift
	act=$(cmd_next "$@")
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
	if [[ $labels == *" $CLAIMED "* || $labels == *" $TRIAGE "* || $labels != *" $QUEUE "* ]]; then
		log "refusing to claim #$n: labels are [$labels]"
		exit 1
	fi
	# The claim comment anchors the claim's start (see claim_started) and goes first: a failed
	# write then changes nothing, and the half-claimed state (labels not swapped yet) never
	# looks like a dead claim to a concurrent `next`. An escalation landing after the anchor
	# stays newer than it, so it is still seen as a handoff.
	comment "$n" "tick: claimed $(date -u +%Y-%m-%dT%H:%MZ); launching a work-ticket thread."
	arm "$n" "$QUEUE" "$CLAIMED"
	transition "$n" "$CLAIMED" "$QUEUE"
	# A thread may have escalated this ticket after `next` picked it: leave the handoff alone.
	labels=" $(labels_of "$n") "
	if [[ $labels == *" $TRIAGE "* ]]; then
		log "refusing to claim #$n: it was escalated meanwhile"
		transition "$n" "" "$QUEUE"
		transition "$n" "" "$CLAIMED"
		disarm
		exit 1
	fi
	disarm
	log "claimed #$n"
}

# Close completed specs after listing their children once.
cmd_parent_done() {
	local child=$1 parent children comments marker state
	parent=$(gh api "$API/issues/$child" --jq '.parent_issue_url // empty')
	[[ -n $parent ]] || return 0
	# Only accept a parent in this repository.
	[[ $parent == "https://api.github.com/$API/issues/"* ]] || { log "foreign parent: $parent"; return 1; }
	parent=${parent##*/}
	state=$(gh api "$API/issues/$parent" --jq .state)
	[[ $state == open ]] || return 0
	children=$(gh api --paginate "$API/issues/$parent/sub_issues?per_page=100" --jq '.[] | {number, state}')
	[[ -n $children ]] || return 0
	[[ $(jq -s 'map(select(.state != "closed")) | length' <<<"$children") == 0 ]] || return 0
	# A marker allows retries after a comment failure without repeating a posted comment.
	marker="<!-- queue:parent-done -->"
	comments=$(gh api --paginate "$API/issues/$parent/comments?per_page=100" --jq '.[] | select(.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR") | .body')
	if [[ $comments != *"$marker"* ]]; then
		comment "$parent" "$marker
All sub-issues are closed:
$(jq -rs 'map("- #\(.number)") | join("\n")' <<<"$children")"
	fi
	gh api --method PATCH "$API/issues/$parent" -f state=closed -f state_reason=completed --silent
}

# comment_since_claim <n> <jq test on .body> [since]: 0 when a trusted comment passing the test
# is newer than the claim's start (or than epoch <since>, when given); 1 when there is none; 2
# when a query failed. Callers test the code, so errexit is off in here: every failure is
# returned explicitly rather than left to `set -e`.
comment_since_claim() {
	local since hits
	since=${3:-$(claim_started "$1")} || return 2
	hits=$(gh api --paginate "$API/issues/$1/comments?per_page=100" --jq \
		".[] | $TRUSTED | select(.body | $2) | select((.created_at | fromdateiso8601) >= $since) | 1") || return 2
	[[ -n $hits ]]
}

# handoff_since_claim <n>: a thread escalated this ticket. `escalate` posts the `## Needs you`
# comment after its holding label and before it gives up the claim, so the comment marks a
# real handoff even while the labels are mid-swap.
handoff_since_claim() { comment_since_claim "$1" 'startswith("## Needs you")'; }

# no_handoff <n>: succeeds when no thread has escalated this claim, fails (returns 1) when one
# has; a failed query exits the script (fail closed).
no_handoff() {
	local rc=0
	handoff_since_claim "$1" || rc=$?
	case $rc in
	0) return 1 ;;
	1) return 0 ;;
	*) log "handoff lookup for #$1 failed"; exit 1 ;;
	esac
}

cmd_release() {
	local labels rc=0
	labels=" $(labels_of "$1") "
	# Only a live claim can be released, and only if no thread has escalated it: a handoff
	# must not be swept back into the queue, with or without its needs-triage label yet.
	if [[ $labels != *" $CLAIMED "* ]]; then
		log "refusing to release #$1: it no longer carries $CLAIMED"
		exit 1
	fi
	if ! no_handoff "$1"; then
		log "refusing to release #$1: a thread escalated it"
		exit 1
	fi
	if [[ $labels == *" $TRIAGE "* ]]; then
		log "refusing to release #$1: triage is pending"
		exit 1
	fi
	# From here every failure puts the claim (and any flag removed) back: nothing that might
	# be a handoff may end up launchable.
	arm "$1" "$CLAIMED" "$QUEUE"
	transition "$1" "$QUEUE" "$CLAIMED"
	# An escalation may have landed between the checks above and the writes: its comment
	# precedes its labels, so it is visible now. Put the handoff back and leave the queue.
	handoff_since_claim "$1" || rc=$?
	case $rc in
	1) ;;
	0)
		# Stay armed until the handoff label is back: if this write fails, the rollback
		# restores the claim instead of leaving a sole ready-for-agent.
		transition "$1" "$TRIAGE" "$QUEUE"
		disarm
		log "#$1 was escalated while being released; left with Scott"
		exit 1
		;;
	*)
		log "handoff lookup for #$1 failed; release undone"
		exit 1
		;;
	esac
	disarm
	comment "$1" "tick: released claim, back in the queue. Reason: $2"
	log "released #$1"
}

# alive <n> [nudged]: record a heartbeat; preserve any pending triage.
cmd_alive() {
	local n=$1 nudged=${2:-} labels body
	labels=" $(labels_of "$n") "
	if [[ $labels != *" $CLAIMED "* ]]; then
		log "refusing to refresh #$n: labels are [$labels]"
		exit 1
	fi
	body="$ALIVE_MARK"
	[[ $nudged == nudged ]] && body="$body$NUDGE_MARK"
	comment "$n" "$body
tick: thread checked $(date -u +%Y-%m-%dT%H:%MZ); the claim stays${nudged:+ (woke the thread)}."
	log "alive #$n"
}

# resume-info <n>: where a ticket's earlier work lives. The thread link is the newest
# `work-ticket thread:` note; CLAIMS counts how often the ticket was claimed.
cmd_resume_info() {
	local n=$1 link claims
	link=$(gh api --paginate "$API/issues/$n/comments?per_page=100" --jq \
		".[] | $TRUSTED | .body | capture(\"work-ticket thread: (?<l>t3-thread://[^ \\n]+)\") | .l" | tail -1)
	local hits
	hits=$(gh api --paginate "$API/issues/$n/events?per_page=100" --jq \
		".[] | select(.event == \"labeled\" and .label.name == \"$CLAIMED\") | 1")
	claims=$(printf '%s\n' "$hits" | grep -c 1 || true)
	echo "THREAD ${link:-none} CLAIMS $claims"
}

cmd_escalate() {
	if [[ $2 != "## Needs you"* ]]; then
		log "refusing to escalate #$1: the comment must start with '## Needs you' (decision, options, recommendation, how to hand back)"
		exit 1
	fi
	local n=$1 labels add_back="" drop=""
	labels=" $(labels_of "$n") "
	[[ $labels != *" $CLAIMED "* ]] || add_back=$CLAIMED
	[[ $labels == *" $TRIAGE "* ]] || drop=$TRIAGE
	# Order: the holding label (no tick launches a needs-triage ticket), then the comment,
	# then the claim comes off. Until the comment lands a failure undoes the label, so the
	# caller can simply retry; once it has landed the handoff is real, and a failed claim
	# removal leaves in-progress + needs-triage + comment, which `next` finishes.
	arm "$n" "$add_back" "$drop"
	transition "$n" "$TRIAGE" ""
	comment "$n" "$2"
	disarm
	transition "$n" "" "$QUEUE"
	transition "$n" "" "$CLAIMED"
	log "escalated #$n"
}

# T3 is a tool boundary, so launch is a three-command handshake. The caller must
# clear the reservation on a failed launch; a successful launch is recorded separately.
cmd_grill_start() {
 local n=$1 labels count author allowed
 labels=" $(labels_of "$n") "
 [[ $labels != *" grilling "* ]] || { log "already grilling #$n"; return 1; }
 [[ $labels == *" $TRIAGE "* ]] || { log "#$n is not awaiting triage"; return 1; }
 author=$(gh api "$API/issues/$n" --jq .user.login)
 allowed=$(config | jq -r --arg author "$author" '.trustedAuthors | index($author) != null')
 [[ $allowed == true ]] || { log "untrusted issue author"; return 1; }
 count=$(gh issue list --repo "$REPO" --label grilling --state open --limit 10 --json number --jq length)
 ((count < 10)) || { log "grilling cap reached (10)"; return 1; }
 gh label create grilling --repo "$REPO" --color BFD4F2 --description "Open per-ticket T3 grilling thread" --force
 transition "$n" grilling ""
}
cmd_grill_launched() {
 [[ $2 == t3-thread://* ]] || { log "invalid T3 thread link"; return 1; }
 local labels
 labels=" $(labels_of "$1") "
 [[ $labels == *" grilling "* ]] || { log "no grilling reservation"; return 1; }
 comment "$1" "triage thread: $2"
}

case ${1:-} in
grill-start) cmd_grill_start "${2:?issue number}" ;;
grill-launched) cmd_grill_launched "${2:?issue number}" "${3:?thread link}" ;;
grill-clear) transition "${2:?issue number}" "" grilling ;;
next) shift; cmd_next "$@" ;;
parent-done) cmd_parent_done "${2:?child issue number}" ;;
claim) cmd_claim "${2:?issue number}" ;;
release) cmd_release "${2:?issue number}" "${3:?reason}" ;;
alive) cmd_alive "${2:?issue number}" "${3:-}" ;;
resume-info) cmd_resume_info "${2:?issue number}" ;;
escalate) cmd_escalate "${2:?issue number}" "${3:?comment}" ;;
note) comment "${2:?issue number}" "${3:?text}" ;;
plan-open) shift; cmd_plan_open "${1:?category}" "${@:2}" ;;
plan-done) cmd_plan_close "${2:?issue number}" "${3:?summary}" completed ;;
plan-abort) cmd_plan_close "${2:?issue number}" "${3:?reason}" not_planned ;;
*)
	log "usage: queue.sh parent-done <child> | next [n...] | claim <n> | release <n> <why> | alive <n> [nudged] | resume-info <n> | escalate <n> <comment> | note <n> <text> | plan-open <category> [n...] | plan-done <n> <summary> | plan-abort <n> <why>"
	exit 2
	;;
esac
