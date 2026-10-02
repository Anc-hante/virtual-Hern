@echo off
set "VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\HernandesCheckout.vbs"
if exist "%VBS%" del /q "%VBS%"
echo Inicializacao automatica removida.
pause
