// flag-taxonomy.mjs — the UNIFIED harm taxonomy that wires every "traditional social-media harm"
// into the ONE moderation pipeline that already exists (integrations/moderation-flags.mjs).
//
// WHY THIS EXISTS
//   The repo already has the pieces real platforms struggle with — plagiarism/image-credit (Cheetah),
//   spam/rate-limit + RC (spamtest), toxicity/harassment (moderation-adapter), misinformation
//   (Ashurbanipal fact-checker) — and ONE append-only flag store + review queue (moderation-flags).
//   What it did NOT have is a single map that says, for each harm category: which DETECTOR finds it,
//   how severe it is, what the DEFAULT ACTION is per POLICY.md (credit-first note / queue-for-review /
//   refuse-service+preserve-evidence / human+counsel), and whether it's GATED (CSAM → PhotoDNA/NCMEC +
//   counsel, never auto-handled). This module is that map, plus classify() (run the deterministic
//   detectors over a content object) and route() (land every finding in the ONE store/queue).
//
// POLICY (POLICY.md / cheetah/policing.md — load-bearing)
//   • A finding is NEVER an auto-ban. Actions are: credit-first note, queue-for-review,
//     refuse-service + preserve-evidence + report (the §6 illegal-content path), or — for gated
//     categories — escalate to a human / counsel. We do not run an auto-ban system (POLICY.md §1).
//   • Credit-first, escalate-last: attribution matches surface a crediting note, not an accusation
//     (POLICY.md §4). Escalation is for repeated, evidenced patterns.
//   • GATED categories (CSAM above all) are flagged for human/counsel and are NEVER auto-actioned —
//     no model-based classifier, no auto-report. The taxonomy records the requirement; the live
//     PhotoDNA/NCMEC pipeline is built elsewhere and is not invoked here (cheetah/policing.md).
//
// DESIGN
//   • Pure-ish + offline. The deterministic detectors (plagiarism similarity, spam flood, toxicity
//     lexicon, and built-in heuristics for scam/PII/impersonation/hate/sybil/copyright) run with NO
//     network. The keyed/hosted ones (web-search plagiarism, Detoxify, fact-checker verification,
//     image decode) simply yield NO finding when unavailable — soft-fail, never throw.
//   • Everything is INJECTABLE for tests: pass your own `detectors` map and your own `store`
//     (a moderation store from createModerationStore). Nothing is opened or fetched on its own.
//
//   import { classify, route, TAXONOMY } from '../integrations/flag-taxonomy.mjs';
//   const findings = await classify({ author: '@bob', permlink: 'p', body: '…', images: [] });
//   const entries  = await route(findings, { store, content });   // → lands in moderation-flags' queue

import { createModerationStore } from './moderation-flags.mjs';

// esc() — HTML-escape any value we interpolate into evidence text that may be rendered in the queue UI.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const cap = (s, n = 500) => { const x = String(s ?? ''); return x.length > n ? x.slice(0, n) : x; };
const clamp01 = (n) => { const x = Number(n); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0; };

// ── DEFAULT ACTIONS (POLICY.md) ─────────────────────────────────────────────────────────────────
// The vocabulary of what we DO with a finding. None of these is "ban".
export const ACTIONS = Object.freeze({
  CREDIT_NOTE: 'credit-first-note',     // friendly "this also appears here: [link]" — never an accusation
  QUEUE_REVIEW: 'queue-for-review',     // lands in the moderation queue for a human / Hathor's resolution flow
  REFUSE_REPORT: 'refuse-service+preserve-evidence+report', // POLICY.md §6 illegal-content path
  HUMAN_COUNSEL: 'escalate-human+counsel', // gated categories — never auto-actioned
});

// The status we open a report with. Gated/illegal land OPEN too (a human owns them) — we NEVER
// auto-set 'actioned'. route() only ever appends OPEN reports; resolution is a separate human step.
function openStatusFor() { return 'open'; }

