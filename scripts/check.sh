#!/usr/bin/env bash
# Quiet pre-commit gate: typecheck, lint, build. Prints only errors (trimmed), or one OK line.
# Keeps agent context small: a green run costs ~1 line instead of hundreds of build-log lines.
set -uo pipefail
cd "$(dirname "$0")/.."
log=$(mktemp)
run() {
  local name=$1; shift
  if ! "$@" >"$log" 2>&1; then
    echo "FAIL $name"
    grep -E "error|Error|✗|warning" "$log" | grep -v "^\s*$" | head -40
    [ "$(grep -cE 'error|Error' "$log")" -eq 0 ] && tail -25 "$log"
    exit 1
  fi
}
run typecheck npx tsc --noEmit --pretty false
run lint npx eslint --quiet .
if [ "${SKIP_BUILD:-}" != "1" ]; then run build npx next build; fi
echo "OK typecheck+lint$([ "${SKIP_BUILD:-}" != "1" ] && echo +build)"
