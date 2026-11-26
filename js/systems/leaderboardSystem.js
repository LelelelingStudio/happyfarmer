/* ============================================================
   leaderboardSystem.js  —  排行榜数据层（对接 Cloudflare Worker）
   ------------------------------------------------------------
   · 10 个榜单、分页每页 100、按名次跳页
   · 5 级解锁；首次打开引导选择公开/匿名
   · 升级自动提交；手动提交每 5 游戏日一次
   · 自定义上传头像永不上传
   · 可选联网功能： Worker 不可达 / CORS 被拦截时全部调用静默失败，
     单机玩法不依赖排行榜，隐私政策已披露该项外部请求
   ============================================================ */

/* ---------- 配置 ---------- */
const LEADERBOARD_API = 'https://happyfarmer-back.lelelelingstudio1.workers.dev';
const LEADERBOARD_MIN_LEVEL = 5;
const LEADERBOARD_PAGE_SIZE = 100;
const LEADERBOARD_MANUAL_COOLDOWN_DAYS = 5;
const LEADERBOARD_SIGNATURE_SALT = 'Nw7@rG1xM9kB4sQ2pV6tH8jC3fL5dY0aZ';

/* ---------- 榜单定义（与后端一致，名称可本地化） ---------- */
const LEADERBOARD_BOARDS = [
    { key: 'gold',        nameKey: 'lb.board.gold',        unitKey: 'lb.unit.gold',        field: 'gold' },
    { key: 'level',       nameKey: 'lb.board.level',       unitKey: 'lb.unit.level',       field: 'level' },
    { key: 'day',         nameKey: 'lb.board.day',         unitKey: 'lb.unit.day',         field: 'day' },
    { key: 'achievement', nameKey: 'lb.board.achievement', unitKey: 'lb.unit.count',       field: 'achievements' },
    { key: 'speed',       nameKey: 'lb.board.speed',       unitKey: 'lb.unit.speed',       field: 'speed' },
    { key: 'fortune',     nameKey: 'lb.board.fortune',     unitKey: 'lb.unit.point',       field: 'fortune' },
    { key: 'collection',  nameKey: 'lb.board.collection',  unitKey: 'lb.unit.kind',        field: 'collection' },
    { key: 'factory',     nameKey: 'lb.board.factory',     unitKey: 'lb.unit.kind',        field: 'factory' },
    { key: 'wealth_rate', nameKey: 'lb.board.wealth',      unitKey: 'lb.unit.goldPerDay',  field: 'wealthRate' },
    { key: 'allround',    nameKey: 'lb.board.allround',    unitKey: 'lb.unit.point',       field: 'allroundScore' },
];

/* ---------- 机遇分权重（与后端一致） ---------- */
const FORTUNE_WEIGHTS = {
    treasure: 3, luckyDay: 2, rainBlessing: 2, sunshine: 2,
    merchantEarly: 4, freeItem: 3, mallDiscount: 1, default: 1,
};

/* ============================================================
   一、玩家身份与偏好
   ============================================================ */

/** 确保有稳定的匿名 ID（首次生成后写入存档与 localStorage） */
function ensurePlayerId() {
    if (!gameState.user.userId) {
        gameState.user.userId = 'user_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        if (typeof markDirty === 'function') markDirty();
    }
    try { HFStorage.setItem('farm_player_id', gameState.user.userId); } catch (e) { /* ignore */ }
    return gameState.user.userId;
}

/** 排行榜偏好（存在存档里，也同步一份到 localStorage 方便以后接后端） */
function getLeaderboardPref() {
    if (!gameState.user.leaderboard) {
        gameState.user.leaderboard = {
            joined: false,          /* 是否已完成加入引导 */
            visibility: 'public',   /* public | anonymous */
            hideName: false,
            hideAvatar: false,
            lastSubmitAt: 0,
            lastSubmitDay: 0,
            manualRefreshDay: -999,
            bestRanks: {},
        };
    }
    return gameState.user.leaderboard;
}

function saveLeaderboardPref() {
    const p = getLeaderboardPref();
    try { HFStorage.setItem('farm_leaderboard_pref', JSON.stringify(p)); } catch (e) { /* ignore */ }
    if (typeof markDirty === 'function') markDirty();
}

/** 是否自定义上传头像（这类头像永不上传） */
function hasCustomUploadedAvatar() {
    return /^data:image\//i.test(String(gameState.user.avatar || ''));
}

