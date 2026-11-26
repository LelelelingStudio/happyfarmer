/* ============================================================
   safeStorage.js — localStorage 安全包装
   ------------------------------------------------------------
   Poki 要求支持无痕模式：localStorage 可能不可用或抛异常。
   所有游戏代码统一走 HFStorage，底层失败时自动退化到内存存储，
   保证游戏仍然可玩（本次会话内有效）。
   ============================================================ */

(function () {
    'use strict';

    const memory = Object.create(null);
    let persistent = true;

    try {
        const probe = '__hf_storage_probe__';
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
    } catch (e) {
        persistent = false;
    }

    const read = (key) => {
        if (!persistent) return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
        try {
            return window.localStorage.getItem(key);
        } catch (e) {
            persistent = false;
            return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
        }
    };

    const write = (key, value) => {
        const text = String(value);
        memory[key] = text;
        if (!persistent) return false;
        try {
            window.localStorage.setItem(key, text);
            return true;
        } catch (e) {
            persistent = false;
            return false;
        }
    };

    const remove = (key) => {
        delete memory[key];
        if (!persistent) return;
        try { window.localStorage.removeItem(key); } catch (e) { persistent = false; }
    };

    window.HFStorage = {
        get available() { return persistent; },
        getItem: read,
        setItem: write,
        removeItem: remove,
        clear() {
            Object.keys(memory).forEach((key) => delete memory[key]);
            if (!persistent) return;
            try { window.localStorage.clear(); } catch (e) { persistent = false; }
        },
        keys() { return Object.keys(memory); },
    };
})();
