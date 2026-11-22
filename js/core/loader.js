/* ============================================================
   loader.js  —  资源加载进度（manifest 驱动）
   ------------------------------------------------------------
   加载顺序：html → css → js → langdata → 音频元数据 → 图片 → 其他
   进度权重（总和 100%）：
     html 3% · css 7% · js 12% · langdata 18%
     音频 20% · 图片 30% · 其他 10%
   进度条会真实走完再放行；慢网由软/硬兜底保证不会卡死。
   ============================================================ */

const LOADER_WEIGHTS = {
    html:     3,
    css:      7,
    js:       12,
    langdata: 18,
    audio:    20,
    images:   30,
    other:    10,
};

const LOADER_STAGE_LABEL = {
    html:     'loader.stageHtml',
    css:      'loader.stageCss',
    js:       'loader.stageJs',
    langdata: 'loader.stageLangdata',
    audio:    'loader.stageAudio',
    images:   'loader.stageImages',
    other:    'loader.stageOther',
};

const LOADER_IMAGE_CONCURRENCY = 6;      /* 本地图片并发预取 */
const LOADER_IMAGE_DELAY_MS = 80;        /* 关键数据就绪后立刻开始，不再等到放行之后 */
const LOADER_MIN_VISIBLE_MS = 900;       /* 进度条至少可见时间，避免一闪而过 */
const LOADER_HARD_TIMEOUT_MS = 10000;    /* 最终兜底 */
const LOADER_SOFT_TIMEOUT_MS = 6000;     /* 慢网兜底：进度直接走完并放行 */

/* -------- UI -------- */

function _loaderEls() {
    return {
        screen: document.getElementById('loading-screen'),
        fill: document.getElementById('loading-progress-fill'),
        percent: document.getElementById('loading-percent'),
        status: document.getElementById('loading-status'),
    };
}

function _loaderSetProgress(percent, stageKey) {
    const { fill, percent: pctEl, status } = _loaderEls();
    const value = Math.max(0, Math.min(100, percent));
    if (fill) fill.style.width = value.toFixed(2) + '%';
    if (pctEl) pctEl.textContent = value.toFixed(1) + '%';
    if (status && stageKey) {
        const label = t(LOADER_STAGE_LABEL[stageKey] || 'ui.loadingFarm');
        status.textContent = label || '';
    }
}

/* -------- 小工具 -------- */

function _loaderSleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/* 轮询直到条件成立或超时（用于等待浏览器自己加载 css / js） */
async function _waitFor(check, timeoutMs = 6000, interval = 40) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
        try { if (check()) return true; } catch (e) { /* ignore */ }
        await _loaderSleep(interval);
    }
    return false;
}

/* 带进度的并发池 */
function _loadPool(items, loader, concurrency, onProgress) {
    return new Promise((resolve) => {
        if (!items || items.length === 0) { onProgress(items ? items.length : 0, 0); resolve(); return; }
        let index = 0;
        let done = 0;
        let active = 0;
        const next = () => {
            if (index >= items.length && active === 0) { resolve(); return; }
            while (active < concurrency && index < items.length) {
                const item = items[index++];
                active++;
                Promise.resolve()
                    .then(() => loader(item))
                    .catch(() => {})
                    .then(() => {
                        active--;
                        done++;
                        onProgress(items.length, done);
                        next();
                    });
            }
        };
        next();
    });
}

function _preloadImage(src) {
    return new Promise((resolve) => {
        const img = new Image();
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        img.onload = finish;
        img.onerror = finish;
        /* 兜底：单张图最多等 15 秒 */
        setTimeout(finish, 15000);
        img.src = src;
    });
}

function _preloadAudioMeta(src) {
    return new Promise((resolve) => {
        try {
            const el = new Audio();
            let settled = false;
            const finish = () => { if (!settled) { settled = true; el.src = ''; resolve(); } };
            el.preload = 'metadata';
            el.addEventListener('loadedmetadata', finish, { once: true });
            el.addEventListener('error', finish, { once: true });
            setTimeout(finish, 4000);
            el.src = src;
        } catch (e) { resolve(); }
    });
}

/* -------- 主流程 -------- */

let _loaderRunning = null;
let _loaderForceFinished = false;
let _loaderSoftDone = false;

/* 放行：通知 main.js 进入起始弹窗（只生效一次） */
function releaseLoader() {
    if (_loaderSoftDone) return;
    _loaderSoftDone = true;
    try {
        window.__loaderReleased = true;
        if (typeof window.__loaderRelease === 'function') window.__loaderRelease();
        else window.__loaderPendingRelease = true;   /* main.js 还没挂钩子，等它挂上再放行 */
    } catch (e) { /* ignore */ }
}

/** 让加载条直接走完并放行（数据加载超时等异常情况下调用） */
function forceFinishLoading() {
    _loaderForceFinished = true;
    _loaderSetProgress(100, 'other');
    releaseLoader();
}

