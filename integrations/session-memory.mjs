// session-memory.mjs — the working memory that survives a session, a rebuild, and a model change.
//
// THE PROBLEM THIS SOLVES. Today the loop is broken at both ends: brain-capture.sh ships verbatim
// transcripts to the box, nothing distills them, and SESSION_MEMORY.md — the file the SessionStart
// hook actually reads — is hand-maintained, so it goes stale. A new session therefore starts blind
// and re-derives what was already settled, or worse, contradicts it.
//
// THE LOOP THIS CLOSES:
//   transcript (.jsonl, verbatim)  →  parseTurns    — what was actually said
//                                  →  extractFacts  — the durable part: decisions, directives, outcomes
//                                  →  mergeMemory   — accumulate across sessions, newest wins, deduped
//                                  →  renderMemory  — the SESSION_MEMORY.md the orient hook already reads
//                                  →  recall        — pull the relevant few back on demand
//
// DETERMINISTIC FLOOR, OPTIONAL MODEL. extractFacts works with no LLM at all — it is pattern + role
// based, so memory keeps accruing when every model is down or unpaid. An LLM refiner can be injected
// to improve phrasing; it can never be required, and its failure is soft.
//
// WHAT COUNTS AS DURABLE. Not chat. A fact earns a place only if a later session would be wrong
// without it: an operator decision or correction, a stated constraint, a verified outcome, an open
// blocker. Pleasantries, restatements and narration are dropped on purpose — an index that keeps
// everything is one nobody can read.
//
// House style: ESM, all IO injected, soft-fail-never-throw, esc() all interpolation, handler(req,res)
// exported for tests, CLI guarded by process.argv[1], PORT env. No keys, no chain, no network.
//
//   import { parseTurns, extractFacts, mergeMemory, renderMemory, recall } from './session-memory.mjs';

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8178);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_FACTS = Number(process.env.SESSION_MEMORY_MAX || 300);

export const KINDS = ['decision', 'directive', 'constraint', 'outcome', 'blocker'];

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parse a Claude Code transcript (.jsonl) into ordered turns.
 * Tolerates partial lines, tool rows, thinking blocks and unknown shapes — a transcript being written
 * to while we read it must not throw.
 *
 * @param {string} jsonl
 * @returns {Array<{i:number, role:string, text:string}>}
 */
export function parseTurns(jsonl) {
  const out = [];
  const lines = String(jsonl || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }   // a half-written final line is normal
    const m = (o && o.message) || {};
    const role = m.role || o.role || '';
    if (role !== 'user' && role !== 'assistant') continue;
    const c = m.content;
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) {
      text = c.filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text).join(' ');
    }
    text = text.trim();
    if (!text) continue;                                  // tool-only / thinking-only rows carry no memory
    if (text.startsWith('[Request interrupted')) continue;
    out.push({ i, role, text });
  }
  return out;
}

