// appeals-engine.mjs — the pro-se APPEALS & EXTRAORDINARY-WRIT engine for Law.SoapBox.
//
// A free, direct-to-people tool (a court self-help kiosk in software, NOT a product sold to anyone):
// pick your jurisdiction (State/DC/federal) and court level, and it lays out the EXHAUSTION LADDER —
// the fixed order in which a self-represented person must climb from a trial loss up to the
// extraordinary writs — teaches each rung in plain language, GATES the rungs so you cannot skip a step
// and "burn" a later one, generates the required fields for the document that rung needs, surfaces the
// governing statutes / cases / court, and warns about the deadlines that quietly kill an option.
//
// DISCIPLINE (inherited from the legal readers / privacy-law-map.mjs / legal-knowledge-graph.mjs):
//   • EDUCATION + a fill-in-the-blank tool, never individualized legal ADVICE. We state what a remedy
//     IS, where it sits, what the statute says, and what fields a filing needs. We never tell a
//     specific person to file a specific thing — the UPL line a court self-help kiosk must hold.
//   • Facts, not verdicts. Every statute number and case citation here is REAL and human-verified
//     (see the provenance comments); nothing is a holding-summary dressed up as advice.
//   • State-specific specifics (per-state deadlines, page limits, court names) VARY and are the one
//     thing we do NOT hard-code fifty ways — those carry verify:true and point the reader at their
//     own state's Rules of Appellate Procedure rather than a fabricated day-count.
//   • Pure + soft-fail: the ladder, gating, templates and render are offline and never throw. The
//     live legal-search wiring (cases/judges/statutes) is injected by the server and soft-fails to [].
//
//   import { LADDER, findRemedy, gateRemedy, fieldsFor, deadlinesFor, statuteCitesFor,
//            STATES, COURT_LEVELS, ORDINANCE_SOURCES, MANDAMUS_AUTHORITIES, HABEAS_AUTHORITIES,
//            renderLadder, renderRemedyDetail, renderJurisdictionSelector, renderFieldsTemplate,
//            renderDeadlines, renderOrdinanceLinks, renderDisclaimer, escapeHtml } from './appeals-engine.mjs'

// ── html escape (same contract as the readers) ────────────────────────────────────────────────
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const esc = escapeHtml;

// ── jurisdictions: the 50 states + DC + a federal namespace ───────────────────────────────────────
// Used to populate the jurisdiction selector. `code` is the postal/USPS abbreviation ('US' = federal).
export const STATES = Object.freeze([
  ['US', 'Federal (United States courts)'],
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
]);
const STATE_NAME = Object.freeze(Object.fromEntries(STATES.map(([c, n]) => [c, n])));
export function stateName(code) { return STATE_NAME[String(code || '').toUpperCase()] || ''; }

// The two states with NO intermediate appellate court — a real structural fact that changes the ladder
// (a trial loss there is reviewed directly by the state's court of last resort). Verified: these are the
// commonly-cited single-appellate-tier states. We use this only to add a teaching note, never a deadline.
const NO_INTERMEDIATE_APPELLATE = Object.freeze(new Set([
  'DE', 'ME', 'MT', 'NH', 'RI', 'SD', 'VT', 'WY', 'DC', // small-population / single high court systems
]));

// ── court levels: the vertical stack the ladder climbs through ─────────────────────────────────────
// Ordered trial → intermediate appellate → state supreme → federal district → circuit → SCOTUS. Which
// levels are IN PLAY depends on whether the case is state or federal, but the stack itself is the map.
export const COURT_LEVELS = Object.freeze([
  { id: 'trial', name: 'Trial court', track: 'state', blurb: 'Where the case was decided (a State district/superior/circuit trial court, or a municipal/county court).' },
  { id: 'intermediate', name: 'Intermediate appellate court', track: 'state', blurb: 'The first level of appeal in most states (e.g. a Court of Appeals). A few states have none.' },
  { id: 'state-supreme', name: 'State supreme court', track: 'state', blurb: 'The state court of last resort. Review here is usually discretionary.' },
  { id: 'fed-district', name: 'Federal district court', track: 'federal', blurb: 'The federal trial court — and where a federal habeas or § 1361 mandamus petition is FILED.' },
  { id: 'circuit', name: 'U.S. Court of Appeals (Circuit)', track: 'federal', blurb: 'The federal appellate court for your circuit; also hears appellate mandamus under the All Writs Act.' },
  { id: 'scotus', name: 'Supreme Court of the United States', track: 'federal', blurb: 'The final court. Review is by writ of certiorari and is almost entirely discretionary.' },
]);
export function courtLevel(id) { return COURT_LEVELS.find((c) => c.id === id) || null; }

