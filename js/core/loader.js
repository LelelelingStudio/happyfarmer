/* ============================================================
   loader.js  —  资源加载进度（manifest 驱动）
   ------------------------------------------------------------
   加载策略（v1.2.2 起）：
   - 「关键路径」= html / css / js / langdata / 关键图 / readyState，
     这些真正结束后进度条才走 100% 并放行进入游戏。
   - 「可选资源」= 头像素材库、BGM 元数据等。放行之后在后台空闲预取，
     失败只记录，不影响进入游戏，也不会拖住进度条。
   - 关键资源失败时停留在加载页并显示重试按钮，绝不带半加载状态进入游戏。
   - 关键路径总等待有上限（LOADER_CRITICAL_CAP_MS）：极端慢网下先放行，
     明确标记 degraded，剩余资源继续在后台加载（不伪装成「全部成功」）。
   权重（总和 100%）：
     html 5% · css 10% · js 20% · langdata 40% · images 15% · other 10%
   ============================================================ */

const LOADER_WEIGHTS = {
    html:     5,
    css:      10,
    js:       20,
    langdata: 40,
    images:   15,
    other:    10,
};

const LOADER_STAGE_LABEL = {
    html:     'loader.stageHtml',
    css:      'loader.stageCss',
    js:       'loader.stageJs',
    langdata: 'loader.stageLangdata',
    images:   'loader.stageImages',
    other:    'loader.stageOther',
};

const LOADER_IMAGE_CONCURRENCY = 8;       /* 关键图预取并发 */
const LOADER_BG_CONCURRENCY = 6;          /* 可选资源后台预取并发 */
const LOADER_BG_DELAY_MS = 1200;          /* 放行后延迟，先把开始界面铺出来 */
const LOADER_MIN_VISIBLE_MS = 900;        /* 进度条至少可见时间，避免一闪而过 */
const LOADER_SCRIPT_TIMEOUT_MS = 15000;   /* CSS / 主脚本等待上限 */
const LOADER_DATA_TIMEOUT_MS = 12000;     /* 语言数据等待上限 */
const LOADER_AUDIO_TIMEOUT_MS = 12000;    /* 单个音频元数据等待上限（后台用） */
const LOADER_IMAGE_TIMEOUT_MS = 12000;    /* 单张图片等待上限 */
const LOADER_READY_TIMEOUT_MS = 8000;     /* document.readyState 等待上限 */
const LOADER_CRITICAL_CAP_MS = 12000;     /* 关键路径总等待上限（兜底放行） */

/* 对外可观测状态：浏览器控制台可直接查看 window.__assetLoad */
window.__assetLoad = {
    settled: false,
    ok: false,
    degraded: false,
    stage: 'html',
    total: 6,
    done: 0,
    failed: [],
    optionalFailed: [],
    background: { total: 0, done: 0, started: false, finished: false },
    startedAt: 0,
    finishedAt: 0,
};

/* -------- UI -------- */

function _loaderEls() {
    return {
        screen: document.getElementById('loading-screen'),
        fill: document.getElementById('loading-progress-fill'),
        percent: document.getElementById('loading-percent'),
        status: document.getElementById('loading-status'),
    };
}

function _loaderText(key, fallback) {
    try {
        const value = (typeof t === 'function') ? t(key) : '';
        return (value && value !== key) ? value : fallback;
    } catch (e) {
        return fallback;
    }
}

/** 生成逐株可控制的麦子，替换静态 emoji 字符串 */
function _loaderBuildWheat() {
    const rows = document.querySelectorAll('.loading-wheat-row');
    if (!rows.length) return;
    rows.forEach((row) => {
        if (row.childElementCount) return;
        const count = 13;
        for (let i = 0; i < count; i++) {
            const pos = ((i + 0.5) / count * 100).toFixed(2);
            const stalk = document.createElement('span');
            stalk.className = 'wheat-stalk';
            stalk.dataset.pos = pos;
            stalk.style.left = pos + '%';
            stalk.innerHTML = '<span class="sprout">🌱</span><span class="grown">🌾</span>';
            row.appendChild(stalk);
        }
    });
}

/**
 * 麦子状态机（按进度驱动，不依赖计时器）：
 *   0→50  农夫向右割：pos <= farmerX 的麦子 cut，其余 whole
 *   50→100 回头重割：全部麦子先整批进入 regrowing（🌱→🌾 逐个长出），
 *          长齐后农夫向左走，pos >= farmerX 的麦子 cut，其余 whole
 * 关键：回头时「已走过」的是右侧（pos >= farmerX），判定方向必须反转，
 *       而且 regrowing 只发生一次，不能每帧把长好的麦子重新设为生长中。
 */
