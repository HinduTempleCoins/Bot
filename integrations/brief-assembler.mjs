// brief-assembler.mjs — task #63. The ONE assembler that composes a complete three-part brief from
// every brief-ready section the rest of the stack already produces, so the 24/7 pipeline emits a single
// coherent document instead of four loose blocks the writers have to stitch by hand.
//
// The flow this sits at the end of:
//   diagnostics-pipeline.mjs   (engineBlock)  — "what the market is saying vs doing" → suggested moves
//   factcheck-brief-bridge.mjs (warningsBlock) — open KB fact-check flags (advisory, never a correction)
//   he-ingest.mjs              (briefNotes)   — HIVE-Engine token movement vs the previous snapshot
//   discord-ingest.mjs         (briefNotes)   — what the community is saying (themes / mood / volume)
//      → assembleBrief()  — composes ## FOR RYAN (plain English, no jargon) + the detailed sections,
//                           in the three-part brief shape (FOR RYAN / FOR CLAUDE CODE / details).
//
// CONVENTIONS (match the rest of integrations/):
//   • DEFENSIVE imports — each section source is imported dynamically; a missing module is just an
//     omitted section, never a crash.
//   • SOFT-FAIL PER SECTION — a thrown/empty section is dropped; the brief still renders with whatever
//     resolved. One broken source can't sink the brief.
//   • INJECTABLE — __setSections({ diagnostics, factcheck, tokens, community }) lets tests run fully
//     OFFLINE with canned section strings. Pass null to restore the live (defensive-import) sources.
//   • FRONT-END FIRST — the "## FOR RYAN" summary at the TOP is plain real-world English: no file paths,
//     no '.mjs', no 'src/', no code-speak. It is the translation layer the operator reads first.
//   • NO SECRETS, NO KEYS, READ-ONLY — it only reads the sections the other modules already produced.
//
//   import { assembleBrief, forRyanSummary, sectionsAvailable, __setSections } from './brief-assembler.mjs'
//   await assembleBrief({ date: '2026-06-03' });   // full markdown brief string
//
//   node integrations/brief-assembler.mjs          # print today's assembled brief

// ── the four section sources ──────────────────────────────────────────────────────────────────────
// Each source is an async fn → a markdown string (the section's own engineBlock/briefNotes output) or
// '' when it has nothing. The DEFAULT for each defensively imports the producing module and calls its
// brief-ready entry point, soft-failing to '' so an absent/broken module simply drops out of the brief.

/** diagnostics-pipeline → "### Diagnostics" markdown. Soft-fail → ''. */
async function defaultDiagnostics() {
  try {
    const mod = await import('./diagnostics-pipeline.mjs');
    if (typeof mod?.engineBlock === 'function') return (await mod.engineBlock()) || '';
    if (typeof mod?.renderMarkdown === 'function' && typeof mod?.diagnostics === 'function') {
      return mod.renderMarkdown(await mod.diagnostics()) || '';
    }
    return '';
  } catch { return ''; }
}

/** factcheck-brief-bridge → "### Fact-check warnings" markdown. Soft-fail → ''. */
async function defaultFactcheck() {
  try {
    const mod = await import('./factcheck-brief-bridge.mjs');
    if (typeof mod?.engineBlock === 'function') return (await mod.engineBlock()) || '';
    if (typeof mod?.warningsBlock === 'function') return (await mod.warningsBlock()) || '';
    return '';
  } catch { return ''; }
}

/** he-ingest → "### Token movement" markdown. Soft-fail → ''. Live needs a prev→curr comparison; with
 *  no stored baseline ingest() yields [] (nothing to compare) and briefNotes renders the empty-state. */
async function defaultTokens() {
  try {
    const mod = await import('./he-ingest.mjs');
    if (typeof mod?.briefNotes !== 'function' || typeof mod?.ingest !== 'function') return '';
    const list = typeof mod.watchlist === 'function' ? mod.watchlist() : [];
    const movements = await mod.ingest(list, {});
    return mod.briefNotes(movements) || '';
  } catch { return ''; }
}

/** discord-ingest → "### Community (Discord)" markdown. Soft-fail → ''. Without a channel id /
 *  injected client there's nothing to pull, so this yields the module's empty-state note. */