// ── the exhaustion ladder — the load-bearing part ──────────────────────────────────────────────────
// Each rung: a stable id, a display name, the TIER (climb order), the TRACK it belongs to, the plain-
// language teaching (what it is / where it sits / why order matters / what "burning" it means), the
// governing statutes (all real, verified — see provenance), the prerequisite rungs that must come first,
// whether it is gated, and any HARD warnings that always fire. `category` selects the field template.
//
// PROVENANCE for the statute cites below (human-verified 2026-09):
//   • FRAP 4 — federal notice-of-appeal deadlines (Fed. R. App. P. 4).
//   • Fed. R. Civ. P. 59 / Fed. R. Crim. P. 33 — new-trial / reconsideration windows.
//   • Sup. Ct. R. 13 — 90-day certiorari deadline.
//   • 28 U.S.C. § 2254 (state prisoners) / § 2255 (federal prisoners) — federal habeas.
//   • 28 U.S.C. § 2254(b)(1) — exhaustion requirement.  § 2244(d)(1) / § 2255(f) — AEDPA 1-year clock.
//   • 28 U.S.C. § 2244(b) / § 2255(h) — successive-petition bar.
//   • 28 U.S.C. § 1361 — district-court mandamus jurisdiction; 28 U.S.C. § 1651 — the All Writs Act.
//   • 5 U.S.C. § 706(1) — courts "compel agency action unlawfully withheld or unreasonably delayed."
export const LADDER = Object.freeze([
  {
    id: 'direct-appeal', name: 'Direct appeal', tier: 1, track: 'both', gated: false, prereqs: [],
    category: 'brief',
    statuteMap: [
      { label: 'Federal notice-of-appeal deadlines', cite: 'Fed. R. App. P. 4' },
      { label: 'Federal appellate brief form/limits', cite: 'Fed. R. App. P. 32' },
    ],
    plain:
      'The direct appeal is the ordinary, first-as-of-right challenge to a final judgment. You ask a '
      + 'higher court to review the trial record for legal error — you generally do NOT get to add new '
      + 'evidence. It is the base of the ladder: almost everything above it assumes you took, or gave up, '
      + 'this step first.',
    ladderNote:
      'This is rung one. In most states a trial loss goes to an intermediate appellate court; a few '
      + 'states send it straight to the state supreme court. In a federal case it goes to your U.S. Court '
      + 'of Appeals (the circuit).',
    burnNote:
      'The notice of appeal has a short, hard deadline (often ~30 days). Miss it and you can lose the '
      + 'right to a direct appeal entirely — the single most common way people "burn" their whole ladder '
      + 'before they start.',
  },
  {
    id: 'reconsideration', name: 'Motion for reconsideration / new trial', tier: 2, track: 'both', gated: false, prereqs: [],
    category: 'motion',
    statuteMap: [
      { label: 'New trial / alter-or-amend (civil)', cite: 'Fed. R. Civ. P. 59' },
      { label: 'Relief from judgment (civil)', cite: 'Fed. R. Civ. P. 60' },
      { label: 'New trial (criminal)', cite: 'Fed. R. Crim. P. 33' },
    ],
    plain:
      'A motion asking the SAME court that ruled to reconsider — for legal error, or a new trial (in a '
      + 'criminal case, often on newly discovered evidence). It is filed back in the trial court, not up '
      + 'the ladder.',
    ladderNote:
      'This usually runs in parallel with, or just before, a direct appeal. Filing it can pause the clock '
      + 'to appeal in many systems — but only if you file it within its own tight window.',
    burnNote:
      'These windows are very short (civil new-trial motions are commonly ~28 days; some criminal grounds '
      + 'far shorter). A late motion is simply denied and does nothing to protect your appeal deadline.',
  },
  {
    id: 'state-postconviction', name: 'State post-conviction / state habeas', tier: 3, track: 'conviction', gated: true,
    prereqs: ['direct-appeal'], category: 'petition',
    statuteMap: [
      { label: 'Governed by each state’s post-conviction statute / rule', cite: 'State post-conviction statute (varies)' },
    ],
    plain:
      'A separate (collateral) proceeding in state court to raise things a direct appeal could not — most '
      + 'often ineffective assistance of counsel, newly discovered evidence, or a constitutional violation '
      + 'that lives outside the trial record. Every state has its own vehicle (post-conviction relief, a '
      + 'state habeas petition, a "coram nobis"-style motion, etc.).',
    ladderNote:
      'For anyone challenging a CONVICTION this rung is critical: it is where you must first present your '
      + 'federal constitutional claims to the STATE courts, all the way up, before a federal court will '
      + 'hear them. That is the "exhaustion" requirement in action.',
    burnNote:
      'Skipping or half-doing this is what "burning" federal habeas looks like: a claim you never fairly '
      + 'presented to the state’s highest court is treated as unexhausted or procedurally defaulted, '
      + 'and the federal court will refuse to hear it — often forever.',
  },
  {
    id: 'discretionary-review', name: 'Discretionary review (state supreme court)', tier: 4, track: 'both', gated: true,
    prereqs: ['direct-appeal'], category: 'petition',
    statuteMap: [
      { label: 'Governed by each state’s rules of appellate procedure', cite: 'State petition-for-review rule (varies)' },
    ],
    plain:
      'After an intermediate appellate court rules, you ask the state’s highest court to review it. In '
      + 'most states this is DISCRETIONARY — the court chooses whether to take the case (a petition for '
      + 'review / petition for discretionary review), it is not an appeal of right.',
    ladderNote:
      'This rung matters for two reasons: it can win, and it is the last state step. To exhaust a federal '
      + 'claim you generally must have asked the state’s court of last resort to hear it — even if it '
      + 'said no.',
    burnNote:
      'If you never sought discretionary review in the state’s highest court, a federal court may hold '
      + 'the claim unexhausted or defaulted. This step is often what "one full round of state review" means.',
  },
  {
    id: 'cert-scotus', name: 'Certiorari to the U.S. Supreme Court', tier: 5, track: 'both', gated: true,
    prereqs: ['direct-appeal'], category: 'petition',
    statuteMap: [
      { label: 'Certiorari deadline (90 days)', cite: 'Sup. Ct. R. 13' },
      { label: 'Certiorari jurisdiction over state judgments', cite: '28 U.S.C. § 1257' },
      { label: 'Certiorari from the federal courts of appeals', cite: '28 U.S.C. § 1254' },
    ],
    plain:
      'A petition for a writ of certiorari asks the U.S. Supreme Court to review a final judgment of a '
      + 'state court of last resort (on a federal question) or a U.S. Court of Appeals. It is almost '
      + 'entirely discretionary — the Court grants a tiny fraction of petitions.',
    ladderNote:
      'This is the top of the DIRECT-review ladder. It is not required before federal habeas, but it is '
      + 'the last chance for direct Supreme Court review of your judgment.',
    burnNote:
      'The 90-day deadline (Sup. Ct. R. 13) runs from the state high court’s final judgment or denial '
      + 'of rehearing. It is jurisdictional in effect — miss it and certiorari is gone.',
  },
  {
    id: 'federal-habeas', name: 'Federal habeas corpus (§ 2254 / § 2255)', tier: 6, track: 'conviction', gated: true,
    prereqs: ['direct-appeal', 'state-postconviction', 'discretionary-review'], category: 'habeas',
    statuteMap: [
      { label: 'State prisoners — federal habeas', cite: '28 U.S.C. § 2254' },
      { label: 'Federal prisoners — motion to vacate', cite: '28 U.S.C. § 2255' },
      { label: 'Exhaustion of state remedies required', cite: '28 U.S.C. § 2254(b)(1)' },
      { label: 'AEDPA one-year limitation (state)', cite: '28 U.S.C. § 2244(d)(1)' },
      { label: 'AEDPA one-year limitation (federal)', cite: '28 U.S.C. § 2255(f)' },
      { label: 'Second/successive petition bar', cite: '28 U.S.C. § 2244(b)' },
    ],
    plain:
      'A collateral attack in FEDERAL court on a conviction or sentence that violates the U.S. '
      + 'Constitution or federal law. State prisoners use 28 U.S.C. § 2254; federal prisoners use a '
      + '§ 2255 motion in the sentencing court. It is not a second appeal — the review is narrow and '
      + 'deferential to the state courts.',
    ladderNote:
      'This sits ABOVE all the state rungs on purpose. Congress built exhaustion in: a state prisoner '
      + 'must first give the state courts — through direct appeal AND state post-conviction, up to the '
      + 'state’s highest court — a fair chance to fix the error. Only then does the federal door open.',
    burnNote:
      'This is the rung people burn most often, and the burns are usually permanent:\n'
      + '• EXHAUSTION — filing before you have taken every federal claim through the full state process '
      + '(28 U.S.C. § 2254(b)(1)) gets the petition dismissed; see Rose v. Lundy, 455 U.S. 509 (1982).\n'
      + '• AEDPA 1-YEAR CLOCK — you generally have one year (28 U.S.C. § 2244(d)(1)) that keeps '
      + 'running; miscount it and the petition is time-barred no matter how strong it is.\n'
      + '• PROCEDURAL DEFAULT — a claim the state rejected on an independent state procedural ground is '
      + 'usually barred federally; see Coleman v. Thompson, 501 U.S. 722 (1991).\n'
      + '• SUCCESSIVE-PETITION BAR — a second petition needs a court of appeals’ permission first '
      + '(28 U.S.C. § 2244(b); § 2255(h)). Firing off a weak petition early can spend your one shot.',
    hardWarnings: [
      {
        level: 'danger',
        title: 'Exhaust state remedies FIRST — filing too soon can burn this option permanently',
        body:
          'Federal habeas is not the next appeal after a loss — it is the LAST step, and it is booby-'
          + 'trapped. Before filing you generally must have taken every federal claim through your state’s '
          + 'ENTIRE process (direct appeal AND state post-conviction) up to the state’s highest court '
          + '(28 U.S.C. § 2254(b)(1); Rose v. Lundy, 455 U.S. 509 (1982)). Filing prematurely, missing '
          + 'the AEDPA one-year clock (28 U.S.C. § 2244(d)(1)), or defaulting a claim (Coleman v. '
          + 'Thompson, 501 U.S. 722 (1991)) can lose the option forever, and a second petition needs the '
          + 'court of appeals’ permission (28 U.S.C. § 2244(b); § 2255(h)). Talk to a lawyer or a '
          + 'federal-defender’s office BEFORE you file.',
      },
    ],
  },
  {
    id: 'mandamus', name: 'Writ of mandamus (§ 1361 / All Writs Act / state)', tier: 7, track: 'agency', gated: true,
    prereqs: ['direct-appeal'], category: 'mandamus', basis: 'statute',
    statuteMap: [
      { label: 'District-court mandamus jurisdiction', cite: '28 U.S.C. § 1361' },
      { label: 'The All Writs Act', cite: '28 U.S.C. § 1651' },
      { label: 'Compel agency action unlawfully withheld / unreasonably delayed', cite: '5 U.S.C. § 706(1)' },
    ],
    lastResort: true,
    plain:
      'An extraordinary writ ordering a government officer, court, or agency to perform a clear, '
      + 'non-discretionary DUTY it is refusing to do (or, in aid of jurisdiction, to stop exceeding its '
      + 'authority). In federal district court it rests on 28 U.S.C. § 1361; appellate mandamus rests '
      + 'on the All Writs Act, 28 U.S.C. § 1651. To compel a federal AGENCY specifically, the everyday '
      + 'vehicle is the APA: 5 U.S.C. § 706(1) lets a court "compel agency action unlawfully withheld '
      + 'or unreasonably delayed."',
    ladderNote:
      'This is a LAST RESORT after all appeals fail and an agency or official still refuses. It is not a '
      + 'substitute for an appeal you could have taken. Courts reserve it for a clear right, a clear duty, '
      + 'and no other adequate remedy.',
    burnNote:
      '"The writ goes by statute now": at common law mandamus was a royal prerogative writ a court issued '
      + 'on its own inherent power. Today a federal court’s power to issue it comes from STATUTE — '
      + '§ 1361, the All Writs Act (§ 1651), and, for agencies, the APA (§ 706(1)). So you must '
      + 'anchor the petition to the statute that grants the power AND to the specific duty the law imposes '
      + 'on the official — a vague "make them do the right thing" petition fails.',
    hardWarnings: [
      {
        level: 'warn',
        title: 'Mandamus is a last resort — after all appeals fail and an agency still refuses',
        body:
          'Mandamus is reserved for a clear legal right, a clear non-discretionary duty the official '
          + 'refuses to perform, and NO other adequate remedy (an ordinary appeal is an adequate remedy, '
          + 'so it usually forecloses mandamus). To compel a federal AGENCY to act on a petition it is '
          + 'sitting on, courts apply the APA’s "unreasonably delayed" standard (5 U.S.C. § 706(1)) '
          + 'through the six TRAC factors — Telecommunications Research & Action Center v. FCC, 750 F.2d '
          + '70 (D.C. Cir. 1984) — and § 706(1) reaches only a discrete action the agency is legally '
          + 'REQUIRED to take: Norton v. Southern Utah Wilderness Alliance, 542 U.S. 55 (2004). See the '
          + 'verified authorities below, including Olsen v. DEA.',
      },
    ],
  },
  {
    id: 'coram-nobis', name: 'Writ of coram nobis', tier: 8, track: 'advanced', gated: true,
    prereqs: ['direct-appeal'], category: 'petition', basis: 'all-writs-act',
    statuteMap: [
      { label: 'Federal source of the writ', cite: '28 U.S.C. § 1651 (All Writs Act)' },
    ],
    plain:
      'An ancient writ to correct a fundamental error in a case where the sentence has already been '
      + 'served, so habeas (which requires being "in custody") is unavailable — for example, to clear '
      + 'a conviction still causing collateral consequences. In federal court it is recognized under the '
      + 'All Writs Act: United States v. Morgan, 346 U.S. 502 (1954).',
    ladderNote:
      'A narrow, late-stage tool. It is for the person no longer in custody who still needs to undo a '
      + 'conviction — not a way around the ordinary appeal or habeas you could still bring.',
    burnNote:
      'Coram nobis is granted only for errors "of the most fundamental character" and only when sound '
      + 'reasons excuse not raising the issue earlier. It is not a do-over for arguments you sat on.',
  },
  {
    id: 'prohibition', name: 'Writ of prohibition', tier: 8, track: 'advanced', gated: true,
    prereqs: ['direct-appeal'], category: 'mandamus', basis: 'all-writs-act',
    statuteMap: [
      { label: 'Federal source of the writ', cite: '28 U.S.C. § 1651 (All Writs Act)' },
    ],
    plain:
      'Mandamus’s mirror image: instead of ordering a lower court/official to ACT, prohibition orders '
      + 'it to STOP — to refrain from exceeding its jurisdiction or authority. Like mandamus it is an '
      + 'extraordinary writ under the All Writs Act (or a state equivalent).',
    ladderNote:
      'Used when a lower tribunal is about to act without power and an ordinary appeal later would not '
      + 'undo the harm. Same "clear right / no adequate alternative" bar as mandamus.',
    burnNote:
      'If an ordinary appeal can fix the problem, prohibition is refused. It is not a shortcut around the '
      + 'appellate ladder.',
  },
  {
    id: 'quo-warranto', name: 'Writ of quo warranto', tier: 8, track: 'advanced', gated: false, prereqs: [],
    category: 'petition', basis: 'statute',
    statuteMap: [
      { label: 'Governed by federal (D.C.) or state quo-warranto statutes', cite: 'Quo warranto statute (varies; e.g. D.C. Code § 16-3501 et seq.)' },
    ],
    plain:
      'A special writ challenging a person’s RIGHT to hold a public office or exercise a public '
      + 'franchise — "by what authority?" It is usually brought by a government attorney (an Attorney '
      + 'General or, federally, the U.S. Attorney), not a private individual, and it stands apart from the '
      + 'appeal/habeas ladder rather than on top of it.',
    ladderNote:
      'This is not a rung above your case — it is a distinct action about who may lawfully hold office. '
      + 'It is listed here because it is one of the classic "extraordinary writs" people ask about.',
    burnNote:
      'A private person usually lacks standing to bring quo warranto alone; the proper channel is to ask '
      + 'the responsible public attorney to bring it. Filing it yourself is commonly dismissed.',
  },
  // ── the classic writs that rest on NO dedicated statute ─────────────────────────────────────────
  // The seven below round out the extraordinary-writ shelf. Each carries a `basis`:
  //   • 'statute'        — a dedicated statute or federal rule grants the power (supersedeas, ne exeat).
  //   • 'all-writs-act'  — no dedicated statute; the federal power to issue it comes ONLY from the
  //                        All Writs Act, 28 U.S.C. § 1651 (common-law certiorari).
  //   • 'common-law'     — a pure common-law writ with NO statute of its own; in federal court it lives
  //                        (if at all) through § 1651, and several are affirmatively ABOLISHED in
  //                        federal CIVIL practice by rule (audita querela, coram vobis, scire facias).
  // PROVENANCE (human-verified 2026-09, reporter/court/year checked against the source of record):
  //   • audita querela — United States v. Ayala, 894 F.2d 425 (D.C. Cir. 1990); abolished in civil by
  //     Fed. R. Civ. P. 60(e); survives (narrowly) in criminal cases under the All Writs Act.
  //   • coram vobis — sibling of coram nobis (United States v. Morgan, 346 U.S. 502 (1954)); the
  //     appellate-court version; abolished in civil by Fed. R. Civ. P. 60(e).
  //   • procedendo — pure common-law writ; original jurisdiction granted by state constitutions
  //     (e.g. Ohio Const. art. IV, §§ 2–3, listing procedendo among the extraordinary writs).
  //   • scire facias — common-law writ; ABOLISHED in federal civil practice by Fed. R. Civ. P. 81(b).
  //   • supersedeas / stay — Fed. R. App. P. 8 (stay pending appeal) + Fed. R. Civ. P. 62 (stay /
  //     supersedeas bond in the trial court).
  //   • ne exeat republica — 26 U.S.C. § 7402(a) (federal writs/orders of ne exeat republica, tax
  //     collection); historically an equity writ. The All Writs Act (§ 1651) is the general backstop.
  //   • common-law certiorari — the supervisory writ, distinct from Supreme Court cert (cert-scotus).
  //     Federal power to issue it comes from the All Writs Act, 28 U.S.C. § 1651(a); Sup. Ct. R. 20.6
  //     expressly names "a petition for a common-law writ of certiorari."
  {
    id: 'audita-querela', name: 'Writ of audita querela', tier: 8, track: 'advanced', gated: true,
    prereqs: ['direct-appeal'], category: 'petition', basis: 'common-law',
    statuteMap: [
      { label: 'No dedicated statute — common-law writ; in federal court issued (if at all) only under the All Writs Act', cite: '28 U.S.C. § 1651 (All Writs Act)' },
      { label: 'Abolished in federal CIVIL cases (relief now sought by motion/action; the writ survives, narrowly, in criminal cases)', cite: 'Fed. R. Civ. P. 60(e)' },
    ],
    plain:
      'An old common-law writ attacking a judgment because of something that happened AFTER it was '
      + 'entered — a later-arising defense or a discharge that makes enforcing the judgment unjust. It '
      + 'has no statute of its own. Federal civil practice abolished it (Fed. R. Civ. P. 60(e)); in a '
      + 'criminal case it survives only in the narrow gap left open by coram nobis and habeas — see '
      + 'United States v. Ayala, 894 F.2d 425 (D.C. Cir. 1990).',
    ladderNote:
      'A last-ditch, rarely-granted tool. It reaches only a legal objection that arose after judgment '
      + 'and that no other post-conviction remedy (habeas, § 2255, coram nobis) can address. It is not a '
      + 'substitute for an appeal or a habeas petition you can still bring.',
    burnNote:
      'Because it has NO statute and is expressly abolished in civil cases, courts read audita querela '
      + 'narrowly and dismiss it whenever another remedy (a direct appeal, § 2255, or coram nobis) was '
      + 'or is available. Reaching for it before exhausting those wastes the one thin opening it offers.',
  },
  {
    id: 'coram-vobis', name: 'Writ of coram vobis', tier: 8, track: 'advanced', gated: true,
    prereqs: ['direct-appeal'], category: 'petition', basis: 'common-law',
    statuteMap: [
      { label: 'No dedicated statute — common-law writ recognized under the All Writs Act (sibling of coram nobis: United States v. Morgan, 346 U.S. 502 (1954))', cite: '28 U.S.C. § 1651 (All Writs Act)' },
      { label: 'Abolished in federal CIVIL cases (criminal coram nobis / coram vobis survive)', cite: 'Fed. R. Civ. P. 60(e)' },
    ],
    plain:
      'Coram nobis’s twin. Both correct a fundamental factual error unknown at the time of judgment; '
      + 'the difference is only WHERE you file. "Coram nobis" ("before us") goes to the trial court that '
      + 'rendered judgment; "coram vobis" ("before you") is directed to the APPELLATE court whose record '
      + 'holds the error. Like coram nobis it rests on the All Writs Act, not a statute (United States v. '
      + 'Morgan, 346 U.S. 502 (1954)), and is abolished in federal civil cases (Fed. R. Civ. P. 60(e)).',
    ladderNote:
      'A narrow, late-stage writ for the person no longer in custody who needs to undo a judgment tainted '
      + 'by an error the appellate record carries. Pick coram nobis vs. coram vobis by which court’s '
      + 'record contains the mistake — otherwise the two are the same remedy.',
    burnNote:
      'Granted only for errors "of the most fundamental character," and only when sound reasons excuse '
      + 'not raising the issue earlier. Filing it in the wrong court, or using it as a do-over for '
      + 'arguments you could have raised on appeal, gets it denied.',
  },
  {
    id: 'procedendo', name: 'Writ of procedendo', tier: 8, track: 'advanced', gated: false, prereqs: [],
    category: 'mandamus', basis: 'common-law',
    statuteMap: [
      { label: 'No dedicated statute — pure common-law writ; original jurisdiction to issue it is granted by state constitutions (e.g. Ohio Const. art. IV, listing procedendo among the extraordinary writs)', cite: 'Common-law writ (no statute); state constitutional original jurisdiction (varies)' },
    ],
    plain:
      'A common-law writ ordering a lower court to STOP stalling and proceed to judgment. It does not '
      + 'tell the lower court WHAT to decide — only that it must decide. It has no statute of its own; '
      + 'where it exists (many states, e.g. Ohio) the power to issue it comes from the court’s '
      + 'constitutional original jurisdiction, not a statute.',
    ladderNote:
      'The mirror of prohibition (which says "stop") and a cousin of mandamus (which compels a duty): '
      + 'procedendo is for the narrow case where a court simply refuses to rule at all. It stands apart '
      + 'from the appeal ladder — you use it when there is no ruling yet to appeal.',
    burnNote:
      'Courts require the same showing as mandamus — a clear right to a ruling, a clear duty to rule, and '
      + 'no other adequate remedy. If an ordinary motion or appeal can force the decision, procedendo is '
      + 'refused. It cannot be used to attack a ruling you dislike; only to force one to be made.',
  },
  {
    id: 'scire-facias', name: 'Writ of scire facias', tier: 8, track: 'advanced', gated: false, prereqs: [],
    category: 'petition', basis: 'common-law',
    statuteMap: [
      { label: 'No dedicated statute — common-law writ; ABOLISHED in federal civil practice (relief now sought by ordinary action or motion)', cite: 'Fed. R. Civ. P. 81(b)' },
    ],
    plain:
      'An ancient common-law writ meaning "make known" — a show-cause order used to revive a dormant '
      + 'judgment, enforce a judgment against a new party, or annul a grant/charter. It has no statute of '
      + 'its own, and Fed. R. Civ. P. 81(b) formally ABOLISHED it in the federal courts: the relief it '
      + 'gave is now obtained by an ordinary civil action or motion. Some states retain the writ by name.',
    ladderNote:
      'Not a rung on the appeal ladder at all — it is a post-judgment enforcement/revival device. It is '
      + 'listed here because it is one of the classic extraordinary writs people still encounter, mostly '
      + 'in bail-bond forfeiture and old-judgment-revival contexts in states that keep it.',
    burnNote:
      'In federal court, asking for "a writ of scire facias" by name is a dead end — Rule 81(b) abolished '
      + 'it; you must bring the ordinary action/motion instead. In states that keep it, it carries its own '
      + 'strict revival deadlines: let a judgment go dormant too long and even scire facias cannot revive it.',
  },
  {
    id: 'supersedeas', name: 'Supersedeas / stay pending appeal', tier: 8, track: 'advanced', gated: false, prereqs: [],
    category: 'motion', basis: 'statute',
    statuteMap: [
      { label: 'Stay / supersedeas bond in the trial court', cite: 'Fed. R. Civ. P. 62' },
      { label: 'Stay or injunction pending appeal (appellate court)', cite: 'Fed. R. App. P. 8' },
    ],
    plain:
      'Not an attack on the judgment — a PAUSE on it. A writ of supersedeas (today, a "stay pending '
      + 'appeal") freezes enforcement of a judgment while you appeal, so the winner cannot collect or '
      + 'execute before the appeal is decided. Unlike the old prerogative writs, this one is fully '
      + 'governed by rule: Fed. R. Civ. P. 62 (a stay in the trial court, often on a supersedeas bond) '
      + 'and Fed. R. App. P. 8 (a stay from the court of appeals).',
    ladderNote:
      'This runs ALONGSIDE the direct appeal, not after it — you seek the stay when (or right after) you '
      + 'file the notice of appeal, so there is still something to protect. You normally must ask the '
      + 'trial court first (Fed. R. App. P. 8(a)(1)) before the appellate court will act.',
    burnNote:
      'Miss the stay and the judgment is enforced while you appeal — the money is collected, the order '
      + 'takes effect — and even a later win may not undo what already happened. Posting the bond or '
      + 'other security (Fed. R. Civ. P. 62(b)) is usually what makes the stay actually take effect.',
  },
  {
    id: 'ne-exeat', name: 'Writ of ne exeat republica', tier: 8, track: 'advanced', gated: false, prereqs: [],
    category: 'petition', basis: 'statute',
    statuteMap: [
      { label: 'Federal writs/orders of ne exeat republica (tax collection)', cite: '26 U.S.C. § 7402(a)' },
      { label: 'The All Writs Act (general backstop power to issue the writ)', cite: '28 U.S.C. § 1651' },
    ],
    plain:
      'A rarely-seen writ ("let him not leave the republic") ordering a person NOT to leave the court’s '
      + 'jurisdiction, used to keep a defendant — and their assets — within reach of a judgment. '
      + 'Historically a writ of equity; its main modern federal home is tax collection, where 26 U.S.C. '
      + '§ 7402(a) expressly authorizes district courts, at the United States’ request, to issue '
      + 'writs and orders of ne exeat republica.',
    ladderNote:
      'Not a step in a personal appeal — it is a provisional restraint a party (usually the '
      + 'government, in a tax case) seeks to prevent someone from fleeing the jurisdiction. It is listed '
      + 'as one of the classic writs; a self-represented appellant will rarely be the one bringing it.',
    burnNote:
      'It is extraordinary and closely guarded: courts issue it only on a strong showing that the person '
      + 'is about to leave and has arranged to take assets beyond reach, and it is a TEMPORARY restraint, '
      + 'not a permanent bar on travel. Overreaching for it invites quick dissolution.',
  },
  {
    id: 'common-law-certiorari', name: 'Common-law writ of certiorari (supervisory)', tier: 8, track: 'advanced', gated: false, prereqs: [],
    category: 'petition', basis: 'all-writs-act',
    statuteMap: [
      { label: 'Federal power to issue it comes ONLY from the All Writs Act (no dedicated statute)', cite: '28 U.S.C. § 1651(a) (All Writs Act)' },
      { label: 'The Supreme Court’s own Rules expressly name "a petition for a common-law writ of certiorari"', cite: 'Sup. Ct. R. 20.6' },
    ],
    plain:
      'The SUPERVISORY writ of certiorari — distinct from the Supreme Court certiorari that tops this '
      + 'ladder (see "Certiorari to the U.S. Supreme Court"). A higher court uses it to pull up the record '
      + 'of a lower tribunal or agency and review whether that body acted within its jurisdiction, '
      + 'typically where no ordinary appeal is available. Federally it has no statute of its own — the '
      + 'power to issue it comes from the All Writs Act, 28 U.S.C. § 1651(a); many states keep it as a '
      + 'pure common-law writ to review administrative and quasi-judicial decisions.',
    ladderNote:
      'This is a SIDEWAYS review path, not a rung above your case: it exists for the situation where a '
      + 'tribunal’s decision is not appealable by right but you still need a court to check it for '
      + 'excess of jurisdiction. Do not confuse it with Supreme Court certiorari (cert-scotus), which is '
      + 'the discretionary top of the direct-review ladder.',
    burnNote:
      'Common-law certiorari "goes only to the jurisdiction" — it reviews whether the lower body had '
      + 'power to act, not whether it was merely wrong on the merits. If an ordinary appeal or statutory '
      + 'review is available, this writ is refused; treating it as a substitute for a missed appeal fails.',
  },
]);