function _loaderUpdateWheat(farmerX, returning, value) {
    const stalks = document.querySelectorAll('.wheat-stalk');
    if (!stalks.length) return;

    if (value <= 1) {
        stalks.forEach((stalk) => {
            delete stalk.dataset.state;
            delete stalk.dataset.regrown;
            delete stalk.dataset.regrowTriggered;
            stalk.classList.remove('cut', 'regrowing');
            clearTimeout(stalk._regrowTimer);
        });
    }

    /* 刚过 50%：先把所有割掉的麦子一次性安排长回来，逐个从 🌱 变 🌾 */
    if (returning && !stalks[0].dataset.regrowTriggered) {
        stalks.forEach((stalk, i) => {
            stalk.dataset.regrowTriggered = '1';
            clearTimeout(stalk._regrowTimer);
            stalk._regrowTimer = setTimeout(() => {
                if (stalk.dataset.state !== 'regrowing') return;
                stalk.dataset.regrown = '1';
                stalk.dataset.state = 'whole';
                stalk.classList.remove('regrowing');
            }, 80 + i * 45);
            stalk.dataset.state = 'regrowing';
            stalk.classList.remove('cut');
            stalk.classList.add('regrowing');
        });
    }

    stalks.forEach((stalk) => {
        /* 生长动画期间由 timer 接管，农夫不提前割 */
        if (returning && stalk.dataset.regrown !== '1') return;

        const pos = parseFloat(stalk.dataset.pos) || 0;
        /* 去程割左边，回程割右边——方向相反 */
        const shouldCut = returning ? (pos >= farmerX) : (pos <= farmerX);
        const state = shouldCut ? 'cut' : 'whole';
        if (stalk.dataset.state === state) return;

        stalk.dataset.state = state;
        stalk.classList.toggle('cut', state === 'cut');
        stalk.classList.remove('regrowing');
        if (state === 'cut') {
            delete stalk.dataset.regrown;
            clearTimeout(stalk._regrowTimer);
        }
    });
}

function _loaderSetProgress(percent, stageKey) {
    const { screen, fill, percent: pctEl, status } = _loaderEls();
    const value = Math.max(0, Math.min(100, percent));
    if (fill) fill.style.width = value.toFixed(2) + '%';
    if (pctEl) pctEl.textContent = value.toFixed(1) + '%';
    if (screen) {
        /* 0→50 从左割到右；50→100 回头发现麦子长回来了，再割回起点 */
        const rawX = value <= 50 ? value * 2 : (100 - value) * 2;
        const farmerX = Math.max(4, Math.min(96, rawX));
        screen.style.setProperty('--farmer-x', farmerX.toFixed(2) + '%');
        screen.classList.toggle('returning', value > 50);
        /* 气泡只在刚回头、麦子长回来的一小段显示，别一路喊到 66% */
        screen.classList.toggle('shout', value >= 50 && value <= 58);
        _loaderUpdateWheat(farmerX, value > 50, value);
        const shout = document.getElementById('loading-shout');
        if (shout) {
            const fallbackZh = (document.documentElement.lang || '').indexOf('zh') === 0;
            const shoutText = _loaderText(
                'loader.shout',
                fallbackZh ? '啊！麦子又长回来了' : 'Oh! The wheat grew back!'
            );
            if (shout.textContent !== shoutText) shout.textContent = shoutText;
        }
    }
    if (stageKey) {
        window.__assetLoad.stage = stageKey;
        if (status && !status.dataset.loaderError) {
            status.textContent = _loaderText(
                LOADER_STAGE_LABEL[stageKey] || 'loader.stageOther',
                'Loading…'
            );
        }
    }
}

/** 关键资源失败：停留在加载页，显示错误与重试入口 */
function _loaderShowError(message) {
    const { screen, status, fill } = _loaderEls();
    window.__loaderFailed = true;
    try {
        if (status) {
            status.dataset.loaderError = '1';
            status.setAttribute('role', 'alert');
            status.textContent = message || _loaderText('loader.errorTitle', 'Failed to load required resources.');
        }
        if (screen) screen.classList.add('error');
        if (fill) fill.style.background = 'var(--c-danger, #B42318)';
        let btn = document.getElementById('loader-retry-btn');
        if (!btn && screen) {
            btn = document.createElement('button');
            btn.id = 'loader-retry-btn';
            btn.type = 'button';
            btn.className = 'loader-retry-btn';
            btn.textContent = _loaderText('loader.errorRetry', 'Retry');
            btn.addEventListener('click', () => location.reload());
            screen.appendChild(btn);
        }
    } catch (e) {
        console.error('[loader] failed to render error state', e);
    }
    console.error('[loader] critical load failure:', message);
}

