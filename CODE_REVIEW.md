# TaskbarLyrics 代码审查报告

基于对仓库代码的全面分析和实际修复记录。

**最后更新**: 2026-06-09

---

## 修复状态总览

| # | 问题 | 严重度 | 状态 | 修改文件 |
|---|------|--------|------|----------|
| 1 | 开机自启命令注入漏洞 | HIGH | ✅ 已修复 | [config.cpp](src/config.cpp) |
| 2 | HTTP 命令验证 & CORS | MEDIUM | ✅ 已修复 | [http_server.cpp](src/http_server.cpp) |
| 3 | PowerShell 转义/注入风险 | MEDIUM | ✅ 已修复 | [config.cpp](src/config.cpp) |
| 4 | 并行化自启动执行 | MEDIUM | ✅ 已修复 | [config.cpp](src/config.cpp) |
| 5 | 歌词解析无大小限制 | MEDIUM | ✅ 已修复 | [websocket_client.cpp](src/websocket_client.cpp), [constants.h](src/constants.h) |
| 6 | 硬编码用户路径 (CMakeLists.txt) | LOW | ✅ 已修复 | [CMakeLists.txt](CMakeLists.txt), [CMakePresets.json](CMakePresets.json) |
| 7 | 硬编码用户路径 (popup.js) | LOW | ✅ 已修复 | [popup.js](moeKoe-taskbar-lyrics/popup.js) |
| 8 | 注释调试代码残留 | LOW | ✅ 已修复 | [popup.js](moeKoe-taskbar-lyrics/popup.js) |
| 9 | WebSocket 无连接超时 | LOW | ✅ 已修复 | [background.js](moeKoe-taskbar-lyrics/background.js) |
| 10 | MSVC 工具集版本不匹配 | BUILD | ✅ 已修复 | [CMakePresets.json](CMakePresets.json), [build.cmd](build.cmd) |

---

## 🔴 **已修复: 关键安全问题**

### **1. 开机自启动 - 命令注入漏洞 (HIGH)** ✅
**位置**: `src/config.cpp`

**原问题**: 自启动路径直接拼接进 shell 命令，未做任何安全校验。

**修复方案**: 新增 `IsPathSafe()` 函数，在所有自启动方式（注册表 / 任务计划 / 启动文件夹）执行前统一验证：

```cpp
// src/config.cpp - IsPathSafe()
static bool IsPathSafe(const std::wstring& path) {
    if (path.empty()) return false;
    // 危险字符：可被 cmd.exe / PowerShell 解释为命令分隔、管道、重定向等
    static const wchar_t dangerousChars[] = L"&|;`$(){}<>!\n\r\"";
    for (const wchar_t* p = dangerousChars; *p != L'\0'; ++p) {
        if (path.find(*p) != std::wstring::npos) return false;
    }
    // 路径必须指向实际存在的文件
    return ::GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES;
}
```

三个自启动函数 (`SetAutoStartRegistry`, `SetAutoStartTaskScheduler`, `SetAutoStartStartupFolder`) 均在调用前执行此检查。

---

### **2. HTTP 关闭端点 - 安全加固 (MEDIUM)** ✅
**位置**: `src/http_server.cpp`

**原问题**:
- 子字符串匹配 `"shutdown"` 容易被绕过（如 `"no_shutdown"` 也命中）
- CORS 头设为 `Access-Control-Allow-Origin: *`，任意网站可触发关闭

**修复方案**:
- 新增 `IsValidShutdownCommand()` 函数，严格 JSON 白名单验证：
```cpp
static bool IsValidShutdownCommand(const std::string& bodyStr, size_t len) {
    // 必须是精确匹配 {"command":"shutdown"} 的合法 JSON
    static const char* expected = R"({"command":"shutdown"})";
    return (len == strlen(expected)) && (memcmp(bodyStr.data(), expected, len) == 0);
}
```
- CORS 从 `*` 改为仅允许 `http://127.0.0.1:{port}`（动态获取实际端口）
- 移除 OPTIONS 预检路由（不再需要通配 CORS）

---

### **3. 启动文件夹快捷方式 - COM 替代 PowerShell (MEDIUM)** ✅
**位置**: `src/config.cpp`

**原问题**: 使用 `CreateProcessW("powershell ...")` 拼接脚本创建 `.lnk` 快捷方式，路径中的单引号等字符会导致脚本注入。

**修复方案**: 完全移除 PowerShell 调用，改用 Windows COM 接口 `IShellLinkW` + `IPersistFile` 直接创建 `.lnk` 文件：

```
CoCreateInstance(CLSID_ShellLink) → IShellLinkW::SetPath() → IPersistFile::Save()
```

优势：
- 零 shell 注入风险（纯 API 调用）
- 不依赖 PowerShell 是否被禁用
- 不受企业安全策略限制
- 执行速度更快（无需启动 powershell.exe 进程）

