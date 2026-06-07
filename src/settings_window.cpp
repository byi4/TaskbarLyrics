// SPDX-License-Identifier: GPL-2.0
// settings_window.cpp - WebView2 设置界面实现
//
// 使用 WebView2 SDK（Windows 10/11 自带或 Edge Runtime）
// 通过 PostWebMessageAsJson 与 JS 双向通信
#include "settings_window.h"

#include <shlobj.h>
#include <windows.h>

#include <WebView2.h>

#include <cstdio>
#include <nlohmann/json.hpp>
#include <string>
#include <wrl/client.h>  // 仅用于 ComPtr

namespace moekoe {

using json = nlohmann::json;
using Microsoft::WRL::ComPtr;

namespace {

void DebugLog(const char* fmt, ...) {
    const char* logPath = "D:\\MoeKoeMusic-plugin\\MoeKoeMusic-TaskbarLyrics\\debug.log";
    FILE* f = fopen(logPath, "a");
    if (!f) return;
    va_list args;
    va_start(args, fmt);
    vfprintf(f, fmt, args);
    va_end(args);
    fclose(f);
}

} // namespace

// ============================================================
// 原生 COM 回调实现（不依赖 WRL RuntimeClass）
// ============================================================

class EnvironmentCompletedHandler : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
public:
    EnvironmentCompletedHandler(SettingsWindow* owner) : owner_(owner) { refCount_ = 1; }

    // IUnknown
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == __uuidof(ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler)) {
            *ppv = static_cast<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refCount_); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG c = InterlockedDecrement(&refCount_);
        if (c <= 0) delete this;
        return static_cast<ULONG>(c > 0 ? c : 0);
    }

    // ICoreWebView2CreateEnvironmentCompletedHandler
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Environment* env) override {
        DebugLog("[SETTINGS] Env created, hr=0x%08lX\n", result);
        if (SUCCEEDED(result) && owner_ && env) {
            owner_->OnEnvironmentReady(env);
        }
        return S_OK;
    }

private:
    SettingsWindow* owner_;
    volatile LONG refCount_;
};

class ControllerCompletedHandler : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
public:
    ControllerCompletedHandler(SettingsWindow* owner) : owner_(owner) { refCount_ = 1; }

    // IUnknown
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == __uuidof(ICoreWebView2CreateCoreWebView2ControllerCompletedHandler)) {
            *ppv = static_cast<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refCount_); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG c = InterlockedDecrement(&refCount_);
        if (c <= 0) delete this;
        return static_cast<ULONG>(c > 0 ? c : 0);
    }

    // ICoreWebView2CreateCoreWebView2ControllerCompletedHandler
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Controller* controller) override {
        DebugLog("[SETTINGS] Controller created, hr=0x%08lX\n", result);
        if (SUCCEEDED(result) && owner_ && controller) {
            owner_->OnControllerReady(controller);
        }
        return S_OK;
    }

private:
    SettingsWindow* owner_;
    volatile LONG refCount_;
};

class WebMessageReceivedHandler : public ICoreWebView2WebMessageReceivedEventHandler {
public:
    WebMessageReceivedHandler(SettingsWindow* owner) : owner_(owner) { refCount_ = 1; }

    // IUnknown
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        if (riid == IID_IUnknown || riid == __uuidof(ICoreWebView2WebMessageReceivedEventHandler)) {
            *ppv = static_cast<ICoreWebView2WebMessageReceivedEventHandler*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refCount_); }
    ULONG STDMETHODCALLTYPE Release() override {
        LONG c = InterlockedDecrement(&refCount_);
        if (c <= 0) delete this;
        return static_cast<ULONG>(c > 0 ? c : 0);
    }

    // ICoreWebView2WebMessageReceivedEventHandler
    HRESULT STDMETHODCALLTYPE Invoke(ICoreWebView2* sender,
                                     ICoreWebView2WebMessageReceivedEventArgs* args) override {
        LPWSTR msg = nullptr;
        // 此版本只有 TryGetWebMessageAsString
        HRESULT hr = args->TryGetWebMessageAsString(&msg);
        if (SUCCEEDED(hr) && msg && owner_) {
            int len = WideCharToMultiByte(CP_UTF8, 0, msg, -1, nullptr, 0, nullptr, nullptr);
            if (len > 0) {
                std::string utf8(static_cast<size_t>(len), '\0');
                WideCharToMultiByte(CP_UTF8, 0, msg, -1, &utf8[0], len, nullptr, nullptr);
                utf8.pop_back();
                owner_->OnWebMessageReceived(utf8);
            }
            CoTaskMemFree(msg);
        }
        return S_OK;
    }

private:
    SettingsWindow* owner_;
    volatile LONG refCount_;
};

// ============================================================
// SettingsWindow 实现
// ============================================================

SettingsWindow::SettingsWindow() = default;

SettingsWindow::~SettingsWindow() { Close(); }

