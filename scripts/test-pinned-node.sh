#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
VERSION=$(tr -d '[:space:]' < "$ROOT/.nvmrc")

fake_node() { # <dir> <version>
  mkdir -p "$1"
  printf '#!/bin/sh\necho %s\n' "$2" > "$1/node"
  chmod +x "$1/node"
}

# A clean environment: the helper sees only the PATH and NVM_DIR the case gives it.
# `sh -c` hands the helper to bash exactly as an agent shell sources it.
sourced() { # <nvm-dir> <path> -> prints "<status> <PATH after> <node -v after>"
  env -i HOME="$WORK/home" ${1:+NVM_DIR="$1"} PATH="$2" ROOT="$ROOT" \
    bash -c '. "$ROOT/scripts/pinned-node.sh"; status=$?; echo "$status $PATH $(node -v)"'
}

OLD="$WORK/old"
fake_node "$OLD" v1.0.0
BASE="$OLD:/usr/bin:/bin"

# 1. A different node first and the pinned one under NVM_DIR: the pinned node wins.
NVM="$WORK/nvm"
fake_node "$NVM/versions/node/v$VERSION/bin" "v$VERSION"
out=$(sourced "$NVM" "$BASE")
[[ "$out" == "0 $NVM/versions/node/v$VERSION/bin:$BASE v$VERSION" ]] || { echo "FAIL: pinned node not first: $out"; exit 1; }
echo "PASS prepends the pinned node"

# 2. The default location, ${HOME}/.nvm, is used when NVM_DIR is unset.
fake_node "$WORK/home/.nvm/versions/node/v$VERSION/bin" "v$VERSION"
out=$(sourced "" "$BASE")
[[ "$out" == "0 $WORK/home/.nvm/versions/node/v$VERSION/bin:$BASE v$VERSION" ]] || { echo "FAIL: HOME/.nvm default: $out"; exit 1; }
echo "PASS falls back to HOME/.nvm"

# 3. Already matching: PATH is untouched.
MATCH="$WORK/match"
fake_node "$MATCH" "v$VERSION"
out=$(sourced "$NVM" "$MATCH:/usr/bin:/bin")
[[ "$out" == "0 $MATCH:/usr/bin:/bin v$VERSION" ]] || { echo "FAIL: matching node changed PATH: $out"; exit 1; }
echo "PASS leaves a matching node alone"

# 4. Directory absent (CI): PATH is untouched and the status is 0.
out=$(sourced "$WORK/missing" "$BASE")
[[ "$out" == "0 $BASE v1.0.0" ]] || { echo "FAIL: absent directory changed PATH: $out"; exit 1; }
echo "PASS no-op when the nvm directory is absent"

# 5. A strict shell survives sourcing and the helper leaves no function behind.
env -i HOME="$WORK/home" NVM_DIR="$WORK/missing" PATH="$BASE" ROOT="$ROOT" \
  bash -ec '. "$ROOT/scripts/pinned-node.sh"; ! declare -F _pinned_node_main'
echo "PASS safe under set -e and leaves no function"