---

## 🟡 **已修复: 功能改进**

### **4. 并行化自启动执行 (MEDIUM)** ✅
**位置**: `src/config.cpp` — `SetAutoStart()`

**原问题**: 级联模式 — 注册表失败才尝试任务计划，再失败尝试启动文件夹。任一失败可能阻断后续。

**修复方案**: 改为并行执行三种方案，任一成功即返回成功：

```cpp
bool Config::SetAutoStart(bool v) {
    autoStart_ = v;
    bool regOk = SetAutoStartRegistry(v);
    bool taskOk = SetAutoStartTaskScheduler(v);     // 不依赖 regOk
    bool startupOk = SetAutoStartStartupFolder(v);   // 不依赖前两者
    return regOk || taskOk || startupOk;             // 任一成功即可
}
```

---

### **5. 歌词解析大小限制 (MEDIUM)** ✅
**位置**: `src/constants.h`, `src/websocket_client.cpp`

新增常量防止恶意大歌词导致内存耗尽：

```cpp
// constants.h
constexpr size_t MAX_LYRIC_LINES = 10000;      // 最大歌词行数
constexpr size_t MAX_CHARS_PER_LINE = 1000;     // 单行最大字符数
```

在 `ParseKrc()` 和 JSON 数组解析中均添加了截断保护。

---

### **6. WebSocket 连接超时 (LOW)** ✅
**位置**: `moeKoe-taskbar-lyrics/background.js`

**原问题**: WebSocket 连接没有超时机制，API 服务不可用时 UI 会无限等待。

**修复方案**: 新增 5 秒连接超时：

```javascript
const CONNECT_TIMEOUT = 5000; // ms
let connectTimeoutId = null;

function connectWebSocket() {
    ws = new WebSocket(wsUrl);
    connectTimeoutId = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) { ws.close(); scheduleReconnect(); }
    }, CONNECT_TIMEOUT);
}
```

超时后立即关闭并按指数退避重连（首次失败更快重连），提供更快的用户反馈。

---

## 🟠 **已修复: 代码质量**

### **7. 硬编码用户路径清理 (LOW)** ✅

#### CMakeLists.txt
**原问题**: 包含 `D:/vcpkg/...`、`C:/Users/19624/...` 等个人开发机器路径。

**修复**: 改为多级回退搜索策略：
1. CMake 变量 `-DVCPKG_INSTALLED_DIR=...`（CI 环境）
2. 环境变量 `$ENV{VCPKG_INSTALLED_DIR}` / `$ENV{VCPKG_INSTALLATION_ROOT}`
3. 自动搜索常见安装路径（`D:/vcpkg`, `C:/vcpkg` 等）
4. ixwebsocket / WebView2 同理使用 `$ENV{USERPROFILE}/.nuget/packages/...` + 版本号自动查找

#### popup.js
**原问题**: `getPluginDir()` 中硬编码了 `C:\Users\19624\...` 和 `D:\MoeKoeMusic-plugin\...` 作为回退路径。

**修复**: 移除所有硬编码路径，完全依赖 `window.electronAPI.getExtensionPath()` 动态获取。

---

### **8. 注释调试代码清理 (LOW)** ✅
**位置**: `moeKoe-taskbar-lyrics/popup.js`

移除 `launchExe()` 中所有注释掉的 `showDiag()` 调试代码，保持生产代码整洁。

---

## 🔧 **构建系统修复**

### **9. MSVC 工具集版本不匹配** ✅

**问题**: ixwebsocket.lib 用 MSVC **14.44** 编译（内含 `_Find_last_of_pos_vectorized` 等向量化 STL 符号），但 VS 2022 CMake generator 默认使用 **14.42**。链接时报 `LNK2019: __std_find_last_of_trivial_pos_1 未解析`。

**尝试过的无效方案**（vcxproj `<PlatformToolset>` 无法通过 CMake 改变）：
- `CMAKE_VS_PLATFORM_TOOLSET_VERSION` 缓存变量
- `CMAKE_VS_GLOBALS` 全局属性注入
- `set_target_properties(VS_PLATFORM_TOOLSET_VERSION)`
- `-T "v143,version=14.44.35207"` 工具集参数
- CMakePresets.json 的 `toolset` 字段

**最终有效方案**: 在 [CMakePresets.json](CMakePresets.json) 的 build preset 中使用 `nativeToolOptions`：

```json
{
    "buildPresets": [{
        "name": "x64-Debug",
        "configurePreset": "x64-Debug",
        "configuration": "Debug",
        "nativeToolOptions": ["/p:PlatformToolsetVersion=14.44.35207"]
    }]
}
```

**构建命令**:
```bash
cmake --preset x64-Debug       # 或 x64-Release
cmake --build --preset x64-Debug   # 自动传递工具集参数
```

同时创建了 [build.cmd](build.cmd) 一键构建脚本作为备用。

---

