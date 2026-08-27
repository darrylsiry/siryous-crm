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

rem 2. The app's components (node_modules). Reinstall when the lock file changed,
rem    i.e. after an update to the CRM itself.
set "NEED_INSTALL=no"
if not exist "node_modules\" set "NEED_INSTALL=yes"
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

rem 3. Build the production bundle on first run, or when the source changed since.
set "NEED_BUILD=no"
if not exist ".next\BUILD_ID" set "NEED_BUILD=yes"
if "%NEED_BUILD%"=="no" (
  for /f %%i in ('powershell -NoProfile -Command "$b=(Get-Item '.next\BUILD_ID').LastWriteTime; $n=(Get-ChildItem -Path app,lib,components,package.json,next.config.ts,tsconfig.json -Recurse -File -ErrorAction SilentlyContinue | Measure-Object LastWriteTime -Maximum).Maximum; if ($n -gt $b) { 'yes' } else { 'no' }"') do set "NEED_BUILD=%%i"
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
rem The app is locked to this machine with a private token in data\auth-token
rem (README, "Signing in"). Opening it with ?token= signs this browser in once.
if not exist "data\auth-token" (
  start "" "%URL%"
  goto :opened
)
set /p TOKEN=<data\auth-token
start "" "%URL%/?token=%TOKEN%"
:opened
echo Running at %URL% -- you can close this window.
echo The server keeps running in the minimised "Siryous CRM server" window; close it or run Stop CRM.bat to stop.
timeout /t 5 >nul
endlocal
