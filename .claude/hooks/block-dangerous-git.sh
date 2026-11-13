#!/usr/bin/env bash
# PreToolUse(Bash) guardrail. Tailored from mattpocock/skills git-guardrails-claude-code:
# feature-branch pushes are allowed (agents open PRs); anything that rewrites or discards
# history, or lands on main without a PR, is blocked.
set -uo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")

block() {
  echo "BLOCKED by .claude/hooks/block-dangerous-git.sh: $1. Ask Scott to run it, or find a non-destructive route." >&2
  exit 2
}

re() { grep -qE -- "$1" <<<"$cmd"; }

re 'git[[:space:]].*reset[[:space:]].*--hard' && block "git reset --hard discards work"
re 'git[[:space:]].*clean[[:space:]]+-[a-zA-Z]*f' && block "git clean -f deletes untracked files"
re 'git[[:space:]].*branch[[:space:]].*(-D|--delete[[:space:]]+--force)' && block "git branch -D drops unmerged commits"
re 'git[[:space:]].*(checkout|restore)[[:space:]]+(--[[:space:]]+)?\.([[:space:]]|$|;|&)' && block "discarding all working-tree changes"
re 'gh[[:space:]]+repo[[:space:]]+delete' && block "deleting the repository"

if re 'git[[:space:]]+([^;&|]*[[:space:]])?push'; then
  re 'push[^;&|]*[[:space:]](-f|--force)([[:space:]]|$)' && block "force push (use --force-with-lease on a feature branch)"
  re 'push[^;&|]*([[:space:]:+]|HEAD:)(main|master)([[:space:]]|$|;|&)' && block "pushing to main; land changes through a PR"
  branch=$(git -C "${cwd:-.}" branch --show-current 2>/dev/null)
  if [[ "$branch" == "main" || "$branch" == "master" ]] && ! re 'push[^;&|]*[[:space:]]origin[[:space:]]+[^-[:space:]]'; then
    block "bare push while on $branch; land changes through a PR"
  fi
fi

exit 0