window.__loaderShowError = _loaderShowError;

/* -------- 小工具 -------- */

function _loaderSleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** 单项任务：成功 / 失败都 settle，超时一律记为失败 */
function _settle(task, timeoutMs) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);
        try {
            task(finish);
        } catch (e) {
            finish({ ok: false, reason: (e && e.message) || 'error' });
        }
    });
}

/** 轮询条件，直到成立或超时；超时返回 ok:false，绝不假装成功 */
function _waitSettled(check, timeoutMs) {
    const started = Date.now();
    return new Promise((resolve) => {
        const tick = () => {
            let ready = false;
            try { ready = !!check(); } catch (e) { /* keep waiting */ }
            if (ready) { resolve({ ok: true, reason: null }); return; }
            if (Date.now() - started >= timeoutMs) {
                resolve({ ok: false, reason: 'timeout' });
                return;
            }
            setTimeout(tick, 40);
        };
        tick();
    });
}

/** 带进度的并发池；每个结果都是 {ok, reason}，失败会被收集而不是吞掉 */
function _loadPool(items, loader, concurrency, onProgress) {
    return new Promise((resolve) => {
        const failed = [];
        if (!items || items.length === 0) {
            if (onProgress) onProgress(0, 0, 0);
            resolve({ total: 0, done: 0, failed });
            return;
        }
        let index = 0;
        let done = 0;
        let active = 0;
        const next = () => {
            if (index >= items.length && active === 0) {
                resolve({ total: items.length, done, failed });
                return;
            }
            while (active < concurrency && index < items.length) {
                const item = items[index++];
                active++;
                Promise.resolve()
                    .then(() => loader(item))
                    .catch((e) => ({ ok: false, reason: (e && e.message) || 'error' }))
                    .then((result) => {
                        active--;
                        done++;
                        if (!result || !result.ok) {
                            failed.push({ item, reason: (result && result.reason) || 'error' });
                        }
                        if (onProgress) onProgress(items.length, done, failed.length);
                        next();
                    });
            }
        };
        next();
    });
}

function _preloadImage(src) {
    return _settle((finish) => {
        const img = new Image();
        img.onload = () => finish({ ok: true });
        img.onerror = () => finish({ ok: false, reason: 'error' });
        img.src = src;
    }, LOADER_IMAGE_TIMEOUT_MS);
}

function _preloadAudioMeta(src) {
    return _settle((finish) => {
        const el = new Audio();
        el.preload = 'metadata';
        el.addEventListener('loadedmetadata', () => {
            el.src = '';
            finish({ ok: true });
        }, { once: true });
        el.addEventListener('error', () => {
            el.src = '';
            finish({ ok: false, reason: 'error' });
        }, { once: true });
        el.src = src;
    }, LOADER_AUDIO_TIMEOUT_MS);
}

/* -------- 主流程 -------- */

let _loaderRunning = null;
let _loaderReleased = false;

/** 放行：通知 main.js 进入起始弹窗（只生效一次，且只在真实完成后调用） */
function releaseLoader() {
    if (_loaderReleased) return;
    _loaderReleased = true;
    window.__loaderReleased = true;
    try {
        if (typeof window.__loaderRelease === 'function') window.__loaderRelease();
        else window.__loaderPendingRelease = true;   /* main.js 还没挂钩子，等它挂上再放行 */
    } catch (e) {
        console.error('[loader] release hook failed', e);
    }
}

/**
 * 兼容旧调用点：不再「强制 100% 放行」。
 * 任何兜底都必须走真实等待，这里只记录一次警告。
 */
function forceFinishLoading() {
    console.warn('[loader] forceFinishLoading() is deprecated; real completion is required before release');
}

/* -------- 可选资源：放行后后台空闲预取 -------- */

let _bgStarted = false;

/**
 * 头像素材库（180 张）和 BGM 元数据都不在关键路径上：
 * 开始界面先出来，这些在后台慢慢补，失败只记录不阻断。
 */
