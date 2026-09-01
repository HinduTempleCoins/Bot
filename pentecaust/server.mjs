// pentecaust/server.mjs — Pentecaust Messaging API + reference chat client (the game chat front door).
//
// Pentecaust Messaging (pentecaust.com) — MELEK's cross-game chat: the descent of tongues where every
// nation hears in its OWN language, here one MELEK account understood across every game and surface. The
// HTTP surface every game calls to form a Team/Alliance/Clan and chat — in-game, on the web, across games.
// Wraps model.mjs (roster) + messaging.mjs (channels + DM). Same edge discipline as the trollbox
// chat-server: CORS allowlist, per-client rate-limit, soft-fail-never-throw, no keys.
//
// IDENTITY / TRUST BOUNDARY (load-bearing): private data (DMs, inbox, team-chat history) and any act-as-
// account write are tied to a VERIFIED identity — NEVER to an attacker-controllable query/body field, or
// anyone reads anyone's DMs by naming them (IDOR). A verifier is injected (__setAuthVerifier) that validates
// a MELEK-Signer bearer token / session and returns the certified account. Identity resolution DENIES by
// default (401); TEAMS_DEV_TRUST_QUERY=1 — local dev / tests ONLY, never a public origin — trusts the
// asserted value so the reference client and the offline suite work. No private key is ever seen here.
//
//   API (JSON):
//     GET  /health                          GET  /teams           (directory)        GET /teams/:id
//     GET  /me/teams?account=               POST /teams           {name,owner,kind,openness,tag,game}
//     POST /teams/:id/join   {account}      POST /teams/:id/leave {account}
//     POST /teams/:id/kick   {actor,account}  POST /teams/:id/role {actor,account,role}
//     POST /teams/:id/approve {actor,account} POST /teams/:id/invite {actor,account}  POST /teams/:id/motd {actor,text}
//     GET  /teams/:id/chat?account=&since=  POST /teams/:id/chat {from,text,game,surface}
//     GET  /dm?me=&with=&since=             POST /dm {from,to,text,game,surface}      GET /inbox?account=
//     GET  /                                the reference chat UI (also a drop-in web client)
//
//   PORT=8157 BASE_URL=https://pentecaust.com node pentecaust/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  createTeam, joinTeam, leaveTeam, kick, setRole, approve, invite, setMotd, getTeam, teamsForAccount, listTeams, isMember,
} from './model.mjs';
import { postTeamMessage, postDM, readTeam, readDM, inboxFor } from './messaging.mjs';
import { sessionFromReq, handler as authHandler, registerMethod } from './auth.mjs';
import { makeMelekSignerVerify } from './melek-signer-login.mjs';
import { translate, translateBatch, getLang, setLang } from './translate.mjs';
import { createCampaign, getCampaign, campaignsForOwner, setICP, setSequence, setStatus, addLead, moveLead, leadStats } from './crm/model.mjs';
import { buildCampaignPlan, renderStep } from './crm/builder.mjs';
import { getMailbox, sendViaMailbox } from './connect/mailbox.mjs';
import { handler as mediaHandler } from './media.mjs';
import { issueInvite, redeemInvite, requireInvite, invitesFor, lineage as inviteLineage } from '../signup/invites.mjs';
import { honorDevTrust, assertStartupSafe } from '../signup/dev-trust-guard.mjs';

const PORT = +(process.env.PORT || 8157);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://pentecaust.com').replace(/\/$/, '');
const _norm = (s) => String(s || '').trim().replace(/\/$/, '');
const ALLOWED = new Set((process.env.PENTECAUST_ALLOWED_ORIGINS || process.env.TEAMS_ALLOWED_ORIGINS ||
  'https://alpha.melek.salon,https://pool.soapbox.community,https://pentecaust.com,https://move.melek.salon')
  .split(',').map(_norm).filter(Boolean));

// ── identity (the trust boundary) ───────────────────────────────────────────────────────────────────
// Resolve the ACTING account from a VERIFIED source, never from an attacker-controllable query/body field.
// Production injects a verifier (validates a MELEK-Signer bearer token / session → certified account).
// Until then identity DENIES by default (401); PENTECAUST_DEV_TRUST=1 (local dev / tests ONLY, never a
// public origin) falls back to the asserted value so the reference client and the offline suite work.
let _verifyAuth = null;
export function __setAuthVerifier(fn) { _verifyAuth = typeof fn === 'function' ? fn : null; }
const DEV_TRUST = () => process.env.PENTECAUST_DEV_TRUST === '1' || process.env.TEAMS_DEV_TRUST_QUERY === '1';
function whoami(req, asserted) {
  // 1) A real signed login session (Continue-with-Google/Facebook, one-time code, or MELEK-Signer) is
  //    authoritative — set by pentecaust/auth.mjs, carried in the HttpOnly session cookie.
  try { const s = sessionFromReq(req); if (s && s.account) return s.account; } catch {}
  // 2) A production-injected verifier (e.g. a MELEK-Signer bearer token).
  if (_verifyAuth) { try { const a = _verifyAuth(req); return a ? _acct(a) : null; } catch { return null; } }
  // 3) Dev-trust asserted identity — the ?me=/from fallback that keeps the Condenser deep-links, the
  //    reference client and the offline suite working before everyone has logged in. Honored ONLY for a
  //    genuinely-local, non-production request (dev-trust-guard.mjs); inert on any public/proxied origin.
  if (honorDevTrust(req, DEV_TRUST())) return _acct(asserted);
  return null;
}

// Verified identity for the invite gate: a signed session or the injected MELEK-Signer verifier ONLY —
// deliberately NOT the dev-trust header/query fallback. Issuing or redeeming AS an account demands proof you
// control that account (a MELEK-Signer login), never a named field. Denies by default (null).
function verifiedAccount(req) {
  try { const s = sessionFromReq(req); if (s && s.account) return s.account; } catch {}
  if (_verifyAuth) { try { const a = _verifyAuth(req); return a ? _acct(a) : null; } catch { return null; } }
  return null;
}

// tiny per-client token bucket (self-contained; soft-fails open) — mirrors the trollbox limiter intent.
const RL_BURST = +(process.env.TEAMS_RL_BURST || 40);
const RL_WIN = +(process.env.TEAMS_RL_WINDOW_MS || 60000);
const _buckets = new Map();
function allow(key) {
  try {
    const t = Date.now(); const b = _buckets.get(key) || { n: RL_BURST, t };
    b.n = Math.min(RL_BURST, b.n + ((t - b.t) / RL_WIN) * RL_BURST); b.t = t;
    if (b.n < 1) { _buckets.set(key, b); return false; }
    b.n -= 1; _buckets.set(key, b); return true;
  } catch { return true; }
}
function clientKey(req) {
  const h = (req && req.headers) || {};
  const xff = h['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim().slice(0, 64);
  return ((req && req.socket && req.socket.remoteAddress) || 'anon').slice(0, 64);
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function cors(origin) {
  const o = _norm(origin);
  if (o && ALLOWED.has(o)) return { 'access-control-allow-origin': o, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'Origin' };
  return { vary: 'Origin' };
}
const json = (res, code, body, origin) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(origin) }); res.end(JSON.stringify(body)); };
function readBody(req, max = 16384) {
  return new Promise((resolve) => { let d = ''; let over = false;
    req.on('data', (c) => { d += c; if (d.length > max) { over = true; req.destroy(); } });
    req.on('end', () => resolve(over ? null : d)); req.on('error', () => resolve(null)); });
}

