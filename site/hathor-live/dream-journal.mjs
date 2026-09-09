// site/hathor-live/dream-journal.mjs — R1, the top-ranked build in
// .local/temple-exams/dreams-induction-and-interpretation.md, specified there and not built until now.
//
// WHY A JOURNAL AND NOT AN EXAM. `practices.mjs` already ships the lucid-induction family — MILD,
// SSILD, WILD, DILD, WBTB, reality testing, dream recall. MILD is prospective memory: it works by
// forming an intention before sleep and remembering it inside the dream, which means it depends on
// actually remembering dreams at all. Every induction paper in that literature identifies general
// dream recall as the strongest predictor of whether any technique works, and recall is trainable.
// So the journal is not an accessory to the practice library. It is the substrate the whole family
// runs on, and the only artefact in this domain that produces a record worth analysing later.
//
// ⛔ GRADE ③ — WITHIN-PERSON. NO SHARE CARD. EXPORT ONLY.
// Per identity-grade-instruments.md §9.1 and the dreams paper's own build table: no percentile, no
// comparison with other people, no shareable image, no score that buys anything. Nobody else has
// your baseline, so there is nothing a comparison could honestly compute. A dream journal is not a
// leaderboard. `SHARE` below is an exported refusal rather than a missing feature, so that a future
// agent adding a share card has to delete a sentence that explains why they should not.
//
// ⛔ AND NO INTERPRETATION. No auto-reading, no "your dreams are 62% anxiety", no symbol lookup that
// returns a meaning. The framing rule for this whole domain is the sharpest in the battery: an
// interpretation is never a diagnosis, and the moment a page tells someone what their dream means
// ABOUT THEM it has crossed a line no citation repairs. Tags are the person's own words. Where a
// tradition's table is shown anywhere on this site it is shown AS that tradition's, with a
// citation — which is a citation, not a reading.
//
// ⭐ THE HONEST HALF OF THE FUNCTIONAL-RECORD WORK.
// .local/temple-exams/functional-documentation-and-benefits.md establishes that a dated,
// longitudinal, self-collected record is legitimate evidence, and it establishes the narrower claim
// that actually survives review: recall is a biased but RELIABLE RANKING instrument — between-person
// correlations commonly exceed r = .80 — and it fails on exactly three things: absolute level,
// within-person change, and collection integrity. Those three are precisely what a dated,
// timestamped, contemporaneous record produces and a reconstruction cannot. That is the whole
// argument for typing this at 06:10 instead of remembering it on Sunday, and it is why every entry
// here carries its lag and is marked backfilled forever when it has one.
//
// ⚠️ PRIVACY IS THE DESIGN, NOT A SETTING ON IT. Dream content is the most intimate data on this
// site. The raw participant key never reaches this module or its store — participant-key.mjs hashes
// it at the boundary and the hash is what is written. Nothing goes on chain, ever. `forget` rewrites
// the file rather than tombstoning it. dream-journal-store.mjs carries the full posture.
//
// House style: ESM, esc() all interpolation, soft-fail-never-throw, offline-testable, no network.

import { esc, CONSULT, disclaimer, claimsCheck } from './the-line.mjs';
import {
  RECALL_LEVELS, LUCIDITY_LEVELS, LIGHT_SWITCH_OUTCOMES, num,
} from './dream-journal-store.mjs';
import { REALITY_CHECKS } from './practices.mjs';

export { esc, num, RECALL_LEVELS, LUCIDITY_LEVELS, LIGHT_SWITCH_OUTCOMES };

export const JOURNAL_ID = 'dream-journal';
export const ROUTE = '/dreams';

/**
 * ⛔ The refusal, exported so it is testable and so removing it is a visible act.
 * Every field here is a thing this build does NOT do, with the reason it does not do it.
 */
export const SHARE = Object.freeze({
  grade: 3,
  gradeName: 'within-person change',
  shareCard: false,
  percentile: false,
  comparison: false,
  payable: false,
  onChain: false,
  why:
    'A dream journal is a within-person record, not a score. Nobody else has your baseline, so a '
    + 'percentile against other people would be a number with no meaning attached to it — and a '
    + 'shareable one would be worse, because a shared number invites a reading, and reading your '
    + 'dream back to you is the one thing this build refuses to do. You get an export. It is yours.',
  interpretation: false,
  interpretationWhy:
    'An interpretation is never a diagnosis. Nothing here tells you what a dream means about you — '
    + 'not a symbol lookup, not a mood percentage, not a pattern we noticed. Your tags are your own '
    + 'words, and they stay that way.',
});

