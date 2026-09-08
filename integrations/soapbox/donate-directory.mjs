// donate-directory — find an organisation worth giving to, and put an honest donate button on a page.
//
// TWO DECISIONS SHAPE THIS WHOLE MODULE.
//
// 1. WE NEVER TOUCH THE MONEY. A button generated here links to the organisation's OWN donation page.
//    Donor pays the charity directly; nothing routes through us. That is not timidity, it is what
//    keeps this a product instead of a licensing project: handling other people's charitable
//    donations makes you a money transmitter (state-by-state licensing) and, since 2023, a
//    "charitable fundraising platform" under California AB 488 — which requires registration with the
//    CA Attorney General, written charity consent, and quarterly reporting. Roughly forty states also
//    require charitable-solicitation registration. A direct link needs none of it, takes no cut, and
//    is what a donor actually trusts.
//
// 2. VERIFICATION IS THE PRODUCT. Anyone can list charities; the listing is not the valuable part.
//    The valuable part is the question a donor cannot easily answer themselves: is this organisation
//    real, is it still exempt, and is my gift actually deductible? Exempt status is revoked
//    automatically when an organisation fails to file a Form 990 for three consecutive years, the IRS
//    publishes that list, and revoked organisations frequently keep soliciting anyway — sometimes
//    without knowing. So this module refuses to render a donate button for an organisation it has not
//    checked, and renders a warning rather than a call-to-action for one that fails.
//
// Nothing here processes a payment, and nothing asserts an organisation is legitimate on our say-so —
// every claim points at the IRS record it came from.

const str = (s) => String(s == null ? '' : s).trim();
const low = (s) => str(s).toLowerCase();

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export const NOT_ADVICE =
  'Deductibility shown here is the IRS record for the organisation, not tax advice about your return. '
  + 'What you may deduct depends on your circumstances — ask a tax professional.';

// ── where the truth comes from ────────────────────────────────────────────────────────────────────
// Free, authoritative, and first-party. No aggregator is listed as a source of truth: an aggregator
// is a copy, and a copy of a revocation list is exactly the thing you cannot afford to have stale.
export const SOURCES = Object.freeze([
  {
    id: 'irs-teos', name: 'IRS Tax Exempt Organization Search',
    url: 'https://apps.irs.gov/app/eos/',
    what: 'The authoritative record: whether an EIN is exempt, under which subsection, and whether gifts are deductible.',
    keyless: true,
  },
  {
    id: 'irs-bmf', name: 'IRS Exempt Organizations Business Master File',
    url: 'https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf',
    what: 'Bulk extract of every exempt organisation — name, EIN, address, NTEE code, deductibility. The list to build a directory from.',
    keyless: true, bulk: true,
  },
  {
    id: 'irs-revocation', name: 'IRS Automatic Revocation of Exemption List',
    url: 'https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads',
    what: 'Organisations whose exemption was revoked for three consecutive years of unfiled 990s. The single most important check, and the one a donor never runs.',
    keyless: true, bulk: true,
  },
  {
    id: 'propublica-990', name: 'ProPublica Nonprofit Explorer API',
    url: 'https://projects.propublica.org/nonprofits/api',
    what: 'Form 990 filings as JSON — revenue, expenses, officer pay. Useful context; NOT a substitute for the IRS record.',
    keyless: true, api: 'https://projects.propublica.org/nonprofits/api/v2',
  },
]);

export const sourceById = (id) => SOURCES.find((s) => s.id === low(id)) || null;

// ── causes ────────────────────────────────────────────────────────────────────────────────────────
// Grouped by what a person actually searches for, mapped to the IRS NTEE letters underneath so the
// BMF extract can be filtered without inventing our own taxonomy.
export const CAUSES = Object.freeze([
  { id: 'food', name: 'Food & hunger', ntee: ['K'], q: 'food bank pantry hunger meals' },
  { id: 'housing', name: 'Housing & homelessness', ntee: ['L'], q: 'shelter housing homeless' },
  { id: 'health', name: 'Health & medical', ntee: ['E', 'F', 'G', 'H'], q: 'clinic hospital health mental' },
  { id: 'education', name: 'Education & youth', ntee: ['B', 'O'], q: 'school scholarship tutoring youth' },
  { id: 'legal', name: 'Legal aid & civil rights', ntee: ['I', 'R'], q: 'legal aid defender civil rights' },
  { id: 'religion', name: 'Religious & spiritual', ntee: ['X'], q: 'temple church mosque congregation ministry' },
  { id: 'arts', name: 'Arts & culture', ntee: ['A'], q: 'museum theatre arts music library' },
  { id: 'environment', name: 'Environment & animals', ntee: ['C', 'D'], q: 'conservation wildlife animal rescue' },
  { id: 'community', name: 'Community & mutual aid', ntee: ['S', 'W'], q: 'community development mutual aid neighbourhood' },
  { id: 'disaster', name: 'Disaster & emergency relief', ntee: ['M'], q: 'disaster relief emergency fire flood' },
  { id: 'international', name: 'International', ntee: ['Q'], q: 'international development relief abroad' },
]);

