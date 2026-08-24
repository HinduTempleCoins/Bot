// governance-orchestrator.mjs — the in-repo governance runner (the "#176 self-fix loop").
//
// THE GAP THIS CLOSES (`.local/MASTER_ROLLUP_REVIEW.md` §2/§5): every stage of the
// checks-and-balances stack already EXISTS and is TESTED —
//
//   conversation-parser → mom-synth → mom-layer → brief-floor/brief-assembler → annal-harvester
//                                                                                   → ITINERARY writeback
//
// — but NOTHING runs them end-to-end. The artifacts are built; the loop is never closed, so ITINERARY.md
// drifts stale by hand and the MoM/brief/harvest pipeline has no caller. This module is that caller: it
// chains the existing stage modules in order, soft-failing PER STAGE (one broken stage never sinks the
// run), and produces:
//   • MoM        — deterministic meeting minutes (mom-synth floor) + a structured MoM record (mom-layer),
//   • BRIEFS     — the brief-writer view (mom-layer.forBriefWriter) + a full assembled brief (assembler),
//   • HARVEST    — not-yet-done next-actions mined from the brain's own annals (annal-harvester),
//   • WRITEBACK  — a dated, APPEND-ONLY itinerary delta *proposal* (never a rewrite).
//
// THE ITINERARY IS APPEND-ONLY. ITINERARY.md / MASTER_ITINERARY.md are never rewritten, never mutated,
// never re-ordered — the write-back only ever APPENDS a dated delta section at the end, and the append is
// GATED (deps.writeback === true) so a normal run only PROPOSES the delta. The append-only invariant is
// asserted in code: the pre-existing bytes must remain a verbatim prefix of the new file, or the write is
// refused. (BRIEF_PROTOCOL.md append-only invariant; memory: itinerary-never-remove.)
//
// CONVENTIONS (match the rest of integrations/):
//   • INJECTABLE STAGES — deps.modules = { conversationParser, momSynth, momLayer, briefAssembler,
//     annalHarvester } lets tests run fully OFFLINE with fakes; the default dynamically imports the real
//     modules (a missing module just soft-fails that stage).
//   • INJECTABLE fs / clock / store — deps.fs (readFileSync/writeFileSync), deps.now, deps.store.
//   • SOFT-FAIL, NEVER THROW — every stage is wrapped; a thrown/absent stage is recorded and the chain
//     continues with whatever resolved. Bad input → a valid empty result.
//   • esc() all interpolation; handler(req,res) exported for tests; CLI guarded behind process.argv[1].
//   • NO SECRETS, NO KEYS, READ-ONLY over the chain — it never signs or broadcasts anything.
//
//   import { runGovernanceLoop, buildItineraryDelta, appendItineraryDelta, handler }
//     from './governance-orchestrator.mjs';
//   const result = await runGovernanceLoop({ conversations: [...] });   // propose-only (no write)
//   await runGovernanceLoop({ conversations: [...] }, { writeback: true, itineraryPaths: [...] });
//
//   node integrations/governance-orchestrator.mjs   # run the loop on a built-in fixture, propose-only

import fsDefault from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── esc (house style — used for the HTML status view) ─────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const cleanStr = (x) => String(x == null ? '' : x).trim();
const asArray = (x) => (Array.isArray(x) ? x.filter((v) => v != null) : x == null ? [] : [x]);

// ── injectable clock ──────────────────────────────────────────────────────────────────────────────────
// deps.now may be a function → ms | number → ms; default Date.now(). We derive both an ISO string (for
// conversation-parser) and a numeric ms (for mom-layer) so every stage sees one consistent instant.
function resolveClock(deps = {}) {
  let ms;
  try {
    if (typeof deps.now === 'function') ms = +deps.now();
    else if (deps.now != null && Number.isFinite(+deps.now)) ms = +deps.now;
  } catch { /* fall through */ }
  if (!Number.isFinite(ms)) ms = Date.now();
  const iso = new Date(ms).toISOString();
  return { ms, iso, date: iso.slice(0, 10) };
}

