import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NODES, EQUATIONS, TIERS, TRADITIONS, getNode, nodesByTradition,
  equationsFor, cluster, triangulate, weakLinks, registryGap, validate, tierRank,
  ETYMOLOGY, PLANET, enrich, etymologyGap, shakyEtymologies, byPlanet,
  CORRECTIONS, getCorrection, correctionsByVerdict,
} from './pantheon-map.mjs';

test('the data is structurally sound', () => {
  const v = validate();
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
});

test('every equation at cultic or above carries a citable source', () => {
  for (const e of EQUATIONS) {
    if (tierRank(e.tier) >= tierRank('cultic')) {
      assert.ok(e.source && e.source.length > 10, `${e.a}=${e.b} needs a real source`);
    }
  }
});

test('no equation is duplicated in either direction', () => {
  const seen = new Set();
  for (const e of EQUATIONS) {
    const key = [e.a, e.b].sort().join('=');
    assert.ok(!seen.has(key), `duplicate equation ${key}`);
    seen.add(key);
  }
});

test('the Berber pantheon is present with primary sources', () => {
  const berber = nodesByTradition('berber').map((n) => n.id);
  assert.ok(berber.includes('gurzil'));
  assert.ok(berber.includes('anzar'));
  const gurzil = equationsFor('gurzil');
  assert.ok(gurzil.length >= 2);
  assert.match(gurzil[0].source, /Corippus/);
});

test('cluster() defaults to cultic and above, so conjecture cannot join an attested chain', () => {
  // Tanit reaches Athena ONLY through our own conjectured Tanit=Neith edge.
  const strict = cluster('tanit');
  assert.ok(!strict.includes('athena'), 'a structural link leaked into the default cluster');
  assert.ok(!strict.includes('neith'));

  const loose = cluster('tanit', { minTier: 'structural' });
  assert.ok(loose.includes('neith'));
  assert.ok(loose.includes('athena'));
});

test('Neith reaches Athena on attested evidence alone', () => {
  const c = cluster('neith', { minTier: 'attested' });
  assert.ok(c.includes('athena'), 'Plato Timaeus 21e should carry this');
  assert.ok(c.includes('minerva'));
});

test('triangulate() enforces the three-system rule and reports failure honestly', () => {
  const strong = triangulate('melqart', 'herakles');
  assert.equal(strong.connected, true);
  assert.equal(strong.met, true);
  assert.ok(strong.systems.length >= 3);

  // Tanit->Athena connects DIRECTLY, on Herodotus IV.180 — not through Neith. The ta-Nit
  // etymology was downgraded when no scholar could be found for it, and the connection survived
  // anyway on the leg that has an ancient author behind it.
  const chain = triangulate('tanit', 'athena');
  assert.equal(chain.connected, true);
  assert.deepEqual(chain.path, ['tanit', 'athena']);
  assert.equal(chain.weakest, 'structural');
  assert.ok(!chain.path.includes('neith'), 'the Neith route is conjecture-tier and must not be taken');

  // At cultic and above it breaks entirely: no ancient or archaeological path exists.
  const strict = triangulate('tanit', 'athena', { minTier: 'cultic' });
  assert.equal(strict.connected, false);
});

test('Tanit reaches Juno Caelestis on archaeology, which is the equation that actually holds', () => {
  const c = cluster('tanit');
  assert.ok(c.includes('juno-caelestis'), 'the Roman-Africa cult continuity is the strong one');
  const t = triangulate('tanit', 'juno-caelestis', { minTier: 'cultic' });
  assert.equal(t.connected, true);
  assert.equal(t.weakest, 'cultic');
});

test('triangulate() prefers the best-evidenced route, not the shortest one', () => {
  // Melqart reaches Herakles with four systems converging on attested-or-better edges throughout.
  const m = triangulate('melqart', 'herakles');
  assert.equal(m.weakest, 'attested');
  assert.ok(m.systems.length >= 4);
});

test('the Tanit-Neith downgrade is recorded in the edge itself, not silently applied', () => {
  const e = EQUATIONS.find((x) => x.a === 'tanit' && x.b === 'neith');
  assert.equal(e.tier, 'conjecture');
  assert.match(e.note, /DOWNGRADED BACK TO CONJECTURE/);
  assert.match(e.note, /TINN/i, 'the El-Hofra transliterations are the evidence');
  assert.match(e.source, /NO scholarly source/i);
  // the Tanit-Athena edge must NOT depend on it
  const ta = EQUATIONS.find((x) => x.a === 'tanit' && x.b === 'athena');
  assert.match(ta.source, /Herodotus IV.180/);
  assert.match(ta.note, /does NOT run through Neith/);
});

