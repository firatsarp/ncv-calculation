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
  const passwordMatches = equal(ac¶»§q«^