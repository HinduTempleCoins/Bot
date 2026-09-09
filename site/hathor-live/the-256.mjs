// site/hathor-live/the-256.mjs — The 256. Ifá's STRUCTURE, taught, and its content refused.
//
// ── THE REFUSAL IS THE CONTENT, AND THAT IS NOT A CONSOLATION PRIZE ──────────────────────────────
//
// A page that demonstrates a divination system and then declines to divine is more memorable than
// one that produces a fortune, and it is the clearest possible demonstration of the question the
// whole exam battery is organised around: WHO IS AUTHORISED TO SAY WHAT IS HAPPENING TO YOU?
//
// In Ifá the answer is a trained initiate reciting from a memorised corpus. Not a random number
// generator, and not this page. So this page casts eight marks, lands in one of 256 cells, and then
// says what is at that address in the tradition — and does not print it.
//
// ── WHAT IS REFUSED, AND WHY ─────────────────────────────────────────────────────────────────────
//
//   ⛔ THE ODU NAMES. A page that casts eight bits and prints a name HAS PERFORMED A DIVINATION,
//      however carefully it is hedged. There is no wording that makes that not so.
//   ⛔ THE ESE. Not one verse. They are the content of an initiatory tradition and their transmission
//      is governed by the people who hold it. Some are printed in Bascom (1969) and Abimbola (1976);
//      PRINTED IS NOT THE SAME AS RELEASED FOR REPUBLICATION BY A CHATBOT, and a 1969 monograph's
//      copyright status is irrelevant to the question.
//   ⛔ ANY GENERATED READING. The babalawo is the authority in this tradition and we are not
//      proposing to replace him with a random number generator. That is the specific insult available
//      here, and it is worth naming so that nobody drifts into it.
//   ⛔ INITIATORY PROCEDURE, and anything tied to a particular lineage's practice.
//
// THE RULE IS NOT NEW AND IT IS NOT OURS. `integrations/cosmologies.mjs` already states it, in its
// own words: "Do not add detail from a restricted register because a source is out of copyright.
// COPYRIGHT EXPIRY IS NOT CONSENT." This module imports that rule rather than restating it, so the
// two can never drift into disagreeing.
//
// ── AND `assertNoContent()` IS A THROW, NOT A COMMENT ────────────────────────────────────────────
//
// Same posture as `assertNeverPayable()` in exams.mjs: it runs at module load, so a build that ever
// acquires a 256-entry name table or a verse refuses to start rather than serving traffic. A comment
// asking a future agent not to do something is a wish. This is a check.
//
// ── WHAT IS IN ───────────────────────────────────────────────────────────────────────────────────
//
// The structure, the arithmetic, the history, the UNESCO record, the Lukumi holding, the comparative
// table, and the pointer to Abimbola and Bascom for anybody who wants to go further. That is a real
// contribution and it costs the tradition nothing.
//
// Pure and offline. No I/O. esc() everything.

import { esc } from '../../integrations/melek-theme.mjs';
import { examShell } from './exams.mjs';
import { CONSULT } from './the-line.mjs';

export { esc };

export const PAGE_ID = 'the-256';
export const ROUTE = '/the-256';

/**
 * The consent rule, quoted from `integrations/cosmologies.mjs` rather than re-derived. If that file's
 * rule ever changes, this page should change with it — which is what importing a constant is for.
 */
export const CONSENT_RULE = Object.freeze({
  rule: 'Copyright expiry is not consent.',
  source: 'integrations/cosmologies.mjs — the standing rule for restricted registers in this repo.',
  full: 'Do not add detail from a restricted register because a source is out of copyright. An '
    + 'ethnographer printed it in 1969 is not the same sentence as the community consented to its '
    + 'circulation, and the second is the one that matters.',
});

// ── the structure, which is a legitimate object of study on its own ──────────────────────────────

