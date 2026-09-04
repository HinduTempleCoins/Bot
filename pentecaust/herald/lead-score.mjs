// pentecaust/herald/lead-score.mjs — Herald CRM LEAD SCORING: a 6sense / ActiveCampaign-class
// deterministic lead-scoring engine. Given an ICP definition, a lead record, intent signals, and
// engagement history, it returns a 0-100 fit+intent score, a cold/warm/hot tier, and a transparent
// breakdown of how every point was earned. Herald (MEMORY herald-sales-rep-product) is the AI sales
// rep / growth engine; this is the module that decides which captured leads a human (or Hathor) should
// chase first, and why.
//
// The score is a weighted blend of three axes (weights sum to 100):
//   ICP FIT      (max 45) — how well the lead matches the Ideal Customer Profile: title/role,
//                            industry, company-size band, and free-text keyword overlap.
//   INTENT       (max 35) — buying-intent signals: funding rounds, job changes (new decision-maker),
//                            site visits, pricing-page / demo-request activity, competitor research.
//   ENGAGEMENT   (max 20) — how the lead has interacted with our outreach: opens, clicks, replies,
//                            meetings booked, with reply/meeting weighted far above a passive open.
//
// PURE + DETERMINISTIC + OFFLINE: no clock, no network, no randomness. Same inputs → same score,
// always. Everything is soft-fail-never-throw: bad/missing input degrades that axis to 0 and is noted
// in breakdown.notes, the function never throws. This makes it safe to run over a whole CRM list and
// trivially testable.
//
// House style: ESM .mjs, esc() all interpolation (the render helper), soft-fail-never-throw, offline,
// handler(req,res) exported for tests, CLI guarded by process.argv[1].
//
//   import { scoreLead } from './lead-score.mjs';
//   scoreLead({
//     icp: { titles:['ceo','founder'], industries:['saas'], keywords:['api','developer'],
//            companySize:[10,500] },
//     lead: { title:'Founder & CEO', industry:'SaaS', keywords:['developer','api','devtools'],
//             companySize: 40 },
//     signals: { funding:true, siteVisits:3, demoRequest:true },
//     engagement: { opens:4, clicks:2, replies:1 }
//   });
//   // → { score: 91, tier:'hot', breakdown:{ icp:{...}, intent:{...}, engagement:{...}, weights, notes } }

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const envv = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const PORT = () => Number(envv('PORT', '8395')) || 8395;

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- axis caps (sum = 100) ----
export const WEIGHTS = Object.freeze({ icp: 45, intent: 35, engagement: 20 });

// ICP sub-caps (sum = 45)
const ICP_CAP = Object.freeze({ title: 15, industry: 10, size: 8, keywords: 12 });
// Intent points per signal (capped at WEIGHTS.intent)
const INTENT_PTS = Object.freeze({
  funding: 10,        // fresh capital → budget
  jobChange: 8,       // new decision-maker in seat
  demoRequest: 12,    // asked for a demo — strongest single intent
  pricingView: 7,     // looked at pricing
  competitorResearch: 6,
  siteVisitEach: 3,   // per distinct site visit
  siteVisitCap: 12,
});
// Engagement points (capped at WEIGHTS.engagement)
const ENGAGE_PTS = Object.freeze({
  openEach: 1, openCap: 4,
  clickEach: 3, clickCap: 9,
  replyEach: 6, replyCap: 12,
  meetingEach: 10, meetingCap: 20,
});

