/* ============================================================
   leaderboardUI.js  —  排行榜弹窗（10 榜单 / 分页 / 跳名次 / 设置）
   ============================================================ */

let _lbBoard = 'gold';
let _lbOffset = 0;
let _lbTotal = 0;
let _lbLoading = false;
let _lbRankInput = '';

/* ---------- 打开 / 关闭 ---------- */
function openLeaderboard() {
    if (!isLeaderboardUnlocked()) {
        showAlert(t('lb.lockedTitle'), t('lb.lockedBody', { level: LEADERBOARD_MIN_LEVEL }));
        return;
    }
    const dlg = document.getElementById('leaderboard-dialog');
    if (dlg) dlg.classList.add('show');
    _lbOffset = 0;
    renderLeaderboard();
}

function closeLeaderboard() {
    const dlg = document.getElementById('leaderboard-dialog');
    if (dlg) dlg.classList.remove('show');
}

/* ---------- 渲染 ---------- */
async function renderLeaderboard() {
    const box = document.getElementById('leaderboard-body');
    if (!box || _lbLoading) return;

    const pref = getLeaderboardPref();

    /* 未完成加入引导 → 先展示引导 */
    if (!pref.joined) {
        renderLeaderboardOnboarding(box);
        return;
    }

    _lbLoading = true;
    box.innerHTML = `
        ${renderLeaderboardTabs()}
        <div class="lb-toolbar">
            <input id="lb-jump" type="number" min="1" placeholder="${escapeHtml(t('lb.jumpPlaceholder'))}" value="${escapeHtml(String(_lbRankInput))}">
            <button class="btn btn-small" id="lb-jump-btn">${t('lb.jump')}</button>
            <button class="btn btn-small" id="lb-around-btn">${t('lb.aroundMe')}</button>
            <button class="btn btn-small" id="lb-refresh-btn">${t('lb.manualRefresh')}</button>
            <button class="btn btn-small" id="lb-settings-btn">⚙️ ${t('lb.visibility')}</button>
            <span class="lb-info" id="lb-info">${t('common.loading')}</span>
        </div>
        <div class="lb-list" id="lb-list"><div class="empty-state">${t('common.loading')}</div></div>
        <div class="lb-pager">
            <button class="btn btn-small" id="lb-prev">◀ ${t('ui.prevPage')}</button>
            <span id="lb-page-info"></span>
            <button class="btn btn-small" id="lb-next">${t('ui.nextPage')} ▶</button>
        </div>
    `;
    bindLeaderboardControls();

    try {
        const page = await fetchLeaderboardPage(_lbBoard, _lbOffset);
        _lbTotal = page.total || 0;
        renderLeaderboardList(page);
    } catch (e) {
        document.getElementById('lb-list').innerHTML =
            `<div class="empty-state">${t('lb.loadFailed')}<br><span class="lb-err">${escapeHtml(e.message)}</span></div>`;
        document.getElementById('lb-info').textContent = '';
    } finally {
        _lbLoading = false;
    }
}

