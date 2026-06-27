/**
 * autovote/server.js — HTTP server (chain-agnostic).
 *
 * Pages: login (pick chain + auth method), dashboard, teaching/setup guides,
 * awareness page, rule CRUD, history. HiveSigner OAuth callback. WhaleVault
 * in-browser session bootstrap.
 *
 * AUTH MODELS:
 *   postingkey — username + posting WIF, validated on-chain, stored server-side.
 *                Least-preferred; testnet/throwaway only (MELEK default).
 *   hivesigner — OAuth2 (Hive). Revocable bearer token used server-side so
 *                scheduled votes fire while the user is offline. Keyless.
 *   whalevault — browser-extension signing, ONLY while the tab is open. We hold
 *                no credential; the page signs client-side. In-browser mode.
 *
 * Plain Node http + a small cookie session map. No framework deps.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { config } from './config.js';
import { Store } from './store.js';
import { Chain, chainFor } from './chain.js';
import { VoteEngine } from './vote-engine.js';
import { clampWeight } from './rules.js';
import { getChain, publicChains, chainSupportsAuth, isMainnet } from './chains.js';
import * as hivesigner from './hivesigner.js';
import * as melekSigner from './melek-signer.js';
import * as melekSignerOauth from '../integrations/melek-signer-oauth.mjs';
import { loginPage, dashboardPage, teachPage, awarenessPage } from './views.js';

const MELEK_SIGNER_CLIENT_ID = process.env.MELEK_SIGNER_CLIENT_ID || 'autovote';

const store = new Store(config.dbPath, config.defaultChain);
const engine = new VoteEngine(store);

const sessions = new Map(); // sid -> { chain, username, at }
const oauthStates = new Map(); // state -> { chain, at }
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

function sessionOf(req) {
  const sid = parseCookies(req)[SID_COOKIE];
  if (!sid) return null;
  return sessions.get(sid) || null;
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
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
  });
}

function issueSession(res, chain, username) {
  const sid = newSid();
  sessions.set(sid, { chain, username: String(username).toLowerCase().trim(), at: Date.now() });
  return {
    'Set-Cookie': `${SID_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`,
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const path = u.pathname;
  const method = req.method;

  try {
    // ---- health ----
    if (path === '/health') {
      return json(res, 200, {
        ok: true,
        chains: publicChains().map((c) => c.id),
        activeChains: store.activeChains(),
        cursors: Object.fromEntries(engine._cursors),
        hivesigner: hivesigner.configured(),
        mainnetBroadcast: engine.blockMainnet ? 'blocked' : 'allowed',
      });
    }

    // ---- public config the client needs to render login ----
    if (path === '/api/config' && method === 'GET') {
      return json(res, 200, {
        chains: publicChains(),
        defaultChain: config.defaultChain,
        hivesigner: { configured: hivesigner.configured() },
        melekSigner: { configured: melekSigner.configured() },
        mainnetBroadcastBlocked: engine.blockMainnet,
      });
    }

    // ---- posting-key login (POST) ----
    if (path === '/api/login' && method === 'POST') {
      const { chain, username, postingKey } = await readBody(req);
      const chainId = chain || config.defaultChain;
      if (!getChain(chainId)) return json(res, 400, { error: 'unknown chain' });
      if (!chainSupportsAuth(chainId, 'postingkey'))
        return json(res, 400, { error: 'posting-key login not enabled for this chain' });
      if (!username || !postingKey) return json(res, 400, { error: 'username and posting key required' });
      const acct = String(username).toLowerCase().trim();
      const c = new Chain(chainId);
      const ok = await c.keyAuthorizesVote(acct, postingKey);
      if (!ok) return json(res, 401, { error: 'posting key does not authorize this account on this chain' });
      store.upsertUser(chainId, acct, 'postingkey', { postingKey });
      return json(res, 200, { ok: true, chain: chainId }, issueSession(res, chainId, acct));
    }

    // ---- WhaleVault login: client proved control by signing a challenge ----
    // The page calls requestSignBuffer in the extension and posts the account.
    // We do NOT hold a credential — automated votes are skipped for WhaleVault
    // users; the dashboard signs in-browser while the tab is open.
    if (path === '/api/login/whalevault' && method === 'POST') {
      const { chain, username } = await readBody(req);
      const chainId = chain || config.defaultChain;
      if (!getChain(chainId)) return json(res, 400, { error: 'unknown chain' });
      if (!chainSupportsAuth(chainId, 'whalevault'))
        return json(res, 400, { error: 'WhaleVault not available for this chain' });
      if (!username) return json(res, 400, { error: 'username required' });
      const acct = String(username).toLowerCase().trim();
      store.upsertUser(chainId, acct, 'whalevault', {});
      return json(res, 200, { ok: true, chain: chainId, inBrowserOnly: true }, issueSession(res, chainId, acct));
    }

    // ---- MELEK-Signer login: account + password verified by OUR signer (keyless, offline-capable) ----
    // The signer checks the password against the account's on-chain key and returns a revocable bearer
    // token; the engine votes with that token while the user is offline. We never see or store a key.
    if (path === '/api/login/melek-signer' && method === 'POST') {
      const { chain, username, password } = await readBody(req);
      const chainId = chain || config.defaultChain;
      if (!getChain(chainId)) return json(res, 400, { error: 'unknown chain' });
      if (!chainSupportsAuth(chainId, 'melek-signer'))
        return json(res, 400, { error: 'MELEK-Signer not available for this chain' });
      if (!username || !password) return json(res, 400, { error: 'account and password required' });
      try {
        const { account, token } = await melekSigner.login({ account: username, password });
        store.upsertUser(chainId, account, 'melek-signer', { msToken: token });
        return json(res, 200, { ok: true, chain: chainId, account }, issueSession(res, chainId, account));
      } catch (err) {
        return json(res, 401, { error: String((err && err.message) || err) });
      }
    }

    // ---- MELEK-Signer hosted login (redirect flow): begin ----
    // The keyless "Login with MELEK" — redirect the browser to the hosted signer page; the password is
    // entered THERE, never here. The signer redirects back to /melek-signer/callback with a one-time code.
    if (path === '/melek-signer/login' && method === 'GET') {
      const chainId = u.searchParams.get('chain') || config.defaultChain;
      if (!chainSupportsAuth(chainId, 'melek-signer'))
        return send(res, 400, '<p>MELEK-Signer is not available for this chain.</p> <a href="/">back</a>');
      const state = crypto.randomBytes(12).toString('hex');
      oauthStates.set(state, { chain: chainId, at: Date.now() });
      const base = `https://${req.headers.host}`;
      const url = melekSignerOauth.authorizeUrl({
        clientId: MELEK_SIGNER_CLIENT_ID, scope: 'vote',
        redirectUri: `${base}/melek-signer/callback`, state,
      });
      return send(res, 302, '', { Location: url });
    }

    // ---- MELEK-Signer hosted login (redirect flow): callback ----
    if (path === '/melek-signer/callback' && method === 'GET') {
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      const st = state ? oauthStates.get(state) : null;
      const chainId = (st && st.chain) || config.defaultChain;
      if (st) oauthStates.delete(state);
      if (!st) return send(res, 400, '<p>MELEK-Signer: invalid or expired login. <a href="/">try again</a></p>');
      if (!code) return send(res, 400, '<p>MELEK-Signer: no code returned. <a href="/">back</a></p>');
      const grant = await melekSignerOauth.exchangeCode({ clientId: MELEK_SIGNER_CLIENT_ID, code });
      if (!grant || !grant.account) return send(res, 500, '<p>MELEK-Signer login failed. <a href="/">back</a></p>');
      store.upsertUser(chainId, grant.account, 'melek-signer', { msToken: grant.token });
      return send(res, 302, '', { Location: '/', ...issueSession(res, chainId, grant.account) });
    }

    // ---- HiveSigner OAuth: begin ----
    if (path === '/hivesigner/login' && method === 'GET') {
      const chainId = u.searchParams.get('chain') || 'hive';
      if (!chainSupportsAuth(chainId, 'hivesigner'))
        return send(res, 400, '<p>HiveSigner is not available for this chain.</p> <a href="/">back</a>');
      if (!hivesigner.configured())
        return send(res, 200, teachPage('hivesigner-pending', { configured: false }));
      const state = crypto.randomBytes(12).toString('hex');
      oauthStates.set(state, { chain: chainId, at: Date.now() });
      const url = hivesigner.getLoginURL(state);
      return send(res, 302, '', { Location: url });
    }

    // ---- HiveSigner OAuth: callback ----
    if (path === '/hivesigner/callback' && method === 'GET') {
      const code = u.searchParams.get('code') || u.searchParams.get('access_token');
      const state = u.searchParams.get('state');
      const st = state ? oauthStates.get(state) : null;
      const chainId = (st && st.chain) || 'hive';
      if (st) oauthStates.delete(state);
      if (!code) return send(res, 400, '<p>HiveSigner: no code returned.</p><a href="/">back</a>');
      try {
        // HiveSigner can return an access_token directly (implicit) or a code.
        let token = u.searchParams.get('access_token');
        let username = u.searchParams.get('username');
        if (!token) {
          const tok = await hivesigner.exchangeCode(code);
          token = tok.access_token;
          username = tok.username || username;
        }
        if (!username) {
          const meRes = await hivesigner.me(token);
          username = meRes.account?.name || meRes.user || meRes.name;
        }
        if (!username) throw new Error('could not resolve HiveSigner account');
        const acct = String(username).toLowerCase().trim();
        store.upsertUser(chainId, acct, 'hivesigner', { hsToken: token });
        return send(res, 302, '', { Location: '/', ...issueSession(res, chainId, acct) });
      } catch (err) {
        return send(res, 500, `<p>HiveSigner login failed: ${String(err?.message || err)}</p><a href="/">back</a>`);
      }
    }

    if (path === '/logout') {
      const sid = parseCookies(req)[SID_COOKIE];
      if (sid) sessions.delete(sid);
      return send(res, 302, '', { Location: '/', 'Set-Cookie': `${SID_COOKIE}=; Path=/; Max-Age=0` });
    }

    // ---- teaching / awareness pages (public) ----
    if (path === '/teach' || path.startsWith('/teach/')) {
      const topic = path === '/teach' ? 'index' : path.slice('/teach/'.length);
      return send(res, 200, teachPage(topic, { configured: hivesigner.configured() }));
    }
    if (path === '/about' || path === '/awareness') {
      return send(res, 200, awarenessPage(publicChains()));
    }

    // ---- home ----
    const sess = sessionOf(req);
    if (path === '/') {
      if (!sess) return send(res, 200, loginPage());
      return send(res, 200, dashboardPage(sess.chain, sess.username));
    }

    // ---- API (auth required) ----
    if (path.startsWith('/api/')) {
      if (!sess) return json(res, 401, { error: 'not logged in' });
      const chainId = sess.chain;
      const me = sess.username;
      const user = store.getUser(chainId, me);

      if (path === '/api/state' && method === 'GET') {
        const r = store.rulesFor(chainId, me);
        const ch = getChain(chainId);
        return json(res, 200, {
          chain: chainId,
          chainLabel: ch?.label,
          network: ch?.network,
          authMethod: user?.authMethod,
          inBrowserOnly: user?.authMethod === 'whalevault',
          mainnetBlocked: isMainnet(chainId) && engine.blockMainnet,
          username: me,
          ...r,
          votes: store.votesFor(chainId, me, 100),
          votesToday: store.votesToday(chainId, me).length,
        });
      }

      if (path === '/api/trail' && method === 'POST') {
        const b = await readBody(req);
        if (!b.target) return json(res, 400, { error: 'target account required' });
        const t = store.addTrail({
          chain: chainId,
          owner: me,
          target: b.target,
          weight: Math.max(0, Math.min(100, Number(b.weight) || 100)),
          delayMs: Math.max(0, Number(b.delaySec) || 0) * 1000,
          dailyCap: Math.max(0, Number(b.dailyCap) || 0),
          category: b.category === 'token' ? 'token' : '',
        });
        return json(res, 200, t);
      }

      if (path === '/api/fanbase' && method === 'POST') {
        const b = await readBody(req);
        const authors = String(b.authors || '')
          .split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
        if (authors.length === 0) return json(res, 400, { error: 'at least one author required' });
        const f = store.addFanbase({
          chain: chainId,
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
          chain: chainId,
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
        const r = store.setPaused(b.kind, b.id, !!b.paused, chainId, me);
        if (!r) return json(res, 404, { error: 'not found' });
        return json(res, 200, r);
      }

      if (path === '/api/delete' && method === 'POST') {
        const b = await readBody(req);
        const ok = store.remove(b.kind, b.id, chainId, me);
        return json(res, ok ? 200 : 404, { ok });
      }

      // WhaleVault in-browser: record a vote the extension just broadcast client-side.
      if (path === '/api/whalevault/voted' && method === 'POST') {
        if (user?.authMethod !== 'whalevault') return json(res, 400, { error: 'not a WhaleVault session' });
        const b = await readBody(req);
        if (!b.author || !b.permlink) return json(res, 400, { error: 'author and permlink required' });
        const v = store.logVote({
          chain: chainId, owner: me, author: String(b.author).toLowerCase(), permlink: b.permlink,
          weight: clampWeight(Number(b.weight) || 0), rule: 'whalevault-browser', ruleId: null,
          txId: b.txId || null, ok: b.ok !== false, error: b.error || undefined,
        });
        return json(res, 200, v);
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
    console.log(`[autovote] listening on http://${config.host}:${config.port}  default-chain=${config.defaultChain}  hivesigner=${hivesigner.configured() ? 'configured' : 'pending-registration'}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { server, store, engine };
