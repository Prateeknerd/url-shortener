import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

async function availablePort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function startServer(port, dataFile) {
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: import.meta.dirname,
    env: { ...process.env, PORT: String(port), BASE_URL: `http://localhost:${port}`, DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Server exited with code ${code}`)));
  });
  return child;
}

async function stopServer(child) {
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));
}

function post(origin, path, body, cookie) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

test('accounts own links, titles and analytics persist', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'shortener-test-'));
  const dataFile = join(directory, 'links.json');
  writeFileSync(dataFile, JSON.stringify({ old1234: { url: 'https://legacy.example/path', createdAt: new Date().toISOString() } }));
  const port = await availablePort();
  const origin = `http://localhost:${port}`;
  let child;

  try {
    child = await startServer(port, dataFile);
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await fetch(`${origin}/login`)).status, 200);
    assert.equal((await fetch(`${origin}/register`)).status, 200);
    assert.equal((await fetch(`${origin}/auth.js`)).status, 200);
    assert.equal((await fetch(`${origin}/api/links`)).status, 401);
    assert.equal((await post(origin, '/api/shorten', { url: 'https://example.com' })).status, 401);

    const registration = await post(origin, '/api/auth/register', { email: 'first@example.com', password: 'password123' });
    assert.equal(registration.status, 200);
    const cookie = registration.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^session=[a-f0-9]{64}$/);
    let analytics = await (await fetch(`${origin}/api/links`, { headers: { Cookie: cookie } })).json();
    assert.equal(analytics.links.length, 1);
    assert.equal(analytics.links[0].title, 'legacy.example');

    const created = await post(origin, '/api/shorten', { url: 'example.com/a/long/path', title: 'My article' }, cookie);
    assert.equal(created.status, 201);
    const link = await created.json();
    assert.equal(link.title, 'My article');
    assert.match(link.shortUrl, new RegExp(`^${origin}/[A-Za-z0-9_-]{5}$`));

    const updated = await fetch(`${origin}/api/links/${link.code}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ title: 'Renamed article' }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).title, 'Renamed article');

    const redirect = await fetch(link.shortUrl, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'https://example.com/a/long/path');
    analytics = await (await fetch(`${origin}/api/links`, { headers: { Cookie: cookie } })).json();
    assert.equal(analytics.links[0].clicks, 1);
    assert.ok(analytics.links[0].lastClickedAt);

    const second = await post(origin, '/api/auth/register', { email: 'second@example.com', password: 'password456' });
    assert.equal(second.status, 200);
    const secondCookie = second.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(`${origin}/api/links`, { headers: { Cookie: secondCookie } })).json()).links.length, 0);
    assert.equal((await fetch(`${origin}/api/links/${link.code}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: secondCookie }, body: JSON.stringify({ title: 'No' }),
    })).status, 404);

    await stopServer(child);
    child = await startServer(port, dataFile);
    analytics = await (await fetch(`${origin}/api/links`, { headers: { Cookie: cookie } })).json();
    assert.equal(analytics.links[0].title, 'Renamed article');
    assert.equal(analytics.links[0].clicks, 1);
    assert.equal((await post(origin, '/api/auth/login', { email: 'first@example.com', password: 'wrongpass' })).status, 401);
    assert.equal((await post(origin, '/api/auth/login', { email: 'first@example.com', password: 'password123' })).status, 200);
    assert.equal((await post(origin, '/api/auth/logout', {}, cookie)).status, 200);
    assert.equal((await fetch(`${origin}/api/links`, { headers: { Cookie: cookie } })).status, 401);
  } finally {
    if (child && child.exitCode === null) await stopServer(child);
    rmSync(directory, { recursive: true, force: true });
  }
});
