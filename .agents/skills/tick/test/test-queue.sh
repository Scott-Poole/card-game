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
# claimed_event <at> [issue n]: a claim label event; repo-wide events name their issue.
claimed_event() { jq -n --arg at "$1" --arg n "${2:-}" '{event: "labeled", label: {name: "in-progress"}, created_at: $at, id: 1} + (if $n == "" then {} else {issue: {number: ($n | tonumber)}} end)'; }

# setup <issues json array> [events json object] [repo event pages json]
setup() {
	jq -n --argjson issues "$1" --argjson events "${2:-{\}}" --argjson pages "${3:-[[]]}" \
		'{issues: ($issues | map({key: (.number | tostring), value: .}) | from_entries),
		  events: $events, repo_event_pages: $pages, comments: []}' >"$WORK/state.json"
	# A claimed ticket flagged ready-for-human is the retired stale sweep's leftover unless a
	# test removes this comment: give it the sweep's comment, as production tickets have.
	jq '.comments += [.issues[] | select(([.labels[].name] | index("in-progress")) and ([.labels[].name] | index("ready-for-human")))
		| {issue: .number, body: "tick: claimed over 8h ago and not merged. Added `ready-for-human`; the claim keeps its slot until you remove `in-progress` or close the ticket.", author_association: "OWNER", created_at: "2099-01-01T00:00:00Z"}]' \
		"$WORK/state.json" >"$WORK/new.json" && mv "$WORK/new.json" "$WORK/state.json"
	: >"$WORK/calls.log"
}

run() { # run <args...>: runs queue.sh with the fake; sets OUT, ERR, CODE
	OUT=$(PATH="$WORK/bin:$PATH" FAKE_GH_STATE=$WORK/state.json FAKE_GH_LOG=$WORK/calls.log \
		TICK_REF=${REF:-$DEFAULT_REF} bash "$QUEUE" "$@" 2>"$WORK/err")
	CODE=$?
	ERR=$(cat "$WORK/err")
}
labels() { jq -r --arg n "$1" '.issues[$n].labels | map(.name) | sort | join(",")' "$WORK/state.json"; }
# Counts the comments the code under test posted, not the stale-sweep fixture.
comments() { jq -r --arg n "$1" '[.comments[] | select(.issue == ($n | tonumber)) | select(.body | contains("the claim keeps its slot") | not)] | length' "$WORK/state.json"; }

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

# --- merge audits -----------------------------------------------------------------------
pr() { issue "$1" "$2" "{\"state\":\"closed\",\"pull_request\":{},\"merged_at\":\"$3\"}"; }
setup "[$(pr 9 merged-unreviewed 2020-01-02T00:00:00Z), $(pr 10 merged-unreviewed "$OLD"), $(issue 1 merged-unreviewed)]"
run audit-next
check "audit picks oldest merge, skipping issues" is "$CODE:$OUT" "0:AUDIT 10"
REF=$(config_ref '.enabled = false') run audit-next
check "audit disabled" is "$CODE:$OUT" "0:NONE"
run audit-claim 10
check "audit claim swaps labels and comments" is "$CODE:$(labels 10):$(comments 10)" "0:audit-in-progress:1"
run audit-claim 10
check "audit refuses duplicate claim" is "$CODE" "1"
run audit-done 10 "No findings"
check "audit done removes claim and comments" is "$CODE:$(labels 10):$(comments 10)" "0::2"
run audit-claim 9
run audit-release 9 "launch failed"
check "audit release requeues" is "$CODE:$(labels 9)" "0:merged-unreviewed"
setup "[$(pr 10 '' "$OLD")]"
run audit-claim 10
check "audit refuses PR without queue label" is "$CODE" "1"
setup "[]"
run audit-next
check "empty audit queue" is "$CODE:$OUT" "0:NONE"
setup "[$(pr 10 audit-in-progress "$OLD")]" "{\"10\":[{\"event\":\"labeled\",\"label\":{\"name\":\"audit-in-progress\"},\"created_at\":\"$OLD\"}]}"
run audit-next
check "stale audit swept and offered again" is "$CODE:$OUT:$(labels 10)" "0:AUDIT 10:merged-unreviewed"
setup "[$(pr 10 audit-in-progress "$TODAY")]" "{\"10\":[{\"event\":\"labeled\",\"label\":{\"name\":\"audit-in-progress\"},\"created_at\":\"$TODAY\"}]}"
run audit-next
check "fresh audit not offered" is "$CODE:$OUT" "0:NONE"
setup "[$(pr 10 merged-unreviewed "$OLD")]"
FAKE_GH_FAIL="GET issues?state=closed" run audit-next
check "audit query fails closed" is "$CODE:$OUT" "1:"

setup "[$(pr 10 merged-unreviewed "$OLD")]"
FAKE_GH_FAIL="POST comments" run audit-claim 10
check "failed audit claim comment restores queue" is "$CODE:$(labels 10)" "1:merged-unreviewed"
setup "[$(pr 10 merged-unreviewed "$OLD")]"
FAKE_GH_FAIL="DELETE labels/merged-unreviewed" run audit-claim 10
check "partial audit transition restores queue" is "$CODE:$(labels 10)" "1:merged-unreviewed"

