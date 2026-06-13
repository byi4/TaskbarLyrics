// MoeKoe Taskbar Lyrics - Background Service Worker
//
// 职责:
//   - 通过 WebSocket 连接 MoeKoeMusic 的 apiService (ws://127.0.0.1:6520)
//   - 将歌词和播放状态转发给 popup
//   - 通过 Native Host Bridge 与 MoeKoeMusic 主进程通信，管理 C++ EXE 生命周期

const WS_PORT = 6520;
const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_DELAY = 30000; // 最大重连间隔 30 秒
const CONNECT_TIMEOUT = 5000; // 5 秒连接超时
const HOST_ID = 'taskbar-lyrics-host';

let ws = null;
let connected = false;
let reconnectAttempts = 0;

// ---- Token 管理 ----
// 在 Service Worker 启动时生成并缓存令牌，避免每次同步读取 storage
let cachedAuthToken = null;

// 获取本地鉴权令牌（首次自动生成并持久化）
async function getAuthToken() {
    if (cachedAuthToken) return cachedAuthToken;
    const result = await chrome.storage.local.get('authToken');
    if (result.authToken) {
        cachedAuthToken = result.authToken;
        return cachedAuthToken;
    }
    // 不存在则生成新令牌
    const token = 'MoeKoeTL-' + crypto.randomUUID();
    await chrome.storage.local.set({ authToken: token });
    cachedAuthToken = token;
    return token;
}

// ---- Native Host Bridge 管理 ----

let bridgePort = null;
const pending = new Map();

// 监听 bridge 页面连接（native-bridge.html 由 Main Process 隐藏打开）
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'moekoe-native-host-bridge') {
        return;
    }

    bridgePort = port;
    console.log('[TaskbarLyrics] Native Host Bridge 已连接');

    port.onMessage.addListener((message) => {
        if (!message) return;

        // bridge 转发的响应消息
        if (message.type === 'native-host:response') {
            const resolve = pending.get(message.requestId);
            if (resolve) {
                pending.delete(message.requestId);
                resolve(message.result);
            }
            return;
        }

        // bridge 转发的 EXE 上报事件 → 广播给 popup
        if (message.type === 'native-host:event') {
            broadcastToPopup({
                type: 'nativeEvent',
                data: message.payload
            });
            return;
        }
    });

    port.onDisconnect.addListener(() => {
        bridgePort = null;
        console.log('[TaskbarLyrics] Native Host Bridge 已断开');
    });
});

// 通过 bridge 发送请求到 EXE（Promise 封装）
function sendBridgeRequest(type, payload) {
    return new Promise((resolve, reject) => {
        if (!bridgePort) {
            reject(new Error('本地程序尚未授权或桥接页未连接'));
            return;
        }

        const id = crypto.randomUUID();
        bridgePort.postMessage({ type, payload, requestId: id });
        pending.set(id, resolve);

        // 10 秒超时
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error('Native Host 请求超时'));
            }
        }, 10000);
    });
}

// 查询 EXE 状态（供 popup 调用）
async function getHostStatus() {
    try {
        return await sendBridgeRequest('native-host:status');
    } catch (e) {
        return { success: false, message: e.message };
    }
}

// 向 EXE 发送业务消息（供 popup 调用）
async function sendToHost(payload) {
    try {
        return await sendBridgeRequest('native-host:send', payload);
    } catch (e) {
        return { success: false, message: e.message };
    }
}

// ---- WebSocket 连接管理 ----

// 指数退避重连策略
function scheduleReconnect() {
    // 首次连接失败使用 1 秒，之后以指数退避递增，上限 MAX_RECONNECT_DELAY
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
    reconnectAttempts++;
    console.log(`[TaskbarLyrics] ${delay / 1000} 秒后尝试重连 (第 ${reconnectAttempts} 次)`);
    setTimeout(connectWebSocket, delay);
}

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
                scheduleReconnect();
            }
        }, CONNECT_TIMEOUT);

        ws.onopen = () => {
            hasConnected = true;
            reconnectAttempts = 0; // 连接成功，重置重连计数
            clearConnectionTimeout();
            connected = true;
            console.log('[TaskbarLyrics] WebSocket 已连接');
            broadcastToPopup({ type: 'connectionStatus', connected: true });

            // 发送身份验证令牌（服务端可选支持校验）
            getAuthToken().then(token => {
                try {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'auth', token }));
                    }
                } catch (_) {}
            });
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
            scheduleReconnect();
        };

        ws.onerror = () => {
            console.error('[TaskbarLyrics] WebSocket 错误');
        };
    } catch (e) {
        console.error('[TaskbarLyrics] 连接失败:', e);
        scheduleReconnect();
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

        case 'getAuthToken':
            getAuthToken().then(token => sendResponse({ token }));
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

        // Native Host 相关消息类型
        case 'getHostStatus':
            getHostStatus().then(result => sendResponse(result));
            return true;

        case 'sendToHost':
            sendToHost(message.payload).then(result => sendResponse(result));
            return true;

        default:
            // 对未识别类型的消息显式返回 false，告知 Chrome "我不会响应"
            sendResponse({ error: 'unknown message type' });
            return false;
    }
});

// ---- 启动 ----

connectWebSocket();
console.log('[TaskbarLyrics] 插件已加载 (v0.4.0 Native Host 模式)');
