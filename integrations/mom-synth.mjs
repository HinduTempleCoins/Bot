// mom-synth.mjs — task #66/#85. The meeting-minutes SYNTHESIZER, repo-native and done right.
//
// THE PROBLEM IT SOLVES (operator, durable ask): the 12-and-12 conference produces a pile of "asks"
// (free-text lines, decisions, action items). The brief-writers need real, structured MINUTES out of
// that pile — every pass, no exceptions. The old synth left a TEMPLATE behind when the model was down,
// which is exactly the "lame placeholder + call it done" failure the operator is furious about.
//
// THE FIX — two layers, the floor is ALWAYS real:
//   (1) DETERMINISTIC EXTRACTIVE SUMMARIZER — no model, ever. It ranks the asks by keyword salience
//       (Okapi BM25 IDF over the ask corpus, reusing integrations/bm25.mjs — NOT a hand-rolled cosine)
//       and SECTIONS each ask into ASKS / DECISIONS / ACTIONS by cue-phrase classification. This is the
//       FLOOR: it always produces real minutes from real input. summarizeAsks(asks) returns this when
//       no model is wired or the model adds nothing.
//   (2) OPTIONAL TINY-LLM POLISH — an injectable complete() (default: ollama qwen2.5:0.5b on
//       /api/generate, a tiny model that DOES work for a scoped task) gets a TIGHTLY SCOPED prompt:
//       "rewrite these exact minutes more cleanly, invent nothing." Its output REPLACES the
//       deterministic minutes ONLY if it comes back as substantive text (length + content gate);
//       otherwise the deterministic floor stands. The model can only ever IMPROVE — never erase.
//
// CONVENTIONS (match the rest of integrations/):
//   • DETERMINISTIC FLOOR — same asks → same minutes, no model, no network, no clock in the data path.
//   • INJECTABLE MODEL — __setComplete(fn) / opts.complete. Default builds an ollama caller over an
//     injectable fetch (__setFetch). Tests run with complete=null (floor) AND with an injected model.
//   • SOFT-FAIL, NEVER THROW — bad/empty input → a valid empty-minutes doc; a thrown/blank model → floor.
//   • CLI GUARDED behind the process.argv[1] check.
//   • NO SECRETS, NO KEYS, READ-ONLY over its inputs. Zero-WIF: this never signs or broadcasts anything.
//
//   import { summarizeAsks, extractiveMinutes, classifyAsk, rankAsks,
//            __setComplete, __setFetch } from './mom-synth.mjs'
//   const md = await summarizeAsks(asks);            // tiny-LLM polish if wired, else deterministic floor
//   const md = await summarizeAsks(asks, { complete: null });  // force the deterministic floor
//
//   node integrations/mom-synth.mjs                  # demo the floor on a sample ask set

import { buildIndex, score, tokenize } from './bm25.mjs';

const cleanStr = (x) => String(x == null ? '' : x).trim();
const asArray = (x) => (Array.isArray(x) ? x.filter((v) => v != null) : x == null ? [] : [x]);