test('the Indo-European equation is attested by sound law with no ancient author', () => {
  const e = EQUATIONS.find((x) => x.a === 'dyaus' && x.b === 'zeus');
  assert.equal(e.tier, 'attested');
  assert.deepEqual(e.systems, ['linguistics']);
  const t = triangulate('dyaus', 'zeus');
  assert.equal(t.connected, true);
  assert.equal(t.met, false, 'one system only — the rule must refuse it, and it still holds by sound law');
});

test('the Leto-at-Buto obstacle is recorded rather than dropped', () => {
  const e = EQUATIONS.find((x) => x.a === 'wadjet' && x.b === 'leto');
  assert.equal(e.tier, 'attested');
  assert.match(e.note, /obstacle/i);
});

test('Herodotus I.131 Mithra is kept as an attested equation that is nonetheless wrong', () => {
  const e = EQUATIONS.find((x) => x.a === 'mithra' && x.b === 'aphrodite');
  assert.equal(e.tier, 'attested');
  assert.match(e.note, /garbled|wrong/i);
});

test('weakLinks() surfaces everything we are proposing ourselves', () => {
  const w = weakLinks();
  assert.ok(w.length > 5);
  assert.ok(w.every((e) => e.tier === 'conjecture' || e.tier === 'structural'));
  const ours = w.filter((e) => (e.source || '').includes('VKFRI'));
  assert.ok(ours.length >= 3, 'our own proposals must be findable');
  assert.equal(w[0].tier, 'conjecture', 'weakest first');
});

test('equationsFor() sorts strongest evidence first and is soft on unknown ids', () => {
  const m = equationsFor('melqart');
  assert.equal(m[0].tier, 'epigraphic');
  assert.ok(m[0].other);
  assert.deepEqual(equationsFor('no-such-god'), []);
  assert.deepEqual(equationsFor(undefined), []);
});

test('cluster() is soft on unknown ids', () => {
  assert.deepEqual(cluster('no-such-god'), []);
  assert.equal(getNode('no-such-god'), null);
});

test('registryGap() reports the hierophant-entities backlog', () => {
  const gap = registryGap();
  assert.ok(gap.includes('neith'), 'Neith is referenced here but not in the entity registry');
  assert.ok(gap.includes('melqart'));
  assert.ok(gap.includes('gurzil'));
  assert.ok(!gap.includes('zeus'), 'Zeus is already registered');
});

test('the map spans the traditions the corpus actually argues across', () => {
  for (const t of ['egyptian', 'phoenician', 'punic', 'berber', 'libyan', 'greek', 'roman', 'etruscan', 'norse', 'vedic']) {
    assert.ok(TRADITIONS.includes(t), `missing tradition ${t}`);
  }
  assert.ok(NODES.length >= 80);
  assert.ok(EQUATIONS.length >= 60);
  assert.deepEqual(TIERS[0], 'conjecture');
  assert.deepEqual(TIERS[TIERS.length - 1], 'epigraphic');
});

test('etymologies are graded, and "unknown" is used freely rather than guessed at', () => {
  const shaky = shakyEtymologies();
  assert.ok(shaky.length >= 25, 'a god-name list with almost no doubt in it would be a lie');
  const unknown = shaky.filter((e) => e.confidence === 'unknown');
  assert.ok(unknown.length >= 8, 'plenty of theonyms genuinely have no accepted derivation');
  for (const e of Object.values(ETYMOLOGY)) {
    assert.ok(['secure', 'disputed', 'unknown'].includes(e.confidence), `bad confidence ${e.confidence}`);
    assert.ok(e.form && e.gloss);
  }
});

test('the famous folk etymologies are marked as folk etymologies', () => {
  assert.match(ETYMOLOGY.kronos.gloss, /NOT from chronos/);
  assert.equal(ETYMOLOGY.kronos.confidence, 'unknown');
  assert.match(ETYMOLOGY.aphrodite.gloss, /FOLK ETYMOLOGY/);
  assert.match(ETYMOLOGY.varuna.gloss, /NOT cognate with Ouranos/);
});

test('Tyr carries the same PIE root as Zeus, which is the best etymology in the file', () => {
  const tyr = enrich('tyr');
  assert.match(tyr.etymology.form, /\*deywos/);
  assert.equal(tyr.etymology.confidence, 'secure');
  assert.equal(tyr.planet, 'Mars', 'by the weekday calque');
  assert.match(ETYMOLOGY.zeus.form, /\*dyēus/);
});

test('enrich() folds etymology and planet in, nulling what we do not have', () => {
  const h = enrich('hathor');
  assert.match(h.etymology.gloss, /mansion of Horus/);
  assert.equal(h.planet, 'Venus');
  const s = enrich('sinifere');
  assert.equal(s.etymology, null, 'never invent a gloss');
  assert.equal(s.planet, null);
  assert.equal(enrich('no-such-god'), null);
});