/**
 * Citations. Every DOI below was resolved against api.crossref.org in this session and the author
 * lists, years, volumes and page ranges are Crossref's, not a recollection.
 *
 * ⚠️ ONE CORRECTION THE PASS PRODUCED, and it is the kind that silently breaks a reader's search:
 * the 2017 Dreaming paper is registered at Crossref under ADVENTURE-HEART, D. J. — not "Aspy",
 * which is the name every secondary source still uses. The same researcher published under two
 * surnames. Cite both or the reader cannot find the paper.
 */
export const CITATIONS = Object.freeze([
  Object.freeze({
    id: 'laberge-1981',
    label: 'La Berge, S. P., Nagel, L. E., Dement, W. C., & Zarcone, V. P. (1981). Lucid Dreaming Verified by Volitional Communication during REM Sleep. Perceptual and Motor Skills, 52(3), 727–732.',
    doi: '10.2466/pms.1981.52.3.727',
    crossref: 'resolved 2026-09-09 — authors, volume, issue and pages as printed',
    why: 'Lucidity is the one inner state that has been made objectively verifiable. It establishes nothing about what a dream is.',
  }),
  Object.freeze({
    id: 'aspy-2017',
    label: 'Adventure-Heart (Aspy), D. J., Delfabbro, P., Proeve, M., & Mohr, P. (2017). Reality testing and the mnemonic induction of lucid dreams: Findings from the national Australian lucid dream induction study. Dreaming, 27(3), 206–231.',
    doi: '10.1037/drm0000059',
    crossref: 'resolved 2026-09-09 — Crossref records the first author as Adventure-Heart, D. J.; secondary sources say "Aspy et al."',
    why: 'Reality testing could not be isolated from MILD and WBTB. A within-person series can ask the question the group design could not.',
  }),
  Object.freeze({
    id: 'stumbrys-2012',
    label: 'Stumbrys, T., Erlacher, D., Schädlich, M., & Schredl, M. (2012). Induction of lucid dreams: A systematic review of evidence. Consciousness and Cognition, 21(3), 1456–1475.',
    doi: '10.1016/j.concog.2012.07.003',
    crossref: 'resolved 2026-09-09 — exact match',
    why: 'The field-level verdict, verbatim: "None of the induction techniques were verified to induce lucid dreams reliably and consistently." Fourteen years on, that sentence has not been retired.',
  }),
  Object.freeze({
    id: 'stone-2003',
    label: 'Stone, A. A., Shiffman, S., Schwartz, J. E., Broderick, J. E., & Hufford, M. R. (2003). Patient compliance with paper and electronic diaries. Controlled Clinical Trials, 24(2), 182–199.',
    doi: '10.1016/s0197-2456(02)00320-3',
    crossref: 'resolved 2026-09-09 — exact match (the record is dated 2003, not 2002)',
    why: 'The reason a timestamp is not decoration. A physically instrumented paper diary: 90% claimed compliance, 11% actual; an electronic diary with compliance features, 94%.',
  }),
  Object.freeze({
    id: 'broderick-2010',
    label: 'Broderick, J. E., Schneider, S., Schwartz, J. E., & Stone, A. A. (2010). Interference with activities due to pain and fatigue: accuracy of ratings across different reporting periods. Quality of Life Research, 19(8), 1163–1170.',
    doi: '10.1007/s11136-010-9681-x',
    crossref: 'resolved 2026-09-09 — exact match',
    why: 'The honest half. Recall RANKS people well (r ≥ .80). It fails on absolute level and on within-person change — which is exactly what a journal is for.',
  }),
]);

export const citation = (id) => CITATIONS.find((c) => c.id === String(id || '')) || null;

