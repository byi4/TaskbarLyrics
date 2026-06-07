@echo off
:: Native Messaging Host 卸载脚本

echo 正在卸载 Native Messaging Host...

:: 删除注册表项
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\moekoe_taskbar_lyrics" /f 2>nul
reg delete "HKCU\Software\Chromium\NativeMessagingHosts\moekoe_taskbar_lyrics" /f 2>nul

echo Native Messaging Host 已卸载。
pause