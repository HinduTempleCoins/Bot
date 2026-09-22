// privacy-law-map.mjs — the PRIVACY-LAW statute→case-law map for Law.SoapBox.
//
// A free, direct-to-people tool (NOT a product sold to libraries): click a privacy topic and it
// expands into the FEDERAL baseline statute, the TEXAS statute that supplements / fills the gap /
// parallels / is preempted by it, a plain-language explanation of the relationship, and a live pull
// of the cases interpreting it (CourtListener). This is the "standard law, Texas replaces some of it"
// visualization the operator asked for.
//
// DISCIPLINE (inherited from the legal readers / legal-knowledge-graph.mjs):
//   • Facts, not verdicts. We state the statute cite, the official-source link, and the relationship
//     pattern. We NEVER assert "good law", a holding-summary, or legal advice (UPL line: information,
//     not advice — the same line a court self-help kiosk must hold).
//   • Effective dates come from SECONDARY sources and are marked verify:true — the render shows a
//     "confirm at the official link" note and never presents a date as adjudicated fact.
//   • Pure + soft-fail: the data + render are offline; interpretingCases() takes an injected
//     searchCases (the CourtListener reader) and never throws — a failed lookup yields [].
//
//   import { PRIVACY_PAIRINGS, RELATIONSHIP_PATTERNS, renderMap, renderPairing, findPairing,
//            interpretingCases, texasStatuteUrl, escapeHtml } from './privacy-law-map.mjs'

// ── html escape (same contract as the readers) ────────────────────────────────────────────────
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const esc = escapeHtml;

// ── relationship legend — the three (+one) ways Texas law sits against a federal baseline ────────
// This legend is the whole point: a pro-se reader learns not just WHAT the law is but HOW the state
// law changes the federal picture. Encoded as data so the render draws a consistent legend.
export const RELATIONSHIP_PATTERNS = Object.freeze({
  'goes-further': {
    label: 'Texas goes further',
    glyph: '▲',
    note: 'A federal law sets a floor; Texas adds duties or covers more people than the federal minimum.',
  },
  'fills-gap': {
    label: 'Texas fills a gap',
    glyph: '◆',
    note: 'There is no general federal law on point; Texas supplies the rule.',
  },
  'parallels': {
    label: 'Texas parallels federal',
    glyph: '=',
    note: 'Texas mirrors a federal scheme at the state level.',
  },
  'preempted': {
    label: 'Federal preempts (state role limited)',
    glyph: '⊘',
    note: 'Federal law expressly limits or displaces conflicting state law, so the state can add little.',
  },
});

// ── Texas statute link builder → statutes.capitol.texas.gov ──────────────────────────────────────
// The official Texas Legislature full-text host. code = the two-letter code abbreviation
// (BC = Business & Commerce, HS = Health & Safety, TN = Transportation). PURE.
const TX_CODE_NAME = Object.freeze({
  BC: 'Business & Commerce Code',
  HS: 'Health & Safety Code',
  TN: 'Transportation Code',
  GV: 'Government Code',
});
export function texasStatuteUrl(code, chapter) {
  const c = String(code || '').toUpperCase();
  const ch = String(chapter || '').replace(/[^0-9.]/g, '');
  if (!TX_CODE_NAME[c] || !ch) return 'https://statutes.capitol.texas.gov/';
  return `https://statutes.capitol.texas.gov/Docs/${c}/htm/${c}.${ch}.htm`;
}

