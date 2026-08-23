// pentecaust/herald/campaign-planner.mjs — the Herald GROWTH-CAMPAIGN planner (Zeely-style staged "Growth plan").
//
// You state a brand + goal + channels + a horizon in weeks, and this produces a per-brand STAGED campaign that
// spans the OTHER Herald modules: get sales-ready content → crack the algorithms (distribution) → unlock sales
// magnets/authority (backlinks) → win customers (convert/scale). Each stage is a week-indexed milestone broken
// into concrete STEPS, and every step names which OTHER Herald module executes it ('prompt-packs',
// 'seo-execution', 'pr-pipeline', 'link-exchange', 'crossposter', 'outreach-db') — so the planner orchestrates
// the suite rather than reinventing any single tool.
//
// Pure + deterministic given inputs (no clocks, no randomness, no network). Soft-fail-never-throw: bad input
// yields a shaped, empty-but-valid plan.
//
//   import { buildCampaign, advance, currentWeek, progress, nextSteps, handler } from './campaign-planner.mjs'
//   node pentecaust/herald/campaign-planner.mjs      # demo campaign for a sample brand

import { fileURLToPath } from 'node:url';
import { esc } from '../../integrations/soapbox/seo.mjs';

export { esc };

const clean = (s) => String(s == null ? '' : s).trim();
const arr = (a) => (Array.isArray(a) ? a.map(clean).filter(Boolean) : []);

// Canonical stage order — the four Growth-plan milestones. Each plan renders stages in exactly this sequence.
export const STAGES = ['content', 'distribution', 'authority', 'convert'];

const STAGE_TITLE = {
  content: 'Sales-Ready Content',
  distribution: 'Crack the Algorithms',
  authority: 'Authority & Backlinks',
  convert: 'Win Customers',
};

// Legal step statuses. advance() only moves a step among these; anything else is a soft no-op.
export const STATUSES = ['pending', 'active', 'done'];

/** Map a stage index onto a week within the horizon (spread evenly; clamped to [1, weeks]). */
function stageWeek(idx, weeks) {
  const w = Math.round(((idx + 1) * weeks) / STAGES.length);
  return Math.min(weeks, Math.max(1, w));
}

// A single step factory so the shape is identical everywhere. status starts 'pending'.
function step(stage, week, i, channel, action, detail, module) {
  return {
    id: `${stage}-${i}`,
    stage,
    week,
    channel: clean(channel),
    action: clean(action),
    detail: clean(detail),
    module: clean(module),
    status: 'pending',
  };
}

// ── per-stage step builders (deterministic; tailored to the inputs) ─────────────────────────────────────

function contentSteps({ name, goal, channels, stage, week }) {
  const t = [];
  let i = 0;
  const chs = channels.length ? channels : ['blog'];
  for (const ch of chs) {
    t.push(step(stage, week, ++i, ch,
      `Generate sales-ready ${ch} content for ${name}`,
      `Use prompt-packs to draft a batch of on-brand ${ch} posts for ${name} that advance the goal: "${goal || 'get discovered'}".`,
      'prompt-packs'));
  }
  t.push(step(stage, week, ++i, '',
    `Build the SEO landing/offer page for ${name}`,
    `Stand up the conversion landing page + on-page SEO so ${chs.join(', ')} traffic has somewhere to land.`,
    'seo-execution'));
  return t;
}

function distributionSteps({ name, channels, stage, week }) {
  const t = [];
  let i = 0;
  const chs = channels.length ? channels : ['blog'];
  for (const ch of chs) {
    t.push(step(stage, week, ++i, ch,
      `Schedule + cross-post to ${ch}`,
      `Crosspost the sales-ready content to ${ch} on the algorithm's best cadence to build reach for ${name}.`,
      'crossposter'));
  }
  t.push(step(stage, week, ++i, '',
    `Publish llms.txt + technical SEO for ${name}`,
    `Ship robots/sitemap/llms.txt so search + AI answer engines surface ${name}.`,
    'seo-execution'));
  return t;
}

function authoritySteps({ name, goal, stage, week }) {
  const t = [];
  let i = 0;
  t.push(step(stage, week, ++i, '',
    `Run link-exchange for ${name}`,
    `Prospect + swap backlinks with relevant sites to build ${name}'s domain authority.`,
    'link-exchange'));
  t.push(step(stage, week, ++i, '',
    `Draft + distribute a press release for ${name}`,
    `Push one release through the PR pipeline to earn authoritative citations toward the goal: "${goal || 'authority'}".`,
    'pr-pipeline'));
  t.push(step(stage, week, ++i, '',
    `Log every earned link/mention for ${name}`,
    `Record earned links, mentions and contacts in the outreach DB for follow-up.`,
    'outreach-db'));
  return t;
}

function convertSteps({ name, goal, channels, stage, week }) {
  const t = [];
  let i = 0;
  const chs = channels.length ? channels : ['blog'];
  t.push(step(stage, week, ++i, '',
    `Build sales magnets + CTAs for ${name}`,
    `Use prompt-packs to generate lead magnets, offers and CTAs that convert ${chs.join(', ')} audiences for ${name}.`,
    'prompt-packs'));
  t.push(step(stage, week, ++i, '',
    `Run outreach + follow-up sequence for ${name}`,
    `Work the outreach DB: personalized follow-ups to warm contacts to close the goal: "${goal || 'win customers'}".`,
    'outreach-db'));
  for (const ch of chs) {
    t.push(step(stage, week, ++i, ch,
      `Retarget + scale winning ${ch} content`,
      `Double down on the best-performing ${ch} content and scale cadence/spend for ${name}.`,
      'crossposter'));
  }
  return t;
}

