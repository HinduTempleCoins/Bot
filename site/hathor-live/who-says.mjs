// who-says.mjs — R5. WHO IS AUTHORISED TO SAY WHAT IS HAPPENING TO YOU?
//
// The framing page for the whole battery, and the answer to the question a reader actually has when
// handed a number: *why should I trust this?* It answers structurally instead of reassuringly.
//
// FROM `.local/temple-exams/trance-colour-and-divination.md` §0, which called this the spine rather
// than the decoration and ranked it **very high** value. Four traditions sat on that desk — three
// religions and one battery of web instruments — and they are not four answers to "what is wrong
// with you". They are four answers to the prior and more interesting question.
//
// ⭐ WHY IT IS A PAGE AND NOT A PARAGRAPH. The place a project like this gets into trouble is never
// the measurement. It is quietly moving one row UP the table and becoming the authority. Writing the
// table down where the reader lands makes that move visible if it is ever made — including to us.
//
// ⚠️ AND IT REFUSES THE FLATTERING VERSION. These four are NOT the same thing in different clothes.
// The Zar kodia is doing something structurally close to what a psychophysicist does and distant from
// what an Ifá babalawo does; the babalawo is closer to a lawyer citing precedent than to either.
// Saying so credits each with a method, which is more respectful than "all traditions are one", not
// less. A test asserts the page never claims they are equivalent.
//
//   import { POSITIONS, whoSaysHTML, handler } from './who-says.mjs'

import { esc } from './the-line.mjs';
export { esc };

/**
 * The four positions. `row` is the ladder from most self-authorised to most externally authorised —
 * it exists so `driftCheck()` can answer "has this project moved up the table?" mechanically.
 */
export const POSITIONS = Object.freeze([
  Object.freeze({
    id: 'amica', row: 1,
    tradition: 'AMICA / chromotherapy',
    whoIdentifies: 'the person, self-correlating with a colour',
    groundedIn: 'private correspondence; no practitioner in the loop',
    note: 'Ivah Bergh Whitten\'s contribution was not a discovery about colour — it was moving the '
      + 'authority from the operator to the subject, taught by correspondence course. ⚠️ The corpus '
      + 'currently claims she arrived at this independently; she was reading Ghadiali. That correction '
      + 'is outstanding.',
  }),
  Object.freeze({
    id: 'zar', row: 2,
    tradition: 'Zar',
    whoIdentifies: 'a specialist — the kodia — identifies which Thread (khayt)',
    groundedIn: 'trained recognition of a differential response',
    note: '⭐ The kodia performs each spirit\'s rhythm in turn and watches for a differential reaction. '
      + 'That is a stimulus set, serial presentation, a response criterion, and classification by '
      + 'maximal differential response — a within-person psychophysical protocol, centuries before '
      + 'anyone wrote a method section. Rebuilt honestly as the Thread Protocol.',
  }),
  Object.freeze({
    id: 'ifa', row: 3,
    tradition: 'Orisha / Ifá',
    whoIdentifies: 'a divination system, read by a trained diviner',
    groundedIn: 'a formal randomiser plus a memorised corpus',
    note: 'Eight binary marks address one of 256 positions, each holding hundreds of verses. ⭐ The '
      + 'randomiser is the trivial part — the system is the corpus and the years of training, and '
      + 'neither is software. That is why The 256 teaches the structure and refuses the content.',
  }),
  Object.freeze({
    id: 'temple-exams', row: 4,
    tradition: 'The Temple Exams',
    whoIdentifies: 'an instrument measures; a clinician interprets',
    groundedIn: 'a stated protocol, a stated reference class, and a referral',
    note: '⭐ This is the row we are in, and `CONSULT` in the-line.mjs is it stated in code: "Take the '
      + 'record to a clinician if you want it interpreted — that reading is theirs to make, not ours." '
      + 'We do not interpret. That is not modesty; it is the whole compliance posture and the whole '
      + 'scientific posture in one sentence.',
  }),
]);

export const getPosition = (id) => POSITIONS.find((p) => p.id === String(id || '').toLowerCase()) || null;

/**
 * ⭐ The drift check. Our declared row is 4 — the instrument measures and somebody qualified reads it.
 * Any surface that interprets a result for the taker has moved UP the table. This function exists so
 * that move is answerable mechanically rather than by somebody's memory of an intention.
 */