// ── ask normalization ────────────────────────────────────────────────────────────────────────────
// An "ask" can arrive as a bare string OR as { text, owner?, kind? }. Normalize to { text, owner }.
// We also split a multi-line string ask into separate asks so a pasted block becomes individual lines.
function normalizeAsks(asks) {
  const out = [];
  for (const a of asArray(asks)) {
    if (typeof a === 'string') {
      for (const ln of a.split(/\r?\n/)) {
        const { text, owner } = parseOwnerPrefix(stripBullet(cleanStr(ln)));
        if (text) out.push({ text, owner, kind: null });
      }
    } else if (a && typeof a === 'object') {
      const stripped = stripBullet(cleanStr(a.text));
      const parsed = parseOwnerPrefix(stripped);
      const owner = cleanStr(a.owner) || parsed.owner;
      const text = owner === parsed.owner ? parsed.text : stripped; // explicit owner keeps full text
      if (text) out.push({ text, owner: owner || null, kind: cleanStr(a.kind) || null });
    }
  }
  // de-dup by lowercased text (keep first, which preserves any owner/kind given explicitly)
  const seen = new Set();
  return out.filter((a) => {
    const k = a.text.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const stripBullet = (s) => cleanStr(s).replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^\s*\[[ xX]\]\s*/, '');

// Pull an "owner: name — task" / "@name will task" prefix off the front of an ask line. Returns
// { text, owner }. owner is null when the line carries no owner prefix. Pure, never throws.
const OWNER_PREFIX_RE = /^owner\s*[:\-]\s*([^—:|\-]+?)\s*(?:[—:|\-]\s*)(.+)$/i;
const AT_OWNER_RE = /^@([a-z0-9_.\-]+)\s+(?:will|to|should|please)\b\s*(.+)$/i;
function parseOwnerPrefix(line) {
  const s = cleanStr(line);
  if (!s) return { text: '', owner: null };
  const own = s.match(OWNER_PREFIX_RE);
  if (own && cleanStr(own[2])) return { text: cleanStr(own[2]), owner: cleanStr(own[1]) };
  const at = s.match(AT_OWNER_RE);
  if (at && cleanStr(at[2])) return { text: cleanStr(at[2]), owner: cleanStr(at[1]) };
  return { text: s, owner: null };
}

// ── classification: ASK / DECISION / ACTION ─────────────────────────────────────────────────────
// Cue-phrase classifier. A line is a DECISION if it records a settled choice ("we decided", "agreed",
// "will use X over Y", "going with"); an ACTION if it is a thing-to-do (imperative verb, "TODO:",
// "we will build", owner-prefixed task); otherwise an ASK (a request / question / topic raised).
// Precedence: explicit kind on the object > DECISION cues > ACTION cues > ASK (default).
const DECISION_RE = /\b(?:decided|agreed|resolved|conclusion|we'?ll go with|going with|chose|choosing|settled on|consensus|approved|the\s+decision\s+is)\b/i;
const ACTION_VERBS = [
  'build', 'add', 'fix', 'ship', 'write', 'wire', 'create', 'remove', 'update', 'deploy',
  'review', 'test', 'check', 'verify', 'draft', 'send', 'investigate', 'document', 'refactor',
  'migrate', 'implement', 'merge', 'rebase', 'schedule', 'contact', 'confirm', 'follow', 'plan',
  'stand up', 'set up', 'port', 'finish', 'audit', 'harden', 'sweep', 'launch',
  'summarize', 'summarise', 'prepare', 'design', 'enable', 'disable', 'rotate', 'publish',
];
const ACTION_VERB_RE = new RegExp(`^(?:${ACTION_VERBS.join('|')})\\b`, 'i');
const ACTION_CUE_RE = /\b(?:todo|action item|we\s+(?:will|should|need\s+to|must|have\s+to)|let'?s|next\s+steps?)\b/i;
const QUESTION_CUE_RE = /\b(?:open\s+question|question|unresolved|tbd|should\s+we|can\s+we|how\s+do\s+we)\b|\?\s*$/i;

/**
 * Classify a single ask into 'decision' | 'action' | 'ask'. Pure, never throws.
 * @param {string|{text:string,kind?:string}} ask
 * @returns {'decision'|'action'|'ask'}
 */
export function classifyAsk(ask) {
  const obj = (ask && typeof ask === 'object') ? ask : { text: cleanStr(ask) };
  const explicit = cleanStr(obj.kind).toLowerCase();
  if (explicit === 'decision' || explicit === 'action' || explicit === 'ask') return explicit;

  const text = cleanStr(obj.text);
  if (!text) return 'ask';
  if (DECISION_RE.test(text)) return 'decision';

  const bare = text.replace(/^\s*(?:owner|@)\s*[:\-]?\s*[^—:|]+(?:[—:|]\s*)/i, ''); // drop "owner: x —"
  if (ACTION_VERB_RE.test(bare) || ACTION_CUE_RE.test(text)) {
    // a question-shaped action ("should we build X?") is an ask, not an action.
    if (QUESTION_CUE_RE.test(text) && !/\b(?:todo|action item|we\s+will|let'?s)\b/i.test(text)) return 'ask';
    return 'action';
  }
  return 'ask';
}

// ── salience ranking (BM25 IDF over the ask corpus) ────────────────────────────────────────────────
// We rank asks by how much "salient content" they carry. Salience = the sum of BM25 IDF weights of the
// distinct terms in the ask, scored against the corpus of ALL asks. Rare-but-repeated subject terms
// (the real headlines of the meeting) float up; boilerplate that appears in every line sinks. This is
// the published lexical signal (bm25.mjs), NOT a hand-rolled cosine. Ties break by original order
// (stable) so the output is deterministic.
//
// We score each ask-as-query against an index of all asks: an ask whose terms are distinctive across
// the corpus accumulates more BM25 mass. We then add a small length-normalized floor so a one-word ask
// isn't penalized into oblivion.

/**
 * Rank normalized asks by keyword salience (BM25 over the ask corpus). Pure, deterministic, never throws.
 * @param {Array<{text:string}>} normAsks  output of normalizeAsks
 * @returns {Array<{ask:object, salience:number, order:number}>} sorted desc by salience, stable on ties
 */
export function rankAsks(normAsks) {
  const list = asArray(normAsks).filter((a) => a && cleanStr(a.text));
  if (!list.length) return [];
  // index every ask as its own doc, id = its position.
  const docs = list.map((a, i) => ({ id: i, text: a.text }));
  const index = buildIndex(docs);
  const ranked = list.map((ask, order) => {
    // self-scoring an ask against the corpus rewards distinctive terms in THIS ask.
    const rows = score(index, ask.text);
    const self = rows.find((r) => r.id === order);
    const base = self ? self.score : 0;
    // length floor: a short, content-bearing ask still ranks (avoid 0 for single distinctive tokens).
    const nTerms = new Set(tokenize(ask.text)).size;
    const salience = base + nTerms * 0.001;
    return { ask, salience, order };
  });
  ranked.sort((a, b) => b.salience - a.salience || a.order - b.order);
  return ranked;
}

// ── the DETERMINISTIC extractive minutes (the FLOOR — always real) ─────────────────────────────────
const sectionLabel = { decision: 'Decisions', action: 'Action items', ask: 'Asks raised' };

/**
 * Build real, structured minutes from asks with NO model. This is the floor: it always produces
 * substantive minutes from substantive input. Sections by classifyAsk, orders within each section by
 * BM25 salience (most salient first). Pure, deterministic, never throws.
 * @param {Array<string|object>} asks
 * @param {{title?:string}} [opts]
 * @returns {string} markdown
 */
export function extractiveMinutes(asks, { title } = {}) {
  const norm = normalizeAsks(asks);
  const ranked = rankAsks(norm); // [{ask, salience, order}] desc by salience

  // bucket by classification, preserving salience order within each bucket.
  const buckets = { decision: [], action: [], ask: [] };
  for (const { ask } of ranked) {
    const kind = classifyAsk(ask);
    buckets[kind].push(ask);
  }

  const L = [];
  L.push(`# ${cleanStr(title) || 'Meeting minutes'}`);
  L.push('');

  if (!ranked.length) {
    L.push('_No asks were raised this session._');
    L.push('');
    L.push('*Distilled minutes (deterministic floor) · no transcript · brief-writers read this layer.*');
    return L.join('\n');
  }

  // a one-line plain summary up top: counts + the single most-salient ask as the headline.
  const headline = ranked[0].ask.text;
  const counts = [
    buckets.decision.length && `${buckets.decision.length} decision${buckets.decision.length === 1 ? '' : 's'}`,
    buckets.action.length && `${buckets.action.length} action item${buckets.action.length === 1 ? '' : 's'}`,
    buckets.ask.length && `${buckets.ask.length} ask${buckets.ask.length === 1 ? '' : 's'}`,
  ].filter(Boolean).join(', ');
  L.push(`**Summary:** ${counts || 'no items'}. Top item: ${headline}`);
  L.push('');

  for (const kind of ['decision', 'action', 'ask']) {
    const items = buckets[kind];
    if (!items.length) continue;
    L.push(`## ${sectionLabel[kind]}`);
    for (const it of items) {
      const owner = it.owner ? ` _(owner: ${it.owner})_` : '';
      const box = kind === 'action' ? '[ ] ' : '';
      L.push(`- ${box}${it.text}${owner}`);
    }
    L.push('');
  }

  L.push('*Distilled minutes (deterministic floor) · no transcript · brief-writers read this layer.*');
  return L.join('\n');
}

// ── injectable tiny-LLM polish ─────────────────────────────────────────────────────────────────────
// complete(prompt, opts) => string | { text } | { response }. Default: ollama /api/generate with
// qwen2.5:0.5b — a tiny model that works fine for the SCOPED task of tidying prose it is handed verbatim.
let _complete = null;   // injected polish fn (null → use default ollama, which no-ops offline)
let _fetch = null;      // injected fetch for the default ollama caller (tests pass a fake)

/** Inject the polish model. fn(prompt, opts)=>string|{text}|{response}. null restores the default. */
export function __setComplete(fn) { _complete = typeof fn === 'function' ? fn : null; }
/** Inject fetch for the default ollama caller. null restores globalThis.fetch. */
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : null; }

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.MOM_SYNTH_MODEL || 'qwen2.5:0.5b';

// default polish caller: POST /api/generate to a local ollama. Soft-fails to '' on ANY error (no model,
// no network, bad JSON) so the deterministic floor always stands. Never throws.
async function defaultComplete(prompt) {
  const f = _fetch || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (typeof f !== 'function') return '';
  try {
    const res = await f(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 700 },
      }),
    });
    if (!res || typeof res.json !== 'function' || res.ok === false) return '';
    const data = await res.json();
    return cleanStr(data?.response || data?.text || '');
  } catch {
    return '';
  }
}

// coerce whatever a polish fn returns into a string. Never throws.
function coercePolish(out) {
  if (out == null) return '';
  if (typeof out === 'string') return cleanStr(out);
  if (typeof out === 'object') return cleanStr(out.text || out.response || out.output || '');
  return '';
}

// the TIGHTLY SCOPED prompt: hand the model the EXACT deterministic minutes and ask only for a cleaner
// rewrite — invent nothing, keep every item, keep the markdown headings. Scoping is what makes a tiny
// 0.5B model usable here: it is editing handed-in text, not generating from scratch.
function polishPrompt(deterministicMd) {
  return [
    'You are a minute-taker. Below are DRAFT meeting minutes in markdown.',
    'Rewrite them more cleanly and concisely. STRICT RULES:',
    '- Do NOT invent any item, decision, action, owner, or fact that is not already present.',
    '- Keep every distinct item from the draft. Do not drop anything.',
    '- Keep the markdown structure: a top heading, a Summary line, and ## sections.',
    '- Output ONLY the rewritten markdown. No preamble, no commentary, no code fences.',
    '',
    '--- DRAFT MINUTES ---',
    deterministicMd,
    '--- END DRAFT ---',
  ].join('\n');
}

// Gate: does the model output substantively REPLACE the floor, or should we keep the floor?
// A polish is accepted only if it is real markdown minutes of comparable substance: it must be long
// enough, contain a heading, and not be a refusal/echo of the prompt. This is the "never leave a
// template, never let the model erase real minutes" guard.
function polishIsSubstantive(polished, deterministicMd) {
  const p = cleanStr(polished);
  if (!p) return false;
  // must look like minutes: have a markdown heading.
  if (!/^#{1,3}\s+\S/m.test(p)) return false;
  // refusal / non-answer detection.
  if (/\b(?:i\s+cannot|i\s+can't|i\s+am\s+unable|as\s+an\s+ai|i'?m\s+sorry|cannot\s+help)\b/i.test(p)) return false;
  // must not have collapsed to a stub: at least 60% of the floor's length and at least 40 chars.
  if (p.length < 40) return false;
  if (p.length < deterministicMd.length * 0.6) return false;
  // must not be a verbatim echo of the prompt scaffolding.
  if (p.includes('--- DRAFT MINUTES ---') || p.includes('--- END DRAFT ---')) return false;
  return true;
}

// ── the public entry point ───────────────────────────────────────────────────────────────────────
/**
 * summarizeAsks(asks) -> minutesMarkdown.
 * Always returns real minutes:
 *   1. builds the DETERMINISTIC extractive minutes (the floor — never a template).
 *   2. if a polish model is wired (injected, or default ollama reachable), hands it the EXACT floor with
 *      a tightly-scoped "tidy, invent nothing" prompt; the polished text REPLACES the floor ONLY when it
 *      passes the substantive-content gate. Otherwise the floor stands.
 * Soft-fails: a thrown/blank/refusing model never breaks the minutes — the floor is returned.
 *
 * @param {Array<string|{text:string,owner?:string,kind?:string}>} asks
 * @param {{ title?:string, complete?:((prompt:string,opts?:object)=>any)|null }} [opts]
 *        opts.complete === null  → force the deterministic floor (skip the model entirely).
 *        opts.complete = fn      → use fn as the polish model for THIS call.
 *        omitted                 → use the module-injected _complete, else the default ollama caller.
 * @returns {Promise<string>} minutes markdown
 */
export async function summarizeAsks(asks, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const floor = extractiveMinutes(asks, { title: o.title });

  // empty input: the floor is the "no asks" doc; never bother the model.
  if (normalizeAsks(asks).length === 0) return floor;

  // resolve the polish fn. Explicit null disables polish. Explicit fn wins. Else module injection, else
  // the default ollama caller (which soft-fails to '' offline → floor stands).
  let completeFn;
  if (Object.prototype.hasOwnProperty.call(o, 'complete')) {
    if (o.complete === null) return floor;            // caller forced the deterministic floor
    completeFn = typeof o.complete === 'function' ? o.complete : null;
  } else {
    completeFn = _complete; // module-injected, or null → default
  }

  let polished = '';
  try {
    const prompt = polishPrompt(floor);
    if (completeFn) polished = coercePolish(await completeFn(prompt, { task: 'mom-synth-polish', temperature: 0.2 }));
    else polished = coercePolish(await defaultComplete(prompt));
  } catch {
    polished = ''; // a thrown model → keep the floor.
  }

  return polishIsSubstantive(polished, floor) ? polished : floor;
}

export default {
  summarizeAsks,
  extractiveMinutes,
  classifyAsk,
  rankAsks,
  __setComplete,
  __setFetch,
};

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('mom-synth.mjs')) {
  const sample = [
    'We decided to wire the MoM synth into the brief pipeline.',
    'Build the deterministic extractive summarizer first, then the tiny-LLM polish.',
    'owner: Qwen — summarize the 12-and-12 conference to minutes nightly',
    'Should we let brief-writers see attendee attribution?',
    'TODO: add the BM25 salience ranking so the headlines float up.',
    'Agreed: the deterministic floor must always produce real minutes, never a template.',
    'Investigate the failed melek-mom.service on Server 4.',
  ];
  // CLI forces the deterministic floor (no network in the demo).
  // eslint-disable-next-line no-console
  console.log(await summarizeAsks(sample, { title: '12-and-12 — sample', complete: null }));
}