const LADDER_BY_ID = Object.freeze(Object.fromEntries(LADDER.map((r) => [r.id, r])));

/** Find a rung by id. Returns the frozen remedy or null. */
export function findRemedy(id) {
  const want = String(id == null ? '' : id).trim().toLowerCase();
  return LADDER_BY_ID[want] || null;
}

// ── the gate — enforce the exhaustion ladder ───────────────────────────────────────────────────────
/**
 * Given a chosen remedy id and the set of rung ids the user has marked DONE, decide whether the rung is
 * unlocked, which prerequisites are still missing, and which warnings to fire. PURE, never throws.
 *   gateRemedy('federal-habeas', ['direct-appeal']) →
 *     { remedy, ok:false, missing:['state-postconviction','discretionary-review'], warnings:[…] }
 * `warnings` always includes the rung's hardWarnings; a gated rung with missing prereqs also gets a
 * generated "you may be skipping a step" warning (danger for habeas, warn otherwise).
 */
export function gateRemedy(remedyId, doneIds = []) {
  const remedy = findRemedy(remedyId);
  if (!remedy) return { remedy: null, ok: false, missing: [], warnings: [] };
  const done = new Set((Array.isArray(doneIds) ? doneIds : [])
    .map((d) => String(d || '').trim().toLowerCase()).filter(Boolean));
  const missing = (remedy.prereqs || []).filter((id) => !done.has(id));
  const ok = !remedy.gated || missing.length === 0;
  const warnings = [];

  // A gated rung whose prerequisites are not all marked done gets a skip-step warning. Federal habeas is
  // the sharp case: skipping BURNS the option, so it is a danger, worded to say exactly that.
  if (remedy.gated && missing.length) {
    const names = missing.map((id) => (LADDER_BY_ID[id] ? LADDER_BY_ID[id].name : id));
    if (remedy.id === 'federal-habeas') {
      warnings.push({
        level: 'danger',
        title: 'You have not marked the earlier steps done — filing habeas now can BURN it',
        body:
          'You selected federal habeas without marking these earlier rungs complete: '
          + names.join('; ') + '. Federal habeas requires that you first EXHAUST every federal claim in '
          + 'the state courts (28 U.S.C. § 2254(b)(1)). Filing before you finish the state ladder can '
          + 'get the petition dismissed as unexhausted, and while you go back the AEDPA one-year clock '
          + '(28 U.S.C. § 2244(d)(1)) may run out — losing the option permanently. Do not file '
          + 'until these are done or a lawyer confirms an exception applies.',
      });
    } else {
      warnings.push({
        level: 'warn',
        title: 'This step usually comes after earlier rungs',
        body:
          'You have not marked these earlier steps complete: ' + names.join('; ') + '. This remedy is '
          + 'normally available only after them. Confirm you have exhausted the lower rungs (or that an '
          + 'exception applies) before relying on this one.',
      });
    }
  }
  // Always attach the rung's own hard warnings (habeas exhaustion, mandamus last-resort).
  for (const w of (remedy.hardWarnings || [])) warnings.push(w);
  return { remedy, ok, missing, warnings };
}

