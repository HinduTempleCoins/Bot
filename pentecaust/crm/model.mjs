// pentecaust/crm/model.mjs — the MoneyPrinter/AI-SDR CRM backbone for Pentecaust: campaigns, an ideal-
// customer profile (ICP), a multi-step outreach sequence, leads, and a pipeline. This is the DETERMINISTIC
// plumbing the research doc (.local/MONEYPRINTER_RESEARCH_AND_PENTECAUST_PLAN.md) calls "~80% of the system";
// the LLM lives next door in builder.mjs. NOTHING here sends mail or touches the network — it is the
// off-chain roster + state machine the sender workers will later read. Deliverability-critical sending is a
// SEPARATE, gated system (never shares reputation with @pentecaust.com transactional mail).
//
// Persistence mirrors pentecaust/model.mjs: one JSON file, injectable fs, soft-fail-never-throw, fully
// offline-testable. Keyed to a MELEK account (the one cross-game identity) as the campaign owner.
//
//   import { createCampaign, getCampaign, campaignsForOwner, setICP, setSequence,
//            addLead, moveLead, leadStats, STAGES, CHANNELS } from './model.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validAccountName } from '../../signup/welcome-grant.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('CRM_DATA', join(process.cwd(), 'data', 'crm.json'));

// Pipeline stages a lead moves through (left→right). 'unsubscribed' is terminal + suppresses all sends.
export const STAGES = ['new', 'queued', 'contacted', 'replied', 'meeting', 'won', 'lost', 'unsubscribed'];
// Outreach channels a sequence step can use. 'email' is the workhorse; 'linkedin' goes via Unipile later.
export const CHANNELS = ['email', 'linkedin', 'task'];

// Guardrails (the research doc's "facts-only, length caps" — also just sane storage bounds).
const MAX_LEADS = Number(env('CRM_MAX_LEADS', '5000')) || 5000;
const MAX_STEPS = Number(env('CRM_MAX_STEPS', '12')) || 12;
const MAX_BODY = Number(env('CRM_MAX_BODY', '4000')) || 4000;
const MAX_SUBJECT = 200;

const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());
const clamp = (s, n) => String(s == null ? '' : s).slice(0, n);

// ── injectable fs + store (same discipline as pentecaust/model.mjs) ──────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { campaigns: {} };
  try { const o = JSON.parse(raw); return o && o.campaigns ? o : { campaigns: {} }; } catch { return { campaigns: {} }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────
const acct = (s) => String(s || '').toLowerCase().replace(/^@/, '').trim();
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function uniqueId(store, base) {
  const b = base || 'campaign';
  if (!store.campaigns[b]) return b;
  for (let i = 2; i < 100000; i++) { const id = `${b}-${i}`; if (!store.campaigns[id]) return id; }
  return `${b}-${now()}`;
}
// Stable-ish lead id from email (dedupe key) or a counter fallback. Lowercased email is the natural key.
const leadKey = (lead) => (lead && lead.email ? String(lead.email).toLowerCase().trim() : '') || null;

// ── ICP normaliser — the LLM (builder) emits VALUES into this fixed schema; it does not invent the shape.
export function normalizeICP(raw = {}) {
  const arr = (v) => Array.isArray(v) ? v.map((x) => clamp(x, 120)).filter(Boolean).slice(0, 40) : [];
  return {
    titles: arr(raw.titles),          // job titles to target
    industries: arr(raw.industries),
    keywords: arr(raw.keywords),      // signals: hiring, funding, tech, competitor-follower
    geo: arr(raw.geo),
    size: clamp(raw.size, 60),        // e.g. "11-50", "Series A"
    valueProp: clamp(raw.valueProp, 500),
  };
}

// ── a sequence step: channel + delay + templated copy (merge fields substituted at send, not here). ──
export function normalizeStep(raw = {}) {
  const channel = CHANNELS.includes(raw.channel) ? raw.channel : 'email';
  const delayDays = Math.max(0, Math.min(90, Math.round(Number(raw.delayDays) || 0)));
  return {
    channel,
    delayDays,
    subject: clamp(raw.subject, MAX_SUBJECT),
    body: clamp(raw.body, MAX_BODY),
  };
}

// ── campaigns ─────────────────────────────────────────────────────────────────────────────────────────
export function createCampaign({ owner, name, goal, website } = {}, opts = {}) {
  const o = acct(owner);
  if (!validAccountName(o)) return { ok: false, reason: 'owner must be a valid MELEK account' };
  const nm = clamp(name || goal || 'Untitled campaign', 120).trim() || 'Untitled campaign';
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const id = uniqueId(store, slug(nm) || 'campaign');
  const t = now(opts);
  const c = {
    id, owner: o, name: nm,
    goal: clamp(goal, 1000), website: clamp(website, 300),
    icp: normalizeICP({}), sequence: [], leads: [],
    status: 'draft', created: t, updated: t,
  };
  store.campaigns[id] = c;
  saveStore(fs, file, store);
  return { ok: true, campaign: c };
}

export function getCampaign(id, opts = {}) {
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).campaigns[String(id || '')] || null;
}

