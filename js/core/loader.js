/* ============================================================
   loader.js  —  资源加载进度（manifest 驱动）
   ------------------------------------------------------------
   核心原则：
   - 只有所有资源都「真正结束」（加载成功 / 明确报错 / 单项超时判失败）
     之后，进度条才会走到 100% 并放行。
   - 任何兜底超时都不会伪装成「加载成功」：超时一律记为失败并记录。
   - 关键资源（脚本 / 语言数据）失败时停留在加载页并显示重试按钮，
     绝不带着半加载状态进入游戏。
   权重（总和 100%）：
     html 3% · css 7% · js 12% · langdata 18%
     音频 20% · 图片 30% · 其他 10%
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

const LOADER_IMAGE_CONCURRENCY = 12;     /* 本地图片并发预取（提高以缩短首屏等待） */
const LOADER_MIN_VISIBLE_MS = 900;       /* 进度条至少可见时间，避免一闪而过 */
const LOADER_SCRIPT_TIMEOUT_MS = 15000;  /* CSS / 主脚本等待上限 */
const LOADER_DATA_TIMEOUT_MS = 15000;    /* 语言数据等待上限 */
const LOADER_AUDIO_TIMEOUT_MS = 10000;   /* 单个音频元数据等待上限 */
const LOADER_IMAGE_TIMEOUT_MS = 15000;   /* 单张图片等待上限 */
const LOADER_READY_TIMEOUT_MS = 10000;   /* document.readyState 等待上限 */

/* 对外可观测状态：浏览器控制台可直接查看 window.__assetLoad */
window.__assetLoad = {
    settled: false,
    ok: false,
    stage: 'html',
    total: 7,
    done: 0,
    failed: [],
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

/** 农夫走过的麦子砍倒掉落；回头时身后的麦子从 🌱 逐株长成 🌾 */
function _loaderUpdateWheat(farmerX, returning, value) {
    const stalks = document.querySelectorAll('.wheat-stalk');
    if (!stalks.length) return;
    if (value <= 1) {
        stalks.forEach((stalk) => {
            delete stalk.dataset.regrown;
            delete stalk.dataset.state;
            stalk.classList.remove('cut', 'regrowing');
            clearTimeout(stalk._regrowTimer);
        });
    }
    stalks.forEach((stalk) => {
        const pos = parseFloat(stalk.dataset.pos) || 0;
        const shouldCut = pos <= farmerX;
        let state = shouldCut ? 'cut' : (returning ? 'regrowing' : 'whole');
        if (returning && stalk.dataset.regrown === '1') state = 'whole';
        if (stalk.dataset.state === state) return;

        stalk.dataset.state = state;
        stalk.classList.toggle('cut', state === 'cut');
        stalk.classList.toggle('regrowing', state === 'regrowing');

        if (state === 'regrowing') {
            clearTimeout(stalk._regrowTimer);
            stalk._regrowTimer = setTimeout(() => {
                if (stalk.dataset.state !== 'regrowing') return;
                stalk.dataset.regrown = '1';
                stalk.dataset.state = 'whole';
                stalk.classList.remove('regrowing');
            }, 120 + (pos - farmerX) * 14);
        } else if (state === 'cut') {
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
        screen.classList.toggle('shout', value >= 48 && value <= 66);
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

async function runAssetLoading() {
    if (_loaderRunning) return _loaderRunning;

    _loaderRunning = (async () => {
        const state = window.__assetLoad;
        const startedAt = Date.now();
        state.startedAt = startedAt;
        state.failed.length = 0;

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

        /* --- 5. 音频元数据（不播放、不整首下载），每个都等真正 settle --- */
        const audioList = manifest.audio || [];
        if (audioList.length > 0) {
            const audioResult = await _loadPool(
                audioList,
                (src) => _preloadAudioMeta(src),
                2,
                (total, done) => _loaderSetProgress(progress + LOADER_WEIGHTS.audio * (done / total), 'audio')
            );
            audioResult.failed.forEach((f) => noteFailed('audio', f.item, f.reason));
            add(LOADER_WEIGHTS.audio, audioResult.done / audioResult.total, 'audio');
        } else {
            add(LOADER_WEIGHTS.audio, 1, 'audio');
        }
        await _loaderSleep(30);

        /* --- 6. 图片：全部预取完成后才继续，不再 6 秒 race 后直接加满 --- */
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

        /* --- 7. 其他（字体 / 图标 / 页面 onload） --- */
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

        /* 到这里所有阶段都已 settle，才允许 100% 与放行 */
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
                    'Some optional assets failed to load; continuing anyway.'
                );
            }
            console.warn(`[loader] ${state.failed.length} optional asset(s) failed; see window.__assetLoad.failed`);
        }

        console.log(`[loader] all assets settled in ${((state.finishedAt - startedAt) / 1000).toFixed(2)}s (ok=${state.ok})`);
        releaseLoader();
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
