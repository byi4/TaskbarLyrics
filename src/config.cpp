// SPDX-License-Identifier: GPL-2.0
// config.cpp - 配置管理实现
#include "config.h"

#include <nlohmann/json.hpp>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <shlobj.h>
#include <windows.h>

namespace moekoe {

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

void Config::SetAutoStart(bool v) {
    autoStart_ = v;
    SetAutoStartRegistry(v);
}

bool Config::SetAutoStartRegistry(bool enable) {
    HKEY hKey = nullptr;
    LONG result = RegOpenKeyExW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Run",
        0,
        KEY_SET_VALUE | KEY_QUERY_VALUE,
        &hKey);
    if (result != ERROR_SUCCESS) return false;

    bool ok = true;
    if (enable) {
        wchar_t exePath[MAX_PATH] = {0};
        GetModuleFileNameW(nullptr, exePath, MAX_PATH);

        const std::string nameKey = GetAutoStartRegistryKey();
        const std::wstring nameW(nameKey.begin(), nameKey.end());
        const DWORD byteCount = static_cast<DWORD>((wcslen(exePath) + 1) * sizeof(wchar_t));

        result = RegSetValueExW(
            hKey,
            nameW.c_str(),
            0,
            REG_SZ,
            reinterpret_cast<const BYTE*>(exePath),
            byteCount);
        if (result != ERROR_SUCCESS) ok = false;
    } else {
        const std::string nameKey = GetAutoStartRegistryKey();
        const std::wstring nameW(nameKey.begin(), nameKey.end());
        result = RegDeleteValueW(hKey, nameW.c_str());
        if (result != ERROR_SUCCESS && result != ERROR_FILE_NOT_FOUND) ok = false;
    }

    RegCloseKey(hKey);
    return ok;
}

} // namespace moekoe
