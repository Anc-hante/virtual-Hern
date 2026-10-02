@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  echo Python nao foi encontrado.
  echo Instale Python 3.11 ou 3.12 de https://www.python.org/downloads/windows/
  echo Durante a instalacao marque "Add python.exe to PATH".
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo Criando ambiente virtual...
  py -m venv .venv
)

call ".venv\Scripts\activate.bat"
python -m pip install --upgrade pip
pip install -r requirements.txt

python main.py
if errorlevel 1 pause
