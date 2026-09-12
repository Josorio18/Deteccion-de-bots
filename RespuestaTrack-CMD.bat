@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if "%~1"=="" (
  node server\cmd-detector.js
) else (
  node server\cmd-detector.js "%~1" %2 %3 %4 %5 %6 %7 %8 %9
)
echo.
pause
endlocal