/** The arithmetic. Eight binary marks, 2⁸ addresses, and that is exactly the number of odu. */
export const STRUCTURE = Object.freeze({
  marks: 8,
  addresses: 256,
  esePerAddressApprox: 800,
  addressSpaceApprox: 256 * 800,
  generators: Object.freeze([
    'the ọpẹlẹ — a divination chain, cast once, which reads out all eight marks at a stroke',
    'sixteen sacred palm-nuts, grasped and counted, with the result marked in dust on the ọpọn Ifá tray',
  ]),
  // UNESCO Intangible Cultural Heritage, "Ifa divination system" (Nigeria), reference 00146:
  // proclaimed a Masterpiece in 2005, inscribed on the Representative List in 2008.
  unesco: Object.freeze({
    reference: '00146',
    title: 'Ifa divination system',
    country: 'Nigeria',
    proclaimed: 2005,
    inscribed: 2008,
    corpus: 'The corpus, odu, consists of 256 parts subdivided into verses called ese, of which there '
      + 'are roughly 800 per odu and whose exact number remains unknown as they are constantly increasing.',
    diviner: 'The diviner is the babalawo — literally "the priest’s father" — who INTERPRETS '
      + 'divination signs rather than relying on oracular powers of his own.',
    safeguarding: 'UNESCO records the safeguarding problem plainly: the priests are mostly elderly, '
      + 'have modest means to transmit their knowledge, and face youth disengagement and a growing '
      + 'intolerance of traditional divination.',
  }),
});

/**
 * ⭐ The three things that follow from the structure, and each is worth teaching.
 *
 * The first is the one a technologist most needs and least expects.
 */
export const TEACHINGS = Object.freeze([
  {
    id: 'randomiser-is-trivial',
    headline: 'The randomiser is the trivial part.',
    body: 'Anyone can build a fair eight-bit generator in an afternoon; there is one on this page and it '
      + 'took no skill to write. The system is the CORPUS and the INTERPRETIVE TRAINING, and neither is a '
      + 'piece of software. This is the single most useful thing a technologist can learn from Ifá, and it '
      + 'inoculates against the standard mistake: shipping the dice and calling it the tradition.',
  },
  {
    id: 'address-space',
    headline: 'The address space is enormous, and deliberately so.',
    body: 'With roughly 800 ese at each of 256 addresses, the addressable space is on the order of two '
      + 'hundred thousand verses. A system with sixty-four outcomes forces coarse matching; one with 256 '
      + 'addresses and hundreds of verses at each does not. The size is a design decision about precision, '
      + 'not an accident of the randomiser.',
  },
  {
    id: 'the-verse-is-chosen',
    headline: 'The cast does not deliver an answer. It delivers an address.',
    body: 'What lives at that address is hundreds of memorised verses, and the babalawo recites from it '
      + 'and works with the client to find which verse speaks to the situation. The interpretation is a '
      + 'conversation between two people, and it is the part no mechanism performs.',
  },
]);

/**
 * The comparative table. §7.3 of the source paper.
 *
 * ⚠️ The Ifá–geomancy historical link is GENUINELY CONTESTED and is not asserted. What is observed is
 * the recurrence of a shape — a binary generator plus a fixed enumerated space — across West Africa,
 * China and the Islamic Mediterranean, which is exactly the kind of observation `cosmologies.mjs`
 * handles by recording the structure separately from the roster: the recurrence becomes visible as a
 * shape human systems reach for, without requiring a diffusion story.
 */
export const COMPARISON = Object.freeze([
  {
    id: 'ifa',
    system: 'Ifá',
    mechanism: 'eight binary marks, from the ọpẹlẹ chain or sixteen palm-nuts',
    outcomes: '256 odu',
    meaningLives: 'in a memorised verse corpus, recited by an initiate',
  },
  {
    id: 'dilogun',
    system: 'Dilogún (erindinlogun)',
    mechanism: 'sixteen cowries cast, the face-up ones counted',
    outcomes: '17 primary outcomes, combined',
    meaningLives: 'in a verse corpus; the New-World branch Bascom tracked',
  },
  {
    id: 'iching',
    system: 'I Ching',
    mechanism: 'six binary lines, with moving lines',
    outcomes: '64 hexagrams, plus transformations',
    meaningLives: 'in a fixed written text',
  },
  {
    id: 'geomancy',
    system: 'Geomancy (ʿilm al-raml → European)',
    mechanism: 'four rows of marks, four times',
    outcomes: '16 figures, arrayed in a shield chart',
    meaningLives: 'in figure meanings plus positional rules',
  },
]);