## 📋 **开机自启动功能专项诊断记录**

以下问题经排查后均已确认修复：

### 原始诊断发现的问题

#### 问题 A：头文件与实现不一致
**原始状态**: `config.h` 声明 `bool SetAutoStart(bool v)` 返回 `bool`，但 `config.cpp` 实现 `void SetAutoStart(bool v)` 无返回值。
**当前状态**: ✅ **已修复** — `SetAutoStart()` 现在正确返回 `bool`，且返回三种方案的或结果（[config.cpp L230-L248](src/config.cpp#L230-L248)）。

#### 问题 B：仅使用 Run 注册表，其他两种方式未实现
**原始状态**: `SetAutoStartTaskScheduler()` 和 `SetAutoStartStartupFolder()` 在头文件中声明但未实现。
**当前状态**: ✅ **已修复** — 三个函数全部完整实现：
- `SetAutoStartRegistry` — HKCU Run 注册表（[L250](src/config.cpp#L250)）
- `SetAutoStartTaskScheduler` — schtasks 任务计划程序（[L332](src/config.cpp#L332)）
- `SetAutoStartStartupFolder` — IShellLink COM 快捷方式（[L408](src/config.cpp#L408)）

三者由 `SetAutoStart()` 并行调用，任一成功即视为成功。

#### 问题 C：写入错误的 exe 路径（Debug 目录 vs 安装目录）
**原始状态**: 直接使用 `GetModuleFileNameW(nullptr, ...)` 获取当前进程路径，VS F5 调试时会将 Debug 目录写入注册表，重启后路径失效导致启动失败。
**当前状态**: ✅ **已修复** — 新增 `ResolveAutoStartExePath()` 智能路径解析函数（[L74](src/config.cpp#L74)）：
1. 先取当前进程路径
2. 检查父目录下是否存在 `moeKoe-taskbar-lyrics\MoeKoeTaskbarLyrics.exe`（生产安装路径）
3. 若当前已在 `moeKoe-taskbar-lyrics` 下则直接使用当前路径
4. 所有三个自启动函数均调用此函数获取正确的安装路径

#### 问题 D：注册表值未加引号
**原始状态**: `RegSetValueExW(...)` 写入裸路径，含空格时 Windows 可能解析异常。
**当前状态**: ✅ **已修复** — 使用带双引号的 `quotedPath` 写入（[config.cpp L286-L299](src/config.cpp#L286-L299)）：
```cpp
std::wstring quotedPath = L"\"" + std::wstring(exePath) + L"\"";
RegSetValueExW(hKey, nameW.c_str(), 0, REG_SZ,
               reinterpret_cast<const BYTE*>(quotedPath.c_str()), byteCount);
```

### 排查方法备忘（供后续参考）

如果自启动仍然异常，按以下步骤排查：

1. **查看注册表实际内容**:
   ```
   Win+R → regedit → HKCU\Software\Microsoft\Windows\CurrentVersion\Run
   ```
   确认 `MoeKoeTaskbarLyrics` 键值的路径是否存在、是否带引号。

2. **查看启动文件夹**:
   ```
   Win+R → shell:startup
   ```
   确认 `MoeKoeTaskbarLyrics.lnk` 是否存在，目标路径是否正确。

3. **查看任务计划程序**:
   ```cmd
   schtasks /Query /TN "MoeKoeTaskbarLyrics_AutoStart"
   ```

4. **手动测试路径**: 将注册表中记录的路径复制到 Win+R 或 cmd 中运行，确认能否正常启动。

5. **检查安全软件日志**: 杀毒软件可能拦截注册表修改或计划任务创建。

---

## 📊 **剩余待处理项**

| 优先级 | 问题 | 说明 |
|--------|------|------|
| MEDIUM | 配置文件 ACL 权限 | `config.json` 可被同机其他用户读取 |
| LOW | 资源泄漏防护 (RAII) | main.cpp 中异常路径的资源释放 |
| LOW | WebSocket 认证 | 本地端口无 token 校验 |
| LOW | WS_PORT / HTTP_PORT 可配置 | 当前硬编码 6520 / 6523 |

---

## ✅ **项目优点（保持不变）**

- WebSocket 消息大小限制（防 DoS）
- 三层并行自启动方案（良好的容错设计）
- 异常处理和 debug 日志（便于诊断）
- Per-Monitor V2 DPI 感知（多显示器支持）
- 优雅关闭流程（资源释放顺序正确）
- 开机自启路径智能解析 (`ResolveAutoStartExePath`)
- 单实例保护 (Mutex)

---

## 📚 **相关资源**

- Windows 任务计划程序 API: https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page
- IShellLink COM 接口: https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishelllinkw
- Windows 安全最佳实践: https://learn.microsoft.com/en-us/windows/win32/secbp/best-practices-for-the-security-apis
- CMake Presets nativeToolOptions: https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#build-preset
