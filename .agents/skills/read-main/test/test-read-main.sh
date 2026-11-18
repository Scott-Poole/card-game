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
# A developer's global git config (core.abbrev, commit.gpgsign, ...) must not change the outcome.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
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
# Awkward tree entries: spaces, a newline, a symlink, a gitlink (a submodule entry has no files).
echo x >"$WORK/seed/with space.txt"
echo y >"$WORK/seed/$(printf 'new\nline.txt')"
ln -s file.txt "$WORK/seed/link.txt"
git -C "$WORK/seed" update-index --add --cacheinfo 160000,1111111111111111111111111111111111111111,vendor
git -C "$WORK/seed" add -- file.txt "with space.txt" link.txt ./new*line.txt && git -C "$WORK/seed" commit -q -m "first commit" && git -C "$WORK/seed" push -q origin main
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
files() { (cd "$1" && find . -path ./.git -prune -o \( -type f -o -type l \) -print0 | sed -z 's|^\./||' | sort -z | tr '\0' '|'); }
tree_files() { git -C "$1" ls-tree -r -z HEAD | sed -z '/^160000 /d; s/^[^\t]*\t//' | sort -z | tr '\0' '|'; }

# 1. First run creates the view at origin/main and prints path, sha, subject.
run "$WORK/primary"
TIP=$(git -C "$WORK/origin.git" rev-parse main)
check "first run exits 0" '[ "$CODE" -eq 0 ]'
check "first run prints the view path" 'grep -Fq "main-view   $READ_MAIN_DIR" <<<"$OUT"'
check "first run prints sha and subject" 'grep -Fq "origin/main  $TIP first commit" <<<"$OUT"'
check "view holds the tip's files" '[ "$(cat "$READ_MAIN_DIR/file.txt")" = one ]'
check "view is detached" '[ -z "$(git -C "$READ_MAIN_DIR" branch --show-current)" ]'
check "the first tip has a gitlink and the view still matches it" '[ -n "$(git -C "$WORK/origin.git" ls-tree -r "$TIP" | grep "^160000 ")" ] && [ "$(files "$READ_MAIN_DIR")" = "$(tree_files "$READ_MAIN_DIR")" ] && [ ! -f "$READ_MAIN_DIR/vendor" ]'
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

# 7b. The refusal names where a stale view points; a plain file at the path is refused cleanly.
mkdir -p "$READ_MAIN_DIR" && echo 'gitdir: /nowhere/.git/worktrees/gone' >"$READ_MAIN_DIR/.git"
run "$WORK/primary"
check "an unregistered view's .git target is shown" '[ "$CODE" -ne 0 ] && grep -Fq "gitdir: /nowhere/.git/worktrees/gone" <<<"$ERR"'
rm -rf "$READ_MAIN_DIR" && echo debris >"$READ_MAIN_DIR"
run "$WORK/primary"
check "a plain file at the view path is refused with a hint" '[ "$CODE" -ne 0 ] && grep -Fq "not a directory" <<<"$ERR" && [ -f "$READ_MAIN_DIR" ]'
rm -f "$READ_MAIN_DIR"

# 8. Concurrent runs after a new commit all succeed and land on the same sha.
advance three
TIP=$(git -C "$WORK/origin.git" rev-parse main)
for i in 1 2 3 4; do d=$WORK/primary; [ $((i % 2)) -eq 0 ] && d=$WORK/feature; (cd "$d" && bash "$SCRIPT" >"$WORK/par$i.out" 2>"$WORK/par$i.err"; echo $? >"$WORK/par$i.code") & done
wait
all=1
for i in 1 2 3 4; do [ "$(cat "$WORK/par$i.code")" = 0 ] && grep -Fq "origin/main  $TIP" "$WORK/par$i.out" || all=0; done
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