// ── verified authorities (the accuracy-discipline centerpiece) ─────────────────────────────────────
// Every citation below is REAL and human-verified against the source of record (2026-09). We describe
// each holding honestly and never overstate it. These render as a "governing authorities" shelf and are
// also asserted by the tests so a future edit cannot silently swap in a fabricated cite.
export const MANDAMUS_AUTHORITIES = Object.freeze([
  {
    name: 'Olsen v. Drug Enforcement Administration',
    cite: '878 F.2d 1458 (D.C. Cir. 1989)',
    note:
      'The petitioner had to seek a writ of mandamus to force the DEA to act on his petition, and the '
      + 'D.C. Circuit’s review sent the scheduling question back for the agency to address — the '
      + 'classic posture of using an extraordinary writ when an agency will not act. (The court’s '
      + 'ultimate ruling rejected the religious-use exemption on the merits; the mandamus point is the '
      + 'procedural lesson, not a holding that courts will always compel the DEA.)',
    url: 'https://www.courtlistener.com/c/us-app-dc/279',
  },
  {
    name: 'Telecommunications Research & Action Center (TRAC) v. FCC',
    cite: '750 F.2d 70 (D.C. Cir. 1984)',
    note:
      'The source of the six "TRAC factors" federal courts use to decide whether agency delay is '
      + '"unreasonable" enough to compel action — the practical test behind a mandamus / § 706(1) '
      + 'petition against a stalling agency.',
    url: 'https://law.justia.com/cases/federal/appellate-courts/F2/750/70/389443/',
  },
  {
    name: 'Norton v. Southern Utah Wilderness Alliance',
    cite: '542 U.S. 55 (2004)',
    note:
      'The Supreme Court held that a court can compel agency action under 5 U.S.C. § 706(1) only when '
      + 'the agency failed to take a DISCRETE action it was legally REQUIRED to take — the outer limit '
      + 'on "compel agency action" mandamus.',
    url: 'https://www.courtlistener.com/opinion/136984/norton-v-southern-utah-wilderness-alliance/',
  },
]);

