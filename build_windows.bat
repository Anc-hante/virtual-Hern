@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================
echo   HERNANDES CHECKOUT - WEBVIEW2
echo ============================================
echo.

set "DOTNET=%CD%\.dotnet\dotnet.exe"

if not exist "%DOTNET%" (
  where dotnet >nul 2>nul
  if not errorlevel 1 (
    set "DOTNET=dotnet"
  )
)

if not exist "%DOTNET%" if "%DOTNET%"=="%CD%\.dotnet\dotnet.exe" (
  echo [1/4] Baixando .NET SDK 10 localmente...
  if not exist ".dotnet" mkdir ".dotnet"

  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop'; " ^
    "Invoke-WebRequest https://dot.net/v1/dotnet-install.ps1 -OutFile dotnet-install.ps1; " ^
    "& .\dotnet-install.ps1 -Channel 10.0 -InstallDir .\.dotnet -NoPath"

  if errorlevel 1 goto :error

  if exist "dotnet-install.ps1" del /q "dotnet-install.ps1"
)

echo [2/4] Restaurando dependencias...
"%DOTNET%" restore "src\HernandesCheckout\HernandesCheckout.csproj"
if errorlevel 1 goto :error

echo [3/4] Limpando build anterior...
if exist dist rmdir /s /q dist

echo [4/4] Gerando HernandesCheckout.exe...
"%DOTNET%" publish "src\HernandesCheckout\HernandesCheckout.csproj" ^
  -c Release ^
  -r win-x64 ^
  --self-contained true ^
  -o dist ^
  /p:PublishSingleFile=true ^
  /p:IncludeNativeLibrariesForSelfExtract=true ^
  /p:EnableCompressionInSingleFile=true

if errorlevel 1 goto :error

if not exist "dist\HernandesCheckout.exe" goto :error

echo.
echo ============================================
echo PRONTO!
echo.
echo Aplicativo:
echo %CD%\dist\HernandesCheckout.exe
echo ============================================
explorer "%CD%\dist"
pause
exit /b 0

:error
echo.
echo [ERRO] Nao foi possivel gerar o checkout.
echo Tire uma foto desta tela ou copie o erro.
pause
exit /b 1