// ── the pairings — the map's content ─────────────────────────────────────────────────────────────
// Each pairing: a topic, the relationship pattern, the federal baseline, the Texas statute, a
// plain-language explanation, and a caseQuery used to pull interpreting cases live. Citations are
// stable statutory law; effective dates carry verify:true (confirm at the official link before relying).
export const PRIVACY_PAIRINGS = Object.freeze([
  {
    id: 'comprehensive',
    topic: 'Comprehensive consumer privacy',
    pattern: 'fills-gap',
    plain:
      'There is no comprehensive federal consumer-privacy statute — the FTC Act’s "unfair or deceptive '
      + 'practices" power (15 U.S.C. § 45) is the only general federal backstop. Texas enacted its own '
      + 'comprehensive law, the TDPSA. Notably it has no revenue threshold but exempts small businesses '
      + '(by the U.S. SBA definition) — a Texas-specific twist. AG-enforced, with a 30-day cure period.',
    federal: {
      name: 'FTC Act § 5 (general backstop — no comprehensive federal privacy law)',
      cite: '15 U.S.C. § 45',
      url: 'https://www.law.cornell.edu/uscode/text/15/45',
    },
    texas: {
      name: 'Texas Data Privacy and Security Act (TDPSA)',
      cite: 'Tex. Bus. & Com. Code Ch. 541',
      code: 'BC', chapter: '541',
      effective: 'Effective July 1, 2024; universal opt-out mechanism from Jan 1, 2025',
      verify: true,
    },
    caseQuery: 'Texas Data Privacy Security Act deceptive trade practices consumer privacy',
  },
  {
    id: 'breach',
    topic: 'Data-breach notification',
    pattern: 'fills-gap',
    plain:
      'There is no general federal data-breach-notification statute — only sector fragments (e.g. the '
      + 'HIPAA Breach Notification Rule). Texas supplies the general rule through its Identity Theft '
      + 'Enforcement and Protection Act, which carries BOTH the data-safeguard duty (§ 521.052) and the '
      + 'breach-notice requirement (§ 521.053) in the same chapter.',
    federal: {
      name: 'No general federal breach law (sectoral only — e.g. HIPAA Breach Notification Rule)',
      cite: '45 C.F.R. §§ 164.400–414 (HIPAA breach rule, health sector only)',
      url: 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-D',
    },
    texas: {
      name: 'Texas Identity Theft Enforcement and Protection Act (ITEPA)',
      cite: 'Tex. Bus. & Com. Code Ch. 521 (§§ 521.052, 521.053)',
      code: 'BC', chapter: '521',
    },
    caseQuery: 'Texas Identity Theft Enforcement Protection Act breach notification 521',
  },
  {
    id: 'health',
    topic: 'Health / medical-records privacy',
    pattern: 'goes-further',
    plain:
      'HIPAA is the federal floor for protected health information. Texas goes further: its Medical '
      + 'Records Privacy Act defines "covered entity" far more broadly — essentially anyone who obtains, '
      + 'stores, or uses PHI, not just HIPAA-covered entities and their business associates — and adds '
      + 'training and stricter consent duties.',
    federal: {
      name: 'HIPAA Privacy & Security Rules',
      cite: '45 C.F.R. Parts 160 & 164',
      url: 'https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C',
    },
    texas: {
      name: 'Texas Medical Records Privacy Act (TMRPA)',
      cite: 'Tex. Health & Safety Code Ch. 181',
      code: 'HS', chapter: '181',
    },
    caseQuery: 'Texas Medical Records Privacy Act protected health information HIPAA covered entity',
  },
  {
    id: 'driver',
    topic: 'Driver / motor-vehicle records',
    pattern: 'parallels',
    plain:
      'The federal Driver’s Privacy Protection Act restricts disclosure of motor-vehicle records. Texas '
      + 'mirrors it at the state level with its Motor Vehicle Records Disclosure Act — a parallel scheme '
      + 'rather than an expansion.',
    federal: {
      name: 'Driver’s Privacy Protection Act (DPPA)',
      cite: '18 U.S.C. § 2721 et seq.',
      url: 'https://www.law.cornell.edu/uscode/text/18/2721',
    },
    texas: {
      name: 'Texas Motor Vehicle Records Disclosure Act',
      cite: 'Tex. Transp. Code Ch. 730',
      code: 'TN', chapter: '730',
    },
    caseQuery: 'Driver Privacy Protection Act motor vehicle records disclosure Texas',
  },
  {
    id: 'credit',
    topic: 'Credit reporting',
    pattern: 'preempted',
    plain:
      'The Fair Credit Reporting Act governs consumer credit reporting — and it expressly PREEMPTS much '
      + 'state credit-reporting law, so Texas’s role here is limited (mainly security-freeze mechanics '
      + 'under Bus. & Com. Code Ch. 20). This is the teaching contrast to the topics above: sometimes '
      + 'federal law leaves room for the state, and sometimes it takes it away. To dispute a credit '
      + 'error, the FCRA path (and the CFPB) is usually the operative one.',
    federal: {
      name: 'Fair Credit Reporting Act (FCRA)',
      cite: '15 U.S.C. § 1681 et seq.',
      url: 'https://www.law.cornell.edu/uscode/text/15/1681',
    },
    texas: {
      name: 'Texas consumer credit reporting / security freeze',
      cite: 'Tex. Bus. & Com. Code Ch. 20',
      code: 'BC', chapter: '20',
    },
    caseQuery: 'Fair Credit Reporting Act 1681 preemption Texas credit reporting',
  },
]);