// ── chain follow graph (for the dashboard's "People You Follow") ────────────────────────────────────
// Who an account follows is PUBLIC on-chain data — read it from the MELEK RPC (condenser_api.get_following)
// so the friends list can surface the people you already follow. Injectable fetch for offline tests.
const CHAIN_RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
let _chainFetch = (...a) => globalThis.fetch(...a);
export function __setChainFetch(fn) { _chainFetch = fn || ((...a) => globalThis.fetch(...a)); }
async function chainFollow(method, account, pick) {
  if (!account) return [];
  try {
    const r = await _chainFetch(CHAIN_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params: [account, '', 'blog', 100], id: 1 }),
    });
    const j = await r.json();
    // normalize: this fork's follow records can carry a leading '@' on the name — strip it.
    return ((j && j.result) || []).map((x) => String((x && x[pick]) || '').replace(/^@/, '')).filter(Boolean);
  } catch { return []; }
}
const getFollowing = (a) => chainFollow('condenser_api.get_following', a, 'following');  // who you follow
const getFollowers = (a) => chainFollow('condenser_api.get_followers', a, 'follower');   // who follows you

export async function handler(req, res) {
  const origin = req.headers ? req.headers.origin : undefined;
  let url; try { url = new URL(req.url, BASE_URL); } catch { return json(res, 400, { ok: false, reason: 'bad-url' }, origin); }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const q = url.searchParams;
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') { res.writeHead(204, cors(origin)); return res.end(); }

  try {
    // Login surface (sessions + Google/Facebook OAuth + one-time + MELEK-Signer hook) — its own handler,
    // exact-segment routed inside auth.mjs. Same-origin browser navigations, so no CORS wrapping needed.
    if (/^\/auth(\/|$)/.test(path)) {
      // H1: the auth POSTs (one-time request/redeem, link, method) sit in front of the main POST limiter,
      // so apply the token bucket here too — no unmetered login/one-time flooding.
      if (method === 'POST' && !allow(clientKey(req))) return json(res, 429, { ok: false, reason: 'rate-limited' }, origin);
      return authHandler(req, res);
    }
    if (path === '/' && method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...cors(origin) }); return res.end(PAGE); }
    // Media Hub — the home for ALL media (radio/podcasts/music/art/library/watch). Its own handler.
    if (path === '/media' || path.startsWith('/media/')) return mediaHandler(req, res);
    if (path === '/health') return json(res, 200, { ok: true, teams: listTeams().length }, origin);
    // The drop-in "Translate this page?" widget — included by Pentecaust AND by every Condenser page. Served
    // cross-origin (a <script src> tag needs no CORS); it then calls POST /translate (which is CORS-allowed).
    if (path === '/translate.js' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', ...cors(origin) });
      return res.end(TRANSLATE_JS);
    }
    // A reader's preferred language (so the messenger shows "Translate?" in their tongue). Private → auth.
    if (method === 'GET' && path === '/me/prefs') {
      const me = whoami(req, q.get('account')); if (!me) return unauth(res, origin);
      return json(res, 200, { ok: true, account: me, lang: getLang(me) }, origin);
    }

    // ── reads (GET) ──────────────────────────────────────────────────────────────────────────────
    // The team directory + a single team's public profile are public (no private data).
    if (method === 'GET' && path === '/teams') return json(res, 200, { ok: true, teams: listTeams() }, origin);
    // Following / Followers — public chain follow graph (no private data) for the friends list groups.
    if (method === 'GET' && path === '/following') {
      const a = _acct(q.get('account'));
      if (!a) return json(res, 422, { ok: false, reason: 'account required' }, origin);
      return json(res, 200, { ok: true, account: a, following: await getFollowing(a) }, origin);
    }
    if (method === 'GET' && path === '/followers') {
      const a = _acct(q.get('account'));
      if (!a) return json(res, 422, { ok: false, reason: 'account required' }, origin);
      return json(res, 200, { ok: true, account: a, followers: await getFollowers(a) }, origin);
    }

    // PRIVATE reads — must be the authenticated account, never a named one (IDOR guard).
    if (method === 'GET' && path === '/me/teams') {
      const me = whoami(req, q.get('account')); if (!me) return unauth(res, origin);
      return json(res, 200, { ok: true, account: me, teams: teamsForAccount(me) }, origin);
    }
    if (method === 'GET' && path === '/inbox') {
      const me = whoami(req, q.get('account')); if (!me) return unauth(res, origin);
      return json(res, 200, { ok: true, account: me, threads: inboxFor(me) }, origin);
    }
    // Herald: which sending mailbox (if any) this account has connected (email only, never tokens).
    if (method === 'GET' && path === '/me/mailbox') {
      const me = whoami(req, q.get('account')); if (!me) return unauth(res, origin);
      return json(res, 200, { ok: true, account: me, mailbox: getMailbox(me) }, origin);
    }
    // ── invites (the signup gate) ─────────────────────────────────────────────────────────────────
    // Code-validity check is PUBLIC (codes are 64-bit-random, unguessable) so a landing page can pre-check
    // an invite link before asking someone to sign in.
    if (method === 'GET' && path === '/invites/check') {
      return json(res, 200, requireInvite(q.get('code')), origin);
    }
    // Your own invite standing + lineage — VERIFIED identity only (never a named account → no enumeration).
    if (method === 'GET' && path === '/invites/standing') {
      const me = verifiedAccount(req); if (!me) return unauth(res, origin);
      return json(res, 200, { ok: true, account: me, standing: invitesFor(me), lineage: inviteLineage(me) }, origin);
    }
    if (method === 'GET' && path === '/dm') {
      const me = whoami(req, q.get('me')); if (!me) return unauth(res, origin);
      const wth = _acct(q.get('with'));
      if (!wth) return json(res, 422, { ok: false, reason: 'with required' }, origin);
      return json(res, 200, readDM(me, wth, { since: +q.get('since') || 0, tail: !q.get('since') }), origin);
    }
    const segs = path.split('/').filter(Boolean);
    if (method === 'GET' && segs[0] === 'teams' && segs[1] && segs[2] === 'chat') {
      const id = segs[1]; const me = whoami(req, q.get('account'));
      if (!me) return unauth(res, origin);
      if (!isMember(id, me)) return json(res, 403, { ok: false, reason: 'team members only' }, origin);
      const team = getTeam(id);
      return json(res, 200, { ok: true, team, ...readTeam(id, { since: +q.get('since') || 0, tail: !q.get('since') }) }, origin);
    }
    if (method === 'GET' && segs[0] === 'teams' && segs[1]) {
      const t = getTeam(segs[1]); return t ? json(res, 200, { ok: true, team: t }, origin) : json(res, 404, { ok: false, reason: 'no such team' }, origin);
    }

    // ── CRM (Herald) reads — OWNER-SCOPED: you only ever see your own campaigns. ──────
    if (method === 'GET' && segs[0] === 'crm' && segs[1] === 'campaigns') {
      const me = whoami(req, q.get('account')); if (!me) return unauth(res, origin);
      if (!segs[2]) return json(res, 200, { ok: true, campaigns: campaignsForOwner(me) }, origin);
      const c = getCampaign(segs[2]);
      if (!c || c.owner !== me) return json(res, 404, { ok: false, reason: 'no such campaign' }, origin);   // no cross-account read
      if (segs[3] === 'stats') return json(res, 200, { ok: true, stats: leadStats(c.id) }, origin);
      return json(res, 200, { ok: true, campaign: c }, origin);
    }

    // ── writes (POST) ────────────────────────────────────────────────────────────────────────────
    if (method === 'POST') {
      if (!allow(clientKey(req))) return json(res, 429, { ok: false, reason: 'rate-limited' }, origin);
      const raw = await readBody(req); if (raw == null) return json(res, 400, { ok: false, reason: 'bad-body' }, origin);
      let b = {}; try { b = JSON.parse(raw || '{}'); } catch { return json(res, 400, { ok: false, reason: 'bad-json' }, origin); }

      // The acting identity is ALWAYS the verified account — never a body field that claims to be someone
      // else. (In dev-trust mode `who` falls back to the route's own actor field for the offline suite.)
      const who = (asserted) => whoami(req, asserted);

      if (path === '/teams') { const me = who(b.owner); if (!me) return unauth(res, origin); return json(res, 200, createTeam({ ...b, owner: me }), origin); }
      if (path === '/dm') { const me = who(b.from); if (!me) return unauth(res, origin); return json(res, 200, postDM({ ...b, from: me }), origin); }

      // ON-DEMAND translation (the optional "Translate?" affordance + the page widget). Public + rate-limited
      // (the bucket already ran above). `to` = target language; `text` (single) or `texts[]` (batch).
      if (path === '/translate') {
        const to = b.to;
        if (Array.isArray(b.texts)) {
          const translations = await translateBatch(b.texts.slice(0, 200).map((t) => String(t == null ? '' : t).slice(0, 5000)), to, { from: b.from });
          return json(res, 200, { ok: true, to, translations }, origin);
        }
        const r = await translate({ text: String(b.text == null ? '' : b.text).slice(0, 5000), to, from: b.from });
        return json(res, 200, { ok: true, to: r.to, original: r.text, translation: r.tr }, origin);
      }
      // A reader's preferred language (used for the localized "Translate?" label). Private → auth.
      if (path === '/me/prefs') { const me = who(b.account); if (!me) return unauth(res, origin); return json(res, 200, setLang(me, b.lang), origin); }

      // ── invites (the signup gate) — VERIFIED identity only (session / MELEK-Signer), never a named field ──
      // Issue: mint one single-use invite AS the verified caller, returned as a copyable LINK — zero
      // server-side email send (the inviter shares the link themselves; honors the no-outbound deferral).
      if (path === '/invites/issue') {
        const me = verifiedAccount(req); if (!me) return unauth(res, origin);
        const r = issueInvite(me);
        if (r && r.ok) r.url = `${BASE_URL}/?invite=${encodeURIComponent(r.code)}`;
        return json(res, 200, r, origin);
      }
      // Redeem → join: the caller PROVED they control this account (MELEK-Signer session). Redeeming a valid
      // invite registers them into the invite tree and grants their own fan-out. The account is created/proven
      // via the MELEK-Signer signup path (separate); here we gate + record membership. Registers the VERIFIED
      // account only — a query/body `account` can never register someone else.
      if (path === '/invites/redeem') {
        const me = verifiedAccount(req); if (!me) return unauth(res, origin);
        return json(res, 200, redeemInvite(b.code, me), origin);
      }

      if (segs[0] === 'teams' && segs[1]) {
        const id = segs[1]; const op = segs[2];
        const actor = who(b.actor); const acct = who(b.account);  // member ops act AS b.account; admin ops AS b.actor
        if (op === 'join') { if (!acct) return unauth(res, origin); return json(res, 200, joinTeam(id, acct), origin); }
        if (op === 'leave') { if (!acct) return unauth(res, origin); return json(res, 200, leaveTeam(id, acct), origin); }
        if (op === 'kick') { if (!actor) return unauth(res, origin); return json(res, 200, kick(id, actor, b.account), origin); }
        if (op === 'role') { if (!actor) return unauth(res, origin); return json(res, 200, setRole(id, actor, b.account, b.role), origin); }
        if (op === 'approve') { if (!actor) return unauth(res, origin); return json(res, 200, approve(id, actor, b.account), origin); }
        if (op === 'invite') { if (!actor) return unauth(res, origin); return json(res, 200, invite(id, actor, b.account), origin); }
        if (op === 'motd') { if (!actor) return unauth(res, origin); return json(res, 200, setMotd(id, actor, b.text), origin); }
        if (op === 'chat') { const me = who(b.from); if (!me) return unauth(res, origin); return json(res, 200, postTeamMessage({ teamId: id, from: me, text: b.text, game: b.game, surface: b.surface }), origin); }
      }

      // ── CRM writes — OWNER-SCOPED. The acting account owns every campaign it touches. ──────────
      if (segs[0] === 'crm' && segs[1] === 'campaigns') {
        const me = who(b.owner || b.account); if (!me) return unauth(res, origin);
        if (!segs[2]) return json(res, 200, createCampaign({ ...b, owner: me }), origin);   // create
        const c = getCampaign(segs[2]);
        if (!c || c.owner !== me) return json(res, 404, { ok: false, reason: 'no such campaign' }, origin);
        const op = segs[3];
        if (op === 'plan') {   // conversational builder: goal/website → ICP + sequence (save when asked)
          const plan = await buildCampaignPlan({ goal: b.goal ?? c.goal, website: b.website ?? c.website, valueProp: b.valueProp });
          if (b.save) { setICP(c.id, plan.icp); setSequence(c.id, plan.sequence); }
          return json(res, 200, { ok: true, plan }, origin);
        }
        if (op === 'icp') return json(res, 200, setICP(c.id, b.icp), origin);
        if (op === 'sequence') return json(res, 200, setSequence(c.id, b.sequence), origin);
        if (op === 'status') return json(res, 200, setStatus(c.id, b.status), origin);
        if (op === 'leads' && !segs[4]) return json(res, 200, addLead(c.id, b.lead || b), origin);
        if (op === 'leads' && segs[4] && segs[5] === 'stage') return json(res, 200, moveLead(c.id, segs[4], b.stage), origin);
        // Herald send: render the given sequence step (default: first) for this lead + send from the
        // owner's OWN connected mailbox. On success the lead advances to 'contacted'. Never sends from
        // @pentecaust.com — the mailbox layer refuses that.
        if (op === 'leads' && segs[4] && segs[5] === 'send') {
          const lead = (c.leads || []).find((l) => l.id === segs[4]);
          if (!lead) return json(res, 404, { ok: false, reason: 'no such lead' }, origin);
          if (!lead.email) return json(res, 422, { ok: false, reason: 'lead has no email' }, origin);
          const step = (c.sequence || [])[Number(b.step) || 0];
          if (!step) return json(res, 422, { ok: false, reason: 'draft a plan first (no sequence step)' }, origin);
          const msg = renderStep(step, lead);
          const r = await sendViaMailbox(me, { to: lead.email, subject: msg.subject, body: msg.body });
          if (r && r.ok) moveLead(c.id, lead.id, 'contacted');
          return json(res, 200, r, origin);
        }
      }
    }
    return json(res, 404, { ok: false, reason: 'not-found' }, origin);
  } catch { return json(res, 500, { ok: false, reason: 'error' }, origin); }
}
const _acct = (s) => String(s || '').trim().toLowerCase();
const unauth = (res, origin) => json(res, 401, { ok: false, reason: 'authentication required (no verified MELEK identity)' }, origin);

