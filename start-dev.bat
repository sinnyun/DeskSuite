@echo off
setlocal
title DeskSuite Dev
cd /d "%~dp0"

rem Bootstrap into a persistent cmd window so errors never close it
if not "%~1"=="run" (
  start "DeskSuite Dev" cmd /k "%~f0" run
  exit /b
)

echo ================================================
echo   DeskSuite Dev Launcher
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :fail_node

echo [1/4] Checking plugin architecture conventions ...
call node scripts/guard.mjs
if errorlevel 1 goto :fail_guard
echo.

echo [2/4] Updating dependencies (npm install) ...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail_install
echo.

echo [3/4] Freeing dev port 5173 ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Write-Host ('  killing PID ' + $_); Stop-Process -Id $_ -Force }"
echo   (nothing to kill if port was already free)
echo.

echo [4/4] Starting dev server (hot reload enabled) ...
call npm run dev
if errorlevel 1 goto :fail_dev

echo.
echo Dev session ended (app window closed).
pause
exit /b 0

:fail_node
echo [FAILED] Step 1: Node.js not found in PATH. Install Node.js first.
goto :fail

:fail_guard
echo [FAILED] Step 1: architecture guard failed. Fix the violations above
echo          before starting dev. See AGENTS.md for plugin rules.
goto :fail

:fail_install
echo [FAILED] Step 2: npm install exited with code %errorlevel%.
goto :fail

:fail_dev
echo [FAILED] Step 4: dev server exited with code %errorlevel%.
goto :fail

:fail
echo.
echo ================================================
echo   Launch FAILED. See error above. Window stays open.
echo ================================================
pause
exit /b 1
