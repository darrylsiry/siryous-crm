@echo off
rem Double-click to stop the Siryous CRM server that Start CRM.bat started.
rem (Closing the minimised "Siryous CRM server" window does the same thing.)
rem Your data is safe either way -- stopping just closes the app.
rem Untested by the author on a real Windows machine; see docs\DEVELOPING.md.
setlocal
set "FOUND=no"
rem Only stop the CRM: check it is the CRM answering (it identifies itself at
rem /api/health) before ending the 127.0.0.1:3000 listener. Another program
rem on port 3000 is left alone.
set "IS_CRM=no"
where curl >nul 2>nul
if errorlevel 1 (
  set "IS_CRM=yes"
) else (
  curl -s --max-time 2 http://127.0.0.1:3000/api/health 2>nul | findstr /c:"siryous-crm" >nul && set "IS_CRM=yes"
)
if "%IS_CRM%"=="yes" (
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"127.0.0.1:3000 .*LISTENING"') do (
    taskkill /PID %%p /F >nul 2>nul && set "FOUND=yes"
  )
)
if "%FOUND%"=="yes" (
  echo Siryous CRM stopped.
) else (
  echo Siryous CRM wasn't running.
)
echo You can close this window. Double-click Start CRM.bat to start it again.
timeout /t 5 >nul
endlocal