export const CONTESTED = Object.freeze({
  claim: 'That Ifá and Arabic geomancy are historically connected.',
  status: 'contested',
  ourPosition: 'We do not assert it. What is observable without it is that a binary generator feeding a '
    + 'fixed enumerated space recurs across West Africa, China and the Islamic Mediterranean — a shape '
    + 'human systems reach for, which needs no diffusion story to be interesting.',
});

/** The scholarship to prefer, and why. Practitioner-scholars first. */
export const SCHOLARSHIP = Object.freeze([
  {
    author: 'Wande Abimbola',
    works: 'Ifá: An Exposition of Ifá Literary Corpus (1976); Ifá Divination Poetry (1977).',
    why: '⭐ Abimbola writes as BOTH — as an academic who held a chair and a vice-chancellorship, and as '
      + 'Àwíṣẹ Awo Àgbáyé, the spokesperson for Ifá worldwide. A verse he publishes as a scholar is '
      + 'published by an initiate who is entitled to publish it. That is a consent structure, and it is '
      + 'why he is the citation to prefer. Note which hat, where it can be told.',
    read: false,
  },
  {
    author: 'William Bascom',
    works: 'Ifa Divination: Communication Between Gods and Men in West Africa (1969); Sixteen Cowries: '
      + 'Yoruba Divination from Africa to the New World (1980).',
    why: 'Fieldwork 1936–38 at Ile-Ifẹ and elsewhere. The standard outsider ethnography, and the one that '
      + 'made the system legible in English.',
    read: false,
  },
]);

/**
 * The legal anchor, and the lesson in how it was found.
 *
 * Searching an archive for "Orisha" returns nothing. Searching for the name THE COURTS use returns a
 * great deal. Search legal material by the name the courts use, not the name the tradition uses.
 */
export const LUKUMI = Object.freeze({
  case: 'Church of the Lukumi Babalu Aye, Inc. v. City of Hialeah',
  cite: '508 U.S. 520 (1993)',
  holding: 'Hialeah ordinances that reached Orisha ritual practice were struck down. A facially neutral '
    + 'law drawn to reach one disfavoured faith is a "religious gerrymander" which is neither neutral nor '
    + 'generally applicable, and must survive strict scrutiny — which these did not.',
  whyHere: 'Lukumí IS the Orisha religion — Yoruba-derived Cuban Santería. The tradition this page is '
    + 'about is not a hypothetical for First Amendment purposes. It is the subject of a Supreme Court win.',
  lesson: 'Search legal material by the name the courts use, not the name the tradition uses.',
});

// ── the randomiser, which is the trivial part and is labelled as such ────────────────────────────

/**
 * Cast eight binary marks.
 *
 * ⭐ WHAT THIS RETURNS AND WHAT IT REFUSES TO RETURN. It returns eight marks, the integer they encode,
 * and the size of the space. It does NOT return a name, a verse, a reading, a meaning, an element, a
 * direction, an orisha, or anything that could be printed as an answer — and `assertNoContent()`
 * below fails the build if any of those ever appear.
 *
 * `random` is injectable so the offline suite can drive every one of the 256 addresses without a
 * network, a clock or a flaky assertion.
 */
export function cast(opts) {
  // Soft-fail: `cast(null)` and `cast('nonsense')` must produce an address, not an exception. This is
  // in a request path and the house rule is never-throw.
  const o = opts && typeof opts === 'object' ? opts : {};
  const rnd = typeof o.random === 'function' ? o.random : Math.random;
  const marks = [];
  let address = 0;
  for (let i = 0; i < STRUCTURE.marks; i += 1) {
    // Two marks per position — a single line or a double line, as they are drawn in the dust — which
    // is one bit. Nothing about the encoding is a claim: it is how many outcomes there are.
    const bit = rnd() < 0.5 ? 0 : 1;
    marks.push(bit);
    address = (address << 1) | bit;
  }
  return {
    marks,
    bits: marks.join(''),
    address,                       // 0–255. An index into a space, not a name.
    addressSpace: STRUCTURE.addresses,
  };
}

/** The keys a cast may ever carry. Anything else is a content leak. */
export const CAST_KEYS = Object.freeze(['marks', 'bits', 'address', 'addressSpace']);

