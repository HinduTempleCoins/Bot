// pentecaust/herald/llm-wiring.mjs — connect Herald's drafting seams to the live LLM ensemble.
//
// WHY THIS EXISTS. Four Herald modules expose an injectable `__setLLM` seam — crm/builder (ICP +
// outreach sequence), herald/factory (per-platform content drafts), herald/haro-monitor (source-request
// responses), herald/pr-pipeline (press releases). Every one of them was written correctly, with a
// deterministic fallback so it never throws.
//
// And NOTHING outside the tests ever called __setLLM. So in production `_llm` stayed null, every
// draft came back `source: 'template'`, and `buildCampaignPlan` returned an ICP with empty titles,
// industries, keywords, geo and size — plus a sequence whose first subject line reads
// "Quick question, there", the {{first_name}} fallback leaking into the subject.
//
// That is the whole reason Herald never advertised anything: the engine drafts a skeleton, and a
// skeleton is not sendable, so no human ever had a campaign worth sending. The model was never the
// missing piece — the WIRE was.
//
// This module is that wire. It is explicit and opt-in: import and call wireHerald() from whatever
// process wants live drafting. It changes no module's behaviour when the ensemble is unreachable —
// textOf() returns '' and each module falls back exactly as before.
//
//   import { wireHerald } from './llm-wiring.mjs';
//   const r = await wireHerald();     // { wired: [...], skipped: [...], provider: 'live'|'none' }

import { complete, textOf } from '../../integrations/llm-router.mjs';

/** The one adapter every Herald seam expects: prompt -> string. Never throws, '' on failure. */
export function makeAsker({ task = 'quality', log } = {}) {
  return async function ask(prompt) {
    try {
      const r = await complete(String(prompt || ''), { task, ...(log ? { log } : {}) });
      // textOf() is the ONLY safe reader — the naive `String(r.text || r)` idiom yields the literal
      // "[object Object]" when every provider fails. See llm-router.mjs.
      return textOf(r);
    } catch { return ''; }
  };
}

/** The seams, in the order they matter for advertising the company. */
export const SEAMS = [
  { id: 'crm-builder', path: '../crm/builder.mjs', why: 'ICP + outreach sequence — the AI-SDR core' },
  { id: 'factory', path: './factory.mjs', why: 'per-platform content drafts (humans post)' },
  { id: 'haro-monitor', path: './haro-monitor.mjs', why: 'source-request responses' },
  { id: 'pr-pipeline', path: './pr-pipeline.mjs', why: 'press releases' },
];

/**
 * wireHerald — inject the live ensemble into every Herald drafting seam.
 * Soft-fails per seam: a module that cannot be imported is reported, not thrown.
 */
export async function wireHerald({ asker = makeAsker(), seams = SEAMS } = {}) {
  const wired = []; const skipped = [];
  for (const s of seams) {
    try {
      const mod = await import(s.path);
      if (typeof mod.__setLLM !== 'function') { skipped.push({ id: s.id, why: 'no __setLLM export' }); continue; }
      mod.__setLLM(asker);
      wired.push({ id: s.id, why: s.why });
    } catch (e) {
      skipped.push({ id: s.id, why: (e && e.message) || 'import failed' });
    }
  }
  return { wired, skipped, provider: wired.length ? 'live' : 'none' };
}

/** Unwire — restore every seam to its deterministic fallback (used by tests). */
export async function unwireHerald({ seams = SEAMS } = {}) {
  for (const s of seams) {
    try { const m = await import(s.path); if (typeof m.__setLLM === 'function') m.__setLLM(null); } catch { /* ignore */ }
  }
}

const isMain = process.argv[1] && process.argv[1].endsWith('llm-wiring.mjs');
if (isMain) {
  const r = await wireHerald();
  console.log(JSON.stringify(r, null, 2));
  const { buildCampaignPlan } = await import('../crm/builder.mjs');
  const plan = await buildCampaignPlan({
    goal: process.env.GOAL || 'Get GPU miners already running Ethash rigs to point hashpower at PRANA',
    website: process.env.SITE || 'https://pranascan.soapbox.community',
    valueProp: process.env.VP || 'PRANA is a fair-launch Ethash PoW L1 — no premine, no allocation, no founder share.',
  });
  console.log('\nsource:', plan.source, '(llm = the wire works; template = ensemble unreachable)');
  console.log(JSON.stringify(plan.icp, null, 2));
}
