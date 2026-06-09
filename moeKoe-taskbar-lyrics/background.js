// MoeKoe Taskbar Lyrics - Background Service Worker
//
// 职责:
//   - 通过 WebSocket 连接 MoeKoeMusic 的 apiService (ws://127.0.0.1:6520)
//   - 将歌词和播放状态转发给 popup
//   - 通过 IPC 与 MoeKoeMusic 主进程通信，管理 C++ EXE 生命周期
//
// 注意:
//   - WS_PORT 默认为 6520；若用户在 EXE 侧 config.json 中修改了
//     advanced.websocket_port，需要在此处同步修改（或由宿主页面通过
//     electronAPI 注入）。
//   - 与本机 HTTP 控制端口（默认 6523）的交互统一放在 popup.js 中，
//     background.js 只负责 WS 数据通道与 popup 转发。

const WS_PORT = 6520;
const RECONNECT_INTERVAL = 3000;
const CONNECT_TIMEOUT = 5000; // 5 秒连接超时
const EXTENSION_DIR = 'moeKoe-taskbar-lyrics';

let ws = null;
let connected = false;

// ---- WebSocket 连接管理 ----

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    try {
        ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
        let connectionTimeout = null;
        let hasConnected = false;
        let cleared = false;

        const clearConnectionTimeout = () => {
            if (!cleared && connectionTimeout) {
                clearTimeout(connectionTimeout);
                cleared = true;
            }
        };

        // 设置连接超时
        connectionTimeout = setTimeout(() => {
            if (!hasConnected && ws && ws.readyState !== WebSocket.OPEN) {
                console.log('[TaskbarLyrics] WebSocket 连接超时');
                try { ws.close(); } catch (_) {}
                setTimeout(connectWebSocket, RECONNECT_INTERVAL);
            }
        }, CONNECT_TIMEOUT);

        ws.onopen = () => {
            hasConnected = true;
            clearConnectionTimeout();
            connected = true;
            console.log('[TaskbarLyrics] WebSocket 已连接');
            broadcastToPopup({ type: 'connectionStatus', connected: true });
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            } catch (e) {
                console.error('[TaskbarLyrics] 解析消息失败:', e);
            }
        };

        ws.onclose = () => {
            clearConnectionTimeout();
            connected = false;
            console.log('[TaskbarLyrics] WebSocket 已断开');
            broadcastToPopup({ type: 'connectionStatus', connected: false });
            // 只有在成功连接后又断开时才使用常规重连间隔
            setTimeout(connectWebSocket, hasConnected ? RECONNECT_INTERVAL : 1000);
        };

        ws.onerror = () => {
            console.error('[TaskbarLyrics] WebSocket 错误');
        };
    } catch (e) {
        console.error('[TaskbarLyrics] 连接失败:', e);
        setTimeout(connectWebSocket, RECONNECT_INTERVAL);
    }
}

// ---- 消息处理 ----

function handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
        case 'welcome':
            console.log('[TaskbarLyrics] 收到欢迎消息:', msg.data);
            break;
        case 'lyrics':
            broadcastToPopup({ type: 'lyrics', data: msg.data });
            break;
        case 'playerState':
            broadcastToPopup({ type: 'playerState', data: msg.data });
            break;
        default:
            // 忽略未识别类型，避免污染日志或下游
            break;
    }
}

// ---- 发送控制命令 ----

function sendControl(command) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify({
            type: 'control',
            data: { command }
        }));
    } catch (e) {
        console.error('[TaskbarLyrics] 发送控制命令失败:', e);
    }
}

// ---- 与 Popup 通信 ----

function broadcastToPopup(data) {
    chrome.runtime.sendMessage(data).catch(() => {});
}

// ---- 监听来自 Popup 的消息 ----
// 规范: 每条消息显式调用 sendResponse 或 return false，避免 Chrome 报 "message
// port closed before a response was received" 之类的控制台告警。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message && message.type) {
        case 'getStatus':
            sendResponse({ connected });
            return true;

        case 'control':
            sendControl(message.command);
            sendResponse({ success: true });
            return true;

        case 'reconnect':
            if (ws) { try { ws.close(); } catch (_) {} }
            connectWebSocket();
            sendResponse({ success: true });
            return true;

        default:
            // 对未识别类型的消息显式返回 false，告知 Chrome "我不会响应"
            sendResponse({ error: 'unknown message type' });
            return false;
    }
});

// ---- 启动 ----

connectWebSocket();
console.log('[TaskbarLyrics] 插件已加载');
