import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { authConfig, hashPassword, verifyCredentials, createSession, verifySession, SESSION_SECONDS, safeNext } from '../lib/auth-core.mjs';

test('credentials, tamper protection, expiry and rotation', async () => {
  const password = randomBytes(18).toString('hex');
  const env = { AUTH_USERNAME: 'test-user', AUTH_PASSWORD_HASH: await hashPassword(password), AUTH_SESSION_SECRET: randomBytes(32).toString('hex') };
  const config = authConfig(env);
  assert.equal(await verifyCredentials(env.AUTH_USERNAME, password, config), true);
  assert.equal(await verifyCredentials(env.AUTH_USERNAME, password + 'x', config), false);
  assert.equal(await verifyCredentials('wrong', password, config), false);
  assert.throws(() => authConfig({}));
  const token = createSession(config);
  assert.ok(verifySession(token, config));
  assert.equal(verifySession(token + 'x', config), null);
  assert.equal(verifySession(token, config, Date.now() + SESSION_SECONDS * 1000), null);
  assert.equal(verifySession(token, { ...config, secret: randomBytes(32).toString('hex') }), null);
  assert.equal(verifySession(token, { ...config, hash: await hashPassword(password + 'x') }), null);
  assert.equal(safeNext('https://example.org'), '/');
  assert.equal(safeNext('//example.org'), '/');
});

test('built Next server logi¶»§q«^