// ── stage-module resolution (injectable, defensive import) ────────────────────────────────────────────
// Tests inject deps.modules with fakes. The default dynamically imports the real stage modules; a module
// that fails to import simply leaves that stage undefined → that stage soft-fails at run time.
async function resolveModules(deps = {}) {
  const injected = (deps.modules && typeof deps.modules === 'object') ? deps.modules : {};
  const want = {
    conversationParser: './conversation-parser.mjs',
    momSynth: './mom-synth.mjs',
    momLayer: './mom-layer.mjs',
    briefAssembler: './brief-assembler.mjs',
    annalHarvester: './annal-harvester.mjs',
  };
  const out = {};
  for (const [key, path] of Object.entries(want)) {
    // An explicitly-provided key wins AS-IS — even `null` (which disables that stage). Only a key that is
    // ABSENT from the injected map falls back to a defensive dynamic import.
    if (Object.prototype.hasOwnProperty.call(injected, key)) { out[key] = injected[key]; continue; }
    try { out[key] = await import(path); } catch { out[key] = null; }
  }
  return out;
}

// ── ask extraction: parsed conversations → mom-synth ask corpus ───────────────────────────────────────
/**
 * Flatten parsed conversations into the ask corpus mom-synth / mom-layer consume. Decisions, action
 * items, corrections (the operator's #1 standing complaint — kept as their OWN category) and open
 * questions all become asks, tagged by kind so the downstream classifier sections them correctly. Pure.
 * @param {Array<object>} parsedList  outputs of conversation-parser.parseConversation
 * @returns {Array<{text:string, owner?:string, kind:'decision'|'action'|'ask'}>}
 */
export function buildAsks(parsedList) {
  const asks = [];
  for (const p of asArray(parsedList)) {
    if (!p || typeof p !== 'object') continue;
    for (const d of asArray(p.decisions)) if (cleanStr(d?.text)) asks.push({ text: cleanStr(d.text), kind: 'decision' });
    for (const a of asArray(p.actionItems)) if (cleanStr(a?.text)) asks.push({ text: cleanStr(a.text), owner: cleanStr(a.from) || undefined, kind: 'action' });
    // corrections survive as action-tier asks, explicitly prefixed so they can never be lost in the pile.
    for (const c of asArray(p.corrections)) if (cleanStr(c?.text)) asks.push({ text: `Correction: ${cleanStr(c.text)}`, owner: cleanStr(c.from) || undefined, kind: 'action' });
    for (const q of asArray(p.openQuestions)) if (cleanStr(q?.text)) asks.push({ text: cleanStr(q.text), kind: 'ask' });
  }
  return asks;
}

// ── itinerary delta (append-only proposal body) ───────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function safeDate(d, fallback) {
  return (typeof d === 'string' && DATE_RE.test(d)) ? d : fallback;
}

/**
 * Build the dated APPEND-ONLY delta section proposed for the itineraries. This is text that gets APPENDED
 * at the end of an itinerary; it NEVER replaces or edits anything already in the file. Pure, never throws.
 * @param {{
 *   date?:string, minutesId?:string,
 *   decisions?:string[], actionItems?:Array<{text,owner?}>, corrections?:string[],
 *   openQuestions?:string[], harvestedTodos?:string[]
 * }} d
 * @returns {string} the delta markdown (a self-contained dated section)
 */
