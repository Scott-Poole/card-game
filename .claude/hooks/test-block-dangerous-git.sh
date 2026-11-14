#!/usr/bin/env bash
# Regression test for block-dangerous-git.py. Usage: .claude/hooks/test-block-dangerous-git.sh
# Cases: block-dangerous-git.cases ("want|command"; "\n" in a command becomes a newline;
# a "main:" prefix runs the case from a scratch repo checked out on main).
set -uo pipefail
# A git hook exports GIT_DIR and friends for the real repo; with them set, `git init` below
# re-initialises that repo as bare instead of creating a scratch one. Drop them first.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)

here=$(cd "$(dirname "$0")" && pwd)
hook="$here/block-dangerous-git.py"
feature_repo=$(mktemp -d) main_repo=$(mktemp -d)
trap 'rm -rf "$feature_repo" "$main_repo"' EXIT
git -C "$feature_repo" init -q -b feat/test
git -C "$main_repo" init -q -b main

pass=0 fail=0
while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  cwd=$feature_repo
  if [[ "$line" == main:* ]]; then cwd=$main_repo; line=${line#main:}; fi
  want=${line%%|*} cmd=${line#*|}
  cmd=${cmd//\\n/$'\n'}
  jq -n --arg c "$cmd" --arg d "$cwd" '{tool_input: {command: $c}, cwd: $d}' | "$hook" 2>/dev/null
  case $? in 0) got=allow ;; 2) got=block ;; *) got=crash ;; esac
  if [[ "$got" == "$want" ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1)); printf 'FAIL want=%s got=%s :: %q\n' "$want" "$got" "$cmd"
  fi
done < "$here/block-dangerous-git.cases"

echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
