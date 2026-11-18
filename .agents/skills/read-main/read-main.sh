#!/usr/bin/env bash
# Print the path of a read-only worktree pinned to the tip of origin/main. Run from any
# checkout of this repo; the caller's branch and files are never touched.
# READ_MAIN_DIR overrides the worktree path (the tests use it).
set -euo pipefail

die() {
	echo "read-main: $*" >&2
	exit 1
}

CALLER=$(git rev-parse --show-toplevel 2>/dev/null) || die "run it inside a checkout of this repo"
COMMON=$(git -C "$CALLER" rev-parse --path-format=absolute --git-common-dir)
VIEW=${READ_MAIN_DIR:-$HOME/.t3/worktrees/card-game/main-view}

# One lock per repository: concurrent agents serialise instead of fighting over the ref and the checkout.
exec 9>"$COMMON/read-main.lock"
flock 9

# A stale view is the failure this script exists to prevent: if the fetch fails, fail with it.
git -C "$CALLER" fetch --quiet origin main || die "'git fetch origin main' failed; refusing to show a stale main"
SHA=$(git -C "$CALLER" rev-parse --verify --quiet 'origin/main^{commit}') || die "origin/main does not exist after the fetch"

registered() { git -C "$CALLER" worktree list --porcelain | grep -Fxq "worktree $1"; }

# A registration whose directory is gone blocks `worktree add`; prune it.
[ -d "$VIEW" ] || git -C "$CALLER" worktree prune
if registered "$VIEW" && [ -d "$VIEW" ]; then
	# Read-only means nobody's edits survive: tracked changes, untracked and ignored files all go.
	git -C "$VIEW" checkout --quiet --detach -f "$SHA"
	git -C "$VIEW" clean --quiet -fdx
elif [ -e "$VIEW" ]; then
	die "$VIEW exists but is not a worktree of this repo; move it aside"
else
	mkdir -p "$(dirname "$VIEW")"
	git -C "$CALLER" worktree add --quiet --detach "$VIEW" "$SHA"
fi

echo "main-view   $VIEW"
git -C "$VIEW" log -1 --format='origin/main  %h %s (%cs)' "$SHA"

# Commits on origin/main that a checkout lacks. Silent when it is current.
behind() { # behind <label> <checkout>
	local head n
	head=$(git -C "$2" rev-parse --verify --quiet 'HEAD^{commit}') || return 0
	n=$(git -C "$CALLER" rev-list --count "$head..$SHA")
	[ "$n" -eq 0 ] || echo "behind      $1: $n commit(s) of origin/main missing"
}
PRIMARY=$(git -C "$CALLER" worktree list --porcelain | sed -n '1s/^worktree //p')
[ "$(cd "$CALLER" && pwd -P)" = "$(cd "$VIEW" && pwd -P)" ] || behind "this checkout" "$CALLER"
if [ "$(cd "$PRIMARY" && pwd -P)" != "$(cd "$CALLER" && pwd -P)" ] && [ -d "$PRIMARY" ]; then
	behind "primary checkout" "$PRIMARY"
fi
