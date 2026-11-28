/* ============================================================
   gamedistribution-bridge.js  —  GameDistribution HTML5 SDK 适配层
   gameId 通过 ?gd_game_id=xxx 或 localStorage.gd_game_id 提供。
   没有 gameId 时自动降级为中性版本，不加载外部 SDK。
   ============================================================ */

(function () {
    'use strict';

    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('gd_game_id') || HFStorage.getItem('gd_game_id') || '';
    const SDK_URL = 'https://html5.api.gamedistribution.com/main.min.js';
    const READY_TIMEOUT_MS = 3000;

    let startResolve;
    let loaded = false;

    const readyPromise = new Promise((resolve) => { startResolve = resolve; });
    window.__gdReady = Promise.race([
        readyPromise,
        new Promise((resolve) => setTimeout(() => {
            if (!loaded) window.__gdStatus = 'timeout';
            resolve();
        }, READY_TIMEOUT_MS)),
    ]);

    function markReady(status) {
        if (loaded) return;
        loaded = true;
        window.__gdStatus = status;
        startResolve();
    }

    function handleSdkEvent(event) {
        const name = event && event.name;
        if (name === 'SDK_READY') {
            markReady('ready');
        } else if (name === 'SDK_GAME_START') {
            try { window.dispatchEvent(new CustomEvent('gd-game-start')); } catch (e) { /* noop */ }
        } else if (name === 'SDK_GAME_PAUSE') {
            try { window.dispatchEvent(new CustomEvent('gd-game-pause')); } catch (e) { /* noop */ }
        } else if (name === 'SDK_ERROR') {
            console.warn('[gd-bridge] SDK error', event);
            markReady('error');
        }
    }

    window.GD_OPTIONS = {
        debug: false,
        gameId: gameId,
        advertisementSettings: { autoplay: true },
        onEvent: handleSdkEvent,
    };

    window.GDGameBridge = {
        isAvailable() { return !!(window.gdsdk && gameId); },
        showAd() {
            if (!window.gdsdk || typeof window.gdsdk.showAd !== 'function') return;
            window.gdsdk.showAd();
        },
        openConsole() {
            if (window.gdsdk && typeof window.gdsdk.openConsole === 'function') window.gdsdk.openConsole();
        },
    };

    window.addEventListener('gd-game-start', () => {
        if (!HFStorage.getItem('farm_legal_consent_v1_1_0')) return;
        try { window.gdsdk.gameplayStart && window.gdsdk.gameplayStart(); } catch (e) { /* noop */ }
    });

    if (!gameId) {
        markReady('no-game-id');
        console.warn('[gd-bridge] no gameId; running in fallback mode');
        return;
    }

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
        markReady('load-error');
    };
    document.head.appendChild(script);
})();
