#!/usr/bin/env bash
# Regression tests for read-main.sh against a local bare remote (no network). Run: bash test-read-main.sh
set -uo pipefail
# A git hook exports GIT_DIR and friends; drop them so every git call below resolves its own repo.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT=$HERE/../read-main.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.invalid GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.invalid
export READ_MAIN_DIR=$WORK/main-view

pass=0 fail=0
ok() { pass=$((pass + 1)); echo "ok   $1"; }
bad() { fail=$((fail + 1)); echo "FAIL $1"; [ $# -lt 2 ] || echo "     $2"; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "$2"; fi; } # check <name> <shell condition>

git init -q --bare -b main "$WORK/origin.git"
git clone -q "$WORK/origin.git" "$WORK/seed" 2>/dev/null
git -C "$WORK/seed" switch -q -c main
echo one >"$WORK/seed/file.txt"
git -C "$WORK/seed" add . && git -C "$WORK/seed" commit -q -m "first commit" && git -C "$WORK/seed" push -q origin main
git clone -q "$WORK/origin.git" "$WORK/primary"
git -C "$WORK/primary" worktree add -q -b feature "$WORK/feature" >/dev/null 2>&1

advance() { # advance <content>: a new commit on the remote's main
	echo "$1" >"$WORK/seed/file.txt"
	git -C "$WORK/seed" commit -q -am "advance $1" && git -C "$WORK/seed" push -q origin main
}
run() { # run <dir>: sets OUT, ERR, CODE
	OUT=$(cd "$1" && bash "$SCRIPT" 2>"$WORK/err")
	CODE=$?
	ERR=$(cat "$WORK/err")
}
snapshot() { echo "$(git -C "$1" rev-parse HEAD) $(git -C "$1" branch --show-current) $(git -C "$1" status --porcelain | wc -l)"; }

# 1. First run creates the view at origin/main and prints path, sha, subject.
run "$WORK/primary"
TIP=$(git -C "$WORK/origin.git" rev-parse main)
check "first run exits 0" '[ "$CODE" -eq 0 ]'
check "first run prints the view path" 'grep -Fq "main-view   $READ_MAIN_DIR" <<<"$OUT"'
check "first run prints sha and subject" 'grep -Fq "origin/main  ${TIP:0:7} first commit" <<<"$OUT"'
check "view holds the tip's files" '[ "$(cat "$READ_MAIN_DIR/file.txt")" = one ]'
check "view is detached" '[ -z "$(git -C "$READ_MAIN_DIR" branch --show-current)" ]'
check "current primary shows no behind line" '! grep -q behind <<<"$OUT"'

# 2. A new remote commit: the view advances, the primary checkout stays put and is reported behind.
advance two
BEFORE=$(snapshot "$WORK/primary")
run "$WORK/primary"
check "second run advances the view" '[ "$(cat "$READ_MAIN_DIR/file.txt")" = two ]'
check "primary run reports this checkout behind" 'grep -Fq "behind      this checkout: 1 commit" <<<"$OUT"'
check "primary run lists no separate primary line" '! grep -Fq "primary checkout" <<<"$OUT"'
check "primary branch, HEAD and files untouched" '[ "$(snapshot "$WORK/primary")" = "$BEFORE" ] && [ "$(cat "$WORK/primary/file.txt")" = one ]'

# 3. From a feature worktree both the caller and the primary checkout are reported.
run "$WORK/feature"
check "feature run reports this checkout behind" 'grep -Fq "behind      this checkout: 1 commit" <<<"$OUT"'
check "feature run reports the primary checkout behind" 'grep -Fq "behind      primary checkout: 1 commit" <<<"$OUT"'
check "feature branch untouched" '[ "$(git -C "$WORK/feature" branch --show-current)" = feature ]'

# 4. Leftovers from a previous reader are wiped.
echo edited >"$READ_MAIN_DIR/file.txt"
echo junk >"$READ_MAIN_DIR/untracked.txt"
mkdir -p "$READ_MAIN_DIR/node_modules" && echo x >"$READ_MAIN_DIR/node_modules/pkg"
run "$WORK/primary"
check "dirty view is reset" '[ "$CODE" -eq 0 ] && [ "$(cat "$READ_MAIN_DIR/file.txt")" = two ] && [ -z "$(git -C "$READ_MAIN_DIR" status --porcelain --ignored)" ]'

# 5. Running from inside the view works and reports no behind line for it.
run "$READ_MAIN_DIR"
check "run from the view itself exits 0" '[ "$CODE" -eq 0 ]'
check "view is never reported behind itself" '! grep -Fq "this checkout" <<<"$OUT"'

# 6. A deleted view directory is recreated.
rm -rf "$READ_MAIN_DIR"
run "$WORK/primary"
check "deleted view is recreated" '[ "$CODE" -eq 0 ] && [ -f "$READ_MAIN_DIR/file.txt" ]'

# 7. A path that is not a worktree is refused, not clobbered.
rm -rf "$READ_MAIN_DIR" && git -C "$WORK/primary" worktree prune
mkdir -p "$READ_MAIN_DIR" && echo mine >"$READ_MAIN_DIR/keep.txt"
run "$WORK/primary"
check "foreign directory is refused" '[ "$CODE" -ne 0 ] && grep -Fq "not a worktree" <<<"$ERR" && [ -f "$READ_MAIN_DIR/keep.txt" ]'
rm -rf "$READ_MAIN_DIR"

# 8. Concurrent runs after a new commit all succeed and land on the same sha.
advance three
TIP=$(git -C "$WORK/origin.git" rev-parse main)
for i in 1 2 3 4; do (cd "$WORK/primary" && bash "$SCRIPT" >"$WORK/par$i.out" 2>"$WORK/par$i.err"; echo $? >"$WORK/par$i.code") & done
wait
all=1
for i in 1 2 3 4; do [ "$(cat "$WORK/par$i.code")" = 0 ] && grep -Fq "origin/main  ${TIP:0:7}" "$WORK/par$i.out" || all=0; done
check "four concurrent runs all succeed at the tip" '[ "$all" = 1 ] && [ "$(git -C "$READ_MAIN_DIR" rev-parse HEAD)" = "$TIP" ]'

# 9. A failed fetch exits non-zero, says so, prints no view, and leaves the view alone.
git clone -q "$WORK/origin.git" "$WORK/broken"
git -C "$WORK/broken" remote set-url origin "$WORK/missing.git"
advance four
VIEW_BEFORE=$(git -C "$READ_MAIN_DIR" rev-parse HEAD)
run "$WORK/broken"
check "fetch failure exits non-zero" '[ "$CODE" -ne 0 ]'
check "fetch failure is explained" 'grep -Fq "refusing to show a stale main" <<<"$ERR"'
check "fetch failure prints no view" '[ -z "$OUT" ]'
check "fetch failure leaves the view as it was" '[ "$(git -C "$READ_MAIN_DIR" rev-parse HEAD)" = "$VIEW_BEFORE" ]'

# 10. Outside a repository is a clear error.
run "$WORK"
check "outside a repo exits non-zero with a message" '[ "$CODE" -ne 0 ] && grep -Fq "inside a checkout" <<<"$ERR"'

echo "read-main: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
