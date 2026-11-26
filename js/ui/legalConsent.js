/* ============================================================
   legalConsent.js  —  起始屏法律协议与适龄提示确认
   版本：v1.1.0
   ============================================================ */

(function () {
    function key() {
        return (typeof LEGAL_CONSENT_KEY !== 'undefined') ? LEGAL_CONSENT_KEY : 'farm_legal_consent_v1_1_0';
    }

    function version() {
        return (typeof LEGAL_CONSENT_VERSION !== 'undefined') ? LEGAL_CONSENT_VERSION : '1.1.0';
    }

    function readConsent() {
        try {
            const raw = HFStorage.getItem(key());
            if (!raw) return null;
            const data = JSON.parse(raw);
            return (data && data.accepted === true && data.version === version()) ? data : null;
        } catch (e) {
            return null;
        }
    }

    window.hasLegalConsent = function hasLegalConsent() {
        return !!readConsent();
    };

    window.grantLegalConsent = function grantLegalConsent() {
        try {
            HFStorage.setItem(key(), JSON.stringify({
                accepted: true,
                version: version(),
                at: Date.now(),
            }));
        } catch (e) { /* 隐私模式下写入失败：本次会话内仍允许继续 */ }
    };

    window.revokeLegalConsent = function revokeLegalConsent() {
        try { HFStorage.removeItem(key()); } catch (e) { /* ignore */ }
    };

    window.showLegalConsentRequired = function showLegalConsentRequired() {
        const box = document.getElementById('legal-consent');
        const warning = document.getElementById('legal-consent-warning');
        const checkbox = document.getElementById('legal-consent-check');
        if (warning) {
            warning.hidden = false;
            if (typeof t === 'function') {
                const msg = t('legal.consentRequired');
                if (msg) warning.textContent = msg;
            }
        }
        if (box) {
            box.classList.remove('consent-shake');
            void box.offsetWidth;
            box.classList.add('consent-shake');
        }
        if (checkbox && typeof checkbox.focus === 'function') checkbox.focus();
    };

    window.ensureLegalConsent = function ensureLegalConsent() {
        if (window.hasLegalConsent()) return true;
        window.showLegalConsentRequired();
        return false;
    };

    function bind() {
        const checkbox = document.getElementById('legal-consent-check');
        const warning = document.getElementById('legal-consent-warning');
        if (!checkbox) return;

        checkbox.checked = window.hasLegalConsent();
        if (warning) warning.hidden = true;

        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                window.grantLegalConsent();
                if (warning) warning.hidden = true;
            } else {
                window.revokeLegalConsent();
            }
        });
    }

    window.initLegalConsent = bind;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }
})();