export function buildItineraryDelta(d = {}) {
  const date = safeDate(d.date, new Date().toISOString().slice(0, 10));
  const decisions = asArray(d.decisions).map(cleanStr).filter(Boolean);
  const actionItems = asArray(d.actionItems)
    .map((it) => (it && typeof it === 'object') ? { text: cleanStr(it.text), owner: cleanStr(it.owner) } : { text: cleanStr(it), owner: '' })
    .filter((it) => it.text);
  const corrections = asArray(d.corrections).map(cleanStr).filter(Boolean);
  const openQuestions = asArray(d.openQuestions).map(cleanStr).filter(Boolean);
  const todos = asArray(d.harvestedTodos).map(cleanStr).filter(Boolean);

  const L = [];
  L.push(`## 🤖 GOVERNANCE DELTA — ${date} (self-fix loop #176)`);
  L.push('');
  L.push('_Machine-appended by `governance-orchestrator.mjs` — APPEND-ONLY. Nothing above this line was'
    + ' edited. Items are proposals distilled from the latest conference minutes + annal harvest for'
    + ' operator review; they do not mark anything done._');
  if (d.minutesId) { L.push(''); L.push(`_Source minutes: \`${cleanStr(d.minutesId)}\`._`); }
  L.push('');

  L.push('### Decisions recorded');
  if (decisions.length) decisions.forEach((x) => L.push(`- ${x}`));
  else L.push('- _none this pass_');
  L.push('');

  L.push('### New action items (proposed)');
  if (actionItems.length) actionItems.forEach((it) => L.push(`- [ ] ${it.text}${it.owner ? ` _(owner: ${it.owner})_` : ''}`));
  else L.push('- _none this pass_');
  L.push('');

  if (corrections.length) {
    L.push('### Operator corrections / pushback');
    corrections.forEach((x) => L.push(`- ${x}`));
    L.push('');
  }

  L.push('### Harvested next-actions (from the brain\'s own annals)');
  if (todos.length) todos.forEach((x) => L.push(`- [ ] ${x}`));
  else L.push('- _nothing new surfaced this pass_');
  L.push('');

  if (openQuestions.length) {
    L.push('### Open questions');
    openQuestions.forEach((x) => L.push(`- ${x}`));
    L.push('');
  }

  L.push(`<sub>appended ${date} · self-fix loop (#176) · proposal only · append-only invariant enforced</sub>`);
  return L.join('\n');
}

// ── the APPEND-ONLY write-back ────────────────────────────────────────────────────────────────────────
/**
 * Append a delta section to each itinerary path — APPEND-ONLY and GATED.
 *
 * HARD INVARIANT: the existing file content is treated as immutable. The new content is exactly
 * `original + separator + delta`; we ASSERT the original is a verbatim prefix of the new content before
 * writing. If that ever fails, the write is refused (never a rewrite). When `gated` is false (the
 * default), NOTHING is written — the function returns the would-be result as a proposal (dryRun).
 *
 * Soft-fails PER PATH: a missing/unreadable file yields { wrote:false, error } for that path; the others
 * still process. Never throws.
 *
 * @param {{
 *   paths?: string[], delta?: string, gated?: boolean, fs?: object
 * }} opts   fs needs readFileSync + writeFileSync (existsSync optional); tests inject an in-memory fs.
 * @returns {{ gated:boolean, delta:string, results: Array<{path,wrote,appended?:number,error?:string,appendOnly?:boolean}> }}
 */
export function appendItineraryDelta({ paths, delta, gated = false, fs = fsDefault } = {}) {
  const list = asArray(paths).map(cleanStr).filter(Boolean);
  const body = cleanStr(delta);
  const results = [];

  for (const path of list) {
    try {
      let original = '';
      try { original = String(fs.readFileSync(path, 'utf8')); } catch (e) {
        results.push({ path, wrote: false, error: `unreadable: ${String(e && e.message || e)}` });
        continue;
      }
      const sep = original.length === 0 ? '' : (original.endsWith('\n') ? '\n' : '\n\n');
      const next = original + sep + body + '\n';

      // APPEND-ONLY ASSERTION: the pre-existing bytes MUST survive verbatim as a prefix. Refuse otherwise.
      const appendOnly = next.startsWith(original) && next.length >= original.length;
      if (!appendOnly) {
        results.push({ path, wrote: false, appendOnly: false, error: 'append-only assertion failed — write refused' });
        continue;
      }

      if (!gated) { results.push({ path, wrote: false, appendOnly: true, appended: next.length - original.length }); continue; }

      fs.writeFileSync(path, next);
      results.push({ path, wrote: true, appendOnly: true, appended: next.length - original.length });
    } catch (e) {
      results.push({ path, wrote: false, error: String(e && e.message || e) });
    }
  }

  return { gated: !!gated, delta: body, results };
}