export const cause = (id) => CAUSES.find((c) => c.id === low(id)) || null;
export const causeForNtee = (code) => {
  const letter = str(code).charAt(0).toUpperCase();
  return CAUSES.find((c) => c.ntee.includes(letter)) || null;
};

// ── EINs ──────────────────────────────────────────────────────────────────────────────────────────
/** Digits only. A US EIN is nine digits, conventionally written NN-NNNNNNN. */
export const normalizeEin = (v) => str(v).replace(/[^0-9]/g, '');
export const isValidEin = (v) => /^[0-9]{9}$/.test(normalizeEin(v));
export const formatEin = (v) => (isValidEin(v) ? `${normalizeEin(v).slice(0, 2)}-${normalizeEin(v).slice(2)}` : '');

// ── verification ──────────────────────────────────────────────────────────────────────────────────
/**
 * The verdicts, and the one rule that matters: NOT-CHECKED IS THE DEFAULT.
 *
 * An organisation is never "verified" because nobody found a problem. It is verified only when a
 * check actually ran and returned an answer. Every other path — no network, a timeout, a malformed
 * response, an EIN that is not nine digits — lands on `unverified`, and `donateButton()` will not
 * render a call-to-action for it.
 */
export const VERDICTS = Object.freeze({
  verified: 'exempt on the IRS record, and not on the automatic-revocation list',
  revoked: 'exemption automatically revoked for three consecutive years of unfiled Form 990s',
  'not-exempt': 'the IRS has no exempt record for this EIN',
  unverified: 'not checked, or the check could not complete — this is the default, never an assumption',
});

const RESULT = (verdict, extra = {}) => ({
  verdict, ok: verdict === 'verified', why: VERDICTS[verdict], checkedAt: null, sources: [], ...extra,
});

/**
 * Check one organisation. Soft-fails to `unverified` on absolutely everything, because a directory
 * that throws on a bad EIN checks nothing, and a directory that guesses is worse than no directory.
 *
 * `lookup` is injected so this stays offline in tests and so the caller decides which data source
 * backs it — a live IRS query, or a local copy of the BMF and revocation extracts. It must return
 * `{ exempt, deductible, revoked, name, subsection }` or throw.
 */
export async function verifyOrg({ ein, name = '' } = {}, { lookup = null, now = () => new Date() } = {}) {
  const id = normalizeEin(ein);
  if (!isValidEin(id)) {
    return RESULT('unverified', { ein: str(ein), name: str(name), why: 'not a nine-digit EIN — nothing to check against' });
  }
  if (typeof lookup !== 'function') {
    return RESULT('unverified', { ein: formatEin(id), name: str(name), why: 'no lookup was supplied, so no check ran' });
  }
  let rec;
  try { rec = await lookup(id); } catch (e) {
    return RESULT('unverified', { ein: formatEin(id), name: str(name), why: `the check did not complete: ${str(e && e.message) || 'lookup failed'}` });
  }
  if (!rec || typeof rec !== 'object') {
    return RESULT('unverified', { ein: formatEin(id), name: str(name), why: 'the lookup returned nothing' });
  }
  const at = now().toISOString();
  const base = { ein: formatEin(id), name: str(rec.name) || str(name), checkedAt: at, sources: ['irs-teos', 'irs-revocation'] };
  // Revocation is checked FIRST and on its own. A revoked organisation is frequently still listed as
  // exempt in a stale copy of the master file, and it is the failure mode that costs a donor a
  // deduction they thought they had.
  if (rec.revoked === true) return { ...RESULT('revoked'), ...base, deductible: false };
  if (rec.exempt !== true) return { ...RESULT('not-exempt'), ...base, deductible: false };
  return { ...RESULT('verified'), ...base, deductible: rec.deductible === true, subsection: str(rec.subsection) };
}

