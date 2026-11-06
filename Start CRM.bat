@echo off
setlocal
rem Double-click to start Siryous CRM on Windows and open it in your browser.
rem
rem The first run installs the app's components and builds it (a few minutes);
rem after that it starts in a few seconds. The server runs in a separate
rem minimised window titled "Siryous CRM server" -- close that window, or run
rem "Stop CRM.bat", to stop it. Everything happens inside this folder.
rem
rem Note: this launcher was written alongside the Mac one but has not been
rem exercised on a Windows machine by its author. If something misbehaves,
rem docs\DEVELOPING.md has the three manual commands it wraps.
cd /d "%~dp0"
title Siryous CRM
set "URL=http://127.0.0.1:3000"
set "NEXT_TELEMETRY_DISABLED=1"

rem Already running? Just open it.
where curl >nul 2>nul
if not errorlevel 1 (
  curl -s -o NUL --max-time 2 %URL%/ && goto :open
)

rem 1. Node.js (the engine the CRM runs on). The installer from nodejs.org is enough.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed yet -- the CRM needs it to run.
  echo Download it from https://nodejs.org ^(click the big LTS button^), run the
  echo installer and click Next until it says Finish. Then double-click Start CRM.bat again.
  echo.
  pause
  exit /b 1
)
rem    Supported versions: 22 to 26, in step with "engines" in package.json.
set "NODE_VERSION="
set "NODE_MAJOR="
for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
for /f "tokens=1 delims=." %%v in ('node -p process.versions.node') do set "NODE_MAJOR=%%v"
if not defined NODE_MAJOR goto :node_ok
if %NODE_MAJOR% LSS 22 (
  echo Your Node.js is too old ^(%NODE_VERSION%^); the CRM needs version 22 to 26.
  goto :node_unsupported
)
if %NODE_MAJOR% GTR 26 (
  echo Your Node.js is newer than the CRM supports yet ^(%NODE_VERSION%^); it needs version 22 to 26.
  goto :node_unsupported
)
goto :node_ok
:node_unsupported
echo Download the LTS version from https://nodejs.org and install it over this one.
echo Then double-click Start CRM.bat again.
echo.
pause
exit /b 1
:node_ok

rem 2. The app's components (node_modules). Reinstall when the lock file changed,
rem    i.e. after an update to the CRM itself.
set "NEED_INSTALL=no"
set "FRESH_INSTALL=no"
if not exist "node_modules\" set "NEED_INSTALL=yes"
if not exist "node_modules\" set "FRESH_INSTALL=yes"
if "%NEED_INSTALL%"=="no" (
  for /f %%i in ('powershell -NoProfile -Command "if (!(Test-Path 'node_modules\.package-lock.json') -or ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules\.package-lock.json').LastWriteTime)) { 'yes' } else { 'no' }"') do set "NEED_INSTALL=%%i"
)
if "%NEED_INSTALL%"=="yes" (
  echo Installing the app's components ^(one-time, about a minute^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Installing failed -- see the messages above. Usually this means no internet connection.
    pause
    exit /b 1
  )
)

rem 2b. Node was updated, or the folder came from another computer: the database
rem     component is compiled for one Node version, so rebuild it to match. A
rem     fresh install has just compiled it for this one; otherwise rebuild when
rem     the recorded version differs or there is no record.
set "NODE_STAMP=node_modules\.crm-node-version"
set "BUILT_FOR="
if exist "%NODE_STAMP%" set /p BUILT_FOR=<"%NODE_STAMP%"
if "%FRESH_INSTALL%"=="yes" goto :stamp
if "%BUILT_FOR%"=="%NODE_VERSION%" goto :stamp
echo Making sure the database component matches Node.js %NODE_VERSION%...
call npm rebuild better-sqlite3
if errorlevel 1 (
  echo.
  echo Rebuilding failed -- see the messages above. Delete the node_modules and .next
  echo folders inside the CRM folder and try again.
  pause
  exit /b 1
)
:stamp
if defined NODE_VERSION (
  >"%NODE_STAMP%" echo %NODE_VERSION%
)

rem 3. Build the production bundle on first run, or when the source changed since.
set "NEED_BUILD=no"
if not exist ".next\BUILD_ID" set "NEED_BUILD=yes"
if "%NEED_BUILD%"=="no" (
  for /f %%i in ('powershell -NoProfile -Command "$b=(Get-Item '.next\BUILD_ID').LastWriteTime; $n=(Get-ChildItem -Path app,lib,components,package.json,package-lock.json,next.config.ts,tsconfig.json,proxy.ts,instrumentation.ts,postcss.config.mjs -Recurse -File -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum; if ($n -gt $b) { 'yes' } else { 'no' }"') do set "NEED_BUILD=%%i"
)
if "%NEED_BUILD%"=="yes" (
  echo Preparing the app ^(a few minutes -- only on first run or after an update^)...
  call npm run build
  if errorlevel 1 (
    echo.
    echo Build failed -- see above.
    pause
    exit /b 1
  )
)

rem 4. Start the server in its own window.
echo Starting Siryous CRM...
if not exist "data\" mkdir data
start "Siryous CRM server" /min cmd /c "set CRM_NO_OPEN=1&& npm start"

rem Wait for it to answer (up to 60 seconds), then open the browser signed in.
where curl >nul 2>nul
if errorlevel 1 (
  timeout /t 8 /nobreak >nul
  goto :open
)
for /l %%i in (1,1,60) do (
  timeout /t 1 /nobreak >nul
  curl -s -o NUL --max-time 2 %URL%/ && goto :open
)
echo.
echo The CRM didn't start. Look at the "Siryous CRM server" window for the error,
echo then see README.md, "Troubleshooting".
pause
exit /b 1

:open
rem The app is locked to this machine with a private token (README, "Signing
rem in"). Opening it with ?token= signs this browser in once. The token sits next
rem to the database, so ask lib\auth.mjs where the server keeps it, with
rem CRM_DB_PATH taken from the environment or from .env.local (read the way
rem Next.js reads it); data\auth-token if that doesn't work.
set "TOKEN_FILE="
for /f "delims=" %%t in ('node -e "require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} }); import('./lib/auth.mjs').then(function (m) { console.log(m.tokenPath()) })" 2^>nul') do set "TOKEN_FILE=%%t"
if not defined TOKEN_FILE set "TOKEN_FILE=data\auth-token"
if not exist "%TOKEN_FILE%" (
  start "" "%URL%"
  goto :opened
)
set /p TOKEN=<"%TOKEN_FILE%"
start "" "%URL%/?token=%TOKEN%"
:opened
echo Running at %URL% -- you can close this window.
echo The server keeps running in the minimised "Siryous CRM server" window; close it or run Stop CRM.bat to stop.
timeout /t 5 >nul
endlocal