/** 实际要提交的头像（自定义上传 → null） */
function getSubmittableAvatar() {
    if (hasCustomUploadedAvatar()) return null;
    const a = gameState.user.avatar;
    if (!a) return null;
    /* 素材库编号：7.png */
    if (/^\d+\.png$/i.test(a)) return a;
    /* emoji 序号：e1 ~ e10 */
    if (/^e\d{1,2}$/i.test(a)) return a;
    /* 兼容旧存档里的 emoji 字符：转成序号再提交 */
    if (typeof emojiCharToToken === 'function') {
        const token = emojiCharToToken(a);
        if (token) return token;
    }
    return null;
}

/** 排行榜是否已解锁 */
function isLeaderboardUnlocked() {
    return gameState.level >= LEADERBOARD_MIN_LEVEL;
}

/* ============================================================
   二、指标计算
   ============================================================ */

/** 1 级 → 当前等级的累计经验总和 */
function getTotalExp() {
    /* 存档里如果统计过就直接用 */
    const s = gameState.stats || {};
    if (typeof s.expTotal === 'number' && s.expTotal > 0) return s.expTotal;

    /* 否则按等级公式反推：expToNextLevel(l) = EXP_BASE * EXP_GROWTH^(l-1) */
    let total = Math.floor(gameState.exp || 0);
    const base = (typeof EXP_BASE === 'number') ? EXP_BASE : 100;
    const growth = (typeof EXP_GROWTH === 'number') ? EXP_GROWTH : 1.5;
    for (let l = 1; l < gameState.level; l++) {
        total += Math.floor(base * Math.pow(growth, l - 1));
    }
    return total;
}

/** 已收集的作物种类数 */
function getCollectionCount() {
    const map = (gameState.stats && gameState.stats.cropHarvestMap) || {};
    return Object.keys(map).length;
}

/** 完成过的加工品种类数（去重） */
function getFactoryCount() {
    const done = gameState.stats && gameState.stats.factoryDoneMap;
    if (done) return Object.keys(done).length;
    /* 退化：用加工次数近似（老存档） */
    return Math.min(1893, gameState.stats ? (gameState.stats.factoryRun || 0) : 0);
}

/** 机遇分（加权好事件，坏事件不扣） */
function getFortuneScore() {
    const counts = (gameState.stats && gameState.stats.fortuneEvents) || {};
    let score = 0;
    for (const [k, v] of Object.entries(counts)) {
        score += (FORTUNE_WEIGHTS[k] !== undefined ? FORTUNE_WEIGHTS[k] : FORTUNE_WEIGHTS.default) * (Number(v) || 0);
    }
    return score;
}

/** 组装提交数据 */
function buildLeaderboardPayload() {
    const p = getLeaderboardPref();
    const day = Math.max(1, gameState.day || 1);
    const expTotal = getTotalExp();
    const payload = {
        userId: ensurePlayerId(),
        nickname: gameState.user.nickname || (typeof t === 'function' ? t('user.nicknameDefault') : 'Farmer'),
        avatar: getSubmittableAvatar(),
        hideAvatar: p.visibility === 'anonymous' ? !!p.hideAvatar : false,
        hideName: p.visibility === 'anonymous' ? !!p.hideName : false,
        level: gameState.level,
        gold: Math.floor(gameState.gold),
        day,
        expTotal,
        achievements: (typeof getAchievementProgress === 'function') ? getAchievementProgress().unlocked : 0,
        fortune: getFortuneScore(),
        collection: getCollectionCount(),
        factory: getFactoryCount(),
    };
    /* 自定义上传头像强制隐藏 */
    if (hasCustomUploadedAvatar()) payload.hideAvatar = true;

    payload.sig = signLeaderboardPayload(payload);
    return payload;
}

/**
 * 简单签名：把关键字段拼接后做一次哈希。
 * 目的只是挡住「随手改存档直接提交」的人（挡不住会看代码的人，这是设计取舍）。
 */
function signLeaderboardPayload(p) {
    const raw = [p.userId, p.level, p.gold, p.day, p.expTotal, p.achievements,
        p.fortune, p.collection, p.factory, LEADERBOARD_SIGNATURE_SALT].join('|');
    /* 轻量哈希（FNV-1a 变体 + 盐），不追求密码学强度 */
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        h1 ^= c; h1 = (h1 * 0x01000193) >>> 0;
        h2 = ((h2 << 5) - h2 + c) >>> 0;
    }
    return (h1.toString(36) + h2.toString(36));
}

/* ============================================================
   三、与后端通信
   ============================================================ */