function renderLeaderboardTabs() {
    const pref = getLeaderboardPref();
    return `
        <div class="lb-tabs">
            ${LEADERBOARD_BOARDS.map((b) => `
                <button class="lb-tab ${b.key === _lbBoard ? 'active' : ''}" data-board="${b.key}">${t(b.nameKey)}</button>
            `).join('')}
        </div>
        <div class="lb-my-ranks">
            ${pref.bestRanks && Object.keys(pref.bestRanks).length
                ? t('lb.myRanks') + ' ' + LEADERBOARD_BOARDS
                    .filter((b) => pref.bestRanks[b.key])
                    .slice(0, 4)
                    .map((b) => `<span class="lb-rank-chip">${t(b.nameKey)} #${pref.bestRanks[b.key]}</span>`)
                    .join('')
                : `<span class="muted">${t('lb.noRankYet')}</span>`}
        </div>
    `;
}

function renderLeaderboardList(page) {
    const list = document.getElementById('lb-list');
    const info = document.getElementById('lb-info');
    const entries = page.entries || [];

    if (info) {
        const pages = Math.max(1, Math.ceil(_lbTotal / LEADERBOARD_PAGE_SIZE));
        info.textContent = t('lb.totalInfo', { total: formatNumber(_lbTotal), page: Math.floor(_lbOffset / LEADERBOARD_PAGE_SIZE) + 1, pages });
    }
    const pageInfo = document.getElementById('lb-page-info');
    if (pageInfo) {
        pageInfo.textContent = t('ui.pageIndicator', {
            page: Math.floor(_lbOffset / LEADERBOARD_PAGE_SIZE) + 1,
            total: Math.max(1, Math.ceil(_lbTotal / LEADERBOARD_PAGE_SIZE)),
        });
    }

    if (entries.length === 0) {
        list.innerHTML = `<div class="empty-state">${t('lb.empty')}</div>`;
        return;
    }

    const field = leaderboardFieldOf(_lbBoard);
    const unit = leaderboardBoardUnit(_lbBoard);
    const myId = ensurePlayerId();

    list.innerHTML = entries.map((e) => {
        const isMe = e.userId === myId || e.playerId === myId;
        const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : '';
        const val = e[field];
        return `
            <div class="lb-row ${isMe ? 'me' : ''}">
                <div class="lb-rank">${medal || '#' + e.rank}</div>
                <div class="lb-avatar">${lbAvatarHtml(e.avatar)}</div>
                <div class="lb-name">${escapeHtml(e.nickname)}${isMe ? ' <span class="lb-me-tag">' + t('lb.you') + '</span>' : ''}</div>
                <div class="lb-value">${formatNumber(typeof val === 'number' ? Math.round(val * 100) / 100 : val)} <span class="lb-unit">${unit}</span></div>
            </div>
        `;
    }).join('');
}

function lbAvatarHtml(avatar) {
    if (!avatar) return '<span class="lb-avatar-blank">—</span>';
    const raw = String(avatar);
    if (/^\d+\.(png|webp)$/i.test(raw)) {
        const src = (typeof getAvatarLibrarySrc === 'function')
            ? getAvatarLibrarySrc(raw)
            : AVATAR_LIBRARY_DIR + raw;
        return `<img src="${escapeHtml(src)}" alt="" onerror="this.style.display='none';if(this.parentNode){this.parentNode.textContent='—';}">`;
    }
    let emoji = raw;
    if (typeof isAvatarEmojiToken === 'function' && isAvatarEmojiToken(raw)) {
        emoji = emojiTokenToChar(raw);
    }
    if (typeof AVATAR_EMOJIS !== 'undefined' && !AVATAR_EMOJIS.includes(emoji)) {
        return '<span class="lb-avatar-blank">—</span>';
    }
    return `<span class="lb-avatar-emoji">${escapeHtml(emoji)}</span>`;
}

/* ---------- 交互 ---------- */
function bindLeaderboardControls() {
    document.querySelectorAll('.lb-tab').forEach((tab) => {
        tab.onclick = () => {
            _lbBoard = tab.dataset.board;
            _lbOffset = 0;
            renderLeaderboard();
        };
    });

    const jumpBtn = document.getElementById('lb-jump-btn');
    if (jumpBtn) {
        jumpBtn.onclick = async () => {
            const v = Number(document.getElementById('lb-jump').value);
            if (!v || v < 1) return;
            _lbRankInput = String(v);
            _lbOffset = Math.floor((v - 1) / LEADERBOARD_PAGE_SIZE) * LEADERBOARD_PAGE_SIZE;
            await jumpToOffset();
        };
    }

    const aroundBtn = document.getElementById('lb-around-btn');
    if (aroundBtn) {
        aroundBtn.onclick = async () => {
            const list = document.getElementById('lb-list');
            list.innerHTML = `<div class="empty-state">${t('common.loading')}</div>`;
            try {
                const r = await fetchLeaderboardAroundMe(_lbBoard, 5);
                _lbOffset = r.offset || 0;
                _lbTotal = r.total || _lbTotal;
                renderLeaderboardList(r);
                if (r.myRank) {
                    showNotification(t('lb.aroundMe'), t('lb.myRankIs', { rank: formatNumber(r.myRank) }), 'info');
                }
            } catch (e) {
                list.innerHTML = `<div class="empty-state">${t('lb.notRanked')}</div>`;
            }
        };
    }

    const refreshBtn = document.getElementById('lb-refresh-btn');
    if (refreshBtn) {
        refreshBtn.onclick = async () => {
            refreshBtn.disabled = true;
            const r = await submitLeaderboard('manual');
            refreshBtn.disabled = false;
            if (r.ok) {
                showNotification(t('lb.manualRefresh'), t('lb.refreshOk'), 'success');
                renderLeaderboard();
            } else if (r.error === 'cooldown') {
                showNotification(t('lb.manualRefresh'), t('lb.refreshCooldown', { days: r.daysLeft }), 'warning');
            } else {
                showNotification(t('lb.manualRefresh'), t('lb.refreshFail'), 'warning');
            }
        };
    }

    const setBtn = document.getElementById('lb-settings-btn');
    if (setBtn) setBtn.onclick = () => showLeaderboardVisibility();

    const prev = document.getElementById('lb-prev');
    if (prev) {
        prev.onclick = () => {
            if (_lbOffset <= 0) return;
            _lbOffset = Math.max(0, _lbOffset - LEADERBOARD_PAGE_SIZE);
            jumpToOffset();
        };
    }
    const next = document.getElementById('lb-next');
    if (next) {
        next.onclick = () => {
            if (_lbOffset + LEADERBOARD_PAGE_SIZE >= _lbTotal) return;
            _lbOffset += LEADERBOARD_PAGE_SIZE;
            jumpToOffset();
        };
    }
}

async function jumpToOffset() {
    const list = document.getElementById('lb-list');
    if (!list) return;
    list.innerHTML = `<div class="empty-state">${t('common.loading')}</div>`;
    try {
        const page = await fetchLeaderboardPage(_lbBoard, _lbOffset);
        _lbTotal = page.total || 0;
        renderLeaderboardList(page);
        list.scrollTop = 0;
    } catch (e) {
        list.innerHTML = `<div class="empty-state">${t('lb.loadFailed')}</div>`;
    }
}

/* ============================================================
   加入引导（首次打开）
   ============================================================ */
function renderLeaderboardOnboarding(box) {
    box.innerHTML = `
        <div class="lb-onboard">
            <div class="lb-onboard-icon">🏆</div>
            <h3>${t('lb.onboardTitle')}</h3>
            <p class="lb-onboard-text">${t('lb.onboardText')}</p>
            <div class="lb-onboard-actions">
                <button class="btn btn-primary btn-large" id="lb-choose-public">${t('lb.public')}</button>
                <button class="btn btn-large" id="lb-choose-anon">${t('lb.anonymous')}</button>
            </div>
            <p class="lb-onboard-note">${t('lb.onboardNote')}</p>
        </div>
    `;
    document.getElementById('lb-choose-public').onclick = () => confirmPublicJoin();
    document.getElementById('lb-choose-anon').onclick = () => chooseAnonymous();
}

function confirmPublicJoin() {
    showModal(
        t('lb.publicConfirmTitle'),
        t('lb.publicConfirmBody'),
        [
            { text: t('common.cancel'), value: null },
            { text: t('lb.agreePrivacy'), value: 'agree', primary: true },
        ]
    ).then((v) => {
        if (v !== 'agree') return;
        const pref = getLeaderboardPref();
        pref.visibility = 'public';
        pref.hideName = false;
        pref.hideAvatar = false;
        pref.joined = true;
        saveLeaderboardPref();
        showNotification(t('lb.joinedTitle'), t('lb.joinedPublic'), 'success');
        submitLeaderboard('auto');
        renderLeaderboard();
    });
}

function chooseAnonymous() {
    const pref = getLeaderboardPref();
    const forceHideAvatar = hasCustomUploadedAvatar();

    showModal(
        t('lb.anonTitle'),
        forceHideAvatar ? t('lb.anonBodyForceAvatar') : t('lb.anonBody'),
        [
            { text: t('common.cancel'), value: null },
            { text: t('lb.hideNameOnly'), value: 'name' },
            { text: t('lb.hideAvatarOnly'), value: 'avatar' },
            { text: t('lb.hideBoth'), value: 'both', primary: true },
        ]
    ).then((v) => {
        if (v === null || v === undefined) return;
        pref.visibility = 'anonymous';
        pref.hideName = (v === 'name' || v === 'both');
        pref.hideAvatar = forceHideAvatar || (v === 'avatar' || v === 'both');
        pref.joined = true;
        saveLeaderboardPref();
        showNotification(t('lb.joinedTitle'), t('lb.joinedAnon'), 'success');
        submitLeaderboard('auto');
        renderLeaderboard();
    });
}

/** 已经加入过的玩家，点 ⚙️ 修改公开方式 */
function showLeaderboardVisibility() {
    const pref = getLeaderboardPref();
    const forceHideAvatar = hasCustomUploadedAvatar();

    showModal(
        t('lb.visibilityTitle'),
        `${t('lb.currentState')}: ${pref.visibility === 'public' ? t('lb.public') : t('lb.anonymous')}\n`
        + `${t('lb.hideName')}: ${pref.hideName ? '✅' : '❌'}\n`
        + `${t('lb.hideAvatar')}: ${(pref.hideAvatar || forceHideAvatar) ? '✅' : '❌'}`
        + (forceHideAvatar ? `\n\n${t('lb.customAvatarForced')}` : ''),
        [
            { text: t('common.cancel'), value: null },
            { text: t('lb.switchPublic'), value: 'public' },
            { text: t('lb.switchAnon'), value: 'anon', primary: true },
        ]
    ).then((v) => {
        if (v === 'public') {
            pref.visibility = 'public';
            pref.hideName = false;
            pref.hideAvatar = forceHideAvatar;
            saveLeaderboardPref();
            showNotification(t('lb.visibility'), t('lb.joinedPublic'), 'success');
            submitLeaderboard('auto');
            renderLeaderboard();
        } else if (v === 'anon') {
            chooseAnonymous();
        }
    });
}

/* ---------- 小工具 ---------- */
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initLeaderboardUI() {
    const closeBtn = document.querySelector('#leaderboard-dialog .close-btn');
    if (closeBtn) closeBtn.onclick = closeLeaderboard;

    const openBtn = document.getElementById('leaderboard-btn');
    if (openBtn) {
        openBtn.onclick = () => openLeaderboard();
        updateLeaderboardButton();
    }
}

/** 排行榜按钮：5 级后才出现 */
function updateLeaderboardButton() {
    const btn = document.getElementById('leaderboard-btn');
    if (!btn) return;
    const unlocked = isLeaderboardUnlocked();
    btn.hidden = !unlocked;
    if (unlocked) {
        const pref = getLeaderboardPref();
        btn.classList.toggle('lb-unjoined', !pref.joined);
    }
}