const clean = (s) => String(s == null ? '' : s).trim();
const lc = (s) => clean(s).toLowerCase();
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
const nonNegInt = (v) => { const n = toNum(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
const arr = (v) => (Array.isArray(v) ? v : (v == null ? [] : [v]));
const truthy = (v) => v === true || v === 1 || lc(v) === 'true' || lc(v) === 'yes';
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// tokenize a string / array of strings into a lowercased word set (letters+digits, len>=2)
const tokenSet = (v) => {
  const out = new Set();
  for (const item of arr(v)) {
    for (const tok of lc(item).split(/[^a-z0-9+]+/)) {
      const t = tok.trim();
      if (t.length >= 2) out.add(t);
    }
  }
  return out;
};

// does any ICP target token appear as a substring token-match in the lead field?
const anyOverlap = (icpVals, leadToks) => {
  for (const want of arr(icpVals)) {
    const w = lc(want);
    if (!w) continue;
    if (leadToks.has(w)) return true;
    // multi-word ICP value (e.g. "vp sales"): all its tokens present
    const parts = w.split(/[^a-z0-9+]+/).filter((p) => p.length >= 2);
    if (parts.length > 1 && parts.every((p) => leadToks.has(p))) return true;
  }
  return false;
};

function scoreIcp(icp, lead, notes) {
  const b = { title: 0, industry: 0, size: 0, keywords: 0, max: WEIGHTS.icp };
  if (!icp || typeof icp !== 'object') { notes.push('icp: missing ICP definition — fit scored 0'); b.subtotal = 0; return b; }
  if (!lead || typeof lead !== 'object') { notes.push('lead: missing lead record — fit scored 0'); b.subtotal = 0; return b; }

  // title / role
  const leadTitleToks = tokenSet(lead.title || lead.role || lead.jobTitle);
  if (anyOverlap(icp.titles || icp.roles, leadTitleToks)) b.title = ICP_CAP.title;
  else notes.push('icp.title: no title/role match');

  // industry
  const leadIndToks = tokenSet(lead.industry || lead.vertical);
  if (anyOverlap(icp.industries || icp.verticals, leadIndToks)) b.industry = ICP_CAP.industry;
  else notes.push('icp.industry: no industry match');

  // company-size band [min,max]
  const band = icp.companySize || icp.sizeBand;
  const size = toNum(lead.companySize != null ? lead.companySize : lead.employees);
  if (Array.isArray(band) && band.length === 2 && Number.isFinite(size)) {
    const [mn, mx] = [toNum(band[0]), toNum(band[1])];
    if (Number.isFinite(mn) && Number.isFinite(mx) && size >= mn && size <= mx) b.size = ICP_CAP.size;
    else notes.push('icp.size: company size outside target band');
  } else if (band != null || lead.companySize != null || lead.employees != null) {
    notes.push('icp.size: size band or lead size unusable');
  }

  // keyword overlap — proportional (Jaccard-ish) up to the cap
  const want = tokenSet(icp.keywords);
  const have = tokenSet([...arr(lead.keywords), ...arr(lead.tags), lead.description]);
  if (want.size > 0) {
    let hits = 0;
    for (const w of want) if (have.has(w)) hits++;
    const frac = hits / want.size;
    b.keywords = round2(ICP_CAP.keywords * frac);
    if (hits === 0) notes.push('icp.keywords: no keyword overlap');
  }

  b.subtotal = round2(Math.min(WEIGHTS.icp, b.title + b.industry + b.size + b.keywords));
  return b;
}

function scoreIntent(signals, notes) {
  const b = { events: {}, max: WEIGHTS.intent };
  let sum = 0;
  if (!signals || typeof signals !== 'object') {
    notes.push('signals: no intent signals — intent scored 0');
    b.subtotal = 0; return b;
  }
  const add = (key, pts) => { b.events[key] = pts; sum += pts; };
  if (truthy(signals.funding) || truthy(signals.fundingRound)) add('funding', INTENT_PTS.funding);
  if (truthy(signals.jobChange) || truthy(signals.newRole)) add('jobChange', INTENT_PTS.jobChange);
  if (truthy(signals.demoRequest) || truthy(signals.demo)) add('demoRequest', INTENT_PTS.demoRequest);
  if (truthy(signals.pricingView) || truthy(signals.pricingPage)) add('pricingView', INTENT_PTS.pricingView);
  if (truthy(signals.competitorResearch)) add('competitorResearch', INTENT_PTS.competitorResearch);
  const visits = nonNegInt(signals.siteVisits != null ? signals.siteVisits : signals.visits);
  if (visits > 0) add('siteVisits', Math.min(INTENT_PTS.siteVisitCap, visits * INTENT_PTS.siteVisitEach));

  b.subtotal = round2(Math.min(WEIGHTS.intent, sum));
  if (b.subtotal === 0) notes.push('intent: no recognized buying signals');
  return b;
}

function scoreEngagement(engagement, notes) {
  const b = { opens: 0, clicks: 0, replies: 0, meetings: 0, max: WEIGHTS.engagement };
  if (!engagement || typeof engagement !== 'object') {
    notes.push('engagement: no engagement history — engagement scored 0');
    b.subtotal = 0; return b;
  }
  const opens = nonNegInt(engagement.opens);
  const clicks = nonNegInt(engagement.clicks);
  const replies = nonNegInt(engagement.replies);
  const meetings = nonNegInt(engagement.meetings != null ? engagement.meetings : engagement.meetingsBooked);
  b.opens = Math.min(ENGAGE_PTS.openCap, opens * ENGAGE_PTS.openEach);
  b.clicks = Math.min(ENGAGE_PTS.clickCap, clicks * ENGAGE_PTS.clickEach);
  b.replies = Math.min(ENGAGE_PTS.replyCap, replies * ENGAGE_PTS.replyEach);
  b.meetings = Math.min(ENGAGE_PTS.meetingCap, meetings * ENGAGE_PTS.meetingEach);
  b.subtotal = round2(Math.min(WEIGHTS.engagement, b.opens + b.clicks + b.replies + b.meetings));
  if (b.subtotal === 0) notes.push('engagement: no opens/clicks/replies/meetings');
  return b;
}

const tierFor = (score) => (score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold');

// ---- public API ----
export function scoreLead(input = {}) {
  const notes = [];
  let icp, lead, signals, engagement;
  try {
    ({ icp, lead, signals, engagement } = (input && typeof input === 'object') ? input : {});
  } catch { icp = lead = signals = engagement = undefined; }

  const bIcp = scoreIcp(icp, lead, notes);
  const bIntent = scoreIntent(signals, notes);
  const bEngage = scoreEngagement(engagement, notes);

  const score = Math.max(0, Math.min(100, Math.round(bIcp.subtotal + bIntent.subtotal + bEngage.subtotal)));
  const tier = tierFor(score);

  return {
    ok: true,
    score,
    tier,
    breakdown: {
      icp: bIcp,
      intent: bIntent,
      engagement: bEngage,
      weights: WEIGHTS,
      notes,
    },
  };
}

// score a batch, ranked hottest-first (stable: preserves input order on ties)
export function scoreLeads(leads = []) {
  if (!Array.isArray(leads)) return [];
  const rows = leads.map((entry, i) => {
    const r = scoreLead(entry || {});
    return { index: i, id: (entry && (entry.id || (entry.lead && entry.lead.id))) || null, ...r };
  });
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.score - a.r.score) || (a.i - b.i))
    .map(({ r }) => r);
}

// small HTML render of a single result (esc'd) — used by the handler
export function renderScore(res) {
  const r = res || {};
  const b = (r.breakdown) || {};
  const notes = (b.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Lead score</title>
<div class="alpha-badge">Alpha</div>
<h1>Lead score: ${esc(r.score)} <small>(${esc(r.tier)})</small></h1>
<ul>
  <li>ICP fit: ${esc(b.icp && b.icp.subtotal)} / ${esc(WEIGHTS.icp)}</li>
  <li>Intent: ${esc(b.intent && b.intent.subtotal)} / ${esc(WEIGHTS.intent)}</li>
  <li>Engagement: ${esc(b.engagement && b.engagement.subtotal)} / ${esc(WEIGHTS.engagement)}</li>
</ul>
${notes ? `<h2>Notes</h2><ul>${notes}</ul>` : ''}`;
}

// ---- HTTP handler (POST JSON body → score) — exported for tests ----
export async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'POST a JSON lead payload' }));
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; }
    catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'invalid JSON' })); return; }
    const result = scoreLead(body);
    const wantsHtml = /text\/html/.test(String(req.headers && req.headers.accept));
    if (wantsHtml) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderScore(result));
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    }
  } catch (e) {
    try { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'internal' })); } catch {}
  }
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createServer(handler);
  server.listen(PORT(), () => {
    // eslint-disable-next-line no-console
    console.log(`herald lead-score on :${PORT()} — POST a { icp, lead, signals, engagement } JSON payload`);
  });
}
