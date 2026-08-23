// pentecaust/herald/lead-crm.mjs — Pentecaust HERALD: the lead-gen / CRM module (the outreach/CRM half
// of Herald). Inspired by A-Leads: you only "count" a contact once it is VERIFIED (real-time verified
// emails/phones), so the roster of leads and the count-that-matters are two different numbers. This module
// is the CRM pipeline on top of that idea — leads move across a fixed set of stages, and the system rolls
// up how many sit in each stage, sync-ready for an external CRM.
//
// It is NOT the backlink tracker in ./outreach-db.mjs (that is one row per link opportunity); this is one
// row per PERSON/lead, with verification flags and a sales-pipeline stage.
//
// Storage discipline mirrors ./outreach-db.mjs: an INJECTABLE storage (a Map-like in-memory store in tests,
// so NO disk is touched), an INJECTABLE clock `now`, soft-fail-never-throw (every path returns
// { ok:false, error } or an empty shape rather than raising), and esc() on all HTML interpolation. Nothing
// here touches the network — the "verification" is a deterministic email-shape validator by default, or an
// injected `validateEmail` so tests stay offline and deterministic.
//
//   import { createLeadCrm } from './lead-crm.mjs'
//   const crm = createLeadCrm({ storage, now, validateEmail });
//
// The optional handler(req,res) exposes:
//   GET  /api/leads   (+ ?stage= &verifiedOnly=)  → JSON list
//   POST /api/lead                                → JSON add
//   GET  /health                                  → JSON ok

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The fixed, ordered CRM sales pipeline. A lead is born in 'new'; 'won'/'lost' are terminals.
export const STAGES = ['new', 'contacted', 'replied', 'qualified', 'won', 'lost'];

const MAX_FIELD = 500;
const clamp = (s, n) => String(s == null ? '' : s).slice(0, n);

// Normalize an email for dedupe + validation: trim + lowercase. Bare, no network.
const normEmail = (e) => clamp(e, MAX_FIELD).trim().toLowerCase();

