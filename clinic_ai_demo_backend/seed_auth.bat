@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found.
    pause
    exit /b 1
)

echo ============================================
echo  Clinic AI - Seed real login accounts
echo ============================================
echo.

".venv\Scripts\python.exe" -m app.seed_auth
if errorlevel 1 (
    echo.
    echo [ERROR] Auth seed failed.
    pause
    exit /b 1
)

echo.
echo Login accounts are ready in PostgreSQL.
pause
