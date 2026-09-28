#!/usr/bin/env bash
# (Re)start the local production server on :3100 and wait until it answers. Usage: scripts/serve.sh [--build]
# Kills any previous next-server by PID (never `pkill -f`, which can match the calling shell).
cd "$(dirname "$0")/.."
PORT=${PORT:-3100}
for p in /proc/[0-9]*; do
  [ "$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null | cut -c1-11)" = "next-server" ] && kill "${p#/proc/}" 2>/dev/null
done
if [ "${1:-}" = "--build" ]; then bash scripts/check.sh || exit 1; fi
mkdir -p .next && nohup npx next start -p "$PORT" > .next/serve.log 2>&1 &
for _ in $(seq 1 40); do
  curl -s -o /dev/null --noproxy '*' "http://localhost:$PORT/login" && { echo "OK serving on :$PORT"; exit 0; }
  sleep 0.5
done
echo "FAIL server did not start"; tail -15 .next/serve.log; exit 1