setup "[$(pr 10 merged-unreviewed "$OLD")]"
run audit-done 10 "No findings"
check "unclaimed audit cannot finish" is "$CODE:$(labels 10):$(comments 10)" "1:merged-unreviewed:0"
run audit-release 10 "late thread"
check "unclaimed audit cannot release" is "$CODE:$(labels 10):$(comments 10)" "1:merged-unreviewed:0"
setup "[$(pr 10 audit-in-progress "$OLD")]"
jq '.issues["10"].merged_at = null' "$WORK/state.json" >"$WORK/new.json"
mv "$WORK/new.json" "$WORK/state.json"
run audit-done 10 "No findings"
check "unmerged PR cannot finish audit" is "$CODE:$(labels 10):$(comments 10)" "1:audit-in-progress:0"

# --- completed parent specs --------------------------------------------------------------
setup "[$(issue 3 ready-for-agent), $(issue 4 '' '{"state":"closed","parent_issue_url":"https://api.github.com/repos/Scott-Poole/card-game/issues/3"}')]"
run parent-done 4
check "completed parent relabeled" is "$CODE:$(labels 3)" "0:ready-for-human"
check "completed parent comments once" is "$(comments 3)" "1"
check "completed parent stays open" is "$(jq -r '.issues["3"].state' "$WORK/state.json")" "open"
jq -S . "$WORK/state.json" >"$WORK/before.json"
run parent-done 4
check "second completion changes nothing" is "$(cat "$WORK/before.json")" "$(jq -S . "$WORK/state.json")"

# One claimed escalation plus a completed spec must still allow work (cap is two).
jq '.issues["1"] = {number:1,title:"Escalated",state:"open",labels:[{name:"ready-for-human"}]} |
    .events["1"] = [{event:"labeled",label:{name:"in-progress"}}] |
    .issues["6"] = {number:6,title:"Ticket 6",state:"open",labels:[{name:"ready-for-agent"}],assignees:[]}' "$WORK/state.json" >"$WORK/new.json"
mv "$WORK/new.json" "$WORK/state.json"
run next
check "completed spec does not fill escalation cap" is "$OUT" "LAUNCH 6 Ticket 6"

setup "[$(issue 3 ready-for-agent), $(issue 4 '' '{"state":"open","parent_issue_url":"https://api.github.com/repos/Scott-Poole/card-game/issues/3"}')]"
jq -S . "$WORK/state.json" >"$WORK/before.json"
run parent-done 4
check "open child leaves parent untouched" is "$CODE" "0"
check "open child changes nothing" is "$(cat "$WORK/before.json")" "$(jq -S . "$WORK/state.json")"

setup "[$(issue 4 '')]"
jq -S . "$WORK/state.json" >"$WORK/before.json"
run parent-done 4
check "no parent succeeds without changes" is "$CODE" "0"
check "no parent changes nothing" is "$(cat "$WORK/before.json")" "$(jq -S . "$WORK/state.json")"

setup "[$(issue 3 ready-for-agent), $(issue 4 '' '{"state":"closed","parent_issue_url":"https://api.github.com/repos/Scott-Poole/card-game/issues/3"}')]"
FAKE_GH_FAIL="POST comments" run parent-done 4
check "comment failure reports failure" is "$CODE:$(comments 3)" "1:0"
run parent-done 4
run parent-done 4
check "retry after failed comment posts exactly once" is "$CODE:$(comments 3)" "0:1"

setup "[$(issue 3 ready-for-agent '{"state":"closed"}'), $(issue 4 '' '{"state":"closed","parent_issue_url":"https://api.github.com/repos/Scott-Poole/card-game/issues/3"}')]"
run parent-done 4
check "closed parent is untouched" is "$CODE:$(labels 3):$(comments 3)" "0:ready-for-agent:0"

setup "[$(issue 3 ready-for-agent), $(issue 4 '' '{"state":"closed","parent_issue_url":"https://api.github.com/repos/Scott-Poole/card-game/issues/3"}')]"
jq '.comments = [{issue:3,body:"<!-- queue:parent-done -->",author_association:"NONE"}]' "$WORK/state.json" >"$WORK/new.json"
mv "$WORK/new.json" "$WORK/state.json"
run parent-done 4
check "untrusted marker cannot suppress notice" is "$CODE:$(comments 3)" "0:2"

# --- frontier ---------------------------------------------------------------------------
setup "[$(issue 3 ready-for-agent '{"sub_issues_summary":{"total":3}}'),
	$(issue 4 ready-for-agent '{"assignees":[{"login":"x"}]}'),
	$(issue 5 ready-for-agent '{"issue_dependencies_summary":{"blocked_by":1}}'),
	$(issue 6 ready-for-agent)]"
run next
check "frontier skips parents, assigned, blocked" is "$OUT" "LAUNCH 6 Ticket 6"

# --- planning ---------------------------------------------------------------------------
# plan <n> <category> <created_at> [state]: one planning issue.
plan() { issue "$1" planning "{\"title\": \"Plan: $2\", \"created_at\": \"$3\", \"state\": \"${4:-closed}\"}"; }

