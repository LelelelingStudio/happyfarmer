#!/usr/bin/env node
/* ============================================================
   tools/check_i18n.js  —  全面校验 i18n 一致性
   ------------------------------------------------------------
   覆盖范围：
     - t() / tr() 调用与 data-i18n* 属性的 key 是否双语齐全
     - 动态拼接键（只认源码里真实出现的拼接前缀）
     - ui 包里重复的顶层键（会被 JS 静默覆盖）
     - legal.html?doc=1/2/3 三份法律文档的结构与版本
     - 6+ / 同意相关文案是否双语齐全
     - 英文数据包里是否残留中文字符串（排除注释）
   ============================================================ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = [
    path.join(ROOT, 'js'),
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'legal.html'),
];
const LANG_FILES = [
    [path.join(ROOT, 'langdata', 'ch', 'ui-ch.js'), path.join(ROOT, 'langdata', 'ch', 'messages-ch.js')],
    [path.join(ROOT, 'langdata', 'en', 'ui-en.js'), path.join(ROOT, 'langdata', 'en', 'messages-en.js')],
];
const DOC_FILES = [
    { locale: 'zh', file: path.join(ROOT, 'langdata', 'ch', 'documents-ch.js'), varName: 'DOCUMENTS_CH' },
    { locale: 'en', file: path.join(ROOT, 'langdata', 'en', 'documents-en.js'), varName: 'DOCUMENTS_EN' },
];
const DOC_KEYS = ['eula', 'privacy', 'terms'];
const DOC_FIELDS = ['title', 'version', 'updated', 'content'];
const CONSENT_KEYS = [
    'legal.ageLabel', 'legal.ageNote', 'legal.consent', 'legal.consentRequired',
    'legal.eula', 'legal.privacy', 'legal.terms',
    'legal.openEula', 'legal.openPrivacy', 'legal.openTerms',
    'legal.docNotFound',
];

function walk(dir) {
    const out = [];
    if (!fs.existsSync(dir)) return out;
    if (fs.statSync(dir).isFile()) return [dir];
    for (const entry of fs.readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (fs.statSync(p).isDirectory()) out.push(...walk(p));
        else if (p.endsWith('.js') || p.endsWith('.html')) out.push(p);
    }
    return out;
}

const files = SCAN_DIRS.flatMap(d => walk(d));

const tCalls = new Set();
const dynamicPrefixes = new Set();
const dataI18n = new Set();
const dataI18nTitle = new Set();
const dataI18nPlaceholder = new Set();
const dataI18nTip = new Set();
const dataI18nAnyKey = new Set();

for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    let m;

    /* legal.html 用的是 tr('...')，不能只匹配 t() */
    const reT = /(?:^|[^\w])(?:t|tr)\(\s*['"`]([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)['"`]/g;
    while ((m = reT.exec(code))) tCalls.add(m[1]);

    /* 只收集源码里真实出现的拼接前缀，避免「某个 key 恰好是另一个 key 的前缀」被误判为动态键 */
    const reDynQuoted = /(?:^|[^\w])(?:t|tr)\(\s*(['"`])([a-zA-Z][a-zA-Z0-9_.]*)\1\s*\+/g;
    while ((m = reDynQuoted.exec(code))) dynamicPrefixes.add(m[2]);
    const reDynTpl = /(?:^|[^\w])(?:t|tr)\(\s*`([a-zA-Z][a-zA-Z0-9_.]*)\$\{/g;
    while ((m = reDynTpl.exec(code))) dynamicPrefixes.add(m[1]);

    const reAttr = /data-i18n(-title|-placeholder|-tip)?\s*=\s*["']([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)["']/g;
    while ((m = reAttr.exec(code))) {
        const type = m[1] || '';
        const key = m[2];
        if (type === '-title') dataI18nTitle.add(key);
        else if (type === '-placeholder') dataI18nPlaceholder.add(key);
        else if (type === '-tip') dataI18nTip.add(key);
        else dataI18n.add(key);
        dataI18nAnyKey.add(key);
    }
}

/* 与运行时一致：ui 包 + messages 包合并（ui 优先，messages 只补缺） */
function parseLang(files) {
    const list = Array.isArray(files) ? files : [files];
    const merged = {};
    for (const file of list) {
        const code0 = fs.readFileSync(file, 'utf8');
        const code = code0.replace(/const\s+((?:LANG|MESSAGES)_[A-Z]+)\s*=/g, 'var $1 =');
        const ctx0 = vm.createContext({});
        vm.runInContext(code, ctx0);
        const varName = Object.keys(ctx0).find((k) => k.startsWith('LANG_') || k.startsWith('MESSAGES_'));
        if (varName && ctx0[varName]) mergeMissing(merged, ctx0[varName]);
    }
    return flatten(merged);
}

function mergeMissing(base, extra) {
    for (const k of Object.keys(extra)) {
        const b = base[k]; const e = extra[k];
        if (b && typeof b === 'object' && e && typeof e === 'object') mergeMissing(b, e);
        else if (!(k in base)) base[k] = e;
    }
    return base;
}

function flatten(obj) {
    const result = new Set();
    (function walkObj(o, prefix) {
        if (o == null || typeof o !== 'object' || Array.isArray(o)) return;
        for (const k of Object.keys(o)) {
            const v = o[k];
            const fullKey = prefix ? prefix + '.' + k : k;
            if (typeof v === 'string') result.add(fullKey);
            else if (typeof v === 'object' && v !== null) walkObj(v, fullKey);
        }
    })(obj, '');
    return result;
}

const LANG_CH = parseLang(LANG_FILES[0]);
const LANG_EN = parseLang(LANG_FILES[1]);

const allKeys = new Set([...tCalls, ...dataI18nAnyKey]);

function isDynamic(key) {
    for (const prefix of dynamicPrefixes) {
        if (key === prefix || key.startsWith(prefix + '.') || key.startsWith(prefix + '_')) return true;
    }
    return false;
}

/* 语言包里重复的顶层键会被 JS 静默丢弃（曾在 ui-ch.js 里丢掉 11 个键），必须报错 */
function findDuplicateTopKeys(file) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const seen = {};
    const dups = [];
    lines.forEach((line, i) => {
        const m = /^    ([A-Za-z_$][\w$]*): \{/.exec(line);
        if (!m) return;
        if (seen[m[1]] !== undefined) dups.push(m[1] + ' (行 ' + (seen[m[1]] + 1) + ' 与 ' + (i + 1) + ')');
        else seen[m[1]] = i;
    });
    return dups;
}

const duplicateKeyReports = [];
for (const group of LANG_FILES) {
    for (const file of (Array.isArray(group) ? group : [group])) {
        const dups = findDuplicateTopKeys(file);
        if (dups.length) duplicateKeyReports.push(path.relative(ROOT, file) + ': ' + dups.join(', '));
    }
}

/* -------- 法律文档结构 / 版本 -------- */
function readDocPack(entry) {
    const code = fs.readFileSync(entry.file, 'utf8')
        .replace(new RegExp('const\\s+' + entry.varName + '\\s*='), 'var ' + entry.varName + ' =');
    const ctx = vm.createContext({});
    vm.runInContext(code, ctx);
    return ctx[entry.varName] || {};
}

const constCode = fs.readFileSync(path.join(ROOT, 'langdata', 'constants.js'), 'utf8');
const GAME_VERSION = /const\s+GAME_VERSION\s*=\s*'([^']+)'/.exec(constCode);
const expectedVersion = GAME_VERSION ? GAME_VERSION[1] : null;
const docIssues = [];
for (const entry of DOC_FILES) {
    const pack = readDocPack(entry);
    const label = path.relative(ROOT, entry.file);
    for (const key of DOC_KEYS) {
        const doc = pack[key];
        if (!doc) {
            docIssues.push(label + ': 缺少文档 ' + key);
            continue;
        }
        for (const field of DOC_FIELDS) {
            if (typeof doc[field] !== 'string' || !doc[field].trim()) {
                docIssues.push(label + ': ' + key + '.' + field + ' 缺失或为空');
            }
        }
        if (expectedVersion && doc.version && doc.version !== expectedVersion) {
            docIssues.push(label + ': ' + key + '.version=' + doc.version + '，应为 ' + expectedVersion);
        }
    }
    const extra = Object.keys(pack).filter(k => !DOC_KEYS.includes(k));
    if (extra.length) docIssues.push(label + ': 存在非白名单文档键 ' + extra.join(', '));
}

/* -------- 6+ / 同意文案 -------- */
const consentIssues = [];
for (const [label, pack] of [['zh', LANG_CH], ['en', LANG_EN]]) {
    for (const key of CONSENT_KEYS) {
        if (!pack.has(key)) consentIssues.push(label + ': 缺少 ' + key);
    }
}

/* -------- 英文数据包的中文残留（剥掉注释，只看字符串字面量） -------- */
function stripComments(code) {
    return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function findChineseLiterals(f) {
    const code = stripComments(fs.readFileSync(f, 'utf8'));
    const hits = [];
    const re = /'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g;
    let m;
    while ((m = re.exec(code))) {
        const value = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
        if (value && /[\u4e00-\u9fff]/.test(value)) {
            const line = code.slice(0, m.index).split('\n').length;
            hits.push(path.relative(ROOT, f) + ':' + line + '  ' + value.slice(0, 80));
        }
    }
    return hits;
}
const chineseHits = [];
const enDataDir = path.join(ROOT, 'langdata', 'en');
for (const f of walk(enDataDir)) chineseHits.push(...findChineseLiterals(f));

/* -------- 汇总 -------- */
const allCh = [...LANG_CH];
const allEn = [...LANG_EN];
const missingCh = [...allKeys].filter(k => !LANG_CH.has(k) && !isDynamic(k)).sort();
const missingEn = [...allKeys].filter(k => !LANG_EN.has(k) && !isDynamic(k)).sort();
const dynamicKeys = [...allKeys].filter(k => !LANG_CH.has(k) && isDynamic(k)).sort();

console.log('===== i18n Check =====');
console.log('Scanned files:', files.length);
console.log('  t()/tr() calls:   ', tCalls.size);
console.log('  dynamic prefixes:', dynamicPrefixes.size);
console.log('  data-i18n:       ', dataI18n.size);
console.log('  data-i18n-title: ', dataI18nTitle.size);
console.log('  data-i18n-placeholder:', dataI18nPlaceholder.size);
console.log('  data-i18n-tip:   ', dataI18nTip.size);
console.log('LANG_CH keys:', LANG_CH.size, '   LANG_EN keys:', LANG_EN.size);
if (dynamicKeys.length) console.log('动态拼接键（已按源码前缀确认）:', dynamicKeys.join(', '));
console.log('');

let problems = 0;
function report(title, list) {
    if (!list.length) return;
    console.log(title + ' (' + list.length + '):');
    for (const item of list) console.log('  - ' + item);
    console.log('');
    problems += list.length;
}

report('重复的顶层键（后面的定义会静默覆盖前面的！）', duplicateKeyReports);
report('MISSING in LANG_CH (zh)', missingCh);
report('MISSING in LANG_EN (en)', missingEn);
report('法律文档结构 / 版本问题', docIssues);
report('6+ / 同意文案缺失', consentIssues);
report('英文数据包中文残留', chineseHits);

if (problems === 0) {
    console.log('All i18n / legal / consent checks passed. ✓');
    process.exit(0);
}
console.log('Total problems:', problems);
process.exit(1);
