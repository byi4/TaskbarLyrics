# TaskbarLyrics 代码审查报告

基于对仓库代码的全面分析，本报告提供详细的优化建议，特别针对**开机自启动功能**。

---

## 🔴 **关键问题 & 安全漏洞**

### **1. 开机自启动 - 路径传递漏洞 (HIGH)**
**位置**: `src/config.cpp` L319、L344

```cpp
// 问题代码
std::wstring deleteCmd = std::wstring(L"schtasks /Delete /TN \"") + kTaskName + L"\" /F";
::CreateProcessW(nullptr, deleteCmdLine.data(), ...)  // 直接传给 CreateProcessW

std::wstring createCmd = std::wstring(L"schtasks /Create /TN \"") + kTaskName
    + L"\" /TR " + quotedExe + L" /SC ONLOGON /RL LIMITED /F";
```

**风险**：
- 如果 `quotedExe` 包含特殊字符（如 `"`），可能导致 **命令注入**
- PowerShell 脚本（L404）没有对 `exePath` 进行转义，类似的 **注入风险**

**优化方案**：
```cpp
// 改进版本
bool Config::SetAutoStartTaskScheduler(bool enable) {
    // 1. 使用 CreateProcessW 的数组参数而非命令行字符串
    // 2. 或者对 exePath 进行完整的 shell 转义验证
    
    const std::wstring resolvedPath = ResolveAutoStartExePath();
    wchar_t exePath[MAX_PATH] = {0};
    wcsncpy_s(exePath, resolvedPath.c_str(), MAX_PATH - 1);
    
    // ✅ 验证路径合法性
    if (!PathFileExistsW(exePath)) {
        ConfigDebugLog("[AUTOSTART] Invalid exe path\n");
        return false;
    }
    
    // ✅ 验证路径中不包含危险字符
    if (wcschr(exePath, L'\n') || wcschr(exePath, L'&') || wcschr(exePath, L'|') ||
        wcschr(exePath, L';') || wcschr(exePath, L'`')) {
        ConfigDebugLog("[AUTOSTART] Invalid characters in path\n");
        return false;
    }
    
    // ✅ 构建命令行（使用 schtasks 的参数格式）
    wchar_t cmdLine[2048];
    int written = swprintf_s(cmdLine, sizeof(cmdLine)/sizeof(cmdLine[0]),
        L"schtasks /Create /TN \"%s\" /TR \"%s\" /SC ONLOGON /RL LIMITED /F", 
        kTaskName, exePath);
    
    if (written < 0) {
        ConfigDebugLog("[AUTOSTART] Command line too long\n");
        return false;
    }
    
    // ... 创建进程
}
```

---

### **2. WebSocket 消息大小检查 (MEDIUM)**
**位置**: `src/websocket_client.cpp` L337

✅ **已实现**：检查了 `MAX_WS_MESSAGE_SIZE`，这是好的做法

但建议增加 **更细粒度的验证**：
- 检查 `ParseKrc` 中的歌词行数限制
- 限制 `CharacterTiming` 数组的大小（防止 DoS）

```cpp
// 建议补充（在 ParseKrc 函数中）
const size_t MAX_LYRIC_LINES = 10000;        // 防止内存耗尽
const size_t MAX_CHARS_PER_LINE = 1000;      // 防止单行字符过多

if (data.lines.size() > MAX_LYRIC_LINES) {
    ConfigDebugLog("[PARSE] Lyric lines exceed limit: %zu\n", data.lines.size());
    data.lines.resize(MAX_LYRIC_LINES);
}