/**
 * The reality checks, taken from practices.mjs rather than restated, so the two cannot drift.
 *
 * ⚠️ THE LIGHT SWITCH IS `contested` AND IS NEVER PRESENTED AS RELIABLE. There is one primary source
 * — Hearne 1981, n = 8, uncontrolled, self-selected correspondents of the investigator, in a journal
 * that no longer publishes — and the only published follow-up, Moss 1989, found the opposite in a
 * single subject who completed the task in 11 of 15 attempts. Nobody has looked since 1989. The
 * journal therefore ASKS about the light switch, because a cohort of even fifty people would be the
 * largest sample ever collected on the question, and it asks about BRIGHTNESS rather than success,
 * because brightness is what Hearne's subjects actually described. It does not tell anyone the check
 * works, and `checkStatus()` refuses to promote a contested grading.
 */
export const CHECKS = Object.freeze(REALITY_CHECKS.map((c) => Object.freeze({
  id: c.id, name: c.name, status: c.status,
})));

export const checkStatus = (id) => {
  const c = CHECKS.find((x) => x.id === String(id || ''));
  return c ? c.status : null;
};

/** Checks a page may present as having a sample-based result behind them. Exactly one qualifies. */
export const testedChecks = () => CHECKS.filter((c) => c.status === 'tested');

/** Every check that must carry a caveat when offered — i.e. all of them except the tested one. */
export const cautionedChecks = () => CHECKS.filter((c) => c.status !== 'tested');

const DAY_MS = 86400000;

/**
 * within(entries, opts) — the within-person measures, and nothing else.
 *
 * ⚠️ `opts` is normalised, not destructured with `= {}`: a destructuring default fires only for
 * `undefined`, so an explicit `null` would throw. And `windowDays` goes through `num()` rather than
 * `Number()`, because `Number(null) === 0` — which would silently collapse the window to zero days
 * and report "0 nights logged" to somebody with a year of entries. Both guards have a test that
 * passes `null` explicitly.
 *
 * ⛔ There is no percentile in the return value and there must never be one. Every number here is a
 * count or a proportion OF THIS PERSON'S OWN ENTRIES, and `reference` says so in words so that a
 * clinician reading an export is never left to assume a norm was involved.
 */
export function within(entries, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const rows = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
  const w = num(o.windowDays);
  const now = o.now instanceof Date ? o.now : new Date();

  const inWindow = (w != null && w > 0)
    ? rows.filter((e) => {
      const t = Date.parse(String(e.at || ''));
      return Number.isFinite(t) && (now.getTime() - t) <= w * DAY_MS;
    })
    : rows;

  const n = inWindow.length;
  const nights = new Set(inWindow.map((e) => String(e.night || '')).filter(Boolean)).size;
  const recalled = inWindow.filter((e) => e.recall && e.recall !== 'none').length;
  const lucidAny = inWindow.filter((e) => (num(e.lucidity) || 0) >= 2).length;
  const checksLogged = inWindow.reduce((s, e) => s + (Array.isArray(e.checksDone) ? e.checksDone.length : 0), 0);
  const doubtHeld = inWindow.reduce(
    (s, e) => s + (Array.isArray(e.checksDone) ? e.checksDone.filter((c) => c && c.doubtHeld).length : 0), 0,
  );
  const backfilled = inWindow.filter((e) => e.backfilled === true).length;
  const lags = inWindow.map((e) => num(e.lagDays)).filter((x) => x != null).sort((a, b) => a - b);
  const medianLag = lags.length ? lags[Math.floor((lags.length - 1) / 2)] : null;

  const rate = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

  return {
    entries: n,
    nights,
    recalled,
    recallRate: rate(recalled, n),
    lucidAny,
    lucidityRate: rate(lucidAny, n),
    // ⚠️ Adherence is checks PER ENTRY, not a percentage of anything — there is no denominator for
    // "how many checks should you have done", and inventing one would be inventing a target.
    checksLogged,
    checksPerEntry: n > 0 ? Math.round((checksLogged / n) * 100) / 100 : null,
    doubtHeld,
    // Collection integrity — the Stone 2003 measure, and the one a reader should look at first.
    backfilled,
    contemporaneous: n - backfilled,
    medianLagDays: medianLag,
    windowDays: (w != null && w > 0) ? w : null,
    reference:
      'Every number here is a proportion of this person’s own entries over the period shown. There '
      + 'is no comparison group, no norm and no percentile, because a dream journal has none to have.',
  };
}

/**
 * lightSwitchTally — the R4 replication, counted, and it is a DEMONSTRATION not a score.
 * Reported as raw counts because the interesting variable is luminance and the sample is one person.
 */