export function campaignsForOwner(owner, opts = {}) {
  const o = acct(owner);
  const { fs, file } = ctx(opts);
  return Object.values(loadStore(fs, file).campaigns)
    .filter((c) => c.owner === o)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function mutate(id, opts, fn) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const c = store.campaigns[String(id || '')];
  if (!c) return { ok: false, reason: 'no such campaign' };
  const r = fn(c);
  if (r && r.ok === false) return r;
  c.updated = now(opts);
  saveStore(fs, file, store);
  return { ok: true, campaign: c };
}

export function setICP(id, icp, opts = {}) {
  return mutate(id, opts, (c) => { c.icp = normalizeICP(icp || {}); });
}

export function setSequence(id, steps, opts = {}) {
  const list = Array.isArray(steps) ? steps.slice(0, MAX_STEPS).map(normalizeStep) : [];
  return mutate(id, opts, (c) => { c.sequence = list; });
}

export function setStatus(id, status, opts = {}) {
  const s = ['draft', 'active', 'paused', 'done'].includes(status) ? status : null;
  if (!s) return { ok: false, reason: 'bad status' };
  return mutate(id, opts, (c) => { c.status = s; });
}

// ── leads + pipeline ─────────────────────────────────────────────────────────────────────────────────
export function addLead(id, lead = {}, opts = {}) {
  return mutate(id, opts, (c) => {
    if (c.leads.length >= MAX_LEADS) return { ok: false, reason: 'lead cap reached' };
    const key = leadKey(lead);
    // Dedupe on email (the waterfall-enrichment invariant: never two rows for one address).
    if (key && c.leads.some((l) => leadKey(l) === key)) return { ok: false, reason: 'duplicate lead (email)' };
    const lid = key || `lead-${c.leads.length + 1}-${now(opts)}`;
    c.leads.push({
      id: lid,
      name: clamp(lead.name, 120),
      company: clamp(lead.company, 160),
      title: clamp(lead.title, 160),
      email: clamp(lead.email, 200).toLowerCase().trim(),
      signal: clamp(lead.signal, 300),     // the verified reason to reach out (grounds the AI opener)
      stage: 'new',
      added: now(opts),
    });
  });
}

export function moveLead(id, leadId, stage, opts = {}) {
  if (!STAGES.includes(stage)) return { ok: false, reason: 'bad stage' };
  return mutate(id, opts, (c) => {
    const l = c.leads.find((x) => x.id === leadId);
    if (!l) return { ok: false, reason: 'no such lead' };
    l.stage = stage;
  });
}

export function leadStats(id, opts = {}) {
  const c = getCampaign(id, opts);
  if (!c) return null;
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const l of c.leads) if (byStage[l.stage] != null) byStage[l.stage]++;
  return { total: c.leads.length, byStage };
}
