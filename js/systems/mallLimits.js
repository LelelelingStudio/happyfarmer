/* ============================================================
   mallLimits.js  —  商城购买限制
   ------------------------------------------------------------
   规则分两类：
     1) 冷却型（cooldownDays）：每 N 个游戏日只能买一次
        —— 用于「金币红包」这类直接送钱的道具
     2) 永久增益型（priceFromGold）：价格 = 持有金币 × 比例 + 固定值，
        并且每 N 天限购一次
        —— 用于「金币徽章」这类永久加成，买多了会破坏平衡

   限购数据存在 gameState.mallLimits：
     { [itemId]: { lastDay: 游戏日, count: 累计购买次数 } }
   ============================================================ */

/* 冷却型：每 7 个游戏日可买一次 */
const MALL_COOLDOWN_DAYS = 7;

/** 永久增益类 = 有 percent 参数的效果 */
const MALL_PERCENT_EFFECTS = [
    'xpBoost', 'goldBoost', 'luckBoost', 'landDiscount', 'mallDiscount', 'merchantBoost',
];

/** 该道具是否属于「永久增益」类 */
function isMallPercentBoost(item) {
    if (!item) return false;
    if (MALL_PERCENT_EFFECTS.indexOf(item.effect) < 0) return false;
    return !!(item.effectParam && item.effectParam.percent);
}

/**
 * 价格规则：
 *   永久增益类 → 持有金币 × 80% + 280（并且每 7 天限购一次）
 *   其它       → 用道具原价
 * 说明：按存款比例收费，让「买得起就一直买」失去意义。
 */
function getMallItemPrice(item) {
    if (!item) return 0;
    if (isMallPercentBoost(item)) {
        return Math.floor(Math.max(0, gameState.gold) * 0.8) + 280;
    }
    return item.price;
}

/** 该道具是否需要限购 */
function mallItemHasLimit(item) {
    if (!item) return false;
    return isMallPercentBoost(item) || item.effect === 'gainGold';
}

/** 限购状态：{ lastDay, count } */
function getMallLimitState(itemId) {
    if (!gameState.mallLimits) gameState.mallLimits = {};
    return gameState.mallLimits[itemId] || { lastDay: -999, count: 0 };
}

/** 距离下次可买还有几天（0 = 现在就能买） */
function getMallCooldownLeft(item) {
    if (!mallItemHasLimit(item)) return 0;
    const st = getMallLimitState(item.id);
    const passed = gameState.day - st.lastDay;
    return Math.max(0, MALL_COOLDOWN_DAYS - passed);
}

/** 现在能不能买（含冷却与金币检查） */
function canBuyMallItem(item) {
    if (!item) return { ok: false, reason: 'not_found' };
    if (!getUnlockedMallIds().has(item.id)) return { ok: false, reason: 'locked' };

    const left = getMallCooldownLeft(item);
    if (left > 0) return { ok: false, reason: 'cooldown', daysLeft: left };

    const price = getMallItemPrice(item);
    if (gameState.gold < price) return { ok: false, reason: 'gold', price };
    return { ok: true, price };
}

/** 记一次购买（写冷却） */
function recordMallPurchase(item) {
    if (!mallItemHasLimit(item)) return;
    if (!gameState.mallLimits) gameState.mallLimits = {};
    const st = getMallLimitState(item.id);
    gameState.mallLimits[item.id] = { lastDay: gameState.day, count: (st.count || 0) + 1 };
    if (typeof markDirty === 'function') markDirty();
}

/** 给 UI 用的一行说明（返回空串表示无限制） */
function getMallLimitNote(item) {
    if (!mallItemHasLimit(item)) return '';
    const left = getMallCooldownLeft(item);
    if (left > 0) return t('mall.limitCooldownLeft', { days: left });
    if (isMallPercentBoost(item)) return t('mall.limitCooldownReady', { days: MALL_COOLDOWN_DAYS });
    return t('mall.limitCooldownReady', { days: MALL_COOLDOWN_DAYS });
}