for (auto& line : data.lines) {
    if (line.characters.size() > MAX_CHARS_PER_LINE) {
        line.characters.resize(MAX_CHARS_PER_LINE);
    }
}
```

---

### **3. HTTP 服务器 - CORS 和命令注入 (MEDIUM)**
**位置**: `src/http_server.cpp` L194

```cpp
// 风险代码
if (bodyStr.find("\"shutdown\"") != std::string::npos ||
    bodyStr.find("shutdown") != std::string::npos) {
    DebugLog("[HTTP] Received shutdown command\n");
    if (onCommand_) {
        onCommand_("shutdown");
    }
}
```

**问题**：
- 简单的子字符串查找，容易被 **绕过**（如 `"no_shutdown"` 也会匹配）
- CORS 允许 `*` 源，任何网站都能调用 `/shutdown`（可导致 **恶意关闭**）

**优化**：
```cpp
// ✅ 改进方案
static bool IsValidCommand(const std::string& bodyStr) {
    try {
        auto j = json::parse(bodyStr);
        if (!j.is_object() || !j.contains("command")) {
            return false;
        }
        
        if (!j["command"].is_string()) {
            return false;
        }
        
        std::string cmd = j["command"].get<std::string>();
        
        // 白名单检查（严格相等，不是子字符串）
        return cmd == "shutdown" || cmd == "ping" || cmd == "reconnect";
    } catch (...) {
        DebugLog("[HTTP] JSON parse failed in command validation\n");
        return false;
    }
}

// 在 ServerLoop 中使用
if (method == "POST" && (path == "/" || path == "/shutdown")) {
    const char* body = strstr(buffer, "\r\n\r\n");
    if (body) {
        body += 4;
        std::string bodyStr(body);
        
        // ✅ 严格验证
        if (IsValidCommand(bodyStr)) {
            auto j = json::parse(bodyStr);
            std::string cmd = j["command"].get<std::string>();
            
            if (cmd == "shutdown") {
                SendResponse(client, 200, "OK", "application/json",
                           "{\"status\":\"shutting_down\"}");
                if (onCommand_) {
                    onCommand_("shutdown");
                }
            }
        } else {
            SendResponse(client, 400, "Bad Request", "application/json",
                       "{\"error\":\"invalid command\"}");
        }
    } else {
        SendResponse(client, 400, "Bad Request", "application/json",
                   "{\"error\":\"no body\"}");
    }
}