// ── THE TAXONOMY ─────────────────────────────────────────────────────────────────────────────────
// Each category: key, label, severity (1=lightest .. 5=most serious), the detector it maps to
// (module path + exported function name, as STRINGS for legibility/auditing — the live function is
// injected via the `detectors` map), the default action, and `gated` (true ⇒ never auto-handled).
// `reportKind` maps onto moderation-flags REPORT_KINDS so the existing queue/UI groups it sensibly.
export const TAXONOMY = Object.freeze([
  {
    key: 'plagiarism', label: 'Plagiarism / uncredited text reuse', severity: 2,
    detector: { module: 'cheetah/text-detection.js', fn: 'detectText' },
    action: ACTIONS.CREDIT_NOTE, gated: false, reportKind: 'other',
    note: 'Credit-first: state "this text also appears here", never "this is plagiarized" (POLICY.md §4).',
  },
  {
    key: 'image-theft', label: 'Image reuse without credit', severity: 2,
    detector: { module: 'cheetah/perceptual-hash.js', fn: 'findOriginal' },
    action: ACTIONS.CREDIT_NOTE, gated: false, reportKind: 'other',
    note: 'Credit the earliest poster of the image; detection is imperfect, correction is built in (POLICY.md §4).',
  },
  {
    key: 'spam', label: 'Spam / flooding', severity: 2,
    detector: { module: 'spamtest/limits.mjs', fn: 'simulateSpam' },
    action: ACTIONS.QUEUE_REVIEW, gated: false, reportKind: 'spam',
    note: 'Rate-limit + RC throttle the flood at the boundary; persistent spam is queued, not banned.',
  },
  {
    key: 'scam-fraud', label: 'Scam / phishing / drainer / fake-airdrop', severity: 4,
    detector: { module: 'integrations/flag-taxonomy.mjs', fn: 'detectScamHeuristic' },
    action: ACTIONS.QUEUE_REVIEW, gated: false, reportKind: 'scam',
    note: 'Phishing links, seed-phrase requests, fake giveaways are live threats (SECURITY.md §3) — queue for review.',
  },
  {
    key: 'harassment-toxicity', label: 'Harassment / toxicity / threats', severity: 3,
    detector: { module: 'integrations/moderation-adapter.mjs', fn: 'moderate' },
    action: ACTIONS.QUEUE_REVIEW, gated: false, reportKind: 'abuse',
    note: 'Advisory toxicity score (Detoxify or lexicon floor) — a flag for review, never an auto-block.',
  },
  {
    key: 'hate', label: 'Hate / identity attack', severity: 4,
    detector: { module: 'integrations/moderation-adapter.mjs', fn: 'moderate' },
    action: ACTIONS.QUEUE_REVIEW, gated: false, reportKind: 'abuse',
    note: 'Identity-attack signal from the same scorer; higher severity. Reviewed by a human, not auto-removed.',
  },
  {
    key: 'impersonation', label: 'Impersonation of Witness / staff / accounts', severity: 3,
    detector: { module: 'integrations/flag-taxonomy.mjs', fn: 'detectImpersonationHeuristic' },
    action: ACTIONS.QUEUE_REVIEW, gated: false, reportKind: 'impersonation',
    note: 'Impersonating Hathor/platform staff is out of bounds (POLICY.md §2). Heuristic flag → human verify.',
  },
  {
    key: 'misinformation', label: 'Misinformation / unverifiable factual claims', severity: 2,
    detector: { module: 'library-of-ashurbanipal-bot/src/factChecker/index.js', fn: 'checkArticle' },
    action: ACTIONS.QUEUE_REVIEW, gated: false, reportKind: 'other',
    note: 'Fact-checker FLAGS only, never edits or removes (NEVER edit data records). Needs grounding sources; '
        + 'yields no finding offline. Lawful-but-wrong is not removed — it is annotated/queued.',
  },
  {
    key: 'doxxing-pii', label: 'Doxxing / posting others\' private info', severity: 4,
    detector: { module: 'integrations/flag-taxonomy.mjs', fn: 'detectPiiHeuristic' },
    action: ACTIONS.QUEUE_REVIEW, gated: false, reportKind: 'abuse',
    note: 'Detect PII patterns (SSN/phone/email/address cues). Posting others\' private info is a violation (POLICY.md §2).',
  },
  {
    key: 'csam', label: 'Child sexual abuse material (CSAM)', severity: 5,
    detector: { module: 'cheetah/policing/csam-hash-match.js', fn: 'matchKnownBad' },
    action: ACTIONS.HUMAN_COUNSEL, gated: true, reportKind: 'illegal',
    note: 'GATED. PhotoDNA/NCMEC perceptual-hash ONLY — no model classifier. Refuse-service + preserve-evidence + '
        + 'CyberTipline report is the §6 path; NEVER auto-handled here. Requires counsel + access agreement (cheetah/policing.md).',
  },
  {
    key: 'bot-sybil', label: 'Bot / sybil / coordinated inauthentic behavior', severity: 2,
    detector: { module: 'integrations/flag-taxonomy.mjs', fn: 'detectSybilHeuristic' },
    action: ACTIONS.QUEUE_REVIEW, gated: false, reportKind: 'spam',
    note: 'Proof-of-human gate + rate-limits are the front line; this flags suspected automation for review.',
  },
  {
    key: 'copyright-dmca', label: 'Copyright / DMCA claim', severity: 3,
    detector: { module: 'integrations/flag-taxonomy.mjs', fn: 'detectCopyrightHeuristic' },
    action: ACTIONS.QUEUE_REVIEW, gated: true, reportKind: 'illegal',
    note: 'GATED on process: a DMCA notice is a legal claim with a counter-notice path — routed to a human, '
        + 'never auto-actioned. The three-bucket copyright model governs hosting (Library tasks).',
  },
]);

