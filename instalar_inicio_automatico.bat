@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "EXE=%~dp0dist\HernandesCheckout.exe"
set "PASTA_INICIAL=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ATALHO=%PASTA_INICIAL%\HernandesCheckout.lnk"
set "WORKDIR=%~dp0dist"

if /I "%~1"=="remover" goto :remover

if not exist "%EXE%" goto :exe_ausente

echo ================================================
echo   HERNANDES CHECKOUT - INICIO COM O WINDOWS
echo ================================================
echo.
echo Criando atalho na pasta Inicializar deste usuario...
echo Executavel:
echo %EXE%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut($env:ATALHO); $sc.TargetPath = $env:EXE; $sc.WorkingDirectory = $env:WORKDIR; $sc.WindowStyle = 3; $sc.Description = 'Hernandes Checkout'; $sc.Save()"
if errorlevel 1 goto :falha
if not exist "%ATALHO%" goto :falha

echo.
echo Pronto. O Hernandes Checkout abrira maximizado
echo toda vez que este usuario entrar no Windows.
echo.
echo Atalho:
echo %ATALHO%
echo.
echo Para desativar, execute:
echo   instalar_inicio_automatico.bat remover
echo.
pause
exit /b 0

:remover
if not exist "%ATALHO%" goto :atalho_ausente
del /f "%ATALHO%"
if exist "%ATALHO%" goto :falha_remover
echo.
echo Atalho removido. O Hernandes Checkout nao abrira mais
echo sozinho quando este usuario entrar no Windows.
echo.
pause
exit /b 0

:exe_ausente
echo.
echo [ERRO] Executavel nao encontrado:
echo %EXE%
echo.
echo Rode build_windows.bat nesta pasta, ou copie
echo HernandesCheckout.exe para dist\, e tente de novo.
echo.
pause
exit /b 1

:atalho_ausente
echo.
echo Nenhum atalho de inicio automatico foi encontrado.
echo Nada foi removido.
echo.
pause
exit /b 0

:falha
echo.
echo [ERRO] Nao foi possivel criar o atalho de inicio automatico.
echo Verifique se o PowerShell esta disponivel e tente de novo.
echo.
pause
exit /b 1

:falha_remover
echo.
echo [ERRO] Nao foi possivel apagar o atalho:
echo %ATALHO%
echo.
pause
exit /b 1