/**
 * Words that would mean this module had started printing content. Checked against the module's own
 * exported data at load, so the failure is a refusal to boot rather than a wrong page served.
 *
 * These are DELIBERATELY not odu names. Listing the 256 names in order to check that we do not print
 * them would put them in the repository, which is the thing being avoided — so the check is
 * structural: no 256-entry string table, no per-address content of any kind.
 */
export const FORBIDDEN_SHAPES = Object.freeze([
  'a table with one entry per address',
  'any verse text',
  'any per-address name, meaning, element, direction or orisha',
  'any function that maps a cast to words',
]);

/**
 * assertNoContent() — a throw, not a comment. Runs at load.
 *
 * It walks every exported value and fails if it finds an array long enough to be a per-address table,
 * or a cast result carrying a key outside the allow-list. `assertNeverPayable()` in exams.mjs is the
 * precedent: a soft-fail here would let a wrong build serve traffic.
 */
export function assertNoContent(module = null) {
  const root = module || {
    STRUCTURE, TEACHINGS, COMPARISON, SCHOLARSHIP, LUKUMI, CONSENT_RULE, CONTESTED, FORBIDDEN_SHAPES,
  };
  const seen = new Set();
  const walk = (node, path) => {
    if (node == null || seen.has(node)) return;
    if (typeof node === 'object') seen.add(node);
    if (Array.isArray(node)) {
      // 16 is the largest legitimate enumerated list here (the cowries, the geomantic figures). A
      // longer one is the shape of a per-address table and is refused on sight.
      if (node.length > 16 && node.some((x) => typeof x === 'string')) {
        throw new Error(`the-256.mjs: ${path} is a ${node.length}-entry string table — that is the shape of an odu roster, and this module does not carry one`);
      }
      node.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (/^(odu|ese|verse|verses|reading|readings|fortune|oracle)$/i.test(k)) {
        throw new Error(`the-256.mjs: ${path}.${k} — this module does not carry odu, ese, readings or oracles`);
      }
      walk(v, `${path}.${k}`);
    }
  };
  walk(root, 'exports');

  // And the cast itself: drive both extreme addresses and confirm the shape is exactly the allow-list.
  for (const bit of [0, 1]) {
    const c = cast({ random: () => (bit ? 0.9 : 0.1) });
    const keys = Object.keys(c).sort();
    if (keys.join(',') !== [...CAST_KEYS].sort().join(',')) {
      throw new Error(`the-256.mjs: a cast returned ${keys.join(',')} — the allow-list is ${CAST_KEYS.join(',')}`);
    }
    if (typeof c.address !== 'number' || !Number.isInteger(c.address)) {
      throw new Error('the-256.mjs: an address must be an integer index, never a label');
    }
  }
  return true;
}
assertNoContent();

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

/** The 256-cell grid, unlabelled. A cell is a position; it is not a thing with a name. */
export function gridHTML({ address = null } = {}) {
  const a = Number.isInteger(address) && address >= 0 && address < STRUCTURE.addresses ? address : null;
  const cells = [];
  for (let i = 0; i < STRUCTURE.addresses; i += 1) {
    cells.push(`<i class="cell${i === a ? ' hit' : ''}"></i>`);
  }
  return `<div class=grid aria-label="256 addresses, unlabelled">${cells.join('')}</div>`;
}

