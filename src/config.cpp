// SPDX-License-Identifier: GPL-2.0
// config.cpp - 配置管理实现
#include "config.h"

#include <nlohmann/json.hpp>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <algorithm>
#include <shlobj.h>
#include <windows.h>

namespace moekoe {

// ── 本地辅助函数：UTF-8 ↔ 宽字符转换 ──
static std::string WideToUtf8(const std::wstring& ws) {
    if (ws.empty()) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), -1, nullptr, 0, nullptr, nullptr);
    if (n <= 0) return {};
    std::string s(n - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), -1, &s[0], n, nullptr, nullptr);
    return s;
}

// ── 智能选择自启 exe 路径 ──
// 优先使用 MoeKoeMusic 实际加载的最终路径（moeKoe-taskbar-lyrics 下的 exe），
// 而非当前进程的临时路径（如 VS 调试器路径）。
// 这样无论从哪个目录启动 EXE，注册表/schtasks/启动文件夹写入的都是正确路径。
static std::wstring ResolveAutoStartExePath() {
    wchar_t currentPath[MAX_PATH] = {0};
    ::GetModuleFileNameW(nullptr, currentPath, MAX_PATH);

    // 当前路径
    std::wstring cur(currentPath);
    // 当前路径的目录
    std::wstring curDir = cur;
    size_t pos = curDir.find_last_of(L'\\');
    if (pos != std::wstring::npos) curDir = curDir.substr(0, pos);

    // 备选1：当前目录的父目录下找 "moeKoe-taskbar-lyrics\MoeKoeTaskbarLyrics.exe"
    if (pos != std::wstring::npos) {
        std::wstring parentDir = curDir;
        size_t p2 = parentDir.find_last_of(L'\\');
        if (p2 != std::wstring::npos) parentDir = parentDir.substr(0, p2);
        std::wstring candidate = parentDir + L"\\moeKoe-taskbar-lyrics\\MoeKoeTaskbarLyrics.exe";
        if (::GetFileAttributesW(candidate.c_str()) != INVALID_FILE_ATTRIBUTES) {
            // 找到了——这就是生产路径
            // 但只有当当前路径不在 moeKoe-taskbar-lyrics 下时才覆盖
            if (curDir.find(L"moeKoe-taskbar-lyrics") == std::wstring::npos) {
                return candidate;
            }
        }
    }

    // 备选2：当前路径
    return cur;
}

namespace {

void ConfigDebugLog(const char* fmt, ...) {
    char modulePath[MAX_PATH] = {};
    GetModuleFileNameA(nullptr, modulePath, MAX_PATH);
    char* lastSlash = strrchr(modulePath, '\\');
    if (lastSlash) *lastSlash = '\0';
    std::string logPath = std::string(modulePath) + "\\debug.log";
    FILE* f = fopen(logPath.c_str(), "a");
    if (!f) return;
    va_list args;
    va_start(args, fmt);
    vfprintf(f, fmt, args);
    va_end(args);
    fclose(f);
}

} // namespace

using json = nlohmann::json;

Config::Config() = default;