export const HABEAS_AUTHORITIES = Object.freeze([
  {
    name: 'Rose v. Lundy', cite: '455 U.S. 509 (1982)',
    note: 'A "mixed" habeas petition (containing both exhausted and unexhausted claims) must be dismissed — the total-exhaustion rule.',
    url: 'https://www.courtlistener.com/opinion/110656/rose-v-lundy/',
  },
  {
    name: 'Coleman v. Thompson', cite: '501 U.S. 722 (1991)',
    note: 'A claim the state court rejected on an independent and adequate state procedural ground is procedurally defaulted and generally barred from federal habeas review.',
    url: 'https://www.courtlistener.com/opinion/112637/coleman-v-thompson/',
  },
]);

// ── required-fields templates (the generator) ──────────────────────────────────────────────────────
// A category → the ordered list of fields the document on that rung requires, plus the format/limit
// rules that govern it. Fields are generic-but-real; format rules cite the federal rule and mark the
// state-specific bits verify:true. The server renders these as a fill-in-the-blank scaffold + notes.
const COMMON_CAPTION = [
  { key: 'court', label: 'Court', help: 'The full name of the court you are filing in (e.g. "United States Court of Appeals for the Ninth Circuit").' },
  { key: 'parties', label: 'Parties', help: 'Who is who on appeal — Appellant/Petitioner vs. Appellee/Respondent (name the party bringing the challenge first).' },
  { key: 'caseNumber', label: 'Case / docket number', help: 'The lower court’s case number, and the new appellate number once assigned.' },
  { key: 'caption', label: 'Caption', help: 'The formatted heading block: court, parties, case number, and the title of the document.' },
];
const CERT_BLOCKS = [
  { key: 'certCompliance', label: 'Certificate of compliance', help: 'A signed statement that the brief meets the length/format limits (word or page count, font).' },
  { key: 'certService', label: 'Certificate of service', help: 'A signed statement of the date and manner you served every other party with a copy.' },
];

