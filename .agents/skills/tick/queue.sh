#!/usr/bin/env bash
# The deterministic half of the tick skill: every GitHub query and label write.
#
#   queue.sh next              sweep stale claims, apply caps, print one action line
#   queue.sh claim <n>         ready-for-agent -> in-progress, with a claim comment
#   queue.sh release <n> <why> in-progress -> ready-for-agent (launch failed)
#   queue.sh escalate <n> <c>  in-progress -> ready-for-human, posting comment <c>
#   queue.sh note <n> <text>   comment on the issue
#
# `next` prints exactly one line on stdout: `LAUNCH <n> <title>` or `NOOP <reason>`.
# Everything else goes to stderr. Config is read from TICK_REF (default origin/main),
# so a tick run from any checkout obeys what has landed.
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

add_label() { gh api --method POST "$API/issues/$1/labels" -f "labels[]=$2" --silent; }
remove_label() { gh api --method DELETE "$API/issues/$1/labels/$2" --silent 2>/dev/null || true; }
comment() { gh api --method POST "$API/issues/$1/comments" -f "body=$2" --silent; }
labels_of() { gh api "$API/issues/$1" --jq '[.labels[].name] | join(" ")'; }

cmd_next() {
	local cfg enabled max_wip max_daily max_stalled stale_hours
	cfg=$(config)
	enabled=$(jq -r '.enabled' <<<"$cfg")
	max_wip=$(jq -r '.maxInProgress' <<<"$cfg")
	max_daily=$(jq -r '.maxDailyClaims' <<<"$cfg")
	max_stalled=$(jq -r '.maxStalledPRs' <<<"$cfg")
	stale_hours=$(jq -r '.staleHours' <<<"$cfg")

	if [[ $enabled != true ]]; then
		echo "NOOP disabled in config"
		return
	fi

	# Stale sweep: a claim older than staleHours goes to Scott instead of being retried.
	local now n claimed_at wip=0
	now=$(date -u +%s)
	for n in $(gh api "$API/issues?state=open&labels=$CLAIMED&per_page=100" \
		--jq '.[] | select(.pull_request == null) | .number'); do
		claimed_at=$(gh api "$API/issues/$n/events?per_page=100" --jq \
			"[.[] | select(.event == \"labeled\" and .label.name == \"$CLAIMED\") | .created_at | fromdateiso8601] | max // 0")
		if ((now - claimed_at > stale_hours * 3600)); then
			remove_label "$n" "$CLAIMED"
			add_label "$n" "$HUMAN"
			comment "$n" "tick: claimed over ${stale_hours}h ago and not merged. Moved to \`$HUMAN\` instead of retrying; check the work-ticket thread linked above."
			log "stale: #$n -> $HUMAN"
		else
			wip=$((wip + 1))
		fi
	done

	if ((wip >= max_wip)); then
		echo "NOOP $wip ticket(s) in progress (cap $max_wip)"
		return
	fi

	local stalled
	stalled=$(gh api "$API/pulls?state=open&per_page=100" --jq \
		"[.[] | select(any(.labels[]; .name == \"$HUMAN\" or .name == \"review-blocked\"))] | length")
	if ((stalled >= max_stalled)); then
		echo "NOOP $stalled PR(s) waiting on Scott (cap $max_stalled)"
		return
	fi

	local today claims
	today=$(date -u +%Y-%m-%d)
	claims=$(gh api "$API/issues/events?per_page=100" --jq \
		"[.[] | select(.event == \"labeled\" and .label.name == \"$CLAIMED\" and (.created_at | startswith(\"$today\")))] | length")
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
	add_label "$n" "$CLAIMED"
	remove_label "$n" "$QUEUE"
	comment "$n" "tick: claimed $(date -u +%Y-%m-%dT%H:%MZ); launching a work-ticket thread."
	log "claimed #$n"
}

cmd_release() {
	local n=$1 why=$2
	add_label "$n" "$QUEUE"
	remove_label "$n" "$CLAIMED"
	comment "$n" "tick: released claim, back in the queue. Reason: $why"
	log "released #$n"
}

cmd_escalate() {
	local n=$1 why=$2
	add_label "$n" "$HUMAN"
	remove_label "$n" "$CLAIMED"
	comment "$n" "$why"
	log "escalated #$n"
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
