// pitch-letters.mjs — INDIVIDUAL pitch letters, one per outlet, written to be sent by hand.
//
// ⚠️ THIS IS DELIBERATELY NOT A CAMPAIGN TOOL, and that is the whole design.
//
// Herald is the mass cold-email engine: CAN-SPAM footers, unsubscribe headers, bounce webhooks,
// sequences. That machinery is correct for marketing and WRONG for an editor. An unsubscribe footer
// on a pitch marks it as a PR blast before the first line is read, and editors in a small vertical
// compare notes — seven byte-identical sends to seven food magazines on one afternoon is a thing they
// notice, and it is already in this operator's Sent folder.
//
// So this module produces TEXT, not sends. Each letter names the outlet, says why THAT outlet, and
// carries the one hook that fits their beat. It goes out from the operator's own mailbox, one at a
// time, like a person wrote it — because a person did.
//
// Two forms, mirroring paying-markets.mjs:
//   pitch  — a first approach to an editor who has never heard from you. Subject stands alone.
//   notice — a continuing one-way thread to a standing list, where the record is the purpose and
//            "Re:" is accurate. Different instrument; it is not softened into a pitch.
//
// Pure string building. No network, no keys, nothing is sent from here.

import { MARKETS, ASSETS, asset, byId, marketsFor, subjectFor } from './paying-markets.mjs';

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** Why THIS outlet — the sentence that proves the letter was not mail-merged. */
export const WHY_THEM = Object.freeze({
  ehrp: 'you commission work from people who have lived the systems they report on, which is the position I am writing from rather than a frame I am adopting',
  bolts: 'you cover county-level power specifically, and this is a county story before it is a federal one',
  filter: 'you publish drug-policy reporting by people directly affected by the policy',
  chacruna: 'your Religious Freedom work overlaps this petition directly',
  'religion-news': 'this is a religious-liberty story with a federal audit behind it rather than an assertion',
  undark: 'you run science journalism with a policy edge, and the mechanism here is pharmacological before it is legal',
  sapiens: 'ethnobotany and ritual practice are core subjects for you',
  'issues-sci-tech': 'this is a science-policy failure with a documented paper trail',
  ambrook: 'you publish the "here is the federal money and how it actually works" piece',
  'growing-for-market': 'your readers are exactly the growers this programme is written for and mostly do not know it exists',
  sprudge: 'you cover coffee seriously enough to run something with pharmacology in it',
  'ieee-spectrum': 'you publish technology explained by the people building it',
  protos: 'you are sceptical about headline metrics, and this is an argument that one of them is fiction',
  'ledger-journal': 'this is peer-reviewable work and you publish it without an author fee',
  ethresearch: 'this belongs in front of protocol people who will argue with it',
  'texas-monthly': 'this is a Texas institutional story',
  'd-magazine': 'this happened in your circulation area',
  'the-appeal': 'this is a criminal-legal-system failure documented from inside it',
  'balls-strikes': 'you write critically about what courts actually do',
  propublica: 'this may be more useful to you as a tip than as a pitch — the documents are the story',
});

/** The operator's own line. Kept short: credentials belong after the hook, never before it. */
export const BYLINE = Object.freeze({
  name: '',                 // filled at send time — never hardcode an identity into a shared module
  standing: 'I am one of the twenty-four petitioners the GAO counted.',
  corpus: 'The supporting record is documented and I can supply it.',
});

/**
 * Build one letter. `to` is the outlet id, `assetId` the finished piece.
 * Returns { subject, body, outlet, warnings } — warnings are things to fix BEFORE sending.
 */
export function letter(assetId, outletId, { from = '', mode = 'pitch', thread = '' } = {}) {
  const a = asset(assetId);
  const o = byId(outletId);
  if (!a || !o) return null;

  const warnings = [];
  if (!from) warnings.push('no sender name set — sign it before sending');
  if (!o.rateVerified) warnings.push(`${o.name}: rate is unverified — check their guidelines`);
  if (/noreply|no-reply/i.test(o.route)) warnings.push(`${o.name}: route looks like a noreply address`);
  if (/^info@/i.test(o.route)) warnings.push(`${o.name}: info@ is the lowest-yield address here`);
  if (o.pitched) warnings.push(`${o.name}: already contacted — make this a deliberate follow-up, not a duplicate`);
  if (/unpaid|staff-written|APC/i.test(String(o.pay))) warnings.push(`${o.name}: pay is "${o.pay}" — send for reach or standing, not income`);

  const why = WHY_THEM[outletId]
    ? `I am sending this to ${o.name} because ${WHY_THEM[outletId]}.`
    : `I am sending this to ${o.name} because it sits squarely in your ${o.beats[0]} coverage.`;

  const subject = subjectFor(assetId, { mode, thread });

  const body = mode === 'notice'
    ? [
      'Continuing the thread.',
      '',
      clean(a.pitch),
      '',
      BYLINE.corpus,
      '',
      from ? `— ${from}` : '—',
    ].join('\n')
    : [
      'Hello,',
      '',
      clean(a.pitch),
      '',
      why,
      '',
      `I can have a draft to you on your usual timeline, and I can send the underlying documents first if you would rather assess those before commissioning anything.`,
      '',
      from ? `— ${from}` : '—',
    ].join('\n');

  return { outlet: o.name, route: o.route, url: o.url, subject, body, warnings };
}

/** Every letter for one piece, unpitched outlets first — that is the order to work in. */
export function lettersFor(assetId, opts = {}) {
  return marketsFor(assetId).map((o) => letter(assetId, o.id, opts)).filter(Boolean);
}

/**
 * ⚠️ A guard, not a feature. If two letters going out on the same day are byte-identical in the
 * body, they are a mail-merge and will read as one. This is what happened with seven food magazines
 * in a single afternoon.
 */
export function duplicateBodies(letters = []) {
  const seen = new Map();
  for (const l of letters) {
    const k = l.body.trim();
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(l.outlet);
  }
  return [...seen.values()].filter((g) => g.length > 1);
}

/** Plain-text bundle for a human to work through, one outlet at a time. */
export function renderBundle(assetId, opts = {}) {
  const a = asset(assetId);
  if (!a) return '';
  const ls = lettersFor(assetId, opts);
  const dupes = duplicateBodies(ls);
  const out = [`# ${a.title}`, `${ls.length} outlets`, ''];
  if (dupes.length) {
    out.push('⚠️ IDENTICAL BODIES — personalise before sending:', ...dupes.map((g) => `   ${g.join(' / ')}`), '');
  }
  for (const l of ls) {
    out.push('─'.repeat(78), `TO:      ${l.outlet}  (${l.route})`, `URL:     ${l.url}`, `SUBJECT: ${l.subject}`, '');
    out.push(l.body, '');
    if (l.warnings.length) out.push(...l.warnings.map((w) => `   ⚠️ ${w}`), '');
  }
  return out.join('\n');
}

export const assets = () => ASSETS.map((a) => ({ id: a.id, title: a.title, outlets: marketsFor(a.id).length }));
export const outletCount = () => MARKETS.length;
