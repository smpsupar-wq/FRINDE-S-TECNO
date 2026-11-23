@echo off
cd /d "%~dp0"
title Build PAAS WIVER (.EXE)
echo ============================================================
echo   PAAS WIVER - CNC / NX / Delcam Pass Inspector .EXE Builder
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed on this PC.
  echo Please install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

REM Close any running PAAS WIVER instance so release\ files are not locked
taskkill /f /im "PAAS WIVER.exe" >nul 2>nul
taskkill /f /im "PAAS-WIVER-Portable.exe" >nul 2>nul

echo [1/5] Preparing application icon from app_icon\ folder...
call node scripts\sync-icon.cjs
if %errorlevel% neq 0 (
  echo [ERROR] Icon preparation failed. Check app_icon\icon.ico or app_icon\icon.png.
  pause
  exit /b 1
)

echo.
echo [2/5] Installing project dependencies...
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [3/5] Building production PAAS WIVER web bundle...
call npm run build
if %errorlevel% neq 0 (
  echo [ERROR] Vite build failed.
  pause
  exit /b 1
)

echo.
echo [4/5] Installing Electron packager (Windows)...
call npm install --save-dev --legacy-peer-deps electron electron-builder
if %errorlevel% neq 0 (
  echo [ERROR] Failed to install electron / electron-builder.
  pause
  exit /b 1
)

echo.
echo [5/5] Packaging Windows .EXE files into release\ folder...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --config electron-builder.json --win
if %errorlevel% neq 0 (
  echo [ERROR] Electron .EXE packaging failed.
  pause
  exit /b 1
)

REM Create Desktop Shortcut pointing to fast-launch win-unpacked\PAAS WIVER.exe
if exist "%~dp0release\win-unpacked\PAAS WIVER.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\PAAS WIVER.lnk'); $s.TargetPath = '%~dp0release\win-unpacked\PAAS WIVER.exe'; $s.WorkingDirectory = '%~dp0release\win-unpacked'; $s.IconLocation = '%~dp0app_icon\icon.ico,0'; $s.Save()" >nul 2>nul
)

REM Refresh Windows Explorer icon cache
ie4uinit.exe -show >nul 2>nul

echo.
echo ============================================================
echo   SUCCESS! Your native Desktop App .EXE files are ready:
echo   1) Desktop Shortcut created: Desktop\PAAS WIVER.lnk (Fastest Launch)
echo   2) Standalone Portable EXE : release\PAAS-WIVER-Portable.exe
echo      (Copy ONLY PAAS-WIVER-Portable.exe if moving a single file!)
echo   3) Unpacked Fast EXE       : release\win-unpacked\PAAS WIVER.exe
echo      (Do NOT copy win-unpacked\PAAS WIVER.exe alone without its folder)
echo ============================================================
if not exist "%LocalAppData%\PaasWiver" mkdir "%LocalAppData%\PaasWiver" >nul 2>nul
> "%LocalAppData%\PaasWiver\app_dir.txt" (echo(%~dp0)
if exist "%~dp0release" (
  start "" "%~dp0release"
)
pause