async function defaultCommunity() {
  try {
    const mod = await import('./discord-ingest.mjs');
    if (typeof mod?.briefNotes !== 'function' || typeof mod?.summarizeChannel !== 'function') return '';
    const channelId = (process.env.DISCORD_BRIEF_CHANNEL || '').trim();
    let msgs = [];
    if (channelId && typeof mod.fetchHistory === 'function') {
      try { msgs = await mod.fetchHistory(channelId, { limit: 100 }); } catch { msgs = []; }
    }
    return mod.briefNotes(mod.summarizeChannel(msgs)) || '';
  } catch { return ''; }
}

/** arb scanners → "### Strategies (suggestions only)" markdown. Soft-fail → ''. This is the operator's
 *  ask: surface the money opportunities (size, venue, fee-net %, round-trip steps) INTO the brief.
 *  cross-venue-arb.engineBlock() already renders a fee-honest, depth-aware, advisory table; we prepend
 *  a hard SUGGESTION-ONLY banner and (best-effort) the all-scanner count from arb-facade. The dollar
 *  size is fee/depth-aware (never a raw price gap), and the scanners' own sanity guards (#23) stay on.
 *  NOTHING here signs, executes, or sizes a live order — it is reading material for a human. */
async function defaultStrategies() {
  try {
    const cv = await import('./cross-venue-arb.mjs');
    if (typeof cv?.engineBlock !== 'function') return '';
    const table = (await cv.engineBlock()) || '';
    if (!table.trim()) return '';
    // engineBlock ALWAYS returns prose (even its empty-state). Only surface a Strategies section when
    // there is an ACTUAL actionable opportunity — otherwise the brief would carry an empty section
    // every pass. The empty-states say "No round trip clears…", "scan skipped", or "No HIVE price".
    if (/no round trip clears|scan skipped|no hive price/i.test(table)) return '';
    let countLine = '';
    try {
      const fac = await import('./arb-facade.mjs');
      if (typeof fac?.scanAllArb === 'function') {
        const r = await fac.scanAllArb();
        const n = Array.isArray(r?.opportunities) ? r.opportunities.length : (Array.isArray(r) ? r.length : (r?.count ?? null));
        if (n != null) countLine = `\n_All-scanner sweep: ${n} candidate opportunit${n === 1 ? 'y' : 'ies'} across HE / cross-venue / cross-exchange / cross-chain this pass._`;
      }
    } catch { /* facade optional */ }
    const banner = '### Strategies (SUGGESTIONS ONLY)\n\n'
      + '> **Nobody has placed any of these.** They are read-only suggestions. This host holds no chain '
      + 'key (zero-WIF); execution is signer-gated and manual. Dollar sizes are fee- and depth-aware '
      + '(what is actually tradeable), NOT raw price gaps. Act only on a US-legal venue you control.\n';
    // engineBlock starts with its own "### Cross-venue arbitrage" heading; keep it under our banner.
    return `${banner}${countLine}\n\n${table}`.trim();
  } catch { return ''; }
}

const DEFAULTS = {
  strategies: defaultStrategies,
  diagnostics: defaultDiagnostics,
  factcheck: defaultFactcheck,
  tokens: defaultTokens,
  community: defaultCommunity,
};

let _sections = { ...DEFAULTS };

/**
 * Inject section sources for tests / alternate wiring. Pass a partial map; unset keys keep their
 * current source. Pass null (or {}) to restore ALL defaults.
 * Each value is an async/sync fn → markdown string (or '').
 */
export function __setSections(map) {
  if (!map || typeof map !== 'object') { _sections = { ...DEFAULTS }; return; }
  _sections = { ..._sections, ...map };
}

// ── per-section resolution (soft-fail isolation) ───────────────────────────────────────────────────
// pull ONE section: call its source, coerce to a trimmed string, soft-fail to '' on any throw. One
// broken source can never propagate past this boundary.
async function pull(key) {
  const fn = _sections[key] || DEFAULTS[key];
  if (typeof fn !== 'function') return '';
  try {
    const out = await fn();
    return typeof out === 'string' ? out.trim() : '';
  } catch {
    return ''; // a thrown section is omitted, never breaks the brief.
  }
}

