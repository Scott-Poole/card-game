#!/usr/bin/env bash
# Print the path of a read-only worktree pinned to the tip of origin/main. Run from any
# checkout of this repo; only the view worktree is ever reset, never the caller's checkout.
# READ_MAIN_DIR overrides the worktree path (the tests use it).
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
PRIMARY=$(git -C "$CALLER" worktree list --porcelain | sed -n '1s/^worktree //p')

# One lock per repository: concurrent agents serialise instead of fighting over the ref and the checkout.
exec 9>"$COMMON/read-main.lock"
flock 9

# A stale view is the failure this script exists to prevent: if the fetch fails, fail with it.
# The explicit refspec moves origin/main whatever the clone's configured refspec says.
git -C "$CALLER" fetch --quiet origin +refs/heads/main:refs/remotes/origin/main ||
	die "'git fetch origin main' failed; refusing to show a stale main"
SHA=$(git -C "$CALLER" rev-parse --verify --quiet 'origin/main^{commit}') || die "origin/main does not exist after the fetch"

registered() { git -C "$CALLER" worktree list --porcelain | grep -Fxq "worktree $1"; }

# A view nested inside a checkout would show up as untracked files there.
for checkout in "$CALLER" "$PRIMARY"; do
	checkout=$(realpath -m "$checkout")
	if [[ $VIEW == "$checkout"/* ]]; then die "$VIEW is inside a checkout; pick a path outside it"; fi
done

marker() { echo "$(git -C "$VIEW" rev-parse --absolute-git-dir)/read-main-view"; }
create() {
	mkdir -p "$(dirname "$VIEW")"
	# -f: a registration whose directory is gone would otherwise block the add.
	git -C "$CALLER" worktree add --quiet --detach -f "$VIEW" "$SHA"
	touch "$(marker)"
}
# The tree matches the tip only when nothing hides files from it: no skip-worktree, assume-unchanged
# or sparse-checkout bits (git ls-files -v tags every normal entry "H").
reset() {
	git -C "$VIEW" sparse-checkout disable 2>/dev/null || true
	git -C "$VIEW" checkout --quiet --detach -f "$SHA" &&
		git -C "$VIEW" clean --quiet -fdx >&2 &&
		! git -C "$VIEW" ls-files -v | grep -qv '^H '
}

if [ -d "$VIEW" ]; then
	registered "$VIEW" || die "$VIEW exists but is not a worktree of this repo (another clone's view?); if it is a leftover, remove it and re-run"
	# The reset discards everything in the directory, so only ever reset a view this script made:
	# never the primary checkout, never a worktree on a branch, never a worktree it did not create.
	[ "$VIEW" != "$(realpath -m "$PRIMARY")" ] || die "$VIEW is the primary checkout; refusing to reset it"
	! git -C "$VIEW" symbolic-ref -q HEAD >/dev/null || die "$VIEW has a branch checked out; refusing to reset it"
	[ -e "$(marker)" ] || die "$VIEW is a worktree this script did not create; refusing to reset it"
	# A reader's git state the reset cannot clear (an index flag that blocks checkout): rebuild.
	reset 2>/dev/null || {
		git -C "$CALLER" worktree remove --force "$VIEW"
		create
	}
else
	create
fi
[ "$(git -C "$VIEW" rev-parse HEAD)" = "$SHA" ] || die "$VIEW is not at $SHA after the reset"

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
