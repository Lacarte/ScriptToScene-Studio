@echo off
title ScriptToScene Studio
echo.
echo   ScriptToScene Studio
echo   ====================
echo.

:: Activate venv
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) else (
    echo   [ERROR] Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

:: Start server
echo   Starting server...
echo.
python app.py %*
pause