function _scheduleBackgroundPrefetch() {
    if (_bgStarted) return;
    _bgStarted = true;

    const manifest = (typeof ASSET_MANIFEST !== 'undefined' && ASSET_MANIFEST) ? ASSET_MANIFEST : null;
    const bg = window.__assetLoad.background;
    const optional = (manifest && manifest.optional) || {};
    const images = [...(optional.images || [])];
    const audios = [...(optional.audio || [])];
    bg.total = images.length + audios.length;

    if (!bg.total) {
        bg.finished = true;
        return;
    }

    const run = () => {
        bg.started = true;
        const track = (loader) => (item) => loader(item).then((result) => {
            bg.done++;
            if (!result || !result.ok) {
                window.__assetLoad.optionalFailed.push({ item, reason: (result && result.reason) || 'error' });
            }
            return result;
        });
        _loadPool(images, track(_preloadImage), LOADER_BG_CONCURRENCY)
            .then(() => _loadPool(audios, track(_preloadAudioMeta), 2))
            .then(() => {
                bg.finished = true;
                const failed = window.__assetLoad.optionalFailed.length;
                console.log(`[loader] background prefetch done: ${bg.done}/${bg.total} (failed ${failed})`);
            })
            .catch((e) => {
                bg.finished = true;
                console.warn('[loader] background prefetch error:', e && e.message);
            });
    };

    setTimeout(() => {
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
        else run();
    }, LOADER_BG_DELAY_MS);
}

