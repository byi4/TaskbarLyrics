// native-bridge.js - MoeKoeMusic Native Host 隐藏桥接页
//
// 此页面由 Electron Main Process (nativeHostManager) 以隐藏窗口方式加载：
//   - 1x1 像素、skipTaskbar、show:false
//   - 带 preload.cjs → 可用 window.electronAPI.nativeHost
//   - 运行在 chrome-extension:// 上下文 → 可用 chrome.runtime
//
// 职责：在 background.js (Service Worker) 和 Electron Main Process 之间中转消息
//
// 通信链路:
//   background → chrome.runtime.Port → bridge → electronAPI.nativeHost → Main Process → exe stdin
//   exe stdout → Main Process → electronAPI.nativeHost.onMessage → bridge → Port → background

const HOST_ID = 'taskbar-lyrics-host';

// ── 防御性检查：确保 electronAPI 已正确加载 ──
if (!window.electronAPI || !window.electronAPI.nativeHost) {
    console.error('[NativeBridge] 致命错误: electronAPI 未定义或 preload 脚本未正确加载。桥接页无法工作。');
    // 不再继续初始化，避免后续 ReferenceError 导致页面完全崩溃
} else {

// ── 建立 background 的长连接 Port ──
const port = chrome.runtime.connect({ name: 'moekoe-native-host-bridge' });

console.log('[NativeBridge] Bridge page loaded, connecting to background...');

// ── 接收 Main Process 转发的 EXE stdout 消息，转发给 background ──
window.electronAPI.nativeHost.onMessage((payload) => {
    if (!payload || payload.hostId !== HOST_ID) {
        return;
    }

    port.postMessage({
        type: 'native-host:event',
        payload: payload.message
    });
});

// ── 接收 background 的请求，转发给 Main Process（写入 EXE stdin）──
port.onMessage.addListener(async (message) => {
    if (!message || !message.type) {
        return;
    }

    switch (message.type) {
        case 'native-host:status': {
            try {
                const result = await window.electronAPI.nativeHost.getStatus(HOST_ID);
                port.postMessage({
                    type: 'native-host:response',
                    requestId: message.requestId,
                    seq: message.seq,
                    result: result
                });
            } catch (e) {
                console.error('[NativeBridge] getStatus 失败:', e);
                port.postMessage({
                    type: 'native-host:response',
                    requestId: message.requestId,
                    seq: message.seq,
                    result: { success: false, message: e.message || 'Native Host 状态查询异常' }
                });
            }
            break;
        }

        case 'native-host:send': {
            try {
                const result = await window.electronAPI.nativeHost.send(HOST_ID, message.payload);
                port.postMessage({
                    type: 'native-host:response',
                    requestId: message.requestId,
                    seq: message.seq,
                    result: result
                });
            } catch (e) {
                console.error('[NativeBridge] send 失败:', e);
                port.postMessage({
                    type: 'native-host:response',
                    requestId: message.requestId,
                    seq: message.seq,
                    result: { success: false, message: e.message || 'Native Host 发送异常' }
                });
            }
            break;
        }
    }
});

// ── 断开处理 ──
port.onDisconnect.addListener(() => {
    console.warn('[NativeBridge] Background port disconnected');
});

} // end of electronAPI guard