export const FIELD_TEMPLATES = Object.freeze({
  brief: {
    label: 'Appellate brief',
    fields: [
      ...COMMON_CAPTION,
      { key: 'tableAuthorities', label: 'Table of contents & table of authorities', help: 'A list of the sections and every case/statute cited, with page numbers.' },
      { key: 'jurisdiction', label: 'Jurisdictional statement', help: 'The basis for the trial court’s jurisdiction, the appellate court’s jurisdiction, and the timeliness of the appeal.' },
      { key: 'issues', label: 'Questions / issues presented', help: 'Each legal question the court must decide, stated concisely and neutrally.' },
      { key: 'statementCase', label: 'Statement of the case', help: 'The procedural history — what happened below and how the case got here.' },
      { key: 'statementFacts', label: 'Statement of facts', help: 'The relevant facts, each with a citation to the record (transcript/exhibit page).' },
      { key: 'standardReview', label: 'Standard of review', help: 'How the appellate court reviews each issue (de novo, abuse of discretion, clear error, etc.).' },
      { key: 'summaryArgument', label: 'Summary of argument', help: 'A short preview of your argument before the full argument.' },
      { key: 'argument', label: 'Argument', help: 'Your legal argument, organized by issue, each anchored to authority and the record.' },
      { key: 'relief', label: 'Relief requested (conclusion / prayer)', help: 'Exactly what you want the court to do — reverse, vacate, remand, render.' },
      ...CERT_BLOCKS,
    ],
    format: [
      { rule: 'Federal principal brief: 13,000-word limit; 14-point proportional font; specified cover and section order', cite: 'Fed. R. App. P. 32(a)' },
      { rule: 'State page/word limits, font, and cover color VARY — check your state’s Rules of Appellate Procedure', verify: true },
    ],
  },
  motion: {
    label: 'Motion (reconsideration / new trial)',
    fields: [
      ...COMMON_CAPTION,
      { key: 'title', label: 'Title of the motion', help: 'e.g. "Motion for New Trial" or "Motion to Alter or Amend the Judgment".' },
      { key: 'grounds', label: 'Grounds', help: 'The specific legal grounds — e.g. clear error of law, newly discovered evidence, manifest injustice.' },
      { key: 'argument', label: 'Supporting argument & authority', help: 'Why the grounds are met, with citations and record references.' },
      { key: 'relief', label: 'Relief requested', help: 'Exactly what you want — a new trial, an amended judgment, reconsideration of a specific ruling.' },
      { key: 'proposedOrder', label: 'Proposed order (if required)', help: 'Many courts want a proposed order granting the motion attached.' },
      ...CERT_BLOCKS.slice(1), // certificate of service
    ],
    format: [
      { rule: 'Civil new-trial / alter-or-amend motions have short deadlines (commonly ~28 days)', cite: 'Fed. R. Civ. P. 59' },
      { rule: 'Criminal new-trial motion deadlines depend on the ground', cite: 'Fed. R. Crim. P. 33' },
      { rule: 'State motion deadlines and page limits VARY — check your state’s trial-court rules', verify: true },
    ],
  },
  petition: {
    label: 'Petition (review / post-conviction / writ)',
    fields: [
      ...COMMON_CAPTION,
      { key: 'title', label: 'Title of the petition', help: 'e.g. "Petition for Review", "Petition for Post-Conviction Relief", "Petition for Writ of Certiorari".' },
      { key: 'questions', label: 'Questions presented', help: 'The precise questions you ask the higher court to decide.' },
      { key: 'statementCase', label: 'Statement of the case & decisions below', help: 'The procedural history and the rulings you are challenging.' },
      { key: 'statementFacts', label: 'Statement of facts', help: 'The material facts, with record citations.' },
      { key: 'reasons', label: 'Reasons to grant review / grounds for relief', help: 'Why this court should take the case (conflict, importance) or why relief is warranted.' },
      { key: 'relief', label: 'Relief requested', help: 'What you want — review granted, conviction vacated, new trial, resentencing.' },
      { key: 'appendix', label: 'Appendix', help: 'The lower-court opinions/orders and any required record excerpts.' },
      ...CERT_BLOCKS,
    ],
    format: [
      { rule: 'U.S. Supreme Court certiorari petition: booklet format, 9,000-word limit, 40-day/90-day timing', cite: 'Sup. Ct. R. 14, 33; deadline Sup. Ct. R. 13' },
      { rule: 'State petition-for-review and post-conviction forms/limits VARY — many states publish a required form; check your state’s rules', verify: true },
    ],
  },
  habeas: {
    label: 'Federal habeas petition (§ 2254 / § 2255)',
    fields: [
      ...COMMON_CAPTION,
      { key: 'petitioner', label: 'Petitioner & custody', help: 'Your name and where you are held; § 2254 requires being "in custody" under the challenged judgment.' },
      { key: 'respondent', label: 'Respondent', help: 'For § 2254, the warden/custodian who holds you (named as respondent); for § 2255, the United States in the sentencing court.' },
      { key: 'judgment', label: 'Judgment under attack', help: 'The court, case number, offense, sentence, and dates of the conviction you are challenging.' },
      { key: 'exhaustion', label: 'Exhaustion of state remedies', help: 'For EACH ground, the state proceedings where you raised it, up to the state’s highest court (28 U.S.C. § 2254(b)(1)).' },
      { key: 'grounds', label: 'Grounds for relief', help: 'Each federal constitutional/legal ground, with the supporting facts.' },
      { key: 'timeliness', label: 'Timeliness (AEDPA)', help: 'Why the petition is within the one-year limit (28 U.S.C. § 2244(d)(1) / § 2255(f)), and any tolling.' },
      { key: 'relief', label: 'Relief requested', help: 'What you want — the writ issued, conviction/sentence vacated, a new trial or resentencing.' },
      ...CERT_BLOCKS.slice(1),
    ],
    format: [
      { rule: 'Federal courts require the official AO 241 (§ 2254) / AO 243 (§ 2255) form in most districts', cite: '28 U.S.C. § 2254 / § 2255; Rules Governing § 2254 & § 2255 Cases' },
      { rule: 'One-year AEDPA clock — count it precisely and note any statutory tolling', cite: '28 U.S.C. § 2244(d)' },
    ],
  },
  mandamus: {
    label: 'Petition for extraordinary writ (mandamus / prohibition)',
    fields: [
      ...COMMON_CAPTION,
      { key: 'title', label: 'Title', help: 'e.g. "Petition for Writ of Mandamus" naming the official/court/agency as respondent.' },
      { key: 'duty', label: 'The clear, non-discretionary duty', help: 'The specific legal duty the respondent is REQUIRED to perform (with the statute/rule that imposes it).' },
      { key: 'right', label: 'Your clear right & standing', help: 'Why you have a clear right to have that duty performed.' },
      { key: 'noAlternative', label: 'No other adequate remedy', help: 'Why an ordinary appeal or other remedy cannot fix the problem — the hardest element.' },
      { key: 'statutoryBasis', label: 'Statutory basis for the writ', help: 'The statute granting the power — 28 U.S.C. § 1361, the All Writs Act (§ 1651), and for agencies the APA (5 U.S.C. § 706(1)).' },
      { key: 'delay', label: 'Unreasonable delay (agency cases)', help: 'For an agency sitting on a petition, address the six TRAC factors (TRAC v. FCC, 750 F.2d 70).' },
      { key: 'relief', label: 'Relief requested', help: 'The specific order you want the court to issue against the respondent.' },
      ...CERT_BLOCKS,
    ],
    format: [
      { rule: 'Federal appellate mandamus is governed by Fed. R. App. P. 21 (petition, service on the respondent judge, answer)', cite: 'Fed. R. App. P. 21' },
      { rule: 'State mandamus/prohibition procedure and the proper court VARY — check your state’s rules', verify: true },
    ],
  },
});

/** The field template for a remedy (by its `category`). Returns the template or a safe empty shape. */
export function fieldsFor(remedy) {
  const r = typeof remedy === 'string' ? findRemedy(remedy) : remedy;
  const cat = r && r.category ? r.category : '';
  return FIELD_TEMPLATES[cat] || { label: 'Filing', fields: [], format: [] };
}