test('etymologyGap() is the countable research backlog', () => {
  const gap = etymologyGap();
  assert.ok(gap.length > 0 && gap.length < 25, `gap is ${gap.length}`);
  assert.ok(gap.includes('sinifere'));
  assert.ok(!gap.includes('hathor'));
  assert.equal(gap.length + Object.keys(ETYMOLOGY).filter((k) => NODES.some((n) => n.id === k)).length, NODES.length);
});

test('byPlanet() groups the interpretatio by sphere, and Venus is the crowded one', () => {
  const p = byPlanet();
  for (const sphere of ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']) {
    assert.ok(p[sphere] && p[sphere].length, `no figures for ${sphere}`);
  }
  assert.ok(p.Venus.includes('ishtar') && p.Venus.includes('astarte') && p.Venus.includes('allat'));
  assert.ok(p.Jupiter.includes('marduk') && p.Jupiter.includes('zeus'), 'the attested Babylonian-Greek pair');
  assert.ok(p.Mercury.includes('odin'), 'Tacitus Germania 9, and Wednesday');
});

test('the corrections registry names the claim, the source, and what survives', () => {
  assert.ok(CORRECTIONS.length >= 5);
  for (const c of CORRECTIONS) {
    assert.ok(c.id && c.claim && c.madeIn && c.verdict, `${c.id} malformed`);
    assert.ok(Array.isArray(c.because) && c.because.length >= 2, `${c.id} needs its evidence`);
    assert.ok(c.keep, `${c.id} must say what survives, even if the answer is nothing`);
    assert.ok(c.source && c.source.length > 15, `${c.id} needs a citation`);
  }
});

test('melekh and malakh are recorded as NOT the same root, with the aleph as the proof', () => {
  const c = getCorrection('melekh-malakh');
  assert.equal(c.verdict, 'WRONG');
  assert.ok(c.because.some((b) => /aleph/i.test(b)), 'the aleph is the decisive fact');
  assert.ok(c.because.some((b) => /maqtal/.test(b)), 'the m- is a prefix, not a radical');
  assert.match(c.source, /Huehnergard|BDB/);
  assert.match(c.keep, /semantic field/i, 'the resonance survives; the etymology does not');
});

test('the HRM protocol claim is corrected without throwing away the part that holds', () => {
  const c = getCorrection('hrm-fraternal');
  assert.match(c.verdict, /^WRONG/);
  assert.ok(c.because.some((b) => /harem|ḥarīm/i.test(b)), 'herem/haram/harem is the actual root');
  assert.ok(c.because.some((b) => /Ahiram|ʾaḥ/i.test(b)), 'Hiram is short for Ahiram');
  assert.match(c.keep, /exalted brother/i, 'the gloss survives, attached to the NAME');
});

test('the discredited boshet vocalisation is retired, and the live dispute recorded instead', () => {
  const c = getCorrection('molech-boshet');
  assert.match(c.verdict, /RETIRED/);
  assert.ok(c.because.some((b) => /Geiger/.test(b)));
  assert.ok(c.because.some((b) => /Eissfeldt/.test(b)), 'the real dispute is sacrifice-vs-deity');
  assert.match(c.keep, /pick no winner|both readings/i);
  // and the etymology entry must no longer carry the retired theory
  assert.ok(!/bōšet/.test(ETYMOLOGY.molech.gloss), 'the retired theory must be out of the gloss too');
});

test('open questions are marked OPEN rather than quietly kept or quietly dropped', () => {
  const c = getCorrection('mlk-pan-semitic');
  assert.match(c.verdict, /^OPEN/);
  assert.ok(c.because.some((b) => /šarru|Akkadian/.test(b)));
  assert.match(c.keep, /CAD/, 'names the specific lexicon that would settle it');
});

test('correctionsByVerdict() puts the ones needing paper edits first', () => {
  const ordered = correctionsByVerdict();
  const wrong = ordered.filter((c) => c.verdict.startsWith('WRONG'));
  assert.ok(wrong.length >= 4, 'these are the ones that require edits to published papers');
  // every WRONG must come before every non-WRONG
  const lastWrong = ordered.findLastIndex((c) => c.verdict.startsWith('WRONG'));
  assert.equal(lastWrong, wrong.length - 1, 'the WRONGs must be contiguous at the front');
  assert.ok(ordered.some((c) => c.verdict.startsWith('OPEN')), 'open questions are carried too');
});

test('Melqart survived review and the entry now carries the precise form', () => {
  assert.equal(ETYMOLOGY.melqart.confidence, 'secure');
  assert.match(ETYMOLOGY.melqart.form, /milk-qart/);
  assert.match(ETYMOLOGY.melqart.gloss, /Tyre/, 'name it as cult inference, not linguistics');
  assert.ok(!CORRECTIONS.some((c) => /Melqart/i.test(c.claim)), 'Melqart is not a correction — it held');
});
