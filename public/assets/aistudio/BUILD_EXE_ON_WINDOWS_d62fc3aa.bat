@echo off
cd /d "%~dp0"
title Build Friends Techno CAD Inspector (.EXE)
echo ============================================================
echo   Friends Techno - 1:1 DXF CAD Auto-Dimensioner .EXE Builder
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed on this PC.
  echo Please install Node.js LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

echo [1/4] Installing project dependencies...
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [2/4] Building production CAD web bundle...
call npm run build
if %errorlevel% neq 0 (
  echo [ERROR] Vite build failed.
  pause
  exit /b 1
)

echo.
echo [3/4] Installing Electron packager (Windows)...
call npm install --save-dev --legacy-peer-deps electron electron-builder
if %errorlevel% neq 0 (
  echo [ERROR] Failed to install electron / electron-builder.
  pause
  exit /b 1
)

echo.
echo [4/4] Packaging Windows .EXE files into release\ folder...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npx electron-builder --config electron-builder.json --win
if %errorlevel% neq 0 (
  echo [ERROR] Electron .EXE packaging failed.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   SUCCESS! Your native Desktop App .EXE files are ready:
echo   - release\win-unpacked\Friends Techno CAD Inspector.exe (Fast Launch)
echo   - release\Friends-Techno-CAD-Inspector-Portable.exe
echo ============================================================
if not exist "%LocalAppData%\FriendsTechnoCAD" mkdir "%LocalAppData%\FriendsTechnoCAD" >nul 2>nul
> "%LocalAppData%\FriendsTechnoCAD\app_dir.txt" (echo(%~dp0)
if exist "%~dp0release\win-unpacked\Friends Techno CAD Inspector.exe" (
  start "" "%~dp0release\win-unpacked\Friends Techno CAD Inspector.exe"
) else (
  start "" "%~dp0release"
)
pause