/** Look up one category descriptor by key. */
export function categoryFor(key) {
  return TAXONOMY.find((c) => c.key === key) || null;
}

// ── built-in DETERMINISTIC heuristics (keyless, offline, soft-fail) ───────────────────────────────
// These cover the categories with no dedicated module yet. They are intentionally conservative
// pattern matchers that produce a {hit, confidence, evidence} shape — flags for review, never verdicts.

const URL_RE = /\bhttps?:\/\/[^\s)]+/i;
const SCAM_PHRASES = [
  /\bseed phrase\b/i, /\bprivate key\b/i, /\bsend (?:me )?(?:your )?(?:wallet|keys?|seed)\b/i,
  /\b(?:free )?airdrop\b/i, /\bdouble your (?:crypto|coins?|money|eth|btc)\b/i,
  /\bconnect (?:your )?wallet to claim\b/i, /\bguaranteed (?:returns?|profit)\b/i,
  /\bverify your wallet\b/i, /\bclaim (?:your )?(?:reward|prize|giveaway)\b/i,
  /\bdm me to (?:invest|earn|claim)\b/i,
];

/** Scam/fraud heuristic: phishing/seed-request phrasing + presence of a link raises confidence. */
export function detectScamHeuristic(content = {}) {
  const body = String(content.body || '');
  const hits = SCAM_PHRASES.filter((re) => re.test(body)).map((re) => re.source);
  if (!hits.length) return { hit: false };
  const hasLink = URL_RE.test(body);
  const confidence = clamp01(0.4 + hits.length * 0.2 + (hasLink ? 0.2 : 0));
  return { hit: true, confidence, evidence: `scam cues: ${hits.slice(0, 4).join(', ')}${hasLink ? ' (+link)' : ''}` };
}

const IMPERSONATION_NAMES = ['hathor', 'cheetah', 'melek staff', 'melek admin', 'platform staff', 'support team', 'official melek'];
/** Impersonation heuristic: claims to BE Hathor/staff while author isn't the protected account. */
export function detectImpersonationHeuristic(content = {}) {
  const body = String(content.body || '').toLowerCase();
  const author = String(content.author || '').replace(/^@/, '').toLowerCase();
  const claims = IMPERSONATION_NAMES.filter((n) =>
    new RegExp(`\\bi am (?:the )?(?:official )?${n.replace(/\s+/g, '\\s+')}\\b`, 'i').test(body)
    || new RegExp(`\\bthis is (?:the )?(?:official )?${n.replace(/\s+/g, '\\s+')}\\b`, 'i').test(body));
  // If the author literally IS hathor/cheetah, "this is hathor" is not impersonation.
  const real = author === 'hathor' || author === 'cheetah';
  if (!claims.length || real) return { hit: false };
  return { hit: true, confidence: 0.5, evidence: `claims identity: ${claims.join(', ')} (author @${esc(author)})` };
}