bool SettingsWindow::IsVisible() const {
    return hwnd_ && ::IsWindowVisible(hwnd_);
}

void SettingsWindow::Close() {
    if (hwnd_) {
        ::DestroyWindow(hwnd_);
        hwnd_ = nullptr;
    }
}

LRESULT CALLBACK SettingsWindow::WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    auto* self = reinterpret_cast<SettingsWindow*>(
        ::GetWindowLongPtrW(hwnd, GWLP_USERDATA));

    switch (msg) {
    case WM_NCCREATE: {
        auto* cs = reinterpret_cast<CREATESTRUCTW*>(lParam);
        self = reinterpret_cast<SettingsWindow*>(cs->lpCreateParams);
        ::SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
        self->hwnd_ = hwnd;
        return 0;
    }
    case WM_SIZE: {
        if (self && self->webView2Controller_) {
            RECT rc{};
            ::GetClientRect(hwnd, &rc);
            static_cast<ICoreWebView2Controller*>(self->webView2Controller_)->put_Bounds(rc);
        }
        return 0;
    }
    case WM_DESTROY:
        if (self) {
            if (self->webView2_) {
                static_cast<ICoreWebView2*>(self->webView2_)->Release();
                self->webView2_ = nullptr;
            }
            if (self->webView2Controller_) {
                static_cast<ICoreWebView2Controller*>(self->webView2Controller_)->Release();
                self->webView2Controller_ = nullptr;
            }
            if (self->webView2Environment_) {
                static_cast<ICoreWebView2Environment*>(self->webView2Environment_)->Release();
                self->webView2Environment_ = nullptr;
            }
            self->hwnd_ = nullptr;
        }
        return 0;
    default:
        break;
    }
    return ::DefWindowProcW(hwnd, msg, wParam, lParam);
}

bool SettingsWindow::Show(HINSTANCE hInstance, HWND parent, const Config& currentConfig) {
    if (hwnd_) {
        ::SetForegroundWindow(hwnd_);
        return true;
    }

    hInstance_ = hInstance;
    currentConfig_ = currentConfig;

    WNDCLASSEXW wc{};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = &WndProc;
    wc.hInstance = hInstance;
    wc.hCursor = ::LoadCursorW(nullptr, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    wc.lpszClassName = kWindowClass;
    ::RegisterClassExW(&wc);

    hwnd_ = ::CreateWindowExW(
        0, kWindowClass, L"任务栏歌词 - 设置",
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT, 460, 620,
        parent, nullptr, hInstance, this);

    if (!hwnd_) return false;

    RECT parentRect{}, windowRect{};
    GetWindowRect(parent ? parent : GetDesktopWindow(), &parentRect);
    GetWindowRect(hwnd_, &windowRect);
    int x = parentRect.left + (parentRect.right - parentRect.left - (windowRect.right - windowRect.left)) / 2;
    int y = parentRect.top + (parentRect.bottom - parentRect.top - (windowRect.bottom - windowRect.top)) / 3;
    SetWindowPos(hwnd_, nullptr, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER);

    ShowWindow(hwnd_, SW_SHOW);
    UpdateWindow(hwnd_);

    // 构建 file:// URL
    wchar_t exeDir[MAX_PATH] = {0};
    GetModuleFileNameW(nullptr, exeDir, MAX_PATH);
    wchar_t* slash = wcsrchr(exeDir, L'\\');
    if (slash) *slash = L'\0';
    settingsUrl_ = std::wstring(L"file:///") + exeDir + L"\\resources\\settings.html";
    for (auto& c : settingsUrl_) { if (c == L'\\') c = L'/'; }

    DebugLog("[SETTINGS] URL=%ls\n", settingsUrl_.c_str());

    // 创建 WebView2 环境
    auto* envHandler = new EnvironmentCompletedHandler(this);
    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, nullptr, nullptr, envHandler);
    envHandler->Release();

    if (FAILED(hr)) {
        DebugLog("[SETTINGS] CreateCoreWebView2EnvironmentWithOptions failed: 0x%08lX\n", hr);
        MessageBoxW(hwnd_,
            L"无法创建 WebView2 环境。\n请确保已安装 Microsoft Edge WebView2 Runtime。",
            L"MoeKoe Taskbar Lyrics", MB_OK | MB_ICONWARNING);
    }

    return true;
}

void SettingsWindow::OnEnvironmentReady(void* env) {
    webView2Environment_ = env;
    static_cast<ICoreWebView2Environment*>(env)->AddRef();

    RECT rc{};
    GetClientRect(hwnd_, &rc);

    auto* ctrlHandler = new ControllerCompletedHandler(this);
    HRESULT hr = static_cast<ICoreWebView2Environment*>(env)->CreateCoreWebView2Controller(
        hwnd_, ctrlHandler);
    ctrlHandler->Release();

    if (FAILED(hr)) {
        DebugLog("[SETTINGS] CreateCoreWebView2Controller failed: 0x%08lX\n", hr);
    }
}

