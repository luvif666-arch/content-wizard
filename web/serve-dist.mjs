// 极简静态文件服务器：只依赖 Node 内置模块，不 spawn 任何子进程。
// 用途：把 `dist/` 作为已构建的网页在本地打开，便于验收与截图。
// 用法：node serve-dist.mjs [port]
//
// 默认端口 5240：与开发模式（5233）分开，让「验收构建产物」和「改代码热更新」互不干扰。

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const port = Number(process.argv[2] ?? 5240);
const root = resolve(import.meta.dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, safe);

  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }
  // 单页应用：找不到文件时回落到 index.html
  if (!existsSync(filePath)) {
    filePath = join(root, 'index.html');
  }

  res.writeHead(200, {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`content-wizard 已构建版本: http://127.0.0.1:${port}/`);
});