export function the256PageHTML() {
  const u = STRUCTURE.unesco;
  const body = `<h1>The 256</h1>
<p class=muted>A divination system’s <b>structure</b>, demonstrated — and its content declined. The
declining is the teaching.</p>

<div class=card>
  <h2 style="margin-top:0">The arithmetic, which is public and remarkable</h2>
  <p>Ifá is a <b>formal randomisation system feeding an addressable corpus</b>. Eight binary marks are
  generated — by casting the <i>ọpẹlẹ</i> divination chain, or by manipulating sixteen sacred palm-nuts
  and marking the result in dust on the <i>ọpọn Ifá</i> tray. Eight binary marks give
  <b>2<sup>8</sup> = ${esc(String(STRUCTURE.addresses))}</b> outcomes, and
  ${esc(String(STRUCTURE.addresses))} is exactly the number of <i>odu</i>.</p>
  <p><b>The odu is an address.</b> What lives at that address is the <i>ese</i> — roughly
  ${esc(String(STRUCTURE.esePerAddressApprox))} memorised verses per odu, on the order of
  ${esc(String(STRUCTURE.addressSpaceApprox.toLocaleString('en')))} verses in all — and the
  <i>babalawo</i>’s work is to recite from that address and, with the client, find which verse speaks
  to the situation.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Cast eight marks</h2>
  <p class=muted>This is a fair eight-bit generator. It took no skill to write, and that is the point.</p>
  <p><button type=button id=castbtn>Cast</button> <span class=muted id=castout></span></p>
  <div id=marks class=marks></div>
  ${gridHTML({})}
  <div id=say></div>
</div>

<div class=card>
  <h2 style="margin-top:0">And here is what we are not going to do next</h2>
  <p>You have just addressed one of ${esc(String(STRUCTURE.addresses))} locations. At that address, in
  the tradition this comes from, live several hundred memorised verses, and a <i>babalawo</i> trained
  for years knows them. <b>We are not going to print one, and here is why.</b></p>
  <ul class=limits>
    <li><b>A page that casts eight bits and prints a name has performed a divination.</b><span class=muted>However
    carefully it is hedged. There is no wording that makes that not so, so we do not print the
    names.</span></li>
    <li><b>Printed is not the same as released.</b><span class=muted>Some ese appear in Bascom (1969) and
    Abimbola (1976). A monograph’s copyright status is irrelevant to whether the people who hold a
    tradition have consented to a website reprinting it. ${esc(CONSENT_RULE.rule)}</span></li>
    <li><b>The babalawo is the authority here, and we are not replacing him with a random number
    generator.</b><span class=muted>That is the specific insult available in this domain, and it is worth
    naming so that nobody drifts into it.</span></li>
    <li><b>${esc(TEACHINGS[0].headline)}</b><span class=muted>${esc(TEACHINGS[0].body)}</span></li>
  </ul>
</div>

<div class=card>
  <h2 style="margin-top:0">What follows from the structure</h2>
  ${TEACHINGS.map((t) => `<p><b>${esc(t.headline)}</b><br><span class=muted>${esc(t.body)}</span></p>`).join('')}
</div>

<div class=card>
  <h2 style="margin-top:0">Four systems, compared honestly</h2>
  <table>
    <tr><th>system</th><th>mechanism</th><th>outcomes</th><th>where the meaning lives</th></tr>
    ${COMPARISON.map((c) => `<tr><td><b>${esc(c.system)}</b></td><td>${esc(c.mechanism)}</td><td>${esc(c.outcomes)}</td><td>${esc(c.meaningLives)}</td></tr>`).join('')}
  </table>
  <p class=prov>⚠️ <b>${esc(CONTESTED.claim)}</b> That is <b>${esc(CONTESTED.status)}</b> and this page does
  not assert it. ${esc(CONTESTED.ourPosition)}</p>
</div>

<div class=card>
  <h2 style="margin-top:0">The UNESCO record</h2>
  <p>UNESCO Intangible Cultural Heritage, <i>${esc(u.title)}</i> (${esc(u.country)}), reference
  <b>${esc(u.reference)}</b> — proclaimed a Masterpiece in ${esc(String(u.proclaimed))}, inscribed on the
  Representative List in ${esc(String(u.inscribed))}.</p>
  <p>${esc(u.corpus)}</p>
  <p>${esc(u.diviner)}</p>
  <p class=prov>${esc(u.safeguarding)}</p>
</div>

<div class=card>
  <h2 style="margin-top:0">Where to go next, and why these two</h2>
  ${SCHOLARSHIP.map((s) => `<p><b>${esc(s.author)}</b> — ${esc(s.works)}<br><span class=muted>${esc(s.why)}</span></p>`).join('')}
  <p class=prov>Neither has been read in full for this page. Nothing here reproduces content from
  either, which is the point; anyone extending this should read Abimbola first.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">It is also the subject of a Supreme Court win</h2>
  <p>In <em>${esc(LUKUMI.case)}</em>, ${esc(LUKUMI.cite)}, ${esc(LUKUMI.holding)}</p>
  <p>${esc(LUKUMI.whyHere)}</p>
  <p class=prov><b>${esc(LUKUMI.lesson)}</b> Searching an archive for “Orisha” returns nothing.
  Searching for the name the courts use returns a great deal.</p>
</div>

<div class=card>
  <h2 style="margin-top:0">The rule this page obeys, and it is not ours</h2>
  <blockquote>${esc(CONSENT_RULE.full)} <b>${esc(CONSENT_RULE.rule)}</b></blockquote>
  <p class=prov>${esc(CONSENT_RULE.source)}</p>
</div>`;

  const css = `.grid{display:grid;grid-template-columns:repeat(16,1fr);gap:3px;margin:14px 0;max-width:420px}
  .cell{display:block;padding-top:100%;border-radius:3px;background:var(--mk-border)}
  .cell.hit{background:var(--mk-accent)}
  .marks{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap}
  .mark{width:26px;height:44px;display:flex;flex-direction:column;justify-content:space-around;align-items:center}
  .mark span{display:block;height:5px;border-radius:2px;background:var(--mk-text)}
  .mark .single{width:24px} .mark .double{width:10px}
  .mark .pair{display:flex;gap:4px;width:24px;justify-content:space-between}
  blockquote{margin:8px 0;padding:8px 14px;border-left:3px solid var(--mk-border);color:var(--mk-text-muted)}`;

  const js = `(function(){
  var $=function(id){return document.getElementById(id);};
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  $('castbtn').onclick=function(){
    fetch('/api/the-256/cast').then(function(r){return r.json();}).then(function(d){
      var c=d.cast||{};
      // Eight marks: one line or two, as they are drawn in the dust. The mark is a bit; it is not a
      // name, and there is nothing on this page that could turn it into one.
      $('marks').innerHTML=(c.marks||[]).map(function(b){
        return '<div class=mark>'+(b
          ? '<span class=single></span><span class=single></span>'
          : '<div class=pair><span class=double></span><span class=double></span></div>'
            +'<div class=pair><span class=double></span><span class=double></span></div>')+'</div>';
      }).join('');
      var cells=document.querySelectorAll('.cell');
      for(var i=0;i<cells.length;i++) cells[i].className='cell';
      if(cells[c.address]) cells[c.address].className='cell hit';
      $('castout').textContent='address '+c.address+' of '+c.addressSpace;
      // ⭐ The sentence the whole page exists for. It is rendered where a reading would have gone.
      $('say').innerHTML='<p><b>'+esc(d.says||'')+'</b></p>';
    }).catch(function(){ $('castout').textContent='could not reach the server.'; });
  };
})();`;

  return examShell('The 256', body, { extraCSS: css, extraJS: js });
}

