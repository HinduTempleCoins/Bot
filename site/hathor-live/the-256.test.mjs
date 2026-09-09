// site/hathor-live/the-256.test.mjs — offline, no network, no fs.
//
// The point of this file is the ENFORCEMENT. A comment asking a future agent not to print odu names
// is a wish; `assertNoContent()` is a check, and these tests are what keep it honest.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STRUCTURE, TEACHINGS, COMPARISON, CONTESTED, SCHOLARSHIP, LUKUMI, CONSENT_RULE,
  CAST_KEYS, FORBIDDEN_SHAPES, SAYS,
  cast, assertNoContent, gridHTML, the256PageHTML, handler,
} from './the-256.mjs';
import moduleDefault from './the-256.mjs';
import { CONSULT, claimsCheck } from './the-line.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}

// ── the arithmetic ───────────────────────────────────────────────────────────────────────────────

test('eight binary marks give exactly 256 addresses, and that is the number of odu', () => {
  assert.equal(STRUCTURE.marks, 8);
  assert.equal(STRUCTURE.addresses, 256);
  assert.equal(2 ** STRUCTURE.marks, STRUCTURE.addresses);
  assert.equal(STRUCTURE.esePerAddressApprox, 800);
  assert.equal(STRUCTURE.addressSpaceApprox, 204800);
  assert.equal(STRUCTURE.generators.length, 2, 'the chain and the palm-nuts');
});

test('every one of the 256 addresses is reachable, and no other value is', () => {
  // Drive the generator deterministically over all 256 bit patterns.
  const hit = new Set();
  for (let n = 0; n < 256; n += 1) {
    let i = 0;
    const c = cast({ random: () => (((n >> (7 - i++)) & 1) ? 0.9 : 0.1) });
    assert.equal(c.address, n, `bit pattern ${n.toString(2).padStart(8, '0')}`);
    assert.equal(c.bits, n.toString(2).padStart(8, '0'));
    assert.equal(c.marks.length, 8);
    hit.add(c.address);
  }
  assert.equal(hit.size, 256);
});

test('a cast is unbiased across the two marks and never throws on a junk randomiser', () => {
  assert.equal(cast({ random: () => 0 }).address, 0);
  assert.equal(cast({ random: () => 0.99 }).address, 255);
  assert.doesNotThrow(() => cast({ random: 'not a function' }));
  assert.doesNotThrow(() => cast(null));
  assert.doesNotThrow(() => cast());
});

// ── ⛔ THE REFUSAL, ENFORCED ─────────────────────────────────────────────────────────────────────

test('⛔ a cast returns an ADDRESS and nothing that could be printed as an answer', () => {
  const c = cast({ random: () => 0.4 });
  assert.deepEqual(Object.keys(c).sort(), [...CAST_KEYS].sort());
  assert.equal(typeof c.address, 'number');
  assert.ok(Number.isInteger(c.address));
  // No name, no meaning, no verse, no orisha, no element, no direction — by absence, checked by name.
  for (const k of ['name', 'odu', 'ese', 'verse', 'reading', 'meaning', 'orisha', 'element', 'direction', 'sign']) {
    assert.equal(c[k], undefined, `a cast must not carry ${k}`);
  }
});

test('⛔ assertNoContent() refuses a per-address table — it is a throw, not a comment', () => {
  assert.equal(assertNoContent(), true);
  // A 256-entry string table is the shape of an odu roster and must fail the build.
  assert.throws(() => assertNoContent({ TABLE: new Array(256).fill('a name') }), /256-entry string table/);
  assert.throws(() => assertNoContent({ nested: { deep: new Array(17).fill('x') } }), /17-entry string table/);
  // A key called odu / ese / verse / reading / oracle fails wherever it appears.
  for (const k of ['odu', 'ese', 'verse', 'verses', 'reading', 'readings', 'fortune', 'oracle']) {
    assert.throws(() => assertNoContent({ [k]: 'anything at all' }), /does not carry odu, ese, readings or oracles/, k);
  }
  // And a legitimate 16-entry list is allowed: the cowries and the geomantic figures are real.
  assert.equal(assertNoContent({ ok: new Array(16).fill('figure') }), true);
});