export function lightSwitchTally(entries) {
  const rows = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
  const counts = Object.fromEntries(LIGHT_SWITCH_OUTCOMES.map((o) => [o, 0]));
  for (const e of rows) {
    const v = String(e.lightSwitch || 'did not try');
    if (v in counts) counts[v] += 1;
  }
  const tried = Object.entries(counts)
    .filter(([k]) => k !== 'did not try')
    .reduce((s, [, v]) => s + v, 0);
  return {
    counts,
    tried,
    status: 'contested',
    note:
      'Hearne (1981) asked eight lucid dreamers and six reported the light would not work. Moss '
      + '(1989) followed one subject who completed the task in 11 of the 15 dreams he attempted it, '
      + 'with brightness in five of them exceeding anything he had seen before. That is the entire '
      + 'literature and it disagrees with itself, and nobody has looked since 1989. So this is a '
      + 'count of what happened to you, not evidence that a light switch tells you whether you are '
      + 'awake. Do not use one to decide that.',
  };
}

/**
 * exportRecord(entries, opts) — the whole point of the build. Plain text, the person keeps it.
 *
 * Formatted to be legible to a clinician — a dream diary is exactly the record a sleep clinic asks
 * for — and headed with CONSULT.notALab, because legibility is precisely what invites the mistake.
 * Legible like a lab report; not a lab report.
 */
export function exportRecord(entries, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const rows = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
  const stats = within(rows, { windowDays: num(o.windowDays) });
  const generated = o.now instanceof Date ? o.now.toISOString() : new Date().toISOString();
  const L = [];
  L.push('DREAM JOURNAL — a self-collected record');
  L.push('='.repeat(64));
  L.push(`Generated ${generated}`);
  L.push('');
  L.push(CONSULT.notALab);
  L.push('');
  L.push(CONSULT.full);
  L.push('');
  L.push('WHAT THIS IS, PRECISELY');
  L.push('  Self-administered entries typed by the person named by nobody: this record carries no');
  L.push('  name, no email and no account, because none was ever collected. Each entry records the');
  L.push('  night it is about and the moment it was written, and the lag between the two is printed');
  L.push('  so that a reconstructed entry cannot pass as a contemporaneous one.');
  L.push('  Lucidity is a 0-4 ordinal defined by this site and is NOT a validated instrument. It is');
  L.push('  comparable to this person\'s own earlier entries and to nothing else.');
  L.push('  There is no comparison group and no percentile anywhere in this document.');
  L.push('');
  L.push('SUMMARY (this person against this person)');
  L.push(`  entries                 ${stats.entries}`);
  L.push(`  distinct nights         ${stats.nights}`);
  L.push(`  any recall              ${stats.recalled}${stats.recallRate == null ? '' : ` (${stats.recallRate}% of entries)`}`);
  L.push(`  lucidity >= 2           ${stats.lucidAny}${stats.lucidityRate == null ? '' : ` (${stats.lucidityRate}% of entries)`}`);
  L.push(`  waking checks logged    ${stats.checksLogged}${stats.checksPerEntry == null ? '' : ` (${stats.checksPerEntry} per entry)`}`);
  L.push(`  ...with doubt held      ${stats.doubtHeld}`);
  L.push(`  written same day        ${stats.contemporaneous}`);
  L.push(`  written later           ${stats.backfilled}${stats.medianLagDays == null ? '' : ` (median lag ${stats.medianLagDays} d)`}`);
  L.push('');
  L.push('ENTRIES');
  for (const e of rows) {
    L.push('-'.repeat(64));
    const lucid = LUCIDITY_LEVELS.find((l) => l.level === (num(e.lucidity) || 0));
    L.push(`night ${e.night || '?'}   written ${e.at || '?'}`
      + `${e.backfilled ? `   [BACKFILLED +${num(e.lagDays) || 0}d]` : '   [same day]'}`);
    L.push(`  wake ${e.wakeTime || '-'} | WBTB ${e.wbtb ? 'yes' : 'no'} | technique ${e.technique || '-'}`);
    L.push(`  recall ${e.recall || 'none'} | lucidity ${num(e.lucidity) || 0} (${lucid ? lucid.label : '?'})`
      + ` | check fired in dream ${e.checkFiredInDream ? 'yes' : 'no'}`);
    if (Array.isArray(e.checksDone) && e.checksDone.length) {
      L.push(`  waking checks: ${e.checksDone.map((c) => `${c.check}${c.doubtHeld ? ' (doubt held)' : ''}`).join(', ')}`);
    }
    if (e.lightSwitch && e.lightSwitch !== 'did not try') {
      L.push(`  light switch: ${e.lightSwitch}  [the light-switch claim is CONTESTED — see the note below]`);
    }
    if (Array.isArray(e.tags) && e.tags.length) L.push(`  tags (the person's own): ${e.tags.join(', ')}`);
    if (e.text) {
      L.push('  --');
      for (const line of String(e.text).split('\n')) L.push(`  ${line}`);
    }
  }
  L.push('-'.repeat(64));
  L.push('');
  L.push('NOTES A READER SHOULD HAVE');
  L.push(`  ${lightSwitchTally(rows).note}`);
  L.push('  Recall is a biased but reliable RANKING instrument: between-person correlations commonly');
  L.push('  exceed r = .80 (Broderick et al. 2010, doi:10.1007/s11136-010-9681-x). It fails on');
  L.push('  absolute level and on within-person change — which is what a dated record is for.');
  L.push('  A physically instrumented paper diary showed 90% claimed compliance against 11% actual');
  L.push('  (Stone et al. 2003, doi:10.1016/s0197-2456(02)00320-3). That is why the lag is printed.');
  L.push('  No induction technique has been verified to induce lucid dreams reliably and');
  L.push('  consistently (Stumbrys et al. 2012, doi:10.1016/j.concog.2012.07.003).');
  L.push('');
  L.push('This record was generated in the reader\'s own browser session from entries stored under a');
  L.push('key only they hold. Nothing in it has been published, shared, or written to any blockchain.');
  return L.join('\n');
}

