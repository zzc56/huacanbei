import { readFileSync } from 'node:fs';

const { origin: sharedOrigin } = JSON.parse(
  readFileSync(new URL('../auth-service.json', import.meta.url), 'utf8'),
);
const configured = process.env.SENTINEL_AUTH_ORIGIN?.trim() || sharedOrigin;
let url;
try {
  url = new URL(configured ?? 'http://127.0.0.1:3001');
} catch {
  throw new Error('账号服务地址必须是有效的 URL。');
}

const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
if (
  (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
  url.username || url.password || url.pathname !== '/' || url.search || url.hash
) {
  throw new Error('公共账号服务地址必须使用 HTTPS，并且只包含域名及可选端口。');
}

export const authOrigin = url.origin;

export function accountCookie(cookies) {
  return cookies?.split(';').map(cookie => cookie.trim()).find(cookie => cookie.startsWith('sentinel_session='));
}
