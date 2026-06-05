/**
 * autovote/server.js — HTTP server: login, dashboard, rule CRUD, history.
 *
 * Plain Node http + a small cookie session map. Server-rendered HTML pages +
 * a JSON API the pages call. No framework deps (keeps the Bot dependency
 * surface small; this is a testnet tool).
 *
 * AUTH MODEL (TESTNET ONLY): username + posting WIF. The WIF is validated
 * against the account on-chain, stored server-side (so the engine can vote on a
 * schedule), and a session cookie is issued. Production swaps this whole login
 * for OAuth + MELEK-Signer — see the SIGNER SEAM note in vote-engine.js.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { config } from './config.js';
import { Store } from './store.js';
import { Chain } from './chain.js';
import { VoteEngine } from './vote-engine.js';
import { clampWeight } from './rules.js';
import { page, loginPage } from './views.js';

const store = new Store(config.dbPath);
const chain = new Chain();
const engine = new VoteEngine(store, { chain });

const sessions = new Map(); // sid -> { username, at }
const SID_COOKIE = 'autovote_sid';

function newSid() {
  return crypto.randomBytes(24).toString('hex');
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionUser(req) {
  const sid = parseCookies(req)[SID_COOKIE];
  if (!sid) return null;
  const s = sessions.get(sid);
  return s ? s.username : null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function json(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const path = u.pathname;
  const method = req.method;

  try {
    // ---- health ----
    if (path === '/health') return json(res, 200, { ok: true, head: engine._cursor });

    // ---- login (POST) ----
    if (path === '/api/login' && method === 'POST') {
      const { username, postingKey } = await readBody(req);
      if (!username || !postingKey) return json(res, 400, { error: 'username and posting key required' });
      const ok = await chain.keyAuthorizesVote(String(username).toLowerCase().trim(), postingKey);
      if (!ok) return json(res, 401, { error: 'posting key does not authorize this account (testnet)' });
      store.upsertUser(username, postingKey);
      const sid = newSid();
      sessions.set(sid, { username: String(username).toLowerCase().trim(), at: Date.now() });
      return json(res, 200, { ok: true }, {
        'Set-Cookie': `${SID_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`,
      });
    }

    if (path === '/logout') {
      const sid = parseCookies(req)[SID_COOKIE];
      if (sid) sessions.delete(sid);
      return send(res, 302, '', { Location: '/', 'Set-Cookie': `${SID_COOKIE}=; Path=/; Max-Age=0` });
    }

    // ---- pages ----
    const me = sessionUser(req);
    if (path === '/' ) {
      if (!me) return send(res, 200, loginPage());
      return send(res, 200, page(me, store));
    }

    // ---- API (auth required) ----
    if (path.startsWith('/api/')) {
      if (!me) return json(res, 401, { error: 'not logged in' });

      if (path === '/api/state' && method === 'GET') {
        const r = store.rulesFor(me);
        return json(res, 200, {
          username: me,
          ...r,
          votes: store.votesFor(me, 100),
          votesToday: store.votesToday(me).length,
        });
      }

      if (path === '/api/trail' && method === 'POST') {
        const b = await readBody(req);
        if (!b.target) return json(res, 400, { error: 'target account required' });
        const t = store.addTrail({
          owner: me,
          target: b.target,
          weight: Math.max(0, Math.min(100, Number(b.weight) || 100)),
          delayMs: Math.max(0, Number(b.delaySec) || 0) * 1000,
          dailyCap: Math.max(0, Number(b.dailyCap) || 0),
        });
        return json(res, 200, t);
      }

      if (path === '/api/fanbase' && method === 'POST') {
        const b = await readBody(req);
        const authors = String(b.authors || '')
          .split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
        if (authors.length === 0) return json(res, 400, { error: 'at least one author required' });
        const f = store.addFanbase({
          owner: me,
          authors,
          weight: Math.max(0, Math.min(100, Number(b.weight) || 100)),
          delayMs: Math.max(0, Number(b.delaySec) || 0) * 1000,
          maxPerDay: Math.max(0, Number(b.maxPerDay) || 0),
        });
        return json(res, 200, f);
      }

      if (path === '/api/schedule' && method === 'POST') {
        const b = await readBody(req);
        if (!b.author || !b.permlink) return json(res, 400, { error: 'author and permlink required' });
        const voteAt = b.voteAt ? Date.parse(b.voteAt) : Date.now();
        if (!Number.isFinite(voteAt)) return json(res, 400, { error: 'invalid voteAt' });
        const s = store.addSchedule({
          owner: me,
          author: b.author,
          permlink: b.permlink,
          weight: clampWeight((Math.max(-100, Math.min(100, Number(b.weight) || 100)) / 100) * 10000),
          voteAt,
        });
        return json(res, 200, s);
      }

      if (path === '/api/pause' && method === 'POST') {
        const b = await readBody(req);
        const r = store.setPaused(b.kind, b.id, !!b.paused);
        if (!r || r.owner !== me) return json(res, 404, { error: 'not found' });
        return json(res, 200, r);
      }

      if (path === '/api/delete' && method === 'POST') {
        const b = await readBody(req);
        const ok = store.remove(b.kind, b.id, me);
        return json(res, ok ? 200 : 404, { ok });
      }

      return json(res, 404, { error: 'unknown api route' });
    }

    return send(res, 404, '<h1>404</h1>');
  } catch (err) {
    console.error('[server] error', err);
    return json(res, 500, { error: String(err?.message || err) });
  }
});

export function start() {
  engine.start();
  server.listen(config.port, config.host, () => {
    console.log(`[autovote] listening on http://${config.host}:${config.port}  rpc=${config.rpcUrl}`);
  });
}

// run when invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { server, store, engine };
