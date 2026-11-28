/* ============================================================
   poki-rewards.js  —  Poki 专属「看广告领奖励」
   仅 happyfarmer-poki/ 文件夹加载；原版游戏不受影响。
   ============================================================ */

(function () {
    'use strict';

    const CLAIM_PREFIX = 'poki_reward_';
    const STREAK_KEY = 'poki_reward_streak';
    const LAST_DAY_KEY = 'poki_reward_last_day';

    const I18N = {
        en: {
            fab: 'Watch ads, get rewards',
            title: 'Poki Rewards',
            subtitle: 'One reward of each kind per day. Rewards scale with your farm level.',
            gold: 'Extra gold',
            seeds: 'Daily rare seeds',
            item: 'Daily surprise item',
            watch: 'Watch ad',
            claimed: 'Claimed today',
            busy: 'Ad playing…',
            close: 'Close',
            goldInfo: 'Extra {n} gold. Higher level, bigger reward.',
            seedsInfo: '3 seeds each: {names}',
            seedsFallback: 'A surprise seed pack.',
            itemInfo: 'Today: {icon} {name}',
            itemFallback: 'A surprise mall item.',
            streakMore: '🔥 {n}-day streak — +{p}% gold. Come back tomorrow to keep it!',
            streakStart: '🔥 Claim any reward daily to build a streak and boost gold.',
            rewardTitle: 'Reward',
            notDone: 'Ad was not completed. You can try again.',
            overlapping: 'Another ad is playing. Try again in a moment.',
            unavailable: 'Ads are unavailable here. Try again on Poki.',
            success: 'Reward received!',
        },
        zh: {
            fab: '看广告领奖励',
            title: 'Poki 奖励',
            subtitle: '每种奖励每天可领一次，等级越高奖励越丰厚。',
            gold: '额外金币',
            seeds: '每日稀有种子',
            item: '每日惊喜道具',
            watch: '看广告',
            claimed: '今日已领取',
            busy: '广告播放中…',
            close: '关闭',
            goldInfo: '额外 {n} 金币。等级越高，奖励越多。',
            seedsInfo: '每种 3 颗：{names}',
            seedsFallback: '惊喜种子包。',
            itemInfo: '今日：{icon} {name}',
            itemFallback: '惊喜商城道具。',
            streakMore: '🔥 已连续 {n} 天 — 金币 +{p}%。明天继续可保住加成！',
            streakStart: '🔥 每天领取任意奖励即可累积连续天数，提升金币奖励。',
            rewardTitle: '奖励',
            notDone: '广告未播放完成，可以再试一次。',
            overlapping: '另一个广告正在播放，请稍后再试。',
            unavailable: '当前环境无法播放广告，请在 Poki 上重试。',
            success: '奖励已到账！',
        },
    };

    function tr(key, params) {
        const lc = window.languageControl;
        const locale = String(
            (lc && typeof lc.getCurrentLocaleKey === 'function' && lc.getCurrentLocaleKey())
            || window.currentLocale
            || document.documentElement.lang
            || 'en'
        );
        const dict = locale.indexOf('zh') === 0 ? I18N.zh : I18N.en;
        let value = dict[key] || I18N.en[key] || key;
        if (params) {
            Object.keys(params).forEach((k) => {
                value = value.replace('{' + k + '}', String(params[k]));
            });
        }
        return value;
    }

    function keyFor(d) {
        return d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0');
    }

    function todayKey() {
        return keyFor(new Date());
    }

    function yesterdayKey() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return keyFor(d);
    }

    function streakDays() {
        const last = HFStorage.getItem(LAST_DAY_KEY);
        if (!last) return 0;
        const streak = parseInt(HFStorage.getItem(STREAK_KEY) || '0', 10) || 0;
        if (last === todayKey()) return streak;
        return last === yesterdayKey() ? streak : 0;
    }

    function touchStreak() {
        const today = todayKey();
        const last = HFStorage.getItem(LAST_DAY_KEY);
        if (last === today) return;
        const next = last === yesterdayKey() ? Math.min(streakDays() + 1, 999) : 1;
        HFStorage.setItem(STREAK_KEY, String(next));
        HFStorage.setItem(LAST_DAY_KEY, today);
    }

    function streakBonus() {
        return Math.min(0.5, Math.max(0, streakDays() - 1) * 0.1);
    }

    function claimKey(kind) {
        return CLAIM_PREFIX + kind + '_' + todayKey();
    }

    function isClaimed(kind) {
        return HFStorage.getItem(claimKey(kind)) === '1';
    }

    function markClaimed(kind) {
        HFStorage.setItem(claimKey(kind), '1');
    }

    function hashString(value) {
        let h = 2166136261;
        for (let i = 0; i < value.length; i++) {
            h ^= value.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    function pickDaily(list, count, salt) {
        return list.slice().sort((a, b) => hashString(salt + a.id) - hashString(salt + b.id)).slice(0, count);
    }

    function goldAmount() {
        const level = (typeof gameState !== 'undefined' && gameState.level) ? gameState.level : 1;
        const base = 500 + 250 * level;
        return Math.min(5000000, Math.round(base * (1 + streakBonus())));
    }

    function rareCrops() {
        if (typeof CROPS_ALL === 'undefined') return [];
        const level = (typeof gameState !== 'undefined' && gameState.level) ? gameState.level : 1;
        let pool = CROPS_ALL.filter((crop) => crop.unlockLevel > level);
        if (pool.length < 3) pool = CROPS_ALL.slice(-12);
        return pickDaily(pool, 3, 'seeds-' + todayKey());
    }

    function dailyItem() {
        if (typeof MALL_ITEMS === 'undefined') return null;
        const pool = MALL_ITEMS.filter((item) => item.id >= 51 && item.id <= 100);
        return pickDaily(pool, 1, 'item-' + todayKey())[0] || null;
    }

    function refreshUi() {
        /* 语言包可能在本模块构建 UI 之后才就绪，这里每次打开都同步静态标签 */
        const staticLabels = {
            'poki-title': 'title',
            'poki-subtitle': 'subtitle',
            'poki-gold-title': 'gold',
            'poki-seeds-title': 'seeds',
            'poki-item-title': 'item',
            'poki-reward-close': 'close',
            'poki-reward-fab': 'fab',
        };
        Object.keys(staticLabels).forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.textContent = tr(staticLabels[id]);
        });

        const goldBtn = document.getElementById('poki-claim-gold');
        const seedBtn = document.getElementById('poki-claim-seeds');
        const itemBtn = document.getElementById('poki-claim-item');
        const goldInfo = document.getElementById('poki-gold-info');
        const seedInfo = document.getElementById('poki-seed-info');
        const itemInfo = document.getElementById('poki-item-info');
        const streakInfo = document.getElementById('poki-streak-info');

        if (streakInfo) {
            const streak = streakDays();
            streakInfo.textContent = streak > 1
                ? tr('streakMore', { n: streak, p: Math.round(streakBonus() * 100) })
                : tr('streakStart');
        }
        const setButton = (btn, kind) => {
            if (!btn) return;
            btn.disabled = isClaimed(kind) || (window.PokiGameBridge && window.PokiGameBridge.isAdPlaying && window.PokiGameBridge.isAdPlaying());
            btn.textContent = btn.disabled && !isClaimed(kind) ? tr('busy') : (isClaimed(kind) ? tr('claimed') : tr('watch'));
        };
        setButton(goldBtn, 'gold');
        setButton(seedBtn, 'seeds');
        setButton(itemBtn, 'item');
        if (goldInfo) goldInfo.textContent = tr('goldInfo', { n: goldAmount().toLocaleString() });

        const crops = rareCrops();
        if (seedInfo) {
            seedInfo.textContent = crops.length
                ? tr('seedsInfo', { names: crops.map((crop) => crop.name).join(', ') })
                : tr('seedsFallback');
        }

        const item = dailyItem();
        if (itemInfo) itemInfo.textContent = item ? tr('itemInfo', { icon: item.icon, name: item.name }) : tr('itemFallback');
    }

    async function playAdAndClaim(kind, grant) {
        const bridge = window.PokiGameBridge;
        if (!bridge || !bridge.rewardedBreak) {
            if (typeof showNotification === 'function') showNotification(tr('rewardTitle'), tr('unavailable'), 'warning');
            return;
        }
        if (isClaimed(kind)) return;
        if (typeof bridge.isAdPlaying === 'function' && bridge.isAdPlaying()) {
            if (typeof showNotification === 'function') showNotification(tr('rewardTitle'), tr('overlapping'), 'warning');
            return;
        }

        const buttons = document.querySelectorAll('.poki-reward-option button');
        buttons.forEach((button) => { button.disabled = true; button.textContent = tr('busy'); });

        let success = false;
        try {
            const result = await bridge.rewardedBreak();
            success = result === true;
        } catch (e) {
            success = false;
        }

        if (success) {
            grant();
            markClaimed(kind);
            touchStreak();
            if (typeof saveGame === 'function') saveGame(true);
            if (typeof renderHud === 'function') renderHud();
            if (typeof renderGame === 'function') renderGame();
            if (typeof showNotification === 'function') showNotification(tr('rewardTitle'), tr('success'), 'success');
        } else if (typeof showNotification === 'function') {
            showNotification(tr('rewardTitle'), tr('notDone'), 'warning');
        }

        refreshUi();
        buttons.forEach((button) => { button.disabled = false; });
    }

    function buildUi() {
        const fab = document.createElement('button');
        fab.className = 'poki-reward-fab';
        fab.id = 'poki-reward-fab';
        fab.type = 'button';
        fab.textContent = tr('fab');
        fab.onclick = () => {
            const panel = document.getElementById('poki-reward-panel');
            if (panel) panel.classList.add('show');
            refreshUi();
        };
        document.body.appendChild(fab);

        const panel = document.createElement('div');
        panel.id = 'poki-reward-panel';
        panel.className = 'dialog';
        panel.innerHTML = ''
            + '<div class="poki-reward-card">'
            + '<h2 id="poki-title">' + tr('title') + '</h2>'
            + '<p class="subtitle" id="poki-subtitle">' + tr('subtitle') + '</p>'
            + '<p class="poki-streak" id="poki-streak-info"></p>'
            + '<div class="poki-reward-option">'
            + '<div class="icon">💰</div><div class="body"><strong id="poki-gold-title">' + tr('gold') + '</strong><p id="poki-gold-info"></p></div>'
            + '<button type="button" id="poki-claim-gold">' + tr('watch') + '</button></div>'
            + '<div class="poki-reward-option">'
            + '<div class="icon">🌱</div><div class="body"><strong id="poki-seeds-title">' + tr('seeds') + '</strong><p id="poki-seed-info"></p></div>'
            + '<button type="button" id="poki-claim-seeds">' + tr('watch') + '</button></div>'
            + '<div class="poki-reward-option">'
            + '<div class="icon">🎁</div><div class="body"><strong id="poki-item-title">' + tr('item') + '</strong><p id="poki-item-info"></p></div>'
            + '<button type="button" id="poki-claim-item">' + tr('watch') + '</button></div>'
            + '<button type="button" class="poki-reward-close" id="poki-reward-close">' + tr('close') + '</button>'
            + '</div>';
        document.body.appendChild(panel);

        document.getElementById('poki-reward-close').onclick = () => panel.classList.remove('show');
        panel.onclick = (event) => { if (event.target === panel) panel.classList.remove('show'); };

        document.getElementById('poki-claim-gold').onclick = () => playAdAndClaim('gold', () => {
            if (typeof addGold === 'function') addGold(goldAmount());
            else gameState.gold += goldAmount();
        });

        document.getElementById('poki-claim-seeds').onclick = () => playAdAndClaim('seeds', () => {
            if (typeof addSeedCount !== 'function') return;
            rareCrops().forEach((crop) => addSeedCount(crop.id, 3));
            if (typeof markDirty === 'function') markDirty();
        });

        document.getElementById('poki-claim-item').onclick = () => playAdAndClaim('item', () => {
            const item = dailyItem();
            if (!item) return;
            const result = (typeof applyMallItemEffect === 'function') ? applyMallItemEffect(item) : null;
            if (!result || result.ok === false) addGold(goldAmount());
        });

        refreshUi();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildUi);
    } else {
        buildUi();
    }
})();