# 11. Only a view is ever reset: a worktree with a branch, or the primary checkout, is refused untouched.
echo precious >"$WORK/feature/wip.txt"
FEATURE_BEFORE=$(snapshot "$WORK/feature")
OUT=$(cd "$WORK/primary" && READ_MAIN_DIR=$WORK/feature bash "$SCRIPT" 2>"$WORK/err"); CODE=$?; ERR=$(cat "$WORK/err")
check "a branch worktree is refused" '[ "$CODE" -ne 0 ] && grep -Fq "branch checked out" <<<"$ERR"'
check "the refused worktree keeps its branch and untracked work" '[ "$(snapshot "$WORK/feature")" = "$FEATURE_BEFORE" ] && [ -f "$WORK/feature/wip.txt" ]'
PRIMARY_BEFORE=$(snapshot "$WORK/primary")
OUT=$(cd "$WORK/feature" && READ_MAIN_DIR=$WORK/primary bash "$SCRIPT" 2>"$WORK/err"); CODE=$?; ERR=$(cat "$WORK/err")
check "the primary checkout is refused" '[ "$CODE" -ne 0 ] && grep -Fq "primary checkout" <<<"$ERR"'
check "the refused primary keeps its branch, HEAD and files" '[ "$(snapshot "$WORK/primary")" = "$PRIMARY_BEFORE" ]'

# 12. A fetch refspec that does not track main still yields the real tip.
git clone -q "$WORK/origin.git" "$WORK/odd"
git -C "$WORK/odd" config remote.origin.fetch '+refs/heads/main:refs/heads/elsewhere'
advance five
TIP=$(git -C "$WORK/origin.git" rev-parse main)
OUT=$(cd "$WORK/odd" && READ_MAIN_DIR=$WORK/odd-view bash "$SCRIPT" 2>"$WORK/err")
check "odd refspec still shows the remote tip" 'grep -Fq "origin/main  $TIP" <<<"$OUT"'
# 12b. A second clone cannot adopt the first clone's view; it is told so and nothing is touched.
OUT=$(cd "$WORK/odd" && bash "$SCRIPT" 2>"$WORK/err"); CODE=$?; ERR=$(cat "$WORK/err")
check "a second clone is refused the first clone's view" '[ "$CODE" -ne 0 ] && grep -Fq "not a worktree of this repo" <<<"$ERR"'

# 13. A leaked GIT_DIR does not point the script at another repository.
git init -q -b main "$WORK/other" && git -C "$WORK/other" commit -q --allow-empty -m "other repo"
OUT=$(cd "$WORK/primary" && GIT_DIR=$WORK/other/.git bash "$SCRIPT" 2>"$WORK/err"); CODE=$?
check "leaked GIT_DIR is ignored" '[ "$CODE" -eq 0 ] && grep -Fq "origin/main  $TIP" <<<"$OUT" && ! grep -Fq "other repo" <<<"$OUT"'

# 14. A symlinked view path is recognised as the same worktree on the second run.
ln -s "$WORK" "$WORK/link"
for n in 1 2; do OUT=$(cd "$WORK/primary" && READ_MAIN_DIR=$WORK/link/view-sym bash "$SCRIPT" 2>"$WORK/err"); CODE=$?; done
check "symlinked view path works twice" '[ "$CODE" -eq 0 ] && [ -f "$WORK/view-sym/file.txt" ]'
git -C "$WORK/primary" worktree remove --force "$WORK/view-sym"

# 15. Recreating the view does not unregister another worktree whose directory is briefly missing.
git -C "$WORK/primary" worktree add -q -b away "$WORK/away" >/dev/null 2>&1
mv "$WORK/away" "$WORK/away-moved"
rm -rf "$READ_MAIN_DIR"
run "$WORK/primary"
mv "$WORK/away-moved" "$WORK/away"
check "an unrelated worktree survives the view being recreated" '[ "$CODE" -eq 0 ] && git -C "$WORK/away" status >/dev/null 2>&1'

