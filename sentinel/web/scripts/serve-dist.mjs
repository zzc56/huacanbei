import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { accountCookie, authOrigin } from './auth-origin.mjs';

// 交付版静态预览，只监听本机；无需 npm install。开发仍使用 Vite。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const liveOrigin = process.env.SENTINEL_LIVE_ORIGIN ?? 'http://127.0.0.1:3001';
const workspace = process.env.SENTINEL_WORKSPACE;
const authPosts = new Set([
  '/api/auth/send-code', '/api/auth/register', '/api/auth/login',
  '/api/auth/send-reset-code', '/api/auth/reset-password',
]);
const liveSettings = new Set(['/api/live/radar-settings', '/api/live/calibration']);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8',
};

function proxyApi(request, response, pathname, origin) {
  const headers = {};
  for (const name of ['content-type', 'content-length', 'origin', 'cookie']) {
    if (request.headers[name]) headers[name] = request.headers[name];
  }
  if (pathname.startsWith('/api/auth/')) {
    const cookie = accountCookie(request.headers.cookie);
    if (cookie) headers.cookie = cookie;
    else delete headers.cookie;
  }
  const target = new URL(pathname, origin);
  const transport = target.protocol === 'https:' ? https : http;
  const upstream = transport.request(target, {
    method: request.method,
    headers,
    timeout: 35_000,
  }, (result) => {
    const outgoing = { 'Content-Type': result.headers['content-type'] ?? 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
    for (const name of ['content-disposition', 'content-length']) {
      if (result.headers[name]) outgoing[name] = result.headers[name];
    }
    if (result.headers['set-cookie']) outgoing['Set-Cookie'] = result.headers['set-cookie'];
    response.writeHead(result.statusCode, outgoing);
    result.on('error', () => response.destroy());
    result.pipe(response);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Local API timed out')));
  upstream.on('error', () => {
    if (response.destroyed) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: (pathname.startsWith('/api/live/') || pathname.startsWith('/api/replays')) ? '实时服务未启动或暂时不可用' : '账号服务未启动或暂时不可用' }));
  });
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
}

function mediaRange(header, size) {
  const parts = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!parts || (!parts[1] && !parts[2]) || size === 0) return;
  if (parts[1]) {
    const start = Number(parts[1]);
    const end = parts[2] ? Math.min(Number(parts[2]), size - 1) : size - 1;
    if (start < size && end >= start) return { start, end };
  } else {
    const length = Number(parts[2]);
    if (length > 0) return { start: Math.max(0, size - length), end: size - 1 };
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if ((request.method === 'POST' && authPosts.has(pathname)) || (request.method === 'GET' && pathname === '/api/auth/session')) {
      proxyApi(request, response, pathname, authOrigin);
      return;
    }
    if ((liveSettings.has(pathname) && ['GET', 'POST'].includes(request.method)) ||
      (pathname === '/api/live/calibration/observations' && request.method === 'GET')) {
      proxyApi(request, response, pathname + url.search, liveOrigin);
      return;
    }
    if ((pathname === '/api/replays' && ['GET', 'POST'].includes(request.method)) ||
      (request.method === 'GET' && /^\/api\/replays\/[0-9a-f-]+$/i.test(pathname))) {
      proxyApi(request, response, pathname + url.search, liveOrigin);
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    const extension = extname(file);
    const headers = {
      'Content-Type': mime[extension] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (pathname === '/real-data-version.json' && workspace) headers['X-Sentinel-Workspace'] = workspace;
    let range;
    if (['.mp4', '.webm'].includes(extension)) {
      headers['Accept-Ranges'] = 'bytes';
      if (request.method === 'GET' && request.headers.range) {
        range = mediaRange(request.headers.range, info.size);
        if (!range) {
          response.writeHead(416, { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${info.size}` });
          response.end();
          return;
        }
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
        headers['Content-Length'] = range.end - range.start + 1;
      }
    }
    response.writeHead(range ? 206 : 200, headers);
    if (request.method === 'HEAD') response.end();
    else await pipeline(createReadStream(file, range), response);
  } catch {
    if (response.destroyed) return;
    if (response.headersSent) { response.destroy(); return; }
    response.writeHead(404);
    response.end('File not found. Please run npm run build first.');
  }
});
server.on('error', (error) => {
  console.error('无法启动预览：', error.message);
  process.exitCode = 1;
});
server.listen(4173, '127.0.0.1', () =>
  console.log('SENTINEL 驾驶舱：http://127.0.0.1:4173/ （Ctrl+C 停止）'),
);
