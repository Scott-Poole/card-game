#!/usr/bin/env bash
# The deterministic half of the tick skill: every GitHub query and label write.
#
#   queue.sh next               sweep stale claims, apply caps, print one action line
#   queue.sh claim <n>          ready-for-agent -> in-progress, with a claim comment
#   queue.sh release <n> <why>  in-progress -> ready-for-agent (launch failed)
#   queue.sh escalate <n> <c>   in-progress -> ready-for-human, posting comment <c>
#   queue.sh note <n> <text>    comment on the issue
#
# `next` prints exactly one line on stdout: `LAUNCH <n> <title>` or `NOOP <reason>`.
# Everything else goes to stderr. Any failure exits non-zero before reporting success.
# Config is read from TICK_REF (default origin/main), so a tick run from any checkout
# obeys what has landed. Tests: test-queue.sh.
set -euo pipefail

REPO=Scott-Poole/card-game
API=repos/$REPO
CLAIMED=in-progress
QUEUE=ready-for-agent
HUMAN=ready-for-human

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
	local now n claimed_at labels wip=0
	now=$(date -u +%s)
	for n in $(gh api "$API/issues?state=open&labels=$CLAIMED&per_page=100" \
		--jq '.[] | select(.pull_request == null) | .number'); do
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

	if ((wip >= max_wip)); then
		echo "NOOP $wip ticket(s) in progress (cap $max_wip)"
		return
	fi

	# Tickets automation handed to Scott: ready-for-human with a claim in their history.
	# Tickets planned for humans never carried a claim, so they don't count.
	local escalated=0
	for n in $(gh api "$API/issues?state=open&labels=$HUMAN&per_page=100" \
		--jq '.[] | select(.pull_request == null) | .number'); do
		if [[ $(ever_claimed "$n") == true ]]; then
			escalated=$((escalated + 1))
		fi
	done
	if ((escalated >= max_escalated)); then
		echo "NOOP $escalated ticket(s) waiting on Scott (cap $max_escalated)"
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
		echo "NOOP frontier empty"
		return
	fi
	echo "LAUNCH $pick"
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
*)
	log "usage: queue.sh next | claim <n> | release <n> <why> | escalate <n> <comment> | note <n> <text>"
	exit 2
	;;
esac
