@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================
echo   RespuestaTrack - iniciando aplicacion
 echo ==========================================
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js no esta instalado.
  echo Instala Node.js LTS desde https://nodejs.org/ y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

if not exist "server\node_modules" (
  echo Instalando dependencias del servidor...
  call npm --prefix server install
  if errorlevel 1 goto :error
)
if not exist "client\node_modules" (
  echo Instalando dependencias del panel...
  call npm --prefix client install
  if errorlevel 1 goto :error
)

echo.
echo Backend: http://localhost:3001
echo Panel:   http://localhost:5173
echo.
start "RespuestaTrack API" cmd /k "cd /d "%~dp0" && npm --prefix server run dev"
timeout /t 2 /nobreak >nul
start "RespuestaTrack Panel" cmd /k "cd /d "%~dp0" && npm --prefix client run dev -- --host 127.0.0.1"
timeout /t 3 /nobreak >nul
start "" http://localhost:5173
exit /b 0

:error
echo.
echo ERROR: No se pudieron instalar las dependencias.
echo Copia el mensaje rojo de esta ventana para revisarlo.
pause
exit /b 1
