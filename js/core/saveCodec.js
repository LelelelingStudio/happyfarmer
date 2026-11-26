/* ============================================================
   saveCodec.js  —  存档编码 / 解码
   ------------------------------------------------------------
   设计目标（按需求）：简单、可逆、挡住 99% 直接改存档的人。
   （挡不住会读代码的人，这是既定取舍。）

   编码顺序（三层）：
     1) 字符反转：按 Unicode 码点整段倒序
     2) Unicode 偏移：每个码点 +1（BMP 字符结果与旧版「码元 +1」完全一致）
     3) Base64（UTF-8 安全版）：再反转一次

   解码就是完全逆序执行。

   ⚠️ 为什么不用「base64 之后再 unicode+1」的原始写法：
      base64 结果里可能有 '+' '/' '=' 等字符，+1 之后会得到 '{' '|' '>'
      这类字符；而且如果先对含中文/emoji 的 JSON 直接反转，会切碎代理对
      （surrogate pair），存回去就变成非法字符串。
      所以这里用 UTF-8 → base64 的安全组合，保证任何内容都能往返。

   ⚠️ 码点 vs 码元：旧实现对 UTF-16 码元逐个 +1，遇到非 BMP 字符（如 🏿）
      会产生孤立高代理，encodeURIComponent 抛错后退化到 TextEncoder，
      最终把该字符替换成 U+FFFD，导致含此类 emoji 的昵称/内容损坏。
      现改为按码点位移修复该问题；BMP 字符结果不变，旧存档仍可解码。
   ============================================================ */

const SAVE_CODEC_PREFIX = 'HF1:';   /* 编码后的存档以此开头，用来区分旧版明文 JSON */

/* ---------- UTF-8 安全的 base64 ---------- */

function utf8ToBase64(str) {
    try {
        return btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
        /* 极小概率遇到超长字符串，退化为分段处理 */
        const bytes = new TextEncoder().encode(str);
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(bin);
    }
}

function base64ToUtf8(b64) {
    const bin = atob(b64);
    try {
        return decodeURIComponent(escape(bin));
    } catch (e) {
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }
}

/* ---------- 三层编码 ---------- */

/** 1) 整段倒序 */
function reverseString(str) {
    /* 用 Array.from 按「码点」反转，避免切碎 emoji */
    return Array.from(str).reverse().join('');
}

/** 2) 每个 Unicode 码点 +1 / -1（BMP 字符与旧版码元实现结果一致） */
function shiftCodeUnits(str, delta) {
    let out = '';
    for (const ch of str) {
        const shifted = ch.codePointAt(0) + delta;
        /* 极端边界：位移后落在代理区或超出 Unicode 范围时保持原样，避免产生非法字符串 */
        out += (shifted >= 0 && shifted <= 0x10FFFF && !(shifted >= 0xD800 && shifted <= 0xDFFF))
            ? String.fromCodePoint(shifted)
            : ch;
    }
    return out;
}

/**
 * 编码存档对象 → 字符串
 * 顺序：JSON → 倒序 → Unicode+1 → base64 → 再倒序 → 加前缀
 */
function encodeSave(obj) {
    const json = JSON.stringify(obj);
    const reversed = reverseString(json);
    const shifted = shiftCodeUnits(reversed, 1);
    const b64 = utf8ToBase64(shifted);
    const finalStr = reverseString(b64);
    return SAVE_CODEC_PREFIX + finalStr;
}

/**
 * 解码字符串 → 存档对象；失败返回 null
 * 完全逆序：去前缀 → 倒序 → base64 解 → Unicode-1 → 再倒序 → JSON.parse
 */
function decodeSave(text) {
    if (typeof text !== 'string' || !text) return null;

    try {
        /* 新版（带前缀） */
        if (text.startsWith(SAVE_CODEC_PREFIX)) {
            const body = text.slice(SAVE_CODEC_PREFIX.length);
            const unReversed = reverseString(body);
            const shiftedBack = base64ToUtf8(unReversed);
            const original = shiftCodeUnits(shiftedBack, -1);
            const json = reverseString(original);
            return JSON.parse(json);
        }

        /* 旧版：明文 JSON（兼容） */
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (e) {
        console.warn('[saveCodec] 解码失败：', e && e.message);
        return null;
    }
}

/** 判断一段文本是不是新版加密存档 */
function isEncodedSave(text) {
    return typeof text === 'string' && text.startsWith(SAVE_CODEC_PREFIX);
}

/** 自检：编码 → 解码 必须完全一致（单元测试用） */
function selfTestSaveCodec() {
    const samples = [
        { a: 1, b: '中文', c: [1, 2, 3] },
        { emoji: '🌱🥕🐼', nested: { x: '测试', y: null } },
        { n: 1.5, s: 'quote"and\\backslash', arr: [{ k: '值' }] },
        { big: 'x'.repeat(5000) },
        /* 非 BMP 码点：肤色修饰符与 ZWJ 组合，旧实现会被替换成 U+FFFD */
        { emoji: 'skin🏿tone family 👨‍👩‍👧‍👦', note: 'non-BMP' },
    ];
    for (const s of samples) {
        const enc = encodeSave(s);
        const dec = decodeSave(enc);
        if (JSON.stringify(dec) !== JSON.stringify(s)) return false;
    }
    return true;
}
