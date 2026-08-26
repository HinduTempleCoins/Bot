// pentecaust/herald/campaign-sender.mjs — Herald's SENDING layer: the campaign sender + drip/journey
// executor Herald was missing. Everything else in Herald PLANS and DRAFTS (factory, crossposter,
// campaign-planner) — nothing actually SENDS an owned campaign. This closes that #1 gap.
//
// Clean-room implementation of the parcelvoy/platform (MIT) pattern — lists · subscribers · templates ·
// campaigns · journeys(drip) · a durable send-queue · unsubscribe/suppression. NO code was copied from
// parcelvoy (or any AGPL/GPL tool such as listmonk/keila); only the well-known marketing-automation SHAPE
// was reimplemented in our house style. parcelvoy is MIT, so even a copied build would be license-safe,
// but this ships zero third-party code and no big dependency (disk is tight).
//
// House discipline (identical to the rest of pentecaust/herald):
//   • ESM .mjs, esc() every HTML interpolation, safeHref() every URL we render.
//   • Injectable fs store (JSON on disk in prod; an in-memory fs in tests → NO disk touched).
//   • Injectable clock `now` so drip scheduling is reproducible; injectable `genToken` for deterministic tests.
//   • Soft-fail-never-throw: every path returns a shaped { ok:false, ... } or an empty shape, never raises.
//   • The real ESP send is behind an INJECTABLE seam (`sender` / __setSender) over an injectable fetch
//     (__setFetch). Email only (Resend / Postmark / SES per CLAUDE.md — never SMS). UNCONFIGURED → soft
//     no-op ({ ok:true, sent:false, skipped:'esp-unconfigured' }) — never sends, never throws, silent in tests.
//   • CAN-SPAM: every rendered email carries an unsubscribe link + List-Unsubscribe headers; suppressed
//     (unsubscribed/bounced/complained) subscribers are NEVER enqueued and re-checked at send time.
//   • No PII over HTTP: emails are never dumped by any GET; the unsubscribe page shows a masked address only.
//
//   import { createCampaignSender, handler } from './campaign-sender.mjs'
//   const cs = createCampaignSender({ now: () => 0, genToken: seqTokens(), sender: fakeSender });
//   cs.createList('news'); cs.addSubscriber({ email:'a@b.com', listId:'news' });
//   cs.upsertTemplate({ id:'welcome', subject:'Hi {{name}}', html:'<p>Welcome {{name}}</p>' });
//   cs.createCampaign({ id:'launch', listId:'news', templateId:'welcome' });
//   cs.sendCampaign('launch'); await cs.processQueue();
//
//   HTTP:  GET /health · GET /u/{token} (one-click unsubscribe) · POST /api/subscribe ·
//          POST /api/webhook (bounce/complaint) · GET /api/lists · GET /api/stats

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('HERALD_SENDER_DATA', join(process.cwd(), 'data', 'herald-sender.json'));
const BASE_URL = () => (env('BASE_URL', 'https://herald.soapbox.community') || 'https://herald.soapbox.community').replace(/\/$/, '');

// ── house helpers ────────────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only http/https survive; everything else (javascript:, data:, relative) → '' so it can't be echoed as a link.
export const safeHref = (u) => (/^https?:\/\//i.test(String(u == null ? '' : u).trim()) ? String(u).trim() : '');

const MAX = 2000;
const clamp = (s, n = MAX) => String(s == null ? '' : s).slice(0, n);
const clean = (s) => clamp(s).trim();
const normEmail = (e) => clamp(e, 254).trim().toLowerCase();
// one @, non-empty local, dotted domain w/ 2+ TLD, no whitespace — deterministic, offline (no MX/SMTP probe).
const emailShapeOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normEmail(e));
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const isId = (s) => ID_RE.test(String(s || ''));
const slug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