test('⛔ the module’s whole export tree passes the content check at load', () => {
  // It already ran at import time — importing this file would have thrown otherwise. Assert it again
  // over the DEFAULT export, which is the tree a consumer actually reaches for.
  assert.doesNotThrow(() => assertNoContent(moduleDefault));
});

test('⛔ nothing on the page or in the JSON is a per-address string', () => {
  const html = the256PageHTML();
  const { res, o } = cap();
  handler({ url: '/api/the-256/cast' }, res);
  const json = o.body;
  for (const surface of [html, json]) {
    // A reading would have to be attached to the address. There is no such attachment anywhere.
    assert.ok(!/address\s*\d+\s*(is|means|says|:)\s*[A-Z]/.test(surface));
  }
  // The grid cells carry no text at all — a cell is a position, not a thing with a name.
  const grid = gridHTML({ address: 7 });
  assert.equal((grid.match(/<i class="cell/g) || []).length, 256);
  assert.ok(!/>[^<]+</.test(grid.replace(/<div class=grid[^>]*>/, '<div>')), 'no cell may contain text');
  assert.match(grid, /cell hit/);
  assert.deepEqual(gridHTML({ address: 999 }).match(/cell hit/g), null, 'an out-of-range address highlights nothing');
});

test('⭐ the server says the same thing at every address — there is no branch on the cast', () => {
  const bodies = new Set();
  for (let i = 0; i < 40; i += 1) {
    const { res, o } = cap();
    handler({ url: '/api/the-256/cast' }, res);
    bodies.add(JSON.parse(o.body).says);
  }
  assert.equal(bodies.size, 1, 'one address must not produce different words from another');
  assert.equal([...bodies][0], SAYS);
  assert.match(SAYS, /neither of those is software/);
});

// ── the teaching ─────────────────────────────────────────────────────────────────────────────────

test('the first teaching is that the randomiser is the trivial part', () => {
  assert.equal(TEACHINGS[0].id, 'randomiser-is-trivial');
  assert.match(TEACHINGS[0].headline, /randomiser is the trivial part/);
  assert.match(TEACHINGS[0].body, /shipping the dice and calling it the tradition/);
  assert.equal(TEACHINGS.length, 3);
});

test('the comparative table has all four systems and says where the meaning lives', () => {
  assert.deepEqual(COMPARISON.map((c) => c.id), ['ifa', 'dilogun', 'iching', 'geomancy']);
  assert.match(COMPARISON.find((c) => c.id === 'ifa').outcomes, /256/);
  assert.match(COMPARISON.find((c) => c.id === 'iching').outcomes, /64/);
  assert.match(COMPARISON.find((c) => c.id === 'geomancy').outcomes, /16/);
  assert.match(COMPARISON.find((c) => c.id === 'dilogun').outcomes, /17/);
  for (const c of COMPARISON) assert.ok(c.meaningLives && c.mechanism, c.id);
});

test('⚠️ the Ifá–geomancy link is marked contested and is NOT asserted', () => {
  assert.equal(CONTESTED.status, 'contested');
  assert.match(CONTESTED.claim, /historically connected/);
  assert.match(CONTESTED.ourPosition, /We do not assert it/);
  const html = the256PageHTML();
  assert.match(html, /contested/);
  // The page must not contain the affirmative version anywhere.
  assert.ok(!/Ifá (?:derives|descends|comes) from|derived from Arabic geomancy/i.test(html));
});

test('the UNESCO record is cited with its reference number and both dates', () => {
  assert.equal(STRUCTURE.unesco.reference, '00146');
  assert.equal(STRUCTURE.unesco.proclaimed, 2005);
  assert.equal(STRUCTURE.unesco.inscribed, 2008);
  const html = the256PageHTML();
  assert.match(html, /00146/);
  assert.match(html, /Representative List in 2008/);
  // The safeguarding problem, stated rather than skipped, because a page that celebrates a tradition
  // and omits that its transmitters are elderly and unfunded is doing publicity, not scholarship.
  assert.match(html, /mostly elderly/);
});

test('the scholarship section prefers the practitioner-scholar and says why', () => {
  const abimbola = SCHOLARSHIP.find((s) => /Abimbola/.test(s.author));
  assert.ok(abimbola);
  assert.match(abimbola.why, /Àwíṣẹ Awo Àgbáyé/);
  assert.match(abimbola.why, /consent structure/);
  assert.equal(abimbola.read, false, 'not read in full, and the page says so');
  assert.match(the256PageHTML(), /Neither has been read in full/);
});

test('Lukumi is cited for its substantive holding, with the search lesson attached', () => {
  assert.equal(LUKUMI.cite, '508 U.S. 520 (1993)');
  assert.match(LUKUMI.holding, /religious gerrymander/);
  assert.match(LUKUMI.lesson, /the name the courts use/);
  const html = the256PageHTML();
  assert.match(html, /508 U\.S\. 520 \(1993\)/);
  assert.match(html, /Supreme Court win/);
});

test('the consent rule is imported from the repo’s own rule, not re-derived', () => {
  assert.equal(CONSENT_RULE.rule, 'Copyright expiry is not consent.');
  assert.match(CONSENT_RULE.source, /cosmologies\.mjs/);
  const html = the256PageHTML();
  assert.match(html, /Copyright expiry is not consent/);
  assert.match(html, /integrations\/cosmologies\.mjs/);
});

// ── the page's obligations ───────────────────────────────────────────────────────────────────────

test('the page carries consultBanner and CONSULT.notALab', () => {
  const html = the256PageHTML();
  assert.match(html, /class="consult"/);
  assert.ok(html.includes(CONSULT.short));
  assert.ok(html.includes(CONSULT.notALab.slice(0, 60)));
});

test('everything interpolated is escaped, and nothing user-supplied reaches the page at all', () => {
  const html = the256PageHTML();
  assert.ok(!html.includes('<script>alert'));
  // The page takes no input: there is no query parameter, no key and no seed on it.
  assert.ok(!/seed|participant|key=/i.test(html.replace(/<script>[\s\S]*?<\/script>/g, '')));
  // The apostrophes and diacritics in ọpẹlẹ / ọpọn / Àwíṣẹ must survive without smuggling markup.
  assert.match(html, /ọpẹlẹ/);
  assert.match(html, /Àwíṣẹ Awo Àgbáyé/);
  assert.ok(!/<b>[^<]*<b>/.test(html), 'no unbalanced markup from interpolation');
});

test('the refusal appears on the page in the place a reading would have gone', () => {
  const html = the256PageHTML();
  assert.match(html, /what we are not going to do next/i);
  assert.match(html, /has performed a divination/);
  assert.match(html, /Printed is not the same as released/);
  assert.match(html, /not replacing him with a random number\s*\n?\s*generator/);
});

test('handler serves the cast, the refusal and the rule, and never throws', () => {
  const { res, o } = cap();
  handler({ url: '/api/the-256/cast' }, res);
  assert.equal(o.code, 200);
  assert.match(o.type, /application\/json/);
  const d = JSON.parse(o.body);
  assert.equal(d.ok, true);
  assert.deepEqual(Object.keys(d.cast).sort(), [...CAST_KEYS].sort());
  assert.equal(d.rule, CONSENT_RULE.rule);
  assert.deepEqual(d.refused, FORBIDDEN_SHAPES);
  assert.doesNotThrow(() => { const c = cap(); handler(null, c.res); });
});

test('claimsCheck over every line of prose on the page', () => {
  const prose = [
    SAYS, CONSENT_RULE.full, CONTESTED.ourPosition, LUKUMI.holding, LUKUMI.whyHere, LUKUMI.lesson,
    ...TEACHINGS.map((t) => `${t.headline} ${t.body}`),
    ...COMPARISON.map((c) => `${c.mechanism} ${c.meaningLives}`),
    ...SCHOLARSHIP.map((s) => s.why),
    STRUCTURE.unesco.corpus, STRUCTURE.unesco.diviner, STRUCTURE.unesco.safeguarding,
  ];
  const flagged = prose.map((l) => ({ l, c: claimsCheck(l) })).filter((x) => !x.c.ok);
  // Zero, asserted as a number. A page about divination has no efficacy claim to make, and that it
  // makes none is worth pinning rather than assuming.
  assert.equal(flagged.length, 0, JSON.stringify(flagged, null, 2));
});
