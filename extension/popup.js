// MoeKoe Taskbar Lyrics - Popup Script
//
// 限制说明:
//   安装版 MoeKoeMusic 的 electronAPI 不暴露进程管理方法，
//   因此无法从 popup 内部启动外部 EXE。
//   解决方案：EXE 通过 Windows 注册表自启 / 手动启动，
//            popup 负责状态检测和停止控制。

const WS_PORT = 6520;   // MoeKoeMusic WebSocket 端口
const HTTP_PORT = 6521; // C++ EXE 内嵌 HTTP 服务器端口

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
        if (btnStop) btnStop.disabled = !running;
        if (btnStart) {
            btnStart.disabled = running;
            btnStart.textContent = running ? '已启动' : '手动启动 EXE';
        }
    }

    // 检测进程是否在运行（HTTP ping）
    async function checkProcessRunning() {
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

    // 停止 EXE（HTTP shutdown）
    async function stopExe() {
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

    // 启动按钮：显示帮助指引（无法程序化启动）
    btnStart.addEventListener('click', () => {
        alert(
            '任务栏歌词程序需要手动启动。\n\n' +
            '请双击运行以下文件:\n\n' +
            '%AppData%\\moekoemusic\\extensions\\moeKoe-taskbar-lyrics\\\n' +
            'MoeKoeTaskbarLyrics.exe\n\n' +
            '提示: 可以在 EXE 的托盘图标设置中启用"开机自启"\n' +
            '这样以后就不需要手动启动了。'
        );
    });

    btnStop.addEventListener('click', async () => {
        btnStop.disabled = true;
        btnStop.textContent = '停止中...';

        await stopExe();

        setTimeout(() => {
            checkProcessRunning().then(running => {
                updateProcessUI(running);
                btnStop.textContent = '停止';
                if (running) {
                    alert('无法通过接口停止进程\n请右键点击任务栏托盘图标退出');
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
