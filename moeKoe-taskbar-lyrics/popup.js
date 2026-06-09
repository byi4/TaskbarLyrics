// MoeKoe Taskbar Lyrics - Popup Script (使用 window.electronAPI IPC)

// ── 运行时常量 ──────────────────────────────────────────────────────────────────
// 注意：WS_PORT 对应 MoeKoeMusic 的 WebSocket 服务端口；
//       HTTP_PORT 对应本插件 EXE 内嵌入的极简 HTTP 服务器端口。
// 两者都支持通过扩展本地鉴权 token（与 EXE 端 LOCAL_AUTH_TOKEN 保持一致）。
// 如需自定义端口，可在 EXE 侧的 config.json -> advanced 中调整；
// 扩展侧当前读取同名字段，缺省使用下面的默认值（端口冲突时请同步修改）。
const WS_PORT       = 6520;
const HTTP_PORT     = 6523;
const LOCAL_AUTH_TOKEN = 'MoeKoeTL-2k7qFb9zXm4Nv3Wc8YhRtSjP0DlQn6Bo1';
const AUTH_HEADER   = 'X-MoeKoe-Token';

document.addEventListener('DOMContentLoaded', () => {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const wsStatus = document.getElementById('wsStatus');
    const processStatus = document.getElementById('processStatus');
    const btnPrev = document.getElementById('btnPrev');
    const btnToggle = document.getElementById('btnToggle');
    const btnNext = document.getElementById('btnNext');
    const btnReconnect = document.getElementById('btnReconnect');
    const btnStart = document.getElementById('btnStart');
    const btnStop = document.getElementById('btnStop');
    const diagPanel = document.getElementById('diagPanel');
    const diagText = document.getElementById('diagText');

    // ---- 诊断 + API 探测 ----
    function showDiag(msg) {
        if (diagPanel && diagText) {
            diagPanel.style.display = 'block';
            diagText.textContent = msg;
        }
    }

    // 列出 electronAPI 上所有可用方法
    const apiMethods = [];
    if (window.electronAPI) {
        for (const key of Object.keys(window.electronAPI)) {
            apiMethods.push(key + ': ' + typeof window.electronAPI[key]);
        }
    }
    const diagInfo = {
        electronAPI: !!window.electronAPI,
        apiMethods: apiMethods,
        proto: location.protocol,
    };
    // showDiag(JSON.stringify(diagInfo, null, 2)); // 关闭环境诊断

    // ---- 工具函数 ----

    function updateConnectionUI(connected) {
        statusDot.className = 'status-dot ' + (connected ? 'on' : 'off');
        statusText.textContent = connected ? '已连接' : '等待连接';
        wsStatus.textContent = connected ? '已连接' : '未连接';
        wsStatus.style.color = connected ? '#52c41a' : '#ff4d4f';
    }

    function updateProcessUI(running) {
        processStatus.textContent = running ? '运行中' : '未运行';
        processStatus.style.color = running ? '#52c41a' : '#ff4d4f';
        if (btnStart) btnStart.disabled = running;
        if (btnStop) btnStop.disabled = !running;
    }

    // 构造携带本地鉴权头的通用 fetch 选项
    function buildAuthHeaders(extra) {
        const headers = Object.assign({}, extra || {});
        headers[AUTH_HEADER] = LOCAL_AUTH_TOKEN;
        return headers;
    }

    // 获取插件目录路径（EXE 所在目录）
    async function getPluginDir() {
        if (window.electronAPI && window.electronAPI.getExtensionPath) {
            try {
                const p = await window.electronAPI.getExtensionPath();
                if (p) return p;
            } catch (_) {}
        }
        return '';
    }

    // 启动 EXE
    async function launchExe() {
        const pluginDir = await getPluginDir();
        console.log('[TaskbarLyrics] 插件目录:', pluginDir);

        if (window.electronAPI) {
            if (typeof window.electronAPI.startNativeLauncher === 'function') {
                try {
                    const result = await window.electronAPI.startNativeLauncher(pluginDir);
                    console.log('[TaskbarLyrics] startNativeLauncher 结果:', result);
                    return true;
                } catch (e) {
                    const errMsg = 'startNativeLauncher 错误: ' + (e.message || e);
                    console.error('[TaskbarLyrics]', errMsg);
                }
            }

            const altMethods = ['startNativeProcess', 'launchExe', 'spawnProcess'];
            for (const m of altMethods) {
                if (typeof window.electronAPI[m] === 'function') {
                    try {
                        await window.electronAPI[m](pluginDir);
                        console.log('[TaskbarLyrics] 通过 ' + m + ' 启动成功');
                        return true;
                    } catch (_) {}
                }
            }
        }

        // 回退：通过 HTTP /ping 检查是否已运行（手动启动了）
        try {
            const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/ping`, {
                method: 'GET',
                headers: buildAuthHeaders()
            });
            if (!r.ok) return false;
            // 同时校验响应体，避免被非目标服务的 200 也被当成"启动成功"
            try {
                const data = await r.json();
                if (data && data.service === 'MoeKoeTaskbarLyrics') return true;
            } catch (_) {}
        } catch (_) {}

        return false;
    }

    // 停止 EXE
    async function stopExe() {
        if (window.electronAPI && typeof window.electronAPI.stopNativeLauncher === 'function') {
            try {
                const pluginDir = await getPluginDir();
                await window.electronAPI.stopNativeLauncher(pluginDir);
                return true;
            } catch (e) {
                console.warn('[TaskbarLyrics] stopNativeLauncher 错误:', e);
            }
        }

        // 回退：通过 HTTP shutdown 命令，并同时校验响应体（非目标服务的 200 被当作成功
        try {
            const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/`, {
                method: 'POST',
                headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ type: 'control', data: { command: 'shutdown' } })
            });
            if (!r.ok) return false;
            try {
                const data = await r.json();
                // 严格校验：必须返回 {status:shutting_down} 才算成功
                return !!(data && data.status === 'shutting_down');
            } catch (_) {
                return false;
            }
        } catch (e) {
            console.warn('[TaskbarLyrics] HTTP shutdown 失败:', e);
            return false;
        }
    }

    // 检测进程状态
    async function checkProcessRunning() {
        if (window.electronAPI && typeof window.electronAPI.isNativeLauncherRunning === 'function') {
            try {
                const pluginDir = await getPluginDir();
                return await window.electronAPI.isNativeLauncherRunning(pluginDir);
            } catch (e) {
                console.warn('[TaskbarLyrics] isNativeLauncherRunning 错误:', e);
            }
        }

        // 回退：HTTP /ping（带鉴权头 + 校验 body
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 2000);
            const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/ping`, {
                method: 'GET',
                headers: buildAuthHeaders(),
                signal: controller.signal
            });
            if (!r.ok) return false;
            try {
                const data = await r.json();
                return !!(data && data.service === 'MoeKoeTaskbarLyrics');
            } catch (_) {
                return false;
            }
        } catch (_) {
            return false;
        }
    }

    // ---- 初始化 ----

    chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
        if (response) updateConnectionUI(response.connected);
    });

    checkProcessRunning().then(running => updateProcessUI(running));

    chrome.runtime.onMessage.addListener((message) => {
        switch (message.type) {
            case 'connectionStatus':
                updateConnectionUI(message.connected);
                break;
            case 'lyrics':
                const currentLyric = document.getElementById('currentLyric');
                if (currentLyric && message.data && message.data.currentLine) {
                    currentLyric.textContent = message.data.currentLine;
                }
                break;
            default:
                break;
        }
    });

    setInterval(() => {
        checkProcessRunning().then(running => updateProcessUI(running));
    }, 5000);

    // ---- 按钮事件 ----

    btnStart.addEventListener('click', async () => {
        btnStart.disabled = true;
        btnStart.textContent = '启动中...';

        const launched = await launchExe();

        setTimeout(async () => {
            const running = await checkProcessRunning();
            updateProcessUI(running);
            btnStart.disabled = running;
            btnStart.textContent = '启动';
            if (!running) {
                alert('EXE 可能未成功启动\n请查看下方诊断信息了解详情');
            }
        }, 2000);
    });

    btnStop.addEventListener('click', async () => {
        btnStop.disabled = true;
        btnStop.textContent = '停止中...';

        await stopExe();

        setTimeout(() => {
            checkProcessRunning().then(running => {
                updateProcessUI(running);
                btnStop.disabled = !running;
                btnStop.textContent = '停止';
                if (running) {
                    alert('无法停止进程\n请手动关闭');
                }
            });
        }, 1000);
    });

    btnPrev.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'control', command: 'prev' });
    });

    btnToggle.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'control', command: 'toggle' });
    });

    btnNext.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'control', command: 'next' });
    });

    btnReconnect.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'reconnect' }, () => {
            setTimeout(() => {
                chrome.runtime.sendMessage({ type: 'getStatus' }, (r) => {
                    if (r) updateConnectionUI(r.connected);
                });
            }, 1000);
        });
    });
});
