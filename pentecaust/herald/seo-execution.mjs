// pentecaust/herald/seo-execution.mjs — the Herald SEO-EXECUTION planner (outreach brief, "Atlas Brain"-style).
//
// You state an intent (a site + a goal + optional keywords/competitors) and this produces an EXECUTED-style
// plan: ordered PHASES (technical → content → authority/links → ai-search-visibility → deploy), each broken
// into concrete, actionable TASKS with an approval gate — not a dashboard. Tasks are specific to the inputs
// (e.g. "generate 3 title/meta variants for <keyword>", "draft outreach to <competitor> gap topics",
// "publish llms.txt for AI-search visibility"), and every task carries {id, phase, action, detail, status,
// requiresApproval} so a caller can walk it, approve gated steps, and mark completion.
//
// Pure + deterministic given inputs (no clocks, no randomness, no network). Soft-fail-never-throw: bad input
// yields a shaped, empty-but-valid plan. Reuses the SoapBox SEO head-tag builders instead of reinventing them.
//
//   import { buildPlan, approveTask, completeTask, nextActions, summary, handler } from './seo-execution.mjs'
//   node pentecaust/herald/seo-execution.mjs        # demo plan for a sample intent
//
// NOTE on reuse: technical head-tag output (canonical/OG/JSON-LD) is delegated to
// integrations/soapbox/seo.mjs (esc/headTags/webSiteJsonLd) — the one place those tags are correctly built.
// The rest (phase/task orchestration, approval state) is genuinely new and self-contained here.

import { fileURLToPath } from 'node:url';
import { esc, headTags, webSiteJsonLd } from '../../integrations/soapbox/seo.mjs';

export { esc };

const clean = (s) => String(s == null ? '' : s).trim();
const arr = (a) => (Array.isArray(a) ? a.map(clean).filter(Boolean) : []);

// Canonical phase order. Each plan renders phases in exactly this sequence.
export const PHASES = ['technical', 'content', 'authority', 'ai-search-visibility', 'deploy'];

const PHASE_TITLE = {
  technical: 'Technical SEO',
  content: 'Content Generation',
  authority: 'Authority & Links',
  'ai-search-visibility': 'AI-Search Visibility',
  deploy: 'Deploy & Submit',
};

/** Normalize a site to a bare origin-ish string (never throws; empty stays empty). */
function normSite(site) {
  const s = clean(site);
  if (!s) return '';
  return s.replace(/\/+$/, '');
}

