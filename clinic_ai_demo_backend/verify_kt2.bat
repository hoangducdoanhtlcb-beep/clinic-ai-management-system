@echo off
setlocal
cd /d "%~dp0"
".venv\Scripts\python.exe" -m app.verify_kt2
pause
