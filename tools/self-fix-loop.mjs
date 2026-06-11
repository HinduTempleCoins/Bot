// self-fix-loop.mjs — the annals→briefs→itinerary self-correction loop runner.
//
// The governance design (melek-brain-governance-design) lays out the artifacts:
//   - Annals  = fallible BACKWARD records of what actually EXISTS / was done.
//   - Briefs  = FORWARD plans of what to do / what's missing / what's broken.
//   - Itinerary = the ranked backlog (what we still intend to build).
// The artifacts exist, but nothing reconciles them. This is that reconciler.
//
// nextCorrection({ annals, briefs, itinerary }) compares what the annals say EXISTS
// against what the briefs/itinerary CLAIM, and emits a ranked list of corrections:
//   - 'stale'     : itinerary/brief still lists a subject as to-do, but an annal records it done.
//   - 'missing'   : a brief/itinerary names a subject with no annal recording it exists → still owed.
//   - 'untracked' : an annal records a subject that no brief/itinerary tracks → record it.
//
//   import { nextCorrection, __setReader } from './tools/self-fix-loop.mjs'
//   node tools/self-fix-loop.mjs                      # uses injected/empty reader
//
// Inputs are plain arrays/strings — the caller/CLI supplies them via __setReader().
// Each item may be a string or an object { subject|name|title, done?, status?, text? }.
// Pure / offline: no network, no fs reads unless a reader is injected. Soft-fail: bad
// input -> { corrections: [], note } and never throws.

// --- injectable IO seam: caller/CLI supplies the three artifact sets -------
// A reader returns { annals, briefs, itinerary } (any may be omitted). Default: empty.
let _read = () => ({ annals: [], briefs: [], itinerary: [] });
export function __setReader(fn) {
  _read = typeof fn === 'function' ? fn : () => ({ annals: [], briefs: [], itinerary: [] });
}

// --- HTML-escape for safe CLI/report interpolation -------------------------
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// normalize a subject for matching: lowercase, collapse whitespace/punctuation.
function normSubject(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// stop-words ignored when matching a short claim label against a descriptive annal sentence.
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'is', 'on', 'for', 'in', 'done',
  'shipped', 'complete', 'completed', 'built', 'added', 'live']);

// content tokens of a subject, stop-words removed.
function tokensOf(key) {
  return key.split(' ').filter(t => t && !STOP.has(t));
}

// a claim matches an annal when every content token of the (shorter) claim label appears in
// the annal's content tokens — annals are descriptive sentences, claims are terse labels.
function claimMatchesAnnal(claimToks, annalToks) {
  if (!claimToks.length || !annalToks.length) return false;
  const set = new Set(annalToks);
  return claimToks.every(t => set.has(t));
}

// pull a human subject + a normalized key + done-ness out of a string|object item.
function asItem(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const subject = raw.trim();
    if (!subject) return null;
    const key = normSubject(subject);
    return { subject, key, toks: tokensOf(key), done: false, text: subject };
  }
  if (typeof raw === 'object') {
    const subject = String(raw.subject ?? raw.name ?? raw.title ?? '').trim();
    if (!subject) return null;
    const status = String(raw.status ?? '').toLowerCase();
    const done = raw.done === true || status === 'done' || status === 'complete' ||
      status === 'completed' || status === 'shipped';
    const text = String(raw.text ?? subject);
    const key = normSubject(subject);
    return { subject, key, toks: tokensOf(key), done, text };
  }
  return null;
}

function toItems(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const raw of arr) { const it = asItem(raw); if (it && it.key) out.push(it); }
  return out;
}

// Rank weights: stale (we're claiming work that's already done — actively misleading) is the
// highest-value correction, then untracked (a real thing nobody is tracking), then missing
// (a claim with no evidence yet — could just be genuinely not-done-yet, lowest urgency).
const KIND_RANK = { stale: 0, untracked: 1, missing: 2 };

