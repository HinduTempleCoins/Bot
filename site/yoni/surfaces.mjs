// site/yoni/surfaces.mjs — the gated surfaces of YoniShrine, and what each one actually requires.
//
// ⭐ ONE RENDERER, LEVELS READ FROM THE POLICY ENGINE.
// Every surface here takes its gate level from integrations/agegate SURFACE_POLICY rather than
// restating it. A page that hard-codes "verified" drifts the moment the policy changes, and the
// drift is silent. Ask the model; render the answer.
//
// ⭐ THE REQUIREMENTS BELOW ARE CARD-NETWORK RULES, NOT HOUSE PREFERENCE.
// Mastercard AN 5196 (14 Apr 2021, deadline 15 Oct 2021), now Rules § 9.4.1, keys its adult controls
// to MERCHANT CATEGORY CODE 5967 — not to how explicit the content is. Non-explicit art nude in a
// card-processing subscription is an MCC 5967 merchant carrying the full burden. That is why these
// obligations sit on the gallery and video surfaces too, and why "tasteful" buys nothing here.
// See .local/ADULT_CAM_MARKET_RESEARCH.md §5.5.
//
// ⭐ LIVE IS THE STRICT ONE.
// § 9.4.1 requires live streams to run on a platform the MERCHANT CONTROLS, with real-time
// monitoring and immediate removal. AI moderation may assist; flagged content still needs a human.
// An embedded third-party cam widget does not satisfy that, which is a build constraint, not a note.
//
// House style: ESM, pure, esc() all interpolation, soft-fail-never-throw.

import { policyFor, check as gateCheck, LEVELS, rank } from '../../integrations/agegate/model.mjs';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Mastercard Rules § 9.4.1 — the controls every monetised surface carries. Source in the header. */
export const CARD_CONTROLS = Object.freeze([
  'Registration under MCC 5967 through the Specialty Merchant Registration Program, done by the acquirer, completed before the first transaction.',
  'Government-issued photo ID for every person depicted in monetised content, validated as belonging to that person.',
  'Written consent from each depicted person covering depiction, public distribution, upload, and download where the file is downloadable.',
  'Pre-publication review of all content. AI moderation may assist, but flagged items need human review.',
  'A public complaint mechanism, complaints resolved within seven business days, illegal content removed immediately.',
  'An appeals and removal process for any depicted person; where consent cannot be established, immediate removal. Disputes go to a neutral body at the merchant’s expense.',
  'Monthly reporting to the acquirer on flagged content, actions taken and complaints.',
  'Written agreements with every content provider. Solo creators are not exempt.',
]);

/** What is particular to each surface, beyond the shared controls. */
export const SURFACES = Object.freeze({
  preview: {
    title: 'Preview',
    blurb: 'The clothed or obscured teaser that gates inward. This is the one place blurring reliably buys something: it is a real surface at level none, not a watered-down version of a gated one.',
    notes: [
      'Serves a server-side derivative only. The original is never sent to the browser and then hidden with CSS.',
      'Links inward to a gated surface rather than revealing in place.',
    ],
  },
  gallery: {
    title: 'Gallery',
    blurb: 'Produced or licensed stills.',
    notes: [
      'Licensed or commissioned work with documented provenance for every image, which keeps the § 2257 record set bounded and contractual.',
      'As a secondary producer under 28 C.F.R. part 75 the operator may rely on the photographer’s § 75.7(b) certification — there is a counterparty to certify, which is the whole advantage over user uploads.',
    ],
  },
  video: {
    title: 'Video',
    blurb: 'Moving image, whether licensed or uploaded.',
    notes: [
      'Taking user uploads makes the operator a secondary producer with no counterparty to certify: the duty lands here, per uploader, permanently.',
      'Google demotes every page on a site with significant volumes of non-consensual-imagery removals, so the risk is not confined to the offending file.',
    ],
  },
  live: {
    title: 'Live',
    blurb: 'Cams.',
    notes: [
      'Mastercard § 9.4.1 requires a live stream to run on a platform the merchant controls, with real-time monitoring and immediate removal. An embedded third-party cam widget does not satisfy that.',
      'Real-time monitoring means a human reachable while the stream is running, not a review queue read the next morning.',
      'Performer identity and written consent are established before the stream opens, not after a complaint.',
    ],
  },
});

export const surfaceNames = () => Object.keys(SURFACES);

/**
 * Render one gated surface. `shell` is the caller's page wrapper so this module owns no styling.
 * Fails closed: an unknown surface gets the model's own fail-closed policy (id).
 */
