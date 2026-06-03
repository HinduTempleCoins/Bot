// lawyer-directory.mjs — SoapBox legal-services directory (queue task #217, v3 doc §6A.1).
//
// This is the listings/people layer that sits next to legal.mjs (the Law.SoapBox vertical, which
// surfaces courts + federal-government activity). Here we surface ATTORNEYS as *public bar records*,
// plus a curated, fully-clean public-interest set (legal aid, bar referral lines, agency complaint
// forms). It is a directory of facts — NOT a referral service, NOT a recommendation engine.
//
// THE ETHICS LINE IS STRUCTURAL, not a disclaimer. The ABA Model Rules are enforced in code:
//
//   * Model Rule 5.4 — a lawyer (or firm) shall not share legal fees with a nonlawyer. So this
//     module has NO mechanism to take a percentage of a legal fee. priceListing() returns flat
//     dollar amounts only; validateMonetization() REJECTS any offer that carries a percentage or a
//     'fee-share' type. (This is the Avvo Legal Services failure mode — fee-splitting dressed up as
//     a "marketing fee" — which is exactly what we refuse.)
//   * Model Rule 7.2 — a lawyer shall not give anything of value for a *recommendation*; only the
//     reasonable cost of *advertising* is allowed, and certain not-for-profit/bar referral programs.
//     So a listing can be paid ADVERTISING (flat fee, disclosed as such), but money can NEVER buy
//     rank or a recommendation. validateMonetization() REJECTS pay-for-rank / pay-for-recommendation.
//
//   * VERIFY, DON'T RECOMMEND — profiles render verified public bar facts (license status, admission
//     date, discipline history with sources). There is deliberately NO rating / score / star on a
//     lawyer. We report what the bar published; we do not editorialize quality.
//   * UPL — every render carries the line: "directory of public bar records — not legal advice, not
//     a referral or recommendation."
//
// Style matches legal.mjs / macro.mjs: ESM .mjs, injectable fetch, soft-fail (a dead state-bar
// lookup returns [] / null, never throws), CLI guarded, all rendered text HTML-escaped, no secrets.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Defensively reuse the sibling Law vertical if it loads; never fatal if it doesn't.
let _legal = null;
try { _legal = await import('./legal.mjs'); } catch { _legal = null; }
export const law = _legal; // exposed so the consumer page can pair records-of-people with records-of-courts

// The ABA Model Rules we enforce, kept as data so error messages can cite them precisely.
export const ABA_RULES = {
  '5.4': 'ABA Model Rule 5.4 (Professional Independence) — a lawyer or firm shall not share legal fees with a nonlawyer.',
  '7.2': 'ABA Model Rule 7.2 (Communications / Advertising) — a lawyer shall not give anything of value for a recommendation; only the reasonable cost of advertising and certain not-for-profit/bar referral programs are permitted.',
};

// The not-advice / not-a-referral line every render carries (UPL guard).
export const NOT_ADVICE =
  'Directory of public bar records — not legal advice, not a referral or recommendation.';

// ---------------------------------------------------------------------------
// HTML escape — matches the convention in the sibling soapbox modules.
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---------------------------------------------------------------------------
// Normalization — public facts only. No quality score, ever.
// ---------------------------------------------------------------------------
const VALID_STATUS = new Set(['active', 'inactive', 'suspended', 'disbarred', 'resigned', 'retired', 'unknown']);

function normStatus(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (VALID_STATUS.has(s)) return s;
  if (/disbar/.test(s)) return 'disbarred';
  if (/suspend/.test(s)) return 'suspended';
  if (/active|good standing/.test(s)) return 'active';
  if (/inactive/.test(s)) return 'inactive';
  if (/resign/.test(s)) return 'resigned';
  if (/retir/.test(s)) return 'retired';
  return 'unknown';
}

function asArray(x) {
  if (Array.isArray(x)) return x;
  if (x == null || x === '') return [];
  return [x];
}

