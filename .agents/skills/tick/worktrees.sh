#!/usr/bin/env bash
# The sanctioned branch force-delete path; proof and mutations live in the CLI.
set -euo pipefail
exec python3 "$(dirname "$0")/worktrees.py" "$@"