/** Resolve all four sections in parallel, each isolated. Returns { diagnostics, factcheck, tokens, community }. */
async function resolveSections() {
  const keys = ['strategies', 'diagnostics', 'factcheck', 'tokens', 'community'];
  const vals = await Promise.all(keys.map((k) => pull(k)));
  const out = {};
  keys.forEach((k, i) => { out[k] = vals[i]; });
  return out;
}

/**
 * Which sections resolved to non-empty content (for diagnostics / logging). Pure given resolved
 * sections, or resolves them itself when called with no arg.
 * @param {{diagnostics?:string,factcheck?:string,tokens?:string,community?:string}} [sections]
 * @returns {Promise<{diagnostics:boolean,factcheck:boolean,tokens:boolean,community:boolean}>}
 */
export async function sectionsAvailable(sections) {
  const s = sections || (await resolveSections());
  return {
    strategies: !!(s.strategies && s.strategies.trim()),
    diagnostics: !!(s.diagnostics && s.diagnostics.trim()),
    factcheck: !!(s.factcheck && s.factcheck.trim()),
    tokens: !!(s.tokens && s.tokens.trim()),
    community: !!(s.community && s.community.trim()),
  };
}

// ── the FOR RYAN translation layer ─────────────────────────────────────────────────────────────────
// Plain real-world English. NO file paths, NO module names, NO '.mjs' / 'src/' / code-speak. This is
// the operator-facing summary — what each section MEANS, not where it came from. We derive a one-line
// takeaway per available section from light, jargon-free signal sniffing of the rendered markdown.