/** The fields the form collects, as data, so the page and the store cannot disagree about them. */
export const FIELDS = Object.freeze([
  Object.freeze({ name: 'night', label: 'The night this is about', type: 'date' }),
  Object.freeze({ name: 'wakeTime', label: 'What time you woke', type: 'time' }),
  Object.freeze({ name: 'wbtb', label: 'Did you get up in the night and go back to bed (WBTB)?', type: 'checkbox' }),
  Object.freeze({ name: 'technique', label: 'Technique attempted', type: 'select', options: ['none', 'MILD', 'SSILD', 'WILD', 'DILD', 'WBTB only', 'other'] }),
  Object.freeze({ name: 'recall', label: 'How much came back', type: 'select', options: RECALL_LEVELS }),
  Object.freeze({ name: 'lucidity', label: 'Lucidity', type: 'select', options: LUCIDITY_LEVELS.map((l) => `${l.level} — ${l.label}`) }),
  Object.freeze({ name: 'checkFiredInDream', label: 'Did a reality check fire inside the dream?', type: 'checkbox' }),
  Object.freeze({ name: 'lightSwitch', label: 'If you tried a light switch, what happened?', type: 'select', options: LIGHT_SWITCH_OUTCOMES }),
  Object.freeze({ name: 'tags', label: 'Your own tags (comma separated — your words, not ours)', type: 'text' }),
  Object.freeze({ name: 'text', label: 'The dream', type: 'textarea' }),
]);

