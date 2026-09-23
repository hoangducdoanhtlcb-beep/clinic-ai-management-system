@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found.
    echo Run FIRST_TIME_SETUP.bat from the project root first.
    pause
    exit /b 1
)

echo ============================================
echo  Clinic AI - Seed full KT2 demo data
echo ============================================
echo.

".venv\Scripts\python.exe" -m app.seed_demo_full
if errorlevel 1 (
    echo.
    echo [ERROR] Full demo seed failed.
    pause
    exit /b 1
)

echo.
echo [OK] Demo data is ready.
pause
