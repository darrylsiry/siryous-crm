@echo off
rem Double-click to restart Siryous CRM: stops the running server, then starts
rem it again (rebuilding first if the app was updated). Same as running
rem Stop CRM.bat followed by Start CRM.bat.
rem Untested by the author on a real Windows machine; see docs\DEVELOPING.md.
cd /d "%~dp0"
call "Stop CRM.bat"
timeout /t 3 >nul
call "Start CRM.bat"
