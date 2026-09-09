// divination-structures.mjs — R11. FOUR SYSTEMS, COMPARED BY ARCHITECTURE.
//
// From `.local/temple-exams/trance-colour-and-divination.md` §7.3: strip the content and the
// ARCHITECTURE is public, well described, genuinely remarkable, and studying it discloses nothing
// restricted.
//
// ⭐ THE LESSON THIS PAGE EXISTS FOR, and it is aimed at technologists:
//
//   **The randomiser is the trivial part.**
//
// Anyone can build a fair 8-bit randomiser in an afternoon. The system is the CORPUS and the
// INTERPRETIVE TRAINING, and neither of those is software. That inoculates against the standard
// mistake — shipping the dice and calling it the tradition — which is exactly the mistake `/the-256`
// refuses to make.
//
// ⚠️ WHAT THIS PAGE DOES NOT CONTAIN, and the refusal is the content:
//   ⛔ no odu names        — a page that casts eight bits and prints "Ogbè Òfún" HAS DIVINED, however
//                            carefully hedged, and has moved itself up the authority table
//   ⛔ no ese, not one verse — printed is not released; copyright expiry is not consent
//   ⛔ no generated reading  — the babalawo is the authority and we are not replacing him with an RNG
//
//   import { SYSTEMS, LESSONS, CONTESTED, divinationHTML, handler } from './divination-structures.mjs'

import { esc } from './the-line.mjs';
export { esc };

export const SYSTEMS = Object.freeze([
  Object.freeze({
    id: 'ifa', name: 'Ifá',
    mechanism: '8 binary marks — cast with the ọpẹlẹ chain, or by manipulating sixteen sacred palm-nuts and marking the result in dust on the ọpọn Ifá tray',
    outcomes: 256, outcomesLabel: '256 odu',
    meaningLives: 'a memorised verse corpus, recited by an initiate',
    note: '2⁸ = 256, and 256 is exactly the number of odu. ⭐ The odu is an ADDRESS; what lives at that '
      + 'address is the ese — on the order of 800 verses per odu, memorised. The addressable space is '
      + 'roughly 200,000 verses, and it is enormous deliberately: a system with sixty-four outcomes '
      + 'forces coarse matching, and one with 256 addresses does not.',
  }),
  Object.freeze({
    id: 'dilogun', name: 'Dilogún / erindinlogun',
    mechanism: '16 cowries cast; the count landing face-up gives the outcome',
    outcomes: 17, outcomesLabel: '17 primary outcomes, combined',
    meaningLives: 'a verse corpus — the New-World branch Bascom tracked',
    note: 'Sixteen cowries give seventeen primary results (0 through 16 face-up), then combine. A '
      + 'different generator reaching a comparable job.',
  }),
  Object.freeze({
    id: 'i-ching', name: 'I Ching',
    mechanism: '6 binary lines, with moving lines producing a transformation',
    outcomes: 64, outcomesLabel: '64 hexagrams, plus transformations',
    meaningLives: 'a fixed written text',
    note: '⭐ The one system here whose meaning lives in a TEXT rather than in a trained memory. That '
      + 'is why it travelled and the others largely did not — a book can be carried and an initiation '
      + 'cannot.',
  }),
  Object.freeze({
    id: 'geomancy', name: 'Geomancy (ʿilm al-raml → European)',
    mechanism: '4 rows of marks, taken four times',
    outcomes: 16, outcomesLabel: '16 figures, arrayed in a shield chart',
    meaningLives: 'figure meanings plus positional rules',
    note: 'The meaning is split between the figure and WHERE it lands in the chart — closer to a grammar '
      + 'than to a lookup, and the only one of the four that works that way.',
  }),
]);

export const getSystem = (id) => SYSTEMS.find((s) => s.id === String(id || '').toLowerCase()) || null;

