@echo off
setlocal
cd /d "%~dp0"
set "EXE=%~dp0dist\HernandesCheckout\HernandesCheckout.exe"

if not exist "%EXE%" (
  echo O EXE ainda nao existe.
  echo Execute primeiro build_windows.bat.
  pause
  exit /b 1
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\HernandesCheckout.vbs"

> "%VBS%" echo Set shell = CreateObject("WScript.Shell")
>> "%VBS%" echo shell.Run Chr(34) ^& "%EXE%" ^& Chr(34), 0, False

echo Inicializacao automatica ativada.
echo O Hernandes Checkout abrira ao entrar no Windows.
pause