std::string Config::GetConfigPath() {
    // 优先读取 %APPDATA%\MoeKoeTaskbarLyrics\config.json
    char appdata[MAX_PATH] = {0};
    if (FAILED(SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) {
        return "config.json"; // 回退到当前目录
    }
    std::string dir = std::string(appdata) + "\\MoeKoeTaskbarLyrics";
    CreateDirectoryA(dir.c_str(), nullptr);
    return dir + "\\config.json";
}

std::string Config::GetAutoStartRegistryKey() {
    return "MoeKoeTaskbarLyrics";
}

bool Config::Load() {
    const std::string path = GetConfigPath();
    ConfigDebugLog("[CONFIG] Load() path=%s\n", path.c_str());

    std::ifstream in(path);
    if (!in.is_open()) {
        ConfigDebugLog("[CONFIG] File not found, saving defaults\n");
        return Save();
    }

    try {
        json j;
        in >> j;

        enabled_   = j.value("enabled",   true);
        autoStart_ = j.value("auto_start", true);

        if (j.contains("appearance")) {
            const auto& a = j["appearance"];
            appearance_.highlightColor    = a.value("highlight_color",   appearance_.highlightColor);
            appearance_.normalColor       = a.value("normal_color",      appearance_.normalColor);
            appearance_.normalOpacity     = a.value("normal_opacity",    appearance_.normalOpacity);
            appearance_.fontFamily        = a.value("font_family",       appearance_.fontFamily);
            appearance_.fontSize          = a.value("font_size",         appearance_.fontSize);
            appearance_.enableKaraoke     = a.value("enable_karaoke",    appearance_.enableKaraoke);
            appearance_.enableTranslation = a.value("enable_translation", appearance_.enableTranslation);
            appearance_.enableMarquee     = a.value("enable_marquee",    appearance_.enableMarquee);
            appearance_.marqueeMode       = a.value("marquee_mode",      appearance_.marqueeMode);
            appearance_.marqueeDelayMs    = a.value("marquee_delay_ms",  appearance_.marqueeDelayMs);
            appearance_.marqueePauseMs    = a.value("marquee_pause_ms",  appearance_.marqueePauseMs);
            appearance_.marqueeSpeedPxPerSec = static_cast<float>(a.value("marquee_speed_px_per_sec", static_cast<double>(appearance_.marqueeSpeedPxPerSec)));
        }

        if (j.contains("advanced")) {
            const auto& a = j["advanced"];
            advanced_.websocketPort   = a.value("websocket_port",   advanced_.websocketPort);
            advanced_.refreshRateHz   = a.value("refresh_rate_hz",  advanced_.refreshRateHz);
            advanced_.debugLog        = a.value("debug_log",        advanced_.debugLog);
        }

        if (j.contains("position")) {
            const auto& p = j["position"];
            position_.offsetX = p.value("offset_x", position_.offsetX);
            position_.offsetY = p.value("offset_y", position_.offsetY);
        }

        // 范围验证：将异常值 clamp 到合理区间
        appearance_.normalOpacity       = std::clamp(appearance_.normalOpacity, 0.0, 1.0);
        appearance_.fontSize            = std::clamp(appearance_.fontSize, 8, 72);
        appearance_.marqueeDelayMs      = std::clamp(appearance_.marqueeDelayMs, 0, 10000);
        appearance_.marqueePauseMs      = std::clamp(appearance_.marqueePauseMs, 0, 10000);
        appearance_.marqueeSpeedPxPerSec = std::clamp(appearance_.marqueeSpeedPxPerSec, 10.0f, 500.0f);
        advanced_.websocketPort   = std::clamp(advanced_.websocketPort, 1024, 65535);
        advanced_.refreshRateHz   = std::clamp(advanced_.refreshRateHz, 1, 120);

        // 打印加载结果
        ConfigDebugLog("[CONFIG] Loaded: hl=%s nl=%s font=%s size=%d opacity=%.2f karaoke=%d trans=%d\n",
            appearance_.highlightColor.c_str(), appearance_.normalColor.c_str(),
            appearance_.fontFamily.c_str(), appearance_.fontSize, appearance_.normalOpacity,
            (int)appearance_.enableKaraoke, (int)appearance_.enableTranslation);

    } catch (const std::exception& e) {
        ConfigDebugLog("[CONFIG] JSON parse error: %s, saving defaults\n", e.what());
        return Save();
    }
    return true;
}

bool Config::Save() const {
    const std::string path = GetConfigPath();
    std::ofstream out(path, std::ios::trunc);
    if (!out.is_open()) return false;

    json j;
    j["enabled"]    = enabled_;
    j["auto_start"] = autoStart_;

    j["appearance"] = {
        {"highlight_color",    appearance_.highlightColor},
        {"normal_color",       appearance_.normalColor},
        {"normal_opacity",     appearance_.normalOpacity},
        {"font_family",        appearance_.fontFamily},
        {"font_size",          appearance_.fontSize},
        {"enable_karaoke",     appearance_.enableKaraoke},
        {"enable_translation", appearance_.enableTranslation},
        {"enable_marquee",     appearance_.enableMarquee},
        {"marquee_mode",       appearance_.marqueeMode},
        {"marquee_delay_ms",   appearance_.marqueeDelayMs},
        {"marquee_pause_ms",   appearance_.marqueePauseMs},
        {"marquee_speed_px_per_sec", appearance_.marqueeSpeedPxPerSec},
    };

    j["advanced"] = {
        {"websocket_port",   advanced_.websocketPort},
        {"refresh_rate_hz",  advanced_.refreshRateHz},
        {"debug_log",        advanced_.debugLog},
    };

    j["position"] = {
        {"offset_x", position_.offsetX},
        {"offset_y", position_.offsetY},
    };

    out << j.dump(2);
    return true;
}

bool Config::SetAutoStart(bool v) {
    const bool changed = (autoStart_ != v);
    autoStart_ = v;

    // 多方案级联：注册表 → 任务计划程序 → 启动文件夹
    // 只要其中一个成功就算成功
    bool regOk = SetAutoStartRegistry(v);
    bool taskOk = false;
    bool startupOk = false;
    if (!regOk) {
        // 注册表失败（很可能是杀毒软件拦截）→ 试任务计划程序
        taskOk = SetAutoStartTaskScheduler(v);
        if (!taskOk) {
            // 还是失败 → 试启动文件夹
            startupOk = SetAutoStartStartupFolder(v);
        }
    }

    const bool anyOk = regOk || taskOk || startupOk;
    ConfigDebugLog("[AUTOSTART] SetAutoStart(%s) changed=%d, reg=%s task=%s startup=%s -> overall=%s\n",
        v ? "true" : "false", (int)changed,
        regOk ? "ok" : "FAIL",
        taskOk ? "ok" : (regOk ? "skip" : "FAIL"),
        startupOk ? "ok" : ((regOk || taskOk) ? "skip" : "FAIL"),
        anyOk ? "OK" : "ALL-FAIL");
    return anyOk;
}

bool Config::SetAutoStartRegistry(bool enable) {
    HKEY hKey = nullptr;
    LONG result = RegOpenKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        0,
        KEY_SET_VALUE | KEY_QUERY_VALUE,
        &hKey);
    if (result != ERROR_SUCCESS) {
        ConfigDebugLog("[AUTOSTART] RegOpenKeyExW failed: %ld\n", result);
        return false;
    }

    bool ok = true;
    if (enable) {
        // 使用智能解析的路径（优先 moeKoe-taskbar-lyrics 下的 exe）
        const std::wstring resolvedPath = ResolveAutoStartExePath();
        // 复制到 wchar_t 数组（GetModuleFileNameW 风格的接口）
        wchar_t exePath[MAX_PATH] = {0};
        wcsncpy_s(exePath, resolvedPath.c_str(), MAX_PATH - 1);

        if (resolvedPath.empty() || wcslen(exePath) == 0) {
            ConfigDebugLog("[AUTOSTART] GetModuleFileNameW failed: %lu\n", GetLastError());
            RegCloseKey(hKey);
            return false;
        }

        // 用引号包围路径，避开路径中可能存在的空格
        std::wstring quotedPath = L"\"";
        quotedPath += exePath;
        quotedPath += L"\"";

        const std::string nameKey = GetAutoStartRegistryKey();
        const std::wstring nameW(nameKey.begin(), nameKey.end());
        const DWORD byteCount = static_cast<DWORD>((quotedPath.size() + 1) * sizeof(wchar_t));

        result = RegSetValueExW(
            hKey,
            nameW.c_str(),
            0,
            REG_SZ,
            reinterpret_cast<const BYTE*>(quotedPath.c_str()),
            byteCount);
        if (result != ERROR_SUCCESS) {
            ConfigDebugLog("[AUTOSTART] RegSetValueExW failed: %ld\n", result);
            ok = false;
        } else {
            ConfigDebugLog("[AUTOSTART] Registry SET ok: key='%s' value='%s'\n",
                nameKey.c_str(), WideToUtf8(quotedPath).c_str());
        }
    } else {
        const std::string nameKey = GetAutoStartRegistryKey();
        const std::wstring nameW(nameKey.begin(), nameKey.end());
        result = RegDeleteValueW(hKey, nameW.c_str());
        if (result != ERROR_SUCCESS && result != ERROR_FILE_NOT_FOUND) {
            ConfigDebugLog("[AUTOSTART] RegDeleteValueW failed: %ld\n", result);
            ok = false;
        } else {
            ConfigDebugLog("[AUTOSTART] Registry DELETE ok: key='%s' (ret=%ld)\n",
                nameKey.c_str(), result);
        }
    }

    RegCloseKey(hKey);
    return ok;
}