// ── per-stage soft-fail wrapper ───────────────────────────────────────────────────────────────────────
async function runStage(name, stages, fn) {
  try {
    const value = await fn();
    stages[name] = { ok: true };
    return value;
  } catch (e) {
    stages[name] = { ok: false, error: String(e && e.message || e) };
    return undefined;
  }
}

// ── the runner ────────────────────────────────────────────────────────────────────────────────────────
/**
 * Run the governance loop end-to-end: parse conversations → mom-synth minutes → mom-layer record +
 * brief-writer view → assembled brief → annal harvest → itinerary write-back PROPOSAL. Every stage
 * soft-fails independently; the run always returns a valid result object.
 *
 * @param {{
 *   conversations?: Array<{source?:string, messages?:Array<{from,text,ts}>}>,
 *   conferenceId?: string, date?: string, topics?: string[], openItems?: string[],
 * }} input
 * @param {{
 *   modules?: object,          // { conversationParser, momSynth, momLayer, briefAssembler, annalHarvester }
 *   now?: (()=>number)|number, // injectable clock
 *   store?: object,            // minutes store (mom-layer.appendMinutes); default createMinutesStore()
 *   complete?: Function|null,  // LLM ensemble for annal-harvester; omit/null → deterministic floor only
 *   annalsDir?: string, briefsDir?: string,   // annal-harvester source dirs (off-repo; injected)
 *   writeback?: boolean,       // GATE: true actually appends to the itineraries; default false (propose)
 *   itineraryPaths?: string[], // files to append to (append-only); default none
 *   fs?: object,               // fs for the write-back (injectable)
 * }} [deps]
 * @returns {Promise<object>} { ok, at, stages, mom, brief, harvest, writeback, summary }
 */
