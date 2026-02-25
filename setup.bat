@echo off
title ScriptToScene Studio - Setup
echo.
echo   ScriptToScene Studio - Setup
echo   ============================
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo   [ERROR] Python not found. Install Python 3.10+ first.
    pause
    exit /b 1
)

:: Create venv if missing
if not exist "venv" (
    echo   Creating virtual environment...
    python -m venv venv
    echo   Virtual environment created.
) else (
    echo   Virtual environment already exists.
)

:: Activate and install
echo   Installing dependencies...
call venv\Scripts\activate.bat
pip install -r requirements.txt --quiet
echo.
echo   Setup complete!
echo   Run runner.bat to start the server.
echo.
pause
