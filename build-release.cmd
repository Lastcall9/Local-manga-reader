@echo off
setlocal

set "PROJECT=C:\Users\server\local-manga-reader"
set "SDK=C:\Users\server\AppData\Local\Android\Sdk"
set "VERSION=1.0.9-zip-cbz-support"
set "APK_NAME=local-manga-reader-v%VERSION%-arm64.apk"

set "ANDROID_HOME=%SDK%"
set "ANDROID_SDK_ROOT=%SDK%"
set "NODE_ENV=production"
set "PATH=%SDK%\platform-tools;%SDK%\cmdline-tools\latest\bin;%PATH%"

cd /d "%PROJECT%"
call node_modules\.bin\tsc.CMD --noEmit
if not "%ERRORLEVEL%"=="0" (
  exit /b %ERRORLEVEL%
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Content '%PROJECT%\android\gradle.properties') -replace '^reactNativeArchitectures=.*','reactNativeArchitectures=arm64-v8a' | Set-Content '%PROJECT%\android\gradle.properties'; 'sdk.dir=C:\\Users\\server\\AppData\\Local\\Android\\Sdk' | Set-Content '%PROJECT%\android\local.properties'; Remove-Item '%PROJECT%\node_modules\expo-modules-core\android\.cxx' -Recurse -Force -ErrorAction SilentlyContinue"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item '%PROJECT%\android\app\build\generated\assets\react\release\index.android.bundle','%PROJECT%\android\app\build\outputs\apk\release\app-release.apk','%PROJECT%\dist\%APK_NAME%' -Force -ErrorAction SilentlyContinue"

cd /d "%PROJECT%\android"
call gradlew.bat assembleRelease --console=plain
set BUILD_EXIT=%ERRORLEVEL%

if "%BUILD_EXIT%"=="0" (
  if not exist "%PROJECT%\dist" mkdir "%PROJECT%\dist"
  copy /Y "%PROJECT%\android\app\build\outputs\apk\release\app-release.apk" "%PROJECT%\dist\%APK_NAME%" >nul
  echo Built %PROJECT%\dist\%APK_NAME%
)

exit /b %BUILD_EXIT%
