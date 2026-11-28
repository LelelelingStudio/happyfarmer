/* ============================================================
   poki-bridge.js  —  Poki SDK v2 完整事件适配层
   ------------------------------------------------------------
   覆盖 Inspector 检查项：
   - PokiSDK.init()
   - gameLoadingFinished()（资源真实加载完成后调用，不依赖起始屏 class）
   - gameplayStart() / gameplayStop()（严格成对）
   - commercialBreak() / rewardedBreak() 前后暂停与恢复玩法
   - 广告结束后精确恢复玩家原本的静音设置，不会擅自取消静音
   SDK 缺失时自动降级；?poki_mock=1 可在本地查看完整事件序列。
   ============================================================ */

(function () {
    'use strict';

    const SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';
    const SDK_WAIT_MS = 2500;
    const READY_TIMEOUT_MS = 3000;
    const LOADING_POLL_MS = 200;
    const LOADING_POLL_MAX_MS = 30000;
    const events = [];

    let resolveReady;
    let settled = false;
    let sdkReady = false;
    let poki = null;
    let gameplayActive = false;
    let pausedByModal = false;
    let loadingNotified = false;
    let adPlaying = false;
    let adChain = Promise.resolve();
    let lastCommercialAt = 0;
    let resumeAfterModal = false;

    function record(name, detail) {
        events.push({ name, at: Date.now(), detail: detail || null });
        window.__pokiEvents = events.slice();
        if (window.__pokiDebug) console.log('[poki-bridge]', name, detail || '');
    }

    let lastEventName = null;
    let lastEventAt = 0;

    function callSdk(name, ...args) {
        if (!poki || typeof poki[name] !== 'function') return;
        const now = Date.now();
        if (name === lastEventName && now - lastEventAt < 300) return;
        lastEventName = name;
        lastEventAt = now;
        record(name, args.length ? args[0] : undefined);
        try { poki[name](...args); } catch (e) { /* SDK may be in a transient state */ }
    }

    function safe(fn) {
        try { return Promise.resolve(fn()); }
        catch (e) { return Promise.reject(e); }
    }

    function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

    /* 本地 mock：用 ?poki_mock=1 验证事件顺序，不依赖真实 SDK。
       init 由桥接层统一 record，保证 mock / 真实 SDK 事件序列一致。 */
    if (new URLSearchParams(location.search).get('poki_mock') === '1') {
        window.PokiSDK = {
            init: () => Promise.resolve(),
            enableEventTracking: () => {},
            getLanguage: () => new URLSearchParams(location.search).get('poki_lang') || 'en',
            gameLoadingFinished: () => {},
            gameplayStart: () => {},
            gameplayStop: () => {},
            commercialBreak: (cb) => { if (cb) cb(); return Promise.resolve(); },
            rewardedBreak: (cb) => { if (cb) cb(); return Promise.resolve(true); },
        };
    }

    const ready = new Promise((resolve) => { resolveReady = resolve; });
    window.__pokiReady = Promise.race([
        ready,
        new Promise((resolve) => setTimeout(() => {
            if (!settled) window.__pokiStatus = 'timeout';
            resolve();
        }, READY_TIMEOUT_MS)),
    ]);

    function markReady(status) {
        if (settled) return;
        settled = true;
        window.__pokiStatus = status;
        resolveReady();
    }

    /* 精确记录并恢复玩家静音状态，绝不把原本静音的玩家强行取消静音 */
    function readMuted() {
        try {
            if (typeof gameState !== 'undefined' && gameState && gameState.settings) {
                return gameState.settings.bgmEnabled === false;
            }
        } catch (e) { /* game may not be booted yet */ }
        return false;
    }

    function setGameMuted(muted) {
        try {
            if (typeof gameState !== 'undefined' && gameState && gameState.settings) {
                gameState.settings.bgmEnabled = !muted;
            }
            if (muted && typeof audio !== 'undefined' && audio.pauseBgm) audio.pauseBgm();
        } catch (e) { /* game may not be booted yet */ }
    }

    function isPaused() {
        /* 起始屏本身不计为暂停，否则点击「新游戏」后会立刻发出 gameplayStop */
        const dialogs = document.querySelectorAll(
            '.modal-overlay, .dialog.show, .modal.show, .drawer.open, .drawer.show'
        );
        for (const el of dialogs) {
            if (el.id === 'start-screen') continue;
            if (!el.closest || !el.closest('#start-screen')) return true;
        }
        return false;
    }

    function startGameplay() {
        if (!sdkReady || gameplayActive) return;
        if (document.hidden || isPaused()) return;
        gameplayActive = true;
        pausedByModal = false;
        callSdk('gameplayStart');
    }

    function stopGameplay() {
        if (!sdkReady || !gameplayActive) return;
        gameplayActive = false;
        callSdk('gameplayStop');
    }

    /* 页面隐藏 / 广告 / 离开：彻底停止，不保留「由弹窗暂停」的记忆 */
    function hardStop() {
        pausedByModal = false;
        resumeAfterModal = false;
        stopGameplay();
    }

    function syncPauseState() {
        if (!gameplayActive && !pausedByModal && !resumeAfterModal) return;
        const paused = isPaused();
        if (paused && !pausedByModal) {
            pausedByModal = true;
            stopGameplay();
        } else if (!paused && (pausedByModal || resumeAfterModal)) {
            pausedByModal = false;
            resumeAfterModal = false;
            startGameplay();
        }
    }

    /* 资源真实加载完成（loader 放行）或起始屏出现，二者满足其一即通知 Poki */
    function assetsReady() {
        if (window.__loaderReleased === true) return true;
        if (window.__assetLoad && window.__assetLoad.settled === true) return true;
        const screen = document.getElementById('start-screen');
        return !!(screen && screen.classList.contains('show'));
    }

    function notifyLoadingFinished() {
        if (!sdkReady || loadingNotified || !assetsReady()) return;
        loadingNotified = true;
        callSdk('gameLoadingFinished');
    }

    /* 所有广告调用串行化：Poki 不允许两个 break 重叠，重叠会立刻返回 false */
    function withAdBreak(method) {
        if (!sdkReady) return Promise.resolve(false);
        const run = async () => {
            const wasActive = gameplayActive;
            const wasMuted = readMuted();
            adPlaying = true;
            window.__pokiAdPlaying = true;
            if (wasActive) hardStop();
            setGameMuted(true);
            record(method);
            try {
                const result = await safe(() => poki[method](() => setGameMuted(true)));
                return result === true || (method === 'commercialBreak' && result !== false);
            } catch (e) {
                return false;
            } finally {
                setGameMuted(wasMuted);
                adPlaying = false;
                window.__pokiAdPlaying = false;
                if (wasActive && !document.hidden) {
                    if (isPaused()) resumeAfterModal = true;   /* 奖励面板还开着，关掉后再恢复 */
                    else startGameplay();
                }
            }
        };
        adChain = adChain.then(run, run);
        return adChain;
    }

    function isAdPlaying() {
        return adPlaying;
    }

    window.PokiGameBridge = {
        isAvailable() { return !!sdkReady; },
        isAdPlaying,
        events() { return events.slice(); },
        status() { return window.__pokiStatus || 'pending'; },
        language() { return window.__pokiLanguage || null; },
        state() {
            return {
                sdkReady,
                gameplayActive,
                pausedByModal,
                loadingNotified,
                hidden: document.hidden,
                paused: isPaused(),
            };
        },
        gameplayStart: startGameplay,
        gameplayStop: stopGameplay,
        gameLoadingFinished: notifyLoadingFinished,
        commercialBreak() { return withAdBreak('commercialBreak'); },
        rewardedBreak() { return withAdBreak('rewardedBreak'); },
    };

    function bindEvents() {
        /* 加载完成：轮询 loader 状态 + DOM 变化双保险，不依赖起始屏 class */
        notifyLoadingFinished();
        const loadObserver = new MutationObserver(notifyLoadingFinished);
        loadObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
        const pollDeadline = Date.now() + LOADING_POLL_MAX_MS;
        const pollLoading = () => {
            if (loadingNotified || Date.now() > pollDeadline) return;
            notifyLoadingFinished();
            setTimeout(pollLoading, LOADING_POLL_MS);
        };
        setTimeout(pollLoading, LOADING_POLL_MS);
        window.addEventListener('load', notifyLoadingFinished, { once: true });

        /* 玩法开始：新游戏 / 继续 / 导入存档立刻发 gameplayStart。
           不再在开头插商业广告：那会延迟 gameplayStart，也会和玩家马上点的
           奖励广告重叠，导致 rewardedBreak 立刻返回 false（领取失败）。 */
        document.addEventListener('click', (event) => {
            const btn = event.target && event.target.closest
                ? event.target.closest('#start-new-game-btn,#start-continue-btn,#import-save-btn')
                : null;
            if (!btn) return;
            startGameplay();
        }, true);

        /* 商业广告放到自然节点：点「下一天」时最多每 45 秒一次 */
        document.addEventListener('click', (event) => {
            const btn = event.target && event.target.closest
                ? event.target.closest('#next-day-btn')
                : null;
            if (!btn || !sdkReady || adPlaying) return;
            const now = Date.now();
            if (now - lastCommercialAt < 45000) return;
            lastCommercialAt = now;
            if (poki && typeof poki.commercialBreak === 'function') {
                withAdBreak('commercialBreak').catch(() => {});
            }
        }, true);

        /* 暂停 / 恢复：弹窗、抽屉、页面隐藏都算暂停 */
        const pauseObserver = new MutationObserver(syncPauseState);
        pauseObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) hardStop();
            else if (!isPaused()) startGameplay();
        });
        window.addEventListener('beforeunload', hardStop);
        window.addEventListener('pagehide', hardStop);
    }

    /* 按 Poki SDK 语言自动切换游戏语言；玩家手动选过语言后不再覆盖 */
    function applyPokiLanguage() {
        if (!poki || typeof poki.getLanguage !== 'function') return;
        let raw = '';
        try { raw = poki.getLanguage() || ''; } catch (e) { return; }
        if (!raw) return;
        const target = /^zh/i.test(raw) ? 'zh' : 'en';
        window.__pokiLanguage = { raw, target };

        const started = Date.now();
        const apply = () => {
            const lc = window.languageControl;
            if (!lc || typeof gameState === 'undefined' || !gameState || !gameState.settings) {
                if (Date.now() - started < 8000) setTimeout(apply, 100);
                return;
            }
            try {
                const pref = typeof lc.getStoredLanguagePreference === 'function'
                    ? lc.getStoredLanguagePreference() : null;
                if (pref === 'zh' || pref === 'en') return;   /* 玩家已有明确偏好 */
                if (gameState.settings.language && gameState.settings.language !== 'auto') return;
                const applyFn = (typeof window.setLanguage === 'function')
                    ? window.setLanguage
                    : lc.setLanguage;
                if (typeof applyFn === 'function') applyFn(target);
            } catch (e) {
                console.warn('[poki-bridge] language auto-apply failed', e);
            }
        };
        setTimeout(apply, 0);
    }

    async function waitForSdk() {
        if (window.PokiSDK) return true;
        const script = document.createElement('script');
        script.src = SDK_URL;
        script.async = false;
        document.head.appendChild(script);
        const start = Date.now();
        while (Date.now() - start < SDK_WAIT_MS) {
            await sleep(50);
            if (window.PokiSDK) return true;
        }
        return false;
    }

    (async () => {
        try {
            if (!await waitForSdk()) throw new Error('PokiSDK not found');
            poki = window.PokiSDK;
            if (poki.setDebug) poki.setDebug(false);
            record('init');
            await safe(() => poki.init());
            if (typeof poki.enableEventTracking === 'function') poki.enableEventTracking();
            sdkReady = true;
            markReady('ready');
            applyPokiLanguage();
            bindEvents();
        } catch (e) {
            console.warn('[poki-bridge] SDK unavailable; running in fallback mode', e);
            markReady('unavailable');
        }
    })();
})();