// ── the button ────────────────────────────────────────────────────────────────────────────────────
/**
 * A donate button an organisation can paste onto its own page.
 *
 * It links to THEIR donation URL — we are not in the path. What the button adds is the thing a bare
 * link cannot carry: the EIN, the date the exemption was checked, and an honest deductibility line.
 *
 * It cannot be made to lie. There is no option to render a call-to-action for an organisation that
 * failed or skipped verification; that argument does not exist, so no caller can pass it. A revoked
 * organisation renders a warning, because a donor about to give to one is exactly who needs to know.
 */
export function donateButton(org = {}, verification = null, { label = 'Donate', compact = false } = {}) {
  const name = str(org.name);
  const url = str(org.donateUrl || org.url);
  const v = verification || RESULT('unverified');
  if (!name) return { ok: false, code: 'no-name', reason: 'an organisation with no name is not one', html: '' };
  if (!/^https:\/\//i.test(url)) {
    return {
      ok: false, code: 'no-https-url',
      reason: `${name} has no https donation link. A donate button over plain http, or with no link at `
            + 'all, is how a donor ends up somewhere else entirely.',
      html: '',
    };
  }
  const einLine = v.ein ? `EIN ${esc(v.ein)}` : '';

  if (v.verdict === 'revoked') {
    return {
      ok: false, code: 'revoked', reason: `${name}'s exempt status has been automatically revoked.`,
      html: `<div class="sb-donate sb-donate-warn" role="note">`
          + `<strong>${esc(name)}</strong> — the IRS lists this organisation's tax exemption as `
          + `<strong>automatically revoked</strong> for unfiled Form 990s${einLine ? ` (${einLine})` : ''}. `
          + `A gift may not be deductible. <a href="https://apps.irs.gov/app/eos/" rel="noopener noreferrer nofollow" target="_blank">Check the IRS record</a> before giving.`
          + `</div>`,
    };
  }
  if (v.verdict !== 'verified') {
    return {
      ok: false, code: 'unverified',
      reason: `${name} has not been verified against the IRS record, so no donate button is rendered. `
            + `${v.why || ''}`.trim(),
      html: '',
    };
  }

  const ded = v.deductible
    ? 'Contributions are tax-deductible per the IRS record.'
    : 'The IRS record does NOT show contributions to this organisation as deductible.';
  const checked = v.checkedAt ? `Exemption checked ${esc(String(v.checkedAt).slice(0, 10))}.` : '';
  const foot = compact ? '' : `<div class="sb-donate-note">${esc(einLine)}${einLine ? ' · ' : ''}${esc(ded)} ${esc(checked)}<br>${esc(NOT_ADVICE)}</div>`;
  return {
    ok: true, code: 'ok', reason: '',
    html: `<div class="sb-donate">`
        + `<a class="sb-donate-btn" href="${esc(url)}" rel="noopener noreferrer" target="_blank">`
        + `${esc(label)} — ${esc(name)}</a>${foot}</div>`,
  };
}

/** The stylesheet for the button, served separately so a host page can override it. */
export const BUTTON_CSS = `.sb-donate{font:14px/1.45 system-ui,sans-serif;max-width:34rem}
.sb-donate-btn{display:inline-block;padding:.6rem 1.1rem;border-radius:.4rem;background:#1f6feb;color:#fff;text-decoration:none;font-weight:600}
.sb-donate-btn:hover{background:#1a5fd0}
.sb-donate-note{margin-top:.5rem;font-size:12px;opacity:.8}
.sb-donate-warn{padding:.7rem .9rem;border:1px solid #b45309;border-radius:.4rem;background:#fffbeb;color:#7c2d12}`;

// ── discovery ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Search a list of organisations. The list is supplied by the caller — this module holds no copy of
 * the master file, because a copy of a revocation list goes stale and a stale revocation list is
 * worse than none.
 *
 * Verified organisations sort first. Not as a ranking of worth — as a statement of what we checked.
 */