setup "[]"
run next
check "empty frontier plans the first category" is "$OUT" "PLAN feature"

setup "[]"
REF=$(config_ref '.planning.enabled = false') run next
check "planning disabled" is "$OUT" "NOOP frontier empty; planning disabled in config"

setup "[$(plan 1 feature "$OLD"), $(plan 2 game-content "$OLD")]"
run next
check "rotation picks a never-run category next" is "$OUT" "PLAN bug-hunt"

setup "[$(plan 1 feature 2020-01-03T00:00:00Z), $(plan 2 game-content 2020-01-01T00:00:00Z)]"
REF=$(config_ref '.planning.categories = ["feature", "game-content"]') run next
check "rotation picks the least recently run" is "$OUT" "PLAN game-content"

setup "[$(plan 1 feature "$TODAY" open)]"
run next
check "a running planner blocks another" is "$OUT" "NOOP frontier empty; planner #1 running"

setup "[$(plan 1 feature "$OLD" open)]"
run next
check "a stale planner is closed" is "$(jq -r '.issues["1"].state' "$WORK/state.json")" "closed"
check "a stale planner gets a comment" is "$(comments 1)" "1"
check "planning resumes past a stale planner" is "$OUT" "PLAN game-content"

setup "[$(plan 1 feature "$TODAY"), $(plan 2 game-content "$TODAY"), $(plan 3 bug-hunt "$TODAY")]"
run next
check "daily plan cap" is "$OUT" "NOOP frontier empty; 3 plan run(s) today (cap 3, UTC day)"

# Planners refill the queue while an implementer works: WIP doesn't gate them.
setup "[$(issue 1 in-progress)]" "{\"1\": [$(claimed_event "$TODAY")]}"
run next
check "planning ignores the wip cap" is "$OUT" "PLAN feature"

setup "[$(issue 1 ready-for-human), $(issue 2 ready-for-human)]" \
	"{\"1\": [$(claimed_event "$OLD")], \"2\": [$(claimed_event "$OLD")]}"
run next
check "the escalation cap stops planning too" is "$OUT" "NOOP 2 ticket(s) waiting on Scott (cap 2)"

setup "[]"
FAKE_GH_FAIL="GET labels=planning" run next
check "failed planning query aborts" is "$CODE:$OUT" "1:"

setup "[]"
FAKE_GH_NOW=$TODAY run plan-open feature
check "plan-open prints the new issue" is "$OUT" "1"
check "plan-open labels and titles it" is "$(labels 1):$(jq -r '.issues["1"].title' "$WORK/state.json")" "planning:Plan: feature"
run plan-open game-content
check "plan-open refuses while a planner is open" is "$CODE" "1"
run plan-done 1 "filed #2, #3"
check "plan-done closes as completed" is "$(jq -r '.issues["1"] | "\(.state) \(.state_reason)"' "$WORK/state.json")" "closed completed"
check "plan-done posts the summary" is "$(comments 1)" "1"

setup "[]"
run plan-open astrology
check "plan-open refuses an unknown category" is "$CODE" "1"

# plan-open re-runs next, so a stale PLAN line can't skip caps or rotation (review of #11).
setup "[]"
run plan-open bug-hunt
check "plan-open refuses a category out of rotation" is "$CODE:$(jq '.issues | length' "$WORK/state.json")" "1:0"
setup "[$(plan 1 feature "$TODAY"), $(plan 2 game-content "$TODAY"), $(plan 3 bug-hunt "$TODAY")]"
run plan-open code-health
check "plan-open re-checks the daily cap" is "$CODE" "1"
setup "[$(issue 6 ready-for-agent)]"
run plan-open feature
check "plan-open refuses when a ticket is ready" is "$CODE" "1"

setup "[$(issue 1 in-progress)]" "{\"1\": [$(claimed_event "$TODAY")]}"
FAKE_GH_FAIL="GET issues/1/events" run plan-open feature
check "plan-open aborts when next's queries fail" is "$CODE:$(jq '.issues | length' "$WORK/state.json")" "1:1"

# Two ticks interleaving both create issues; the lower number wins.
setup "[]"
FAKE_GH_RACE=1 FAKE_GH_NOW=$TODAY run plan-open feature
check "plan-open loses a race to a lower planner" is "$CODE" "1"
check "the losing planner closes itself" is "$(jq -r '.issues["2"] | "\(.state) \(.state_reason)"' "$WORK/state.json")" "closed not_planned"

setup "[$(issue 6 ready-for-agent)]"
run plan-abort 6 "nope"
check "plan-abort refuses a non-planning issue" is "$CODE:$(jq -r '.issues["6"].state' "$WORK/state.json")" "1:open"

# --- caps -------------------------------------------------------------------------------
setup "[$(issue 6 ready-for-agent)]"
REF=$(config_ref '.enabled = false') run next
check "disabled" is "$OUT" "NOOP disabled in config"

setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$TODAY")]}"
REF=$(config_ref '.maxInProgress = 1') run next
check "wip cap holds" is "$OUT" "NOOP 1 ticket(s) in progress (cap 1)"