// Default email-shape validator (deterministic, offline). Overridable via injected validateEmail so tests
// control exactly which addresses "verify" without any real MX/SMTP lookup.
function defaultValidateEmail(email) {
  const e = normEmail(email);
  if (!e || e.length > 254) return false;
  // one @, non-empty local part, a dotted domain with a 2+ char TLD, no whitespace
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

// ── injectable storage ─────────────────────────────────────────────────────────────────────────────────
// The factory accepts any Map-like { get, set, has, delete, values }. If none is given we fall back to an
// in-process Map so the module is usable standalone; tests always pass their own in-memory store (no disk).
function normalizeStorage(storage) {
  if (storage && typeof storage.get === 'function' && typeof storage.set === 'function'
      && typeof storage.values === 'function') {
    return storage;
  }
  return new Map();
}

export function createLeadCrm({ storage, now, validateEmail } = {}) {
  const store = normalizeStorage(storage);
  const clock = typeof now === 'function' ? now : () => 0;   // deterministic default; tests inject a clock
  const emailOk = typeof validateEmail === 'function' ? validateEmail : defaultValidateEmail;

  const allLeads = () => {
    try { return Array.from(store.values()); } catch { return []; }
  };

  // Add a lead. Normalizes + dedups by email; a new lead starts in stage 'new'. Soft-fail on bad input.
  function addLead(input = {}) {
    try {
      const email = normEmail(input && input.email);
      if (!email) return { ok: false, error: 'email required' };
      if (store.has(email)) return { ok: false, error: 'duplicate email' };
      const lead = {
        email,
        name: clamp(input.name, MAX_FIELD).trim(),
        phone: clamp(input.phone, MAX_FIELD).trim(),
        source: clamp(input.source, MAX_FIELD).trim(),
        stage: 'new',
        emailValid: false,
        phoneValid: false,
        createdAt: clock(),
        updatedAt: clock(),
      };
      store.set(email, lead);
      return { ok: true, lead: { ...lead } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || 'add error') };
    }
  }

  // Set verification flags. emailValid: if not explicitly provided, derive it from the validator.
  function markVerified(email, flags = {}) {
    try {
      const key = normEmail(email);
      const lead = store.get(key);
      if (!lead) return { ok: false, error: 'no such lead' };
      const ev = flags && Object.prototype.hasOwnProperty.call(flags, 'emailValid')
        ? !!flags.emailValid
        : !!emailOk(key);
      const pv = flags && Object.prototype.hasOwnProperty.call(flags, 'phoneValid')
        ? !!flags.phoneValid
        : !!lead.phoneValid;
      lead.emailValid = ev;
      lead.phoneValid = pv;
      lead.updatedAt = clock();
      store.set(key, lead);
      return { ok: true, lead: { ...lead } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || 'verify error') };
    }
  }

  // The A-Leads "only count verifiable contacts" number: leads whose email is confirmed valid.
  function verifiedCount() {
    return allLeads().filter((l) => l && l.emailValid === true).length;
  }

  // Move a lead to another pipeline stage. Unknown stage → soft-fail (no mutation).
  function moveStage(email, stage) {
    try {
      const key = normEmail(email);
      if (!STAGES.includes(stage)) return { ok: false, error: 'unknown stage' };
      const lead = store.get(key);
      if (!lead) return { ok: false, error: 'no such lead' };
      lead.stage = stage;
      lead.updatedAt = clock();
      store.set(key, lead);
      return { ok: true, lead: { ...lead } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || 'move error') };
    }
  }

  // Counts per stage (all stages present, zero-filled).
  function pipeline() {
    const counts = Object.fromEntries(STAGES.map((s) => [s, 0]));
    for (const l of allLeads()) {
      if (l && counts[l.stage] != null) counts[l.stage]++;
    }
    return counts;
  }

  function getLead(email) {
    try {
      const lead = store.get(normEmail(email));
      return lead ? { ...lead } : null;
    } catch { return null; }
  }

  // List leads, optionally filtered by stage and/or verified (emailValid) only.
  function listLeads({ stage, verifiedOnly } = {}) {
    let rows = allLeads();
    if (stage != null) rows = rows.filter((l) => l && l.stage === stage);
    if (verifiedOnly) rows = rows.filter((l) => l && l.emailValid === true);
    return rows.map((l) => ({ ...l }));
  }

  // Flat rows, CRM-sync-ready (stable column order, primitives only).
  function exportRows() {
    return allLeads().map((l) => ({
      email: l.email,
      name: l.name,
      phone: l.phone,
      source: l.source,
      stage: l.stage,
      emailValid: !!l.emailValid,
      phoneValid: !!l.phoneValid,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  }

  // ── optional HTTP surface ──────────────────────────────────────────────────────────────────────────
  const sendJson = (res, code, obj) => {
    try {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    } catch { /* soft-fail */ }
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

      if (path === '/health' && method === 'GET') {
        return sendJson(res, 200, { ok: true, leads: allLeads().length, verified: verifiedCount() });
      }
      if (path === '/api/leads' && method === 'GET') {
        const stage = url.searchParams.get('stage');
        const verifiedOnly = url.searchParams.get('verifiedOnly');
        const rows = listLeads({
          stage: stage != null ? stage : undefined,
          verifiedOnly: verifiedOnly === '1' || verifiedOnly === 'true',
        });
        // esc() every string field so any downstream HTML embedding is safe.
        const safe = rows.map((r) => ({
          ...r,
          email: esc(r.email), name: esc(r.name), phone: esc(r.phone),
          source: esc(r.source), stage: esc(r.stage),
        }));
        return sendJson(res, 200, { ok: true, count: safe.length, leads: safe });
      }
      if (path === '/api/lead' && method === 'POST') {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-body' });
        const r = addLead(body);
        return sendJson(res, r.ok ? 200 : 400, r);
      }
      return sendJson(res, 404, { ok: false, error: 'not-found' });
    } catch {
      return sendJson(res, 500, { ok: false, error: 'error' });
    }
  }

  return {
    addLead, markVerified, verifiedCount, moveStage, pipeline,
    getLead, listLeads, exportRows, handler,
    STAGES: STAGES.slice(),
  };
}

export { defaultValidateEmail, esc };
