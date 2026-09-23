@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found.
    echo Run setup_backend.bat first.
    pause
    exit /b 1
)

echo ============================================
echo  Clinic AI - Create database tables
echo ============================================
echo.

".venv\Scripts\python.exe" -m app.init_db
if errorlevel 1 (
    echo.
    echo [ERROR] Database table creation failed.
    pause
    exit /b 1
)

echo.
echo All 10 tables are ready.
pause
