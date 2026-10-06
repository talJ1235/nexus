#!/usr/bin/env bash
# R16 session server: the current build on :3100 against a COPY of local.db (r16-smoke.db), mock AI on.
# local.db itself is never written by smoke runs. Usage: bash scripts/serve-r16.sh [--build] [--fresh-copy]
cd "$(dirname "$0")/.."
PORT=${PORT:-3100}
DB=${DB:-r16-smoke.db}
for pid in $(netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && $4 == "LISTENING" {print $5}' | sort -u); do taskkill //F //T //PID "$pid" > /dev/null 2>&1; done
[ "${1:-}" = "--build" ] && { bash scripts/check.sh || exit 1; shift; }
if [ "${1:-}" = "--fresh-copy" ] || [ ! -f "$DB" ]; then cp local.db "$DB"; fi
[ -z "${ADMIN_EMAIL:-}" ] && export ADMIN_EMAIL=$(node -e "process.stdout.write(require('util').parseEnv(require('fs').readFileSync('.env.local','utf8')).ADMIN_EMAIL||'')")
TURSO_DATABASE_URL="file:$DB" npx tsx src/db/migrate.ts > /dev/null || { echo "FAIL migrate"; exit 1; }
powershell.exe -NoProfile -Command "Start-Process cmd -ArgumentList '/c set TURSO_DATABASE_URL=file:$DB&& set NEXUS_AI_MOCK=1&& set AUTH_FULL_LOCAL=0&& ${EXTRA_ENV:-} npx next start -p $PORT > .next\serve.log 2>&1' -WindowStyle Hidden" < /dev/null
for _ in $(seq 1 60); do
  curl -s -o /dev/null --noproxy '*' "http://localhost:$PORT/login" && { echo "OK serving $DB on :$PORT (mock AI)"; exit 0; }
  sleep 0.5
done
echo "FAIL server did not start"; tail -15 .next/serve.log; exit 1