/**
 * Normalize one raw bar record (shape varies by state) into our public-facts schema.
 * Discipline entries keep their source so a reader can verify against the state bar directly.
 * Returns null only for an entirely empty input.
 */
export function normalizeBarRecord(raw, { state } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const name = raw.name || raw.attorneyName || raw.full_name || raw.fullName ||
    [raw.firstName || raw.first_name, raw.lastName || raw.last_name].filter(Boolean).join(' ').trim() || null;
  const barNumber = raw.barNumber || raw.bar_number || raw.barNo || raw.licenseNumber || raw.license_number || null;
  const st = state || raw.state || raw.jurisdiction || null;

  const discipline = asArray(raw.discipline || raw.disciplinaryHistory || raw.disciplinary_actions).map((d) => {
    if (!d || typeof d !== 'object') return { date: null, action: String(d ?? ''), source: null };
    return {
      date: d.date || d.effectiveDate || d.effective_date || null,
      action: d.action || d.description || d.type || d.disposition || 'Disciplinary action',
      source: d.source || d.url || d.documentUrl || d.document_url || null,
    };
  });

  return {
    name: name || null,
    barNumber: barNumber != null ? String(barNumber) : null,
    state: st || null,
    status: normStatus(raw.status || raw.licenseStatus || raw.standing),
    admitted: raw.admitted || raw.admissionDate || raw.admission_date || raw.dateAdmitted || null,
    practiceAreas: asArray(raw.practiceAreas || raw.practice_areas || raw.areasOfPractice)
      .map((p) => String(p).trim()).filter(Boolean),
    discipline,
    // public-facts only — NO rating, NO score, NO recommendation field, by design.
  };
}

/**
 * Search a state bar for attorneys via an INJECTED fetcher (state-bar lookups have no common public
 * API, so the caller supplies the transport; we normalize whatever shape comes back). Soft-fails to [].
 *
 * The fetcher receives (query, { state }) and may return an array of raw records, or an object with
 * a .results / .records / .attorneys array. We never call the network ourselves here.
 */
