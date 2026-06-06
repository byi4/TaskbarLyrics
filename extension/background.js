// MoeKoe Taskbar Lyrics - Background Service Worker
//
// 职责:
//   - 通过 WebSocket 连接 MoeKoeMusic 的 apiService (ws://127.0.0.1:6520)
//   - 将歌词和播放状态转发给 popup
//   - 通过 IPC 与 MoeKoeMusic 主进程通信，管理 C++ EXE 生命周期

const WS_PORT = 6520;
const RECONNECT_INTERVAL = 3000;
const EXTENSION_DIR = 'moeKoe-taskbar-lyrics';

let ws = null;
let connected = false;

// ---- WebSocket 连接管理 ----

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    try {
        ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);

        ws.onopen = () => {
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
            connected = false;
            console.log('[TaskbarLyrics] WebSocket 已断开');
            broadcastToPopup({ type: 'connectionStatus', connected: false });
            setTimeout(connectWebSocket, RECONNECT_INTERVAL);
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
    }
}

// ---- 发送控制命令 ----

function sendControl(command) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
        type: 'control',
        data: { command }
    }));
}

// ---- 与 Popup 通信 ----

function broadcastToPopup(data) {
    chrome.runtime.sendMessage(data).catch(() => {});
}

// ---- 监听来自 Popup 的消息 ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'getStatus':
            sendResponse({ connected });
            return true;

        case 'control':
            sendControl(message.command);
            sendResponse({ success: true });
            return true;

        case 'reconnect':
            if (ws) ws.close();
            connectWebSocket();
            sendResponse({ success: true });
            return true;
    }
});

// ---- 启动 ----

connectWebSocket();
console.log('[TaskbarLyrics] 插件已加载');
