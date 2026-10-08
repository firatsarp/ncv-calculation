import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = '__Host-ncv-session';
export const SESSION_SECONDS = 8 * 60 * 60;
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function equal(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authConfig(env = process.env) {
  const username = env.AUTH_USERNAME;
  const hash = env.AUTH_PASSWORD_HASH;
  const secret = env.AUTH_SESSION_SECRET;
  if (!username || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash || '') ||
      !secret || !/^[a-f0-9]{64,}$/.test(secret)) {
    throw new Error('Authentication environment variables are missing or invalid');
  }
  return { username, hash, secret };
}

export async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64, OPTIONS);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyCredentials(username, password, config = authConfig()) {
  if (typeof username !== 'string' || typeof password !== 'string' ||
      username.length > 256 || password.length > 1024) return false;
  const [, salt, expected] = config.hash.split('$');
  const actual = await scrypt(password, salt, 64, OPTIONS);
  const passwordMatches = equal(actual, Buffer.from(expected, 'hex'));
  return equal(username, config.username) && passwordMatches;
}

function sign(value, config) {
  return createHmac('sha256', config.secret).update(value).digest('base64url');
}
function version(config) {
  return sign(config.username + '\0' + config.hash, config);
}

export function createSession(config = authConfig(), now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: config.username, iat: issued, exp: issued + SESSION_SECONDS,
    nonce: randomBytes(16).toString('hex'), version: version(config),
  })).toString('base64url');
  return payload + '.' + sign(payload, config);
}

export function verifySession(token, config = authConfig(), now = Date.now()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !equal(parts[1], sign(parts[0], config))) return null;
  try {
    const session = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const time = Math.floor(now / 1000);
    if (session.sub !== config.username || session.version !== version(config) ||
        !Number.isInteger(session.iat) || !Number.isInteger(session.exp) ||
        session.iat > time || session.exp <= time ||
        session.exp - session.iat !== SESSION_SECONDS ||
        !/^[a-f0-9]{32}$/.test(session.nonce)) return null;
    return session;
  } catch { return null; }
}

export const sessionCookieOptions = {
  httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: SESSION_SECONDS,
};
export function safeNext(value) {
  return ['/', '/ncv-calculation', '/scenario'].includes(value) ? value : '/';
}
