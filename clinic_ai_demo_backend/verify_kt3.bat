@echo off
.venv\Scripts\python.exe -m app.verify_kt3
.venv\Scripts\python.exe -m pytest -q tests
pause