export async function searchAttorneys(query, { state, fetcher } = {}) {
  if (!query) return [];
  const fn = fetcher || null;
  if (typeof fn !== 'function') return []; // no transport → soft-fail (no public state-bar API to default to)
  try {
    const data = await fn(query, { state });
    const rows = Array.isArray(data) ? data
      : Array.isArray(data?.results) ? data.results
        : Array.isArray(data?.records) ? data.records
          : Array.isArray(data?.attorneys) ? data.attorneys
            : [];
    return rows.map((r) => normalizeBarRecord(r, { state })).filter(Boolean);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// PUBLIC_INTEREST — the fully-clean set. Legal aid, bar referral lines, agency
// complaint-filing links. No money changes hands here; these are public services.
// ---------------------------------------------------------------------------
export const PUBLIC_INTEREST = {
  'Legal aid': [
    { name: 'Legal Services Corporation (find local legal aid)', url: 'https://www.lsc.gov/about-lsc/what-legal-aid/get-legal-help', note: 'Federally funded civil legal aid — find your local LSC-funded program' },
    { name: 'LawHelp.org', url: 'https://www.lawhelp.org/', note: 'Free legal aid + self-help by state and topic' },
    { name: 'Pro Bono Net', url: 'https://www.probono.net/', note: 'Connects people with volunteer lawyers' },
    { name: 'American Bar Association — Free Legal Answers', url: 'https://abafreelegalanswers.org/', note: 'Post a civil legal question, get a volunteer attorney answer (income-eligible)' },
  ],
  'Bar referral': [
    { name: 'ABA Lawyer Referral Directory', url: 'https://www.americanbar.org/groups/legal_services/flh-home/flh-lawyer-referral-directory/', note: 'Find your state/local bar lawyer referral service (Rule 7.2-compliant programs)' },
    { name: 'State & local bar associations', url: 'https://www.americanbar.org/groups/bar_services/resources/state_local_bar_associations/', note: 'Directory of every US state and local bar' },
  ],
  'File a complaint': [
    { name: 'CFPB — Submit a complaint (financial)', url: 'https://www.consumerfinance.gov/complaint/', note: 'Banks, loans, credit, debt collection' },
    { name: 'FTC — ReportFraud.ftc.gov', url: 'https://reportfraud.ftc.gov/', note: 'Scams, fraud, bad business practices' },
    { name: 'USA.gov — State consumer protection / Attorney General offices', url: 'https://www.usa.gov/state-consumer', note: 'File a consumer complaint with your state AG' },
    { name: 'Attorney discipline — file a grievance', url: 'https://www.americanbar.org/groups/professional_responsibility/resources/lawyerregulation/', note: 'Report attorney misconduct to the state disciplinary authority' },
  ],
};

// ---------------------------------------------------------------------------
// MONETIZATION GUARDRAILS — the load-bearing part. Enforced in code.
// ---------------------------------------------------------------------------

// Flat-fee tiers. Prices are FLAT amounts only. There is intentionally NO field here that could hold
// a percentage of a client's legal fee — the schema cannot express fee-splitting.
export const LISTING_TIERS = {
  basic: { price: 0, label: 'Basic (verified bar record)', description: 'Free verified listing of public bar facts.' },
  premium: { price: 49, label: 'Premium profile', description: 'Flat-fee enhanced profile: photo, bio, practice areas, contact.' },
  featured: { price: 99, label: 'Featured advertising', description: 'Flat-fee display advertising. Does NOT affect search rank or imply recommendation.' },
};

/**
 * Price a listing. FLAT amounts only. Throws on an unknown tier; never returns or accepts a
 * percentage. There is no parameter by which a percentage-of-fee could enter.
 */
export function priceListing({ tier } = {}) {
  const key = String(tier ?? '').trim().toLowerCase();
  const t = LISTING_TIERS[key];
  if (!t) {
    const valid = Object.keys(LISTING_TIERS).join(', ');
    throw new Error(`Unknown listing tier "${tier}". Valid flat-fee tiers: ${valid}.`);
  }
  return {
    tier: key,
    label: t.label,
    description: t.description,
    price: t.price,         // flat USD
    currency: 'USD',
    model: 'flat-fee',      // never 'fee-share', never percentage
    isAdvertising: t.price > 0, // paid tiers are disclosed as advertising
  };
}

/**
 * Validate a proposed monetization OFFER against ABA Model Rules 5.4 and 7.2.
 *
 * Accepts ONLY flat-fee advertising/listing offers. Rejects (with the rule cited):
 *   - { type: 'fee-share' } or any fee-splitting language        → Rule 5.4
 *   - any percentage-bearing offer (percent / percentage / rate as a %, or "%" in amount) → Rule 5.4
 *   - pay-for-recommendation / pay-for-rank / paid placement-by-payment → Rule 7.2
 *
 * Returns { ok: true, normalized } or { ok: false, rule, reason }.
 */
export function validateMonetization(offer) {
  if (!offer || typeof offer !== 'object') {
    return { ok: false, rule: null, reason: 'No offer provided.' };
  }
  const type = String(offer.type ?? '').trim().toLowerCase();
  const blob = JSON.stringify(offer).toLowerCase();

  // --- Rule 5.4: fee-splitting / percentage of a legal fee ---
  const feeShareTypes = new Set(['fee-share', 'fee_share', 'feeshare', 'fee-split', 'fee-splitting', 'revenue-share', 'rev-share', 'contingency-share', 'percentage']);
  if (feeShareTypes.has(type)) {
    return { ok: false, rule: '5.4', reason: `Fee-splitting is prohibited. ${ABA_RULES['5.4']}` };
  }
  // any explicit percentage field, or a percentage expressed in amount/value text
  const hasPercentField = offer.percent != null || offer.percentage != null || offer.feePercent != null || offer.percentOfFee != null;
  const amountHasPct = /%|percent|per\s*cent/.test(String(offer.amount ?? '')) || /%|percent|per\s*cent/.test(String(offer.value ?? ''));
  if (hasPercentField || amountHasPct) {
    return { ok: false, rule: '5.4', reason: `A percentage of a legal fee is prohibited fee-splitting. ${ABA_RULES['5.4']}` };
  }
  // catch fee-sharing phrasing hiding in any field
  if (/fee.?(share|split)|share.?(legal|the).?fee|percentage of (the )?(legal )?fee|cut of the fee/.test(blob)) {
    return { ok: false, rule: '5.4', reason: `Sharing legal fees with a nonlawyer is prohibited. ${ABA_RULES['5.4']}` };
  }

  // --- Rule 7.2: paying for a recommendation or for rank ---
  const payForRankTypes = new Set(['pay-for-rank', 'pay_for_rank', 'pay-for-recommendation', 'pay_for_recommendation', 'paid-recommendation', 'paid-placement', 'sponsored-ranking', 'lead-purchase', 'lead-gen']);
  if (payForRankTypes.has(type)) {
    return { ok: false, rule: '7.2', reason: `Paying for a recommendation or for rank is prohibited. ${ABA_RULES['7.2']}` };
  }
  if (offer.buysRank === true || offer.affectsRank === true || offer.affectsRanking === true || offer.recommendation === true || offer.recommend === true) {
    return { ok: false, rule: '7.2', reason: `Money cannot buy rank or a recommendation. ${ABA_RULES['7.2']}` };
  }
  if (/(buy|pay|paid).{0,20}(rank|ranking|recommend|placement|top of|first result)|recommend.{0,20}(for (a )?(fee|payment|pay))|pay.?per.?lead/.test(blob)) {
    return { ok: false, rule: '7.2', reason: `Paying anything of value for a recommendation or rank is prohibited. ${ABA_RULES['7.2']}` };
  }

  // --- Allowed: flat-fee advertising / listing ---
  const allowedTypes = new Set(['flat-fee', 'flat_fee', 'flatfee', 'flat', 'listing', 'advertising', 'ad', 'display-ad', 'premium-profile', 'premium', 'featured', 'sponsorship', '']);
  const amountNum = Number(offer.amount ?? offer.price ?? offer.value);
  const looksFlat = Number.isFinite(amountNum) && amountNum >= 0;
  if (allowedTypes.has(type) || looksFlat) {
    return {
      ok: true,
      rule: null,
      normalized: {
        type: type || 'flat-fee',
        model: 'flat-fee',
        amount: Number.isFinite(amountNum) ? amountNum : null,
        currency: offer.currency || 'USD',
        disclosure: 'paid advertising',
      },
    };
  }
  return { ok: false, rule: null, reason: `Unrecognized offer type "${offer.type}". Only flat-fee advertising/listings are permitted (ABA Rules 5.4 & 7.2).` };
}

// ---------------------------------------------------------------------------
// Rendering — escaped HTML, public facts only, NO score/stars, UPL line always present.
// ---------------------------------------------------------------------------

function statusBadge(status) {
  const s = esc(status || 'unknown');
  return `<span class="bar-status bar-status-${s}">${s}</span>`;
}

function renderDiscipline(discipline) {
  if (!Array.isArray(discipline) || discipline.length === 0) {
    return '<p class="discipline-none">No public discipline on record.</p>';
  }
  const items = discipline.map((d) => {
    const date = d.date ? `<span class="disc-date">${esc(d.date)}</span> ` : '';
    const action = `<span class="disc-action">${esc(d.action || 'Disciplinary action')}</span>`;
    const src = d.source
      ? ` <a class="disc-source" href="${esc(d.source)}" rel="nofollow noopener">[source]</a>`
      : ' <span class="disc-source disc-source-missing">[source not provided]</span>';
    return `    <li>${date}${action}${src}</li>`;
  }).join('\n');
  return `<ul class="discipline-list">\n${items}\n  </ul>`;
}

/**
 * Render a single attorney profile. Verified bar facts + discipline (with sources). NO rating, NO
 * score, NO stars — by design. Carries the not-advice line, and (when listingTier is a paid tier)
 * the "paid advertising" disclosure.
 */
export function renderProfile(attorney) {
  const a = attorney || {};
  const name = esc(a.name || 'Unknown attorney');
  const bar = a.barNumber ? `<span class="bar-number">Bar #${esc(a.barNumber)}</span>` : '';
  const state = a.state ? `<span class="bar-state">${esc(a.state)}</span>` : '';
  const admitted = a.admitted ? `<p class="bar-admitted">Admitted: ${esc(a.admitted)}</p>` : '';
  const areas = Array.isArray(a.practiceAreas) && a.practiceAreas.length
    ? `<p class="practice-areas">Practice areas: ${a.practiceAreas.map((p) => esc(p)).join(', ')}</p>`
    : '';

  // disclose paid advertising when this profile is a paid listing tier
  let adTag = '';
  const tier = a.listingTier || a.tier;
  if (tier) {
    try {
      const priced = priceListing({ tier });
      if (priced.isAdvertising) adTag = '<p class="paid-ad-disclosure">Listing is paid advertising.</p>';
    } catch { /* unknown tier → no tag */ }
  }
  if (!adTag && a.isPaidListing === true) adTag = '<p class="paid-ad-disclosure">Listing is paid advertising.</p>';

  return `<article class="attorney-profile">
  <header>
    <h2 class="attorney-name">${name}</h2>
    <div class="bar-line">${[statusBadge(a.status), bar, state].filter(Boolean).join(' ')}</div>
  </header>
  ${admitted}
  ${areas}
  <section class="discipline">
    <h3>Discipline history</h3>
    ${renderDiscipline(a.discipline)}
  </section>
  ${adTag}
  <p class="not-advice">${esc(NOT_ADVICE)}</p>
</article>`;
}

/**
 * Render a directory (list) of attorney results. Same guarantees as renderProfile: escaped, no
 * score/stars, not-advice line present once for the directory.
 */
export function renderDirectory(results) {
  const rows = Array.isArray(results) ? results : [];
  if (rows.length === 0) {
    return `<div class="attorney-directory">
  <p class="no-results">No matching public bar records.</p>
  <p class="not-advice">${esc(NOT_ADVICE)}</p>
</div>`;
  }
  const cards = rows.map((a) => renderProfile(a)).join('\n');
  return `<div class="attorney-directory">
${cards}
  <p class="not-advice">${esc(NOT_ADVICE)}</p>
</div>`;
}

/** Render the fully-clean public-interest set as escaped HTML. */
export function renderPublicInterest() {
  const sections = Object.entries(PUBLIC_INTEREST).map(([cat, entries]) => {
    const items = entries.map((e) =>
      `      <li><a href="${esc(e.url)}" rel="noopener">${esc(e.name)}</a> — ${esc(e.note || '')}</li>`
    ).join('\n');
    return `  <section class="pi-section">
    <h3>${esc(cat)}</h3>
    <ul>\n${items}\n    </ul>
  </section>`;
  }).join('\n');
  return `<div class="public-interest">
${sections}
  <p class="not-advice">${esc(NOT_ADVICE)}</p>
</div>`;
}

// ---------------------------------------------------------------------------
// CLI (guarded) — demo with a canned record; no network needed.
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('lawyer-directory.mjs')) {
  const demo = normalizeBarRecord({
    name: 'Jane Q. Public', barNumber: '123456', status: 'Active in Good Standing',
    admitted: '2008-11-14', practiceAreas: ['Family Law', 'Estate Planning'],
    discipline: [{ date: '2015-03-02', action: 'Public reprimand', source: 'https://example-bar.gov/d/123456' }],
  }, { state: 'CA' });
  console.log(renderProfile({ ...demo, listingTier: 'featured' }));
  console.log('\n--- monetization checks ---');
  console.log('flat-fee:', validateMonetization({ type: 'flat-fee', amount: 49 }).ok);
  console.log('fee-share:', validateMonetization({ type: 'fee-share', percent: 30 }));
  console.log('pay-for-rank:', validateMonetization({ type: 'pay-for-rank', amount: 500 }));
}