async function lbFetch(path, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
        const res = await fetch(LEADERBOARD_API + path, {
            method: options.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: ctrl.signal,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const err = new Error((data && data.error) || ('HTTP ' + res.status));
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    } finally {
        clearTimeout(timer);
    }
}

/** 提交成绩（升级自动 / 手动） */
async function submitLeaderboard(reason = 'auto') {
    if (!isLeaderboardUnlocked()) return { ok: false, error: 'locked' };
    const pref = getLeaderboardPref();

    if (reason === 'manual') {
        const last = pref.manualRefreshDay || -999;
        if (gameState.day - last < LEADERBOARD_MANUAL_COOLDOWN_DAYS) {
            return { ok: false, error: 'cooldown', daysLeft: LEADERBOARD_MANUAL_COOLDOWN_DAYS - (gameState.day - last) };
        }
    }

    try {
        const data = await lbFetch('/api/v1/submit', { method: 'POST', body: buildLeaderboardPayload() });
        pref.lastSubmitAt = Date.now();
        pref.lastSubmitDay = gameState.day;
        if (reason === 'manual') pref.manualRefreshDay = gameState.day;
        if (data && data.ranks) pref.bestRanks = data.ranks;
        saveLeaderboardPref();
        if (typeof renderLeaderboard === 'function') renderLeaderboard();
        return { ok: true, ranks: (data && data.ranks) || {}, skipped: !!(data && data.skipped) };
    } catch (e) {
        return { ok: false, error: e.message || 'network' };
    }
}

/** 拉某个榜单一页 */
async function fetchLeaderboardPage(boardKey, offset = 0, limit = LEADERBOARD_PAGE_SIZE) {
    const viewer = ensurePlayerId();
    return lbFetch(`/api/v1/board/${boardKey}?offset=${offset}&limit=${limit}&viewer=${encodeURIComponent(viewer)}`);
}

/** 按名次跳页：第 N 名 → offset = floor((N-1)/100)*100 */
async function fetchLeaderboardByRank(boardKey, rank) {
    const viewer = ensurePlayerId();
    return lbFetch(`/api/v1/board/${boardKey}/rank/${Math.max(1, Math.floor(rank))}?limit=${LEADERBOARD_PAGE_SIZE}&viewer=${encodeURIComponent(viewer)}`);
}

/** 我附近的名次 */
async function fetchLeaderboardAroundMe(boardKey, span = 5) {
    const viewer = ensurePlayerId();
    return lbFetch(`/api/v1/board/${boardKey}/around/${encodeURIComponent(viewer)}?span=${span}`);
}

/** 全服统计 */
async function fetchLeaderboardStats() {
    return lbFetch('/api/v1/stats');
}

/** 我的全部排名 */
async function fetchMyRanks() {
    const viewer = ensurePlayerId();
    return lbFetch('/api/v1/player/' + encodeURIComponent(viewer));
}

/* ============================================================
   四、加入引导与自动提交
   ============================================================ */

/** 5 级后首次打开排行榜时，弹出「加入方式」引导 */
function maybeShowLeaderboardOnboarding() {
    if (!isLeaderboardUnlocked()) return false;
    const pref = getLeaderboardPref();
    if (pref.joined) return false;
    if (typeof openLeaderboard === 'function') {
        openLeaderboard();      /* openLeaderboard 内部会渲染加入引导 */
        return true;
    }
    return false;
}

/** 升级时调用：自动提交一次 */
function onLevelUpSubmit() {
    if (!isLeaderboardUnlocked()) return;
    const pref = getLeaderboardPref();
    if (!pref.joined) return;
    /* 静默提交，不打扰玩家 */
    submitLeaderboard('auto').then((r) => {
        if (r.ok && r.ranks && typeof showNotification === 'function') {
            const best = Object.entries(r.ranks).sort((a, b) => a[1] - b[1])[0];
            if (best && typeof leaderboardBoardName === 'function') {
                console.log('[leaderboard] 已更新排名', r.ranks);
            }
        }
    }).catch(() => { /* 离线时忽略 */ });
}

/** 榜单名（本地化） */
function leaderboardBoardName(key) {
    const b = LEADERBOARD_BOARDS.find((x) => x.key === key);
    return b ? t(b.nameKey) : key;
}

function leaderboardBoardUnit(key) {
    const b = LEADERBOARD_BOARDS.find((x) => x.key === key);
    return b ? t(b.unitKey) : '';
}

function leaderboardFieldOf(key) {
    const b = LEADERBOARD_BOARDS.find((x) => x.key === key);
    return b ? b.field : 'gold';
}