# 16. Without READ_MAIN_DIR the view lives under $HOME/.t3/worktrees/card-game/main-view.
mkdir "$WORK/home"
OUT=$(cd "$WORK/primary" && env -u READ_MAIN_DIR HOME="$WORK/home" bash "$SCRIPT" 2>"$WORK/err"); CODE=$?
check "default path is under HOME/.t3/worktrees/card-game" '[ "$CODE" -eq 0 ] && grep -Fq "main-view   $WORK/home/.t3/worktrees/card-game/main-view" <<<"$OUT"'

# 17. A reader's git state cannot hide files from the view or wedge it.
git -C "$WORK/seed" pull -q origin main 2>/dev/null; echo more >"$WORK/seed/extra.txt"
git -C "$WORK/seed" add . && git -C "$WORK/seed" commit -q -m "add extra" && git -C "$WORK/seed" push -q origin main
run "$WORK/primary"
git -C "$READ_MAIN_DIR" sparse-checkout set --no-cone file.txt >/dev/null 2>&1
check "the sparse-checkout really narrowed the view first" '[ ! -e "$READ_MAIN_DIR/extra.txt" ]'
run "$WORK/primary"
check "a sparse-checkout narrowing is undone" '[ "$CODE" -eq 0 ] && [ "$(files "$READ_MAIN_DIR")" = "$(tree_files "$READ_MAIN_DIR")" ]'
git -C "$READ_MAIN_DIR" update-index --skip-worktree extra.txt
echo changed >"$WORK/seed/extra.txt" && git -C "$WORK/seed" commit -q -am "touch extra" && git -C "$WORK/seed" push -q origin main
run "$WORK/primary"
check "a skip-worktree flag does not wedge the view" '[ "$CODE" -eq 0 ] && [ "$(cat "$READ_MAIN_DIR/extra.txt")" = changed ] && [ "$(files "$READ_MAIN_DIR")" = "$(tree_files "$READ_MAIN_DIR")" ]'

# 17b. A stale index.lock (a killed git) blocks the reset; the view is rebuilt, with a note.
touch "$(git -C "$READ_MAIN_DIR" rev-parse --absolute-git-dir)/index.lock"
run "$WORK/primary"
check "a stale index.lock triggers a rebuild that succeeds" '[ "$CODE" -eq 0 ] && grep -Fq "rebuilding it" <<<"$ERR" && [ "$(files "$READ_MAIN_DIR")" = "$(tree_files "$READ_MAIN_DIR")" ] && [ -e "$(git -C "$READ_MAIN_DIR" rev-parse --absolute-git-dir)/read-main-view" ]'

# 17c. The same rebuild works when the caller stands inside the view being rebuilt.
touch "$(git -C "$READ_MAIN_DIR" rev-parse --absolute-git-dir)/index.lock"
run "$READ_MAIN_DIR"
check "a rebuild from inside the view succeeds and leaves the view registered" '[ "$CODE" -eq 0 ] && grep -Fq "rebuilding it" <<<"$ERR" && git -C "$WORK/primary" worktree list --porcelain | grep -Fq "worktree $READ_MAIN_DIR" && [ "$(files "$READ_MAIN_DIR")" = "$(tree_files "$READ_MAIN_DIR")" ]'

# 18. A detached worktree the script did not create is refused untouched.
git -C "$WORK/primary" worktree add -q --detach "$WORK/pin" origin/main >/dev/null 2>&1
echo precious >"$WORK/pin/wip.txt"
OUT=$(cd "$WORK/primary" && READ_MAIN_DIR=$WORK/pin bash "$SCRIPT" 2>"$WORK/err"); CODE=$?; ERR=$(cat "$WORK/err")
check "a foreign detached worktree is refused with its files intact" '[ "$CODE" -ne 0 ] && grep -Fq "did not create" <<<"$ERR" && [ -f "$WORK/pin/wip.txt" ]'

