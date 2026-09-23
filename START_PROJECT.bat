@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================================
echo  PHONG KHAM ICTU - START PROJECT KT3
echo ==========================================================
echo.

if not exist "clinic_ai_demo_backend\.venv\Scripts\python.exe" (
  echo [INFO] Day co ve la lan chay dau tien.
  echo        Chuyen sang FIRST_TIME_SETUP.bat...
  call "%~dp0FIRST_TIME_SETUP.bat"
  exit /b %errorlevel%
)

where docker >nul 2>&1 || (
  echo [ERROR] Khong tim thay Docker.
  pause
  exit /b 1
)
docker info >nul 2>&1 || (
  echo [INFO] Docker Desktop chua chay. Dang thu khoi dong...
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..60 | ForEach-Object { docker info *> $null; if($LASTEXITCODE -eq 0){$ok=$true; break}; Start-Sleep -Seconds 2 }; if(-not $ok){exit 1}"
  if errorlevel 1 (
    echo [ERROR] Docker Desktop chua san sang. Hay mo Docker Desktop roi chay lai.
    pause
    exit /b 1
  )
)

if not exist "clinic_ai_demo_backend\.env" (
  echo [INFO] Thieu .env. Chuyen sang FIRST_TIME_SETUP.bat...
  call "%~dp0FIRST_TIME_SETUP.bat"
  exit /b %errorlevel%
)

echo [1/4] Khoi dong PostgreSQL...
pushd "clinic_ai_demo_backend"
docker compose up -d || goto :failed_pop
popd

echo [2/4] Khoi dong FastAPI...
start "Phong kham ICTU - Backend" powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location '%~dp0clinic_ai_demo_backend'; .\run_backend.bat"

echo [3/4] Khoi dong Frontend...
start "Phong kham ICTU - Frontend" powershell.exe -NoExit -ExecutionPolicy Bypass -Command "Set-Location '%~dp0clinic_ai_demo'; & '%~dp0clinic_ai_demo_backend\.venv\Scripts\python.exe' -m http.server 5500"

echo [4/4] Cho server san sang...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; 1..30 | ForEach-Object { try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:8000/api/health'; if($r.StatusCode -eq 200){$ok=$true; break} } catch {}; Start-Sleep -Seconds 1 }; if(-not $ok){exit 1}"
if errorlevel 1 (
  echo [WARN] Backend chua phan hoi sau 30 giay. Kiem tra cua so Backend.
) else (
  echo       Backend OK.
)

start "" "http://localhost:5500"

echo.
echo ==========================================================
echo  PROJECT DA KHOI DONG
echo ==========================================================
echo Frontend : http://localhost:5500
echo Backend  : http://127.0.0.1:8000
echo Swagger  : http://127.0.0.1:8000/docs
echo.
echo Giu 2 cua so Backend va Frontend mo khi dang su dung.
timeout /t 3 /nobreak >nul
exit /b 0

:failed_pop
popd
echo [ERROR] Khong khoi dong duoc PostgreSQL.
pause
exit /b 1