# A claim with no sign of life is surfaced for a thread check, never relabelled: a live
# thread is not waiting on Scott (#91 and #111 were flagged ready-for-human while their
# threads lived, which filled the escalation cap and parked the whole queue).
comment_at() { jq -n --arg n "$1" --arg at "$2" --arg body "$3" --arg who "${4:-OWNER}" '{issue: ($n | tonumber), body: $body, author_association: $who, created_at: $at}'; }
add_comments() { jq --argjson c "[$1]" '.comments += $c' "$WORK/state.json" >"$WORK/new.json" && mv "$WORK/new.json" "$WORK/state.json"; }
ALIVE='<!-- queue:alive -->'
NUDGE='<!-- queue:nudge -->'

setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
REF=$(config_ref '.maxInProgress = 1') run next
check "stale claim is surfaced for a thread check" is "$OUT" "CHECK 1 0 Ticket 1"
check "stale claim keeps in-progress and gains no label" is "$(labels 1)" "in-progress"
check "surfacing a stale claim posts nothing" is "$(comments 1)" "0"
run next
check "the check is repeatable until someone answers it" is "$OUT" "CHECK 1 0 Ticket 1"

setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$TODAY")]}"
REF=$(config_ref '.maxInProgress = 1') run next
check "a fresh claim is not checked and still holds its slot" is "$OUT" "NOOP 1 ticket(s) in progress (cap 1)"

setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 "$TODAY" "$ALIVE heartbeat")"
REF=$(config_ref '.maxInProgress = 1') run next
check "a recent heartbeat restarts the stale clock" is "$OUT" "NOOP 1 ticket(s) in progress (cap 1)"

setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 "$TODAY" "$ALIVE heartbeat" NONE)"
run next
check "a stranger's heartbeat cannot hold a claim open" is "$OUT" "CHECK 1 0 Ticket 1"

setup "[$(issue 1 in-progress), $(issue 6 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 "$OLD" "$ALIVE$NUDGE woke it"), $(comment_at 1 "$OLD" "$ALIVE$NUDGE woke it again")"
run next
check "the check reports how often the thread was already woken" is "$OUT" "CHECK 1 2 Ticket 1"

setup "[$(issue 1 in-progress)]" "{\"1\": [$(claimed_event "2020-01-01T00:00:00Z"), $(claimed_event "2020-02-01T00:00:00Z")]}"
add_comments "$(comment_at 1 2020-01-15T00:00:00Z "$ALIVE$NUDGE woke it"), $(comment_at 1 2020-01-16T00:00:00Z "$ALIVE$NUDGE woke it again"), $(comment_at 1 2020-02-02T00:00:00Z "$ALIVE$NUDGE woke it")"
run next
check "nudges before the current claim do not count" is "$OUT" "CHECK 1 1 Ticket 1"

setup "[$(issue 1 in-progress), $(issue 2 in-progress)]" "{\"1\": [$(claimed_event "$OLD")], \"2\": [$(claimed_event "$OLD")]}"
run next
check "the lowest-numbered stale claim is checked first" is "$OUT" "CHECK 1 0 Ticket 1"

setup "[$(issue 1 in-progress)]" "{\"1\": [$(claimed_event "$OLD")]}"
run next 1
check "this run's own claim is never checked" is "$OUT" "PLAN feature"

setup "[$(issue 1 in-progress), $(issue 2 ready-for-human), $(issue 3 ready-for-human)]" \
	"{\"1\": [$(claimed_event "$OLD")], \"2\": [$(claimed_event "$OLD")], \"3\": [$(claimed_event "$OLD")]}"
run next
check "a stale check comes before the escalation cap" is "$OUT" "CHECK 1 0 Ticket 1"

# alive records the heartbeat; the old sweep's ready-for-human on a claimed ticket goes.
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
FAKE_GH_NOW=$TODAY run alive 1 nudged
check "alive posts one heartbeat and clears the stale flag" is "$CODE:$(labels 1):$(comments 1)" "0:in-progress:1"
check "alive marks a nudge" is "$(jq -r '.comments[] | select(.body | contains("queue:alive")) | .body' "$WORK/state.json" | grep -c "$NUDGE")" "1"
run next
check "after alive the claim is no longer stale" is "$OUT" "PLAN feature"
setup "[$(issue 6 ready-for-agent)]"
run alive 6
check "alive refuses an unclaimed ticket" is "$CODE:$(comments 6)" "1:0"

# A claim still carrying in-progress is held by a thread, so it is not waiting on Scott.
setup "[$(issue 1 in-progress,ready-for-human), $(issue 2 in-progress,ready-for-human), $(issue 6 ready-for-agent)]" \
	"{\"1\": [$(claimed_event "$TODAY")], \"2\": [$(claimed_event "$TODAY")]}"
run next
check "claimed tickets never fill the escalation cap" is "$OUT" "LAUNCH 6 Ticket 6"

