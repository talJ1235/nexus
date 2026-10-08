#!/usr/bin/env bash
# Smoke server (R17 0.3): the current build on :3100 against a FRESH smoke.db every run — migrated, then seeded with the
# demo catalog (seed-local) and the worst-case spaces (seed-worst) — mock AI on. Each smoke run starts from the same
# data, so steps like "partial move splits the item" don't depend on what earlier runs left behind.
#   bash scripts/serve-smoke.sh [--build]      then  SMOKE_WRITE=1 npm run smoke  (add SMOKE_MOBILE=1 for the phone)
cd "$(dirname "$0")/.."
PORT=${PORT:-3100}
DB=${DB:-smoke.db}
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; *) WIN= ;; esac
if [ -n "$WIN" ]; then
  for pid in $(netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && $4 == "LISTENING" {print $5}' | sort -u); do taskkill //F //T //PID "$pid" > /dev/null 2>&1; done
else
  for p in /proc/[0-9]*; do [ "$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null | cut -c1-11)" = "next-server" ] && kill "${p#/proc/}" 2>/dev/null; done
fi
[ "${1:-}" = "--build" ] && { bash scripts/check.sh || exit 1; shift; }
rm -f "$DB" "$DB-journal" "$DB-wal" "$DB-shm"
[ -z "${ADMIN_EMAIL:-}" ] && [ -f .env.local ] && export ADMIN_EMAIL=$(node -e "process.stdout.write(require('util').parseEnv(require('fs').readFileSync('.env.local','utf8')).ADMIN_EMAIL||'')")
export TURSO_DATABASE_URL="file:$DB"
npx tsx src/db/migrate.ts > /dev/null || { echo "FAIL migrate"; exit 1; }
node scripts/seed-local.mjs > /dev/null || { echo "FAIL seed-local"; exit 1; }
node scripts/seed-worst.mjs > /dev/null || { echo "FAIL seed-worst"; exit 1; }
mkdir -p .next
if [ -n "$WIN" ]; then
  powershell.exe -NoProfile -Command "Start-Process cmd -ArgumentList '/c set TURSO_DATABASE_URL=file:$DB&& set NEXUS_AI_MOCK=1&& set AUTH_FULL_LOCAL=0&& ${EXTRA_ENV:-} npx next start -p $PORT > .next\serve.log 2>&1' -WindowStyle Hidden" < /dev/null
else
  NEXUS_AI_MOCK=1 AUTH_FULL_LOCAL=0 nohup npx next start -p "$PORT" > .next/serve.log 2>&1 < /dev/null &
fi
for _ in $(seq 1 60); do
  curl -s -o /dev/null --noproxy '*' "http://localhost:$PORT/login" && { echo "OK serving a fresh $DB on :$PORT (mock AI)"; exit 0; }
  sleep 0.5
done
echo "FAIL server did not start"; tail -15 .next/serve.log; exit 1