export function search(orgs = [], { q = '', causeId = '', state = '', limit = 25 } = {}) {
  const needle = low(q);
  const c = causeId ? cause(causeId) : null;
  const hits = orgs.filter((o) => {
    if (!o || !str(o.name)) return false;
    if (state && low(o.state) !== low(state)) return false;
    if (c) {
      const letter = str(o.ntee).charAt(0).toUpperCase();
      if (!c.ntee.includes(letter)) return false;
    }
    if (!needle) return true;
    return [o.name, o.city, o.state, o.mission, o.ntee].map(low).join(' ').includes(needle);
  });
  const rank = (o) => (o.verification && o.verification.verdict === 'verified' ? 0 : 1);
  return hits
    .sort((a, b) => rank(a) - rank(b) || str(a.name).localeCompare(str(b.name)))
    .slice(0, Math.max(0, limit));
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'donate-directory',
    causes: CAUSES.map((c) => ({ id: c.id, name: c.name })),
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name, url: s.url })),
    verdicts: VERDICTS,
    weTakeNoMoney: 'Buttons link to the organisation\'s own donation page. Nothing routes through us.',
    notAdvice: NOT_ADVICE,
  }, null, 2));
}




// ── giving at checkout ────────────────────────────────────────────────────────────────────────────
//
// Operator: "we want it to be Integrated in so it's in People's Sales for Processing." A merchant
// running checkout through SoapBox lets a customer add a donation to a purchase.
//
// THE SPLIT KEEPS US OUT OF CUSTODY. One charge, two destinations: the sale settles to the merchant's
// connected account and the donation to the charity's, and neither passes through an account of ours.
// Taking a fee does not change that posture — CUSTODY is what makes a business a money transmitter,
// not margin. So the fee is fine and holding the money is not.
//
// THE FORK THAT HAS TEETH — who is the donor?
//
//   customer  The customer chooses to add an amount. It is THEIR gift, the charity receipts THEM, and
//             the merchant is a conduit. This is the clean one and it is what we build.
//
//   merchant  "We donate 1% of every sale." That is a CHARITABLE SALES PROMOTION — a commercial
//             co-venture — and about twenty-five states regulate it. New York, Massachusetts, Alabama
//             and South Carolina require a BOND. Most require a written contract with the charity and
//             disclosure of the exact amount per purchase. We do not refuse it, because it is legal and
//             common; we refuse to let a merchant switch it on without being told, because walking a
//             small business into an unregistered co-venture is a real harm we would have caused.
export const DONOR_MODELS = Object.freeze({
  customer: {
    id: 'customer',
    what: 'The customer opts in and adds an amount. Their gift, their receipt, from the charity.',
    coVenture: false,
    needs: ['clear disclosure that the added amount is a donation and not part of the purchase'],
  },
  merchant: {
    id: 'merchant',
    what: 'The merchant advertises that a purchase benefits a charity ("1% of every sale").',
    coVenture: true,
    needs: [
      'a written contract with the charity',
      'disclosure of the exact amount or percentage per purchase',
      'commercial co-venture registration in the states that require it',
      'a surety bond in NY, MA, AL and SC',
    ],
  },
});

/** Round a money amount to whole cents without float drift. */
const cents = (n) => Math.round(Number(n) * 100);
const money = (c) => Math.round(c) / 100;

/**
 * What the charity actually receives, stated before anyone agrees to anything.
 *
 * Every donation UI should show the net, because the gap between "I gave $10" and "they got $9.41" is
 * where trust is lost — and because the honest version converts better anyway: a donor who is offered
 * the choice to cover the fee usually takes it.
 *
 * Processor cost is passed through AT COST. `platformBps` is ours, and it is applied to the DONATION
 * only, never to the sale — taking a cut of a merchant's revenue because a customer happened to give
 * is indefensible.
 */
