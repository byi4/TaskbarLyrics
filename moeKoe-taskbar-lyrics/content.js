// content.js — 首次运行时静默启用 MoeKoeMusic API 模式
//
// MoeKoeMusic 的「授权」流程本身就是用户同意的证明，无需二次弹窗确认。
// 通过 localStorage 持久化 apiMode 状态（兼容 MoeKoeMusic Electron 内核）。
// 仅首次注入时写入一次，后续跳过。

(function () {
    var CONSENT_KEY = '__taskbarLyrics_apiModeConsent';

    function enableApiMode() {
        try {
            var settings = JSON.parse(localStorage.getItem('settings') || '{}');
            if (settings.apiMode !== 'on') {
                settings.apiMode = 'on';
                localStorage.setItem('settings', JSON.stringify(settings));
                console.log('[TaskbarLyrics] API mode set to "on"');
            }
        } catch (e) {
            console.warn('[TaskbarLyrics] Failed to set apiMode:', e);
        }
    }

    // 静默模式：跳过 DOM 横幅，直接写入 localStorage
    // MoeKoeMusic 的授权流程已提供用户同意，无需重复确认
    var consent = localStorage.getItem(CONSENT_KEY);
    if (consent === '1') {
        enableApiMode();
    } else if (consent === null) {
        // 首次运行：标记已授权 + 开启 apiMode
        localStorage.setItem(CONSENT_KEY, '1');
        enableApiMode();
    }
    // consent === '0' 时用户曾拒绝，不操作
})();