export async function runGovernanceLoop(input = {}, deps = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const { ms, iso, date } = resolveClock(deps);
  const theDate = safeDate(src.date, date);
  const mods = await resolveModules(deps);
  const stages = {};
  const conferenceId = cleanStr(src.conferenceId) || `governance/${theDate}`;

  // ── Stage 1 — parse conversations (conversation-parser) ──
  const parsedList = await runStage('parse', stages, async () => {
    const cp = mods.conversationParser;
    if (!cp || typeof cp.parseConversation !== 'function') throw new Error('conversation-parser unavailable');
    return asArray(src.conversations).map((c) => cp.parseConversation(c || {}, { now: () => iso }));
  }) || [];

  const asks = buildAsks(parsedList);
  const participants = [...new Set(parsedList.flatMap((p) => asArray(p?.participants).map(cleanStr).filter(Boolean)))];
  const decisions = parsedList.flatMap((p) => asArray(p?.decisions).map((d) => cleanStr(d?.text)).filter(Boolean));
  const actionItems = parsedList.flatMap((p) => asArray(p?.actionItems).map((a) => ({ text: cleanStr(a?.text), owner: cleanStr(a?.from) })).filter((a) => a.text));
  const corrections = parsedList.flatMap((p) => asArray(p?.corrections).map((c) => cleanStr(c?.text)).filter(Boolean));
  const openQuestions = parsedList.flatMap((p) => asArray(p?.openQuestions).map((q) => cleanStr(q?.text)).filter(Boolean));

  // ── Stage 2 — deterministic meeting minutes (mom-synth floor) ──
  const minutesMarkdown = await runStage('momSynth', stages, async () => {
    const ms2 = mods.momSynth;
    if (!ms2 || typeof ms2.summarizeAsks !== 'function') throw new Error('mom-synth unavailable');
    // complete:null forces the deterministic floor — no model, no network. The runner never needs the LLM
    // for the minutes; a caller can wire polish separately.
    return await ms2.summarizeAsks(asks, { title: `Minutes — ${conferenceId}`, complete: null });
  }) || '';

  // ── Stage 3 — structured MoM record + brief-writer view (mom-layer) ──
  let momRecord, briefWriterView;
  await runStage('momLayer', stages, async () => {
    const ml = mods.momLayer;
    if (!ml || typeof ml.summarizeToMinutes !== 'function') throw new Error('mom-layer unavailable');
    momRecord = ml.summarizeToMinutes({
      conferenceId,
      attendees: participants,
      // notes are mined for extra action items / open questions; corrections ride in as "we need to" lines.
      notes: [...actionItems.map((a) => a.text), ...corrections.map((c) => `We need to address: ${c}`), ...openQuestions.map((q) => `Open question: ${q}`)].join('\n'),
      decisions,
      actionItems,
      topics: src.topics,
    }, { now: () => ms });
    // append-only minutes store (never rewrites)
    const store = (deps.store && typeof deps.store.append === 'function')
      ? deps.store
      : (typeof ml.createMinutesStore === 'function' ? ml.createMinutesStore() : null);
    if (store && typeof ml.appendMinutes === 'function') ml.appendMinutes(momRecord, { store });
    if (typeof ml.forBriefWriter === 'function') briefWriterView = ml.forBriefWriter(momRecord);
    return momRecord;
  });

  // ── Stage 4 — the assembled three-part brief (brief-floor / brief-assembler) ──
  const briefMarkdown = await runStage('brief', stages, async () => {
    const ba = mods.briefAssembler;
    if (!ba || typeof ba.assembleBrief !== 'function') throw new Error('brief-assembler unavailable');
    return await ba.assembleBrief({ date: theDate });
  }) || '';

  // ── Stage 5 — harvest not-yet-done next-actions from the annals (annal-harvester) ──
  const harvest = await runStage('harvest', stages, async () => {
    const ah = mods.annalHarvester;
    if (!ah || typeof ah.harvest !== 'function') throw new Error('annal-harvester unavailable');
    // Soft: with no dirs / no complete fn, harvest() returns { todos:[] } — the loop still closes.
    return await ah.harvest({
      annalsDir: cleanStr(deps.annalsDir),
      briefsDir: cleanStr(deps.briefsDir),
      openItems: asArray(src.openItems).map(cleanStr).filter(Boolean),
      complete: typeof deps.complete === 'function' ? deps.complete : undefined,
    });
  }) || { asOf: iso, sources: [], todos: [], raw: '' };

  // ── Stage 6 — the APPEND-ONLY itinerary write-back (GATED; propose by default) ──
  const delta = buildItineraryDelta({
    date: theDate,
    minutesId: momRecord && momRecord.id,
    decisions,
    actionItems,
    corrections,
    openQuestions,
    harvestedTodos: asArray(harvest.todos),
  });
  const writeback = await runStage('writeback', stages, async () => appendItineraryDelta({
    paths: asArray(deps.itineraryPaths),
    delta,
    gated: deps.writeback === true,
    fs: deps.fs || fsDefault,
  })) || { gated: false, delta, results: [] };

  const wroteCount = writeback.results.filter((r) => r.wrote).length;
  const summary = `governance loop @ ${theDate}: ${asks.length} ask(s), ${decisions.length} decision(s), `
    + `${actionItems.length} action item(s), ${corrections.length} correction(s), `
    + `${asArray(harvest.todos).length} harvested todo(s); write-back ${writeback.gated ? `${wroteCount} file(s) appended` : 'PROPOSED (not written)'}.`;

  return {
    ok: Object.values(stages).every((s) => s.ok),
    at: iso,
    conferenceId,
    date: theDate,
    stages,
    counts: {
      conversations: parsedList.length,
      asks: asks.length,
      decisions: decisions.length,
      actionItems: actionItems.length,
      corrections: corrections.length,
      openQuestions: openQuestions.length,
      harvestedTodos: asArray(harvest.todos).length,
    },
    mom: { minutesMarkdown, record: momRecord || null, briefWriterView: briefWriterView || null },
    brief: { markdown: briefMarkdown },
    harvest,
    writeback,
    summary,
  };
}