// ── deadline engine ────────────────────────────────────────────────────────────────────────────────
// Surface the filing WINDOWS as warnings. Federal windows are fixed and cited; state windows VARY and
// are returned as verify:true category warnings pointing at the state's own rules. PURE.
export function deadlinesFor(remedy, { level = '', state = '' } = {}) {
  const r = typeof remedy === 'string' ? findRemedy(remedy) : remedy;
  if (!r) return [];
  const isFederal = String(state || '').toUpperCase() === 'US' || String(level || '').startsWith('fed') || level === 'circuit' || level === 'scotus';
  const out = [];
  switch (r.id) {
    case 'direct-appeal':
      out.push({ level: 'warn', window: 'Notice of appeal', text: 'Federal: 30 days after entry of judgment in a civil case (60 days if the U.S. is a party); 14 days in a criminal case.', cite: 'Fed. R. App. P. 4' });
      out.push({ level: 'warn', window: 'Notice of appeal (state)', text: 'State deadlines VARY — commonly ~30 days, but confirm your state’s Rule of Appellate Procedure. This is the most-missed deadline in pro-se practice.', verify: true });
      break;
    case 'reconsideration':
      out.push({ level: 'warn', window: 'New trial / alter judgment (civil)', text: 'Federal civil: within 28 days of entry of judgment.', cite: 'Fed. R. Civ. P. 59(b), (e)' });
      out.push({ level: 'warn', window: 'New trial (criminal)', text: 'Federal criminal: within 14 days of the verdict for most grounds; within 3 years for newly discovered evidence.', cite: 'Fed. R. Crim. P. 33(b)' });
      break;
    case 'cert-scotus':
      out.push({ level: 'warn', window: 'Certiorari', text: '90 days from entry of the judgment (or denial of rehearing) by the state court of last resort or the U.S. Court of Appeals.', cite: 'Sup. Ct. R. 13' });
      break;
    case 'federal-habeas':
      out.push({ level: 'danger', window: 'AEDPA one-year clock', text: 'Generally one year, running (for state prisoners) from when the conviction became final on direct review; statutory tolling applies while a properly-filed state post-conviction petition is pending. Miscounting this is a leading cause of dismissal.', cite: '28 U.S.C. § 2244(d) / § 2255(f)' });
      break;
    case 'state-postconviction':
    case 'discretionary-review':
      out.push({ level: 'warn', window: 'State filing window', text: 'State post-conviction and discretionary-review deadlines VARY widely (and some are strict). Confirm the exact window in your state’s rules before relying on any number.', verify: true });
      break;
    default:
      break;
  }
  if (!isFederal && (r.id === 'direct-appeal')) {
    // already covered by the state note above
  }
  return out;
}

/** The statute cites for a remedy, for wiring into the U.S. Code reader. Returns [{label,cite}]. */
export function statuteCitesFor(remedy) {
  const r = typeof remedy === 'string' ? findRemedy(remedy) : remedy;
  return r && Array.isArray(r.statuteMap) ? r.statuteMap : [];
}

