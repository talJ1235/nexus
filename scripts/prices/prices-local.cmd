@echo off
rem R19 B0 — the chains whose portals don't answer GitHub's servers, fetched on Tal's PC (Israel) and written to the
rem prod DB. Needs Python 3.12 (py -3.12) and, in .env.local, PRICES_TURSO_DATABASE_URL + PRICES_TURSO_AUTH_TOKEN
rem (the prod DB, read-write). Windows Task Scheduler (once, as Tal):
rem   schtasks /Create /TN "Nexus prices" /SC HOURLY /MO 3 /ST 05:50 /TR "\"%~f0\"" /F
rem Usage: prices-local.cmd [nightly|intraday]   (no argument: nightly before 07:00, else intraday)
setlocal
cd /d "%~dp0\..\.."
set CHAINS=HAZI_HINAM,NETIV_HASED,SUPER_PHARM
set MODE=%1
if "%MODE%"=="" (
  for /f %%h in ('powershell -NoProfile -Command "(Get-Date).Hour"') do if %%h LSS 7 (set MODE=nightly) else (set MODE=intraday)
)
set VENV=%LOCALAPPDATA%\nexus-prices\venv
if not exist "%VENV%\Scripts\python.exe" (
  py -3.12 -m venv "%VENV%" || exit /b 1
  "%VENV%\Scripts\python.exe" -m pip install -q -r scripts\prices\requirements.txt || exit /b 1
)
set DUMP=%LOCALAPPDATA%\nexus-prices\dump
for /f "usebackq tokens=1,* delims==" %%a in (".env.local") do (
  if "%%a"=="PRICES_TURSO_DATABASE_URL" set TURSO_DATABASE_URL=%%b
  if "%%a"=="PRICES_TURSO_AUTH_TOKEN" set TURSO_AUTH_TOKEN=%%b
)
if "%TURSO_DATABASE_URL%"=="" echo PRICES_TURSO_DATABASE_URL is not in .env.local - a dry run & set PRICES_DRY_DB=%LOCALAPPDATA%\nexus-prices\dry.db
if "%MODE%"=="nightly" (
  "%VENV%\Scripts\python.exe" scripts\prices\fetch.py --out "%DUMP%" --chains %CHAINS% --types Stores --limit 1 --timeout 300
  call npx tsx scripts\prices\ingest.mts --dump "%DUMP%"
  "%VENV%\Scripts\python.exe" scripts\prices\fetch.py --out "%DUMP%" --chains %CHAINS% --types PriceFull,PromoFull --since-hours 30 --timeout 900
) else (
  "%VENV%\Scripts\python.exe" scripts\prices\fetch.py --out "%DUMP%" --chains %CHAINS% --types Price,Promo --since-hours 4 --timeout 600
)
call npx tsx scripts\prices\ingest.mts --dump "%DUMP%" >> "%LOCALAPPDATA%\nexus-prices\last-run.log" 2>&1
del /s /q "%DUMP%\*.xml" "%DUMP%\*.gz" >nul 2>&1
endlocal