// An operator line that changes what a later session should do. Ordered: first match wins.
const DIRECTIVE = /\b(?:don'?t|do not|never|always|make sure|you need to|i need you to|stop|instead of|from now on)\b/i;
const CORRECTION = /\b(?:that'?s not|not what|wrong|you are not allowed|no[,.]|actually|i did give|it should be)\b/i;
const CONSTRAINT = /\b(?:not (?:in|somewhere) (?:a )?(?:repo|public)|only|must|has to|can'?t|cannot|without)\b/i;
const BLOCKER = /\b(?:blocked|denied|cannot|can'?t get|unreachable|down|failing|broken|locked out)\b/i;
const OUTCOME = /\b(?:verified|confirmed|shipped|landed|works|working|passed|banned|closed|fixed|live)\b/i;

function classify(turn) {
  const t = turn.text;
  if (turn.role === 'user') {
    if (CORRECTION.test(t)) return 'decision';            // a correction is the strongest signal there is
    if (DIRECTIVE.test(t)) return 'directive';
    if (CONSTRAINT.test(t)) return 'constraint';
    return '';                                            // ordinary asks are not durable
  }
  if (BLOCKER.test(t)) return 'blocker';
  if (OUTCOME.test(t)) return 'outcome';
  return '';
}

function firstSentences(text, n = 2) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const parts = clean.split(/(?<=[.!?])\s+/).slice(0, n).join(' ');
  return (parts || clean).slice(0, 400);
}

function keyOf(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * The durable part of a session. Deterministic; an injected `refine` may rewrite a fact's text but
 * can never add, drop or reorder facts — so a model outage degrades phrasing, never content.
 *
 * @param {Array} turns          from parseTurns()
 * @param {object} opts { session?, at?, refine?, kinds? }
 * @returns {Promise<Array<{kind,text,role,session,at,key}>>}
 */
export async function extractFacts(turns, opts = {}) {
  const session = opts.session || '';
  const at = opts.at ?? Date.now();
  const allow = new Set(opts.kinds || KINDS);
  const facts = [];
  const seen = new Set();
  for (const turn of turns || []) {
    const kind = classify(turn);
    if (!kind || !allow.has(kind)) continue;
    const text = firstSentences(turn.text);
    const key = keyOf(text);
    if (!key || seen.has(key)) continue;                  // a repeated instruction is one fact
    seen.add(key);
    facts.push({ kind, text, role: turn.role, session, at, key });
  }
  if (typeof opts.refine === 'function' && facts.length) {
    try {
      const refined = await opts.refine(facts.map((f) => f.text));
      if (Array.isArray(refined) && refined.length === facts.length) {
        refined.forEach((r, i) => { if (typeof r === 'string' && r.trim()) facts[i].text = r.trim().slice(0, 400); });
      }
    } catch { /* soft — phrasing is a luxury, the fact is the point */ }
  }
  return facts;
}

/**
 * Accumulate across sessions. Newest statement of the same fact wins (people change their minds, and
 * memory that cannot be corrected is worse than none). Capped newest-first so the file stays readable.
 */
export function mergeMemory(existing = [], incoming = [], opts = {}) {
  const max = opts.max ?? MAX_FACTS;
  const byKey = new Map();
  for (const f of [...(existing || []), ...(incoming || [])]) {
    if (!f || !f.key) continue;
    const prev = byKey.get(f.key);
    if (!prev || (f.at ?? 0) >= (prev.at ?? 0)) byKey.set(f.key, { ...f });
  }
  return [...byKey.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, max);
}

const HEADINGS = {
  decision: 'Decisions and corrections (these override defaults)',
  directive: 'Standing directives',
  constraint: 'Constraints',
  blocker: 'Open blockers',
  outcome: 'Verified outcomes',
};

/**
 * Render to the SESSION_MEMORY.md the SessionStart hook already reads. Markdown, not HTML — but every
 * interpolation is still escaped, because a transcript is untrusted text.
 */
export function renderMemory(facts = [], opts = {}) {
  const at = new Date(opts.at ?? Date.now()).toISOString();
  const lines = [
    '# MELEK SESSION MEMORY — generated, do not hand-edit',
    '',
    `_Distilled from session transcripts at ${esc(at)}. ${facts.length} fact(s)._`,
    '',
  ];
  for (const kind of ['decision', 'directive', 'constraint', 'blocker', 'outcome']) {
    const of = facts.filter((f) => f.kind === kind);
    if (!of.length) continue;
    lines.push(`## ${HEADINGS[kind]}`, '');
    for (const f of of) {
      const when = f.at ? new Date(f.at).toISOString().slice(0, 10) : '';
      lines.push(`- ${esc(f.text)}${when ? ` _(${esc(when)})_` : ''}`);
    }
    lines.push('');
  }
  if (!facts.length) lines.push('_No durable facts recorded yet._', '');
  return lines.join('\n');
}

/**
 * Pull back the few facts that bear on a question. Deterministic scoring (term overlap, weighted by
 * kind and recency) so recall works with no embedder; pass `embedRecall` to delegate to the vector
 * store in memory/index.mjs when one is available.
 */
export async function recall(query, facts = [], opts = {}) {
  const k = opts.k ?? 5;
  if (typeof opts.embedRecall === 'function') {
    try {
      const hits = await opts.embedRecall(query, { k });
      if (Array.isArray(hits) && hits.length) return hits.slice(0, k);
    } catch { /* soft — fall through to the deterministic floor */ }
  }
  const terms = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!terms.length) return facts.slice(0, k);
  const weight = { decision: 1.5, directive: 1.4, constraint: 1.3, blocker: 1.2, outcome: 1 };
  const now = opts.now ?? Date.now();
  const scored = (facts || []).map((f) => {
    const hay = String(f.text || '').toLowerCase();
    let hits = 0;
    for (const t of terms) if (hay.includes(t)) hits++;
    const ageDays = Math.max(0, (now - (f.at ?? now)) / 86_400_000);
    const recency = 1 / (1 + ageDays / 30);
    return { ...f, score: hits * (weight[f.kind] || 1) * (0.5 + recency) };
  }).filter((f) => f.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

/** One call: transcript text in, merged memory + rendered file out. */
export async function ingestTranscript(jsonl, opts = {}) {
  const turns = parseTurns(jsonl);
  const facts = await extractFacts(turns, opts);
  const merged = mergeMemory(opts.existing || [], facts, opts);
  return { turns: turns.length, facts, memory: merged, markdown: renderMemory(merged, opts) };
}

export function createServer(cfg = {}) {
  const store = cfg.store || { facts: [] };
  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  async function handler(req, res) {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, facts: store.facts.length });
      if (url.pathname === '/recall') {
        const hits = await recall(url.searchParams.get('q') || '', store.facts, { k: 5 });
        return json(res, 200, { ok: true, hits });
      }
      return json(res, 404, { ok: false, error: 'not found' });
    } catch {
      return json(res, 200, { ok: false, error: 'soft' });
    }
  }
  return { handler, store };
}

export const handler = (req, res) => createServer().handler(req, res);

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  http.createServer(handler).listen(PORT, HOST, () => console.log(`[session-memory] ${HOST}:${PORT}`));
}
