# TaskbarLyrics Roadmap

> MoeKoeMusic 任务栏歌词插件

***

## 项目定位

**TaskbarLyrics = MoeKoeMusic 专属原生扩展**，不做通用任务栏歌词软件。

- **不追求**：多音源兼容（网易云 / QQ音乐 / Spotify / SMTC 等）
- **不投入**：IMusicSource 抽象层、ISourceFactory、SourceManager
- **核心策略**：深度集成 MoeKoeMusic，而非兼容数量

***

## 当前状态

| 维度     | 评分         | 说明                           |
| ------ | ---------- | ---------------------------- |
| 架构     | 9/10       | God Object 问题待拆，但核心分层清晰      |
| 系统兼容   | 9.5/10     | Win11 24H2、Start Menu、全屏检测成熟 |
| 插件定位   | 10/10      | MoeKoeBridge 直连，无多余抽象        |
| 音源设计   | 10/10      | 单音源，不需要多源兼容层                 |
| 维护成本   | 9/10       | 技术债可控，瓶颈在 Explorer 行为兼容      |
| **综合** | **9.1/10** | 接近生产级 Windows Shell 扩展水平     |

### 已稳定模块

- [x] WASAPI Loopback + FFT 频谱可视化
- [x] 纯音乐封面自动下载（代际计数器竞态修复）
- [x] 卡片模式 / 卡拉OK模式切换
- [x] 设置页面模式过滤
- [x] Cover Layer 缓存（避免 CreateLayer 资源耗尽）
- [x] Start Menu 冻结检测 + Geometry Snapshot
- [x] 全屏检测（8 帧 debounce + Shell Menu 抑制）
- [x] Explorer 窗口管理（GWLP\_HWNDPARENT + WS\_EX\_TOOLWINDOW）

***

## 路线图

### P0 — Shell Companion 独立化

**目标**：将 Explorer 行为兼容层抽象为可复用的 Shell Companion 框架。

当前已具备的组件：

```
TaskbarLyrics
    ├── taskbar_geometry.cpp     ← 任务栏几何追踪
    ├── taskbar_embedder.cpp     ← 窗口嵌入 / Z-Order 管理
    ├── fullscreen_detector.cpp  ← 全屏 / Shell Menu 检测
    ├── WinEventHook             ← Start Menu / Shell 事件
    └── Shell_TrayWnd            ← Explorer 窗口树交互
```

抽象后：

```
TaskbarLyrics
    └── Shell Companion
            ├── GeometryProvider
            ├── ZOrderManager
            ├── ShellEventMonitor
            └── FullscreenGuard
                    ↓
                Explorer
```

**收益**：封面渲染、歌词动画等 UI 升级不再与 Explorer 兼容逻辑耦合；未来可复用于流量监控、时钟等同类 Shell 扩展。

***

### P1 — 封面渲染增强

**目标**：提升视觉品质，用户下一眼注意封面而非歌词本身。

- [ ] 圆角封面 + 高斯模糊背景
- [ ] 动态主题色提取（从封面主色调驱动配色）
- [ ] 封面加载过渡动画（fade-in）
- [ ] 无封面时的 fallback 视觉优化

***

### P2 — 歌词切换动画

**目标**：歌词出现 / 消失 / 高亮过渡更流畅。

- [ ] Spring Animation（弹性动画替代简单 lerp）
- [ ] EaseOut 缓出曲线
- [ ] Blur Fade 模糊淡入淡出
- [ ] 高亮色渐变过渡

***

## 架构债务（关注但不阻塞）

| 问题                       | 优先级 | 说明                                                     |
| ------------------------ | --- | ------------------------------------------------------ |
| TaskbarWindow God Object | 低   | 能工作，拆分收益 < 风险，待 Shell Companion 成型后自然解耦                |
| Explorer 内部结构依赖          | 中   | Win11 24H2 起 XAML Island 化，需预留 ExplorerProvider 抽象     |
| Renderer 资源重复创建          | 低   | `CreateSolidColorBrush` 两处逻辑相似，建议统一为 `CreateBrushes()` |
| SetWindowPos 调用频率        | 中   | 增加 `rect == lastRect` 短路，避免无效 DWM Commit               |

***

## 明确不做（Non-Goals）

- 多音源兼容（网易云 / QQ音乐 / Spotify / SMTC）
- IMusicSource / ISourceFactory 抽象层
- 任务栏自动隐藏的完整支持（保留现有逻辑，不再投入）
- 多显示器 / 任务栏左侧 / 顶部布局（不考虑）
- 替代 Shell（ExplorerPatcher / StartAllBack / Windhawk）专项适配

***

## 版本规划

| 版本               | 目标                  | 预计内容                                |
| ---------------- | ------------------- | ----------------------------------- |
| v0.4.x           | 稳定当前功能              | CI 修复（ixwebsocket Debug→Release 回退）、频谱微调（平滑 0.5→0.35、最小透明度 0.3→0.12） |
| v0.5.x           | Shell Companion 独立化 | GeometryProvider / ZOrderManager 抽象 |
| v0.6.x           | 封面渲染增强              | 圆角 + 高斯背景 + 主题色                     |
| v0.7.x           | 歌词动画                | Spring Animation + Blur Fade        |
| v1.0             | 正式发布                | 全功能稳定，文档完善                          |
| *（内容由AI生成，仅供参考）* | <br />              | <br />                              |

