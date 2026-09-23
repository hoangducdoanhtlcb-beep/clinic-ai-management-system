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
echo  Clinic AI - FastAPI Backend
echo ============================================
echo Backend: http://127.0.0.1:8000
echo Swagger: http://127.0.0.1:8000/docs
echo Health : http://127.0.0.1:8000/api/health
echo.
echo Press CTRL+C to stop.
echo.

".venv\Scripts\python.exe" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

pause
