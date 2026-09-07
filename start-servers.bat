@echo off
setlocal
set ROOT=%~dp0

REM Ports come from each tournament's tournament.config.json:
REM   Ravens 2026 Junior Championships  admin 4000  site 3000
REM   Savets 2026                       admin 4001  site 3001
REM The admin server reads its own port from that config; the site preview port is
REM passed to "npx serve" below, so keep these in sync if you change the config.

echo.
echo   Which tournament do you want to work on?
echo.
echo     1^) Ravens 2026 Junior Championships   (admin 4000, site 3000)
echo     2^) Savets 2026                        (admin 4001, site 3001)
echo     3^) Both
echo.
set /p CHOICE=Enter 1, 2 or 3:

if "%CHOICE%"=="1" goto junior
if "%CHOICE%"=="2" goto savets
if "%CHOICE%"=="3" goto both
echo Unrecognised choice "%CHOICE%" - nothing started.
goto end

:junior
call :start_one "Ravens 2026 Junior Championships" "Junior" 4000 3000
goto end

:savets
call :start_one "Savets 2026" "Savets" 4001 3001
goto end

:both
call :start_one "Ravens 2026 Junior Championships" "Junior" 4000 3000
call :start_one "Savets 2026" "Savets" 4001 3001
goto end

:start_one
REM %~1 = folder name, %~2 = window label, %~3 = admin port, %~4 = site port
echo Starting %~2 control panel (http://localhost:%~3) ...
start "%~2 Admin" cmd /k "cd /d "%ROOT%%~1\admin" && npm start"
echo Starting %~2 site preview (http://localhost:%~4) ...
start "%~2 Site Preview" cmd /k "cd /d "%ROOT%%~1\site" && npx serve . -l %~4"
exit /b 0

:end
echo.
echo Servers are starting in their own windows. Close those windows (or Ctrl+C in each) to stop them.
echo.
pause
