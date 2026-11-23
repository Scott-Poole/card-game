# Put the Node version pinned in .nvmrc first on PATH. Source it from the repo, in any
# POSIX shell (bash, zsh, dash):
#   . scripts/pinned-node.sh
# It changes nothing when `node -v` already matches or the nvm directory is absent (CI).
# Written to be sourced, so it never calls `exit` and leaves no variables behind.
_pinned_node_main() {
  local root version bin
  root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  version=$(tr -d '[:space:]' < "$root/.nvmrc" 2>/dev/null) || return 0
  version=${version#v}
  [ -n "$version" ] || return 0
  [ "$(node -v 2>/dev/null)" = "v$version" ] && return 0
  bin="${NVM_DIR:-$HOME/.nvm}/versions/node/v$version/bin"
  [ -d "$bin" ] || return 0
  PATH="$bin:$PATH"
  export PATH
}
_pinned_node_main
unset -f _pinned_node_main
