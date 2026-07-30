@echo off
set ROOT=%~dp0

echo Starting admin control panel (http://localhost:4000)...
start "Ravens Admin" cmd /k "cd /d "%ROOT%admin" && npm start"

echo Starting public site preview (http://localhost:3000)...
start "Ravens Site Preview" cmd /k "cd /d "%ROOT%site" && npx serve . -l 3000"

echo Both servers are starting in their own windows. Close those windows (or Ctrl+C in each) to stop them.
