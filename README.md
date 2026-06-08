# MoeKoeMusic Taskbar Lyrics

> Windows 任务栏的歌词显示插件（v0.3.1）

## 项目简介

这是一个独立运行的 Windows 工具，**不修改 MoeKoeMusic 本体**，通过监听其 WebSocket 服务（端口 6520）实时获取歌词与播放状态，并将歌词作为任务栏上方的浮动窗口进行渲染。

作为 **MoeKoeMusic 插件** 集成，但目前还不支持从插件 popup 界面启动（倒是可以从这个界面停止）。

## 当前状态 (v0.3.1)

### 已完成

- Direct2D 透明窗口渲染 + 逐字高亮
- 悬停显示按钮（上一首/暂停/下一首）
- 拖动定位（约束在任务栏范围内，带视觉边框反馈）
- WebView2 设置界面 + Win32 回退（理论上应该没有问题）
- 配置持久化（%APPDATA%）
- 6 种预设主题色
- HTTP 接口（ping/shutdown）
- Z-order 三重防护（防止被任务栏覆盖）
- API 模式自动检测与开启（连接失败时自动开启 MoeKoeMusic 的 WS 服务）
- 刷新率最高 120 FPS（30FPS时看起来歌词高亮效果卡顿，60相对于30来说有所缓解，但120相对于60似乎并未感觉有提升？）

### 待改进

- 插件 popup 的 EXE 启动方式验证（无法启动）
- 多显示器支持（待测试）
- 歌词缓存（离线显示，待测试）
- 多方向任务栏适配（待测试？我没找到把任务栏挪到左侧/右侧/上边框的设置。但隐藏任务栏时歌词会随着任务栏一同隐藏）
- 字体/颜色/字号/透明度/卡拉OK/翻译 全部可配（实测在应用中切换翻译时，任务栏歌词未切换）
- 插件 popup 启动/停止（实测可停止但无法开启）
- 长歌词跑马灯滚动（bounce/loop/off 三种模式，待测试）
- Windhawk / Explorer Hook 方案（真正嵌入任务栏的方案后续会考虑的）

## 主要特性

### 核心功能

- **零侵入**：独立 EXE，与 MoeKoeMusic 完全解耦
- **卡拉 OK 效果**：基于 Direct2D + DirectWrite 渲染，逐字高亮渐变
- **悬停控制按钮**：鼠标悬停歌词时显示 ⏮ ⏸/▶ ⏭
- **拖动定位**：可在任务栏范围内左右/上下拖动调整位置
- **高 DPI 适配**：Per-Monitor V2 DPI Awareness
- **多方向任务栏**：支持底部 / 顶部 / 左侧 / 右侧任务栏

### 配置系统

- **持久化存储**：`%APPDATA%\MoeKoeTaskbarLyrics\config.json`
- **WebView2 设置界面**（优先）：现代化 UI，暗色模式自动切换，实时预览
- **Win32 设置界面**（回退）：WebView2 不可用时自动降级
- **可配置项**：
  - 字体、字号、粗细
  - 高亮颜色 / 普通歌词颜色 + 6 种预设主题
  - 不透明度
  - 卡拉OK 开关 / 翻译开关
  - 水平偏移 / 垂直偏移
  - WebSocket 端口 / 刷新率

### 插件集成

- Chrome Extension Manifest V3 格式
- popup.js 通过 `file://` 协议启动 EXE（不依赖宿主 IPC）
- HTTP 接口（端口 6521）：ping 检测存活 / shutdown 优雅退出
- 托盘菜单：设置 / 重连 / 解除绑定 / 退出（未实现绑定模式）

### 运行模式

- **绑定模式**：EXE 放在 MoeKoeMusic 目录下，随主进程启停（目前还未能随主进程启停）
- **独立模式**：常驻系统托盘，手动管理生命周期

## 环境要求

| 工具               | 版本          |
| ---------------- | ----------- |
| Windows SDK      | 10.0.26100+ |
| Visual Studio    | 2022 (v143) |
| CMake            | 3.20+       |
| vcpkg            | latest      |
| WebView2 Runtime | 已安装（设置界面需要） |

## 构建

```bash
# 安装依赖
vcpkg install ixwebsocket nlohmann-json

# 配置（x64 Debug）
cmake -B build -S . ^
    -DCMAKE_TOOLCHAIN_FILE=[vcpkg-root]/scripts/buildsystems/vcpkg.cmake

# 编译
cmake --build build --config x64-Debug

# 构建后自动复制:
#   → resources/ 到输出目录
#   → MoeKoeTaskbarLyrics.exe 到插件目录
#   → WebView2Loader.dll 到输出目录
```

## 使用方式

### 方式一：独立运行

双击 `MoeKoeTaskbarLyrics.exe`，右键托盘图标操作。

### 方式二：作为 MoeKoeMusic 插件

将 `moeKoe-taskbar-lyrics` 目录复制到：

- 开发版：`MoeKoeMusic/plugins/extensions/moeKoe-taskbar-lyrics/`
- 安装版：`%APPDATA%/moekoemusic/extensions/moeKoe-taskbar-lyrics/`

在 MoeKoeMusic 的插件页面点击”打开插件目录“，打开`moeKoe-taskbar-lyrics`文件夹，双击\`MoeKoeTaskbarLyrics.exe\`启动。

## 如果你想进一步了解本项目，可以查看MoeKoeMusic\_TaskbarLyrics\_开发文档.md