/** Find a pairing by id. Returns the frozen pairing or null. */
export function findPairing(id) {
  const want = String(id == null ? '' : id).trim().toLowerCase();
  if (!want) return null;
  return PRIVACY_PAIRINGS.find((p) => p.id === want) || null;
}

// ── live interpreting-cases lookup ───────────────────────────────────────────────────────────────
/**
 * Pull the cases interpreting a pairing's statutes, live from CourtListener. `searchCases` is injected
 * (the courtlistener-opinions reader's searchCases) so this is offline-testable and never touches the
 * network in tests. Soft-fail: any error or bad shape → []. NEVER throws.
 *   interpretingCases(pairing, { searchCases, limit }) → [ caseRow, … ]
 */
export async function interpretingCases(pairing, { searchCases, limit = 10 } = {}) {
  const p = pairing && typeof pairing === 'object' ? pairing : null;
  if (!p || typeof searchCases !== 'function') return [];
  try {
    const rows = await searchCases({ q: String(p.caseQuery || p.topic || ''), limit });
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ── render ───────────────────────────────────────────────────────────────────────────────────────
function patternBadge(pattern) {
  const rp = RELATIONSHIP_PATTERNS[pattern];
  if (!rp) return '';
  return `<span class="plm-pat plm-pat-${esc(pattern)}" title="${esc(rp.note)}">${esc(rp.glyph)} ${esc(rp.label)}</span>`;
}

function statuteBlock(kind, s) {
  if (!s || typeof s !== 'object') return '';
  const isTx = kind === 'texas';
  const url = s.url || (isTx && s.code ? texasStatuteUrl(s.code, s.chapter) : '');
  const head = isTx ? 'Texas' : 'Federal baseline';
  const eff = s.effective
    ? `<div class="plm-eff">${esc(s.effective)}${s.verify ? ` <em class="plm-verify">— confirm at the official link before relying</em>` : ''}</div>`
    : '';
  const link = url ? `<a href="${esc(url)}" rel="nofollow noopener">official text →</a>` : '';
  return `<div class="plm-statute plm-${esc(kind)}">
    <div class="plm-kind">${esc(head)}</div>
    <div class="plm-name">${esc(s.name || '')}</div>
    <div class="plm-cite"><code>${esc(s.cite || '')}</code></div>
    ${eff}
    ${link ? `<div class="plm-link">${link}</div>` : ''}
  </div>`;
}

/**
 * Render one pairing. If `cases` is a non-empty array (from interpretingCases), it renders the live
 * "cases interpreting this" list; `casesHref` is the link used to fetch them when not yet loaded.
 * `caseRow` is an optional renderer for a single case row (the law server passes its own house-style
 * row); without it a minimal default row is used. `open` expands the <details> block.
 */
export function renderPairing(pairing, { cases = null, casesHref = '', caseRow = null, open = false } = {}) {
  const p = pairing && typeof pairing === 'object' ? pairing : null;
  if (!p) return '';
  const rowFn = typeof caseRow === 'function' ? caseRow : defaultCaseRow;

  let casesBlock;
  if (Array.isArray(cases)) {
    casesBlock = cases.length
      ? `<div class="plm-cases"><h4>Cases interpreting this (live · CourtListener)</h4>${cases.map(rowFn).join('')}</div>`
      : `<div class="plm-cases plm-empty">No interpreting cases returned right now. <a href="${esc(casesHref || '#')}">Try the live search again →</a></div>`;
  } else {
    casesBlock = casesHref
      ? `<div class="plm-cases-link"><a href="${esc(casesHref)}">See the cases interpreting this →</a></div>`
      : '';
  }

  return `<details class="plm-pairing"${open ? ' open' : ''}>
    <summary><span class="plm-topic">${esc(p.topic)}</span> ${patternBadge(p.pattern)}</summary>
    <div class="plm-body">
      <p class="plm-plain">${esc(p.plain)}</p>
      <div class="plm-statutes">
        ${statuteBlock('federal', p.federal)}
        <div class="plm-arrow" aria-hidden="true">↔</div>
        ${statuteBlock('texas', p.texas)}
      </div>
      ${casesBlock}
    </div>
  </details>`;
}

function defaultCaseRow(c) {
  const name = esc(c && (c.caseName || c.name) || 'Case');
  const cites = c && Array.isArray(c.citations) && c.citations.length ? ` · ${esc(c.citations.join('; '))}` : '';
  const meta = c ? [c.court, c.dateFiled || c.decisionDate].filter(Boolean).map(esc).join(' · ') : '';
  const link = c && c.url ? ` · <a href="${esc(c.url)}" rel="nofollow noopener">source →</a>` : '';
  return `<div class="plm-case"><div class="plm-case-nm">${name}</div><div class="plm-case-meta">${meta}${cites}${link}</div></div>`;
}

/** Render the legend row. */
export function renderLegend() {
  const items = Object.entries(RELATIONSHIP_PATTERNS)
    .map(([k, v]) => `<span class="plm-leg plm-pat-${esc(k)}" title="${esc(v.note)}"><b>${esc(v.glyph)}</b> ${esc(v.label)}</span>`)
    .join('');
  return `<div class="plm-legend">${items}</div>`;
}

/**
 * Render the whole map. `pairings` defaults to PRIVACY_PAIRINGS. `caseRow` optionally themes case rows.
 * `expandedId` opens one pairing (and, if `casesById[id]` is present, injects its live cases).
 * `casesHrefFor(id)` builds the "see cases" link per pairing.
 */
export function renderMap({ pairings = PRIVACY_PAIRINGS, caseRow = null, expandedId = '', casesById = {}, casesHrefFor = null } = {}) {
  const list = Array.isArray(pairings) ? pairings : PRIVACY_PAIRINGS;
  const hrefFor = typeof casesHrefFor === 'function' ? casesHrefFor : (() => '');
  const body = list.map((p) => renderPairing(p, {
    cases: Object.prototype.hasOwnProperty.call(casesById, p.id) ? casesById[p.id] : null,
    casesHref: hrefFor(p.id),
    caseRow,
    open: p.id === expandedId,
  })).join('');
  return `<section class="plm">${renderLegend()}<div class="plm-list">${body}</div></section>`;
}

// ── guarded CLI demo ─────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  console.log(`${PRIVACY_PAIRINGS.length} pairings:`);
  for (const p of PRIVACY_PAIRINGS) {
    console.log(` - ${p.id}: ${p.topic} [${RELATIONSHIP_PATTERNS[p.pattern].label}]`);
    console.log(`     federal: ${p.federal.cite}`);
    console.log(`     texas:   ${p.texas.cite}  ${p.texas.code ? '→ ' + texasStatuteUrl(p.texas.code, p.texas.chapter) : ''}`);
  }
}
