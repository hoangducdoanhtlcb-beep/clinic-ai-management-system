@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  Clinic AI - Backend setup
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python was not found in PATH.
    echo Install Python 3.11+ and enable "Add Python to PATH".
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 goto :error
) else (
    echo [1/3] Virtual environment already exists.
)

echo [2/3] Upgrading pip...
".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error

echo [3/3] Installing dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :error

echo.
echo Setup completed successfully.
echo Next: double-click run_backend.bat
pause
exit /b 0

:error
echo.
echo [ERROR] Backend setup failed.
pause
exit /b 1
