// MoeKoe Taskbar Lyrics - Popup Script (使用 window.electronAPI IPC)

const WS_PORT = 6520;   // MoeKoeMusic WebSocket 端口
const HTTP_PORT = 6523; // C++ EXE 内嵌 HTTP 服务器端口（备用）

document.addEventListener('DOMContentLoaded', () => {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const wsStatus = document.getElementById('wsStatus');
    const processStatus = document.getElementById('processStatus');
    const currentLyric = document.getElementById('currentLyric');
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

    // 获取插件目录路径（EXE 所在目录）
async function getPluginDir() {
    // 如果 electronAPI 有获取路径的方法，优先使用
    if (window.electronAPI && window.electronAPI.getExtensionPath) {
        try {
            const p = await window.electronAPI.getExtensionPath();
            if (p) return p;
        } catch (_) {}
    }

    // 回退到相对路径（如果可能）
    // 注意：这只是一个占位符，实际路径需要由 MoeKoeMusic 通过 electronAPI 提供
    return '';
}

    // 启动 EXE
    async function launchExe() {
        const pluginDir = await getPluginDir();
        console.log('[TaskbarLyrics] 插件目录:', pluginDir);

        // 方式1: electronAPI.startNativeLauncher（首选）
        if (window.electronAPI) {
            // 检查方法是否存在
            if (typeof window.electronAPI.startNativeLauncher === 'function') {
                try {
                    const result = await window.electronAPI.startNativeLauncher(pluginDir);
                    console.log('[TaskbarLyrics] startNativeLauncher 结果:', result);
                    return true;
                } catch (e) {
                    const errMsg = 'startNativeLauncher 错误: ' + (e.message || e);
                    console.error('[TaskbarLyrics]', errMsg);
                    // 不立即返回 false，继续尝试其他方式
                }
            }

            // 方式1b: 尝试其他可能的方法名
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

        // 方式2: HTTP ping 检测是否已在运行（说明手动启动了）
        try {
            const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/ping`, { method: 'GET' });
            if (r.ok) return true; // 已在运行
        } catch (_) {}

        return false;
    }

    // 停止 EXE
    async function stopExe() {
        // 方式1: electronAPI.stopNativeLauncher
        if (window.electronAPI && typeof window.electronAPI.stopNativeLauncher === 'function') {
            try {
                const pluginDir = await getPluginDir();
                await window.electronAPI.stopNativeLauncher(pluginDir);
                return true;
            } catch (e) {
                console.warn('[TaskbarLyrics] stopNativeLauncher 错误:', e);
            }
        }

        // 方式2: HTTP shutdown 命令
        try {
            const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'control', data: { command: 'shutdown' } })
            });
            return r.ok;
        } catch (e) {
            console.warn('[TaskbarLyrics] HTTP shutdown 失败:', e);
            return false;
        }
    }

    // 检测进程状态
    async function checkProcessRunning() {
        // 方式1: electronAPI.isNativeLauncherRunning
        if (window.electronAPI && typeof window.electronAPI.isNativeLauncherRunning === 'function') {
            try {
                const pluginDir = await getPluginDir();
                return await window.electronAPI.isNativeLauncherRunning(pluginDir);
            } catch (e) {
                console.warn('[TaskbarLyrics] isNativeLauncherRunning 错误:', e);
            }
        }

        // 方式2: HTTP ping
        try {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 2000);
            const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/ping`, {
                method: 'GET',
                signal: controller.signal
            });
            return r.ok;
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
                if (message.data && message.data.currentLine) {
                    currentLyric.textContent = message.data.currentLine;
                }
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
