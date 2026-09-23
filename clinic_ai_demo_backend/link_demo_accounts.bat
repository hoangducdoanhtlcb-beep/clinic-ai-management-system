@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found.
    pause
    exit /b 1
)

echo ============================================
echo  Clinic AI - Link demo doctor/patient users
echo ============================================
echo.

".venv\Scripts\python.exe" -m app.link_demo_accounts
if errorlevel 1 (
    echo.
    echo [ERROR] Linking failed.
    pause
    exit /b 1
)

echo.
pause