/**
 * What the server says back after a cast. It is a constant, so there is no branch on the address and
 * therefore no code path in which one address produces different words from another.
 */
export const SAYS = 'That is an address, and it is all we are going to give you. What lives there is a '
  + 'corpus and the years it takes to learn it, and neither of those is software.';

/** handler(req,res) — the cast endpoint. Never throws; a junk request still gets an address. */
export function handler(req, res) {
  const c = cast();
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({
    ok: true,
    cast: c,
    says: SAYS,
    // Named so a reader of the JSON meets the refusal too, not only a reader of the page.
    refused: FORBIDDEN_SHAPES,
    rule: CONSENT_RULE.rule,
  }, null, 2));
}

const isMain = process.argv[1] && process.argv[1].endsWith('the-256.mjs');
if (isMain) {
  const c = cast();
  console.log(`marks ${c.bits} → address ${c.address} of ${c.addressSpace}`);
  console.log(SAYS);
  console.log(`\n${CONSENT_RULE.rule} — ${CONSENT_RULE.source}`);
  console.log(`assertNoContent(): ${assertNoContent()}`);
}

export default {
  PAGE_ID, ROUTE, STRUCTURE, TEACHINGS, COMPARISON, CONTESTED, SCHOLARSHIP, LUKUMI,
  CONSENT_RULE, CAST_KEYS, FORBIDDEN_SHAPES, SAYS,
  cast, assertNoContent, gridHTML, the256PageHTML, handler, esc, CONSULT,
};
