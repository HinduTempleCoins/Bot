// heritage-outreach.test.mjs — OFFLINE. No network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  LINEAGES, PROJECT_TIES, getLineage, verifyClaim, draft, plan, handler,
} from './heritage-outreach.mjs';

test('the five documented lines are all present', () => {
  assert.equal(LINEAGES.length, 5);
  for (const id of ['gallagher', 'christenson', 'lopez', 'henry-alexander', 'phoenician']) {
    assert.ok(getLineage(id), id);
  }
  assert.equal(getLineage('nope'), null);
});

test('every lineage states what is actually claimable, separately from what is documented', () => {
  for (const l of LINEAGES) {
    assert.ok(l.documented.length >= 2, l.id);
    assert.ok(l.claimable && l.claimable.length > 20, l.id);
    assert.ok(l.communities.length >= 3, l.id);
  }
});

test('the Phoenician line claims the NAMING, never ancestry', () => {
  const p = getLineage('phoenician');
  assert.match(p.claimable, /NOT ancestry/);
  assert.match(p.claimable, /Melqart/);
  assert.ok(p.caution, 'the political weight of Phoenician descent claims is flagged');
});

// ── the three refusals ────────────────────────────────────────────────────────────────────────────
test('REFUSES identity-by-percentage — a DNA number is not a membership card', () => {
  const r = verifyClaim("I'm 25% Irish so I'm one of you");
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].code, 'identity_by_percentage');
});

test('REFUSES claiming an ancient people as ours', () => {
  assert.equal(verifyClaim('our Phoenician ancestry').ok, false);
  assert.equal(verifyClaim('we are Carthaginian').ok, false);
  assert.equal(verifyClaim('Punic blood').ok, false);
});

test('REFUSES population-replacement and racial-classification arguments outright', () => {
  for (const s of ['population replacement', 'who built the pyramids', 'racial classification', 'bloodline']) {
    const r = verifyClaim(s);
    assert.equal(r.ok, false, s);
    assert.equal(r.problems[0].code, 'population_replacement');
  }
});

test('REFUSES implying a heritage organization endorsed us', () => {
  assert.equal(verifyClaim('officially partnered with the clan society').ok, false);
});

test('allows the narrow, checkable statements — a named ancestor, a named place, what we built', () => {
  assert.equal(verifyClaim('MELEK is Phoenician root mlk, "king". We wrote an article on Melqart.').ok, true);
  assert.equal(verifyClaim('My great-grandmother was born in Scroggins, Hopkins County, Texas.').ok, true);
  assert.equal(verifyClaim('The surname is from County Donegal.').ok, true);
});

// ── drafting ──────────────────────────────────────────────────────────────────────────────────────
test('a draft leads with what we BUILT and passes its own claim check', () => {
  const d = draft({ lineage: 'phoenician', community: 'the Cornish heritage community' });
  assert.equal(d.ok, true);
  assert.match(d.body, /MELEK/);
  assert.match(d.body, /Melqart/);
  assert.match(d.body, /You can read all of it/);
  assert.equal(d.sends, false);
});

test('a draft asks for corrections rather than agreement', () => {
  const d = draft({ lineage: 'gallagher', community: 'the Donegal Association' });
  assert.match(d.body, /whether anything in it is wrong/);
  assert.match(d.body, /not writing to claim anything/);
});

test('no draft contains a percentage, an ancestry claim, or a replacement argument', () => {
  for (const l of LINEAGES) {
    const d = draft({ lineage: l.id, community: 'a society' });
    assert.equal(d.ok, true, l.id);
    assert.doesNotMatch(d.body, /\d+\s*%/, l.id);
    assert.doesNotMatch(d.body, /bloodline|pure blood|population replacement/i, l.id);
  }
});

test('an unknown lineage is refused, not silently drafted', () => {
  const d = draft({ lineage: 'atlantis' });
  assert.equal(d.ok, false);
  assert.equal(d.code, 'unknown-lineage');
});

test('plan() names the strongest angle per purpose and admits nothing is verified yet', () => {
  const p = plan();
  assert.ok(p.totalCommunities > 15);
  assert.match(p.strongest.product, /translation/);
  assert.match(p.strongest.press, /Rosie/);
  assert.match(p.blocked.join(' '), /categories, not a list/);
});

test('handler exposes the refusals as prominently as the material', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.ok(j.refuses.population_replacement);
  assert.ok(j.refuses.identity_by_percentage);
  assert.equal(j.projectTies.melek_root, PROJECT_TIES.melek_root);
});
