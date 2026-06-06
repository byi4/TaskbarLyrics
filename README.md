# MoeKoeMusic Taskbar Lyrics

> 嵌入到 Windows 任务栏内部的卡拉 OK 歌词显示插件

## 项目简介

这是一个独立运行的 Windows 工具，**不修改 MoeKoeMusic 本体**，通过监听其 WebSocket 服务（端口 6520）实时获取歌词与播放状态，并将歌词作为任务栏的子窗口进行渲染。

> **插件集成说明**
>
> 本项目同时也是 MoeKoeMusic 的 Chrome Extension V3 插件，目录内包含 `manifest.json`、`background.js`、`popup.html` 等标准插件文件。
>
> **当前无法作为正常插件运行的原因：**
>
> 宿主 MoeKoeMusic 的安装版（`app.asar`）中未包含 `native_launcher` 自动启动所需的 IPC 方法。源码版本的 `electron/preload.cjs` 虽然暴露了 `startNativeLauncher` / `stopNativeLauncher` / `isNativeLauncherRunning` 三个 API，但安装版的 `preload.cjs` 打包在 `app.asar` 内且不支持热替换。
>
> 因此插件在安装版环境下只能做到：
> - 通过 WebSocket 接收歌词与播放状态
> - Popup 显示运行状态与控制按钮
> - 通过 HTTP 接口停止 EXE
> - 无法从 Popup 内部启动 EXE（Electron popup 安全限制）
> - 无法随 MoeKoeMusic 启停（需手动启动 EXE）
>
> 替代方案：EXE 内置 Windows 注册表开机自启功能，双击运行一次后在托盘菜单中启用即可随系统自动启动。

## 主要特性

- 零侵入：独立 EXE，与 MoeKoeMusic 完全解耦
- 任务栏内嵌：歌词作为 `Shell_TrayWnd` 的子窗口，与系统 UI 无缝融合
- 卡拉 OK 效果：基于 Direct2D + DirectWrite 渲染，支持逐字高亮
- 高 DPI 适配：Per-Monitor V2 DPI Awareness
- 系统托盘控制：启用/禁用、开机自启、退出
- 自动重连：断线后指数退避（1s → 2s → 4s → 8s → 15s）
- 轻量：CPU < 2%，内存 < 20MB

## 环境要求

| 工具 | 版本 |
|------|------|
| Windows SDK | 10.0.20348+ |
| Visual Studio | 2022 (v143) |
| CMake | 3.20+ |
| vcpkg | latest |

## 构建

### 1. 安装依赖

```bash
vcpkg install ixwebsocket nlohmann-json
```

### 2. 配置 & 编译

```bash
# 配置
cmake -B build -S . ^
    -DCMAKE_TOOLCHAIN_FILE=[vcpkg-root]/scripts/buildsystems/vcpkg.cmake ^
    -DCMAKE_BUILD_TYPE=Release

# 编译
cmake --build build --config Release
```

### 3. 一键构建

```bash
scripts\build.bat
```

## 使用

1. 启动 MoeKoeMusic 并开始播放
2. 双击 `MoeKoeTaskbarLyrics.exe`
3. 歌词将出现在任务栏内（时钟/通知区上方）
4. 右键托盘图标可控制：启用/禁用、开机自启、重新连接、退出

## 协议

详见 [MoeKoeMusic_TaskbarLyrics_开发文档.md](MoeKoeMusic_TaskbarLyrics_开发文档.md)

## 许可

GPL-2.0（继承自 MoeKoeMusic）
