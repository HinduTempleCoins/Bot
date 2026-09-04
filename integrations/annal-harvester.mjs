// annal-harvester.mjs — mine the brain's own writing for things we still need to DO.
//
// The brain (the conference loop + the connective/diagnostic annal writers) has produced hundreds of
// AI analyses of the ~1900 things already built — system maps, conference audits, diagnostics, briefs.
// The operator (2026-06-20): "there is probably a lot they have said about the things that were done…
// we should be able to get some things from that that we need to do." This reads the high-signal
// annals + the newest brief, asks the ensemble to pull out CONCRETE, not-yet-done next actions, dedupes
// them against what the tracker already has open, and writes a fresh queue the brief/itinerary surface.
//
// Pure + injectable: pass `complete` (the LLM ensemble), `fsmod` and the dirs for offline tests. No
// network, no keys, soft-fail. House style: ESM, CLI guard, handler(req,res).

import fsDefault from 'node:fs';
// textOf(): the ONLY safe way to read a completion. See its doc in llm-router.mjs —
// the naive `String(r.text || r) ` idiom silently produced the literal "[object Object]".
import { textOf } from './llm-router.mjs';

// High-signal annal name patterns — the AI-authored analyses worth mining (not raw transcripts).
const SIGNAL = [/^_connections\./i, /^_conference-audit/i, /^_diagnostics\./i, /^_synthesis/i, /^_review/i];

// Pick the source documents: the newest high-signal annals + the newest brief's FOR-CLAUDE section.
export function pickSources({ annalsDir, briefsDir, limit = 10, fsmod = fsDefault } = {}) {
  const sources = [];
  try {
    const files = fsmod.readdirSync(annalsDir)
      .filter((f) => f.endsWith('.md') && SIGNAL.some((re) => re.test(f)))
      .map((f) => ({ f, m: statMs(`${annalsDir}/${f}`, fsmod) }))
      .sort((a, b) => b.m - a.m)
      .slice(0, limit);
    for (const { f } of files) {
      const body = read(`${annalsDir}/${f}`, fsmod);
      if (body.trim()) sources.push({ name: f, text: clip(body, 4000) });
    }
  } catch { /* no annals dir → empty */ }
  // newest brief: only the FOR CLAUDE CODE section (the forward task list)
  try {
    const briefs = fsmod.readdirSync(briefsDir)
      .filter((f) => f.startsWith('brief-') && f.endsWith('.md'))
      .map((f) => ({ f, m: statMs(`${briefsDir}/${f}`, fsmod) }))
      .sort((a, b) => b.m - a.m);
    if (briefs[0]) {
      const body = read(`${briefsDir}/${briefs[0].f}`, fsmod);
      const forClaude = (body.split(/##\s*FOR CLAUDE CODE/i)[1] || '').split(/\n##\s/)[0];
      if (forClaude.trim()) sources.push({ name: briefs[0].f, text: clip(forClaude, 3000) });
    }
  } catch { /* no briefs */ }
  return sources;
}

export function buildPrompt(sources, openItems = []) {
  const corpus = sources.map((s) => `### ${s.name}\n${s.text}`).join('\n\n');
  const known = openItems.slice(0, 60).map((t) => `- ${t}`).join('\n');
  return [
    'You are reading analyses that several AIs wrote about a large software project — system maps,',
    'audits, diagnostics, and a status brief. The project has already built ~1900 things. Your job:',
    'extract CONCRETE, SPECIFIC next actions that still need doing — gaps, broken pieces, follow-ups,',
    'and decisions that were raised but never resolved in these notes.',
    '',
    'Rules:',
    '- Only actionable items (a verb + a specific target). No vague themes, no praise, no summary.',
    '- Each item one line, starting with "- ". Prefer items the notes explicitly flag as unfinished,',
    '  broken, "still to do", "never chose", "verify", "decide".',
    '- Do NOT repeat anything already in the KNOWN-OPEN list below.',
    '- Max 25 items, most important first.',
    '',
    known ? `KNOWN-OPEN (do not repeat):\n${known}\n` : '',
    '--- THE NOTES ---',
    corpus,
    '--- END ---',
    '',
    'Output only the "- " bullet list.',
  ].filter(Boolean).join('\n');
}

export function parseTodos(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    // `[object Object]` is what a stringified object looks like; it passed every filter below
    // (length > 8, contains a letter, not a heading) and shipped as a real to-do item. Reject it and
    // its relatives explicitly — a second line of defence behind textOf().
    .filter((l) => !/^\[object \w+\]$/i.test(l) && l !== 'undefined' && l !== 'null' && l !== '[object Object]')
    .filter((l) => l.length > 8 && /[a-z]/i.test(l) && !/^#/.test(l))
    .map((l) => l.replace(/\s+/g, ' '));
}

// Drop items that closely echo something already open (token-overlap dedupe).
export function dedupe(todos, openItems = []) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  const openSets = openItems.map((o) => new Set(norm(o)));
  const out = [];
  const seen = [];
  for (const t of todos) {
    const ts = new Set(norm(t));
    const dupOpen = openSets.some((os) => overlap(ts, os) >= 0.6);
    const dupSelf = seen.some((ss) => overlap(ts, ss) >= 0.7);
    if (!dupOpen && !dupSelf) { out.push(t); seen.push(ts); }
  }
  return out;
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
}

/**
 * Harvest next-actions from the brain's annals.
 * @param {object} opts { annalsDir, briefsDir, openItems?, limit?, complete, fsmod? }
 * @returns {Promise<{ asOf, sources:string[], todos:string[], raw:string }>}
 */
export async function harvest(opts = {}) {
  const { complete, openItems = [], limit = 10 } = opts;
  const sources = pickSources({ ...opts, limit });
  if (!sources.length || typeof complete !== 'function') {
    return { asOf: new Date().toISOString(), sources: sources.map((s) => s.name), todos: [], raw: '' };
  }
  let raw = '';
  let llmError = '';
  try {
    const r = await complete(buildPrompt(sources, openItems), { task: 'quality' });
    raw = textOf(r);
    // The router reports its own failure in `error`; surface it instead of silently emitting an
    // empty (or worse, garbage) queue. A run that could not reach a model must SAY so.
    if (!raw) llmError = (r && typeof r === 'object' && r.error) ? String(r.error) : 'the ensemble returned no text';
  } catch (e) { raw = ''; llmError = e?.message || 'the ensemble threw'; }
  const todos = dedupe(parseTodos(raw), openItems);
  return { asOf: new Date().toISOString(), sources: sources.map((s) => s.name), todos, raw, llmError };
}

export function toMarkdown(result) {
  return [
    `# Harvested next-actions — ${result.asOf}`,
    `_Mined from the brain's own annals (${result.sources.length} sources) by the LLM ensemble; deduped against open items._`,
    '',
    ...(result.todos.length
      ? result.todos.map((t) => `- [ ] ${t}`)
      : [result.llmError
          ? `> **This run harvested nothing because the LLM ensemble was unreachable:** ${result.llmError}`
          + `\n> This is NOT "no work to do" — the queue below is simply unknown for this run.`
          : '_(nothing new surfaced this run)_']),
    '',
    `<sub>sources: ${result.sources.join(', ')}</sub>`,
  ].join('\n');
}

// handler(req,res) — JSON, given an injected harvest result via res.locals (tests) or a no-op shell.
export function handler(req, res, result = { asOf: new Date().toISOString(), sources: [], todos: [], raw: '' }) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(result, null, 2));
}