setup "[$(issue 1 in-progress,ready-for-human)]"
run release 1 "thread gone"
check "release clears a leftover ready-for-human" is "$CODE:$(labels 1)" "0:ready-for-agent"
# The thread escalated between the check and the release: Scott's handoff must survive.
setup "[$(issue 1 ready-for-human)]"
run release 1 "thread gone"
check "release refuses a ticket that was escalated meanwhile" is "$CODE:$(labels 1):$(comments 1)" "1:ready-for-human:0"

# The race the guard cannot see: the thread escalates after release read its labels.
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 "$TODAY" $'## Needs you\n\nDecision: ...')"
run release 1 "thread gone"
check "release leaves a flagged claim that carries a handoff untouched" is "$CODE:$(labels 1)" "1:in-progress,ready-for-human"
# A handoff comment without its label yet (escalate mid-flight) also blocks the release.
setup "[$(issue 1 in-progress)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 "$TODAY" $'## Needs you\n\nDecision: ...')"
run release 1 "thread gone"
check "release refuses a claim whose handoff comment is already posted" is "$CODE:$(labels 1):$(comments 1)" "1:in-progress:1"
setup "[$(issue 1 in-progress)]" "{\"1\": [$(claimed_event "$OLD")]}"
FAKE_GH_FAIL="GET issues/1/events" run release 1 "thread gone"
check "release fails closed when the claim-start lookup fails" is "$CODE:$(labels 1)" "1:in-progress"
# Fail every call, one at a time, at every position of a release or an alive. Whatever fails,
# the ticket ends either fully done or exactly as it started, never half-swapped.
for spec in "GET issues/1" "POST issues/1/labels" "DELETE issues/1/labels" "POST issues/1/comments"; do
	# The release comment is the last step: if only it fails the swap has completed, which is fine.
	release_specs=$([[ $spec == "POST issues/1/comments" ]] && echo skip || echo run)
	for skip in 0 1 2 3 4 5 6 7 8 9; do
		setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
		rm -f "$WORK/state.json.failseen"
		if [[ $release_specs == run ]]; then
			FAKE_GH_FAIL="$spec" FAKE_GH_FAIL_SKIP=$skip FAKE_GH_FAIL_ONCE=1 run release 1 "thread gone"
			check "release is all-or-nothing when [$spec] #$skip fails" is "$(labels 1)" "$([[ $CODE == 0 ]] && echo ready-for-agent || echo in-progress,ready-for-human)"
		fi
		setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
		rm -f "$WORK/state.json.failseen"
		FAKE_GH_FAIL="$spec" FAKE_GH_FAIL_SKIP=$skip FAKE_GH_FAIL_ONCE=1 run alive 1
		check "alive is all-or-nothing when [$spec] #$skip fails" is "$(labels 1)" "$([[ $CODE == 0 ]] && echo in-progress || echo in-progress,ready-for-human)"
	done
done
# A claim is all-or-nothing too: without its comment it has no start, so a failed write
# puts the ticket back in the queue.
for spec in "GET issues/6" "POST issues/6/labels" "DELETE issues/6/labels" "POST issues/6/comments"; do
	for skip in 0 1 2 3 4; do
		setup "[$(issue 6 ready-for-agent)]"
		rm -f "$WORK/state.json.failseen"
		FAKE_GH_FAIL="$spec" FAKE_GH_FAIL_SKIP=$skip FAKE_GH_FAIL_ONCE=1 run claim 6
		check "claim is all-or-nothing when [$spec] #$skip fails" is "$(labels 6)" "$([[ $CODE == 0 ]] && echo in-progress || echo ready-for-agent)"
		check "a claim that exits 0 has its comment [$spec] #$skip" is "$([[ $CODE == 0 ]] && comments 6 || echo 1)" "1"
	done