// ── local ordinances — a system of links, structured as DATA (no fabricated ordinance URLs) ─────────
// The task: a section that links to where a user can READ local ordinances themselves. We link the two
// national municipal-code hosts (Municode / American Legal Publishing) plus the authoritative finders,
// and a couple of large-city code portals whose existence is stable. We deliberately do NOT fabricate a
// URL to any one city's specific ordinance section — kind:'directory' entries are finders the reader
// searches; kind:'portal' entries are a jurisdiction's own code home page.
export const ORDINANCE_SOURCES = Object.freeze([
  { name: 'Municode Library', kind: 'directory', url: 'https://library.municode.com/', note: 'The largest host of municipal & county codes — pick your state, then your city/county to read its ordinances.' },
  { name: 'American Legal Publishing — Code Library', kind: 'directory', url: 'https://codelibrary.amlegal.com/', note: 'The other major municipal-code host; many mid-size and large cities publish here.' },
  { name: 'General Code / eCode360', kind: 'directory', url: 'https://www.generalcode.com/library/', note: 'A third national code host, common in the Northeast and Midwest.' },
  { name: 'Law Library of Congress — U.S. State & Local Government', kind: 'directory', url: 'https://guides.loc.gov/state-government', note: 'Official Library of Congress research guide to finding state and local law.' },
  { name: 'Cornell LII — Municipal / local law', kind: 'directory', url: 'https://www.law.cornell.edu/wex/municipal_law', note: 'Plain-language background on how municipal ordinances work and where they sit under state law.' },
  { name: 'New York City — Administrative Code & Rules', kind: 'portal', url: 'https://www.nyc.gov/site/rules/index.page', note: 'Example of a city’s own code/rules portal (NYC).' },
  { name: 'City of Los Angeles — Municipal Code', kind: 'portal', url: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/overview', note: 'Example of a large-city code hosted on a national platform.' },
]);

// ═══════════════════════════════ RENDER (escaped HTML; PURE) ═══════════════════════════════════════

function warnCard(w) {
  if (!w) return '';
  const cls = w.level === 'danger' ? 'ape-danger' : (w.level === 'warn' ? 'ape-warn' : 'ape-info');
  const body = String(w.body || w.text || '').split('\n').map((line) => `<p>${esc(line)}</p>`).join('');
  return `<div class="ape-alert ${cls}">${w.title ? `<div class="ape-alert-t">${esc(w.title)}</div>` : ''}${body}</div>`;
}

/** The jurisdiction selector: State/DC/federal × court level. GET form, posts back to /appeals. */
export function renderJurisdictionSelector({ state = '', level = '', remedy = '', action = '/appeals' } = {}) {
  const st = String(state || '').toUpperCase();
  const stateOpts = STATES.map(([c, n]) => `<option value="${esc(c)}"${c === st ? ' selected' : ''}>${esc(n)}</option>`).join('');
  const levelOpts = [['', 'Any court level'], ...COURT_LEVELS.map((c) => [c.id, c.name])]
    .map(([v, l]) => `<option value="${esc(v)}"${v === level ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const keepRemedy = remedy ? `<input type=hidden name=remedy value="${esc(remedy)}">` : '';
  return `<form class="ape-juris" method=get action="${esc(action)}"><div class=row>
    <label class=ape-lbl>Jurisdiction
      <select class=q name=state aria-label="State or federal">${stateOpts}</select></label>
    <label class=ape-lbl>Court level
      <select class=q name=level aria-label="Court level">${levelOpts}</select></label>
    ${keepRemedy}<button type=submit>Set jurisdiction</button>
  </div></form>`;
}

/** The ladder itself, gated. `selected` opens a rung; `doneIds` marks completed rungs; links carry the
 *  chosen jurisdiction + a `done` list so the gate persists across clicks. */
export function renderLadder({ selected = '', doneIds = [], state = '', level = '', hrefFor = null } = {}) {
  const done = new Set((Array.isArray(doneIds) ? doneIds : []).map((d) => String(d || '').toLowerCase()));
  const href = typeof hrefFor === 'function' ? hrefFor : ((id) => `/appeals?remedy=${encodeURIComponent(id)}`);
  const rows = LADDER.map((r) => {
    const isDone = done.has(r.id);
    const isSel = r.id === selected;
    const g = gateRemedy(r.id, doneIds);
    const locked = r.gated && !g.ok;
    const badge = r.lastResort ? '<span class="ape-badge ape-badge-last">last resort</span>'
      : (r.id === 'federal-habeas' ? '<span class="ape-badge ape-badge-danger">exhaust first</span>' : '');
    const status = isDone ? '<span class="ape-tick" title="marked done">✓</span>'
      : (locked ? '<span class="ape-lock" title="earlier steps not marked done">⚠</span>' : '');
    return `<div class="ape-rung${isSel ? ' ape-open' : ''}${locked ? ' ape-locked' : ''}">
      <div class="ape-rung-h">
        <span class="ape-tier">${esc(r.tier)}</span>
        <a class="ape-rung-nm" href="${esc(href(r.id))}">${esc(r.name)}</a>
        ${badge}${status}
      </div>
      <div class="ape-rung-plain">${esc(r.plain)}</div>
      <div class="ape-rung-links"><a href="${esc(href(r.id))}">Open this step →</a></div>
    </div>`;
  }).join('');
  const legend = `<p class="ape-legend"><span class="ape-tick">✓</span> a step you have marked done &middot; <span class="ape-lock">⚠</span> a gated step whose earlier rungs are not marked done &middot; steps are numbered in the order you must climb them.</p>`;
  return `<section class="ape-ladder"><h2>The exhaustion ladder — climb it in order</h2>${legend}<div class="ape-rungs">${rows}</div></section>`;
}

/** The fill-in-the-blank field scaffold for a remedy (the generator output). */
export function renderFieldsTemplate(remedy) {
  const t = fieldsFor(remedy);
  if (!t.fields.length) return '';
  const fields = t.fields.map((f) => `<div class="ape-field">
    <div class="ape-field-l">${esc(f.label)}</div>
    <div class="ape-field-h">${esc(f.help)}</div>
    <div class="ape-field-blank" aria-hidden="true">— fill in —</div>
  </div>`).join('');
  const fmt = (t.format || []).map((rule) => `<li>${esc(rule.rule)}${rule.cite ? ` <code>${esc(rule.cite)}</code>` : ''}${rule.verify ? ' <em class="ape-verify">— varies by state; confirm in your state’s rules</em>' : ''}</li>`).join('');
  return `<div class="ape-gen"><h3>Generate: ${esc(t.label)} — required fields</h3>
    <p class="ape-note">This is a fill-in-the-blank scaffold of the sections your document needs. It is AI-generated structure, not a completed filing and not legal advice — fill each field with your own case’s facts, or take it to an attorney or your court’s self-help center.</p>
    <div class="ape-fields">${fields}</div>
    ${fmt ? `<div class="ape-format"><h4>Format &amp; length rules</h4><ul>${fmt}</ul></div>` : ''}</div>`;
}

/** The deadline warnings for a remedy + jurisdiction. */
export function renderDeadlines(remedy, ctx = {}) {
  const rows = deadlinesFor(remedy, ctx);
  if (!rows.length) return '';
  const items = rows.map((d) => `<div class="ape-deadline ape-${esc(d.level)}">
    <span class="ape-dl-w">${esc(d.window)}</span>
    <span class="ape-dl-t">${esc(d.text)}</span>
    ${d.cite ? `<code>${esc(d.cite)}</code>` : ''}${d.verify ? ' <em class="ape-verify">— confirm in your state’s rules</em>' : ''}
  </div>`).join('');
  return `<div class="ape-deadlines"><h3>Deadlines that can end the option</h3>${items}</div>`;
}

/** Render one authority shelf ([{name,cite,note,url}]). */
export function renderAuthorities(list, heading) {
  const items = (Array.isArray(list) ? list : []).map((a) => `<div class="ape-auth">
    <div class="ape-auth-nm">${a.url ? `<a href="${esc(a.url)}" rel="nofollow noopener">${esc(a.name)}</a>` : esc(a.name)} <span class="ape-badge">${esc(a.cite)}</span></div>
    <div class="ape-auth-note">${esc(a.note)}</div>
  </div>`).join('');
  return items ? `<div class="ape-auths"><h4>${esc(heading)}</h4>${items}</div>` : '';
}

/** The teaching block for a remedy: what it is, where it sits, why order matters, what burning means. */
export function renderTeaching(remedy) {
  const r = typeof remedy === 'string' ? findRemedy(remedy) : remedy;
  if (!r) return '';
  return `<div class="ape-teach">
    <h3>What this is</h3><p>${esc(r.plain)}</p>
    <h3>Where it sits in the ladder</h3><p>${esc(r.ladderNote)}</p>
    <h3>What "burning" this option means</h3>${String(r.burnNote || '').split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}
  </div>`;
}

/** The local-ordinances link system. */
export function renderOrdinanceLinks() {
  const group = (kind, heading) => {
    const items = ORDINANCE_SOURCES.filter((s) => s.kind === kind).map((s) => `<div class="ape-ord">
      <div class="ape-ord-nm"><a href="${esc(s.url)}" rel="nofollow noopener">${esc(s.name)}</a></div>
      <div class="ape-ord-note">${esc(s.note)}</div>
    </div>`).join('');
    return items ? `<h4>${esc(heading)}</h4>${items}` : '';
  };
  return `<div class="ape-ordinances"><h3>Local ordinances — read them yourself</h3>
    <p class="ape-note">If your issue is a city or county ordinance, you can pull the actual text here and work through it yourself (or with an AI helper). These are finders and official code portals — we link where the codes live, not a guess at any one ordinance’s URL.</p>
    ${group('directory', 'Find your city / county code')}
    ${group('portal', 'Example jurisdiction code portals')}</div>`;
}

/** The required two-voice disclaimer for this surface. */
export function renderDisclaimer() {
  return `<div class="ape-disclaimer">
    <p><b>AI-generated — not legal advice.</b> Everything this tool produces is AI-generated legal
      INFORMATION and fill-in-the-blank structure. It is not legal advice, it is not a lawyer, and it
      does not create an attorney-client relationship. Deadlines, page limits, and procedures vary by
      court and change over time — verify every specific in your court’s own rules before you rely on it.</p>
    <p><b>What to do with it:</b> take the draft or notes to a licensed attorney, a legal-aid clinic, or
      your court’s self-help center; and file through the court’s official system. Most courts use an
      e-filing portal (federal courts: PACER/CM-ECF; many state courts have their own e-file site) and
      publish free pro-se packets and clerk help lines. When a deadline or a right is on the line, get a
      human lawyer — a federal-defender or public-defender office for criminal/habeas matters.</p>
  </div>`;
}

/**
 * The full detail view for a selected remedy: teaching + gate warnings + generator fields + deadlines +
 * governing-statute cites (rendered by the injected `statuteCard` from the U.S. Code reader) + live
 * cases/judges (rendered by injected renderers) + respondents note. The server passes the injected
 * renderers so this stays offline-testable. PURE (given pure/soft-fail injections). Never throws.
 */
export function renderRemedyDetail(remedy, {
  doneIds = [], state = '', level = '',
  statuteCardsHtml = '', casesHtml = '', judgesHtml = '', respondentsHtml = '',
} = {}) {
  const r = typeof remedy === 'string' ? findRemedy(remedy) : remedy;
  if (!r) return `<div class="ape-empty">Pick a step on the ladder to open it.</div>`;
  const g = gateRemedy(r.id, doneIds);
  const warnings = g.warnings.map(warnCard).join('');
  const auths = r.id === 'mandamus' || r.id === 'prohibition'
    ? renderAuthorities(MANDAMUS_AUTHORITIES, 'Governing authorities (verified)')
    : (r.id === 'federal-habeas' ? renderAuthorities(HABEAS_AUTHORITIES, 'Governing authorities (verified)') : '');
  const statuteBlock = statuteCardsHtml
    ? `<div class="ape-statutes"><h3>Governing statutes</h3>${statuteCardsHtml}</div>` : '';
  const cases = casesHtml ? `<div class="ape-cases"><h3>Cases on point (live · CourtListener)</h3>${casesHtml}</div>` : '';
  const jud = judgesHtml ? `<div class="ape-judges"><h3>The court / judges</h3>${judgesHtml}</div>` : '';
  return `<article class="ape-detail">
    <h2>${esc(r.name)}</h2>
    ${warnings}
    ${renderTeaching(r)}
    ${respondentsHtml ? `<div class="ape-respondents"><h3>Who the respondents are</h3>${respondentsHtml}</div>` : ''}
    ${renderDeadlines(r, { state, level })}
    ${renderFieldsTemplate(r)}
    ${statuteBlock}
    ${auths}
    ${cases}
    ${jud}
  </article>`;
}

// ── guarded CLI demo ─────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  console.log(`${LADDER.length} rungs on the ladder:`);
  for (const r of LADDER) {
    console.log(` ${r.tier}. ${r.id}: ${r.name}${r.gated ? ' [gated]' : ''}${r.prereqs.length ? ' <- ' + r.prereqs.join(', ') : ''}`);
    console.log(`     statutes: ${r.statuteMap.map((s) => s.cite).join(' | ')}`);
  }
  console.log('\nGate check: federal-habeas with only direct-appeal done:');
  const g = gateRemedy('federal-habeas', ['direct-appeal']);
  console.log(`  ok=${g.ok} missing=[${g.missing.join(', ')}] warnings=${g.warnings.length}`);
}
