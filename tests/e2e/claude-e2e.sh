#!/usr/bin/env bash
# End-to-end test against a real Claude Code CLI. Not run in CI: it needs an
# authenticated `claude` and spends model tokens. Run it before a release:
#   npm run test:e2e
# Uses a throwaway repository and BRB_HOME; nothing outside them is touched.
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "$0")/../../plugin" && pwd)"
MODEL="${BRB_E2E_MODEL:-sonnet}"
WORK="$(mktemp -d)"
export BRB_HOME="$WORK/brb-home"
REPO="$WORK/app"
CLI="node $PLUGIN_DIR/skills/brb/scripts/brb.mjs"
pass=0; fail=0
check() { if eval "$2"; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
ask() { (cd "$REPO" && claude -p "$1" --plugin-dir "$PLUGIN_DIR" --model "$MODEL" --allowedTools "Bash Write Edit Read" < /dev/null 2>&1); }

command -v claude >/dev/null || { echo "claude CLI not found"; exit 2; }
claude plugin validate "$PLUGIN_DIR" >/dev/null && echo "PASS  plugin validates" || { echo "FAIL  plugin validate"; exit 1; }

mkdir -p "$REPO" && cd "$REPO" && git init -q && echo "# app" > README.md && git add . \
  && git -c user.name=e2e -c user.email=e2e@example.invalid commit -qm init

echo "--- session 1: work, then natural-language pause"
out1=$(ask "Create greet.py with greet(name) returning 'Hello, <name>!'. Add test_greet.py with plain asserts and run it with python3. Do not add farewell(name) yet; that is the next task: farewell(name) must return 'Bye, <name>!'. Then: I need to leave, be right back.")
echo "$out1" | tail -5
check "manual checkpoint written" "[ \$($CLI list --json | grep -c '\"type\": \"manual\"') -ge 1 ]"
check "checkpoint records next action" "$CLI show | grep -qi farewell"

echo "--- edit while away"
echo "# edited while away" >> "$REPO/greet.py"

echo "--- session 2: /brb:continue in a fresh session"
out2=$(ask "/brb:continue")
echo "$out2" | tail -5
check "farewell implemented after resume" "grep -q 'def farewell' '$REPO/greet.py'"
check "external edit preserved" "grep -q 'edited while away' '$REPO/greet.py'"
check "nothing committed by BRB" "[ \$(git -C '$REPO' rev-list --count HEAD) -eq 1 ]"

echo "--- session 3: /brb status"
out3=$(ask "/brb status")
check "status reports checkpoints" "echo \"\$out3\" | grep -qiE 'manual|checkpoint'"

echo "--- hooks: SessionStart hint and PreCompact"
$CLI save <<< '{"objective":"hint","nextAction":"x"}' >/dev/null
$CLI auto on >/dev/null
out4=$(ask "Quote verbatim any context you received that mentions BRB, or reply NONE.")
check "SessionStart resume hint delivered" "echo \"\$out4\" | grep -q 'has not been resumed'"
sid=$(cd "$REPO" && claude -p "Say hi" --plugin-dir "$PLUGIN_DIR" --model haiku --output-format json < /dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["session_id"])')
(cd "$REPO" && claude -p "/compact" --resume "$sid" --plugin-dir "$PLUGIN_DIR" --model haiku < /dev/null >/dev/null 2>&1) || true
check "PreCompact automatic checkpoint" "$CLI list --json | grep -q '\"trigger\": \"pre-compact\"'"

echo "--- standalone skills install (npx skills add, telemetry off)"
SA="$WORK/standalone"
mkdir -p "$SA" && cd "$SA" && git init -q && echo "# sa" > README.md && git add . \
  && git -c user.name=e2e -c user.email=e2e@example.invalid commit -qm init
DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx -y skills add "$PLUGIN_DIR/.." -a claude-code -y >/dev/null 2>&1
check "helper copied with each skill" "[ -f '$SA/.claude/skills/brb/scripts/brb.mjs' ] && [ -f '$SA/.claude/skills/continue/scripts/brb.mjs' ]"
(cd "$SA" && claude -p "Create util.py with add(a,b). The next task (do not do it now) is sub(a,b) returning a-b. Now: brb, I need to leave." --model "$MODEL" --allowedTools "Bash Write Edit Read Skill" < /dev/null >/dev/null 2>&1)
check "standalone pause saved a checkpoint" "(cd '$SA' && node .claude/skills/brb/scripts/brb.mjs list --json) | grep -q '\"type\": \"manual\"'"
(cd "$SA" && claude -p "/brb continue" --model "$MODEL" --allowedTools "Bash Write Edit Read Skill" < /dev/null >/dev/null 2>&1)
check "standalone resume continued the task" "grep -q 'def sub' '$SA/util.py'"

echo "--- $pass passed, $fail failed (workdir: $WORK)"
[ "$fail" -eq 0 ]
