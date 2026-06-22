// content.js — 首次运行提示用户启用 MoeKoeMusic API 模式
//
// 通过 localStorage 持久化用户授权状态（兼容 MoeKoeMusic Electron 内核）。
// 首次运行时在页面顶部显示横幅，用户确认后写入 localStorage.settings.apiMode = 'on'。
// 后续运行直接跳过，不再打扰。

(function () {
    const CONSENT_KEY = '__taskbarLyrics_apiModeConsent';

    // DOM 就绪状态检测（兼容 document_start 注入和极端时序）
    function whenReady(fn) {
        if (document.body) {
            fn();
        } else if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            // readyState 为 interactive/complete 但 body 仍为 null 的极端情况
            // 使用 MutationObserver 等待 body 出现
            var obs = new MutationObserver(function () {
                if (document.body) {
                    obs.disconnect();
                    fn();
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

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

    function showConsentBanner() {
        if (document.getElementById('taskbarLyrics-consent-banner')) return;

        var banner = document.createElement('div');
        banner.id = 'taskbarLyrics-consent-banner';
        banner.style.cssText = [
            'position:fixed;top:0;left:0;right:0;z-index:999999',
            'background:#1e1e2e;color:#cdd6f4;font-family:-apple-system,sans-serif',
            'font-size:14px;padding:14px 24px',
            'display:flex;align-items:center;justify-content:center;gap:16px',
            'border-bottom:1px solid #45475a;box-shadow:0 2px 8px rgba(0,0,0,0.3)'
        ].join(';');

        var text = document.createElement('span');
        text.textContent = 'TaskbarLyrics 插件需要开启 API 模式以接收歌词数据，是否允许？';

        var btnEnable = document.createElement('button');
        btnEnable.textContent = '允许';
        btnEnable.style.cssText = 'background:#89b4fa;color:#1e1e2e;border:none;padding:6px 18px;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px';
        btnEnable.onclick = function () {
            localStorage.setItem(CONSENT_KEY, '1');
            enableApiMode();
            var msg = document.createElement('span');
            msg.textContent = '已开启，重启 MoeKoeMusic 后生效';
            msg.style.cssText = 'color:#a6e3a1;font-size:13px';
            btnEnable.replaceWith(msg);
            btnReject.remove();
            setTimeout(function () { banner.remove(); }, 3000);
        };

        var btnReject = document.createElement('button');
        btnReject.textContent = '拒绝';
        btnReject.style.cssText = 'background:transparent;color:#a6adc8;border:1px solid #45475a;padding:6px 18px;border-radius:6px;cursor:pointer;font-size:13px';
        btnReject.onclick = function () {
            localStorage.setItem(CONSENT_KEY, '0');
            banner.remove();
        };

        banner.appendChild(text);
        banner.appendChild(btnEnable);
        banner.appendChild(btnReject);
        document.body.insertBefore(banner, document.body.firstChild);
    }

    // ---- 主流程 ----
    whenReady(function () {
        var consent = localStorage.getItem(CONSENT_KEY);
        if (consent === '1') {
            enableApiMode();
        } else if (consent === '0') {
            // 用户曾明确拒绝，不再提示
        } else {
            showConsentBanner();
        }
    });
})();
