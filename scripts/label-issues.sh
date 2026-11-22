#!/usr/bin/env bash
# Issue-event adapter: trust policy always comes from the default branch.
set -euo pipefail
config=$(gh api "repos/$GITHUB_REPOSITORY/contents/.agents/skills/tick/config.json?ref=$DEFAULT_BRANCH" -H 'Accept: application/vnd.github.raw+json')
author=$(jq -r '.issue.user.login' "$GITHUB_EVENT_PATH")
jq -e --arg author "$author" '.trustedAuthors | index($author) != null' <<< "$config" >/dev/null || exit 0
number=$(jq -er '.issue.number | select(type == "number")' "$GITHUB_EVENT_PATH")
action=$(jq -r '.action' "$GITHUB_EVENT_PATH")
if [[ "$action" == opened ]]; then
  if jq -e '[.issue.labels[].name | select(. == "ready-for-agent" or . == "needs-triage" or . == "in-progress" or . == "planning" or . == "research" or . == "wontfix" or startswith("wayfinder:"))] | length == 0' "$GITHUB_EVENT_PATH" >/dev/null; then
    gh api "repos/$GITHUB_REPOSITORY/issues/$number/labels" --method POST -f 'labels[]=needs-triage'
  fi
elif [[ "$action" == labeled ]]; then
  if jq -e '.label.name == "ready-for-agent" and any(.issue.labels[]; .name == "needs-triage")' "$GITHUB_EVENT_PATH" >/dev/null; then
    gh api "repos/$GITHUB_REPOSITORY/issues/$number/labels/needs-triage" --method DELETE
  fi
fi
