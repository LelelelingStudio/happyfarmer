/* ============================================================
   crazygame-bridge.js  —  CrazyGames SDK v3 适配层
   仅用于 happyfarmer-crazygame/ 文件夹，不修改原版游戏代码。
   ============================================================ */

(function () {
    'use strict';

    const SAVE_KEY = 'farm_game_save_v1';
    const REMOTE_SAVE_KEY = 'happyfarmer.save.v1';
    const CONSENT_KEY = 'farm_legal_consent_v1_1_0';

    let sdk = null;
    let saveSyncTimer = null;
    let syncingFromCloud = false;
    let lastLevel = -1;
    let happyShown = false;
    let mutedBeforeAd = null;

    const log = (...args) => console.log('[crazygame-bridge]', ...args);
    const warn = (...args) => console.warn('[crazygame-bridge]', ...args);

    const INIT_TIMEOUT_MS = 2500;

    function safe(fn) {
        try { return Promise.resolve(fn()); }
        catch (e) { return Promise.reject(e); }
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((resolve) => setTimeout(() => resolve(false), ms)),
        ]);
    }

    function setGameMuted(muted) {
        try {
            if (typeof gameState !== 'undefined' && gameState && gameState.settings) {
                gameState.settings.bgmEnabled = !muted;
            }
            if (muted && typeof audio !== 'undefined' && audio.pauseBgm) audio.pauseBgm();
        } catch (e) { /* game not booted yet */ }
    }

    function applySdkMuteSettings() {
        if (!sdk || !sdk.game || !sdk.game.settings) return;
        if (sdk.game.settings.muteAudio) setGameMuted(true);
    }

    function patchStorageSync() {
        if (!sdk || !sdk.data || !sdk.data.setItem) return;
        const original = Storage.prototype.setItem;
        if (original.__crazyPatched) return;

        const patched = function (key, value) {
            const result = original.call(this, key, value);
            if (key === SAVE_KEY && !syncingFromCloud) {
                clearTimeout(saveSyncTimer);
                saveSyncTimer = setTimeout(() => {
                    const payload = String(value == null ? '' : value);
                    safe(() => sdk.data.setItem(REMOTE_SAVE_KEY, payload))
                        .catch((e) => warn('cloud save failed', e));
                }, 800);
            }
            return result;
        };
        patched.__crazyPatched = true;
        Storage.prototype.setItem = patched;
    }

    function bindGameEvents() {
        document.addEventListener('click', (event) => {
            const btn = event.target && event.target.closest
                ? event.target.closest('#start-new-game-btn,#start-continue-btn')
                : null;
            if (!btn) return;
            if (!HFStorage.getItem(CONSENT_KEY)) return;
            try { sdk.game.gameplayStart(); } catch (e) { /* noop */ }
        }, true);

        const stop = () => {
            try { sdk.game.gameplayStop(); } catch (e) { /* noop */ }
        };
        window.addEventListener('beforeunload', stop);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                stop();
            } else if (HFStorage.getItem(CONSENT_KEY)) {
                try { sdk.game.gameplayStart(); } catch (e) { /* noop */ }
            }
        });

        if (sdk.game.addSettingsChangeListener) {
            sdk.game.addSettingsChangeListener(() => applySdkMuteSettings());
        }
    }

    function bindLoadingStop() {
        const check = () => {
            const screen = document.getElementById('start-screen');
            if (!screen || !screen.classList.contains('show')) return false;
            try { sdk.game.loadingStop(); } catch (e) { /* noop */ }
            return true;
        };
        if (check()) return;
        const observer = new MutationObserver(() => {
            if (check()) observer.disconnect();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    function bindProgressPolling() {
        setInterval(() => {
            try {
                const level = (typeof gameState !== 'undefined' && gameState && gameState.level) ? gameState.level : 0;
                if (!level || level === lastLevel) return;
                lastLevel = level;
                if (sdk.game.reportGameCompletedPercentage) {
                    sdk.game.reportGameCompletedPercentage(Math.min(100, level));
                }
                if (!happyShown && level >= 100) {
                    happyShown = true;
                    if (sdk.game.happytime) sdk.game.happytime();
                }
            } catch (e) { /* noop */ }
        }, 5000);
    }

    window.CrazyGameBridge = {
        isAvailable() { return !!(sdk && sdk.game); },

        requestAd(type, callbacks) {
            if (!sdk || !sdk.ad || !sdk.ad.requestAd) return Promise.resolve(false);
            const cb = callbacks || {};
            const wrapped = {
                adStarted: () => {
                    try { mutedBeforeAd = !!(typeof gameState !== 'undefined' && gameState.settings && gameState.settings.bgmEnabled); } catch (e) { mutedBeforeAd = null; }
                    setGameMuted(true);
                    if (cb.adStarted) cb.adStarted();
                },
                adFinished: () => {
                    if (mutedBeforeAd === true) setGameMuted(false);
                    if (cb.adFinished) cb.adFinished();
                },
                adError: (error) => {
                    if (mutedBeforeAd === true) setGameMuted(false);
                    if (cb.adError) cb.adError(error);
                },
            };
            return safe(() => sdk.ad.requestAd(type === 'rewarded' ? 'rewarded' : 'midgame', wrapped));
        },

        getUserToken() {
            if (!sdk || !sdk.user || !sdk.user.getUserToken) return Promise.resolve(null);
            return safe(() => sdk.user.getUserToken({ signingKeyType: 'IN_GAME_AUTH' }));
        },

        happytime() {
            if (!sdk || !sdk.game || !sdk.game.happytime) return;
            sdk.game.happytime();
        },

        reportProgress(percent) {
            if (!sdk || !sdk.game || !sdk.game.reportGameCompletedPercentage) return;
            sdk.game.reportGameCompletedPercentage(Math.max(0, Math.min(100, Number(percent) || 0)));
        },

        cloudSave() {
            const value = HFStorage.getItem(SAVE_KEY);
            if (!value || !sdk || !sdk.data || !sdk.data.setItem) return Promise.resolve(false);
            return safe(() => sdk.data.setItem(REMOTE_SAVE_KEY, String(value)));
        },
    };

    window.__crazyReady = (async () => {
        try {
            if (!window.CrazyGames || !window.CrazyGames.SDK) {
                window.__crazyReadyStatus = 'unavailable';
                warn('SDK unavailable; running in fallback mode');
                return;
            }
            sdk = window.CrazyGames.SDK;
            const initialized = await withTimeout(safe(() => sdk.init()), INIT_TIMEOUT_MS);
            if (!initialized) {
                window.__crazyReadyStatus = 'timeout';
                warn('SDK init timed out; starting game anyway');
                return;
            }
            window.__crazyReadyStatus = 'ready';
            log('SDK initialized');
            try { sdk.game.loadingStart(); } catch (e) { /* noop */ }

            try {
                const remote = await safe(() => sdk.data.getItem(REMOTE_SAVE_KEY));
                if (remote && typeof remote === 'string') {
                    const local = HFStorage.getItem(SAVE_KEY);
                    if (!local || remote !== local) {
                        syncingFromCloud = true;
                        HFStorage.setItem(SAVE_KEY, remote);
                        syncingFromCloud = false;
                        log('cloud save restored');
                    }
                }
            } catch (e) {
                warn('cloud load failed', e);
            }

            patchStorageSync();
            bindGameEvents();
            bindLoadingStop();
            bindProgressPolling();
            applySdkMuteSettings();
        } catch (e) {
            window.__crazyReadyStatus = 'error';
            warn('initialization failed', e);
        }
    })();
})();
