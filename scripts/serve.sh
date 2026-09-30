#!/usr/bin/env bash
# (Re)start the local production server on :3100 and wait until it answers. Usage: scripts/serve.sh [--build]
# Kills any previous next-server by PID (never `pkill -f`, which can match the calling shell).
cd "$(dirname "$0")/.."
PORT=${PORT:-3100}
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; *) WIN= ;; esac
if [ -n "$WIN" ]; then
  # Git Bash can't see native node processes in /proc: kill whatever listens on the port instead.
  for pid in $(netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && $4 == "LISTENING" {print $5}' | sort -u); do
    taskkill //F //T //PID "$pid" > /dev/null 2>&1
  done
else
  for p in /proc/[0-9]*; do
    [ "$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null | cut -c1-11)" = "next-server" ] && kill "${p#/proc/}" 2>/dev/null
  done
fi
if [ "${1:-}" = "--build" ]; then bash scripts/check.sh || exit 1; fi
mkdir -p .next
if [ -n "$WIN" ]; then
  # Detached via PowerShell so the server doesn't hold this shell's stdout open (which hangs callers).
  powershell.exe -NoProfile -Command "Start-Process cmd -ArgumentList '/c npx next start -p $PORT > .next\\serve.log 2>&1' -WindowStyle Hidden" < /dev/null
else
  nohup npx next start -p "$PORT" > .next/serve.log 2>&1 < /dev/null &
fi
for _ in $(seq 1 40); do
  curl -s -o /dev/null --noproxy '*' "http://localhost:$PORT/login" && { echo "OK serving on :$PORT"; exit 0; }
  sleep 0.5
done
echo "FAIL server did not start"; tail -15 .next/serve.log; exit 1
