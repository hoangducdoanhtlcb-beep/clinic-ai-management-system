@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ==========================================================
echo  CLINIC AI KT3 - FIRST TIME SETUP
echo ==========================================================
echo.

if not exist "clinic_ai_demo_backend\requirements.txt" (
  echo [ERROR] Khong tim thay clinic_ai_demo_backend\requirements.txt
  echo Dat file BAT nay o thu muc goc cua project.
  pause
  exit /b 1
)

where docker >nul 2>&1 || (
  echo [ERROR] Chua tim thay Docker. Hay cai Docker Desktop truoc.
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

set "PY_CMD="
where python >nul 2>&1 && set "PY_CMD=python"
if not defined PY_CMD (where py >nul 2>&1 && set "PY_CMD=py -3")
if not defined PY_CMD (
  echo [ERROR] Chua tim thay Python 3. Hay cai Python va Add Python to PATH.
  pause
  exit /b 1
)

echo [1/8] Tao Python virtual environment...
if not exist "clinic_ai_demo_backend\.venv\Scripts\python.exe" (
  pushd "clinic_ai_demo_backend"
  %PY_CMD% -m venv .venv || goto :failed_pop
  popd
) else echo       Da co .venv - giu nguyen.

echo [2/8] Cai thu vien Python...
pushd "clinic_ai_demo_backend"
".venv\Scripts\python.exe" -m pip install --upgrade pip || goto :failed_pop
".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto :failed_pop

echo [3/8] Tao/cap nhat .env...
if not exist ".env" copy /Y ".env.example" ".env" >nul
findstr /B /C:"AI_API_KEY=" ".env" | findstr /V /R /C:"^AI_API_KEY=$" >nul
if errorlevel 1 (
  echo.
  echo Can Gemini API key de 3 chuc nang AI hoat dong.
  echo Key se KHONG hien tren man hinh va KHONG duoc ghi vao file ZIP mau.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='.env'; $s=Read-Host 'Nhap Gemini API key' -AsSecureString; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {$k=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}; if([string]::IsNullOrWhiteSpace($k)){exit 2}; $c=Get-Content -Raw $p; $c=[regex]::Replace($c,'(?m)^AI_API_KEY=.*$','AI_API_KEY='+$k); Set-Content -Path $p -Value $c -Encoding ASCII" 
  if errorlevel 1 (
    echo [ERROR] Chua nhap Gemini API key. Setup dung de tranh cau hinh AI sai.
    goto :failed_pop
  )
) else echo       .env da co AI_API_KEY - khong ghi de.

echo [4/8] Khoi dong PostgreSQL...
docker compose up -d || goto :failed_pop

echo       Cho PostgreSQL san sang...
set /a WAIT_COUNT=0
:wait_db
set /a WAIT_COUNT+=1
docker compose ps 2>nul | findstr /I "healthy" >nul
if not errorlevel 1 goto :db_ready
if %WAIT_COUNT% GEQ 30 goto :db_ready
timeout /t 2 /nobreak >nul
goto :wait_db

:db_ready
echo [5/8] Khoi tao database...
".venv\Scripts\python.exe" -m app.init_db || goto :failed_pop

echo [6/8] Tao tai khoan demo...
".venv\Scripts\python.exe" -m app.seed_auth || goto :failed_pop

echo [7/8] Tao du lieu demo...
".venv\Scripts\python.exe" -m app.seed_demo_full || goto :failed_pop

echo [8/8] Kiem tra KT3...
".venv\Scripts\python.exe" -m app.verify_kt3 || goto :failed_pop
".venv\Scripts\python.exe" -m pytest -q || goto :failed_pop
popd

echo.
echo ==========================================================
echo  FIRST-TIME SETUP HOAN TAT
echo ==========================================================
echo Tu lan sau chi can bam START_PROJECT.bat.
echo Dang khoi dong project ngay bay gio...
echo.
call "%~dp0START_PROJECT.bat"
exit /b %errorlevel%

:failed_pop
popd
:failed
echo.
echo [ERROR] Setup that bai. Xem thong bao loi o tren.
pause
exit /b 1