// ✅ 移除开放 CORS，改为localhost-only
// 修改 SendResponse 的 CORS 头部
void SendResponse(SOCKET client, int statusCode, const char* statusText,
                  const char* contentType, const char* body) {
    char header[512];
    int bodyLen = static_cast<int>(strlen(body));
    int n = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s\r\n"
        "Access-Control-Allow-Origin: http://127.0.0.1:6521\r\n"  // ✅ 受限源
        "Access-Control-Allow-Methods: GET, POST\r\n"  // ✅ 移除 OPTIONS
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n"
        "\r\n",
        statusCode, statusText, contentType, bodyLen);
    send(client, header, n, 0);
    send(client, body, bodyLen, 0);
}
```

---

### **4. PowerShell 快捷方式创建 - 权限和转义问题 (MEDIUM)**
**位置**: `src/config.cpp` L404-415

```cpp
std::wstring psScript = L"powershell -NoProfile -WindowStyle Hidden -Command \"";
psScript += L"$s = (New-Object -ComObject WScript.Shell).CreateShortcut('";
psScript += lnkPath;
psScript += L"'); $s.TargetPath = '";
psScript += exePath;
psScript += L"'; ...";
```

**问题**：
- 单引号 `'` 围绕的字符串，如果路径包含 `'` 会导致 **脚本注入**
- 没有检查 PowerShell 是否被禁用
- PowerShell 可能被企业安全策略禁用

**优化方案 - 使用 COM 接口（推荐）**：
```cpp
#include <shobjidl.h>
#include <shlguid.h>

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
        return true;
    }

    // ✅ 使用 COM 接口创建快捷方式
    HRESULT hr = S_OK;
    IShellLinkW* psl = nullptr;
    
    hr = ::CoCreateInstance(CLSID_ShellLink, nullptr, CLSCTX_INPROC_SERVER,
                            IID_IShellLinkW, (void**)&psl);
    if (FAILED(hr)) {
        ConfigDebugLog("[AUTOSTART] StartupFolder: CoCreateInstance failed: 0x%08lx\n", hr);
        return false;
    }

    // 设置快捷方式属性
    hr = psl->SetPath(exePath);
    if (FAILED(hr)) {
        ConfigDebugLog("[AUTOSTART] StartupFolder: SetPath failed: 0x%08lx\n", hr);
        psl->Release();
        return false;
    }

    // 设置工作目录
    wchar_t workDir[MAX_PATH] = {0};
    wcsncpy_s(workDir, exePath, MAX_PATH);
    wchar_t* lastSlash = wcsrchr(workDir, L'\\');
    if (lastSlash) *lastSlash = L'\0';
    
    hr = psl->SetWorkingDirectory(workDir);
    if (FAILED(hr)) {
        ConfigDebugLog("[AUTOSTART] StartupFolder: SetWorkingDirectory failed: 0x%08lx\n", hr);
        psl->Release();
        return false;
    }

    // 设置窗口风格（隐藏）
    psl->SetShowCmd(SW_HIDE);

    // 保存快捷方式
    IPersistFile* ppf = nullptr;
    hr = psl->QueryInterface(IID_IPersistFile, (void**)&ppf);
    if (FAILED(hr)) {
        ConfigDebugLog("[AUTOSTART] StartupFolder: QueryInterface failed: 0x%08lx\n", hr);
        psl->Release();
        return false;
    }

    hr = ppf->Save(lnkPath.c_str(), TRUE);
    if (FAILED(hr)) {
        ConfigDebugLog("[AUTOSTART] StartupFolder: Save failed: 0x%08lx\n", hr);
        ppf->Release();
        psl->Release();
        return false;
    }

    ppf->Release();
    psl->Release();

    ConfigDebugLog("[AUTOSTART] StartupFolder: shortcut created successfully at %s\n",
                   WideToUtf8(lnkPath).c_str());
    return true;
}
```

**在 CMakeLists.txt 中添加**：
```cmake
target_link_libraries(${PROJECT_NAME} PRIVATE
    # ... 现有库 ...
    ole32      # IShellLink COM 接口
    oleaut32   # COM 自动化
)
```

---

## 🟡 **开机自启动功能 - 专项优化建议**

### **现状分析**

目前实现了 **三层级联方案**：
1. ✅ 注册表 Run 键（兼容性最好，但易被杀毒软件拦截）
2. ✅ 任务计划程序（稳定性最好）
3. ✅ 启动文件夹快捷方式（兼容性一般）

### **推荐改进**

#### **改进 1：并行执行而非级联**

当前代码的问题：任何一种方式失败都可能阻止其他方式生效

```cpp
bool Config::SetAutoStart(bool v) {
    const bool changed = (autoStart_ != v);
    autoStart_ = v;

    // ✅ 改进：同步并行执行，不互相阻挡
    bool regOk = SetAutoStartRegistry(v);
    bool taskOk = SetAutoStartTaskScheduler(v);      // 不依赖 regOk
    bool startupOk = SetAutoStartStartupFolder(v);   // 不依赖 regOk/taskOk
    
    const bool anyOk = regOk || taskOk || startupOk;
    
    ConfigDebugLog("[AUTOSTART] SetAutoStart(%s) changed=%d\n",
        v ? "true" : "false", (int)changed);
    ConfigDebugLog("[AUTOSTART] Results: registry=%s task=%s startup=%s -> overall=%s\n",
        regOk ? "OK" : "FAIL",
        taskOk ? "OK" : "FAIL",
        startupOk ? "OK" : "FAIL",
        anyOk ? "OK" : "ALL-FAIL");
    
    return anyOk;
}
```

**优势**：
- 如果注册表失败，仍有 2 种备选方案生效
- 更健壮的容错机制
- 用户体验更好

---

#### **改进 2：启动时同步状态**

**位置**: `src/main.cpp` L399

添加诊断和修复逻辑：

```cpp
// 新增诊断函数
namespace moekoe {

struct AutoStartState {
    bool registryEnabled = false;
    bool taskEnabled = false;
    bool startupEnabled = false;
    int enabledCount = 0;
    
