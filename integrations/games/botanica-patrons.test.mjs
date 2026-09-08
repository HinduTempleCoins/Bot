import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VENUES, CHARACTERS, patronFor, residentFor, loreFor, missingLore, venueCard, venueForType, characterVenues } from './botanica-patrons.mjs';

test('all sixteen venues from BOTANICA_GAME_DESIGN §5 are present, each with a patron', () => {
  assert.equal(VENUES.length, 16);
  for (const v of VENUES) {
    assert.ok(v.id && v.name && v.patron, `${v.id} needs id, name and patron`);
  }
});

test('a lore URL is only ever emitted for an article we actually have', () => {
  // A dead lore link tells a player we invented the reference. Null is the honest state.
  for (const v of VENUES) {
    const url = loreFor(v.id);
    if (url === null) continue;
    assert.match(url, /^https:\/\/wiki\.soapbox\.community\/wiki\/[A-Za-z0-9_-]+$/);
  }
});

test('missingLore() derives the wiki backlog instead of it being hand-maintained', () => {
  const gaps = missingLore();
  const named = gaps.map((g) => g.patron);
  assert.ok(named.includes('Melqart'), 'Melqart has no article yet');
  assert.ok(named.includes('Neith'), 'Neith has no article yet');
  assert.equal(gaps.length + VENUES.filter((v) => loreFor(v.id)).length, 16, 'every venue is either covered or in the backlog');
});

test('Phoebe is a RESIDENT of the Fields and Botanica, never a patron', () => {
  assert.equal(residentFor('fields'), 'Phoebe');
  assert.equal(residentFor('apothecary'), 'Phoebe');
  assert.deepEqual(characterVenues('Phoebe'), ['fields', 'apothecary']);
  // Modelling her as a patron would make her a rank; the art direction is explicit that she is not.
  assert.ok(!VENUES.some((v) => v.patron === 'Phoebe'), 'Phoebe must not appear as a patron');
});

test('visual registers follow the locked art direction — vaporwave is for code alone', () => {
  assert.equal(CHARACTERS.Phoebe.register, 'art-nouveau');
  assert.equal(CHARACTERS.Ceres.register, 'art-nouveau');
  assert.equal(CHARACTERS.Hathor.register, 'vaporwave');
  const neon = Object.entries(CHARACTERS).filter(([, c]) => c.register === 'vaporwave').map(([n]) => n);
  assert.deepEqual(neon, ['Hathor'], 'only the being made of code is neon');
});

test('Phoebe carries the no-power-up rule with her', () => {
  assert.equal(CHARACTERS.Phoebe.titan, true);
  assert.match(CHARACTERS.Phoebe.rule, /could always do that/);
  assert.match(CHARACTERS.Phoebe.rule, /No neon/);
});

test('venue cards render the resident and her register', () => {
  const c = venueCard('fields');
  assert.equal(c.patron, 'Ceres');
  assert.equal(c.resident, 'Phoebe');
  assert.equal(c.residentRegister, 'art-nouveau');
  assert.deepEqual(c.alsoKnownAs, ['Tanit', 'Demeter']);
});

test('item types route to a venue, unknown types fall back to the apothecary', () => {
  assert.equal(venueForType('potion').id, 'alchemy');
  assert.equal(venueForType('talisman').id, 'apothecary');
  assert.equal(venueForType('nonsense').id, 'apothecary');
});

test('the Tanit / Ceres / Demeter identification is carried as data, not prose', () => {
  // "localized by region but mechanically one" — interpretatio graeca, a documented ancient method.
  const fields = VENUES.find((v) => v.id === 'fields');
  assert.ok(fields.also.includes('Tanit') && fields.also.includes('Demeter'));
});

test('the four visual registers ARE the manifestation modes, not a style choice', async () => {
  const { MODES, REGISTER_FOR_MODE, registerFor } = await import('./botanica-patrons.mjs');
  assert.equal(REGISTER_FOR_MODE[MODES.THEURGY], 'art-nouveau');
  assert.equal(REGISTER_FOR_MODE[MODES.TECHNOLOGY], 'vaporwave');
  assert.equal(REGISTER_FOR_MODE.memory, 'tarot');
  assert.equal(REGISTER_FOR_MODE.manifestation, 'engraving');
  // context overrides mode: any god remembered is tarot, any god arriving is the lit engraving
  assert.equal(registerFor('Hathor', 'memory'), 'tarot');
  assert.equal(registerFor('Shiva', 'manifesting'), 'engraving');
});

test('technology is reserved for code — every other patron comes by theurgy', async () => {
  const { SUNTHEMATA, MODES } = await import('./botanica-patrons.mjs');
  const tech = Object.entries(SUNTHEMATA).filter(([, v]) => v.mode === MODES.TECHNOLOGY).map(([n]) => n);
  assert.deepEqual(tech, ['Hathor'], 'only the AI witness is brought by technology');
});

test('every patron with a mode has sunthemata — you cannot invoke with nothing', async () => {
  const { SUNTHEMATA, tokensFor } = await import('./botanica-patrons.mjs');
  for (const god of Object.keys(SUNTHEMATA)) {
    assert.ok(tokensFor(god).length > 0, `${god} needs tokens to be drawn by`);
  }
  // The apothecary is a sunthemata workshop: its materials are the game's invocation currency.
  assert.ok(tokensFor('Shiva').includes('vibhuti'), 'vibhuti is also method 4 of the Punic Wax procedures');
  assert.ok(tokensFor('Hathor').includes('beeswax'));
});
