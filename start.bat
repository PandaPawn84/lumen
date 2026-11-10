@echo off
rem Start Lumen on Windows. Needs Python 3.10+ from python.org (tick "Add to PATH").
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Setting up Lumen ^(first launch only^)...
  py -3 -m venv .venv || python -m venv .venv || (echo Lumen needs Python 3.10 or newer from python.org & pause & exit /b 1)
  .venv\Scripts\python -m pip install --quiet --upgrade pip
  .venv\Scripts\python -m pip install --quiet -r requirements.txt
)
.venv\Scripts\python -m lumen %*