async function runAssetLoading() {
    if (_loaderRunning) return _loaderRunning;

    _loaderRunning = (async () => {
        const state = window.__assetLoad;
        const startedAt = Date.now();
        state.startedAt = startedAt;
        state.failed.length = 0;

        /* 关键路径总等待兜底：极端慢网（移动数据 / 弱信号）下，
           脚本已经就位时先放行，明确标记 degraded，剩余资源后台继续。 */
        const capTimer = setTimeout(() => {
            if (_loaderReleased) return;
            const scriptsReady = typeof window.bootstrap === 'function' && !!window.__dataReadyPromise;
            if (!scriptsReady) return;   /* 连脚本都没到，强行放行没有意义 */
            state.degraded = true;
            state.settled = true;
            state.ok = false;
            state.finishedAt = Date.now();
            _loaderSetProgress(100, 'other');
            const { status } = _loaderEls();
            if (status && !status.dataset.loaderError) {
                status.textContent = _loaderText(
                    'loader.degradedNotice',
                    'Still loading in background — entering the game.'
                );
            }
            console.warn('[loader] critical wait exceeded cap; releasing in degraded mode');
            releaseLoader();
            _scheduleBackgroundPrefetch();
        }, LOADER_CRITICAL_CAP_MS);

        const manifest = (typeof ASSET_MANIFEST !== 'undefined' && ASSET_MANIFEST) ? ASSET_MANIFEST : null;
        let progress = 0;

        const add = (weight, ratio, stageKey) => {
            progress += weight * Math.max(0, Math.min(1, ratio));
            state.done++;
            _loaderSetProgress(progress, stageKey);
        };
        const noteFailed = (type, item, reason) => {
            state.failed.push({ type, item, reason: reason || 'error' });
            console.warn('[loader] asset failed:', type, item, reason);
        };
        const abort = (message) => {
            clearTimeout(capTimer);
            state.settled = true;
            state.ok = false;
            state.finishedAt = Date.now();
            _loaderShowError(message);
            return { ok: false, failed: state.failed.slice() };
        };

        /* --- 1. HTML（当前文档已经解析完成） --- */
        _loaderSetProgress(0, 'html');
        await _loaderSleep(40);
        add(LOADER_WEIGHTS.html, 1, 'html');

        if (!manifest) {
            return abort(_loaderText('loader.errorMissingManifest', 'Asset manifest is missing. Please reload.'));
        }

        /* --- 2. CSS：等页面里真实的 <link rel=stylesheet> --- */
        const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
        if (cssLinks.length > 0) {
            const cssCount = { value: 0 };
            const cssResult = await _waitSettled(() => {
                cssCount.value = cssLinks.filter((link) => !!link.sheet).length;
                return cssCount.value === cssLinks.length;
            }, LOADER_SCRIPT_TIMEOUT_MS);
            if (!cssResult.ok) {
                noteFailed('css', `${cssCount.value}/${cssLinks.length}`, cssResult.reason);
            }
            add(LOADER_WEIGHTS.css, cssResult.ok ? 1 : cssCount.value / cssLinks.length, 'css');
        } else {
            add(LOADER_WEIGHTS.css, 1, 'css');
        }
        await _loaderSleep(30);

        /* --- 3. JS：等主入口与数据加载器就位 --- */
        const jsResult = await _waitSettled(() =>
            typeof window.bootstrap === 'function' && !!window.__dataReadyPromise,
            LOADER_SCRIPT_TIMEOUT_MS
        );
        if (!jsResult.ok) {
            noteFailed('js', 'bootstrap/__dataReadyPromise', jsResult.reason);
            return abort(_loaderText('loader.errorScripts', 'Game scripts failed to load. Please check your connection and retry.'));
        }
        add(LOADER_WEIGHTS.js, 1, 'js');
        await _loaderSleep(30);

        /* --- 4. langdata：等动态语言包真正加载完 --- */
        let langResult = { ok: false, reason: 'error' };
        try {
            langResult = await Promise.race([
                window.__dataReadyPromise.then(() => ({ ok: true, reason: null }))
                    .catch((e) => ({ ok: false, reason: (e && e.message) || 'error' })),
                _loaderSleep(LOADER_DATA_TIMEOUT_MS).then(() => ({ ok: false, reason: 'timeout' })),
            ]);
        } catch (e) {
            langResult = { ok: false, reason: (e && e.message) || 'error' };
        }
        if (!langResult.ok) {
            noteFailed('langdata', 'language packs', langResult.reason);
            return abort(_loaderText('loader.errorData', 'Language data failed to load. Please retry.'));
        }
        add(LOADER_WEIGHTS.langdata, 1, 'langdata');
        await _loaderSleep(30);

        /* --- 5. 关键图片（manifest.images，当前一般只有图标，头像已归入 optional） --- */
        const imageList = [...(manifest.images || [])];
        if (imageList.length > 0) {
            const imageResult = await _loadPool(
                imageList,
                (src) => _preloadImage(src),
                LOADER_IMAGE_CONCURRENCY,
                (total, done) => _loaderSetProgress(progress + LOADER_WEIGHTS.images * (done / total), 'images')
            );
            imageResult.failed.forEach((f) => noteFailed('image', f.item, f.reason));
            add(LOADER_WEIGHTS.images, imageResult.done / imageResult.total, 'images');
        } else {
            add(LOADER_WEIGHTS.images, 1, 'images');
        }

        /* --- 6. 其他（字体 / 图标 / 页面 onload） --- */
        const pageResult = await _waitSettled(
            () => document.readyState === 'complete',
            LOADER_READY_TIMEOUT_MS
        );
        if (!pageResult.ok) noteFailed('other', 'document.readyState', pageResult.reason);
        add(LOADER_WEIGHTS.other, pageResult.ok ? 1 : 0.8, 'other');

        const elapsed = Date.now() - startedAt;
        if (elapsed < LOADER_MIN_VISIBLE_MS) {
            await _loaderSleep(LOADER_MIN_VISIBLE_MS - elapsed);
        }

        /* 关键路径全部 settle，允许 100% 与放行 */
        progress = 100;
        _loaderSetProgress(100, 'other');
        state.settled = true;
        state.ok = state.failed.length === 0;
        state.finishedAt = Date.now();

        if (state.failed.length > 0) {
            const { status } = _loaderEls();
            if (status) {
                status.textContent = _loaderText(
                    'loader.partialWarning',
                    'Some critical assets failed to load; continuing anyway.'
                );
            }
            console.warn(`[loader] ${state.failed.length} critical asset(s) failed; see window.__assetLoad.failed`);
        }

        clearTimeout(capTimer);
        console.log(`[loader] critical assets settled in ${((state.finishedAt - startedAt) / 1000).toFixed(2)}s (ok=${state.ok})`);
        releaseLoader();
        /* 放行后再空闲预取头像 / BGM：不影响进入游戏，失败也不阻断 */
        _scheduleBackgroundPrefetch();
        return { ok: state.ok, failed: state.failed.slice() };
    })();

    return _loaderRunning;
}

/* 脚本一执行就建好麦子并写出初始状态（不必等数据文件就绪） */
_loaderBuildWheat();
if (typeof t === 'function') _loaderSetProgress(0, 'html');

/* 若 main.js 因 404 / 语法错误未能启动，loader 自己跑起来，
   这样关键资源缺失时会显示明确错误与重试，而不是永远停在 0%。 */
setTimeout(() => {
    if (typeof runAssetLoading === 'function') {
        runAssetLoading().catch((e) => console.error('[loader] unexpected error', e));
    }
}, 1500);