const PII_PATTERNS = [
  { name: 'SSN', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'phone', re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
  { name: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/ },
  { name: 'credit-card', re: /\b(?:\d[ -]?){13,16}\b/ },
  { name: 'street-address', re: /\b\d{1,5}\s+[A-Za-z][A-Za-z .]+\s+(?:st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive)\b/i },
];
/** Doxxing/PII heuristic: presence of structured personal-identifier patterns. */
export function detectPiiHeuristic(content = {}) {
  const body = String(content.body || '');
  const found = PII_PATTERNS.filter((p) => p.re.test(body)).map((p) => p.name);
  if (!found.length) return { hit: false };
  // Two+ distinct PII types together (e.g. a name + phone + address) is the doxxing shape.
  const confidence = clamp01(0.3 + found.length * 0.2);
  return { hit: true, confidence, evidence: `PII patterns: ${found.join(', ')}` };
}

/** Sybil/bot heuristic: a content object carrying signals of automation (set by the caller). */
export function detectSybilHeuristic(content = {}) {
  const signals = [];
  if (content.proofOfHuman === false) signals.push('failed proof-of-human');
  if (Number(content.duplicateCount) >= 3) signals.push(`${content.duplicateCount} near-identical posts`);
  if (Number(content.accountAgeMinutes) >= 0 && Number(content.accountAgeMinutes) < 5 && Number(content.opsInWindow) >= 5) {
    signals.push('brand-new account with op burst');
  }
  if (!signals.length) return { hit: false };
  const confidence = clamp01(0.3 + signals.length * 0.2);
  return { hit: true, confidence, evidence: `sybil signals: ${signals.join('; ')}` };
}

/** Copyright/DMCA heuristic: an explicit DMCA/copyright claim in the content/context. */
export function detectCopyrightHeuristic(content = {}) {
  const hay = `${content.body || ''} ${content.claimText || ''}`;
  if (!/\b(dmca|copyright (?:claim|infringement|notice)|takedown notice|©)\b/i.test(hay)) return { hit: false };
  return { hit: true, confidence: 0.5, evidence: 'DMCA/copyright claim language present (legal process — route to human)' };
}

// ── finding factory ────────────────────────────────────────────────────────────────────────────
export function makeFinding(category, { confidence = 0.5, evidence = '' } = {}) {
  return {
    category: category.key,
    severity: category.severity,
    confidence: clamp01(confidence),
    evidence: cap(evidence),
    action: category.action,
    gated: !!category.gated,
  };
}

// ── default detector map ──────────────────────────────────────────────────────────────────────────
// Maps each category key → an async (content) => finding|null. Tests inject their own to control which
// detectors are "present". Production wires the real modules in (lazy, soft-fail).
// A detector that is ABSENT (undefined) or that throws / returns no hit simply yields NO finding.
//
// @param {object} [overrides] per-key detector fns to override/inject (used by tests).
export function wireDefaultDetectors(overrides = {}) {
  const d = {};

  // plagiarism — Cheetah text similarity over an injected corpus (corpus-mode is offline).
  d.plagiarism = async (content) => {
    if (!Array.isArray(content.corpus) || !content.corpus.length) return null; // no corpus ⇒ no finding (offline)
    try {
      const m = await import('../cheetah/text-detection.js');
      const r = await m.detectText(content.body || '', { corpus: content.corpus });
      if (!r || !r.match) return null;
      return makeFinding(categoryFor('plagiarism'), {
        confidence: r.confidence,
        evidence: `text match → ${r.source?.url || r.source?.permlink || 'source'} (jaccard ${Number(r.confidence).toFixed(2)})`,
      });
    } catch { return null; }
  };

  // image-theft — Cheetah perceptual hash; needs a precomputed hash + index (no decode/network here).
  d['image-theft'] = async (content) => {
    const imgs = Array.isArray(content.images) ? content.images : [];
    const withHash = imgs.find((i) => i && i.hash);
    if (!withHash) return null; // we don't decode/fetch in classify — caller supplies hashes
    try {
      const m = await import('../cheetah/perceptual-hash.js');
      const r = await m.findOriginal(withHash.hash, {}, content.imageIndexPath);
      if (!r || !r.match) return null;
      return makeFinding(categoryFor('image-theft'), {
        confidence: r.confidence,
        evidence: `image first seen @${r.original?.author}/${r.original?.permlink} (hamming ${r.distance})`,
      });
    } catch { return null; }
  };

  // spam — flood signal: caller passes opsInWindow/intervalMs; we model it with simulateSpam.
  d.spam = async (content) => {
    const ops = Number(content.opsInWindow);
    if (!Number.isFinite(ops) || ops < 5) return null; // not a flood
    try {
      const m = await import('../spamtest/limits.mjs');
      const sim = m.simulateSpam({
        ops,
        intervalMs: Number(content.intervalMs) || 0,
        rcBudget: Number(content.rcBudget) || 0,
        kind: content.opKind || 'comment',
      });
      const rejected = sim.summary.rejected;
      if (rejected <= 0) return null;
      return makeFinding(categoryFor('spam'), {
        confidence: clamp01(rejected / sim.summary.total),
        evidence: `flood: ${rejected}/${sim.summary.total} ops throttled (${Object.keys(sim.summary.byReason).join(',')})`,
      });
    } catch { return null; }
  };

  // harassment-toxicity & hate — both read the SAME moderation-adapter score (offline lexicon floor).
  const toxic = async (content, key, threshold) => {
    try {
      const m = await import('./moderation-adapter.mjs');
      const r = await m.moderate(content.body || '');
      if (!r) return null;
      const score = key === 'hate' ? Math.max(r.severe, r.threat) : r.toxicity;
      if (score < threshold) return null;
      return makeFinding(categoryFor(key), {
        confidence: score,
        evidence: `toxicity label=${r.label} (tox ${Number(r.toxicity).toFixed(2)}, threat ${Number(r.threat).toFixed(2)}, src ${r.source})`,
      });
    } catch { return null; }
  };
  d['harassment-toxicity'] = (content) => toxic(content, 'harassment-toxicity', 0.5);
  d.hate = (content) => toxic(content, 'hate', 0.6);

  // misinformation — fact-checker; verification needs grounding sources, so it yields nothing offline.
  d.misinformation = async (content) => {
    if (!content.factCheck) return null; // opt-in: callers that have grounding wired pass factCheck:true
    try {
      const m = await import('../library-of-ashurbanipal-bot/src/factChecker/index.js');
      const r = await m.checkArticle(content.body || '', { title: content.permlink || '', topic: content.topic || '' });
      const bad = (r?.claims || []).filter((c) => c.verdict === 'false' || c.verdict === 'unsupported');
      if (!bad.length) return null;
      return makeFinding(categoryFor('misinformation'), {
        confidence: 0.5,
        evidence: `${bad.length} unsupported/false claim(s) flagged (fact-checker FLAGS only, never edits)`,
      });
    } catch { return null; }
  };

  // heuristic categories — pure, offline, always available.
  const heur = (key, fn) => async (content) => {
    try { const r = fn(content); return r && r.hit ? makeFinding(categoryFor(key), r) : null; } catch { return null; }
  };
  d['scam-fraud'] = heur('scam-fraud', detectScamHeuristic);
  d.impersonation = heur('impersonation', detectImpersonationHeuristic);
  d['doxxing-pii'] = heur('doxxing-pii', detectPiiHeuristic);
  d['bot-sybil'] = heur('bot-sybil', detectSybilHeuristic);
  d['copyright-dmca'] = heur('copyright-dmca', detectCopyrightHeuristic);

  // CSAM — GATED. We NEVER run a classifier here. The default detector is a no-op that returns null;
  // the real PhotoDNA/NCMEC pipeline (cheetah/policing/*) lives behind an institutional agreement and
  // is invoked by a separate, human-owned flow. If a caller explicitly injects a gated match (e.g. a
  // verified PhotoDNA hit), classify() will surface it as a HUMAN_COUNSEL finding — still never auto-actioned.
  d.csam = async () => null;

  return { ...d, ...overrides };
}

// ── classify() ──────────────────────────────────────────────────────────────────────────────────
/**
 * Run the available deterministic detectors over a content object and return an array of findings.
 * Each detector SOFT-FAILS independently: a missing/keyed/throwing detector yields no finding.
 *
 * @param {{author?:string, permlink?:string, body?:string, images?:Array}} content
 * @param {{detectors?:object, only?:string[]}} [opts]
 *   - detectors: a key→fn map (default wireDefaultDetectors()). Tests inject their own.
 *   - only: restrict to a subset of category keys.
 * @returns {Promise<Array<{category,severity,confidence,evidence,action,gated}>>}
 */
export async function classify(content = {}, { detectors, only } = {}) {
  const map = detectors || wireDefaultDetectors();
  const keys = (only && only.length ? only : TAXONOMY.map((c) => c.key)).filter((k) => categoryFor(k));
  const findings = [];
  for (const key of keys) {
    const fn = map[key];
    if (typeof fn !== 'function') continue; // detector absent ⇒ no finding for this category
    let res = null;
    try { res = await fn(content); } catch { res = null; } // soft-fail per detector
    if (!res) continue;
    // A detector may return a full finding (from makeFinding) or a bare {confidence,evidence,hit}.
    if (res.category) findings.push(res);
    else if (res.hit) findings.push(makeFinding(categoryFor(key), res));
  }
  // most-serious first, then highest confidence.
  findings.sort((a, b) => (b.severity - a.severity) || (b.confidence - a.confidence));
  return findings;
}

// ── route() ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Land each finding in the ONE moderation store (moderation-flags). Gated categories are flagged for
 * human/counsel and are NEVER auto-actioned — they open a report with the gated marker, exactly like a
 * normal queued report (a human owns resolution). route() only ever opens reports; it never resolves
 * or sets 'actioned'. Idempotent: moderation-flags dedups an identical still-open (reporter,target,kind).
 *
 * @param {Array} findings  output of classify()
 * @param {object} [opts]
 *   - store:    a moderation store (default the singleton). Tests inject createModerationStore({fs,...}).
 *   - target:   what is being reported ('@author/permlink'). Derived from content if not given.
 *   - content:  the classified content (used to derive target + reporter).
 *   - reporter: opaque reporter id (default 'flag-taxonomy' — the automated classifier).
 * @returns {Promise<Array<{category, report, deduped, gated, status}>>}
 */
export async function route(findings = [], opts = {}) {
  const store = opts.store || defaultStore();
  const content = opts.content || {};
  const target = opts.target
    || (content.author && content.permlink ? `@${String(content.author).replace(/^@/, '')}/${content.permlink}`
        : content.author ? `@${String(content.author).replace(/^@/, '')}` : '');
  const reporter = opts.reporter || 'flag-taxonomy';
  const out = [];

  for (const f of findings || []) {
    const cat = categoryFor(f.category);
    if (!cat) continue;
    const gated = !!cat.gated;
    const reason = `[${esc(cat.key)}] sev=${cat.severity} action=${esc(cat.action)}`
      + `${gated ? ' GATED(human+counsel)' : ''} conf=${clamp01(f.confidence).toFixed(2)} — ${esc(f.evidence || cat.note)}`;
    let result = { report: null, deduped: false };
    try {
      result = store.raiseReport({
        target: target || `@${esc(content.author || 'unknown')}`,
        kind: cat.reportKind,            // maps onto moderation-flags REPORT_KINDS
        reason: cap(reason, 2000),
        reporter,
        context: {
          category: cat.key,
          severity: cat.severity,
          action: cat.action,
          gated,
          confidence: clamp01(f.confidence),
        },
      }) || result;
    } catch { /* soft-fail: a write failure must never crash the classify→route flow */ }
    out.push({ category: cat.key, report: result.report, deduped: !!result.deduped, gated, status: openStatusFor() });
  }
  return out;
}

// Default store — bound lazily so importing this module never opens a file. Production singleton.
let _store = null;
function defaultStore() {
  if (!_store) _store = createModerationStore();
  return _store;
}

// ── CLI: print the taxonomy (read-only). ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('flag-taxonomy.mjs')) {
  const rows = TAXONOMY.map((c) => ({
    key: c.key, label: c.label, severity: c.severity, gated: c.gated,
    detector: `${c.detector.module}#${c.detector.fn}`, action: c.action,
  }));
  console.log(JSON.stringify(rows, null, 2));
}