// ── HTTP handler ──────────────────────────────────────────────────────────────────────────────────────
/**
 * handler(req, res) — runs the loop (propose-only) and reports it. JSON by default; a tiny HTML status
 * view when the client asks for text/html. READ-ONLY: it never gates the write-back on (a network request
 * can only ever PROPOSE the delta). Soft-fails to a valid empty report. Tests may pass a pre-computed
 * `result` to avoid running the chain.
 *
 * @param {object} req
 * @param {object} res
 * @param {object} [result]  injected loop result (tests); when omitted the loop runs with defaults.
 */
export async function handler(req, res, result) {
  const send = (code, type, payload) => {
    if (res && typeof res.writeHead === 'function') res.writeHead(code, { 'Content-Type': type });
    if (res && typeof res.end === 'function') res.end(payload);
    return payload;
  };
  let out = result;
  if (!out) {
    try { out = await runGovernanceLoop({}, {}); }
    catch (e) { out = { ok: false, error: String(e && e.message || e), stages: {}, summary: 'loop failed' }; }
  }

  const accept = (req && req.headers && (req.headers.accept || req.headers.Accept)) || '';
  if (/text\/html/i.test(String(accept))) {
    const rows = Object.entries(out.stages || {})
      .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v && v.ok ? 'ok' : 'soft-fail'}</td><td>${esc(v && v.error || '')}</td></tr>`)
      .join('');
    const html = `<!doctype html><meta charset="utf-8"><title>Governance loop</title>`
      + `<h1>Governance loop (#176)</h1><p>${esc(out.summary || '')}</p>`
      + `<table border="1" cellpadding="4"><tr><th>stage</th><th>status</th><th>note</th></tr>${rows}</table>`;
    return send(200, 'text/html; charset=utf-8', html);
  }
  return send(200, 'application/json', JSON.stringify(out, null, 2));
}

export default { runGovernanceLoop, buildAsks, buildItineraryDelta, appendItineraryDelta, handler, esc };

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  // Offline fixture: a short operator↔bot conference. Propose-only — the CLI NEVER writes the itineraries
  // (the write-back is gated off here; wiring passes writeback:true + itineraryPaths on the box).
  const fixture = {
    conferenceId: 'governance/demo',
    conversations: [{
      source: 'telegram',
      messages: [
        { from: 'operator', text: "We'll go with the append-only itinerary write-back. Can you wire the runner? We need it on a timer.", ts: '2026-08-24T10:00:00Z' },
        { from: 'hathor', text: 'Agreed, append-only it is. I will chain the existing stages and soft-fail each one. Should we run it hourly?', ts: '2026-08-24T10:01:00Z' },
        { from: 'operator', text: "Don't rewrite the itinerary — only append a dated delta. That's important.", ts: '2026-08-24T10:02:00Z' },
      ],
    }],
    openItems: ['Wire the governance runner into a timer'],
  };
  const result = await runGovernanceLoop(fixture, { now: () => Date.parse('2026-08-24T10:05:00Z') });
  // eslint-disable-next-line no-console
  console.log(result.summary);
  // eslint-disable-next-line no-console
  console.log('\n--- MoM (deterministic floor) ---\n' + result.mom.minutesMarkdown);
  // eslint-disable-next-line no-console
  console.log('\n--- Proposed itinerary delta (NOT written) ---\n' + result.writeback.delta);
}