export const OUR_ROW = 4;
export function driftCheck(opts) {
  // `= {}` as a destructuring default only fires for `undefined`, never for `null` — so
  // `driftCheck(null)` throws where house style says soft-fail. Fifth instance of this null-handling
  // family found today; see covariateNote(), repeatStatistic(), light-signal.mjs num(), and
  // sky-events.mjs precessionDrift().
  const o = (opts && typeof opts === 'object') ? opts : {};
  const { interpretsForTaker = false, namesACondition = false, tellsYouWhatToDo = false } = o;
  const drifts = [];
  if (interpretsForTaker) drifts.push('interprets the result for the taker — that is row 2, the specialist');
  if (namesACondition) drifts.push('names a condition — that is a diagnosis, and it is nobody\'s row here');
  if (tellsYouWhatToDo) drifts.push('tells the taker what to do — that is a clinician, and we are not one');
  return {
    ourRow: OUR_ROW,
    ok: drifts.length === 0,
    drifts,
    verdict: drifts.length === 0
      ? 'Still row 4: measures, states its reference class, refers.'
      : `⚠️ MOVED UP THE TABLE — ${drifts.length} way(s). This is the failure mode the page exists to make visible.`,
  };
}

/** These are not the same thing in different clothes, and the page has to say so. */
export const NOT_EQUIVALENT = Object.freeze({
  claim: 'These four are not one thing in four costumes.',
  why: 'The Zar kodia is doing something structurally close to what a psychophysicist does and '
    + 'structurally distant from what an Ifá babalawo does. The babalawo is closer to a lawyer citing '
    + 'precedent than to either.',
  because: 'Saying so credits each tradition with a method. "All traditions are one" credits none of '
    + 'them with anything, and it is the more disrespectful move despite sounding like the kinder one.',
});

export function whoSaysHTML() {
  const rows = POSITIONS.map((p) => `<tr>
    <td><b>${esc(p.tradition)}</b><span class=muted> · row ${esc(String(p.row))}</span></td>
    <td>${esc(p.whoIdentifies)}</td>
    <td class=muted>${esc(p.groundedIn)}</td>
  </tr>`).join('');
  const notes = POSITIONS.map((p) => `<div class=card>
    <h3 style="margin-top:0">${esc(p.tradition)}</h3>
    <p class=muted>${esc(p.note)}</p>
  </div>`).join('');
  return `<h1>Who is authorised to say what is happening to you?</h1>
<p class=muted>This is the question underneath every number on this site, and it is a better question
than “what is wrong with me”. Four traditions are on this desk — three of them religions and one of
them a battery of web instruments. They are not four answers about you. They are four answers about
<b>who gets to say</b>.</p>

<table class=who>
  <thead><tr><th>tradition</th><th>who identifies it</th><th>what the authority rests on</th></tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class=card>
  <h2 style="margin-top:0">Where we are, and how you would catch us moving</h2>
  <p>We are the fourth row. <b>An instrument measures; a clinician interprets.</b> We do not interpret,
  and that is not modesty — it is the entire posture, scientific and legal, in one sentence.</p>
  <p class=muted>The place a project like this gets into trouble is never the measurement. It is
  quietly moving one row up the table and becoming the authority. So the table is written down here,
  where you land before any exam, and you can hold us to it: <b>if a result on this site ever
  interprets itself for you, names a condition, or tells you what to do, it has moved</b>.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">${esc(NOT_EQUIVALENT.claim)}</h2>
  <p class=muted>${esc(NOT_EQUIVALENT.why)}</p>
  <p class=muted>${esc(NOT_EQUIVALENT.because)}</p>
</div>

${notes}`;
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'who-says',
    ourRow: OUR_ROW,
    positions: POSITIONS.map((p) => ({ id: p.id, row: p.row, tradition: p.tradition, whoIdentifies: p.whoIdentifies })),
    notEquivalent: NOT_EQUIVALENT.claim,
    note: 'The framing question for the battery: who is authorised to say what is happening to you. '
        + 'We are the row where an instrument measures and a clinician interprets.',
  }, null, 2));
}

export default { POSITIONS, OUR_ROW, NOT_EQUIVALENT, getPosition, driftCheck, whoSaysHTML, handler };
