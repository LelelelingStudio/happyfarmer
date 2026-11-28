#!/usr/bin/env node
/* ============================================================
   tools/build-platforms.js
   从主项目重新生成五个平台发布目录（源码单一真实来源）。

   用法：node tools/build-platforms.js [--keep-extras]
     不带参数时整目录重建（先清空目标目录，再完整拷贝主项目）；
     --keep-extras 只覆盖主项目文件，保留目标目录里已有的其它文件。

   平台差异只有三类，全部在这里集中维护：
     1. head 里插入的 SDK / 适配层脚本
     2. 额外的 CSS / JS（如 poki-rewards）
     3. js/main.js 的启动方式（需要等 SDK ready 的平台改成动态注入）
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* 需要完整拷贝的主项目文件 / 目录 */
const COMMON = ['index.html', 'legal.html', 'languagecontrol.js', 'css', 'js', 'langdata', 'assets'];
/* 不属于游戏本体、但 GitHub Pages 需要的文件 */
const PAGE_EXTRA = ['CNAME'];

function readVersion() {
  const src = fs.readFileSync(path.join(ROOT, 'langdata/constants.js'), 'utf8');
  const m = src.match(/GAME_VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error('cannot read GAME_VERSION from langdata/constants.js');
  return m[1];
}

const PLATFORMS = [
  {
    id: 'poki',
    dir: 'happyfarmer-poki',
    headPre: ['js/core/safeStorage.js'],
    head: ['poki-bridge.js'],
    styles: ['css/poki-rewards.css'],
    beforeLoader: ['poki-rewards.js'],
    readyGlobal: '__pokiReady',
    pageExtras: PAGE_EXTRA,
  },
  {
    id: 'gamedistribution',
    dir: 'happyfarmer-gamedistribution',
    headPre: ['js/core/safeStorage.js'],
    head: ['gamedistribution-bridge.js'],
    readyGlobal: '__gdReady',
  },
  {
    id: 'newgrounds',
    dir: 'happyfarmer-newgrounds',
    head: [],
    readyGlobal: null,
  },
  {
    id: 'gamejolt',
    dir: 'happyfarmer-gamejolt',
    head: [],
    readyGlobal: null,
  },
  {
    id: 'crazygame',
    dir: 'happyfarmer-crazygame',
    headPre: ['js/core/safeStorage.js'],
    head: [],
    bodyEnd: ['https://sdk.crazygames.com/crazygames-sdk-v3.js', 'crazygame-bridge.js'],
    readyGlobal: '__crazyReady',
  },
];

function copyCommon(dest, keepExtras, version) {
  if (!keepExtras && fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const item of COMMON) {
    const src = path.join(ROOT, item);
    if (!fs.existsSync(src)) throw new Error('missing main project file: ' + item);
    fs.cpSync(src, path.join(dest, item), { recursive: true, force: true, filter: (p) => !p.endsWith('.DS_Store') });
  }
  return version;
}

function copyPlatformSources(platform, dest) {
  const srcDir = path.join(ROOT, 'platforms-src', platform.id);
  if (!fs.existsSync(srcDir)) return;
  fs.cpSync(srcDir, dest, { recursive: true, force: true });
}

/* ---------- index.html 改写 ---------- */

/* js/ 开头的本地脚本自动带上 ?v= 版本号，外链不动 */
function scriptTag(src, version, indent = '    ') {
  const href = src.startsWith('js/') ? `${src}?v=${version}` : src;
  return `${indent}<script src="${href}"></script>\n`;
}

function injectHead(html, tags, version) {
  if (!tags || !tags.length) return html;
  const anchor = '    <title>Happy Farmer</title>\n';
  const idx = html.indexOf(anchor);
  if (idx < 0) throw new Error('title anchor not found in index.html');
  let block = '';
  for (const t of tags) block += scriptTag(t, version);
  const at = idx + anchor.length;
  return html.slice(0, at) + block + html.slice(at);
}

/* 必须在 body 存在之后执行的脚本（例如会操作 document.body 的第三方 SDK） */
function injectBodyEnd(html, tags, version) {
  if (!tags || !tags.length) return html;
  const gatingIdx = html.indexOf('/* 等平台 SDK 适配层就绪');
  const anchorIdx = gatingIdx >= 0 ? html.lastIndexOf('<script>\n', gatingIdx) : html.indexOf('</body>');
  if (anchorIdx < 0) throw new Error('body end anchor not found in index.html');
  let block = '';
  for (const t of tags) block += scriptTag(t, version, '');
  return html.slice(0, anchorIdx) + block + html.slice(anchorIdx);
}

function injectStyles(html, hrefs) {
  if (!hrefs.length) return html;
  const re = /(<link rel="stylesheet" href="css\/farmerGuide\.css\?v=[^"]*">\n)/;
  const m = html.match(re);
  if (!m) throw new Error('style anchor not found in index.html');
  let block = '';
  for (const href of hrefs) block += `    <link rel="stylesheet" href="${href}">\n`;
  return html.replace(re, m[0] + block);
}

function injectBeforeLoader(html, scripts) {
  if (!scripts.length) return html;
  const re = /<script src="js\/core\/loader\.js\?v=[^"]*"><\/script>\n/;
  const m = html.match(re);
  if (!m) throw new Error('loader script tag not found in index.html');
  let block = '';
  for (const s of scripts) block += `<script src="${s}"></script>\n`;
  return html.replace(re, block + m[0]);
}

function rewriteMainLoader(html, platform) {
  if (!platform.readyGlobal) return html;
  const re = /<script src="js\/main\.js\?v=([^"]*)"><\/script>\n/;
  const m = html.match(re);
  if (!m) throw new Error('main.js script tag not found in index.html');
  const versioned = m[0].match(/src="([^"]*)"/)[1];
  const block =
    `<script>\n` +
    `/* 等平台 SDK 适配层就绪后再启动主流程（${platform.id}） */\n` +
    `Promise.resolve(window.${platform.readyGlobal}).then(function () {\n` +
    `    var s = document.createElement('script');\n` +
    `    s.src = '${versioned}';\n` +
    `    document.body.appendChild(s);\n` +
    `});\n` +
    `</script>\n`;
  return html.replace(re, block);
}

function patchIndex(platform, dest, version) {
  const file = path.join(dest, 'index.html');
  let html = fs.readFileSync(file, 'utf8');
  html = injectHead(html, [...(platform.headPre || []), ...(platform.head || [])], version);
  html = injectStyles(html, platform.styles || []);
  html = injectBeforeLoader(html, platform.beforeLoader || []);
  html = rewriteMainLoader(html, platform);
  html = injectBodyEnd(html, platform.bodyEnd || [], version);
  fs.writeFileSync(file, html);
}

/* ---------- main ---------- */

function main() {
  const keepExtras = process.argv.includes('--keep-extras');
  const version = readVersion();
  console.log(`building platforms for v${version}${keepExtras ? ' (keep-extras)' : ''}`);

  for (const platform of PLATFORMS) {
    const dest = path.join(ROOT, platform.dir);
    copyCommon(dest, keepExtras, version);
    for (const extra of platform.pageExtras || []) {
      const src = path.join(ROOT, extra);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(dest, extra), { force: true });
    }
    copyPlatformSources(platform, dest);
    patchIndex(platform, dest, version);

    const count = countFiles(dest);
    console.log(`  ${platform.dir}: ${count} files, main.js=${platform.readyGlobal ? 'gated on ' + platform.readyGlobal : 'direct'}`);
  }
}

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else n++;
    }
  };
  walk(dir);
  return n;
}

main();
