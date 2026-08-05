@echo off
setlocal

set "PROJECT=C:\Users\junjie.bu\Documents\GitHub\bo-photography"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PROJECT%\scripts\open-local-site.ps1" -NoOpen
if errorlevel 1 (
  pause
  exit /b 1
)

start "" "http://127.0.0.1:4326/editor?view=portrait-layout"
