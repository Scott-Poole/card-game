#!/usr/bin/env bash
# Regression tests for queue.sh against a stateful fake `gh` (fake-gh). Each case pins a
# behaviour, most of them a review finding from PR #7. Run: bash test-queue.sh
set -uo pipefail
# A git hook exports GIT_DIR and friends; drop them so every git call below resolves its own repo.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)

HERE=$(cd "$(dirname "$0")" && pwd)
QUEUE=$HERE/../queue.sh
REPO_ROOT=$(git -C "$HERE" rev-parse --show-toplevel)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
ln -s "$HERE/fake-gh" "$WORK/bin/gh"

pass=0 fail=0
TODAY=$(date -u +%Y-%m-%dT%H:%M:%SZ)
OLD=2020-01-01T00:00:00Z

# config_ref <jq filter>: a throwaway commit whose config.json is the committed one, filtered.
config_ref() {
	local idx blob tree
	idx=$(mktemp)
	GIT_INDEX_FILE=$idx git -C "$REPO_ROOT" read-tree HEAD
	blob=$(jq "$1" "$HERE/../config.json" | git -C "$REPO_ROOT" hash-object -w --stdin)
	GIT_INDEX_FILE=$idx git -C "$REPO_ROOT" update-index --cacheinfo "100644,$blob,.agents/skills/tick/config.json"
	tree=$(GIT_INDEX_FILE=$idx git -C "$REPO_ROOT" write-tree)
	rm -f "$idx"
	echo fixture | git -C "$REPO_ROOT" commit-tree "$tree"
}
DEFAULT_REF=$(config_ref '.')

# issue <n> <labels csv> [extra jq object]: one issue object.
issue() {
	jq -n --arg n "$1" --arg labels "$2" --argjson extra "${3:-{\}}" '{
		number: ($n | tonumber), title: "Ticket \($n)", state: "open", pull_request: null,
		assignees: [], sub_issues_summary: {total: 0},
		issue_dependencies_summary: {blocked_by: 0},
		labels: ($labels | split(",") | map(select(. != "")) | map({name: .}))
	} + $extra'
}
claimed_event() { jq -n --arg at "$1" '{event: "labeled", label: {name: "in-progress"}, created_at: $at, id: 1}'; }

# setup <issues json array> [events json object] [repo event pages json]
setup() {
	jq -n --argjson issues "$1" --argjson events "${2:-{\}}" --argjson pages "${3:-[[]]}" \
		'{issues: ($issues | map({key: (.number | tostring), value: .}) | from_entries),
		  events: $events, repo_event_pages: $pages, comments: []}' >"$WORK/state.json"
	: >"$WORK/calls.log"
}

run() { # run <args...>: runs queue.sh with the fake; sets OUT, ERR, CODE
	OUT=$(PATH="$WORK/bin:$PATH" FAKE_GH_STATE=$WORK/state.json FAKE_GH_LOG=$WORK/calls.log \
		TICK_REF=${REF:-$DEFAULT_REF} bash "$QUEUE" "$@" 2>"$WORK/err")
	CODE=$?
	ERR=$(cat "$WORK/err")
}
labels() { jq -r --arg n "$1" '.issues[$n].labels | map(.name) | sort | join(",")' "$WORK/state.json"; }
comments() { jq -r --arg n "$1" '[.comments[] | select(.issue == ($n | tonumber))] | length' "$WORK/state.json"; }

check() { # check <name> <condition...>
	local name=$1
	shift
	if "$@"; then
		pass=$((pass + 1))
	else
		fail=$((fail + 1))
		printf 'FAIL %s\n  out: %s\n  err: %s\n  code: %s\n' "$name" "$OUT" "$ERR" "$CODE"
	fi
}
is() { [[ $1 == "$2" ]]; }

# --- frontier ---------------------------------------------------------------------------
setup "[$(issue 3 ready-for-agent '{"sub_issues_summary":{"total":3}}'),
	$(issue 4 ready-for-agent '{"assignees":[{"login":"x"}]}'),
	$(issue 5 ready-for-agent '{"issue_dependencies_summary":{"blocked_by":1}}'),
	$(issue 6 ready-for-agent)]"
run next
check "frontier skips parents, assigned, blocked" is "$OUT" "LAUNCH 6 Ticket 6"

setup "[]"
run next
check "empty frontier" is "$OUT" "NOOP frontier empty"

# --- caps -------------------------------------------------------------------------------
setup "[$(issue 6 ready-for-agent)]"
REF=$(config_ref '.enabled = false') run next
check "disabled" is "$OUT" "NOOP disabled in config"

setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$TODAY")]}"
REF=$(config_ref '.maxInProgress = 1') run next
check "wip cap holds" is "$OUT" "NOOP 1 ticket(s) in progress (cap 1)"

# Stale claims keep their slot (finding: stale cleanup freed capacity while a thread lived).
setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
REF=$(config_ref '.maxInProgress = 1') run next
check "stale claim still holds its slot" is "$OUT" "NOOP 1 ticket(s) in progress (cap 1)"
check "stale claim gets ready-for-human, keeps in-progress" is "$(labels 1)" "in-progress,ready-for-human"
check "stale claim comments once" is "$(comments 1)" "1"
run next
check "stale sweep is idempotent" is "$(comments 1)" "1"

# Escalations count tickets, not PRs (finding: PR-less escalations escaped the cap).
setup "[$(issue 1 ready-for-human), $(issue 2 ready-for-human), $(issue 9 ready-for-human), $(issue 6 ready-for-agent)]" \
	"{\"1\": [$(claimed_event "$OLD")], \"2\": [$(claimed_event "$OLD")]}"
run next
check "escalated cap counts claimed tickets only" is "$OUT" "NOOP 2 ticket(s) waiting on Scott (cap 2)"
setup "[$(issue 1 ready-for-human), $(issue 9 ready-for-human), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
run next
check "human-planned tickets don't count as escalations" is "$OUT" "LAUNCH 6 Ticket 6"

# Daily cap paginates (finding: only the first 100 events were counted).
setup "[$(issue 6 ready-for-agent)]" "{}" "[[{\"event\":\"closed\",\"created_at\":\"$TODAY\",\"id\":9}], [$(claimed_event "$TODAY")]]"
REF=$(config_ref '.maxDailyClaims = 1') run next
check "daily cap counts claims on later pages" is "$OUT" "NOOP 1 claim(s) today (cap 1, UTC day)"

# Failed queries abort instead of reading as "nothing found" (re-check 1: caps failed open).
setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$TODAY")]}"
FAKE_GH_FAIL="GET labels=in-progress" run next
check "failed wip query aborts" is "$CODE:$OUT" "1:"
setup "[$(issue 1 ready-for-human), $(issue 2 ready-for-human), $(issue 6 ready-for-agent)]" \
	"{\"1\": [$(claimed_event "$OLD")], \"2\": [$(claimed_event "$OLD")]}"
FAKE_GH_FAIL="GET issues/2/events" run next
check "failed escalation lookup aborts" is "$CODE:$OUT" "1:"
setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$TODAY")]}"
FAKE_GH_FAIL="GET issues/1/events" run next
check "failed claim-age lookup aborts" is "$CODE:$OUT" "1:"

# --- transitions ------------------------------------------------------------------------
setup "[$(issue 6 ready-for-agent)]"
run claim 6
check "claim swaps labels" is "$(labels 6)" "in-progress"
check "claim comments" is "$(comments 6)" "1"
run claim 6
check "second claim refused" is "$CODE" "1"

setup "[$(issue 6 '')]"
run claim 6
check "claim refuses an unqueued ticket" is "$CODE" "1"

# Failed removal aborts (finding: DELETE errors were swallowed and success reported).
setup "[$(issue 6 in-progress)]"
FAKE_GH_FAIL="DELETE labels/in-progress" run release 6 "launch failed"
check "failed removal exits non-zero" is "$CODE" "1"
check "failed removal posts no success comment" is "$(comments 6)" "0"
check "failed removal never leaves the ticket unlabelled" is "$(labels 6)" "in-progress,ready-for-agent"

# Failed add aborts before removing (finding: stale cleanup removed before adding).
setup "[$(issue 6 in-progress)]"
FAKE_GH_FAIL="POST labels" run escalate 6 "stuck"
check "failed add exits non-zero" is "$CODE" "1"
check "failed add keeps the claim label" is "$(labels 6)" "in-progress"

setup "[$(issue 6 ready-for-agent)]"
run escalate 6 "stuck"
check "escalating an already-unclaimed ticket tolerates 404" is "$CODE" "0"
check "escalate adds ready-for-human" is "$(labels 6)" "ready-for-agent,ready-for-human"

setup "[$(issue 6 in-progress)]"
run escalate 6 "stuck"
check "escalate swaps labels" is "$(labels 6)" "ready-for-human"

printf '%d passed, %d failed\n' "$pass" "$fail"
((fail == 0))