export function feeBreakdown({
  saleAmount = 0, donationAmount = 0, platformBps = 0,
  processorPct = 2.2, processorFixed = 0.30, donorCoversFees = false,
} = {}) {
  const sale = Math.max(0, cents(saleAmount));
  const gift = Math.max(0, cents(donationAmount));
  if (!gift) {
    return {
      ok: false, reason: 'no donation amount', sale: money(sale), donation: 0,
      charityReceives: 0, processorFee: 0, platformFee: 0, donorPays: money(sale),
    };
  }
  // The processor charges on the whole charge; the donation's share of that cost is proportional, and
  // the fixed component belongs to the transaction as a whole, not to the gift.
  const total = sale + gift;
  const procTotal = Math.round(total * (Number(processorPct) / 100)) + cents(processorFixed);
  const procOnGift = total > 0 ? Math.round(procTotal * (gift / total)) : 0;
  const platformFee = Math.round(gift * (Math.max(0, Number(platformBps)) / 10000));

  // If the donor covers fees, the gift arrives whole and the donor pays the difference on top.
  const charityReceives = donorCoversFees ? gift : Math.max(0, gift - procOnGift - platformFee);
  const donorPays = donorCoversFees ? total + procOnGift + platformFee : total;
  return {
    ok: true,
    sale: money(sale),
    donation: money(gift),
    processorFee: money(procOnGift),
    platformFee: money(platformFee),
    charityReceives: money(charityReceives),
    donorPays: money(donorPays),
    donorCoversFees: Boolean(donorCoversFees),
    note: donorCoversFees
      ? 'The donor covered the fees, so the charity receives the full gift.'
      : 'Fees come out of the gift. Offering the donor the option to cover them is usually taken.',
  };
}

/**
 * Can this charity be offered inside a merchant's checkout?
 *
 * This is the check that makes the product worth paying for, and it is stricter than the one for a
 * button on the charity's own page — because here the MERCHANT is vouching for the charity to their
 * own customers. If its exemption has been revoked, that merchant is telling their customers "this is
 * a charity" while the IRS says it is not. That is the merchant's exposure, and it is why the check
 * must be CONTINUOUS: revocation happens after you integrate, not before.
 */
export function checkoutEligibility(org = {}, verification = null, { model = 'customer', maxAgeDays = 30, now = () => new Date() } = {}) {
  const m = DONOR_MODELS[low(model)] || DONOR_MODELS.customer;
  const v = verification || { verdict: 'unverified' };
  const problems = [];
  if (v.verdict === 'revoked') {
    problems.push('exemption automatically revoked — a merchant offering this to customers is vouching for an organisation the IRS no longer lists as exempt');
  } else if (v.verdict !== 'verified') {
    problems.push(`not verified against the IRS record (${v.verdict}) — a checkout placement requires a current check, not an assumption`);
  }
  if (v.verdict === 'verified' && v.checkedAt) {
    const ageDays = (now().getTime() - new Date(v.checkedAt).getTime()) / 86400000;
    if (!(ageDays >= 0)) problems.push('the verification date is not readable');
    else if (ageDays > maxAgeDays) {
      problems.push(`the exemption was last checked ${Math.floor(ageDays)} days ago — re-check before it stays in a checkout`);
    }
  }
  if (!/^https:\/\//i.test(str(org.donateUrl || org.url || ''))) {
    problems.push('no https destination for the charity');
  }
  return {
    ok: problems.length === 0,
    model: m.id,
    coVenture: m.coVenture,
    // Not a refusal. The merchant is told, and the telling is the point.
    mustDoFirst: m.coVenture ? [...m.needs] : [...m.needs],
    problems,
    recheckEvery: `${maxAgeDays} days`,
  };
}

/** The disclosure line a checkout must show. Not optional, and not ours to soften. */
export function checkoutDisclosure(org = {}, breakdown = {}, { model = 'customer' } = {}) {
  const name = esc(str(org.name));
  if (DONOR_MODELS[low(model)] === DONOR_MODELS.merchant || low(model) === 'merchant') {
    return `${name} receives a contribution from this merchant on this purchase. `
         + 'The amount is set by the merchant and is not an additional charge to you.';
  }
  const amt = Number(breakdown.donation || 0).toFixed(2);
  const net = Number(breakdown.charityReceives || 0).toFixed(2);
  return `You are adding a $${esc(amt)} donation to ${name}. This is a donation, not part of your `
       + `purchase. ${name} receives $${esc(net)} after payment processing. Your receipt for the `
       + 'donation comes from the organisation, not from this store.';
}

export default {
  CAUSES, SOURCES, VERDICTS, cause, causeForNtee, sourceById,
  normalizeEin, isValidEin, formatEin, verifyOrg, donateButton, BUTTON_CSS, search, handler,
  DONOR_MODELS, feeBreakdown, checkoutEligibility, checkoutDisclosure,
};

if (process.argv[1] && process.argv[1].endsWith('donate-directory.mjs')) {
  console.log(JSON.stringify({
    causes: CAUSES.length, sources: SOURCES.map((s) => s.id), verdicts: Object.keys(VERDICTS),
    note: 'This module never handles a donation. Buttons link to the charity directly.',
  }, null, 1));
}