// Compare annals (what EXISTS) vs briefs+itinerary (what's CLAIMED) → ranked corrections.
export function nextCorrection(input = {}) {
  let src = input;
  // Allow nextCorrection() with no args to fall back to the injected reader.
  if (!input || (input.annals === undefined && input.briefs === undefined && input.itinerary === undefined)) {
    try { src = _read() || {}; } catch { src = {}; }
  }

  const annals = toItems(src.annals);
  const briefs = toItems(src.briefs);
  const itinerary = toItems(src.itinerary);

  // the union of forward-looking claims (briefs + itinerary), de-duped by key with provenance.
  const claims = new Map(); // key -> { subject, toks, done, sources:Set }
  for (const [label, list] of [['itinerary', itinerary], ['brief', briefs]]) {
    for (const it of list) {
      const prev = claims.get(it.key);
      if (prev) { prev.sources.add(label); prev.done = prev.done || it.done; }
      else claims.set(it.key, { subject: it.subject, toks: it.toks, done: it.done, sources: new Set([label]) });
    }
  }

  // track which annals get matched by a claim, so the leftovers are 'untracked'.
  const matchedAnnals = new Set();

  const corrections = [];

  // 1) stale + missing: walk every forward claim, token-subset-matching it against annals.
  for (const [, claim] of claims) {
    const sources = [...claim.sources].sort();
    let exists = false;
    for (let i = 0; i < annals.length; i++) {
      if (claimMatchesAnnal(claim.toks, annals[i].toks)) { exists = true; matchedAnnals.add(i); }
    }
    if (exists && !claim.done) {
      // an annal records this done, but a brief/itinerary still carries it as to-do.
      corrections.push({
        kind: 'stale',
        subject: claim.subject,
        suggestion: `Annals record "${claim.subject}" as done — mark it complete / remove it from ${sources.join(' + ')}.`,
        sources,
      });
    } else if (!exists && !claim.done) {
      // claimed/planned but no annal evidence it exists yet — still genuinely owed.
      corrections.push({
        kind: 'missing',
        subject: claim.subject,
        suggestion: `"${claim.subject}" is tracked in ${sources.join(' + ')} but no annal records it — still owed / verify status.`,
        sources,
      });
    }
    // exists && done  → already reconciled; nothing to emit.
    // !exists && done → claim says done but no annal; treat as missing evidence below? handled as 'missing' only when !done. A done-claim with no annal is left alone (the claim is the record).
  }

  // 2) untracked: annal subjects no forward claim matched → record them.
  for (let i = 0; i < annals.length; i++) {
    if (!matchedAnnals.has(i)) {
      const a = annals[i];
      corrections.push({
        kind: 'untracked',
        subject: a.subject,
        suggestion: `Annals record "${a.subject}" but no brief/itinerary tracks it — add it to the itinerary / a brief.`,
        sources: ['annal'],
      });
    }
  }

  // rank: by kind weight, then stable-ish by subject for determinism.
  corrections.sort((x, y) => {
    const dk = (KIND_RANK[x.kind] ?? 9) - (KIND_RANK[y.kind] ?? 9);
    if (dk) return dk;
    return x.subject.localeCompare(y.subject);
  });

  const counts = { stale: 0, missing: 0, untracked: 0 };
  for (const c of corrections) counts[c.kind]++;

  return {
    corrections,
    counts,
    totals: { annals: annals.length, briefs: briefs.length, itinerary: itinerary.length },
    note: corrections.length
      ? `${corrections.length} correction(s): ${counts.stale} stale, ${counts.missing} missing, ${counts.untracked} untracked.`
      : 'No corrections — annals, briefs, and itinerary are reconciled.',
  };
}

// --- HTML report (esc-safe) for an operator-facing surface ----------------
export function renderReport(result) {
  const r = result && Array.isArray(result.corrections) ? result : { corrections: [], note: '' };
  const rows = r.corrections.map(c =>
    `<li class="${esc(c.kind)}"><strong>${esc(c.kind)}</strong>: ${esc(c.subject)}` +
    `<br><span class="sug">${esc(c.suggestion)}</span></li>`
  ).join('\n');
  return `<section class="self-fix-loop">
<h2>Self-correction loop</h2>
<p>${esc(r.note)}</p>
<ul>${rows ? '\n' + rows + '\n' : ''}</ul>
</section>`;
}

// --- CLI -------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('self-fix-loop.mjs')) {
  const result = nextCorrection(); // pulls from the injected reader (empty by default)
  console.log(`Self-correction loop — ${result.note}`);
  console.log(`(annals ${result.totals.annals}, briefs ${result.totals.briefs}, itinerary ${result.totals.itinerary})`);
  console.log('─'.repeat(64));
  if (!result.corrections.length) {
    console.log('  nothing to reconcile.');
  } else {
    let i = 1;
    for (const c of result.corrections) {
      console.log(`  ${String(i++).padStart(2)}. [${c.kind}] ${c.subject}`);
      console.log(`      ${c.suggestion}`);
    }
  }
}
