#!/usr/bin/env bash
# A second local server on a brand-new, empty database (Round 13 A7: empty / new-user states).
# Uses the existing build (run scripts/serve.sh --build first). Usage: bash scripts/serve-fresh.sh  → :3101
# Then: SMOKE_FRESH=http://localhost:3101 npm run smoke
cd "$(dirname "$0")/.."
PORT=${PORT:-3101}
DB=".next/fresh.db"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WIN=1 ;; *) WIN= ;; esac
if [ -n "$WIN" ]; then
  for pid in $(netstat -ano | awk -v p=":$PORT" '$2 ~ p"$" && $4 == "LISTENING" {print $5}' | sort -u); do taskkill //F //T //PID "$pid" > /dev/null 2>&1; done
fi
rm -f "$DB"
TURSO_DATABASE_URL="file:$DB" npx tsx src/db/migrate.ts > /dev/null || { echo "FAIL migrate"; exit 1; }
if [ -n "$WIN" ]; then
  powershell.exe -NoProfile -Command "Start-Process cmd -ArgumentList '/c set TURSO_DATABASE_URL=file:$DB&& npx next start -p $PORT > .next\\serve-fresh.log 2>&1' -WindowStyle Hidden" < /dev/null
else
  TURSO_DATABASE_URL="file:$DB" nohup npx next start -p "$PORT" > .next/serve-fresh.log 2>&1 < /dev/null &
fi
for _ in $(seq 1 40); do
  curl -s -o /dev/null --noproxy '*' "http://localhost:$PORT/login" && { echo "OK fresh DB serving on :$PORT"; exit 0; }
  sleep 0.5
done
echo "FAIL fresh server did not start"; tail -15 .next/serve-fresh.log; exit 1
