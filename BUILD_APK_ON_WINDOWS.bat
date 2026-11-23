@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================================
echo   PAAS WIVER Admin - Android .APK Builder
echo ========================================================
echo.

REM 1. Locate JDK 17+ (PATH, JAVA_HOME, or Android Studio JBR)
where java >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\Android\Android Studio\jbr\bin\java.exe" (
        set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
        set "PATH=!JAVA_HOME!\bin;!PATH!"
    ) else (
        echo [ERROR] Java JDK 17 is not installed or not in PATH.
        echo Install Android Studio OR Temurin JDK 17 from https://adoptium.net/
        pause
        exit /b 1
    )
)

REM 2. Locate Android SDK
set "SDK_DIR=%ANDROID_HOME%"
if "%SDK_DIR%"=="" set "SDK_DIR=%ANDROID_SDK_ROOT%"
if "%SDK_DIR%"=="" (
    if exist "%LOCALAPPDATA%\Android\Sdk" set "SDK_DIR=%LOCALAPPDATA%\Android\Sdk"
)
if "%SDK_DIR%"=="" (
    echo [ERROR] Android SDK not found.
    echo Install Android Studio once so it sets up %LOCALAPPDATA%\Android\Sdk,
    echo or set ANDROID_HOME environment variable to your Android SDK folder.
    pause
    exit /b 1
)

echo [1/4] Using Android SDK: %SDK_DIR%
set "ESCAPED_SDK=%SDK_DIR:\=/%"
echo sdk.dir=%ESCAPED_SDK%> android_admin_app\local.properties

REM 3. Find or download Gradle 8.7 locally inside android_admin_app\.gradle_tool
set "GRADLE_CMD="
where gradle >nul 2>nul
if not errorlevel 1 (
    set "GRADLE_CMD=gradle"
) else if exist "android_admin_app\.gradle_tool\gradle-8.7\bin\gradle.bat" (
    set "GRADLE_CMD=%~dp0android_admin_app\.gradle_tool\gradle-8.7\bin\gradle.bat"
) else (
    echo [2/4] Downloading portable Gradle 8.7 one-time...
    mkdir "android_admin_app\.gradle_tool" 2>nul
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-8.7-bin.zip' -OutFile 'android_admin_app\.gradle_tool\gradle.zip'; Expand-Archive -Path 'android_admin_app\.gradle_tool\gradle.zip' -DestinationPath 'android_admin_app\.gradle_tool' -Force; Remove-Item 'android_admin_app\.gradle_tool\gradle.zip'"
    if not exist "android_admin_app\.gradle_tool\gradle-8.7\bin\gradle.bat" (
        echo [ERROR] Failed to download Gradle. Open android_admin_app folder in Android Studio instead.
        pause
        exit /b 1
    )
    set "GRADLE_CMD=%~dp0android_admin_app\.gradle_tool\gradle-8.7\bin\gradle.bat"
)

echo [3/4] Compiling PAAS WIVER Admin APK...
pushd android_admin_app
call "%GRADLE_CMD%" assembleDebug --no-daemon
set "BUILD_ERR=%errorlevel%"
popd

if not "%BUILD_ERR%"=="0" (
    echo.
    echo [ERROR] APK build failed. You can also open the "android_admin_app" folder directly in Android Studio -> Build -> Build APK.
    pause
    exit /b 1
)

if not exist "release" mkdir release
copy /Y "android_admin_app\app\build\outputs\apk\debug\app-debug.apk" "release\PAAS-WIVER-Admin.apk" >nul

echo.
echo [4/4] SUCCESS! Android Admin APK ready at:
echo       release\PAAS-WIVER-Admin.apk
echo.
pause
