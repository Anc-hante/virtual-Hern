@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ================================================
echo   HERNANDES CHECKOUT - ELECTRON
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :node_missing
where npm >nul 2>nul
if errorlevel 1 goto :node_missing

echo [1/3] Instalando dependencias Electron...
call npm install --no-audit --no-fund
if errorlevel 1 goto :error

echo [2/3] Verificando codigo...
call npm run check
if errorlevel 1 goto :error

echo [3/3] Gerando aplicativo Windows (EXE portatil)...
call npm run build
if errorlevel 1 goto :error

if not exist "dist\HernandesCheckout.exe" goto :error
echo.
echo ================================================
echo  PRONTO - ELECTRON
echo  %CD%\dist\HernandesCheckout.exe
echo ================================================
explorer "%CD%\dist"
pause
exit /b 0

:node_missing
echo.
echo [ERRO] E necessario instalar Node.js LTS (inclui npm).
echo https://nodejs.org/
pause
exit /b 1

:error
echo.
echo [ERRO] Falha na compilacao do Electron.
echo Copie a mensagem de erro acima.
pause
exit /b 1