done
# The raced handoff plus a failing write: the handoff must not end up launchable.
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
FAKE_GH_RACE_HANDOFF=1 run release 1 "thread gone"
check "a handoff that races release stays with Scott" is "$CODE:$(labels 1)" "1:ready-for-human"
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
rm -f "$WORK/state.json.failseen"
FAKE_GH_RACE_HANDOFF=1 FAKE_GH_FAIL="POST issues/1/labels" FAKE_GH_FAIL_SKIP=1 FAKE_GH_FAIL_ONCE=1 run release 1 "thread gone"
check "a raced handoff is never left launchable when restoring its label fails" is "$CODE:$(labels 1)" "1:in-progress,ready-for-human"
# A rollback re-adds in-progress, which makes a newer label event than the handoff comment.
# The claim comment, not that event, marks the claim's start, so the handoff still counts.
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 "$OLD" 'tick: claimed 2020-01-01T00:00Z; launching a work-ticket thread.')"
rm -f "$WORK/state.json.failseen"
FAKE_GH_NOW=2100-01-01T00:00:00Z FAKE_GH_RACE_HANDOFF=1 FAKE_GH_FAIL="POST issues/1/labels" FAKE_GH_FAIL_SKIP=1 FAKE_GH_FAIL_ONCE=1 run release 1 "thread gone"
check "the raced release rolls back" is "$CODE:$(labels 1)" "1:in-progress,ready-for-human"
FAKE_GH_NOW=2100-01-02T00:00:00Z run release 1 "thread gone"
check "a retry after the rollback still sees the handoff" is "$CODE:$(labels 1)" "1:in-progress,ready-for-human"
# escalate: holding label, comment, then the claim comes off. Until the comment lands a failure
# undoes everything (so the caller can retry); after it, next finishes a failed claim removal.
HANDOFF=$'## Needs you\n\nDecision: ...'
setup "[$(issue 6 ready-for-agent)]"
rm -f "$WORK/state.json.failseen"
FAKE_GH_FAIL="POST issues/6/labels" FAKE_GH_FAIL_ONCE=1 run escalate 6 "$HANDOFF"
check "a failed holding label leaves no comment on a queued ticket" is "$CODE:$(labels 6):$(comments 6)" "1:ready-for-agent:0"
setup "[$(issue 6 ready-for-agent)]"
rm -f "$WORK/state.json.failseen"
FAKE_GH_FAIL="POST issues/6/comments" FAKE_GH_FAIL_ONCE=1 run escalate 6 "$HANDOFF"
check "a failed handoff comment removes the holding label again" is "$CODE:$(labels 6):$(comments 6)" "1:ready-for-agent:0"
setup "[$(issue 1 in-progress)]" "{\"1\": [$(claimed_event "$OLD")]}"
rm -f "$WORK/state.json.failseen"
FAKE_GH_FAIL="DELETE issues/1/labels" FAKE_GH_FAIL_ONCE=1 run escalate 1 "$HANDOFF"
check "a failed claim removal leaves claim, flag and comment" is "$CODE:$(labels 1):$(comments 1)" "1:in-progress,ready-for-human:1"
run next
check "next finishes the half-done escalation" is "$(labels 1):$OUT" "ready-for-human:PLAN feature"
run next
check "the finished escalation does not recur" is "$OUT" "PLAN feature"
# Scott answered a half-done escalation and swapped the label: the dead claim just comes off.
setup "[$(issue 1 in-progress,ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 2099-01-01T00:00:00Z "$HANDOFF")"
run next
check "a handed-back half-done escalation resumes instead of reverting" is "$(labels 1):$OUT" "ready-for-agent:LAUNCH 1 Ticket 1"
# A lagging run claim whose escalation half-finished is reconciled and counted at once.
setup "[$(issue 1 ready-for-human), $(issue 6 in-progress,ready-for-human), $(issue 10 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")], \"6\": [$(claimed_event "$TODAY")]}"
add_comments "$(comment_at 6 "$TODAY" 'tick: claimed now; launching a work-ticket thread.'), $(comment_at 6 2099-01-01T00:00:00Z "$HANDOFF")"
FAKE_GH_LAG_LISTING="6" run next 6
check "a lagging claim with a pending handoff is reconciled and counted" is "$(labels 6):$OUT" "ready-for-human:NOOP 2 ticket(s) waiting on Scott (cap 2)"
# Claim history on a second page of events still counts.
setup "[$(issue 1 ready-for-human), $(issue 2 ready-for-human), $(issue 6 ready-for-agent)]"
jq --argjson e "[$(claimed_event "$OLD")]" '.event_pages = {"1": [[{"event":"closed"}], $e], "2": [[{"event":"closed"}], $e]}' "$WORK/state.json" >"$WORK/new.json" && mv "$WORK/new.json" "$WORK/state.json"
run next
check "claims on a later events page count toward the escalation cap" is "$OUT" "NOOP 2 ticket(s) waiting on Scott (cap 2)"
jq --argjson e "[$(claimed_event "$OLD")]" '.event_pages = {"1": [[{"event":"closed"}], $e]}' "$WORK/state.json" >"$WORK/new.json" && mv "$WORK/new.json" "$WORK/state.json"
run resume-info 1
check "resume-info counts claims on a later events page" is "$OUT" "THREAD none CLAIMS 1"
# A FRESH claim with a pending handoff counts against the cap at once, not after staleHours.
setup "[$(issue 1 ready-for-human), $(issue 2 in-progress), $(issue 3 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")], \"2\": [$(claimed_event "$TODAY")]}"
add_comments "$(comment_at 2 "$TODAY" 'tick: claimed now; launching a work-ticket thread.'), $(comment_at 2 2099-01-01T00:00:00Z $'## Needs you\n\nDecision: ...')"
run next
check "a fresh pending escalation is finished and counted" is "$(labels 2):$OUT" "ready-for-human:NOOP 2 ticket(s) waiting on Scott (cap 2)"
# A ready-for-human ticket is never claimed, and an escalation landing during the claim undoes it.
setup "[$(issue 6 ready-for-agent,ready-for-human)]"
run claim 6
check "claim refuses a ticket that carries ready-for-human" is "$CODE:$(labels 6):$(comments 6)" "1:ready-for-agent,ready-for-human:0"
setup "[$(issue 6 ready-for-agent)]"
FAKE_GH_RACE_HUMAN=1 run claim 6
check "a claim that raced an escalation is undone" is "$CODE:$(labels 6):$(comments 6)" "1:ready-for-agent,ready-for-human:1"
# This run's own claim is reconciled too: a half-done escalation counts at once.
setup "[$(issue 1 ready-for-human), $(issue 2 in-progress), $(issue 3 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")], \"2\": [$(claimed_event "$TODAY")]}"
add_comments "$(comment_at 2 "$TODAY" 'tick: claimed now; launching a work-ticket thread.'), $(comment_at 2 2099-01-01T00:00:00Z $'## Needs you\n\nDecision: ...')"
run next 2
check "a run-claimed ticket with a pending handoff is finished and counted" is "$(labels 2):$OUT" "ready-for-human:NOOP 2 ticket(s) waiting on Scott (cap 2)"
# A ticket this run already handed to Scott holds no WIP slot on the next iteration.
setup "[$(issue 6 ready-for-human), $(issue 7 in-progress), $(issue 8 in-progress), $(issue 9 in-progress), $(issue 10 ready-for-agent)]" \
	"{\"6\": [$(claimed_event "$OLD")], \"7\": [$(claimed_event "$TODAY")], \"8\": [$(claimed_event "$TODAY")], \"9\": [$(claimed_event "$TODAY")]}"