// Mask an address for the unsubscribe page — never render the raw email (no PII leak). a***@e***.com
function maskEmail(email) {
  const e = normEmail(email);
  const at = e.indexOf('@');
  if (at < 1) return '(hidden)';
  const local = e.slice(0, at); const domain = e.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot >= 0 ? domain.slice(dot) : '';
  const dhead = dot >= 0 ? domain.slice(0, dot) : domain;
  return `${local[0]}***@${dhead[0] || ''}***${tld}`;
}

// ── injectable fs + JSON store (mirrors qr-tracker.mjs / mailbox.mjs) ───────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s); } catch {} },
};
const EMPTY = () => ({
  lists: {}, subscribers: {}, templates: {}, campaigns: {}, journeys: {}, enrollments: [], queue: [],
});
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return EMPTY();
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return EMPTY();
    const base = EMPTY();
    for (const k of Object.keys(base)) {
      if (Array.isArray(base[k])) base[k] = Array.isArray(o[k]) ? o[k] : [];
      else base[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {};
    }
    return base;
  } catch { return EMPTY(); }
}
const saveStore = (fs, file, s) => (fs.write || realFs.write)(file, JSON.stringify(s));

// ── {{var}} template interpolation — HTML values are esc()'d; text values are raw ───────────────────────
function interpolate(tpl, vars, { html }) {
  return String(tpl == null ? '' : tpl).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, key) => {
    const v = vars && Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
    const s = v == null ? '' : String(v);
    return html ? esc(s) : s;
  });
}

// ── module-level ESP send seam (injectable) ─────────────────────────────────────────────────────────────
let _fetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

let _sender = null; // when null we use defaultSend (env-driven ESP, unconfigured → soft no-op)
export function __setSender(fn) { _sender = typeof fn === 'function' ? fn : null; }