# 19. A view nested inside a checkout is refused; running from inside the view prints the path first.
OUT=$(cd "$WORK/primary" && READ_MAIN_DIR=$WORK/primary/nested bash "$SCRIPT" 2>"$WORK/err"); CODE=$?; ERR=$(cat "$WORK/err")
check "a view inside a checkout is refused" '[ "$CODE" -ne 0 ] && grep -Fq "inside the checkout" <<<"$ERR" && [ -z "$(git -C "$WORK/primary" status --porcelain)" ]'
mkdir -p "$READ_MAIN_DIR/untracked-cwd"
OUT=$(cd "$READ_MAIN_DIR/untracked-cwd" && bash "$SCRIPT" 2>/dev/null); CODE=$?
check "stdout starts with the view path even from an untracked directory in the view" '[ "$CODE" -eq 0 ] && [[ $(head -1 <<<"$OUT") == "main-view   "* ]]'
rm -rf "$READ_MAIN_DIR/untracked-cwd"

# 20. A repository a reader cloned inside the view is removed.
git clone -q "$WORK/origin.git" "$READ_MAIN_DIR/vendor-checkout"
run "$WORK/primary"
check "a nested repository is gone after the run" '[ "$CODE" -eq 0 ] && [ ! -e "$READ_MAIN_DIR/vendor-checkout" ] && [ "$(files "$READ_MAIN_DIR")" = "$(tree_files "$READ_MAIN_DIR")" ]'

# 21. A view nested inside a third worktree of the repo is refused too.
OUT=$(cd "$WORK/primary" && READ_MAIN_DIR=$WORK/away/view bash "$SCRIPT" 2>"$WORK/err"); CODE=$?; ERR=$(cat "$WORK/err")
check "a view inside another worktree is refused" '[ "$CODE" -ne 0 ] && grep -Fq "inside the checkout" <<<"$ERR" && [ -z "$(git -C "$WORK/away" status --porcelain)" ]'

# 22. A realistic registry: with dozens of worktrees the view is still recognised on every run
# (`git worktree list | grep -q` under pipefail failed the second run with SIGPIPE).
for i in $(seq 1 70); do git -C "$WORK/primary" worktree add -q --detach "$WORK/many/w$i" origin/main >/dev/null 2>&1; done
for n in 1 2 3; do run "$WORK/primary"; [ "$CODE" -eq 0 ] || break; done
check "the view is recognised repeatedly among 70 other worktrees" '[ "$CODE" -eq 0 ]'
for i in 1 2 3 4; do (cd "$WORK/primary" && bash "$SCRIPT" >/dev/null 2>"$WORK/many$i.err"; echo $? >"$WORK/many$i.code") & done
wait
check "concurrent runs among 70 other worktrees all succeed" '[ "$(cat "$WORK"/many?.code | sort -u | tr -d "\n")" = 0 ]'

# 23. A branch worktree registered at the view path whose directory vanished is not adopted.
git -C "$WORK/primary" worktree add -q -b gone "$WORK/gone-view" >/dev/null 2>&1
rm -rf "$WORK/gone-view"
OUT=$(cd "$WORK/primary" && READ_MAIN_DIR=$WORK/gone-view bash "$SCRIPT" 2>"$WORK/err"); CODE=$?; ERR=$(cat "$WORK/err")
check "a vanished branch worktree is not adopted as a view" '[ "$CODE" -ne 0 ] && grep -Fq "registered on a branch" <<<"$ERR"'

# 24. A worktree nested inside the view is refused, not wiped.
git -C "$WORK/primary" worktree add -q -b inner "$READ_MAIN_DIR/inner" >/dev/null 2>&1
echo wip >"$READ_MAIN_DIR/inner/wip.txt"
run "$WORK/primary"
check "a worktree inside the view is refused with its files intact" '[ "$CODE" -ne 0 ] && grep -Fq "is inside" <<<"$ERR" && [ -f "$READ_MAIN_DIR/inner/wip.txt" ]'
git -C "$WORK/primary" worktree remove --force "$READ_MAIN_DIR/inner"

echo "read-main: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