async function runAssetLoading() {
    if (_loaderRunning) return _loaderRunning;

    _loaderRunning = (async () => {
        const manifest = (typeof ASSET_MANIFEST !== 'undefined' && ASSET_MANIFEST) ? ASSET_MANIFEST : null;
        const startedAt = Date.now();
        let progress = 0;

        const add = (weight, ratio, stageKey) => {
            progress += weight * Math.max(0, Math.min(1, ratio));
            _loaderSetProgress(progress, stageKey);
        };

        /* --- 1. HTML（当前文档已经解析完成） --- */
        _loaderSetProgress(0, 'html');
        await _loaderSleep(40);
        add(LOADER_WEIGHTS.html, 1, 'html');

        if (!manifest) {
            console.warn('[loader] assets/manifest.js missing, skipping preload');
            forceFinishLoading();
            return;
        }

        /* --- 2. CSS --- */
        /* 直接等页面里的 <link rel=stylesheet>，不要用 manifest 数量：
           manifest 还包含只给 legal.html 用的 css/legal.css，数量会多一个。 */
        const cssLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
        const cssReady = cssLinks.length > 0
            ? await _waitFor(() => cssLinks.every((link) => !!link.sheet), 6000)
            : true;
        add(LOADER_WEIGHTS.css, cssReady ? 1 : 0.5, 'css');
        await _loaderSleep(30);

        /* --- 3. JS（等主入口就位） --- */
        const jsReady = await _waitFor(
            () => typeof window.bootstrap === 'function' && !!window.__dataReadyPromise,
            8000
        );
        add(LOADER_WEIGHTS.js, jsReady ? 1 : 0.5, 'js');
        await _loaderSleep(30);

        /* --- 4. langdata --- */
        let langReady = false;
        if (window.__dataReadyPromise && typeof window.__dataReadyPromise.then === 'function') {
            langReady = await Promise.race([
                window.__dataReadyPromise.then(() => true).catch(() => false),
                _loaderSleep(8000).then(() => false),
            ]);
        }
        add(LOADER_WEIGHTS.langdata, langReady ? 1 : 0.6, 'langdata');
        await _loaderSleep(30);

        /* --- 5. 音频元数据（不播放、不整首下载） --- */
        const audioList = manifest.audio || [];
        if (audioList.length > 0) {
            await _loadPool(audioList, (src) => _preloadAudioMeta(src), 2, (total, done) => {
                _loaderSetProgress(progress + LOADER_WEIGHTS.audio * (done / total), 'audio');
            });
        }
        progress += LOADER_WEIGHTS.audio;
        _loaderSetProgress(progress, 'audio');
        await _loaderSleep(30);

        /* --- 6. 图片（进入游戏前完成预取，慢网兜底跳过） --- */
        const slowNet = (() => {
            try {
                const c = navigator.connection || {};
                return !!c.saveData || /(^|-)(2g|slow-2g)$/.test(c.effectiveType || '');
            } catch (e) { return false; }
        })();
        const imageList = slowNet ? [] : [...(manifest.images || [])];
        if (slowNet) console.warn('[loader] slow network detected, skipping image preload');
        await _loaderSleep(LOADER_IMAGE_DELAY_MS);

        if (imageList.length > 0) {
            await Promise.race([
                _loadPool(imageList, (src) => _preloadImage(src), LOADER_IMAGE_CONCURRENCY, (total, done) => {
                    _loaderSetProgress(progress + LOADER_WEIGHTS.images * (done / total), 'images');
                }),
                _loaderSleep(6000),
            ]);
        }
        progress += LOADER_WEIGHTS.images;
        _loaderSetProgress(progress, 'images');

        /* --- 7. 其他（字体/图标/杂项） --- */
        const pageReady = await _waitFor(() => document.readyState === 'complete', 5000);
        add(LOADER_WEIGHTS.other, pageReady ? 1 : 0.6, 'other');

        const elapsed = Date.now() - startedAt;
        if (elapsed < LOADER_MIN_VISIBLE_MS) {
            await _loaderSleep(LOADER_MIN_VISIBLE_MS - elapsed);
        }

        _loaderSetProgress(100, 'other');
        console.log(`[loader] assets ready in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
        releaseLoader();
    })();

    return _loaderRunning;
}

/* 脚本一执行就把状态写出来（不必等数据文件就绪） */
if (typeof t === 'function') _loaderSetProgress(0, 'html');

/* 软超时：网速很慢时不要让玩家干等太久，先放行进游戏，资源继续在后台加载 */
setTimeout(() => {
    if (_sessionStarted) return;
    if (_loaderSoftDone) return;
    _loaderSetProgress(100, 'other');
    console.warn('[loader] 必要资源等待超过 ' + (LOADER_SOFT_TIMEOUT_MS / 1000) + 's，先放行，其余资源后台加载');
    releaseLoader();
}, LOADER_SOFT_TIMEOUT_MS);

/* 硬超时兜底 */
setTimeout(() => {
    if (_loaderForceFinished) return;
    _loaderForceFinished = true;
    _loaderSetProgress(100, 'other');
    console.warn('[loader] 加载超时，强制放行');
    releaseLoader();
}, LOADER_HARD_TIMEOUT_MS);