// strip markdown noise to plain words for sniffing (lowercased). Never exposes paths because we only
// match against keyword presence, never echo the source text into FOR RYAN.
const plainText = (md) => String(md || '').replace(/[#*_`>-]/g, ' ').replace(/\s+/g, ' ').toLowerCase();

function ryanLineForStrategies(md) {
  const t = plainText(md);
  if (t.includes('no round trip clears') || t.includes('scan skipped')) return null; // nothing clean → don't surface
  if (t.includes('clear the fee stack') || t.includes('best round trip')) {
    return 'There are money opportunities that clear ALL the fees right now — see Strategies below for the size, the venue, and the round-trip steps. Important: nobody has placed these, they are suggestions only, and you would act on them yourself on a US exchange.';
  }
  return null;
}

function ryanLineForDiagnostics(md) {
  const t = plainText(md);
  if (t.includes('divergence')) {
    return 'The market read is mixed right now — what people are saying and what prices are doing point different ways, so the patient move is to wait for them to line up.';
  }
  if (t.includes('confluence')) {
    return 'The market read is aligned right now — the news mood and the price action agree, which is the higher-conviction kind of setup.';
  }
  return 'There is a fresh market read this pass — a plain look at what people are saying versus what prices are actually doing. It is a reading aid only; nothing here places a trade.';
}

function ryanLineForTokens(md) {
  const t = plainText(md);
  if (t.includes('no token movement')) return null; // nothing worth surfacing to the operator
  if (t.includes('notable move')) {
    return 'One or more of our tokens made a notable move since the last check — worth a glance below.';
  }
  return 'Token prices moved a little since the last check — small moves, nothing dramatic.';
}

function ryanLineForFactcheck(md) {
  const t = plainText(md);
  if (t.includes('no open fact-check flags')) return null; // good news, but not worth a top-line
  return 'A few statements in the knowledge library are flagged for a second look — these are questions for a human, not settled corrections, and false alarms are expected.';
}

function ryanLineForCommunity(md) {
  const t = plainText(md);
  if (t.includes('no recent messages')) return null;
  let mood = 'mixed';
  if (t.includes('positive')) mood = 'upbeat';
  else if (t.includes('negative')) mood = 'down';
  return `The community has been talking; the overall mood reads ${mood}. A short summary of what they are discussing is below.`;
}

/**
 * The plain-English top summary derived from the resolved sections — the translation layer the operator
 * reads first. NO jargon, NO file paths. Always returns a non-empty plain-English paragraph (a clean
 * "quiet pass" line when nothing notable resolved).
 * @param {{diagnostics?:string,factcheck?:string,tokens?:string,community?:string}} sections
 * @returns {string}
 */
export function forRyanSummary(sections) {
  const s = sections || {};
  const lines = [];
  if (s.strategies) { const l = ryanLineForStrategies(s.strategies); if (l) lines.push(l); } // money first
  if (s.diagnostics) { const l = ryanLineForDiagnostics(s.diagnostics); if (l) lines.push(l); }
  if (s.tokens) { const l = ryanLineForTokens(s.tokens); if (l) lines.push(l); }
  if (s.community) { const l = ryanLineForCommunity(s.community); if (l) lines.push(l); }
  if (s.factcheck) { const l = ryanLineForFactcheck(s.factcheck); if (l) lines.push(l); }

  if (!lines.length) {
    return 'Quiet pass — nothing notable from the market read, our tokens, the community chat, or the library checks. Details below if you want them.';
  }
  return lines.join(' ');
}

// ── the assembled brief ────────────────────────────────────────────────────────────────────────────
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function safeDate(d) {
  if (typeof d === 'string' && DATE_RE.test(d)) return d;
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compose a complete three-part brief from all brief-ready sections.
 *
 * Shape:
 *   # MELEK Brief — <date>
 *   ## FOR RYAN        ← plain English, no jargon, FIRST (the translation layer)
 *   ## FOR CLAUDE CODE ← which sections resolved + how to read them
 *   ## Details         ← the detailed rendered sections (diagnostics / fact-check / tokens / community)
 *
 * Each section soft-fails independently — a missing/erroring one is omitted, the brief still renders.
 *
 * @param {{date?:string}} [meta]
 * @param {{sections?:object}} [opts]   opts.sections overrides the injected sources for THIS call
 * @returns {Promise<string>} the brief markdown
 */
export async function assembleBrief({ date } = {}, opts = {}) {
  // allow a per-call section override without disturbing the module-level injection.
  let sections;
  if (opts && opts.sections && typeof opts.sections === 'object') {
    const saved = _sections;
    _sections = { ..._sections, ...opts.sections };
    try { sections = await resolveSections(); } finally { _sections = saved; }
  } else {
    sections = await resolveSections();
  }

  const d = safeDate(date);
  const avail = await sectionsAvailable(sections);
  const present = Object.entries(avail).filter(([, v]) => v).map(([k]) => k);

  const L = [];
  L.push(`# MELEK Brief — ${d}`);
  L.push('');

  // ── FOR RYAN (plain English, first) ──
  L.push('## FOR RYAN');
  L.push('');
  L.push(forRyanSummary(sections));
  L.push('');

  // ── FOR CLAUDE CODE ──
  L.push('## FOR CLAUDE CODE');
  L.push('');
  if (present.length) {
    L.push(`Assembled brief for ${d}. Resolved sections: ${present.join(', ')}. Each section below is`
      + ' produced read-only by its own ingest module and spliced verbatim; nothing here executes,'
      + ' signs, or touches funds. Missing sections soft-failed and are omitted.');
  } else {
    L.push(`Assembled brief for ${d}. No sections resolved this pass (all sources were empty or`
      + ' unavailable). This is a clean empty brief, not an error.');
  }
  L.push('');

  // ── Details (the rendered sections) ──
  L.push('## Details');
  L.push('');
  const order = ['strategies', 'diagnostics', 'factcheck', 'tokens', 'community'];
  const rendered = order.map((k) => sections[k]).filter((x) => x && x.trim());
  if (rendered.length) {
    L.push(rendered.join('\n\n'));
  } else {
    L.push('_No detailed sections available this pass._');
  }
  L.push('');
  L.push('*Assembled read-only from the ingest modules · advisory only · no keys, no orders.*');

  return L.join('\n');
}

export default { assembleBrief, forRyanSummary, sectionsAvailable, __setSections };

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('brief-assembler.mjs')) {
  const dateArg = process.argv.find((a) => DATE_RE.test(a));
  // eslint-disable-next-line no-console
  console.log(await assembleBrief({ date: dateArg }));
}