const BUILDERS = {
  content: contentSteps,
  distribution: distributionSteps,
  authority: authoritySteps,
  convert: convertSteps,
};

// ── the public API ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Build a per-brand staged growth campaign. Deterministic given inputs; never throws.
 * @returns {object} { ok, brand, goal, channels, weeks, stages:[{stage,week,title,steps:[...]}] }
 */
export function buildCampaign(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const brand = clean(src.brand);
  const goal = clean(src.goal);
  const channels = arr(src.channels);
  let weeks = Math.floor(Number(src.weeks));
  if (!Number.isFinite(weeks) || weeks < 1) weeks = 4;
  const name = brand || '(unset brand)';

  const stages = STAGES.map((stage, idx) => {
    const week = stageWeek(idx, weeks);
    const ctx = { name, goal, channels, stage, week };
    let steps = [];
    try { steps = BUILDERS[stage](ctx) || []; } catch { steps = []; } // soft-fail one stage, keep the plan
    return { stage, week, title: STAGE_TITLE[stage], steps };
  });

  return { ok: true, brand, goal, channels, weeks, stages };
}

/** Flatten a plan's steps in stage order. Safe on any shape. */
function allSteps(plan) {
  if (!plan || !Array.isArray(plan.stages)) return [];
  const out = [];
  for (const st of plan.stages) if (st && Array.isArray(st.steps)) out.push(...st.steps);
  return out;
}

// Immutable-ish step status transition: returns a NEW plan with stepId set to `status`.
// Unknown id → the plan is returned unchanged (soft-fail).
function withStatus(plan, stepId, status) {
  if (!plan || !Array.isArray(plan.stages)) return plan;
  const id = clean(stepId);
  let changed = false;
  const stages = plan.stages.map((st) => {
    if (!st || !Array.isArray(st.steps)) return st;
    const steps = st.steps.map((sp) => {
      if (sp && sp.id === id) { changed = true; return { ...sp, status }; }
      return sp;
    });
    return { ...st, steps };
  });
  return changed ? { ...plan, stages } : plan;
}

/**
 * Advance a step to `status` (pending → active → done). Pure; returns a new plan.
 * Unknown id OR unknown status → the plan is returned unchanged (soft-fail).
 */
export function advance(plan, stepId, status) {
  const st = clean(status);
  if (!STATUSES.includes(st)) return plan;
  return withStatus(plan, stepId, st);
}

/** All steps scheduled for a given week (in stage order). Never throws. */
export function currentWeek(plan, week) {
  const w = Number(week);
  return allSteps(plan).filter((sp) => sp && sp.week === w);
}

/** Counts per stage + per status, plus overall percent done. Never throws. */
export function progress(plan) {
  const byStage = {};
  const byStatus = { pending: 0, active: 0, done: 0 };
  let total = 0;
  let done = 0;
  for (const sp of allSteps(plan)) {
    total += 1;
    byStage[sp.stage] = (byStage[sp.stage] || 0) + 1;
    if (byStatus[sp.status] != null) byStatus[sp.status] += 1;
    if (sp.status === 'done') done += 1;
  }
  const percent = total ? Math.round((done / total) * 100) : 0;
  return { total, done, percent, byStage, byStatus };
}

/** The pending steps in week-then-stage order (what to work on next). Never throws. */
export function nextSteps(plan) {
  return allSteps(plan)
    .filter((sp) => sp && sp.status === 'pending')
    .sort((a, b) => (a.week - b.week) || (STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage)));
}

// ── optional tiny HTTP surface ──────────────────────────────────────────────────────────────────────────
// POST /api/campaign  { brand, goal, channels, weeks } → JSON plan.  GET /health → { ok:true }.

function readBody(req) {
  return new Promise((resolve) => {
    try {
      if (req.body != null) { // pre-parsed (tests)
        return resolve(typeof req.body === 'string' ? safeJson(req.body) : req.body);
      }
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(safeJson(data)));
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
}
function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  try {
    if (typeof res.writeHead === 'function') res.writeHead(code, { 'Content-Type': 'application/json' });
    else { res.statusCode = code; if (res.setHeader) res.setHeader('Content-Type', 'application/json'); }
  } catch { /* soft-fail headers */ }
  res.end(body);
}

/** handler(req,res) — soft-fail, JSON only. esc() is applied to any echoed error text. */
export async function handler(req, res) {
  const url = String(req.url || '');
  const method = String(req.method || 'GET').toUpperCase();
  const path = url.split('?')[0];
  try {
    if (path === '/health') return sendJson(res, 200, { ok: true, service: 'herald-campaign-planner' });
    if (path === '/api/campaign' && method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, buildCampaign(body || {}));
    }
    return sendJson(res, 404, { ok: false, error: esc(`no route for ${method} ${path}`) });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: esc(String((e && e.message) || e)) });
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = buildCampaign({
    brand: 'MELEK',
    goal: 'onboard new witnesses',
    channels: ['x', 'youtube', 'blog'],
    weeks: 4,
  });
  console.log(JSON.stringify({
    plan,
    progress: progress(plan),
    next: nextSteps(plan).map((s) => s.id),
  }, null, 2));
}