/** The page. Self-contained, no external assets, no script that posts a key anywhere on its own. */
export function dreamJournalPageHTML(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const people = num(o.participants);
  const checkRows = CHECKS.map((c) => `<tr><td>${esc(c.name)}</td><td><b>${esc(c.status)}</b></td></tr>`).join('');
  const lucidRows = LUCIDITY_LEVELS.map((l) => `<tr><td>${esc(String(l.level))}</td><td>${esc(l.label)}</td><td class="prov">${esc(l.note)}</td></tr>`).join('');
  const citeRows = CITATIONS.map((c) => `<li>${esc(c.label)}
    <br><span class="prov">doi:${esc(c.doi)} — ${esc(c.crossref)}</span>
    <br><span class="prov">${esc(c.why)}</span></li>`).join('');
  const fieldRows = FIELDS.map((f) => `<li><b>${esc(f.label)}</b>${f.options
    ? `<br><span class="prov">${esc(f.options.join(' · '))}</span>` : ''}</li>`).join('');

  return `<h1>The dream journal</h1>
<p class="muted">A record you keep, not a test you take. There is no score, no percentile and nothing
to share — ${esc(SHARE.why)}</p>

<div class="card">
  <h2>Why this and not a lucidity test</h2>
  <p>The induction family this site already teaches — MILD, SSILD, WILD, DILD, WBTB, reality testing
  — runs on dream recall. MILD in particular is <b>prospective memory</b>: you form an intention
  before sleep and remember it inside the dream. If nothing comes back in the morning, none of it has
  anywhere to land. Recall is the strongest predictor in that literature of whether any technique
  works, and it is trainable. So the journal is the substrate, not the accessory.</p>
  <p class="prov">${esc(citation('stumbrys-2012').label)} — <q>None of the induction techniques were
  verified to induce lucid dreams reliably and consistently.</q> That sentence is fourteen years old
  and has not been retired. Nothing on this page is offered as a technique that works.</p>
</div>

<div class="card">
  <h2>⚠️ Write it now, not on Sunday</h2>
  <p>This is the one instruction on the page that has hard evidence behind it, and it is not about
  dreams at all. A chronic-pain study physically instrumented a paper diary binder to record when it
  was actually opened: participants submitted cards for <b>90% of assigned times</b>, and the
  electronic record showed actual compliance of <b>11%</b>. On 32% of study days the binder was never
  opened, yet reported compliance for those days exceeded 90%. An electronic diary with compliance
  features ran at <b>94%</b>.</p>
  <p class="prov">${esc(citation('stone-2003').label)} doi:${esc(citation('stone-2003').doi)}</p>
  <p>So every entry here records <b>the night it is about</b> and <b>the moment you typed it</b>, and
  the gap between them is printed on your export and marked <code>BACKFILLED</code> forever. That is
  not a rebuke. It is the thing that makes the same-day entries worth anything to anyone reading
  them later — including you.</p>
  <p>And the honest other half, because the strong version of this argument does not survive contact
  with the literature: <b>recall is not useless.</b> It ranks people perfectly well — between-person
  correlations commonly above r = .80. It fails on <b>absolute level</b>, on <b>within-person
  change</b>, and on <b>collection integrity</b>. Those three are exactly what a dated record
  produces and a reconstruction cannot, and they are exactly what this journal is for.</p>
  <p class="prov">${esc(citation('broderick-2010').label)} doi:${esc(citation('broderick-2010').doi)}</p>
</div>

<div class="card">
  <h2>What an entry holds</h2>
  <ul>${fieldRows}</ul>
  <p class="prov">Your tags are your own words. There is no controlled vocabulary and there will not
  be one: imposing a symbol taxonomy would be interpretation by the back door.
  ${esc(SHARE.interpretationWhy)}</p>
</div>

<div class="card">
  <h2>The lucidity scale, and what it is not</h2>
  <table><tr><th>0–4</th><th></th><th></th></tr>${lucidRows}</table>
  <p class="prov">⚠️ This ordinal is defined by this site. It is <b>not a validated instrument</b>,
  it is not the LuCiD scale and it is not derived from one. It exists so that your entries are
  comparable to your own earlier entries, and to nothing else. A boolean would have thrown away the
  most common and most trainable part of the phenomenon, which is the near miss.</p>
</div>

<div class="card">
  <h2>Reality checks, graded — and one of them is contested</h2>
  <table><tr><th>check</th><th>evidence</th></tr>${checkRows}</table>
  <p>⚠️ <b>The light switch is <code>contested</code>, and this page will not present it as
  reliable.</b> There is exactly one primary source — Hearne (1981) asked eight lucid dreamers,
  self-selected correspondents of his own, in a journal that no longer publishes — and the only
  published follow-up found the opposite: Moss (1989) followed a single subject who completed the
  light-switch task in 11 of the 15 dreams he attempted it, with brightness in five of them exceeding
  anything he had seen before. <b>Nobody has looked since 1989.</b> Do not use a light switch to
  decide whether you are awake.</p>
  <p>The journal asks about it anyway, and asks about <b>brightness rather than success</b>, because
  brightness is what Hearne's subjects actually described — flickering, filaments glowing dull
  orange, a light coming on in the wrong room. A journal cohort of even fifty people would be the
  largest sample ever collected on the question. Whatever it shows gets published, including if it
  is boring.</p>
</div>

<div class="card">
  <h2>What happens to what you write</h2>
  <ul>
    <li><b>Your key never leaves your browser on its own.</b> It is generated there, it is stored
    there, and it reaches the server only inside an entry you chose to send — where it is hashed on
    arrival. <b>The raw key is never written to disk.</b> A test greps the stored bytes for it.</li>
    <li><b>Nothing goes on the chain.</b> Not the text, not a hash of it, not a count, not a boolean.
    A pseudonym on a public ledger is permanent and globally readable.</li>
    <li><b>No one else can read your entries.</b> There is no code path in this build that reads one
    person's journal on behalf of another, and no aggregate that touches content.</li>
    <li><b>Forget actually empties it.</b> Asking to be forgotten rewrites the store without your
    records rather than hiding them behind a marker. If that rewrite fails, you are told it failed.</li>
    <li>⚠️ <b>If you lose your key, nothing can be deleted</b>, because nothing here knows which
    entries were yours. That is the cost of not asking who you are, and it is said here rather than
    afterwards.</li>
  </ul>
</div>

<div class="card">
  <h2>The export is the product</h2>
  <p>${esc(CONSULT.line)}</p>
  <p class="prov">${esc(CONSULT.notALab)}</p>
  <p>The export states what was recorded, how, when, and against what — which is your own earlier
  entries and nothing else. It is the shape a sleep clinic asks for. It is not a finding, it is not
  a result, and it contains no interpretation of any kind.</p>
</div>

<h2>Sources</h2>
<ul class="prov">${citeRows}</ul>
<p class="prov">Every DOI above was resolved against the Crossref API on 2026-09-09.
${esc(disclaimer('practices'))}</p>
<p class="prov">See also <a href="/exams">the exam battery</a>, <a href="/40hz">the entrainment
library</a> and <a href="/the-line">where the line is</a>.${people == null ? ''
    : ` ${esc(String(Math.max(0, Math.round(people))))} people keep a journal here.`}</p>`;
}

