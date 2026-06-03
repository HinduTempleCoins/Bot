// backlinks.mjs — the EARN-backlinks program (task #127). Track, classify, score, and draft
// outreach for LEGITIMATE, EARNED authority-building opportunities: research citations, digital PR,
// quality directories, resource pages, broken-link rebuilds, data studies, genuine guest content.
//
// HARD RULE — non-negotiable, baked into the code:
//   We NEVER buy links, NEVER run or join PBNs, NEVER do link schemes / link exchanges / paid
//   placements. Those manipulate PageRank, violate search guidelines, and put the domain at risk.
//   `classifyOpportunity()` actively FLAGS and REJECTS anything that smells of a paid/manipulative
//   "opportunity" (see BLACKLIST_SIGNALS) — it can only ever return allowed:false for those.
//
// Companion: backlink-targets.mjs is a static catalog of WHERE to submit (CoinGecko, awesome-lists,
// etc.). THIS module is the PROGRAM that triages inbound/found opportunities by legitimacy + value
// and produces an honest outreach draft. Both are white-hat-only by construction.
//
// Conventions (per repo): ESM, pure/deterministic (no live clock — pass timestamps in if needed),
// soft-fail (bad input → a safe rejected verdict, never throws), CLI guarded, no secrets, no network.

/**
 * The ONLY allowed earned categories. Each carries a short why-it's-legit note so the verdict can
 * explain itself. These are all "you earned the link by doing/being something real" — never paid.
 */
export const OPPORTUNITY_TYPES = {
  'research-citation': 'Someone cites our original data/study as a source. Earned by publishing real, useful, original research worth referencing.',
  'guest-content': 'We genuinely author useful content for a relevant publication, with honest attribution. Earned by editorial value, not payment for the link.',
  'resource-page': 'A curator adds us to a topical "best resources" / "useful tools" page because we belong there. Earned by being genuinely useful on-topic.',
  'directory-quality': 'Listing in a reputable, human-edited, on-topic directory (not a link farm). Earned by meeting real editorial inclusion criteria.',
  'digital-pr': 'Earned media: a journalist/blogger covers us because the story is newsworthy. Earned by doing something coverage-worthy, never pay-for-coverage.',
  'broken-link-rebuild': 'A page links to dead/outdated content we have a genuinely better, current replacement for. Earned by actually providing the better resource.',
  'data-study': 'We publish an original data study / index others naturally cite and link. Earned by original, verifiable analysis worth referencing.',
};