run next 6 7 8 9
check "a run ticket handed to Scott is not counted as in progress" is "$OUT" "LAUNCH 10 Ticket 10"
# Without the retired sweep's comment, ready-for-human on a claim belongs to an escalation that
# may still be in flight (label first, comment next): release refuses, alive leaves it alone.
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
jq '.comments = []' "$WORK/state.json" >"$WORK/new.json" && mv "$WORK/new.json" "$WORK/state.json"
run release 1 "thread gone"
check "release refuses an unexplained ready-for-human" is "$CODE:$(labels 1):$(comments 1)" "1:in-progress,ready-for-human:0"
run alive 1
check "alive leaves an unexplained ready-for-human" is "$CODE:$(labels 1):$(comments 1)" "0:in-progress,ready-for-human:1"
# Cap accounting: a ticket this run handed to Scott counts even when the human listing lags it...
setup "[$(issue 1 ready-for-human), $(issue 6 ready-for-human), $(issue 10 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")], \"6\": [$(claimed_event "$TODAY")]}"
FAKE_GH_LAG_LISTING="6" run next 6
check "a lagging human listing does not hide a finished escalation" is "$OUT" "NOOP 2 ticket(s) waiting on Scott (cap 2)"
# ...and when its claim event history lags it, so ever_claimed cannot see it.
setup "[$(issue 1 ready-for-human), $(issue 6 in-progress), $(issue 10 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 6 "$TODAY" 'tick: claimed now; launching a work-ticket thread.'), $(comment_at 6 2099-01-01T00:00:00Z "$HANDOFF")"
run next 6
check "a finished escalation with no claim event yet still counts" is "$(labels 6):$OUT" "ready-for-human:NOOP 2 ticket(s) waiting on Scott (cap 2)"
# alive must not erase a handoff either (a legacy flag and a real escalation look alike).
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 "$TODAY" $'## Needs you\n\nDecision: ...')"
run alive 1
check "alive keeps a ready-for-human that carries a handoff" is "$CODE:$(labels 1)" "0:in-progress,ready-for-human"
# A failed label read during release must abort, not read as "no handoff".
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
FAKE_GH_FAIL="GET issues/1" run release 1 "thread gone"
check "release fails closed when the label query fails" is "$CODE:$(comments 1)" "1:0"
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$OLD")]}"
FAKE_GH_FAIL="GET issues/1/comments" run release 1 "thread gone"
check "release fails closed when the handoff lookup fails" is "$CODE:$(comments 1)" "1:0"
# Ancient handoffs (before the current claim) do not block clearing a stale flag.
setup "[$(issue 1 in-progress,ready-for-human)]" "{\"1\": [$(claimed_event "$TODAY")]}"
add_comments "$(comment_at 1 "$OLD" $'## Needs you\n\nDecision: ...')"
run release 1 "thread gone"
check "a handoff from an earlier claim does not block release" is "$CODE:$(labels 1)" "0:ready-for-agent"

# Hand-back: Scott swaps ready-for-human for ready-for-agent and the ticket re-enters the
# frontier despite its claim history.
setup "[$(issue 1 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD")]}"
run next
check "a handed-back ticket is launched again" is "$OUT" "LAUNCH 1 Ticket 1"

setup "[$(issue 1 ready-for-agent)]" "{\"1\": [$(claimed_event "$OLD"), $(claimed_event "$OLD")]}"
add_comments "$(comment_at 1 "$OLD" "work-ticket thread: t3-thread://v2/env/mcp:aaa"), $(comment_at 1 "$OLD" "work-ticket thread: t3-thread://v2/env/mcp:bbb"), $(comment_at 1 "$OLD" "work-ticket thread: t3-thread://evil" NONE)"
run resume-info 1
check "resume-info names the newest trusted thread and the claim count" is "$OUT" "THREAD t3-thread://v2/env/mcp:bbb CLAIMS 2"
setup "[$(issue 1 ready-for-agent)]"
run resume-info 1
check "resume-info of a fresh ticket" is "$OUT" "THREAD none CLAIMS 0"

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