/** handler(req,res) — what this build is, as JSON. No content, no participant, no enumeration. */
export function handler(req, res) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    ok: true,
    service: JOURNAL_ID,
    route: ROUTE,
    grade: SHARE.grade,
    gradeName: SHARE.gradeName,
    shareCard: SHARE.shareCard,
    percentile: SHARE.percentile,
    interpretation: SHARE.interpretation,
    payable: SHARE.payable,
    onChain: SHARE.onChain,
    why: SHARE.why,
    fields: FIELDS,
    lucidity: LUCIDITY_LEVELS,
    recallLevels: RECALL_LEVELS,
    lightSwitchOutcomes: LIGHT_SWITCH_OUTCOMES,
    realityChecks: CHECKS,
    citations: CITATIONS,
    disclaimer: disclaimer('practices'),
    notALab: CONSULT.notALab,
  }, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('dream-journal.mjs');
if (isMain) {
  console.log(`[${JOURNAL_ID}] grade ③ within-person · share card: ${SHARE.shareCard} · on chain: ${SHARE.onChain}`);
  for (const c of CHECKS) console.log(`  ${c.status.padEnd(12)} ${c.name}`);
  console.log('\nclaimsCheck over the page prose:',
    JSON.stringify(claimsCheck(dreamJournalPageHTML().replace(/<[^>]+>/g, ' ')).hits));
  const sample = [{
    at: '2026-09-09T06:10:00.000Z', night: '2026-09-09', recall: 'scene', lucidity: 2,
    lagDays: 0, backfilled: false, checksDone: [{ check: 're-reading', doubtHeld: true }],
    lightSwitch: 'flickered or dimmed', tags: ['water'], text: 'A corridor of doors.',
  }];
  console.log(`\n${exportRecord(sample, { now: new Date('2026-09-09T12:00:00Z') })}`);
}

export default {
  JOURNAL_ID, ROUTE, SHARE, CITATIONS, CHECKS, FIELDS,
  citation, checkStatus, testedChecks, cautionedChecks,
  within, lightSwitchTally, exportRecord, dreamJournalPageHTML, handler,
};
