#!/usr/bin/env bash
# Issue-event adapter: trust policy always comes from the default branch.
set -euo pipefail
config=$(gh api "repos/$GITHUB_REPOSITORY/contents/.agents/skills/tick/config.json?ref=$DEFAULT_BRANCH" -H 'Accept: application/vnd.github.raw+json')
jq -e '.trustedAuthors | type == "array" and all(.[]; type == "string")' <<< "$config" >/dev/null
author=$(jq -r '.issue.user.login' "$GITHUB_EVENT_PATH")
jq -e --arg author "$author" '.trustedAuthors | index($author) != null' <<< "$config" >/dev/null || exit 0
number=$(jq -er '.issue.number | select(type == "number")' "$GITHUB_EVENT_PATH")
issue=$(gh api "repos/$GITHUB_REPOSITORY/issues/$number")
action=$(jq -r '.action' "$GITHUB_EVENT_PATH")
if [[ "$action" == opened ]]; then
  if jq -e '[.labels[].name | select(. == "ready-for-agent" or . == "needs-triage" or . == "in-progress" or . == "planning" or . == "research" or . == "wontfix" or startswith("wayfinder:"))] | length == 0' <<< "$issue" >/dev/null; then
    gh api "repos/$GITHUB_REPOSITORY/issues/$number/labels" --method POST -f 'labels[]=needs-triage'
  fi
elif [[ "$action" == labeled ]]; then
  if jq -e 'any(.labels[]; .name == "ready-for-agent")' <<< "$issue" >/dev/null; then
    if jq -e 'any(.labels[]; .name == "needs-triage")' <<< "$issue" >/dev/null; then
      if ! gh api "repos/$GITHUB_REPOSITORY/issues/$number/labels/needs-triage" --method DELETE; then
        # Another actor may have removed it after the read. Propagate other errors.
        current=$(gh api "repos/$GITHUB_REPOSITORY/issues/$number")
        jq -e 'all(.labels[]; .name != "needs-triage")' <<< "$current" >/dev/null
      fi
    fi
  fi
fi