# Every configured category has a lens in the plan skill: queue.sh would launch a planner
# for any listed category, and one without a row would invent its own remit (review of #11).
missing=$(jq -r '.planning.categories[]' "$HERE/../config.json" | while read -r c; do
	grep -q "^| \`$c\` |" "$HERE/../../plan/SKILL.md" || echo "$c"
done)
OUT=$missing ERR= CODE=
check "every planning category has a lens in plan/SKILL.md" is "$missing" ""

# --- dispatch loop ----------------------------------------------------------------------
# A tick repeats next -> claim, passing next the tickets it claimed so far. Each claim must
# move next on to a fresh ticket, and the caps alone must end the loop.
setup "[$(issue 6 ready-for-agent), $(issue 7 ready-for-agent), $(issue 8 ready-for-agent)]"
seen=() mine=()
for _ in 1 2 3 4 5; do
	REF=$(config_ref '.maxInProgress = 2') run next "${mine[@]}"
	seen+=("$OUT")
	[[ $OUT == LAUNCH* ]] || break
	mine+=("$(cut -d' ' -f2 <<<"$OUT")")
	run claim "${mine[-1]}"
done
OUT=$(printf '%s|' "${seen[@]}")
check "the loop launches up to the wip cap, then stops" is "$OUT" "LAUNCH 6 Ticket 6|LAUNCH 7 Ticket 7|NOOP 2 ticket(s) in progress (cap 2)|"
check "the loop leaves the ticket past the cap queued" is "$(labels 8)" "ready-for-agent"

# Seconds apart, GitHub's listings may not show a claim yet (review of #14). Here #6 was
# claimed this run, but every listing still shows it queued and no claim event exists.
setup "[$(issue 6 ready-for-agent), $(issue 7 ready-for-agent)]"
run next 6
check "a lagging listing never re-offers this run's claim" is "$OUT" "LAUNCH 7 Ticket 7"
REF=$(config_ref '.maxInProgress = 1') run next 6
check "this run's claims hold wip slots before the listing shows them" is "$OUT" "NOOP 1 ticket(s) in progress (cap 1)"
REF=$(config_ref '.maxDailyClaims = 1') run next 6
check "this run's claims count today before the events show them" is "$OUT" "NOOP 1 claim(s) today (cap 1, UTC day)"

# Once the listings catch up, a claim counts once, not twice.
setup "[$(issue 6 in-progress), $(issue 7 ready-for-agent)]" "{\"6\": [$(claimed_event "$TODAY")]}" "[[$(claimed_event "$TODAY" 6)]]"
REF=$(config_ref '.maxInProgress = 2 | .maxDailyClaims = 2') run next 6
check "a listed claim of this run counts once" is "$OUT" "LAUNCH 7 Ticket 7"

setup "[$(issue 6 ready-for-agent)]"
run next 6
check "claiming the last ticket hands over to a planner" is "$OUT" "PLAN feature"
run plan-open feature
check "plan-open without them sees the lagging ticket and refuses" is "$CODE:$(jq '.issues | length' "$WORK/state.json")" "1:1"
FAKE_GH_NOW=$TODAY run plan-open feature 6
check "plan-open takes this run's claims too" is "$CODE:$OUT" "0:7"

setup "[$(issue 6 ready-for-agent)]"
run next 6x
check "next rejects a claim that isn't an issue number" is "$CODE:$OUT" "1:"

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

NEEDS=$'## Needs you\n\nDecision: ...'

# Failed removal aborts (finding: DELETE errors were swallowed and success reported).
setup "[$(issue 6 in-progress)]"
FAKE_GH_FAIL="DELETE labels/in-progress" run release 6 "launch failed"
check "failed removal exits non-zero" is "$CODE" "1"
check "failed removal posts no success comment" is "$(comments 6)" "0"
check "failed removal rolls back and never leaves the ticket unlabelled" is "$(labels 6)" "in-progress"

# Failed add aborts before removing (finding: stale cleanup removed before adding).
setup "[$(issue 6 in-progress)]"
FAKE_GH_FAIL="POST labels" run escalate 6 "$NEEDS"
check "failed add exits non-zero" is "$CODE" "1"
check "failed add keeps the claim label" is "$(labels 6)" "in-progress"

setup "[$(issue 6 ready-for-agent)]"
run escalate 6 "$NEEDS"
check "escalating an already-unclaimed ticket tolerates 404" is "$CODE" "0"
check "escalate adds ready-for-human" is "$(labels 6)" "ready-for-agent,ready-for-human"

setup "[$(issue 6 in-progress)]"
run escalate 6 "$NEEDS"
check "escalate swaps labels" is "$(labels 6)" "ready-for-human"

setup "[$(issue 6 in-progress)]"
FAKE_GH_FAIL="POST comments" run escalate 6 "$NEEDS"
check "a failed handoff comment leaves the claim in place" is "$CODE:$(labels 6)" "1:in-progress"

setup "[$(issue 6 in-progress)]"
run escalate 6 "stuck"
check "escalate refuses a comment that is not a Needs-you handoff" is "$CODE:$(labels 6):$(comments 6)" "1:in-progress:0"

printf '%d passed, %d failed\n' "$pass" "$fail"
((fail == 0))
