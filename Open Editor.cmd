@echo off
setlocal

cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"

echo Starting Bo David local editor...
echo.
echo If the browser does not open automatically, visit:
echo http://localhost:4321/editor
echo.

npm.cmd run editor

echo.
echo Editor has stopped. You can close this window.
pause