// ── dashboard UI (AIM-style: Messages/Friends first · Email · Channels) — also the drop-in web client ──
const PAGE = `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Pentecaust — MELEK Messaging</title>
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
 .wrap{max-width:880px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
 .brand{font-size:20px;font-weight:800}.brand b{color:var(--gold)}.alpha{font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
 .me{margin-left:auto;display:flex;gap:4px;align-items:center}.me .at{color:var(--mut)}.me input{width:150px;padding:7px 9px;border:1px solid var(--bd);border-radius:8px;background:#0e131b;color:var(--fg);font:inherit}
 .nav{display:flex;gap:4px;margin:10px 0 14px;border-bottom:1px solid var(--bd)}
 .nav button{padding:9px 16px;border:0;border-bottom:2px solid transparent;background:none;color:var(--mut);font:inherit;font-weight:700;cursor:pointer}
 .nav button.on{color:var(--gold);border-bottom-color:var(--gold)}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px}
 input,select{padding:9px 11px;border:1px solid var(--bd);border-radius:9px;background:#0e131b;color:var(--fg);font:inherit;width:100%}
 .btn{padding:9px 12px;border-radius:9px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);font:inherit;font-weight:700;cursor:pointer;white-space:nowrap}
 .btn.primary{background:var(--gold);color:#1a1306;border-color:var(--gold)}.btn.green{background:var(--green);color:#062018;border-color:var(--green)}
 .btn:disabled{opacity:.5}
 .row{display:flex;gap:8px}.row>input{flex:1}
 .im{display:flex;gap:12px}.friends{width:230px;flex:0 0 230px}.thread{flex:1;min-width:0}
 .flist{margin-top:8px;max-height:330px;overflow:auto}
 .flabel{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--mut);font-weight:700;margin:10px 0 5px}.flabel:first-child{margin-top:0}
 .fitem{display:block;width:100%;text-align:left;padding:9px 10px;border:1px solid var(--bd);border-radius:9px;margin-bottom:6px;background:#0e131b;color:var(--fg);font:inherit;cursor:pointer}
 .fitem.on{border-color:var(--gold)}.fitem b{color:var(--gold)}.fitem small{display:block;color:var(--mut);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
 .feed{height:320px;overflow:auto;background:#0e131b;border:1px solid var(--bd);border-radius:10px;padding:10px;font-size:14px}
 .msg{margin:4px 0}.msg .who{color:var(--green);font-weight:700}.msg.mine .who{color:var(--gold)}.msg .src{color:var(--blue);font-size:11px}
 .mut{color:var(--mut);font-size:13px}.hint{color:var(--mut);font-size:12px;margin-top:8px}
 .compose{display:flex;gap:8px;margin-top:8px}.compose input{flex:1}
 .empty{color:var(--mut);text-align:center;padding:36px 10px}
 .pill{display:inline-block;font-size:10px;font-weight:700;color:#fff;padding:2px 7px;border-radius:9px;vertical-align:middle;margin-left:4px}
 h2{font-size:16px;margin:0 0 8px}a{color:var(--gold)}
 @media(max-width:620px){.im{flex-direction:column}.friends{width:auto;flex:none}}
</style></head><body><div class=wrap>
<header>
 <span class=brand><b>Pentecaust</b> Messaging</span><span class=alpha>Alpha</span>
 <span class=me><span class=at>@</span><input id=me placeholder=your-melek-name autocapitalize=off spellcheck=false></span>
</header>
<div class=nav>
 <button id=nMsg class=on>💬 Messages</button>
 <button id=nMail>✉️ Email</button>
 <button id=nChan>🎮 Channels</button>
 <button id=nInt>🔌 Integrations</button>
 <button id=nCamp>📣 Herald</button>
</div>

<div id=authbar class=card style="display:none;margin-bottom:12px;padding:11px 14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center"></div>

<div id=paneMsg class=card>
 <div class=im>
  <div class=friends>
   <h2>Friends</h2>
   <div class=row><input id=addWho placeholder="add by @name"><button class="btn green" id=addBtn>Add</button></div>
   <div class=flist id=flist><div class=mut style="margin-top:8px">Add a friend by their @name to start a direct message.</div></div>
  </div>
  <div class=thread>
   <h2 id=threadTitle>Direct messages</h2>
   <div class=feed id=feed><div class=empty>Pick a friend on the left — or add one by @name — to start a DM.</div></div>
   <div class=compose><input id=dmText placeholder="message…" disabled><button class="btn primary" id=dmSend disabled>Send</button></div>
  </div>
 </div>
</div>

<div id=paneMail class=card style="display:none">
 <h2>✉️ Email</h2>
 <p class=mut>Your MELEK email address:</p>
 <div class=row style="max-width:340px"><input id=mailAddr readonly value="—"></div>
 <div id=mailBox class=feed style="margin-top:10px"><div class=empty>Your inbox is being set up. When it's live, mail to your <b>@pentecaust.com</b> address lands here.</div></div>
 <p class=hint>Your email is part of your one MELEK account — the same name as your chat and your <b>.melek</b> identity.</p>
</div>

<div id=paneChan class=card style="display:none">
 <h2>🎮 Team & Game Channels</h2>
 <p class=mut>A channel is a group chat for a <b>Team / Alliance / Clan</b> — shared across every MELEK game (talk in-game, out-of-game, or from a different game). This is the more advanced side; for one-on-one, use <b>Messages</b>.</p>
 <div class=row style="margin-top:8px"><input id=teamId placeholder="open a channel by id (e.g. van-kush-family)"><button class="btn primary" id=loadTeam>Open</button><button class="btn" id=joinTeam>Join</button></div>
 <div class=row style="margin-top:6px"><input id=newName placeholder="…or start a new channel"><select id=newKind style="flex:0 0 130px;width:130px"><option value=team>Team</option><option value=alliance>Alliance</option><option value=clan>Clan</option><option value=crew>Crew</option><option value=guild>Guild</option></select><button class="btn green" id=createTeam>Create</button></div>
 <div id=teamMeta class=hint></div>
 <div class=feed id=cfeed style="margin-top:8px"><div class=empty>Open or create a channel above.</div></div>
 <div class=compose><input id=cText placeholder="message the channel…" disabled><button class="btn primary" id=cSend disabled>Send</button></div>
</div>

<div id=paneInt class=card style="display:none">
 <h2>🔌 Integrations</h2>
 <p class=mut>Connect the outside accounts MELEK can act with — the same "if this, then that" idea: link a service once, and your one MELEK identity can use it across the ecosystem (mail, feed, and the outreach tools).</p>
 <div id=connList class=feed style="margin-top:10px"><div class=empty>Loading connections…</div></div>
 <h2 style="margin-top:18px;font-size:15px">⚡ Automations</h2>
 <p class=hint>Recipes — <b>when</b> something happens on one connected service, <b>do</b> something on another — are being wired up on top of these connections. Connect an account above first; the recipe builder lands here next.</p>
</div>

<div id=paneCamp class=card style="display:none">
 <h2>📣 Pentecaust Herald</h2>
 <p class=mut>Your outreach assistant. Describe who you want to reach and what you offer — Herald drafts the ideal-customer profile and a multi-step outreach sequence you can edit. (Drafting + pipeline only; sending runs later on separate, warmed domains — never from your @pentecaust.com address.)</p>
 <div class=row style="margin-top:8px"><input id=campName placeholder="campaign name (e.g. Q3 witnesses outreach)"></div>
 <div class=row style="margin-top:6px"><input id=campGoal placeholder="goal — who to reach + what you want (e.g. book demos with SaaS founders)"></div>
 <div class=row style="margin-top:6px"><input id=campSite placeholder="your website (optional)"><button class="btn green" id=campCreate>Create</button></div>
 <div id=campList class=feed style="margin-top:10px"><div class=empty>Your campaigns appear here.</div></div>
 <div id=campDetail style="margin-top:12px;display:none">
  <h2 style="font-size:15px" id=campTitle></h2>
  <div class=row><button class="btn primary" id=campPlan>✨ Draft plan</button><span id=campStat class=hint></span></div>
  <div id=campPlanBox class=feed style="margin-top:8px"><div class=empty>Draft a plan to see the ICP + sequence.</div></div>
  <div class=row style="margin-top:8px"><input id=leadName placeholder="lead name"><input id=leadCo placeholder="company"><input id=leadEmail placeholder="email"></div>
  <div class=row style="margin-top:6px"><input id=leadSignal placeholder="signal — the verified reason to reach out"><button class="btn" id=leadAdd>Add lead</button></div>
  <div id=campLeads class=feed style="margin-top:8px"><div class=empty>Add leads above; each can be sent the first sequence step from your connected mailbox.</div></div>
 </div>
</div>

<p class=mut style="margin-top:14px">One MELEK account — your <b>messages</b>, <b>email</b>, and <b>channels</b> in one place. <a href="/health">api</a></p>
</div>
<script>
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(p,o)=>{try{const r=await fetch(p,o);return await r.json();}catch(e){return{ok:false,reason:'network'};}};
// arrive from the Wallet/Condenser already as your account: /?me=<account> (you're logged in there
// with your posting key; this carries the identity over — the posting-key proof is the MELEK-Signer step).
const _urlMe=(new URLSearchParams(location.search).get('me')||'').toLowerCase().replace(/^@/,'');
$('me').value=_urlMe||localStorage.getItem('melek_me')||'';
if(_urlMe)localStorage.setItem('melek_me',_urlMe);
const me=()=>$('me').value.trim().toLowerCase();
function syncMail(){$('mailAddr').value=me()?(me()+'@pentecaust.com'):'—';}
// deep-link: a Condenser "Send a PM" link is pentecaust.com/?dm=<account> — auto-open that thread.
let pendingDm=(new URLSearchParams(location.search).get('dm')||'').toLowerCase().replace(/^@/,'');
function tryPending(){if(pendingDm&&me()){setTab('msg');openDM(pendingDm);pendingDm='';return true;}return false;}
$('me').oninput=()=>{localStorage.setItem('melek_me',me());syncMail();if(tryPending())return;if(tab==='msg')loadFriends();};

// ---- tabs ----
let tab='msg';
function setTab(t){tab=t;
 $('paneMsg').style.display=t==='msg'?'':'none';$('paneMail').style.display=t==='mail'?'':'none';$('paneChan').style.display=t==='chan'?'':'none';$('paneInt').style.display=t==='int'?'':'none';$('paneCamp').style.display=t==='camp'?'':'none';
 $('nMsg').classList.toggle('on',t==='msg');$('nMail').classList.toggle('on',t==='mail');$('nChan').classList.toggle('on',t==='chan');$('nInt').classList.toggle('on',t==='int');$('nCamp').classList.toggle('on',t==='camp');
 if(t==='msg')loadFriends();if(t==='mail')syncMail();if(t==='int')loadIntegrations();if(t==='camp')loadCampaigns();}
$('nMsg').onclick=()=>setTab('msg');$('nMail').onclick=()=>setTab('mail');$('nChan').onclick=()=>setTab('chan');$('nInt').onclick=()=>setTab('int');$('nCamp').onclick=()=>setTab('camp');

// ---- Campaigns (MoneyPrinter/AI-SDR): draft an ICP + outreach sequence; manage leads + pipeline ----
let campId='';
const cpost=(p,body)=>api(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:me(),...body})});
async function loadCampaigns(){if(!me()){$('campList').innerHTML='<div class=empty>Sign in (or type your @name) to manage campaigns.</div>';return;}
 const j=await api('/crm/campaigns?account='+encodeURIComponent(me()));const cs=(j&&j.campaigns)||[];
 if(!cs.length){$('campList').innerHTML='<div class=empty>No campaigns yet — create one above.</div>';return;}
 const frag=document.createDocumentFragment();
 for(const c of cs){const b=document.createElement('button');b.className='fitem'+(c.id===campId?' on':'');
  b.innerHTML='<b>'+E(c.name)+'</b><small>'+E(c.status)+' · '+(c.leads?c.leads.length:0)+' leads</small>';b.onclick=()=>openCampaign(c.id);frag.appendChild(b);}
 $('campList').innerHTML='';$('campList').appendChild(frag);}
$('campCreate').onclick=async()=>{if(!me())return alert('Enter your @name first.');
 const name=$('campName').value.trim();if(!name)return alert('Name your campaign.');
 const j=await cpost('/crm/campaigns',{name,goal:$('campGoal').value.trim(),website:$('campSite').value.trim()});
 if(j&&j.ok){$('campName').value=$('campGoal').value=$('campSite').value='';loadCampaigns();openCampaign(j.campaign.id);}else alert((j&&j.reason)||'could not create');};
async function openCampaign(id){campId=id;const j=await api('/crm/campaigns/'+encodeURIComponent(id)+'?account='+encodeURIComponent(me()));
 if(!j||!j.ok){alert('could not open');return;}const c=j.campaign;
 $('campDetail').style.display='';$('campTitle').textContent=c.name;renderPlan(c);renderLeads(c);loadCampaigns();refreshStats();}
function renderLeads(c){const box=$('campLeads');const leads=(c.leads||[]);
 if(!leads.length){box.innerHTML='<div class=empty>No leads yet. Add one above.</div>';return;}
 const frag=document.createDocumentFragment();
 for(const l of leads){const row=document.createElement('div');row.className='fitem';
  const canSend=l.email&&(c.sequence||[]).length&&l.stage!=='unsubscribed';
  const badge='<span class=pill style="background:#234">'+E(l.stage)+'</span>';
  const btn=canSend?'<button class="btn primary" data-lead="'+E(l.id)+'">Send step 1</button>':'<span class=hint>'+(l.email?'draft a plan first':'no email')+'</span>';
  row.innerHTML='<div style="flex:1"><b>'+E(l.name||l.email||l.id)+'</b> '+badge+'<br><small class=mut>'+E(l.company||'')+(l.email?(' · '+E(l.email)):'')+'</small></div>'+btn;
  const b=row.querySelector('button');if(b)b.onclick=()=>sendStep(c.id,l.id,b);
  frag.appendChild(row);}
 box.innerHTML='';box.appendChild(frag);}
async function sendStep(cid,lid,btn){btn.disabled=true;btn.textContent='Sending…';
 const j=await cpost('/crm/campaigns/'+encodeURIComponent(cid)+'/leads/'+encodeURIComponent(lid)+'/send',{});
 if(j&&j.ok){btn.textContent='Sent ✓';openCampaign(cid);}
 else{btn.disabled=false;btn.textContent='Send step 1';alert((j&&j.reason)||'send failed — connect your Gmail in Integrations first');}}
function renderPlan(c){const box=$('campPlanBox');
 if(!c.sequence||!c.sequence.length){box.innerHTML='<div class=empty>Draft a plan to see the ICP + sequence.</div>';return;}
 const icp=c.icp||{};const chips=(a)=>(a&&a.length?a.map(x=>'<span class=pill style="background:#234">'+E(x)+'</span>').join(' '):'<span class=mut>—</span>');
 let h='<div style="margin-bottom:8px"><b>ICP</b><br><small class=mut>titles:</small> '+chips(icp.titles)+' <small class=mut>keywords:</small> '+chips(icp.keywords)+'</div>';
 h+='<b>Sequence</b>';for(const s of c.sequence){h+='<div class=msg style="margin-top:6px"><span class=src>day '+E(s.delayDays)+' · '+E(s.channel)+'</span><br><b>'+E(s.subject)+'</b><br>'+E(s.body).replace(/\\n/g,'<br>')+'</div>';}
 box.innerHTML=h;}
$('campPlan').onclick=async()=>{if(!campId)return;$('campPlan').textContent='Drafting…';$('campPlan').disabled=true;
 const j=await cpost('/crm/campaigns/'+encodeURIComponent(campId)+'/plan',{save:true});
 $('campPlan').textContent='✨ Draft plan';$('campPlan').disabled=false;
 if(j&&j.ok){openCampaign(campId);}else alert((j&&j.reason)||'could not draft');};
$('leadAdd').onclick=async()=>{if(!campId)return;const email=$('leadEmail').value.trim();
 const j=await cpost('/crm/campaigns/'+encodeURIComponent(campId)+'/leads',{lead:{name:$('leadName').value.trim(),company:$('leadCo').value.trim(),email,signal:$('leadSignal').value.trim()}});
 if(j&&j.ok){$('leadName').value=$('leadCo').value=$('leadEmail').value=$('leadSignal').value='';refreshStats();}else alert((j&&j.reason)||'could not add lead');};
async function refreshStats(){if(!campId)return;const j=await api('/crm/campaigns/'+encodeURIComponent(campId)+'/stats?account='+encodeURIComponent(me()));
 if(j&&j.ok&&j.stats){const s=j.stats;$('campStat').textContent=s.total+' leads · '+s.byStage.new+' new · '+s.byStage.replied+' replied · '+s.byStage.meeting+' meetings';}}

// ---- Integrations (IFTTT): connect external accounts to the one MELEK identity ----
let _signedIn=false;
async function loadIntegrations(){const box=$('connList');
 // Herald sending mailbox — connect your own Gmail so Herald sends from YOUR address (never @pentecaust.com).
 let mbHtml='';
 if(me()){const mb=await api('/me/mailbox?account='+encodeURIComponent(me()));
  if(mb&&mb.ok&&mb.mailbox){mbHtml='<div class=fitem><div style="flex:1"><b>✉️ Sending mailbox</b> <span class=pill style="background:#173">Connected</span><br><small class=mut>'+E(mb.mailbox.email)+' — Herald sends from here</small></div><a class="btn" href="/auth/'+E(mb.mailbox.provider)+'/connect">Reconnect</a></div>';}
  else{mbHtml='<div class=fitem><div style="flex:1"><b>✉️ Sending mailbox</b> <span class=pill style="background:#633">Not connected</span><br><small class=mut>Connect your Gmail so Herald can send outreach from your own address — never from @pentecaust.com.</small></div><a class="btn primary" href="/auth/google/connect">Connect Gmail</a></div>';}}
 const j=await api('/auth/providers');const provs=(j&&j.providers)||[];
 if(!provs.length){box.innerHTML=mbHtml+'<div class=empty>No login connectors configured yet.</div>';return;}
 const frag=document.createDocumentFragment();
 if(mbHtml){const d=document.createElement('div');d.innerHTML=mbHtml;frag.appendChild(d.firstChild);}
 for(const p of provs){const row=document.createElement('div');row.className='fitem';
  const pill=p.configured?'<span class=pill style="background:#173">Ready to connect</span>':'<span class=pill style="background:#633">Needs operator setup</span>';
  const btn=p.configured?('<a class="btn primary" href="/auth/'+E(p.id)+'">Connect</a>'):'<span class=hint>owner registers the app first</span>';
  row.innerHTML='<div style="flex:1"><b>'+E(p.label)+'</b> '+pill+'<br><small class=mut>'+E(p.scopes||'')+'</small></div>'+btn;
  frag.appendChild(row);}
 box.innerHTML='';box.appendChild(frag);
 if(!_signedIn){const note=document.createElement('div');note.className='hint';note.style.marginTop='8px';
  note.textContent='Sign in above first — connecting links the service to your MELEK account.';box.appendChild(note);}}

// ---- Messages: Friends list + DM thread (AIM-style) ----
let dmWith='',dmCursor=0,dmTimer=null;
async function loadFriends(){if(!me())return;const fl=$('flist');const seen=new Set();const frag=document.createDocumentFragment();
 const item=(who,sub,on)=>{seen.add(who);const b=document.createElement('button');b.className='fitem'+(on?' on':'');
  b.innerHTML='<b>@'+E(who)+'</b>'+(sub?('<small>'+E(sub)+'</small>'):'');b.onclick=()=>openDM(who);frag.appendChild(b);};
 const label=(t)=>{const d=document.createElement('div');d.className='flabel';d.textContent=t;frag.appendChild(d);};
 if(dmWith)item(dmWith,'',true);
 // Recent conversations (your DM threads)
 const inb=await api('/inbox?account='+encodeURIComponent(me()));const threads=((inb&&inb.threads)||[]).filter(t=>!seen.has(t.with));
 if(threads.length){label('Recent');for(const t of threads)item(t.with,t.last?((t.last.from===me()?'you: ':'')+t.last.text):'',false);}
 // Following (from the chain follow graph)
 const fw=await api('/following?account='+encodeURIComponent(me()));const follows=((fw&&fw.following)||[]).filter(w=>!seen.has(w));
 if(follows.length){label('Following');for(const w of follows)item(w,'',false);}
 // Followers
 const fr=await api('/followers?account='+encodeURIComponent(me()));const followers=((fr&&fr.followers)||[]).filter(w=>!seen.has(w));
 if(followers.length){label('Followers');for(const w of followers)item(w,'',false);}
 fl.innerHTML='';if(frag.childNodes.length)fl.appendChild(frag);else fl.innerHTML='<div class=mut style="margin-top:8px">Add a friend by their @name to start a direct message.</div>';}
function openDM(who){dmWith=who;dmCursor=0;$('threadTitle').textContent='@'+who;$('dmText').disabled=false;$('dmSend').disabled=false;$('feed').innerHTML='';loadFriends();pollDM();if(dmTimer)clearInterval(dmTimer);dmTimer=setInterval(pollDM,3000);}
async function pollDM(){if(!me()||!dmWith)return;const j=await api('/dm?me='+encodeURIComponent(me())+'&with='+encodeURIComponent(dmWith)+(dmCursor?('&since='+dmCursor):''));if(!j.ok)return;
 const f=$('feed');if(dmCursor===0&&j.messages.length)f.innerHTML='';for(const m of j.messages){const d=document.createElement('div');d.className='msg'+(m.from===me()?' mine':'');
  d.innerHTML='<span class=who>'+E(m.from===me()?'you':('@'+m.from))+'</span>'+(m.game?(' <span class=src>['+E(m.game)+']</span>'):'')+': '+E(m.text);f.appendChild(d);}
 if(j.messages.length){dmCursor=j.messages[j.messages.length-1].seq;f.scrollTop=f.scrollHeight;}}
$('addBtn').onclick=()=>{const w=$('addWho').value.trim().toLowerCase().replace(/^@/,'');if(!w||!me())return;$('addWho').value='';openDM(w);};
$('addWho').addEventListener('keydown',e=>{if(e.key==='Enter')$('addBtn').click();});
$('dmSend').onclick=async()=>{const t=$('dmText').value.trim();if(!t||!me()||!dmWith)return;$('dmText').value='';await api('/dm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:me(),to:dmWith,text:t,surface:'website'})});pollDM();};
$('dmText').addEventListener('keydown',e=>{if(e.key==='Enter')$('dmSend').click();});

// ---- Channels (advanced) ----
let chId='',chCursor=0,chTimer=null;
function openChan(id){chId=id;chCursor=0;$('teamId').value=id;$('cText').disabled=false;$('cSend').disabled=false;$('cfeed').innerHTML='';pollChan();if(chTimer)clearInterval(chTimer);chTimer=setInterval(pollChan,3000);}
async function pollChan(){if(!me()||!chId)return;const j=await api('/teams/'+encodeURIComponent(chId)+'/chat?account='+encodeURIComponent(me())+(chCursor?('&since='+chCursor):''));
 if(!j.ok){if(j.reason)$('teamMeta').textContent=j.reason;return;}
 if(j.team)$('teamMeta').textContent=j.team.kind+' “'+j.team.name+'” · '+j.team.memberCount+' members'+(j.team.motd?(' · '+j.team.motd):'');
 const f=$('cfeed');if(chCursor===0&&j.messages.length)f.innerHTML='';for(const m of j.messages){const d=document.createElement('div');d.className='msg';d.innerHTML='<span class=who>@'+E(m.from)+'</span>'+(m.game?(' <span class=src>['+E(m.game)+']</span>'):'')+': '+E(m.text);f.appendChild(d);}
 if(j.messages.length){chCursor=j.messages[j.messages.length-1].seq;f.scrollTop=f.scrollHeight;}}
$('loadTeam').onclick=()=>{const id=$('teamId').value.trim();if(id)openChan(id);};
$('joinTeam').onclick=async()=>{const id=$('teamId').value.trim();if(!id||!me())return;const j=await api('/teams/'+encodeURIComponent(id)+'/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:me()})});if(j.ok)openChan(id);else alert(j.reason||'could not join');};
$('createTeam').onclick=async()=>{if(!me())return alert('Enter your @name first.');const j=await api('/teams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('newName').value.trim(),owner:me(),kind:$('newKind').value})});if(j.ok)openChan(j.team.id);else alert(j.reason||'could not create');};
$('cSend').onclick=async()=>{const t=$('cText').value.trim();if(!t||!me()||!chId)return;$('cText').value='';await api('/teams/'+encodeURIComponent(chId)+'/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({from:me(),text:t,surface:'website'})});pollChan();};
$('cText').addEventListener('keydown',e=>{if(e.key==='Enter')$('cSend').click();});

// ---- login / sessions (Google·Facebook·one-time·MELEK-Signer) ----
// On load: ?link=<claim> → a first social login that needs a MELEK account picked; else /auth/me tells us
// if a session is active. A session locks the @name to the logged-in account; otherwise you can still type
// your @name on testnet (dev-trust) or sign in. MELEK-Signer joins as one more button here later.
const _params=new URLSearchParams(location.search);
async function initAuth(){const bar=$('authbar');
 const link=_params.get('link');
 if(link){const email=_params.get('email')||'';bar.style.display='flex';
  bar.innerHTML='<b>Welcome'+(email?(' '+E(email)):'')+'!</b> Pick the MELEK account to link to this login:'+
   '<input id=linkAcct placeholder=your-melek-name style="width:170px;flex:0 0 auto" autocapitalize=off spellcheck=false>'+
   '<button class="btn primary" id=linkBtn>Link &amp; sign in</button>';
  $('linkBtn').onclick=async()=>{const a=$('linkAcct').value.trim().toLowerCase().replace(/^@/,'');if(!a)return;
   const j=await api('/auth/link',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({claim:link,account:a})});
   if(j&&j.ok)location.href='/';else alert((j&&j.reason)||'could not link');};
  return;}
 const s=await api('/auth/me');
 if(s&&s.ok){_signedIn=true;$('me').value=s.account;$('me').readOnly=true;localStorage.setItem('melek_me',s.account);syncMail();
  bar.style.display='flex';bar.innerHTML='Signed in as <b>@'+E(s.account)+'</b> <small class=mut>('+E(s.method)+')</small>'+
   '<button class=btn id=invBtn style="margin-left:auto">Invite a friend</button>'+
   '<a class=btn href="/auth/logout">Log out</a>';
  $('invBtn').onclick=inviteFriend;
  if(me())loadFriends();maybeRedeemInvite();return;}
 bar.style.display='flex';bar.innerHTML='<span>Sign in:</span>'+
  '<button class=btn id=mkBtn>Login with MELEK</button>'+
  '<a class=btn href="/auth/google">Continue with Google</a>'+
  '<a class=btn href="/auth/facebook">Continue with Facebook</a>'+
  '<button class=btn id=otBtn>One-time code</button>'+
  '<small class=mut>or just type your @name (testnet)</small>';
 $('otBtn').onclick=oneTime; $('mkBtn').onclick=melekLogin;}
async function melekLogin(){const a=(prompt('Your MELEK @name:')||'').trim().toLowerCase().replace(/^@/,'');if(!a)return;
 const p=prompt('Your MELEK password:');if(!p)return;
 const r=await api('/auth/method/melek-signer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:a,password:p})});
 if(r&&r.ok)location.href='/';else alert((r&&r.reason)||'login failed — check your @name and password');}
async function oneTime(){const a=(me()||prompt('Your MELEK @name for a one-time login:')||'').trim().toLowerCase().replace(/^@/,'');if(!a)return;
 const r=await api('/auth/onetime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:a})});
 if(!r||!r.ok){alert((r&&r.reason)||'could not request a code');return;}
 // Testnet: the code is returned so we redeem it immediately. In production it is emailed, not returned.
 const j=await api('/auth/onetime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:r.code})});
 if(j&&j.ok)location.href='/';else alert((j&&j.reason)||'could not sign in');}

// ---- invites (the signup gate: copyable links, no email send) ----
// Issue one invite AS the signed-in account and hand back a copyable link. Zero server-side send — you
// share the link yourself. Falls back to a prompt() the user can copy if the clipboard API is unavailable.
async function inviteFriend(){
 const r=await api('/invites/issue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});
 if(!r||!r.ok){alert((r&&r.reason)||'no invites remaining');return;}
 const url=r.url||(location.origin+'/?invite='+encodeURIComponent(r.code));
 const left=(r.remaining===null||r.remaining==null)?'':(' ('+r.remaining+' invites left)');
 try{await navigator.clipboard.writeText(url);alert('Invite link copied — share it with a friend'+left+':\n\n'+url);}
 catch(e){prompt('Copy this invite link and share it'+left+':',url);}}
// If the page was opened from an invite link (?invite=CODE) while signed in, redeem it to join the tree.
async function maybeRedeemInvite(){
 const code=_params.get('invite');if(!code)return;
 const chk=await api('/invites/check?code='+encodeURIComponent(code));
 if(!chk||!chk.ok){return;}   // unknown/used code → silently ignore (already a member, or a stale link)
 const r=await api('/invites/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:code})});
 if(r&&r.ok)alert('Invite redeemed — welcome. You now have your own invites to share.');}

// ---- init ----
syncMail();if(me())loadFriends();initAuth();
// deep-link back from a mailbox connect (Herald): land on Integrations + confirm
(function(){const p=new URLSearchParams(location.search);
 if(p.get('tab')==='int')setTimeout(()=>setTab('int'),50);
 if(p.get('connected'))setTimeout(()=>alert('Mailbox connected — Herald can now send from your own address.'),120);
 if(p.get('connect_error'))setTimeout(()=>alert('Could not connect mailbox: '+p.get('connect_error')),120);})();
</script>
<script src="/translate.js"></script>
</body></html>`;

