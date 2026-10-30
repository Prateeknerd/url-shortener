import http from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storage } from './storage.mjs';
import { dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const baseUrl = (process.env.BASE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `http://localhost:${port}`)).replace(/\/$/, '');
const sessionSeconds = 30 * 24 * 60 * 60;

function respond(res, status, body, contentType = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...headers });
  res.end(contentType.startsWith('application/json') ? JSON.stringify(body) : body);
}

function normalizeUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error('Request is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(JSON.parse(body)));
    req.on('error', reject);
  });
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function currentUser(req) {
  const token = /(?:^|; )session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  const id = await storage.getSession(tokenHash(token));
  return id ? storage.getUser(id) : null;
}

function sessionCookie(token, maxAge) {
  const secure = baseUrl.startsWith('https://') ? '; Secure' : '';
  return `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

async function startSession(res, user) {
  const token = randomBytes(32).toString('hex');
  await storage.createSession(tokenHash(token), user.id, sessionSeconds);
  return respond(res, 200, { user: { id: user.id, email: user.email } }, 'application/json; charset=utf-8', {
    'Set-Cookie': sessionCookie(token, sessionSeconds),
  });
}

function linkView(code, link) {
  return {
    code,
    title: link.title || new URL(link.url).hostname,
    shortUrl: `${baseUrl}/${code}`,
    originalUrl: link.url,
    createdAt: link.createdAt,
    clicks: link.clicks || 0,
    lastClickedAt: link.lastClickedAt || null,
  };
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/login': ['auth.html', 'text/html; charset=utf-8'],
  '/register': ['auth.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/auth.js': ['auth.js', 'text/javascript; charset=utf-8'],
};

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, baseUrl).pathname;

  if (req.method === 'GET' && staticFiles[path]) {
    const [file, type] = staticFiles[path];
    return respond(res, 200, readFileSync(join(publicDir, file), 'utf8'), type);
  }

  if (req.method === 'GET' && path === '/api/auth/me') {
    const user = await currentUser(req);
    return user
      ? respond(res, 200, { user: { id: user.id, email: user.email } })
      : respond(res, 401, { error: 'Please sign in.' });
  }

  if (req.method === 'POST' && path === '/api/auth/register') {
    try {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(res, 400, { error: 'Send a JSON object.' });
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = body.password;
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return respond(res, 400, { error: 'Enter a valid email address.' });
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) return respond(res, 400, { error: 'Use a password with 8 to 128 characters.' });
      const id = randomBytes(12).toString('hex');
      const salt = randomBytes(16).toString('hex');
      const user = { id, email, salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
      if (!await storage.registerUser(user)) return respond(res, 409, { error: 'An account with this email already exists.' });
      return startSession(res, user);
    } catch (error) {
      if (error instanceof SyntaxError) return respond(res, 400, { error: 'Send valid JSON.' });
      console.error(error);
      return respond(res, 500, { error: 'Could not create the account.' });
    }
  }

  if (req.method === 'POST' && path === '/api/auth/login') {
    try {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(res, 400, { error: 'Send a JSON object.' });
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const user = await storage.findUserByEmail(email);
      const password = body.password;
      if (!user || typeof password !== 'string') return respond(res, 401, { error: 'Invalid email or password.' });
      const actual = scryptSync(password, user.salt, 64);
      if (!timingSafeEqual(actual, Buffer.from(user.passwordHash, 'hex'))) return respond(res, 401, { error: 'Invalid email or password.' });
      return startSession(res, user);
    } catch (error) {
      if (error instanceof SyntaxError) return respond(res, 400, { error: 'Send valid JSON.' });
      console.error(error);
      return respond(res, 500, { error: 'Could not sign in.' });
    }
  }

  if (req.method === 'POST' && path === '/api/auth/logout') {
    const token = /(?:^|; )session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (token) {
      await storage.deleteSession(tokenHash(token));
    }
    return respond(res, 200, { ok: true }, 'application/json; charset=utf-8', {
      'Set-Cookie': sessionCookie('', 0),
    });
  }

  if (req.method === 'GET' && path === '/api/links') {
    const user = await currentUser(req);
    if (!user) return respond(res, 401, { error: 'Please sign in.' });
    const items = (await storage.getLinks(user.id))
      .map(([code, link]) => linkView(code, link))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return respond(res, 200, { links: items });
  }

  if (req.method === 'POST' && path === '/api/shorten') {
    const user = await currentUser(req);
    if (!user) return respond(res, 401, { error: 'Please sign in.' });
    try {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(res, 400, { error: 'Send a JSON object.' });
      const originalUrl = normalizeUrl(body.url);
      if (!originalUrl) return respond(res, 400, { error: 'Enter a valid http or https URL.' });
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (title.length > 80) return respond(res, 400, { error: 'Keep the title under 80 characters.' });
      const link = { userId: user.id, title: title || new URL(originalUrl).hostname, url: originalUrl, createdAt: new Date().toISOString(), clicks: 0, lastClickedAt: null };
      let code;
      do { code = randomBytes(4).toString('base64url').slice(0, 5); } while (!await storage.createLink(code, link));
      return respond(res, 201, linkView(code, link));
    } catch (error) {
      if (error instanceof SyntaxError) return respond(res, 400, { error: 'Send valid JSON.' });
      console.error(error);
      return respond(res, 500, { error: 'Could not create the short link.' });
    }
  }

  const editMatch = /^\/api\/links\/([A-Za-z0-9_-]{5,7})$/.exec(path);
  if (req.method === 'PATCH' && editMatch) {
    const user = await currentUser(req);
    if (!user) return respond(res, 401, { error: 'Please sign in.' });
    const link = await storage.getLink(editMatch[1]);
    if (!link || link.userId !== user.id) return respond(res, 404, { error: 'Link not found.' });
    try {
      const body = await readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) return respond(res, 400, { error: 'Send a JSON object.' });
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > 80) return respond(res, 400, { error: 'Enter a title under 80 characters.' });
      await storage.setTitle(editMatch[1], title);
      link.title = title;
      return respond(res, 200, linkView(editMatch[1], link));
    } catch (error) {
      if (error instanceof SyntaxError) return respond(res, 400, { error: 'Send valid JSON.' });
      console.error(error);
      return respond(res, 500, { error: 'Could not update the title.' });
    }
  }

  if (req.method === 'GET' && /^\/[A-Za-z0-9_-]{5,7}$/.test(path)) {
    const link = await storage.getLink(path.slice(1));
    if (link) {
      await storage.recordClick(path.slice(1));
      res.writeHead(302, { Location: link.url, 'Cache-Control': 'no-store' });
      return res.end();
    }
  }

  return respond(res, 404, { error: 'Not found.' });
});

server.listen(port, process.env.HOST || (process.env.VERCEL ? '0.0.0.0' : 'localhost'), () => console.log(`URL shortener running at ${baseUrl}`));
