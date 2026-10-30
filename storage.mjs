import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dataFile = process.env.DATA_FILE || join(import.meta.dirname, 'data', 'links.json');
const usersFile = join(dirname(dataFile), 'users.json');
const sessionsFile = join(dirname(dataFile), 'sessions.json');

function load(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

function save(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2));
  renameSync(temporary, file);
}

function localStore() {
  const links = load(dataFile);
  const users = load(usersFile);
  const sessions = load(sessionsFile);
  return {
    async findUserByEmail(email) { return Object.values(users).find(user => user.email === email) || null; },
    async getUser(id) { return users[id] || null; },
    async registerUser(user) {
      if (Object.values(users).some(item => item.email === user.email)) return false;
      const first = Object.keys(users).length === 0;
      users[user.id] = user;
      save(usersFile, users);
      if (first) {
        for (const link of Object.values(links)) if (!link.userId) link.userId = user.id;
        save(dataFile, links);
      }
      return true;
    },
    async createSession(hash, id, seconds) {
      sessions[hash] = { userId: id, expiresAt: Date.now() + seconds * 1000 };
      save(sessionsFile, sessions);
    },
    async getSession(hash) {
      const session = sessions[hash];
      return session?.expiresAt > Date.now() ? session.userId : null;
    },
    async deleteSession(hash) { delete sessions[hash]; save(sessionsFile, sessions); },
    async getLinks(id) { return Object.entries(links).filter(([, link]) => link.userId === id); },
    async getLink(code) { return links[code] || null; },
    async createLink(code, link) {
      if (links[code]) return false;
      links[code] = link;
      save(dataFile, links);
      return true;
    },
    async setTitle(code, title) { links[code].title = title; save(dataFile, links); },
    async recordClick(code) {
      links[code].clicks = (links[code].clicks || 0) + 1;
      links[code].lastClickedAt = new Date().toISOString();
      save(dataFile, links);
    },
  };
}

async function redisStore() {
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: redisUrl, token: redisToken });
  const prefix = 'shortener:';
  const linkKey = code => `${prefix}link:${code}`;
  const userKey = id => `${prefix}user:${id}`;
  const sessionKey = hash => `${prefix}session:${hash}`;
  async function getLink(code) {
    const link = await redis.get(linkKey(code));
    if (!link) return null;
    const [title, clicks, lastClickedAt] = await Promise.all([
      redis.get(`${prefix}title:${code}`),
      redis.get(`${prefix}clicks:${code}`),
      redis.get(`${prefix}last-click:${code}`),
    ]);
    return { ...link, title: title || link.title, clicks: Number(clicks || 0), lastClickedAt: lastClickedAt || null };
  }
  return {
    async findUserByEmail(email) {
      const id = await redis.get(`${prefix}email:${email}`);
      return id ? redis.get(userKey(id)) : null;
    },
    async getUser(id) { return redis.get(userKey(id)); },
    async registerUser(user) {
      const result = await redis.set(`${prefix}email:${user.email}`, user.id, { nx: true });
      if (result !== 'OK') return false;
      await redis.set(userKey(user.id), user);
      return true;
    },
    async createSession(hash, id, seconds) { await redis.set(sessionKey(hash), id, { ex: seconds }); },
    async getSession(hash) { return redis.get(sessionKey(hash)); },
    async deleteSession(hash) { await redis.del(sessionKey(hash)); },
    async getLinks(id) {
      const codes = await redis.smembers(`${prefix}user-links:${id}`);
      return (await Promise.all(codes.map(async code => [code, await getLink(code)]))).filter(([, link]) => link);
    },
    getLink,
    async createLink(code, link) {
      const result = await redis.set(linkKey(code), link, { nx: true });
      if (result !== 'OK') return false;
      await redis.sadd(`${prefix}user-links:${link.userId}`, code);
      return true;
    },
    async setTitle(code, title) { await redis.set(`${prefix}title:${code}`, title); },
    async recordClick(code) {
      await Promise.all([
        redis.incr(`${prefix}clicks:${code}`),
        redis.set(`${prefix}last-click:${code}`, new Date().toISOString()),
      ]);
    },
  };
}

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const hasRedisUrl = Boolean(redisUrl);
const hasRedisToken = Boolean(redisToken);
if (hasRedisUrl !== hasRedisToken) throw new Error('Both Upstash Redis environment variables are required.');
if (process.env.VERCEL && !hasRedisUrl) throw new Error('Connect Upstash Redis before deploying.');
export const storage = await (hasRedisUrl ? redisStore() : localStore());