// ── the drop-in "Translate this page?" widget (served at /translate.js) ──────────────────────────────
// Self-contained, dependency-free, CSP-friendly (sets DOM style properties, no inline <style>/eval). Adds a
// small floating bar with a language picker + a "Translate?" toggle (labeled in the reader's OWN language).
// Translation is OPTIONAL — nothing changes until the reader clicks. On click it walks the page's visible
// text nodes, batch-translates via POST /translate, and swaps them in; "Show original" reverts. Drop the
// same <script src="https://pentecaust.com/translate.js"> into ANY page (the whole Condenser) and it works.
const TRANSLATE_JS = `(function(){
  if (window.__melekTr) return; window.__melekTr = true;
  var EP; try { EP = new URL(document.currentScript.src).origin; } catch(e) { EP = 'https://pentecaust.com'; }
  var ASK={en:'Translate?',es:'\\u00bfTraducir?',fr:'Traduire ?',de:'\\u00dcbersetzen?',pt:'Traduzir?',it:'Tradurre?',nl:'Vertalen?',ru:'\\u041f\\u0435\\u0440\\u0435\\u0432\\u0435\\u0441\\u0442\\u0438?',zh:'\\u7ffb\\u8bd1\\uff1f',ja:'\\u7ffb\\u8a33\\uff1f',ko:'\\ubc88\\uc5ed?',ar:'\\u062a\\u0631\\u062c\\u0645\\u0629\\u061f',hi:'\\u0905\\u0928\\u0941\\u0935\\u093e\\u0926?',tr:'\\u00c7evir?',ku:'Werger\\u00eene?',fa:'\\u062a\\u0631\\u062c\\u0645\\u0647\\u061f',vi:'D\\u1ecbch?',id:'Terjemahkan?'};
  var ORIG={en:'Show original',es:'Ver original',fr:"Voir l'original",de:'Original',pt:'Ver original',ru:'\\u041e\\u0440\\u0438\\u0433\\u0438\\u043d\\u0430\\u043b',zh:'\\u663e\\u793a\\u539f\\u6587',ja:'\\u539f\\u6587',ar:'\\u0627\\u0644\\u0623\\u0635\\u0644',ku:'Resen',tr:'Orijinal'};
  var LANGS=[['en','English'],['es','Espa\\u00f1ol'],['fr','Fran\\u00e7ais'],['de','Deutsch'],['pt','Portugu\\u00eas'],['it','Italiano'],['nl','Nederlands'],['ru','\\u0420\\u0443\\u0441\\u0441\\u043a\\u0438\\u0439'],['uk','\\u0423\\u043a\\u0440\\u0430\\u0457\\u043d\\u0441\\u044c\\u043a\\u0430'],['ar','\\u0627\\u0644\\u0639\\u0631\\u0628\\u064a\\u0629'],['fa','\\u0641\\u0627\\u0631\\u0633\\u06cc'],['tr','T\\u00fcrk\\u00e7e'],['ku','Kurd\\u00ee'],['hi','\\u0939\\u093f\\u0928\\u094d\\u0926\\u0940'],['zh','\\u4e2d\\u6587'],['ja','\\u65e5\\u672c\\u8a9e'],['ko','\\ud55c\\uad6d\\uc5b4'],['vi','Ti\\u1ebfng Vi\\u1ec7t'],['id','Bahasa'],['pl','Polski']];
  var base=function(l){return String(l||'').toLowerCase().split('-')[0];};
  var lang=base(localStorage.getItem('melek_lang')||navigator.language||'en')||'en';
  var on=false, store=[];
  var bar=document.createElement('div'); bar.id='mlk-tr-bar';
  var s=bar.style; s.position='fixed'; s.zIndex='2147483600'; s.right='12px'; s.bottom='12px';
  s.background='#12161e'; s.color='#e9eef5'; s.border='1px solid #2a3442'; s.borderRadius='10px';
  s.padding='6px 8px'; s.font='13px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif';
  s.boxShadow='0 4px 18px rgba(0,0,0,.4)'; s.display='flex'; s.gap='6px'; s.alignItems='center';
  var globe=document.createElement('span'); globe.textContent='\\ud83c\\udf10'; bar.appendChild(globe);
  var sel=document.createElement('select');
  var ss=sel.style; ss.background='#0e131b'; ss.color='#e9eef5'; ss.border='1px solid #2a3442'; ss.borderRadius='6px'; ss.font='inherit'; ss.padding='3px 4px';
  for (var i=0;i<LANGS.length;i++){var o=document.createElement('option');o.value=LANGS[i][0];o.textContent=LANGS[i][1];if(LANGS[i][0]===lang)o.selected=true;sel.appendChild(o);}
  sel.onchange=function(){if(on)revert();lang=sel.value;localStorage.setItem('melek_lang',lang);btn.textContent=ASK[lang]||ASK.en;};
  bar.appendChild(sel);
  var btn=document.createElement('button'); btn.textContent=ASK[lang]||ASK.en;
  var bs=btn.style; bs.background='#d9a441'; bs.color='#1a1306'; bs.border='0'; bs.borderRadius='6px'; bs.font='inherit'; bs.fontWeight='700'; bs.padding='4px 9px'; bs.cursor='pointer';
  btn.onclick=function(){ if(on)revert(); else go(); };
  bar.appendChild(btn);
  (function add(){ if(document.body) document.body.appendChild(bar); else setTimeout(add,300); })();
  function collect(){
    var out=[]; if(!document.body) return out;
    var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){
      var v=n.nodeValue; if(!v||!v.trim())return NodeFilter.FILTER_REJECT;
      if(!/\\p{L}/u.test(v))return NodeFilter.FILTER_REJECT;
      var p=n.parentNode; if(!p)return NodeFilter.FILTER_REJECT;
      var t=p.nodeName; if(t==='SCRIPT'||t==='STYLE'||t==='NOSCRIPT'||t==='TEXTAREA'||t==='CODE'||t==='PRE'||t==='OPTION')return NodeFilter.FILTER_REJECT;
      if(p.closest&&p.closest('#mlk-tr-bar'))return NodeFilter.FILTER_REJECT;
      if(p.isContentEditable)return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }});
    var x; while(x=w.nextNode())out.push(x); return out;
  }
  function go(){
    btn.disabled=true; btn.textContent='\\u2026';
    var ns=collect(); var idx={}, uniq=[];
    for(var i=0;i<ns.length;i++){var k=ns[i].nodeValue.trim();if(!(k in idx)){idx[k]=uniq.length;uniq.push(ns[i].nodeValue);}}
    var results=new Array(uniq.length).fill(null); var chunks=[];
    for(var i=0;i<uniq.length;i+=100)chunks.push([i,uniq.slice(i,i+100)]);
    Promise.all(chunks.map(function(c){
      return fetch(EP+'/translate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({texts:c[1],to:lang})})
        .then(function(r){return r.json();}).then(function(j){var tr=(j&&j.translations)||[];for(var k=0;k<tr.length;k++)results[c[0]+k]=tr[k];}).catch(function(){});
    })).then(function(){
      store=[]; for(var i=0;i<ns.length;i++){var u=idx[ns[i].nodeValue.trim()];var t=(u!=null)?results[u]:null;if(t){store.push({node:ns[i],orig:ns[i].nodeValue});ns[i].nodeValue=t;}}
      on=true; btn.disabled=false; btn.textContent=ORIG[lang]||ORIG.en;
    });
  }
  function revert(){ for(var i=0;i<store.length;i++){try{store[i].node.nodeValue=store[i].orig;}catch(e){}} store=[]; on=false; btn.textContent=ASK[lang]||ASK.en; }
})();`;

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  // L1: surface a misconfiguration that would otherwise be silent — without the secret, login sessions use a
  // per-process random key and don't survive a restart (and dev-trust without it = no real auth at all).
  if (!process.env.PENTECAUST_SESSION_SECRET && !DEV_TRUST()) console.warn('[pentecaust] WARNING: PENTECAUST_SESSION_SECRET is unset — login sessions use a per-process random secret and will NOT survive a restart. Set it in production.');
  assertStartupSafe({ host: HOST });   // refuse to serve if a dev-trust flag is set in production (auth-bypass foot-gun)
  registerMethod('melek-signer', makeMelekSignerVerify()); // "Login with MELEK" via the deployed signer (MELEK_SIGNER_URL)
  createServer(handler).listen(PORT, HOST, () => console.log(`Pentecaust Messaging API + chat on http://${HOST}:${PORT} (${BASE_URL})${DEV_TRUST() ? ' — DEV_TRUST on (query-asserted identity; local only)' : ''}`));
}