void SettingsWindow::OnControllerReady(void* controller) {
    webView2Controller_ = controller;
    static_cast<ICoreWebView2Controller*>(controller)->AddRef();

    ComPtr<ICoreWebView2> webview;
    static_cast<ICoreWebView2Controller*>(controller)->get_CoreWebView2(webview.GetAddressOf());
    if (webview) {
        webView2_ = webview.Detach();

        static_cast<ICoreWebView2*>(webView2_)->Navigate(settingsUrl_.c_str());

        EventRegistrationToken token{};
        auto* msgHandler = new WebMessageReceivedHandler(this);
        static_cast<ICoreWebView2*>(webView2_)->add_WebMessageReceived(msgHandler, &token);
        msgHandler->Release();

        DebugLog("[SETTINGS] WebView2 ready\n");
    }
}

void SettingsWindow::OnWebMessageReceived(const std::string& jsonStr) {
    try {
        json msg = json::parse(jsonStr);
        std::string type = msg.value("type", "");

        DebugLog("[SETTINGS] recv: type=%s\n", type.c_str());

        if (type == "getConfig") {
            SendConfigToWebView(currentConfig_);
        } else if (type == "saveConfig") {
            if (msg.contains("config")) {
                ApplyConfigFromJson(reinterpret_cast<void*>(&msg["config"]));
                currentConfig_.Save();
                if (onConfigChanged_) onConfigChanged_(currentConfig_);
            }
        } else if (type == "close") {
            Close();
        }
    } catch (const std::exception& e) {
        DebugLog("[SETTINGS] OnWebMessage error: %s\n", e.what());
    }
}

void SettingsWindow::ApplyConfigFromJson(void* jsonPtr) {
    const json& c = *reinterpret_cast<const json*>(jsonPtr);

    if (c.contains("appearance")) {
        const auto& a = c["appearance"];
        currentConfig_.MutableAppearance().highlightColor =
            a.value("highlight_color", currentConfig_.Appearance().highlightColor);
        currentConfig_.MutableAppearance().normalColor =
            a.value("normal_color", currentConfig_.Appearance().normalColor);
        currentConfig_.MutableAppearance().normalOpacity =
            a.value("normal_opacity", currentConfig_.Appearance().normalOpacity);
        currentConfig_.MutableAppearance().fontFamily =
            a.value("font_family", currentConfig_.Appearance().fontFamily);
        currentConfig_.MutableAppearance().fontSize =
            a.value("font_size", currentConfig_.Appearance().fontSize);
        currentConfig_.MutableAppearance().enableKaraoke =
            a.value("enable_karaoke", currentConfig_.Appearance().enableKaraoke);
        currentConfig_.MutableAppearance().enableTranslation =
            a.value("enable_translation", currentConfig_.Appearance().enableTranslation);
    }
    if (c.contains("position")) {
        const auto& p = c["position"];
        currentConfig_.MutablePosition().offsetX = p.value("offset_x", 0);
        currentConfig_.MutablePosition().offsetY = p.value("offset_y", 0);
    }
    if (c.contains("advanced")) {
        const auto& a = c["advanced"];
        currentConfig_.MutableAdvanced().websocketPort =
            a.value("websocket_port", currentConfig_.Advanced().websocketPort);
        currentConfig_.MutableAdvanced().refreshRateHz =
            a.value("refresh_rate_hz", currentConfig_.Advanced().refreshRateHz);
        currentConfig_.MutableAdvanced().debugLog =
            a.value("debug_log", currentConfig_.Advanced().debugLog);
    }
}

void SettingsWindow::SendConfigToWebView(const Config& cfg) {
    if (!webView2_) return;

    json j;
    j["type"] = "initConfig";
    j["config"] = {
        {"appearance", {
            {"font_family", cfg.Appearance().fontFamily},
            {"font_size", cfg.Appearance().fontSize},
            {"normal_color", cfg.Appearance().normalColor},
            {"highlight_color", cfg.Appearance().highlightColor},
            {"normal_opacity", cfg.Appearance().normalOpacity},
            {"enable_karaoke", cfg.Appearance().enableKaraoke},
            {"enable_translation", cfg.Appearance().enableTranslation},
        }},
        {"position", {
            {"offset_x", cfg.Position().offsetX},
            {"offset_y", cfg.Position().offsetY},
        }},
        {"advanced", {
            {"websocket_port", cfg.Advanced().websocketPort},
            {"refresh_rate_hz", cfg.Advanced().refreshRateHz},
            {"debug_log", cfg.Advanced().debugLog},
        }},
    };

    std::string jsonStr = j.dump();
    std::wstring wStr(jsonStr.begin(), jsonStr.end());
    static_cast<ICoreWebView2*>(webView2_)->PostWebMessageAsJson(wStr.c_str());
    DebugLog("[SETTINGS] sent initConfig\n");
}

} // namespace moekoe
