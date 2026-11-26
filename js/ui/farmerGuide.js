/* ============================================================
   farmerGuide.js — 农场向导：点击移动 / WASD 与方向键移动
   在某个功能点停留超过 2 秒会自动打开对应弹窗。
   ============================================================ */

(function () {
    'use strict';

    const STORAGE_KEY = 'hf_farmer_guide';
    const DWELL_MS = 2000;
    const COOLDOWN_MS = 6000;
    const STEP = 48;

    const HOTSPOTS = [
        '#farmland .plot',
        '#buy-land-btn',
        '#fertilize-all-btn',
        '#water-all-btn',
        '#harvest-all-btn',
        '#till-all-btn',
        '#mall-btn',
        '#factory-btn',
        '#more-actions-btn',
        '#next-day-btn',
        '#merchant-hub-btn',
        '#quick-sell-btn',
        '#settings-btn',
        '#user-btn',
        '#log-btn',
        '#save-btn',
        '#crops-list .crop-item',
        '#inventory .inventory-item',
    ];

    let guide = null;
    let hint = null;
    let toggleBtn = null;
    let x = 60;
    let y = 300;
    let dwellTimer = null;
    let targetEl = null;
    let enabled = true;
    let walkingTimer = null;

    function text(key, fallback) {
        try {
            const value = (typeof t === 'function') ? t(key) : '';
            return (value && value !== key) ? value : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function build() {
        if (document.getElementById('farmer-guide')) return;

        guide = document.createElement('div');
        guide.id = 'farmer-guide';
        guide.setAttribute('aria-hidden', 'true');
        guide.textContent = '🧑‍🌾';
        document.body.appendChild(guide);

        hint = document.createElement('div');
        hint.id = 'farmer-guide-hint';
        hint.setAttribute('role', 'status');
        document.body.appendChild(hint);

        toggleBtn = document.createElement('button');
        toggleBtn.id = 'farmer-guide-toggle';
        toggleBtn.type = 'button';
        toggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            setEnabled(!enabled);
        });
        document.body.appendChild(toggleBtn);

        enabled = localStorage.getItem(STORAGE_KEY) !== 'off';
        setEnabled(enabled);
        place(x, y, false);
    }

    function setEnabled(value) {
        enabled = !!value;
        document.body.classList.toggle('farmer-guide-off', !enabled);
        localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
        if (toggleBtn) {
            toggleBtn.textContent = enabled
                ? text('farmerGuide.on', '🧑‍🌾 向导开启')
                : text('farmerGuide.off', '🧑‍🌾 向导关闭');
        }
        if (!enabled) clearDwell();
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function place(nx, ny, animate = true) {
        x = clamp(nx, 24, window.innerWidth - 24);
        y = clamp(ny, 24, window.innerHeight - 24);
        if (!guide) return;
        if (!animate) guide.style.transition = 'none';
        guide.style.transform = `translate3d(${x - 23}px, ${y - 23}px, 0)`;
        if (!animate) {
            void guide.offsetWidth;
            guide.style.transition = '';
        }
    }

    function clearDwell() {
        clearTimeout(dwellTimer);
        dwellTimer = null;
        if (targetEl) targetEl.classList.remove('farmer-guide-target');
        targetEl = null;
        if (hint) hint.classList.remove('show');
    }

    function hotspotAt(px, py) {
        for (const selector of HOTSPOTS) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                if (!el || !el.isConnected || el.offsetParent === null) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                if (px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom) {
                    return el;
                }
            }
        }
        return null;
    }

    function scheduleDwell() {
        clearDwell();
        if (!enabled || !document.body.classList.contains('game-started')) return;
        const el = hotspotAt(x, y);
        if (!el) return;

        targetEl = el;
        el.classList.add('farmer-guide-target');
        if (hint) {
            hint.textContent = text('farmerGuide.hint', 'Stand still 2s to open');
            hint.style.left = clamp(x + 28, 8, window.innerWidth - 190) + 'px';
            hint.style.top = clamp(y - 42, 8, window.innerHeight - 40) + 'px';
            hint.classList.add('show');
        }

        dwellTimer = setTimeout(() => {
            if (!el.isConnected) { clearDwell(); return; }
            const until = Number(el.dataset.farmerGuideCooldown || 0);
            if (Date.now() >= until) {
                el.dataset.farmerGuideCooldown = String(Date.now() + COOLDOWN_MS);
                el.click();
            }
            clearDwell();
        }, DWELL_MS);
    }

    function moveTo(nx, ny) {
        clearDwell();
        place(nx, ny);
        guide.classList.add('is-walking');
        clearTimeout(walkingTimer);
        walkingTimer = setTimeout(() => {
            guide.classList.remove('is-walking');
            scheduleDwell();
        }, 460);
    }

    function onPointerClick(event) {
        if (!enabled || !document.body.classList.contains('game-started')) return;
        if (event.target.closest('#farmer-guide-toggle, .dialog, .modal-overlay, #start-screen, #loading-screen')) return;
        const el = event.target.closest(HOTSPOTS.join(','));
        if (el) el.dataset.farmerGuideCooldown = String(Date.now() + COOLDOWN_MS);
        moveTo(event.clientX, event.clientY);
    }

    function onKeyDown(event) {
        if (!enabled || !document.body.classList.contains('game-started')) return;
        const tag = (event.target && event.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target.isContentEditable) return;
        if (document.querySelector('.dialog.show, .modal-overlay')) return;

        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
        const key = event.key.toLowerCase();
        let dx = 0;
        let dy = 0;
        if (key === 'arrowleft' || key === 'a') dx = -STEP;
        else if (key === 'arrowright' || key === 'd') dx = STEP;
        else if (key === 'arrowup' || key === 'w') dy = -STEP;
        else if (key === 'arrowdown' || key === 's') dy = STEP;
        else return;

        const nx = clamp(x + dx, 24, window.innerWidth - 24);
        const ny = clamp(y + dy, 24, window.innerHeight - 24);
        /* 已经到边界时不吞按键，保留浏览器原生滚动行为 */
        if (nx === x && ny === y) return;
        event.preventDefault();
        moveTo(nx, ny);
    }

    function onScroll() {
        if (!enabled) return;
        clearDwell();
    }

    function init() {
        build();
        document.addEventListener('click', onPointerClick, true);
        document.addEventListener('keydown', onKeyDown);
        const container = document.querySelector('.container');
        if (container) container.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', () => place(x, y, false));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
