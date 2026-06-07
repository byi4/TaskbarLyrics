@echo off
:: Native Messaging Host 安装脚本
:: 将 manifest 注册到 Windows 注册表

setlocal enabledelayedexpansion

:: 获取当前目录
set "SCRIPT_DIR=%~dp0"
set "HOST_DIR=%SCRIPT_DIR%.."
set "MANIFEST_PATH=%HOST_DIR%\native_host\moekoe_taskbar_lyrics.json"

:: 获取插件 Extension ID（需要从 MoeKoeMusic 获取）
:: 临时占位符，需要用户手动替换或从 MoeKoeMusic 读取
set "EXTENSION_ID=EXTENSION_ID_PLACEHOLDER"

:: 更新 manifest 中的 allowed_origins
echo 正在更新 manifest...
powershell -Command "(Get-Content '%MANIFEST_PATH%') -replace 'EXTENSION_ID_PLACEHOLDER', '%EXTENSION_ID%' | Set-Content '%MANIFEST_PATH%'"

:: 注册到 Windows 注册表（Chrome Native Messaging Hosts）
echo 正在注册 Native Messaging Host...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\moekoe_taskbar_lyrics" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

:: Electron 可能也需要注册到以下路径（可选）
:: reg add "HKCU\Software\Chromium\NativeMessagingHosts\moekoe_taskbar_lyrics" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

echo.
echo ========================================
echo Native Messaging Host 安装完成！
echo Manifest 路径: %MANIFEST_PATH%
echo Extension ID: %EXTENSION_ID%
echo ========================================
echo.
echo 请确保:
echo 1. MoeKoeTaskbarLyrics.exe 在插件目录中
echo 2. Chrome Extension 已加载到 MoeKoeMusic
echo 3. Extension ID 已正确填入 manifest
echo.

pause