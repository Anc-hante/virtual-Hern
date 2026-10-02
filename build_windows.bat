@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================
echo   HERNANDES CHECKOUT - BUILD UNICO EXE
echo ============================================
echo.

where py >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Python nao encontrado.
  echo Instale Python 3.14 64 bits e marque "Add Python to PATH".
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/4] Criando ambiente virtual...
  py -m venv .venv
)

call ".venv\Scripts\activate.bat"

echo [2/4] Instalando dependencias...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo [3/4] Limpando build anterior...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist HernandesCheckout.spec del /q HernandesCheckout.spec

echo [4/4] Gerando um unico HernandesCheckout.exe...
python -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onefile ^
  --windowed ^
  --name HernandesCheckout ^
  --paths "src" ^
  --add-data "src\resources\keyboard_bridge.js;resources" ^
  --collect-all PySide6.QtWebEngineCore ^
  --collect-all PySide6.QtWebEngineWidgets ^
  "src\main.py"

if errorlevel 1 goto :error

echo.
echo ============================================
echo PRONTO!
echo.
echo Arquivo unico gerado:
echo %CD%\dist\HernandesCheckout.exe
echo ============================================
explorer "%CD%\dist"
pause
exit /b 0

:error
echo.
echo [ERRO] Nao foi possivel gerar o EXE.
echo Tire uma foto desta tela ou copie o erro.
pause
exit /b 1
