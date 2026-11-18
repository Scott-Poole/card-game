#!/usr/bin/env bash
# Print the path of a read-only worktree pinned to the tip of origin/main. Run from any
# checkout of this repo; only the view worktree is ever reset, never the caller's checkout.
# READ_MAIN_DIR overrides the worktree path (the tests use it).
# Never pipe into `grep -q` here: under pipefail its early exit can fail the pipeline (SIGPIPE).
set -euo pipefail
# A git hook exports GIT_DIR and friends; without this the script would read another repository.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)

die() {
	echo "read-main: $*" >&2
	exit 1
}

CALLER=$(git rev-parse --show-toplevel 2>/dev/null) || die "run it inside a checkout of this repo"
COMMON=$(git -C "$CALLER" rev-parse --path-format=absolute --git-common-dir)
# Git records resolved paths, so compare resolved paths.
VIEW=$(realpath -m "${READ_MAIN_DIR:-$HOME/.t3/worktrees/card-game/main-view}")
worktrees() { git -C "$CALLER" worktree list --porcelain; }
PRIMARY=$(worktrees | sed -n '1s/^worktree //p')

# One lock per repository: concurrent agents serialise instead of fighting over the ref and the checkout.
exec 9>"$COMMON/read-main.lock"
flock -w 120 9 || die "another read-main run has held the lock for 120s; try again"

# A stale view is the failure this script exists to prevent: if the fetch fails, fail with it.
# The explicit refspec moves origin/main whatever the clone's configured refspec says.
git -C "$CALLER" fetch --quiet origin +refs/heads/main:refs/remotes/origin/main ||
	die "'git fetch origin main' failed; refusing to show a stale main"
SHA=$(git -C "$CALLER" rev-parse --verify --quiet 'origin/main^{commit}') || die "origin/main does not exist after the fetch"

registered() { # registered <path>
	local list
	list=$(worktrees)
	grep -Fxq "worktree $1" <<<"$list"
}
registered_branch() { # registered_branch <path>: the branch a registration holds, if any
	local list
	list=$(worktrees)
	awk -v want="worktree $1" '$0 == want {on = 1; next} /^worktree / {on = 0} on && /^branch / {print; exit}' <<<"$list"
}

# Another worktree of this repo nested in the view would be wiped with it; the view nested in
# one would show up there as untracked files.
while read -r other; do
	other=$(realpath -m "$other")
	if [[ $VIEW == "$other"/* ]]; then die "$VIEW is inside the checkout $other; pick a path outside it"; fi
	if [[ $other == "$VIEW"/* ]]; then die "the worktree $other is inside $VIEW; refusing to reset the view around it (if it is stale, run 'git worktree prune')"; fi
done < <(worktrees | sed -n 's/^worktree //p')

marker() { echo "$(git -C "$VIEW" rev-parse --absolute-git-dir)/read-main-view"; }
create() {
	mkdir -p "$(dirname "$VIEW")"
	# -f: a registration whose directory is gone would otherwise block the add.
	git -C "$CALLER" worktree add --quiet --detach -f "$VIEW" "$SHA"
	touch "$(marker)"
}
view_files() { (cd "$VIEW" && find . -path ./.git -prune -o \( -type f -o -type l \) -print0 | sed -z 's|^\./||' | sort -z); }
tip_files() { git -C "$VIEW" ls-tree -r -z "$SHA" | sed -z '/^160000 /d; s/^[^\t]*\t//' | sort -z; }
# The view matches the tip only when nothing hides files from it and nothing extra survives: no
# skip-worktree, assume-unchanged or sparse-checkout bits (git ls-files -v tags every normal entry
# "H"), and exactly the tip's files on disk (a repository a reader cloned inside survives clean).
matches_tip() {
	local flags
	flags=$(git -C "$VIEW" ls-files -v)
	if grep -qv '^H ' <<<"$flags"; then echo "an index flag hides files" >&2; return 1; fi
	cmp -s <(view_files) <(tip_files) || { echo "the files on disk differ from the tip's" >&2; return 1; }
}
reset() {
	git -C "$VIEW" sparse-checkout disable 2>/dev/null || true
	git -C "$VIEW" checkout --quiet --detach -f "$SHA" &&
		git -C "$VIEW" clean --quiet -ffdx >&2 &&
		matches_tip
}

if [ -d "$VIEW" ]; then
	registered "$VIEW" || die "$VIEW exists but is not a worktree of this repo ($(cat "$VIEW/.git" 2>/dev/null || echo 'no .git file')); if it is a leftover, remove it and re-run"
	# The reset discards everything in the directory, so only ever reset a view this script made:
	# never the primary checkout, never a worktree on a branch, never a worktree it did not create.
	[ "$VIEW" != "$(realpath -m "$PRIMARY")" ] || die "$VIEW is the primary checkout; refusing to reset it"
	! git -C "$VIEW" symbolic-ref -q HEAD >/dev/null || die "$VIEW has a branch checked out; refusing to reset it"
	[ -e "$(marker)" ] || die "$VIEW is a worktree this script did not create; refusing to reset it (a leftover from an older read-main? remove it and re-run)"
	# Reader state the reset cannot clear (a stale index.lock, say): rebuild the view, and say so.
	if ! RESET_ERR=$(reset 2>&1); then
		echo "read-main: the reset left the view unclean (${RESET_ERR//$'\n'/ }); rebuilding it" >&2
		git -C "$CALLER" worktree remove --force --force "$VIEW" ||
			die "could not remove $VIEW; delete the directory by hand, run 'git worktree prune', and re-run"
		create
	fi
else
	# A registration whose directory is gone: do not adopt a branch worktree that lost its directory.
	BRANCH=$(registered_branch "$VIEW")
	[ -z "$BRANCH" ] || die "$VIEW is registered on a branch ($BRANCH) but its directory is missing; run 'git worktree prune' if it is abandoned"
	create
fi
# Both paths end here: a view that differs from the tip never leaves with exit 0.
[ "$(git -C "$VIEW" rev-parse HEAD)" = "$SHA" ] || die "$VIEW is not at $SHA after the reset"
matches_tip || die "$VIEW does not match the files of $SHA after the reset; delete it and re-run"

echo "main-view   $VIEW"
git -C "$VIEW" log -1 --format='origin/main  %H %s (%cs)' "$SHA"

# Commits on origin/main that a checkout lacks. Silent when it is current.
behind() { # behind <label> <checkout>
	local head n
	head=$(git -C "$2" rev-parse --verify --quiet 'HEAD^{commit}') || return 0
	n=$(git -C "$CALLER" rev-list --count "$head..$SHA")
	[ "$n" -eq 0 ] || echo "behind      $1: $n commit(s) of origin/main missing"
}
behind "this checkout" "$CALLER"
if [ -d "$PRIMARY" ] && [ "$(realpath -m "$PRIMARY")" != "$(realpath -m "$CALLER")" ]; then
	behind "primary checkout" "$PRIMARY"
fi