export const LESSONS = Object.freeze([
  Object.freeze({
    id: 'randomiser-is-trivial',
    lesson: 'The randomiser is the trivial part.',
    detail: 'Anyone can build a fair 8-bit randomiser in an afternoon. The system is the corpus and the '
      + 'interpretive training, and neither is a piece of software. ⭐ This is the single most useful '
      + 'thing a technologist can learn from Ifá, and it inoculates against shipping the dice and '
      + 'calling it the tradition.',
  }),
  Object.freeze({
    id: 'address-space',
    lesson: 'The address space is large on purpose.',
    detail: '256 addresses with hundreds of verses each is a design decision, not an accident of the '
      + 'hardware. Coarse spaces force coarse matching.',
  }),
  Object.freeze({
    id: 'binary-generator',
    lesson: 'A binary generator feeding a fixed enumerated space recurs across West Africa, China and the Islamic Mediterranean.',
    detail: '⚠️ Record the STRUCTURE separately from the roster and the recurrence becomes visible as a '
      + 'shape human systems reach for — the same discipline cosmologies.mjs applies to world-ages, '
      + 'where FIVE recurs between Hesiod and the Mexica with nothing else travelling alongside it. A '
      + 'shared architecture is a fact about architecture, not evidence of contact.',
  }),
]);

/** ⚠️ The one historical claim that must not be asserted. */
export const CONTESTED = Object.freeze({
  claim: 'That Ifá and Arabic geomancy are historically connected.',
  status: 'genuinely contested',
  rule: 'Do not assert it. The structural similarity is real and observable; a transmission story is a '
    + 'separate claim requiring separate evidence — a loanword, a technique, a name travelling with it. '
    + 'Neither direction is established here.',
});

/** ⛔ What the page refuses to contain, stated on the page. */
export const REFUSED = Object.freeze([
  Object.freeze({ what: 'the ese — not one verse',
    why: 'They are the content of an initiatory tradition and their transmission is governed by the people who hold it. Printed is not the same as released for republication. Copyright expiry is not consent.' }),
  Object.freeze({ what: 'odu names attached to outcomes',
    why: 'A page that casts eight bits and prints a name has performed a divination, however carefully it is hedged.' }),
  Object.freeze({ what: 'any generated reading',
    why: 'The babalawo is the authority in this tradition, and replacing him with a random number generator is the specific insult available here.' }),
]);

export function divinationHTML() {
  const rows = SYSTEMS.map((s) => `<tr>
    <td><b>${esc(s.name)}</b></td>
    <td class=muted>${esc(s.mechanism)}</td>
    <td>${esc(s.outcomesLabel)}</td>
    <td class=muted>${esc(s.meaningLives)}</td>
  </tr>`).join('');
  const lessons = LESSONS.map((l) => `<li><b>${esc(l.lesson)}</b><span class=muted>${esc(l.detail)}</span></li>`).join('');
  const notes = SYSTEMS.map((s) => `<div class=card><h3 style="margin-top:0">${esc(s.name)}</h3><p class=muted>${esc(s.note)}</p></div>`).join('');
  const refused = REFUSED.map((r) => `<li><b>⛔ ${esc(r.what)}</b><span class=muted>${esc(r.why)}</span></li>`).join('');
  return `<h1>Four divination systems, compared by architecture</h1>
<p class=muted>Strip the content and the <b>structure</b> is public, well described, and genuinely
remarkable — and studying it discloses nothing restricted. This page is the architecture and nothing
else.</p>

<table class=who>
  <thead><tr><th>system</th><th>mechanism</th><th>outcomes</th><th>where the meaning lives</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class=card>
  <h2 style="margin-top:0">Three things that follow</h2>
  <ul class=limits>${lessons}</ul>
</div>

<div class=card>
  <h2 style="margin-top:0">⚠️ One thing we will not claim</h2>
  <p><b>${esc(CONTESTED.claim)}</b> — ${esc(CONTESTED.status)}.</p>
  <p class=muted>${esc(CONTESTED.rule)}</p>
</div>

${notes}

<div class=card>
  <h2 style="margin-top:0">What this page does not contain</h2>
  <ul class=limits>${refused}</ul>
</div>`;
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'divination-structures',
    systems: SYSTEMS.map((s) => ({ id: s.id, name: s.name, outcomes: s.outcomes, meaningLives: s.meaningLives })),
    lessons: LESSONS.map((l) => l.lesson),
    contested: CONTESTED.claim,
    refuses: REFUSED.map((r) => r.what),
    note: 'Architecture only. No odu names, no verses, no generated reading — the randomiser is the '
        + 'trivial part, and the corpus and the training are not software.',
  }, null, 2));
}

export default { SYSTEMS, LESSONS, CONTESTED, REFUSED, getSystem, divinationHTML, handler };
