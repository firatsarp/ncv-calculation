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

test('built Next server login, protected routes, cookie flags, CSRF and logout', async () => {
  const password = randomBytes(18).toString('hex');
  const base = 'http://localhost:3187';
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3187'], {
    env: { ...process.env, AUTH_USERNAME: 'test-user', AUTH_PASSWORD_HASH: await hashPassword(password), AUTH_SESSION_SECRET: randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', data => logs += data);
  child.stderr.on('data', data => logs += data);
  const request = (path, options = {}) => fetch(base + path, { redirect: 'manual', ...options });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await request('/login')).status === 200) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    for (const path of ['/', '/ncv-calculation', '/scenario', '/scenario?test=1']) {
      const result = await request(path);
      assert.equal(result.status, 307);
      assert.ok(result.headers.get('location').includes('/login'));
    }
    const post = (path, username, pass, origin = base, next = '/scenario') => request(path, {
      method: 'POST', headers: { Origin: origin },
      body: new URLSearchParams({ username, password: pass, next }),
    });
    assert.equal((await post('/api/auth/login', 'test-user', password, 'https://example.org')).status, 403);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: new URLSearchParams() })).status, 403);
    const bad = await post('/api/auth/login', 'test-user', password + 'x');
    assert.equal(bad.status, 303);
    assert.ok(bad.headers.get('location').includes('error=invalid'));
    assert.ok((await (await request('/login?error=invalid')).text()).includes('role="alert"'));
    const good = await post('/api/auth/login', 'test-user', password);
    assert.equal(good.status, 303);
    assert.equal(new URL(good.headers.get('location')).pathname, '/scenario');
    const cookie = good.headers.get('set-cookie');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=strict', 'Path=/', 'Max-Age=28800']) assert.ok(cookie.includes(flag), flag);
    const cookieHeader = cookie.split(';')[0];
    for (const path of ['/', '/ncv-calculation', '/scenario']) {
      const result = await request(path, { headers: { Cookie: cookieHeader } });
      assert.equal(result.status, 200, path);
      assert.ok(result.headers.get('cache-control').includes('no-store'));
      assert.ok((await result.text()).includes('Çıkış yap'));
    }
    assert.equal((await request('/scenario', { headers: { Cookie: cookieHeader + 'x' } })).status, 307);
    const externalNext = await post('/api/auth/login', 'test-user', password, base, 'https://example.org');
    assert.equal(new URL(externalNext.headers.get('location')).pathname, '/');
    assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://example.org' } })).status, 403);
    const logout = await request('/api/auth/logout', { method: 'POST', headers: { Origin: base, Cookie: cookieHeader } });
    assert.equal(logout.status, 303);
    assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
    assert.equal((await request('/scenario')).status, 307);
    assert.equal((await request('/api/auth/logout')).status, 405);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
});
