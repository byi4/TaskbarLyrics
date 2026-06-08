// SPDX-License-Identifier: GPL-2.0
// api_enabler.h - MoeKoeMusic API 模式自动检测与开启
//
// 职责:
//   - 检测 MoeKoeMusic 进程是否在运行
//   - 读取 MoeKoeMusic 的 electron-store 配置文件
//   - 判断 API 模式是否关闭，若关闭则自动开启
//   - 可选：重启 MoeKoeMusic 使配置立即生效
//
#pragma once

#include <string>

namespace moekoe {

/// API 模式自动开启的结果
enum class ApiEnableResult {
    AlreadyOn,       // API 模式已开启，无需操作
    Enabled,         // 成功将 API 模式从 off 改为 on（需重启生效）
    EnabledAndRestarted, // 成功开启并已触发 MoeKoeMusic 重启
    ProcessNotFound, // MoeKoeMusic 未运行
    ConfigNotFound,  // 配置文件不存在
    ConfigReadError, // 配置文件读取/解析失败
    ConfigWriteError,// 配置文件写入失败
    AlreadyAttempted,// 本次运行周期内已经尝试过（防重复）
};

class ApiEnabler {
public:
    /// 检测并尝试开启 API 模式
    /// @return 操作结果
    static ApiEnableResult TryEnableApi();

    /// 获取结果的可读描述（用于日志/UI 提示）
    static std::string ResultToString(ApiEnableResult result);

private:
    /// 检查 MoeKoeMusic 进程是否存在
    static bool IsMoeKoeMusicRunning();

    /// 获取 electron-store 配置文件路径
    /// Windows: %APPDATA%\moekoemusic\config.json
    static std::string GetConfigPath();

    /// 读取配置文件中的 apiMode 值
    /// @return "on" / "off" / ""(不存在或错误)
    static std::string ReadApiMode(const std::string& configPath);

    /// 将配置文件中的 apiMode 设为 "on"
    static bool WriteApiMode(const std::string& configPath);

    /// 尝试重启 MoeKoeMusic（找到进程后终止并重新启动）
    static bool RestartMoeKoeMusic();
};

} // namespace moekoe