// ─────────── 任务计划程序自启（最稳） ───────────
//
// 优先使用 schtasks 命令创建/删除"用户登录时启动"的任务。
// 大部分杀毒软件不会拦截 schtasks，且无需管理员权限（HKCU 范围）。
// 任务名: MoeKoeTaskbarLyrics_AutoStart
//
static const wchar_t* kTaskName = L"MoeKoeTaskbarLyrics_AutoStart";

bool Config::SetAutoStartTaskScheduler(bool enable) {
    const std::wstring resolvedPath = ResolveAutoStartExePath();
    wchar_t exePath[MAX_PATH] = {0};
    wcsncpy_s(exePath, resolvedPath.c_str(), MAX_PATH - 1);
    if (resolvedPath.empty() || wcslen(exePath) == 0) {
        ConfigDebugLog("[AUTOSTART] TaskScheduler: path empty\n");
        return false;
    }

    // 先删除旧任务（无论存在与否都先尝试，避免冲突）
    std::wstring deleteCmd = std::wstring(L"schtasks /Delete /TN \"") + kTaskName + L"\" /F";
    {
        STARTUPINFOW si{}; si.cb = sizeof(si);
        PROCESS_INFORMATION pi{};
        std::wstring deleteCmdLine = deleteCmd;
        if (::CreateProcessW(nullptr, deleteCmdLine.data(), nullptr, nullptr,
                             FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
            ::WaitForSingleObject(pi.hProcess, 5000);
            ::CloseHandle(pi.hProcess);
            ::CloseHandle(pi.hThread);
        }
    }

    if (!enable) {
        // 关闭自启：只要成功删除了"任务"就算成功（如果原本就不存在也算 ok）
        // 简化处理：直接返回 true
        ConfigDebugLog("[AUTOSTART] TaskScheduler: task deleted (or never existed)\n");
        return true;
    }

    // 创建任务: /SC ONLOGON 触发，/RL LIMITED 普通权限，/F 覆盖
    std::wstring quotedExe = L"\"";
    quotedExe += exePath;
    quotedExe += L"\"";

    std::wstring createCmd = std::wstring(L"schtasks /Create /TN \"") + kTaskName
        + L"\" /TR " + quotedExe
        + L" /SC ONLOGON /RL LIMITED /F";

    ConfigDebugLog("[AUTOSTART] TaskScheduler cmd: %s\n",
        WideToUtf8(createCmd).c_str());

    STARTUPINFOW si{}; si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    std::wstring cmdLine = createCmd;
    if (!::CreateProcessW(nullptr, cmdLine.data(), nullptr, nullptr,
                          FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        ConfigDebugLog("[AUTOSTART] TaskScheduler CreateProcessW failed: %lu\n", GetLastError());
        return false;
    }
    ::WaitForSingleObject(pi.hProcess, 10000);
    DWORD exitCode = 0;
    ::GetExitCodeProcess(pi.hProcess, &exitCode);
    ::CloseHandle(pi.hProcess);
    ::CloseHandle(pi.hThread);

    if (exitCode != 0) {
        ConfigDebugLog("[AUTOSTART] TaskScheduler schtasks exited with code %lu\n", exitCode);
        return false;
    }

    ConfigDebugLog("[AUTOSTART] TaskScheduler: task created successfully\n");
    return true;
}

// ─────────── 启动文件夹快捷方式自启（最简） ───────────
//
// 在 %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup 下放置 .lnk 快捷方式。
// 缺点是依赖 IShellLink COM 接口，代码量大；这里用 PowerShell 脚本兜底。
//
bool Config::SetAutoStartStartupFolder(bool enable) {
    const std::wstring resolvedPath = ResolveAutoStartExePath();
    wchar_t exePath[MAX_PATH] = {0};
    wcsncpy_s(exePath, resolvedPath.c_str(), MAX_PATH - 1);
    if (resolvedPath.empty() || wcslen(exePath) == 0) {
        return false;
    }

    // Startup 目录
    wchar_t startupDir[MAX_PATH] = {0};
    if (FAILED(::SHGetFolderPathW(nullptr, CSIDL_STARTUP, nullptr, 0, startupDir))) {
        ConfigDebugLog("[AUTOSTART] StartupFolder: SHGetFolderPathW failed\n");
        return false;
    }

    std::wstring lnkPath = std::wstring(startupDir) + L"\\MoeKoeTaskbarLyrics.lnk";

    if (!enable) {
        if (::DeleteFileW(lnkPath.c_str())) {
            ConfigDebugLog("[AUTOSTART] StartupFolder: lnk deleted\n");
        }
        return true;  // 不存在也视为成功
    }

    // 用 PowerShell 创建快捷方式
    std::wstring psScript = L"powershell -NoProfile -WindowStyle Hidden -Command \"";
    psScript += L"$s = (New-Object -ComObject WScript.Shell).CreateShortcut('";
    psScript += lnkPath;
    psScript += L"'); $s.TargetPath = '";
    psScript += exePath;
    psScript += L"'; $s.WorkingDirectory = '";
    wchar_t workDir[MAX_PATH] = {0};
    wcsncpy_s(workDir, exePath, MAX_PATH);
    wchar_t* lastSlash = wcsrchr(workDir, L'\\');
    if (lastSlash) *lastSlash = L'\0';
    psScript += workDir;
    psScript += L"'; $s.WindowStyle = 7; $s.Save()\"";

    ConfigDebugLog("[AUTOSTART] StartupFolder ps (truncated)\n");

    STARTUPINFOW si{}; si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    std::wstring cmdLine = psScript;
    if (!::CreateProcessW(nullptr, cmdLine.data(), nullptr, nullptr,
                          FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        ConfigDebugLog("[AUTOSTART] StartupFolder CreateProcessW failed: %lu\n", GetLastError());
        return false;
    }
    ::WaitForSingleObject(pi.hProcess, 15000);
    DWORD exitCode = 0;
    ::GetExitCodeProcess(pi.hProcess, &exitCode);
    ::CloseHandle(pi.hProcess);
    ::CloseHandle(pi.hThread);

    bool exists = (::GetFileAttributesW(lnkPath.c_str()) != INVALID_FILE_ATTRIBUTES);
    ConfigDebugLog("[AUTOSTART] StartupFolder: exitCode=%lu, lnk exists=%d\n", exitCode, (int)exists);
    return exists;
}

} // namespace moekoe