// helpers
function statMs(p, fsmod) { try { return fsmod.statSync(p).mtimeMs; } catch { return 0; } }
function read(p, fsmod) { try { return fsmod.readFileSync(p, 'utf8'); } catch { return ''; } }
function clip(s, n) { return s.length > n ? `${s.slice(0, n)}\n…[clipped]` : s; }

if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI: the brain's data dirs come from env (server paths never hard-coded in the repo — the box
  // invocation passes ANNALS_DIR / BRIEFS_DIR / TRACKER). Needs the live ensemble (llm-router).
  const annalsDir = process.env.ANNALS_DIR || '';
  const briefsDir = process.env.BRIEFS_DIR || '';
  const trackerPath = process.env.TRACKER || '';
  if (!annalsDir || !briefsDir) {
    console.error('[harvest] set ANNALS_DIR and BRIEFS_DIR (and optionally TRACKER, OUT, ROUTER).');
  } else {
    let openItems = [];
    try { openItems = (JSON.parse(fsDefault.readFileSync(trackerPath, 'utf8')).items || []).filter((i) => i.status === 'open').map((i) => i.text); } catch {}
    let complete;
    try { ({ complete } = await import(process.env.ROUTER || './llm-router.mjs')); } catch {}
    const result = await harvest({ annalsDir, briefsDir, openItems, complete });
    const out = process.env.OUT || `${briefsDir}/harvested-todos.md`;
    try { fsDefault.writeFileSync(out, toMarkdown(result)); } catch {}
    console.log(toMarkdown(result));
    console.error(`[harvest] ${result.todos.length} new items from ${result.sources.length} sources → ${out}`);
  }
}
