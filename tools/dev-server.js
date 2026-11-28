#!/usr/bin/env node
/* ============================================================
   tools/dev-server.js  —  本地开发用静态服务器
   ------------------------------------------------------------
   为什么不用 python3 -m http.server：
   它会在一堆并发请求（本作有 60+ 个脚本、190+ 张图）下
   直接给浏览器回 ERR_CONNECTION_RESET，加载器会永久停在 0%。

   这个服务器负责：
   - keep-alive + 高并发 accept，不会挤爆连接
   - 正确 MIME（.webp / .mp3 / .js / .css / .otf …）
   - Range 请求（浏览器取 mp3 元数据必需）
   - 默认 no-cache，方便改完代码刷新就生效（--cache 可打开缓存）
   用法：
     node tools/dev-server.js            # http://127.0.0.1:8765/
     node tools/dev-server.js 8080       # 指定端口
     node tools/dev-server.js --cache    # 允许浏览器缓存
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const useCache = args.includes('--cache');
const portArg = args.find((a) => /^\d+$/.test(a));
const PORT = Number(portArg || process.env.PORT || 8765);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.otf': 'font/otf',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.lsfp': 'application/octet-stream',
};

function resolvePath(urlPath) {
    const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
    const full = path.join(ROOT, cleanPath === '/' ? '/index.html' : cleanPath);
    /* 不允许跳出项目根目录 */
    if (!full.startsWith(ROOT)) return null;
    return full;
}

const server = http.createServer((req, res) => {
    const filePath = resolvePath(req.url || '/');
    if (!filePath) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }

        const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        const headers = {
            'Content-Type': type,
            'Accept-Ranges': 'bytes',
            'Cache-Control': useCache ? 'public, max-age=600' : 'no-cache, must-revalidate',
            'Access-Control-Allow-Origin': '*',
        };

        /* Range：mp3 / 图片断点请求 */
        const range = req.headers.range;
        if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (m) {
                const start = m[1] ? Number(m[1]) : 0;
                const end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
                if (start <= end) {
                    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
                    headers['Content-Length'] = end - start + 1;
                    res.writeHead(206, headers);
                    if (req.method === 'HEAD') { res.end(); return; }
                    fs.createReadStream(filePath, { start, end }).pipe(res);
                    return;
                }
            }
        }

        headers['Content-Length'] = stat.size;
        res.writeHead(200, headers);
        if (req.method === 'HEAD') { res.end(); return; }
        fs.createReadStream(filePath).pipe(res);
    });
});

/* 并发是重点：默认 backlog 5 太小，这里放大到 512 */
server.listen(PORT, '127.0.0.1', 512, () => {
    console.log(`dev-server: http://127.0.0.1:${PORT}/  (root: ${ROOT})`);
    console.log('按 Ctrl+C 结束。改完代码直接刷新页面即可（默认 no-cache）。');
});