export function surfacePage(name, { shell, subject = '' } = {}) {
  const key = String(name || '');
  const spec = SURFACES[key];
  if (!spec || typeof shell !== 'function') return null;
  const pol = policyFor(key);
  const state = gateCheck(subject, key);
  const cleared = !!(state && state.allowed);
  const gate = pol.level === 'none'
    ? '<b>Open.</b> <span class=mut>This surface is served without a check.</span>'
    : (cleared
      ? `<b>Cleared.</b> <span class=mut>This subject holds a current <code>${esc(pol.level)}</code> record.</span>`
      : `<b>Not cleared.</b> <span class=mut>This surface needs <code>${esc(pol.level)}</code> and nothing is served until that check is done.</span>`);

  const notes = spec.notes.map((n) => `<li>${esc(n)}</li>`).join('');
  const controls = pol.level === 'none' ? '' : `
<h2>What a monetised surface carries</h2>
<p class=mut>These are Mastercard Rules &sect; 9.4.1, keyed to merchant category code 5967 rather than
to how explicit the material is. Non-explicit work in a card-processing subscription carries the same
set.</p>
<ul>${CARD_CONTROLS.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`;

  // An ungated surface is not waiting on merchant registration or a custodian of records; saying so
  // on every page regardless of level is how a page starts describing a different surface.
  const closing = pol.level === 'none'
    ? `<div class=card><b>Nothing to show yet.</b> <span class=mut>This surface is open and needs no
check. It stays empty until there is a gated surface behind it to point inward to.</span></div>`
    : `<div class=card><b>Not open yet.</b> <span class=mut>The door is built and gated. Nothing is
served here until the custodian of records is named, the MCC 5967 registration is completed by the
acquirer, and the complaint and appeals processes are running.</span></div>`;

  return shell(`${esc(spec.title)} — YoniShrine`, `
<h1>${esc(spec.title)}</h1>
<div class=card>${gate}</div>
<p>${esc(spec.blurb)}</p>
<h2>Particular to this surface</h2>
<ul>${notes}</ul>${controls}
${closing}
<p class=mut><a href="/surfaces">&larr; all surfaces</a> &middot;
<a href="/compliance">what this property has to run</a> &middot; <a href="/">the shelf</a></p>`,
    `${spec.title}: ${spec.blurb}`);
}

/** The operating page: what has to exist before any of the gated surfaces serve anything. */
export function compliancePage({ shell } = {}) {
  if (typeof shell !== 'function') return null;
  const levels = LEVELS.map((l) => `<code>${esc(l)}</code>`).join(' &rarr; ');
  return shell('Compliance — YoniShrine', `
<h1>What this property has to run</h1>
<p class=mut>Gate levels are ordered ${levels}. Each surface declares its own, and
<code>attested</code> is never the top of the scale because a self-declaration is not sufficient under
the state age-verification statutes.</p>

<h2>The structural fork, and what our own research concluded</h2>
<p>Hosting user uploads and licensing produced work are not two flavours of the same thing. They
differ on the single largest liability in the plan.</p>
<table>
<tr><th></th><th>Licensed or commissioned</th><th>User-generated</th></tr>
<tr><td><b>&sect; 2257</b></td><td>Secondary producer, but the photographer&rsquo;s &sect; 75.7(b) certification can be relied on. A bounded, contractual record set.</td><td>Secondary producer with no counterparty to certify. The duty lands here, per uploader, permanently.</td></tr>
<tr><td><b>&sect; 9.4.1</b></td><td>Written agreement with each provider; a small, contractual provider set.</td><td>ID, consent and a written agreement for every uploader, plus pre-publication review of everything.</td></tr>
<tr><td><b>Moderation</b></td><td>Reviewed once, at acquisition.</td><td>Continuous, with human review of flagged items and proactive hash-matching.</td></tr>
<tr><td><b>Cost shape</b></td><td>Capex-like, per set.</td><td>Opex-like, scales with users, never ends.</td></tr>
</table>
<div class=card><b>The recorded recommendation is to not take user-generated content.</b>
<span class=mut>A licensed library with documented provenance converts the largest compliance
liability into a bounded contractual one. A third option &mdash; linking out and hosting no imagery
&mdash; avoids producer status entirely, since &sect; 2257(h) excludes distribution and mere linking.
The upload and video doors are built and gated so that this stays a decision rather than a
default.</span></div>

<h2>Before the first transaction</h2>
<ul>
<li>MCC 5967 registration through the Specialty Merchant Registration Program, done by the acquirer,
completed before the first transaction &mdash; not after launch.</li>
<li>A named custodian of records with title and business address, and the &sect; 2257(e) statement on
every page carrying covered material.</li>
<li>A public complaint mechanism with a seven-business-day resolution clock, and immediate removal of
illegal content.</li>
<li>An appeals route for any depicted person, with disputes to a neutral body at this property&rsquo;s
own expense.</li>
<li>Monthly reporting to the acquirer.</li>
</ul>

<h2>What the gate never stores</h2>
<p class=mut>The age gate keeps a result &mdash; method, provider reference, when it was done, when it
expires &mdash; and never the ID image, the document number or the date of birth. That refusal is
enforced in code. The &sect; 2257 records are the opposite obligation and are held by the custodian,
not by this web tier.</p>
<p class=mut><a href="/surfaces">&larr; all surfaces</a> &middot; <a href="/upload">the upload door</a>
&middot; <a href="/">the shelf</a></p>`,
    'What this property has to have running before any gated surface serves anything.');
}

export { policyFor, rank };
