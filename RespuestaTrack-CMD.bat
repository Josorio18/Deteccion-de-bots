@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0server"
if "%~1"=="" (
  node cmd-detector.js
) else (
  node cmd-detector.js "%~1" %2 %3 %4 %5 %6 %7 %8 %9
)
echo.
pause
endlocal
