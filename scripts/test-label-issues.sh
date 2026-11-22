#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/bin"
export CALLS="$WORK/calls" CONFIG="$ROOT/.agents/skills/tick/config.json"
cat > "$WORK/bin/gh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == "api repos/test/repo/contents/.agents/skills/tick/config.json?ref=main -H Accept: application/vnd.github.raw+json" ]]; then
  cat "$CONFIG"
elif [[ "$*" == api\ repos/test/repo/issues/42/labels* ]]; then
  printf '%s\n' "$*" >> "$CALLS"
else
  echo "Unexpected gh invocation: $*" >&2
  exit 1
fi
FAKE
chmod +x "$WORK/bin/gh"
export PATH="$WORK/bin:$PATH" GITHUB_REPOSITORY=test/repo DEFAULT_BRANCH=main
run_case() {
  local action=$1 author=$2 labels=$3 added=$4 expected=$5
  : > "$CALLS"
  jq -n --arg action "$action" --arg author "$author" --argjson labels "$labels" --arg added "$added" \
    '{action:$action, label:{name:$added}, issue:{number:42,user:{login:$author},labels:($labels|map({name:.})),title:"$(touch SHOULD_NOT_EXIST); `id`"}}' > "$WORK/event.json"
  (cd "$WORK"; GITHUB_EVENT_PATH="$WORK/event.json" bash "$ROOT/scripts/label-issues.sh")
  [[ ! -e "$WORK/SHOULD_NOT_EXIST" ]] || { echo "FAIL: title executed"; exit 1; }
  [[ "$(cat "$CALLS")" == "$expected" ]] || { echo "FAIL: $action $author $labels"; cat "$CALLS"; exit 1; }
}
run_case opened Scott-Poole '[]' '' 'api repos/test/repo/issues/42/labels --method POST -f labels[]=needs-triage'
echo 'PASS trusted opened without labels'

run_case opened Scott-Poole '["ready-for-agent"]' '' ''
run_case opened Scott-Poole '["planning"]' '' ''
run_case opened stranger '[]' '' ''
run_case labeled Scott-Poole '["needs-triage","ready-for-agent"]' ready-for-agent 'api repos/test/repo/issues/42/labels/needs-triage --method DELETE'
run_case labeled stranger '["needs-triage","ready-for-agent"]' ready-for-agent ''
for label in needs-triage in-progress research wontfix wayfinder:spec; do
  run_case opened Scott-Poole "[\"$label\"]" '' ''
done
run_case labeled Scott-Poole '["needs-triage"]' enhancement ''
run_case labeled Scott-Poole '["ready-for-agent"]' ready-for-agent ''
echo 'PASS exclusions, untrusted authors, label transitions, shell-metacharacter title'
