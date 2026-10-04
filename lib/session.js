import crypto from 'node:crypto';

function secret() {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
  return s;
}

const mac = (body) => crypto.createHmac('sha256', secret()).update(body).digest();

export function sign(payload, maxAgeSeconds) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + maxAgeSeconds })).toString('base64url');
  return `${body}.${mac(body).toString('base64url')}`;
}

export function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, given] = token.split('.');
  const expected = mac(body);
  const actual = Buffer.from(given, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function setCookie(res, name, value, { maxAge } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Lax', 'HttpOnly'];
  if ((process.env.APP_URL || '').startsWith('https')) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  const previous = res.getHeader('Set-Cookie');
  const list = previous ? (Array.isArray(previous) ? previous : [previous]) : [];
  res.setHeader('Set-Cookie', [...list, parts.join('; ')]);
}

export const clearCookie = (res, name) => setCookie(res, name, '', { maxAge: 0 });

export function currentUserId(req) {
  const payload = verify(parseCookies(req.headers.cookie)['rs_session']);
  return payload?.uid ?? null;
}
