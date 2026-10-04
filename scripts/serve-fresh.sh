#!/usr/bin/env bash
# A second local server on a brand-new, empty database (Round 13 A7: empty / new-user states).
# Uses the existing build (run scripts/serve.sh --build first). Usage: bash scripts/serve-fresh.sh  → :3101
# Then: SMOKE_FRESH=http://localhost:3101 npm run smoke
# SEED_PROFILE=sparse → :3102 on its own DB, seeded with scripts/seed-local.mjs's sparse profile (Round 14 A2):
#   SEED_PROFILE=sparse bash scripts/serve-fresh.sh, then SMOKE_SPARSE=http://localhost:3102 npm run smoke
cd "$(dirname "$0")/.."
if [ -n "${SEED_PROFILE:-}" ]; then PORT=${PORT:-3102}; DB="$SEED_PROFILE-smoke.db"; LOG="$SEED_PROFILE-smoke.log"; fi
PORT=${PORT:-3101}
DB=${DB:-fresh-smoke.db}
LOG=${LOG:-fresh-smoke.log}
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; *) WIN= ;; esac
if [ -n "$WIN" ]; then
  for pid in $(netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && $4 == "LISTENING" {print $5}' | sort -u); do taskkill //F //T //PID "$pid" > /dev/null 2>&1; done
fi
rm -f "$DB"
TURSO_DATABASE_URL="file:$DB" npx tsx src/db/migrate.ts > /dev/null || { echo "FAIL migrate"; exit 1; }
if [ -n "${SEED_PROFILE:-}" ]; then TURSO_DATABASE_URL="file:$DB" node scripts/seed-local.mjs || exit 1; fi
if [ -n "$WIN" ]; then
  powershell.exe -NoProfile -Command "Start-Process cmd -ArgumentList '/c set TURSO_DATABASE_URL=file:$DB&& npx next start -p $PORT > $LOG 2>&1' -WindowStyle Hidden" < /dev/null
else
  TURSO_DATABASE_URL="file:$DB" nohup npx next start -p "$PORT" > $LOG 2>&1 < /dev/null &
fi
for _ in $(seq 1 40); do
  curl -s -o /dev/null --noproxy '*' "http://localhost:$PORT/login" && { echo "OK fresh DB serving on :$PORT"; exit 0; }
  sleep 0.5
done
echo "FAIL fresh server did not start"; tail -15 $LOG; exit 1
