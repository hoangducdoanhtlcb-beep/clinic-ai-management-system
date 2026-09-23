@echo off
setlocal
title Clinic AI KT3 - Make Portable ZIP

set "ROOT=%~dp0"
set "OUT=%ROOT%clinic_ai_demo_KT3.zip"
set "STAGE=%TEMP%\clinic_ai_demo_KT3_pack_%RANDOM%"

echo ==========================================
echo   Clinic AI KT3 - Create submission ZIP
echo ==========================================
echo.
echo Source: %ROOT%
echo Output: %OUT%
echo.

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%" || goto :error

echo [1/3] Copying project files...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$src=[IO.Path]::GetFullPath('%ROOT%'); $dst=[IO.Path]::GetFullPath('%STAGE%');" ^
 "$excludeDirs=@('.venv','__pycache__','.pytest_cache','.git','node_modules');" ^
 "$excludeFiles=@('.env','clinic_ai_demo_KT3.zip');" ^
 "Get-ChildItem -LiteralPath $src -Force | Where-Object { $excludeDirs -notcontains $_.Name -and $excludeFiles -notcontains $_.Name } | ForEach-Object {" ^
 "  if ($_.PSIsContainer) {" ^
 "    Copy-Item -LiteralPath $_.FullName -Destination $dst -Recurse -Force;" ^
 "  } else { Copy-Item -LiteralPath $_.FullName -Destination $dst -Force }" ^
 "};" ^
 "Get-ChildItem -LiteralPath $dst -Recurse -Force | Where-Object {" ^
 "  $_.Name -eq '.env' -or $_.Name -eq '.venv' -or $_.Name -eq '__pycache__' -or $_.Name -eq '.pytest_cache' -or $_.Name -eq '.git' -or $_.Name -eq 'node_modules' -or $_.Extension -eq '.pyc'" ^
 "} | Sort-Object { $_.FullName.Length } -Descending | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue"
if errorlevel 1 goto :error

echo [2/3] Checking sensitive files...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
 "$bad=Get-ChildItem -LiteralPath '%STAGE%' -Recurse -Force | Where-Object { $_.Name -eq '.env' -or $_.Name -eq '.venv' }; if($bad){$bad | ForEach-Object {Write-Host $_.FullName}; exit 2}"
if errorlevel 1 (
    echo [ERROR] Sensitive files are still present. ZIP was NOT created.
    goto :cleanup_error
)

echo [3/3] Creating clinic_ai_demo_KT3.zip...
if exist "%OUT%" del /f /q "%OUT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%OUT%' -Force"
if errorlevel 1 goto :error

rmdir /s /q "%STAGE%" >nul 2>&1

echo.
echo ==========================================
echo   DONE
echo ==========================================
echo Created:
echo %OUT%
echo.
echo Excluded: .env, .venv, API-key file, caches, .git, node_modules.
echo.
pause
exit /b 0

:error
echo.
echo [ERROR] Could not create portable ZIP.
:cleanup_error
if exist "%STAGE%" rmdir /s /q "%STAGE%" >nul 2>&1
pause
exit /b 1
