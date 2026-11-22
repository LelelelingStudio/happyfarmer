/* ============================================================
   legalDialog.js  —  三份法律文档入口
   版本：v1.1.0
   ------------------------------------------------------------
   文档由独立页面 legal.html?doc=1/2/3 提供（可公开直链、离线可读）。
   玩法说明已并入用户协议，《游戏守则》仅用于上架自查，不在游戏内展示。
   ============================================================ */

const LEGAL_DOC_IDS = Object.freeze({ eula: 1, privacy: 2, terms: 3 });

function currentLegalLang() {
    const locale = (window.languageControl && typeof window.languageControl.getCurrentLocaleKey === 'function')
        ? window.languageControl.getCurrentLocaleKey()
        : (window.currentLocale || 'en');
    return String(locale).startsWith('zh') ? 'zh' : 'en';
}

/** 打开独立法律页面；弹窗被拦截时降级为当前标签跳转 */
function openLegalPage(kind) {
    const docId = LEGAL_DOC_IDS[kind] || LEGAL_DOC_IDS.eula;
    const params = new URLSearchParams();
    params.set('doc', String(docId));
    params.set('lang', currentLegalLang());
    const url = 'legal.html?' + params.toString();
    const win = window.open(url, '_blank', 'noopener');
    if (!win) window.location.href = url;
}

function openEulaDialog() { openLegalPage('eula'); }
function openPrivacyDialog() { openLegalPage('privacy'); }
function openTermsDialog() { openLegalPage('terms'); }

/* 兼容旧调用名：原「游戏规则」入口现在指向用户协议 */
function openRulesDialog() { openLegalPage('eula'); }
function openLegalDoc() { openLegalPage('eula'); }

function initLegalDialog() {
    const bind = (id, handler) => {
        const el = document.getElementById(id);
        if (el) el.onclick = handler;
    };

    bind('start-rules-btn', openEulaDialog);
    bind('start-privacy-btn', openPrivacyDialog);
    bind('start-terms-btn', openTermsDialog);
    bind('consent-eula-btn', openEulaDialog);
    bind('consent-privacy-btn', openPrivacyDialog);
    bind('consent-terms-btn', openTermsDialog);

    bind('settings-rules-btn', openEulaDialog);
    bind('settings-privacy-btn', openPrivacyDialog);
    bind('settings-terms-btn', openTermsDialog);
    bind('user-privacy-btn', openPrivacyDialog);
}
