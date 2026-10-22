@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "TABTIP=%CommonProgramFiles%\microsoft shared\ink\TabTip.exe"
set "PASTA_INICIAL=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ATALHO=%PASTA_INICIAL%\TabTip.lnk"
set "WORKDIR=%CommonProgramFiles%\microsoft shared\ink"
set "CHAVE=HKCU\Software\Microsoft\TabletTip\1.7"

echo.%*| findstr /I /C:"--elevado" >nul
if not errorlevel 1 set "JA_ELEVADO=1"

net session >nul 2>&1
if errorlevel 1 goto :sem_admin

if /I "%~1"=="remover" goto :remover
if not exist "%TABTIP%" goto :tabtip_ausente

echo ================================================
echo   HERNANDES CHECKOUT - TECLADO DE TOQUE
echo ================================================
echo.
echo Ativando o teclado de toque deste usuario,
echo mesmo sem o modo tablet...
echo.

reg add "%CHAVE%" /v EnableDesktopModeAutoInvoke /t REG_DWORD /d 1 /f >nul
if errorlevel 1 goto :falha_registro
reg add "%CHAVE%" /v TipbandDesiredVisibility /t REG_DWORD /d 1 /f >nul
if errorlevel 1 goto :falha_registro

echo Servico Touch Keyboard and Handwriting Panel
echo (TabletInputService): inicio automatico e em execucao.
echo.

sc config TabletInputService start= auto
if errorlevel 1 goto :falha_servico
sc query TabletInputService | find /I "RUNNING" >nul
if not errorlevel 1 goto :servico_ok
sc start TabletInputService
if errorlevel 1 goto :falha_servico
:servico_ok

echo.
echo Criando atalho do TabTip na pasta Inicializar...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut($env:ATALHO); $sc.TargetPath = $env:TABTIP; $sc.WorkingDirectory = $env:WORKDIR; $sc.WindowStyle = 7; $sc.Description = 'Teclado de toque do Windows'; $sc.Save()"
if errorlevel 1 goto :falha_atalho
if not exist "%ATALHO%" goto :falha_atalho

echo.
echo Pronto. Ao tocar num campo de texto, o teclado de toque
echo do Windows pode aparecer mesmo fora do modo tablet.
echo O TabTip inicia minimizado no logon deste usuario.
echo.
echo Atalho:
echo %ATALHO%
echo.
echo Para desfazer, execute:
echo   instalar_teclado_virtual.bat remover
echo.
pause
exit /b 0

:remover
echo ================================================
echo   HERNANDES CHECKOUT - REMOVER TECLADO DE TOQUE
echo ================================================
echo.
reg delete "%CHAVE%" /v EnableDesktopModeAutoInvoke /f >nul 2>&1
reg delete "%CHAVE%" /v TipbandDesiredVisibility /f >nul 2>&1
if exist "%ATALHO%" del /f "%ATALHO%"
if exist "%ATALHO%" goto :falha_apagar
echo Servico TabletInputService de volta para inicio manual.
echo.
sc config TabletInputService start= demand
if errorlevel 1 goto :falha_servico_remover
echo.
echo Desfeito para este usuario.
echo As opcoes do teclado de toque sairam do registro,
echo o atalho do TabTip saiu da Inicializar
echo e o servico ficou em inicio manual.
echo.
pause
exit /b 0

:sem_admin
if defined JA_ELEVADO goto :elevacao_negada
echo.
echo O servico do teclado de toque exige administrador.
echo Aceite a janela do Windows para continuar.
echo As opcoes e o atalho valem para o usuario que aprovar.
echo.
set "BAT=%~f0"
set "ARG1=%~1"
powershell -NoProfile -ExecutionPolicy Bypass -Command "if ($env:ARG1) { Start-Process -FilePath $env:BAT -ArgumentList @($env:ARG1, '--elevado') -Verb RunAs } else { Start-Process -FilePath $env:BAT -ArgumentList '--elevado' -Verb RunAs }"
if errorlevel 1 goto :elevacao_negada
exit /b 0

:elevacao_negada
echo.
echo [ERRO] Nao foi possivel executar como administrador.
echo Rode este script com um usuario administrador do totem.
echo.
pause
exit /b 1

:tabtip_ausente
echo.
echo [ERRO] Teclado de toque do Windows nao encontrado:
echo %TABTIP%
echo.
pause
exit /b 1

:falha_registro
echo.
echo [ERRO] Nao foi possivel gravar as opcoes do teclado de toque.
echo.
pause
exit /b 1

:falha_servico
echo.
echo [ERRO] Nao foi possivel deixar o servico TabletInputService
echo automatico e iniciado.
echo.
pause
exit /b 1

:falha_atalho
echo.
echo [ERRO] Nao foi possivel criar o atalho do TabTip:
echo %ATALHO%
echo.
pause
exit /b 1

:falha_apagar
echo.
echo [ERRO] Nao foi possivel apagar o atalho:
echo %ATALHO%
echo.
pause
exit /b 1

:falha_servico_remover
echo.
echo [ERRO] Nao foi possivel voltar o servico TabletInputService
echo para inicio manual.
echo.
pause
exit /b 1