// The default ESP dispatcher. Chooses Resend or Postmark by env; unconfigured → soft no-op. SES is not
// wired here (SigV4 belt is out of scope for this pass) → recorded as a skipped no-op, never a throw.
// Returns { ok, sent, id?, skipped?, error? }. NEVER throws.
async function defaultSend(msg) {
  try {
    const resendKey = env('RESEND_API_KEY', '');
    const postmarkTok = env('POSTMARK_SERVER_TOKEN', '');
    const from = clean(env('HERALD_SEND_FROM', '')) || '';
    const provider = clean(env('HERALD_ESP', '')).toLowerCase();

    if (!from || (!resendKey && !postmarkTok)) {
      return { ok: true, sent: false, skipped: 'esp-unconfigured' };
    }
    const headers = {
      'List-Unsubscribe': `<${msg.unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
    if ((provider === 'resend' || (!provider && resendKey)) && resendKey) {
      const r = await _fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers }),
      });
      const status = (r && r.status) || 0;
      const j = await (r && r.json ? r.json().catch(() => ({})) : Promise.resolve({}));
      if (status >= 400) return { ok: false, sent: false, error: `resend ${status}` };
      return { ok: true, sent: true, id: (j && j.id) || null };
    }
    if ((provider === 'postmark' || (!provider && postmarkTok)) && postmarkTok) {
      const r = await _fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': postmarkTok, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          From: from, To: msg.to, Subject: msg.subject, HtmlBody: msg.html, TextBody: msg.text,
          Headers: [{ Name: 'List-Unsubscribe', Value: `<${msg.unsubUrl}>` }],
        }),
      });
      const status = (r && r.status) || 0;
      const j = await (r && r.json ? r.json().catch(() => ({})) : Promise.resolve({}));
      if (status >= 400) return { ok: false, sent: false, error: `postmark ${status}` };
      return { ok: true, sent: true, id: (j && j.MessageID) || null };
    }
    if (provider === 'ses') return { ok: true, sent: false, skipped: 'ses-not-wired' };
    return { ok: true, sent: false, skipped: 'esp-unconfigured' };
  } catch (e) {
    return { ok: false, sent: false, error: clean((e && e.message) || 'send error') };
  }
}

// ── the factory ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * createCampaignSender({ fs, file, now, genToken, sender })
 * @param {object}   [fs]        injectable { read, write } (default real fs; tests inject in-memory).
 * @param {string}   [file]      store path (default DATA_FILE()).
 * @param {function} [now]       clock → ms (default Date.now; inject for deterministic drip scheduling).
 * @param {function} [genToken]  unsubscribe-token generator (default randomUUID; inject for tests).
 * @param {function} [sender]    async ESP dispatcher (msg)→{ok,sent,...}; default = env-driven, unconfigured no-op.
 */
export function createCampaignSender(opts = {}) {
  const fs = opts.fs || realFs;
  const file = opts.file || DATA_FILE();
  const clock = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const genToken = typeof opts.genToken === 'function' ? opts.genToken : () => randomUUID();
  const sendFn = typeof opts.sender === 'function' ? opts.sender : null;
  // Webhook auth secret (env or factory opt). Empty → the /api/webhook endpoint FAILS CLOSED (rejects all),
  // so an unauthenticated caller can never suppress arbitrary addresses. Production: prefer per-ESP signatures.
  const webhookSecret = typeof opts.webhookSecret === 'string' ? opts.webhookSecret : (process.env.HERALD_WEBHOOK_SECRET || '');
  function webhookOk(req) {
    if (!webhookSecret) return false; // fail closed when unconfigured
    const got = String((req && req.headers && (req.headers['x-webhook-secret'] || req.headers['x-herald-secret'])) || '');
    const a = Buffer.from(got); const b = Buffer.from(String(webhookSecret));
    if (a.length !== b.length) return false;
    try { return timingSafeEqual(a, b); } catch { return false; }
  }

  const load = () => loadStore(fs, file);
  const save = (s) => saveStore(fs, file, s);
  const unsubUrl = (token) => `${BASE_URL()}/u/${encodeURIComponent(token)}`;

  // ── lists ──────────────────────────────────────────────────────────────────────────────────────────
  function createList(name, meta = {}) {
    try {
      const id = slug(meta.id || name);
      if (!isId(id)) return { ok: false, error: 'invalid list id/name' };
      const s = load();
      if (!s.lists[id]) s.lists[id] = { id, name: clean(name) || id, createdAt: clock() };
      save(s);
      return { ok: true, list: { ...s.lists[id] } };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'list error') }; }
  }
  const getList = (id) => { try { return load().lists[slug(id)] || null; } catch { return null; } };
  const listLists = () => { try { return Object.values(load().lists).map((l) => ({ ...l })); } catch { return []; } };

  // ── subscribers ──────────────────────────────────────────────────────────────────────────────────────
  function addSubscriber(input = {}) {
    try {
      const email = normEmail(input.email);
      if (!emailShapeOk(email)) return { ok: false, error: 'valid email required' };
      const s = load();
      const listId = input.listId != null ? slug(input.listId) : '';
      if (listId && !s.lists[listId]) return { ok: false, error: 'no such list' };
      let sub = s.subscribers[email];
      if (!sub) {
        sub = {
          email, listIds: [], attrs: {}, status: 'subscribed',
          token: String(genToken()), createdAt: clock(), updatedAt: clock(),
        };
        s.subscribers[email] = sub;
      }
      if (listId && !sub.listIds.includes(listId)) sub.listIds.push(listId);
      if (input.attrs && typeof input.attrs === 'object') {
        for (const k of Object.keys(input.attrs)) sub.attrs[clean(k)] = clamp(input.attrs[k]);
      }
      sub.updatedAt = clock();
      save(s);
      return { ok: true, subscriber: publicSub(sub) };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'subscribe error') }; }
  }
  // Never expose the unsubscribe token to callers/UI; mask the email.
  const publicSub = (sub) => sub && ({
    email: maskEmail(sub.email), status: sub.status, listIds: (sub.listIds || []).slice(),
    createdAt: sub.createdAt, updatedAt: sub.updatedAt,
  });
  const isSuppressed = (sub) => !sub || sub.status !== 'subscribed';

  function setStatus(email, status) {
    try {
      const s = load();
      const sub = s.subscribers[normEmail(email)];
      if (!sub) return { ok: false, error: 'no such subscriber' };
      sub.status = status; sub.updatedAt = clock();
      save(s);
      return { ok: true, subscriber: publicSub(sub) };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'status error') }; }
  }
  const unsubscribeByEmail = (email) => setStatus(email, 'unsubscribed');
  const markBounced = (email) => setStatus(email, 'bounced');
  const markComplained = (email) => setStatus(email, 'complained');

  // One-click unsubscribe by token. Returns the masked email so the confirm page can show it (no raw PII).
  function unsubscribeByToken(token) {
    try {
      const t = clean(token);
      if (!t) return { ok: false, error: 'token required' };
      const s = load();
      const sub = Object.values(s.subscribers).find((x) => x && x.token === t);
      if (!sub) return { ok: false, error: 'unknown token' };
      sub.status = 'unsubscribed'; sub.updatedAt = clock();
      save(s);
      return { ok: true, email: maskEmail(sub.email) };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'unsub error') }; }
  }

  // ── templates ─────────────────────────────────────────────────────────────────────────────────────────
  function upsertTemplate(t = {}) {
    try {
      const id = slug(t.id || t.name);
      if (!isId(id)) return { ok: false, error: 'invalid template id' };
      const s = load();
      s.templates[id] = {
        id, name: clean(t.name) || id,
        subject: clamp(t.subject, 500),
        html: clamp(t.html, 200000),
        text: clamp(t.text, 200000),
        ctaUrl: safeHref(t.ctaUrl),           // guarded: only http/https survives (safeHref)
        createdAt: clock(),
      };
      save(s);
      return { ok: true, template: { ...s.templates[id] } };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'template error') }; }
  }
  const getTemplate = (id) => { try { return load().templates[slug(id)] || null; } catch { return null; } };

  // Render a template for one subscriber. HTML vars are esc()'d; the unsubscribe footer + a safeHref'd CTA
  // are always appended for CAN-SPAM compliance. Returns { subject, html, text, unsubUrl }.
  function renderFor(tmpl, sub, extraVars = {}) {
    const vars = { email: sub ? sub.email : '', ...(sub ? sub.attrs : {}), ...extraVars };
    const uu = unsubUrl(sub ? sub.token : '');
    const subject = interpolate(tmpl.subject, vars, { html: false });
    let html = interpolate(tmpl.html, vars, { html: true });
    let text = interpolate(tmpl.text || stripTags(tmpl.html), vars, { html: false });
    const cta = safeHref(tmpl.ctaUrl);
    if (cta) {
      html += `\n<p><a href="${esc(cta)}">${esc(cta)}</a></p>`;
      text += `\n${cta}`;
    }
    html += `\n<hr><p style="font-size:12px;color:#888">You received this because you subscribed. `
      + `<a href="${esc(uu)}">Unsubscribe</a>.</p>`;
    text += `\n\n---\nUnsubscribe: ${uu}`;
    return { subject, html, text, unsubUrl: uu };
  }
  const stripTags = (h) => String(h == null ? '' : h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // ── enqueue helper (suppression-checked) ──────────────────────────────────────────────────────────────
  function enqueue(s, sub, tmpl, meta) {
    if (isSuppressed(sub)) return null;                 // NEVER enqueue a suppressed address
    const r = renderFor(tmpl, sub, meta.vars || {});
    const msg = {
      id: String(genToken()),
      to: sub.email, channel: 'email',
      subject: r.subject, html: r.html, text: r.text, unsubUrl: r.unsubUrl,
      campaignId: meta.campaignId || null, journeyId: meta.journeyId || null, step: meta.step != null ? meta.step : null,
      status: 'queued', createdAt: clock(), sentAt: null, error: null,
    };
    s.queue.push(msg);
    return msg;
  }

  // ── campaigns (one-shot broadcast to a list) ──────────────────────────────────────────────────────────
  function createCampaign(c = {}) {
    try {
      const id = slug(c.id || c.name);
      if (!isId(id)) return { ok: false, error: 'invalid campaign id' };
      const s = load();
      const listId = slug(c.listId);
      const templateId = slug(c.templateId);
      if (!s.lists[listId]) return { ok: false, error: 'no such list' };
      if (!s.templates[templateId]) return { ok: false, error: 'no such template' };
      s.campaigns[id] = { id, name: clean(c.name) || id, listId, templateId, status: 'draft', createdAt: clock() };
      save(s);
      return { ok: true, campaign: { ...s.campaigns[id] } };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'campaign error') }; }
  }

  function sendCampaign(campaignId, extraVars = {}) {
    try {
      const s = load();
      const camp = s.campaigns[slug(campaignId)];
      if (!camp) return { ok: false, error: 'no such campaign' };
      const tmpl = s.templates[camp.templateId];
      if (!tmpl) return { ok: false, error: 'template missing' };
      let queued = 0; let suppressed = 0;
      for (const sub of Object.values(s.subscribers)) {
        if (!sub.listIds || !sub.listIds.includes(camp.listId)) continue;
        if (isSuppressed(sub)) { suppressed++; continue; }
        if (enqueue(s, sub, tmpl, { campaignId: camp.id, vars: extraVars })) queued++;
      }
      camp.status = 'queued'; camp.queuedAt = clock();
      save(s);
      return { ok: true, campaignId: camp.id, queued, suppressed };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'send-campaign error') }; }
  }

  // ── journeys (drip: an ordered set of { templateId, delayMs } steps) ───────────────────────────────────
  function defineJourney(j = {}) {
    try {
      const id = slug(j.id || j.name);
      if (!isId(id)) return { ok: false, error: 'invalid journey id' };
      if (!Array.isArray(j.steps) || j.steps.length === 0) return { ok: false, error: 'steps required' };
      const s = load();
      const steps = [];
      for (const st of j.steps) {
        const templateId = slug(st && st.templateId);
        if (!s.templates[templateId]) return { ok: false, error: `no template "${templateId}"` };
        steps.push({ templateId, delayMs: Math.max(0, Number(st.delayMs) || 0) });
      }
      s.journeys[id] = { id, name: clean(j.name) || id, steps, createdAt: clock() };
      save(s);
      return { ok: true, journey: { ...s.journeys[id] } };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'journey error') }; }
  }

  // Enroll a subscriber: schedule step 0 at now + step0.delayMs. tickJourneys() later enqueues due steps.
  function enrollSubscriber(journeyId, email, extraVars = {}) {
    try {
      const s = load();
      const jr = s.journeys[slug(journeyId)];
      if (!jr) return { ok: false, error: 'no such journey' };
      const sub = s.subscribers[normEmail(email)];
      if (!sub) return { ok: false, error: 'no such subscriber' };
      if (isSuppressed(sub)) return { ok: false, error: 'subscriber suppressed' };
      const dueAt = clock() + (jr.steps[0] ? jr.steps[0].delayMs : 0);
      s.enrollments.push({
        id: String(genToken()), journeyId: jr.id, email: sub.email, step: 0, dueAt,
        vars: sanitizeVars(extraVars), done: false, createdAt: clock(),
      });
      save(s);
      return { ok: true, dueAt };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'enroll error') }; }
  }
  const sanitizeVars = (v) => {
    const o = {};
    if (v && typeof v === 'object') for (const k of Object.keys(v)) o[clean(k)] = clamp(v[k]);
    return o;
  };

  // Advance every due enrollment: enqueue its current step's message, then schedule the next step (or finish).
  // Suppressed subscribers are skipped (enrollment marked done). Returns { enqueued, advanced }.
  function tickJourneys(atOverride) {
    try {
      const at = atOverride != null ? atOverride : clock();
      const s = load();
      let enqueued = 0; let advanced = 0;
      for (const en of s.enrollments) {
        if (en.done || en.dueAt > at) continue;
        const jr = s.journeys[en.journeyId];
        const sub = s.subscribers[en.email];
        if (!jr || !sub || isSuppressed(sub)) { en.done = true; continue; }
        const step = jr.steps[en.step];
        const tmpl = step && s.templates[step.templateId];
        if (tmpl && enqueue(s, sub, tmpl, { journeyId: jr.id, step: en.step, vars: en.vars })) enqueued++;
        const next = en.step + 1;
        if (next < jr.steps.length) {
          en.step = next; en.dueAt = at + jr.steps[next].delayMs; advanced++;
        } else {
          en.done = true;
        }
      }
      save(s);
      return { ok: true, enqueued, advanced };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'tick error') }; }
  }

  // ── the queue drain (the actual ESP dispatch, behind the injectable seam) ──────────────────────────────
  async function processQueue({ limit = 100 } = {}) {
    try {
      const s = load();
      const pending = s.queue.filter((m) => m && m.status === 'queued').slice(0, Math.max(0, limit));
      let sent = 0; let skipped = 0; let failed = 0; let suppressed = 0;
      for (const m of pending) {
        // Re-check suppression at send time (status may have flipped since enqueue).
        const sub = s.subscribers[m.to];
        if (isSuppressed(sub)) { m.status = 'skipped'; m.error = 'suppressed'; suppressed++; continue; }
        let r;
        try { r = await (sendFn ? sendFn(m) : defaultSend(m)); }
        catch (e) { r = { ok: false, error: clean((e && e.message) || 'sender threw') }; }
        r = r || {};
        if (r.ok && r.sent) { m.status = 'sent'; m.sentAt = clock(); m.providerId = r.id || null; sent++; }
        else if (r.ok && !r.sent) { m.status = 'skipped'; m.error = r.skipped || 'no-op'; skipped++; }
        else { m.status = 'failed'; m.error = clean(r.error || 'send failed'); failed++; }
      }
      save(s);
      return { ok: true, processed: pending.length, sent, skipped, failed, suppressed };
    } catch (e) { return { ok: false, error: clean((e && e.message) || 'queue error') }; }
  }

  // ── stats (no PII: counts only, never emails) ──────────────────────────────────────────────────────────
  function stats() {
    try {
      const s = load();
      const subs = Object.values(s.subscribers);
      const byStatus = {};
      for (const sub of subs) byStatus[sub.status] = (byStatus[sub.status] || 0) + 1;
      const q = { queued: 0, sent: 0, skipped: 0, failed: 0 };
      for (const m of s.queue) if (q[m.status] != null) q[m.status]++;
      return {
        lists: Object.keys(s.lists).length,
        subscribers: subs.length,
        templates: Object.keys(s.templates).length,
        campaigns: Object.keys(s.campaigns).length,
        journeys: Object.keys(s.journeys).length,
        activeEnrollments: s.enrollments.filter((e) => !e.done).length,
        byStatus, queue: q,
      };
    } catch { return { lists: 0, subscribers: 0, templates: 0, campaigns: 0, journeys: 0, activeEnrollments: 0, byStatus: {}, queue: {} }; }
  }

  // ── optional HTTP surface ──────────────────────────────────────────────────────────────────────────────
  const sendJson = (res, code, obj) => {
    try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); } catch { /* soft */ }
  };
  const sendHtml = (res, code, html) => {
    try { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); } catch { /* soft */ }
  };
  function readJsonBody(req, max = 65536) {
    if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
    return new Promise((resolve) => {
      let d = ''; let over = false;
      try {
        req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
        req.on('end', () => { if (over) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
        req.on('error', () => resolve(null));
      } catch { resolve(null); }
    });
  }

  async function handler(req, res) {
    try {
      const method = (req.method || 'GET').toUpperCase();
      const url = new URL(String(req.url || '/'), 'http://localhost');
      const path = url.pathname.replace(/\/+$/, '') || '/';

      if (path === '/health' && method === 'GET') return sendJson(res, 200, { ok: true, service: 'herald-campaign-sender', stats: stats() });
      if (path === '/api/stats' && method === 'GET') return sendJson(res, 200, { ok: true, stats: stats() });
      if (path === '/api/lists' && method === 'GET') {
        return sendJson(res, 200, { ok: true, lists: listLists().map((l) => ({ ...l, name: esc(l.name) })) });
      }
      // one-click unsubscribe (GET /u/{token} or /unsubscribe?token=)
      const um = path.match(/^\/u\/([^/]+)$/);
      const token = um ? decodeURIComponent(um[1]) : (path === '/unsubscribe' ? url.searchParams.get('token') : null);
      if (token != null && method === 'GET') {
        const r = unsubscribeByToken(token);
        const msg = r.ok ? `You've been unsubscribed: ${esc(r.email)}.` : 'This unsubscribe link is invalid or expired.';
        return sendHtml(res, r.ok ? 200 : 404,
          `<!doctype html><meta charset=utf-8><title>Unsubscribe — Herald</title>`
          + `<body style="font-family:system-ui,sans-serif;margin:3rem;color:#111"><h1>Unsubscribe</h1><p>${msg}</p></body>`);
      }
      if (path === '/api/subscribe' && method === 'POST') {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-body' });
        const r = addSubscriber(body);
        return sendJson(res, r.ok ? 200 : 400, r);
      }
      // ESP bounce/complaint webhook → suppress. Accepts { type:'bounce'|'complaint', email }.
      if (path === '/api/webhook' && method === 'POST') {
        if (!webhookOk(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' }); // fail-closed: verified secret required
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-body' });
        const type = clean(body.type).toLowerCase();
        const email = body.email || (body.recipient) || '';
        const r = type === 'complaint' ? markComplained(email) : type === 'bounce' ? markBounced(email) : { ok: false, error: 'unknown type' };
        return sendJson(res, r.ok ? 200 : 400, { ok: r.ok, error: r.ok ? undefined : esc(r.error) });
      }
      return sendJson(res, 404, { ok: false, error: 'not-found' });
    } catch { return sendJson(res, 500, { ok: false, error: 'error' }); }
  }

  return {
    createList, getList, listLists,
    addSubscriber, unsubscribeByEmail, unsubscribeByToken, markBounced, markComplained, isSuppressed,
    upsertTemplate, getTemplate, renderFor,
    createCampaign, sendCampaign,
    defineJourney, enrollSubscriber, tickJourneys,
    processQueue, stats, handler,
    unsubUrl,
    _load: load,   // test/introspection seam
  };
}

// ── a process-wide singleton + its handler, for site/herald/server.mjs to mount (mirrors ad-network) ──────
const _singleton = createCampaignSender();
export const handler = (req, res) => _singleton.handler(req, res);
export { _singleton, interpolate, maskEmail, defaultSend };

// ── CLI demo ────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let n = 0; const seq = () => `tok-${++n}`;
  const cs = createCampaignSender({ fs: memFs(), now: () => 0, genToken: seq, sender: async (m) => ({ ok: true, sent: true, id: `demo-${m.to}` }) });
  cs.createList('news', { id: 'news' });
  cs.addSubscriber({ email: 'alice@example.com', listId: 'news', attrs: { name: 'Alice' } });
  cs.upsertTemplate({ id: 'welcome', name: 'Welcome', subject: 'Welcome {{name}}!', html: '<p>Hi {{name}}, welcome to MELEK.</p>' });
  cs.createCampaign({ id: 'launch', name: 'Launch', listId: 'news', templateId: 'welcome' });
  console.log('sendCampaign →', cs.sendCampaign('launch'));
  cs.processQueue().then((r) => console.log('processQueue →', r, '\nstats →', cs.stats()));
  function memFs() { let blob = null; return { read: () => blob, write: (_p, s) => { blob = s; } }; }
}