/** A canonical https URL for the site (adds scheme if the operator gave a bare host). */
function siteUrl(site) {
  const s = normSite(site);
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** Short human name for the site (host without scheme), used in task copy. */
function siteName(site) {
  return normSite(site).replace(/^https?:\/\//i, '') || '(unset site)';
}

// A single task factory so the shape is identical everywhere. status starts 'pending'.
function task(phase, i, action, detail, requiresApproval = false) {
  return {
    id: `${phase}-${i}`,
    phase,
    action: clean(action),
    detail: clean(detail),
    status: 'pending',
    requiresApproval: !!requiresApproval,
  };
}

// ── per-phase task builders (deterministic; specific to the inputs) ─────────────────────────────────────

function technicalTasks({ url, name, keywords }) {
  const primary = keywords[0] || name;
  // Genuine reuse: the recommended <head> fragment comes from the shared seo.mjs builder.
  const recommended = headTags({
    title: primary ? `${primary} — ${name}` : name,
    description: primary ? `${primary} on ${name}.` : `${name}.`,
    canonical: url,
    siteName: name,
    site: url ? { url, name } : null,
  });
  const t = [];
  let i = 0;
  t.push(task('technical', ++i,
    `Fix/confirm canonical on ${name}`,
    `Ensure every indexable page on ${url || name} emits a self-referential <link rel="canonical">. Recommended head fragment:\n${recommended}`));
  t.push(task('technical', ++i,
    `Publish robots.txt + XML sitemap for ${name}`,
    `Serve robots.txt allowing crawl and referencing ${url ? `${url}/sitemap.xml` : 'the sitemap'}; generate an XML sitemap of all canonical URLs with lastmod.`));
  t.push(task('technical', ++i,
    `Add Organization + WebSite JSON-LD to ${name}`,
    `Inject the site @graph so search + AI crawlers resolve one brand entity: ${JSON.stringify(webSiteJsonLd({ url, name }))}`));
  t.push(task('technical', ++i,
    `Core Web Vitals + mobile pass for ${name}`,
    `Audit LCP/CLS/INP, compress images, defer non-critical JS, set explicit width/height; target green mobile CWV before content push.`));
  return t;
}

function contentTasks({ name, keywords, goal }) {
  const t = [];
  let i = 0;
  const kws = keywords.length ? keywords : [name];
  for (const kw of kws) {
    t.push(task('content', ++i,
      `Generate 3 title/meta variants for "${kw}"`,
      `Draft 3 <title> (<=60 chars) + meta description (<=155 chars) variants targeting "${kw}", each folding in a unique benefit; pick the highest-CTR variant.`));
  }
  const primary = kws[0];
  t.push(task('content', ++i,
    `Draft a pillar article outline for "${primary}"`,
    `Produce an H1/H2/H3 outline + FAQ block for a pillar page on "${primary}" that advances the goal: "${goal || 'organic visibility'}". Interlink to related pages.`));
  t.push(task('content', ++i,
    `Draft supporting cluster posts`,
    `Draft ${kws.length} supporting posts (one per keyword) linking up to the "${primary}" pillar to build a topical cluster.`,
    true));
  return t;
}

function authorityTasks({ name, competitors, keywords }) {
  const t = [];
  let i = 0;
  const primary = keywords[0] || name;
  if (competitors.length) {
    for (const c of competitors) {
      t.push(task('authority', ++i,
        `Draft outreach to gap topics vs ${c}`,
        `Identify topics/backlinks "${c}" ranks for that ${name} does not, draft a personalized outreach/guest-post pitch to close the gap on "${primary}".`,
        true));
    }
  } else {
    t.push(task('authority', ++i,
      `Prospect link targets for "${primary}"`,
      `Build a list of relevant, high-authority sites in the "${primary}" niche and draft personalized outreach.`,
      true));
  }
  t.push(task('authority', ++i,
    `Build a linkable resource asset`,
    `Create one data/tool/guide asset on ${name} worth citing (the "link magnet") to earn passive backlinks for "${primary}".`));
  return t;
}

function aiVisibilityTasks({ url, name, keywords }) {
  const t = [];
  let i = 0;
  const primary = keywords[0] || name;
  t.push(task('ai-search-visibility', ++i,
    `Publish llms.txt for ${name}`,
    `Publish ${url ? `${url}/llms.txt` : '/llms.txt'} summarizing the site + linking key pages so AI answer engines can cite ${name} accurately.`));
  t.push(task('ai-search-visibility', ++i,
    `Add FAQPage structured data for "${primary}"`,
    `Emit FAQPage JSON-LD answering the real long-tail questions around "${primary}" so AI/SGE surfaces pull answers from ${name}.`));
  t.push(task('ai-search-visibility', ++i,
    `Optimize for citation/answer-extraction`,
    `Add concise, self-contained answer paragraphs + entity definitions so LLM crawlers can quote ${name} verbatim.`));
  return t;
}

function deployTasks({ url, name }) {
  const t = [];
  let i = 0;
  t.push(task('deploy', ++i,
    `Deploy technical + content changes to ${name}`,
    `Ship the canonical/head, sitemap, JSON-LD, llms.txt and new content to production${url ? ` (${url})` : ''}.`,
    true));
  t.push(task('deploy', ++i,
    `Submit sitemap to Search Console`,
    `Submit ${url ? `${url}/sitemap.xml` : 'the sitemap'} in Google Search Console + Bing Webmaster Tools and request indexing of new URLs.`,
    true));
  t.push(task('deploy', ++i,
    `Verify live SEO output`,
    `Fetch key ${name} pages and confirm canonical, meta, and JSON-LD render as designed; log the results for the next cycle.`));
  return t;
}

const BUILDERS = {
  technical: technicalTasks,
  content: contentTasks,
  authority: authorityTasks,
  'ai-search-visibility': aiVisibilityTasks,
  deploy: deployTasks,
};

// ── the public API ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Build an ordered, tailored SEO execution plan. Deterministic given inputs; never throws.
 * @returns {object} { ok, site, goal, keywords, competitors, phases:[{phase,title,tasks:[...]}] }
 */
export function buildPlan(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const site = normSite(src.site);
  const goal = clean(src.goal);
  const keywords = arr(src.keywords);
  const competitors = arr(src.competitors);
  const ctx = { url: siteUrl(site), name: siteName(site), goal, keywords, competitors };

  const phases = PHASES.map((phase) => {
    let tasks = [];
    try { tasks = BUILDERS[phase](ctx) || []; } catch { tasks = []; } // soft-fail one phase, keep the plan
    return { phase, title: PHASE_TITLE[phase], tasks };
  });

  return { ok: true, site, goal, keywords, competitors, phases };
}

/** Flatten a plan's tasks in phase order. Safe on any shape. */
function allTasks(plan) {
  if (!plan || !Array.isArray(plan.phases)) return [];
  const out = [];
  for (const ph of plan.phases) if (ph && Array.isArray(ph.tasks)) out.push(...ph.tasks);
  return out;
}

// Immutable-ish task status transition: returns a NEW plan with taskId set to `status`.
// Unknown id → the plan is returned unchanged (soft-fail).
function withStatus(plan, taskId, status) {
  if (!plan || !Array.isArray(plan.phases)) return plan;
  const id = clean(taskId);
  let changed = false;
  const phases = plan.phases.map((ph) => {
    if (!ph || !Array.isArray(ph.tasks)) return ph;
    const tasks = ph.tasks.map((tk) => {
      if (tk && tk.id === id) { changed = true; return { ...tk, status }; }
      return tk;
    });
    return { ...ph, tasks };
  });
  return changed ? { ...plan, phases } : plan;
}

/** Mark a task approved (clears its approval gate). Pure; unknown id → unchanged plan. */
export function approveTask(plan, taskId) {
  return withStatus(plan, taskId, 'approved');
}

/** Mark a task done. Pure; unknown id → unchanged plan. */
export function completeTask(plan, taskId) {
  return withStatus(plan, taskId, 'done');
}

/**
 * The pending, non-blocked tasks in phase order. A task is actionable when it is approved, or pending
 * and needs no approval. A pending task that requiresApproval is BLOCKED (approve it first) and omitted.
 */
export function nextActions(plan) {
  return allTasks(plan).filter((tk) =>
    tk && (tk.status === 'approved' || (tk.status === 'pending' && !tk.requiresApproval)));
}

/** Counts per phase + per status. Never throws. */
export function summary(plan) {
  const byPhase = {};
  const byStatus = { pending: 0, approved: 0, done: 0 };
  let total = 0;
  if (plan && Array.isArray(plan.phases)) {
    for (const ph of plan.phases) {
      if (!ph || !Array.isArray(ph.tasks)) continue;
      byPhase[ph.phase] = ph.tasks.length;
      for (const tk of ph.tasks) {
        total += 1;
        if (tk && byStatus[tk.status] != null) byStatus[tk.status] += 1;
      }
    }
  }
  return { total, byPhase, byStatus };
}

// ── optional tiny HTTP surface ──────────────────────────────────────────────────────────────────────────
// POST /api/plan  { site, goal, keywords, competitors } → JSON plan.  GET /health → { ok:true }.

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
    if (path === '/health') return sendJson(res, 200, { ok: true, service: 'herald-seo-execution' });
    if (path === '/api/plan' && method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, buildPlan(body || {}));
    }
    return sendJson(res, 404, { ok: false, error: esc(`no route for ${method} ${path}`) });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: esc(String(e && e.message || e)) });
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plan = buildPlan({
    site: 'melek.salon',
    goal: 'rank for MELEK blockchain onboarding',
    keywords: ['MELEK blockchain', 'how to join MELEK', 'MELEK witness'],
    competitors: ['hive.io', 'blurt.blog'],
  });
  console.log(JSON.stringify({ plan, summary: summary(plan), next: nextActions(plan).map((t) => t.id) }, null, 2));
}