    bool IsConsistent(bool expected) const {
        int actualCount = (registryEnabled ? 1 : 0) + 
                         (taskEnabled ? 1 : 0) + 
                         (startupEnabled ? 1 : 0);
        
        bool currentlyEnabled = actualCount > 0;
        return currentlyEnabled == expected;
    }
};

AutoStartState DiagnoseAutoStart() {
    AutoStartState state;
    
    // 1. 检查注册表
    HKEY hKey = nullptr;
    LONG result = RegOpenKeyExW(HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Run", 0,
        KEY_QUERY_VALUE, &hKey);
    if (result == ERROR_SUCCESS) {
        wchar_t value[MAX_PATH] = {0};
        DWORD size = sizeof(value);
        result = RegQueryValueExW(hKey, L"MoeKoeTaskbarLyrics", nullptr, nullptr,
                                  (LPBYTE)value, &size);
        state.registryEnabled = (result == ERROR_SUCCESS);
        if (state.registryEnabled) {
            DebugLog("[DIAGNOSE] Registry entry found: %s\n", 
                    WideToUtf8(std::wstring(value)).c_str());
            state.enabledCount++;
        }
        RegCloseKey(hKey);
    }
    
    // 2. 检查任务计划程序
    {
        STARTUPINFOW si{};
        si.cb = sizeof(si);
        PROCESS_INFORMATION pi{};
        std::wstring queryCmd = L"schtasks /Query /TN \"MoeKoeTaskbarLyrics_AutoStart\" /FO LIST";
        
        if (::CreateProcessW(nullptr, queryCmd.data(), nullptr, nullptr,
                             FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
            ::WaitForSingleObject(pi.hProcess, 5000);
            DWORD exitCode = 0;
            ::GetExitCodeProcess(pi.hProcess, &exitCode);
            state.taskEnabled = (exitCode == 0);
            if (state.taskEnabled) {
                DebugLog("[DIAGNOSE] Task Scheduler entry found\n");
                state.enabledCount++;
            }
            ::CloseHandle(pi.hProcess);
            ::CloseHandle(pi.hThread);
        }
    }
    
    // 3. 检查启动文件夹
    {
        wchar_t startupDir[MAX_PATH] = {0};
        if (SUCCEEDED(::SHGetFolderPathW(nullptr, CSIDL_STARTUP, nullptr, 0, startupDir))) {
            std::wstring lnkPath = std::wstring(startupDir) + L"\\MoeKoeTaskbarLyrics.lnk";
            state.startupEnabled = (::GetFileAttributesW(lnkPath.c_str()) != INVALID_FILE_ATTRIBUTES);
            if (state.startupEnabled) {
                DebugLog("[DIAGNOSE] Startup folder entry found\n");
                state.enabledCount++;
            }
        }
    }
    
    return state;
}

} // namespace moekoe
```

在 `main.cpp` 中使用：

```cpp
// 启动时同步状态
moekoe::Config config;
config.Load();

auto state = DiagnoseAutoStart();
bool expectedAutoStart = config.IsAutoStart();

if (!state.IsConsistent(expectedAutoStart)) {
    DebugLog("[STARTUP] AutoStart state inconsistent. Expected=%s, Found=%d/3 methods enabled\n",
             expectedAutoStart ? "ON" : "OFF", state.enabledCount);
    // 修复不一致状态
    config.SetAutoStart(expectedAutoStart);
} else {
    DebugLog("[STARTUP] AutoStart state consistent: %d/3 methods enabled\n", state.enabledCount);
}
```

---

#### **改进 3：更详细的诊断命令**

添加用户可调用的诊断方法，便于排查问题：

```cpp
std::string Config::GenerateDiagnosisReport() const {
    std::string report;
    report += "=== AutoStart Diagnosis Report ===\n\n";
    
    auto state = DiagnoseAutoStart();
    
    report += "[Registry]\n";
    report += state.registryEnabled ? "  Status: ENABLED\n" : "  Status: DISABLED\n";
    report += "  Check with: reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\n\n";
    
    report += "[Task Scheduler]\n";
    report += state.taskEnabled ? "  Status: ENABLED\n" : "  Status: DISABLED\n";
    report += "  Check with: schtasks /Query /TN MoeKoeTaskbarLyrics_AutoStart\n\n";
    
    report += "[Startup Folder]\n";
    report += state.startupEnabled ? "  Status: ENABLED\n" : "  Status: DISABLED\n";
    report += "  Location: %APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\n\n";
    
    report += "[Summary]\n";
    report += "  Methods Enabled: " + std::to_string(state.enabledCount) + "/3\n";
    report += state.IsConsistent(autoStart_) ? "  State: CONSISTENT\n" : "  State: INCONSISTENT (需要修复)\n";
    
    return report;
}
```

在托盘菜单中添加诊断选项：

```cpp
case ID_MENU_DIAGNOSE: {
    std::string report = app.config->GenerateDiagnosisReport();
    std::wstring wReport(report.begin(), report.end());
    ::MessageBoxW(app.hwnd, wReport.c_str(), L"AutoStart 诊断报告",
                  MB_OK | MB_ICONINFORMATION);
    break;
}
```

---

## 🟡 **其他问题**

### **5. 配置文件权限 (MEDIUM)**
**位置**: `src/config.cpp` L84-92

```cpp
std::string Config::GetConfigPath() {
    char appdata[MAX_PATH] = {0};
    if (FAILED(SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) {
        return "config.json"; // ⚠️ 当前目录，权限问题
    }
    std::string dir = std::string(appdata) + "\\MoeKoeTaskbarLyrics";
    CreateDirectoryA(dir.c_str(), nullptr);  // ❌ 没有指定 ACL
    return dir + "\\config.json";
}
```

**问题**：`config.json` 可能被其他用户修改（包含敏感配置）

**优化方案**：

```cpp
#include <aclapi.h>

bool SetRestrictedDirAcl(const std::wstring& path) {
    // 获取当前用户 SID
    HANDLE hToken = nullptr;
    if (!::OpenProcessToken(::GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
        return false;
    }

    DWORD dwBufferSize = 0;
    ::GetTokenInformation(hToken, TokenUser, nullptr, 0, &dwBufferSize);
    
    PTOKEN_USER pTokenUser = (PTOKEN_USER)::LocalAlloc(LPTR, dwBufferSize);
    if (!pTokenUser) {
        ::CloseHandle(hToken);
        return false;
    }

    if (!::GetTokenInformation(hToken, TokenUser, pTokenUser, dwBufferSize, &dwBufferSize)) {
        ::LocalFree(pTokenUser);
        ::CloseHandle(hToken);
        return false;
    }

    // 创建仅允许当前用户的 ACL
    EXPLICIT_ACCESS ea = {};
    ea.grfAccessPermissions = GENERIC_ALL;
    ea.grfAccessMode = SET_ACCESS;
    ea.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
    ea.Trustee.TrusteeForm = TRUSTEE_IS_SID;
    ea.Trustee.TrusteeType = TRUSTEE_IS_USER;
    ea.Trustee.ptstrName = (LPWSTR)pTokenUser->User.Sid;

    PACL pNewAcl = nullptr;
    if (::SetEntriesInAclW(1, &ea, nullptr, &pNewAcl) != ERROR_SUCCESS) {
        ::LocalFree(pTokenUser);
        ::CloseHandle(hToken);
        return false;
    }

    // 应用 ACL
    BOOL bResult = ::SetNamedSecurityInfoW(
        (LPWSTR)path.c_str(),
        SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        nullptr, nullptr, pNewAcl, nullptr
    );

    ::LocalFree(pNewAcl);
    ::LocalFree(pTokenUser);
    ::CloseHandle(hToken);

    return bResult == ERROR_SUCCESS;
}

std::string Config::GetConfigPath() {
    char appdata[MAX_PATH] = {0};
    if (FAILED(SHGetFolderPathA(nullptr, CSIDL_APPDATA, nullptr, 0, appdata))) {
        return "config.json";
    }
    
    std::string dirUtf8 = std::string(appdata) + "\\MoeKoeTaskbarLyrics";
    
    // 转换为宽字符
    int len = ::MultiByteToWideChar(CP_UTF8, 0, dirUtf8.c_str(), -1, nullptr, 0);
    std::wstring dirWide(len - 1, L'\0');
    ::MultiByteToWideChar(CP_UTF8, 0, dirUtf8.c_str(), -1, &dirWide[0], len);
    
    // 创建目录
    ::CreateDirectoryW(dirWide.c_str(), nullptr);
    
    // ✅ 设置限制 ACL
    if (!SetRestrictedDirAcl(dirWide)) {
        ConfigDebugLog("[CONFIG] Warning: Failed to set directory ACL\n");
    }
    
    return dirUtf8 + "\\config.json";
}
```

---

### **6. 资源泄漏风险 (LOW-MEDIUM)**
**位置**: `src/main.cpp` L461-498

```cpp
// ❌ 当前方式：异常时可能泄漏
moekoe::TaskbarWindow taskbarWindow;
moekoe::TaskbarRenderer renderer;

if (!taskbarWindow.Create(hInstance, hTaskbar)) {
    // 报错，但之前分配的资源怎么办？
    return 1;
}

if (!renderer.Initialize(taskbarWindow.GetHandle())) {
    // 报错，但 taskbarWindow 怎么清理？
    return 1;
}
```

**改进方案**：

```cpp
// ✅ 使用 RAII 辅助类
class ResourceGuard {
public:
    template<typename T, typename CleanupFunc>
    ResourceGuard(T& resource, CleanupFunc cleanup) 
        : cleanup_(cleanup), resource_(&resource) {}
    
    ~ResourceGuard() {
        if (cleanup_) {
            cleanup_();
        }
    }
    
    void Release() { cleanup_ = nullptr; }

private:
    std::function<void()> cleanup_;
    void* resource_;
};

// 在 main 中使用
moekoe::TaskbarWindow taskbarWindow;
moekoe::TaskbarRenderer renderer;

ResourceGuard windowGuard(taskbarWindow, [&]() {
    if (app.taskbarWindow) taskbarWindow.Destroy();
});

ResourceGuard rendererGuard(renderer, [&]() {
    if (app.renderer) renderer.Shutdown();
});

if (!taskbarWindow.Create(hInstance, hTaskbar)) {
    ::MessageBoxW(nullptr, L"创建任务栏歌词窗口失败。",
                  L"MoeKoe Taskbar Lyrics", MB_OK | MB_ICONERROR);
    tray.Shutdown();
    return 1;  // 自动调用 guard 析构函数清理资源
}

if (!renderer.Initialize(taskbarWindow.GetHandle())) {
    ::MessageBoxW(nullptr, L"Direct2D 初始化失败。",
                  L"MoeKoe Taskbar Lyrics", MB_OK | MB_ICONERROR);
    tray.Shutdown();
    return 1;  // 自动调用 guard 析构函数清理资源
}

windowGuard.Release();  // 成功，释放自动清理
rendererGuard.Release();
```

---

### **7. 硬编码用户路径 (MEDIUM)**
**位置**: `CMakeLists.txt` L27、L62、L113 等

```cmake
set(VCPKG_INSTALLED_DIR "D:/vcpkg/installed/x64-windows-142")  # ❌ 硬编码
set(IXWEBSOCKET_DEBUG_LIB "D:/ixwebsocket-build/Debug/ixwebsocket.lib")
find_path(WEBVIEW2_INCLUDE_DIR WebView2.h
    HINTS
        "C:/Users/19624/.nuget/packages/..."  # ❌ 硬编码用户名
```

**改进**：

```cmake
cmake_minimum_required(VERSION 3.20)
project(MoeKoeTaskbarLyrics
    VERSION 0.3.1
    DESCRIPTION "MoeKoeMusic Windows Taskbar Lyrics Plugin"
    LANGUAGES CXX)

# ✅ 使用环境变量优先
if(NOT DEFINED VCPKG_INSTALLED_DIR)
    # 方案 1: 使用 VCPKG_INSTALLATION_ROOT 环境变量
    if(DEFINED ENV{VCPKG_INSTALLATION_ROOT})
        set(VCPKG_INSTALLED_DIR "$ENV{VCPKG_INSTALLATION_ROOT}/installed/x64-windows")
    else()
        # 方案 2: 自动搜索常见位置
        find_path(VCPKG_FOUND_DIR
            NAMES "include" "lib"
            PATHS
                "${CMAKE_CURRENT_SOURCE_DIR}/../vcpkg/installed/x64-windows"
                "${CMAKE_CURRENT_SOURCE_DIR}/../../vcpkg/installed/x64-windows"
                "C:/vcpkg/installed/x64-windows"
            NO_DEFAULT_PATH)
        if(VCPKG_FOUND_DIR)
            set(VCPKG_INSTALLED_DIR "${VCPKG_FOUND_DIR}")
        else()
            message(FATAL_ERROR "VCPKG_INSTALLED_DIR not found. Please set VCPKG_INSTALLATION_ROOT environment variable or provide -DVCPKG_INSTALLED_DIR=<path>")
        endif()
    endif()
endif()

message(STATUS "Using VCPKG_INSTALLED_DIR: ${VCPKG_INSTALLED_DIR}")

# ✅ ixwebsocket 路径也使用环境变量
if(NOT DEFINED IXWEBSOCKET_BUILD_DIR)
    if(DEFINED ENV{IXWEBSOCKET_BUILD_DIR})
        set(IXWEBSOCKET_BUILD_DIR "$ENV{IXWEBSOCKET_BUILD_DIR}")
    else()
        # 尝试从 vcpkg 中找
        set(IXWEBSOCKET_BUILD_DIR "${VCPKG_INSTALLED_DIR}")
    endif()
endif()

# ✅ WebView2 使用标准搜索路径
find_path(WEBVIEW2_INCLUDE_DIR WebView2.h
    HINTS
        "${WEBVIEW2_INCLUDE_DIR}"
    PATHS
        "$ENV{LOCALAPPDATA}/Microsoft/Edge WebView2"
        "C:/Program Files (x86)/Microsoft/Edge WebView2"
        "C:/Program Files/Microsoft/Edge WebView2"
    NO_DEFAULT_PATH)

message(STATUS "WebView2 include dir: ${WEBVIEW2_INCLUDE_DIR}")
```

**CI/CD 使用方式**：

```bash
# Linux/macOS
export VCPKG_INSTALLATION_ROOT=~/vcpkg
export IXWEBSOCKET_BUILD_DIR=~/ixwebsocket-build

# Windows PowerShell
$env:VCPKG_INSTALLATION_ROOT = "C:\vcpkg"
$env:IXWEBSOCKET_BUILD_DIR = "C:\ixwebsocket-build"

cmake -B build -S .
cmake --build build --config Release
```

---

## 📊 **优先级修复清单**

| 优先级 | 问题 | 影响 | 预计工作量 |
|--------|------|------|----------|
| 🔴 **HIGH** | 开机自启命令注入漏洞 | 任意命令执行 | 2-3小时 |
| 🟡 **MEDIUM** | PowerShell 转义问题 | 权限提升 | 2-3小时 |
| 🟡 **MEDIUM** | 并行化自启动执行 | 可靠性提升 | 1小时 |
| 🟡 **MEDIUM** | HTTP 命令验证和 CORS | 远程关闭 | 1.5小时 |
| 🟡 **MEDIUM** | 配置文件 ACL | 信息泄露 | 1.5小时 |
| 🟠 **LOW** | 硬编码用户路径 | 可移植性 | 1小时 |
| 🟠 **LOW** | 资源泄漏 | 内存问题 | 2小时 |

---

## ✅ **已做得好的地方**

- ✅ **WebSocket 消息大小限制**（防 DoS）
- ✅ **级联自启动方案**（良好的容错设计）
- ✅ **异常处理和 debug 日志**（便于诊断）
- ✅ **Per-Monitor V2 DPI 感知**（多显示器支持）
- ✅ **优雅关闭流程**（资源释放顺序正确）
- ✅ **开机自启路径智能解析** (`ResolveAutoStartExePath`)
- ✅ **单实例保护** (Mutex)

---

## 📝 **建议后续行动**

### **立即优先级（第1周）**
1. ✅ **修复命令注入漏洞**（使用完整的参数验证或转义）
2. ✅ **改进 HTTP 命令验证**（使用 JSON 白名单）
3. ✅ **替换 PowerShell** 为 COM 接口实现快捷方式创建

### **短期优先级（第2周）**
1. ✅ 添加自启动诊断命令
2. ✅ 并行化自启动执行逻辑
3. ✅ 修复配置文件 ACL 权限

### **中期优先级（第3周+）**
1. ✅ 编写单元测试验证三种自启动方式
2. ✅ 使用环境变量重构 CMakeLists.txt
3. ✅ 添加详细的开发文档

### **文档更新**
- 文档化已知限制（如杀毒软件拦截）
- 编写用户故障排查指南
- 添加开发环境配置指南

---

## 📚 **相关资源**

- Windows 任务计划程序 API: https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page
- IShellLink COM 接口: https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
- Windows 安全最佳实践: https://learn.microsoft.com/en-us/windows/win32/secbp/best-practices-for-the-security-apis