/** Patterns that mean a "link opportunity" is actually paid / manipulative — ALWAYS rejected. */
export const BLACKLIST_SIGNALS = [
  /buy\s.*back\s?links?/i,
  /back\s?links?\s.*for\s.*sale/i,
  /\bpbn\b/i,
  /private\s+blog\s+network/i,
  /link\s*exchange/i,
  /link\s*swap/i,
  /reciprocal\s+link/i,
  /pay\s.*for\s.*link/i,
  /paid\s+(?:link|placement|guest\s+post|do\s?follow)/i,
  /\$\s*\d+\s*(?:per|\/)\s*(?:link|post|placement)/i,
  /guaranteed\s+da\s*\d+/i,    // "guaranteed DA50"
  /\bda\s*\d{2,}\b.*guarantee/i,
  /sponsored\s+do\s?follow/i,
  /link\s+(?:farm|building\s+package|scheme)/i,
  /link\s+wheel/i,
  /\d+\s+(?:do\s?follow\s+)?back\s?links?\b/i, // "5000 dofollow backlinks"
  /cheap\s+back\s?links?/i,
  /rank\s+(?:#?1|first)\s+guaranteed/i,
];

/** True if any field (concatenated) trips a manipulative-link signal. */
export function hasBlacklistSignal(text) {
  const s = String(text == null ? '' : text);
  return BLACKLIST_SIGNALS.some((re) => re.test(s));
}

/**
 * Classify an opportunity. Rejects (allowed:false) anything that trips a BLACKLIST_SIGNAL or whose
 * `type` is not a known earned category; approves known earned types.
 * @param {object} opp
 * @param {string} opp.type    - one of OPPORTUNITY_TYPES keys
 * @param {string} [opp.source]- the site/domain/publication offering or hosting the link
 * @param {string} [opp.notes] - free text describing the opportunity (scanned for manipulation)
 * @returns {{allowed:boolean, category:(string|null), reason:string}}
 */
export function classifyOpportunity({ type, source, notes } = {}) {
  const blob = [type, source, notes].filter((x) => x != null).join(' — ');
  // 1) Manipulation check FIRST — it overrides everything, even a "valid-looking" type.
  if (hasBlacklistSignal(blob)) {
    return {
      allowed: false,
      category: null,
      reason: 'REJECTED: matches a paid/manipulative-link signal (buy-links / PBN / link-exchange / paid placement / DA guarantee). We only pursue EARNED links — never buy, exchange, or scheme.',
    };
  }
  // 2) Type must be a known earned category.
  const key = typeof type === 'string' ? type.trim() : '';
  if (!Object.prototype.hasOwnProperty.call(OPPORTUNITY_TYPES, key)) {
    return {
      allowed: false,
      category: null,
      reason: `REJECTED: unknown opportunity type ${key ? `"${key}"` : '(missing)'}. Allowed earned types: ${Object.keys(OPPORTUNITY_TYPES).join(', ')}.`,
    };
  }
  return { allowed: true, category: key, reason: `Approved earned opportunity (${key}): ${OPPORTUNITY_TYPES[key]}` };
}

// Heuristic authority signals from PROVIDED metadata only — no live DA/PA lookups.
const TYPE_WEIGHT = {
  'research-citation': 100,
  'data-study': 95,
  'digital-pr': 90,
  'broken-link-rebuild': 80,
  'resource-page': 75,
  'guest-content': 65,
  'directory-quality': 55,
};

const HIGH_AUTHORITY_TLD = /\.(edu|gov|ac\.[a-z]{2}|gov\.[a-z]{2}|int)$/i;
const KNOWN_AUTHORITY = /(wikipedia|nature|sciencedirect|springer|arxiv|reuters|bloomberg|coingecko|coinmarketcap|github|\.edu|\.gov)/i;

function hostOf(source) {
  const s = String(source == null ? '' : source).trim().toLowerCase();
  if (!s) return '';
  try {
    const u = new URL(s.includes('://') ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return s.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  }
}

/**
 * Score an opportunity 0..100 by relevance + inferable authority signals. PURE + deterministic:
 * derived ONLY from the fields provided (type, source host, relevance/topical flags, evidence in
 * notes). No network, no clock, no randomness. A rejected/unknown opp scores 0.
 * @param {object} opp - { type, source, notes, relevance, dofollow }
 *   relevance : optional 'high'|'medium'|'low' (topical fit). Inferred from notes if absent.
 *   dofollow  : optional boolean hint that the link would be followed (small bonus).
 * @returns {number} integer 0..100
 */
export function scoreOpportunity(opp = {}) {
  const verdict = classifyOpportunity(opp);
  if (!verdict.allowed) return 0;

  const { type, source, notes, relevance, dofollow } = opp;
  let score = TYPE_WEIGHT[type] ?? 50;

  // Relevance (topical fit) — explicit flag wins, else infer from notes keywords, else neutral.
  const rel = typeof relevance === 'string' ? relevance.toLowerCase() : '';
  const noteStr = String(notes == null ? '' : notes).toLowerCase();
  const looksRelevant = /(crypto|blockchain|market|finance|data|hive|melek|web3|fintech|trading)/.test(noteStr);
  if (rel === 'high' || (!rel && looksRelevant)) score += 8;
  else if (rel === 'low') score -= 20;
  else if (rel === 'medium') score -= 5;
  // unknown relevance + no topical keywords: no change (neutral).

  // Authority of the linking host (from the string only).
  const host = hostOf(source);
  if (host && HIGH_AUTHORITY_TLD.test(host)) score += 12;
  if (host && KNOWN_AUTHORITY.test(host)) score += 6;
  if (!host) score -= 10; // no source given → less actionable

  // Evidence of legitimacy in the notes (named editor, real article, existing dead link, etc.).
  if (/(editor|journalist|author|professor|researcher|maintainer)/.test(noteStr)) score += 4;
  if (/(broken|dead|404|outdated)\s+link/.test(noteStr)) score += 3;

  // dofollow hint is a minor positive (we pursue links for their honest value regardless).
  if (dofollow === true) score += 2;

  // Clamp + integerize for determinism.
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Build a polite, honest outreach template (plain text). Discloses who we are and why we belong;
 * never offers payment, never asks for a reciprocal link, never pressures. No HTML — plain text, so
 * nothing to escape; we just normalize whitespace in interpolated fields.
 * @param {object} opp           - a classified opportunity
 * @param {object} ctx
 * @param {string} [ctx.from]    - sender name/handle (who-we-are; defaults to the project)
 * @param {string} [ctx.site]    - our site URL we'd like considered
 * @returns {string} the outreach message
 */
export function buildOutreach(opp = {}, { from, site } = {}) {
  const clean = (s, fallback = '') => String(s == null ? fallback : s).replace(/\s+/g, ' ').trim() || fallback;
  const sender = clean(from, 'the MELEK / SoapBox team');
  const ourSite = clean(site, 'soapbox.community');
  const verdict = classifyOpportunity(opp);
  const host = hostOf(opp.source) || clean(opp.source, 'your site');
  const type = verdict.allowed ? opp.type : 'outreach';

  const reasonByType = {
    'research-citation': `We publish original, openly verifiable market/on-chain data. If it is useful for your work, you are welcome to cite ${ourSite} as a source.`,
    'data-study': `We recently published an original data study at ${ourSite} that may be relevant to your readers. Sharing in case it is useful — no obligation.`,
    'digital-pr': `We thought our work at ${ourSite} might be relevant to a story you cover. Happy to provide data, context, or a quote if it is helpful.`,
    'broken-link-rebuild': `While reading ${host} I noticed a link that appears broken/outdated. We maintain a current resource at ${ourSite} that may be a suitable, more up-to-date replacement — entirely your call.`,
    'resource-page': `I came across your resource page on ${host} and thought ${ourSite} might be a genuinely useful addition for your readers. Only if you agree it fits.`,
    'guest-content': `I would be glad to contribute a genuinely useful, original piece for ${host}'s readers, with honest attribution. No payment is involved either way — purely editorial.`,
    'directory-quality': `We would like to be considered for inclusion in ${host} if we meet your editorial criteria. Happy to provide whatever details your review needs.`,
    outreach: `We wanted to reach out about ${ourSite}.`,
  };

  return [
    `Hello,`,
    ``,
    `My name is ${sender}. We run ${ourSite}, a free, transparent crypto + markets data project (part of the MELEK / SoapBox effort).`,
    ``,
    reasonByType[type] || reasonByType.outreach,
    ``,
    `Full disclosure: this is an honest outreach from the team behind ${ourSite}. We are not offering payment, and we are not asking for a reciprocal link or any exchange — only to be considered on the merits. If this is not a fit, no problem at all, and we will not follow up repeatedly.`,
    ``,
    `Thank you for your time,`,
    `${sender}`,
  ].join('\n');
}

/**
 * Triage a list of opportunities: drop the rejected, score the allowed, sort by score desc.
 * Soft-fails on a non-array (treats as empty). Stable, deterministic.
 * @param {object[]} opportunities
 * @returns {{opportunities:Array, summary:{considered:number, allowed:number, rejected:number}}}
 */
export function pipeline(opportunities) {
  const list = Array.isArray(opportunities) ? opportunities : [];
  const allowed = [];
  let rejected = 0;
  for (const opp of list) {
    const verdict = classifyOpportunity(opp || {});
    if (!verdict.allowed) { rejected += 1; continue; }
    allowed.push({ ...opp, category: verdict.category, score: scoreOpportunity(opp), reason: verdict.reason });
  }
  allowed.sort((a, b) => b.score - a.score);
  return {
    opportunities: allowed,
    summary: { considered: list.length, allowed: allowed.length, rejected },
  };
}

// CLI: a tiny demo over a fixed sample (no network, no secrets). Guarded.
if (process.argv[1] && process.argv[1].endsWith('backlinks.mjs')) {
  const sample = [
    { type: 'research-citation', source: 'university.edu/research', notes: 'professor citing our crypto market data study' },
    { type: 'resource-page', source: 'cryptoblog.com/tools', notes: 'on-topic web3 tools roundup' },
    { type: 'guest-content', source: 'buy backlinks DA50 guaranteed', notes: 'pay for link package' },
    { type: 'mystery-type', source: 'somewhere.com' },
  ];
  const { opportunities, summary } = pipeline(sample);
  console.log('Summary:', summary);
  for (const o of opportunities) console.log(`  [${o.score}] ${o.category} — ${o.source}`);
  console.log('\n--- sample outreach ---\n');
  console.log(buildOutreach(opportunities[0] || sample[0], { from: 'Hathor', site: 'https://data.soapbox.community' }));
}
