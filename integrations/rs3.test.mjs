// rs3.test.mjs — offline tests for the RS3 player-tool feeds. All network is stubbed via __setFetch
// with canned payloads matching the real API shapes; no live calls, no keys. Clock math is pure.
// Run: node --test integrations/rs3.test.mjs
//
// INFO-TOOLS ONLY — these guard the read/format lane (Alt1-style). No game automation is tested or
// implemented (Jagex rules); game-playing agents target our own games elsewhere in the repo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  price, priceById, priceAlert, parseWeirdGloop, parseRsGeDetail,
  hiscores, parseHiscores, formatStats, SKILL_ORDER,
  merchantToday, calibrateMerchant, utcDayNumber, MERCHANT_FIXED, MERCHANT_POOL_AB, MERCHANT_POOL_C,
  flashEventAt, flashSchedule, voiceOfSerenNote, FLASH_EVENTS, SEREN_CLANS, utcHourNumber,
  discordFormat, fmtGp, __setFetch,
} from './rs3.mjs';

// ── fixtures (real API shapes) ───────────────────────────────────────────────────────────────────
// Weird Gloop: object keyed by resolved item name.
const WG_DRAGON_BONES = { 'Dragon bones': { id: '536', timestamp: '2026-06-03T12:57:40.000Z', price: 1082, volume: 996319 } };
// Official RS GE detail: thousands-separated string prices, today/day30 deltas.
const RS_GE_DRAGON_BONES = {
  item: {
    icon: 'https://secure.runescape.com/...gif?id=536', id: 536, type: 'Prayer materials',
    name: 'Dragon bones', description: 'These would feed a dog for months.',
    current: { trend: 'neutral', price: '1,082' },
    today: { trend: 'positive', price: '+2' },
    members: 'false',
    day30: { trend: 'negative', change: '-11.0%' },
    day90: { trend: 'negative', change: '-18.0%' },
    day180: { trend: 'negative', change: '-24.0%' },
  },
};
// Hiscores lite CSV: "rank,level,xp" per skill line, then activities. Real first lines (Overall + combat).
const HISCORES_CSV = [
  '6374,3211,5709998811',   // Overall
  '351,120,200000000',      // Attack
  '696,99,200000000',       // Defence
  '420,120,260000000',      // Strength
  '500,140,500000000',      // Constitution
  '600,110,150000000',      // Ranged
  '700,99,13034431',        // Prayer
  '800,120,200000000',      // Magic
  '-1,-1,-1',               // Cooking (unranked sentinel)
  '900,99,13034431',        // Woodcutting
].join('\n') + '\n100,5000\n200,300'; // a couple of activity lines appended

function jsonFetch(obj, { ok = true } = {}) { return async () => ({ ok, json: async () => obj }); }
function textFetch(str, { ok = true } = {}) { return async () => ({ ok, text: async () => str }); }
function throwingFetch() { return async () => { throw new Error('network down'); }; }
function notOkFetch() { return async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }); }

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (1) GE PRICES  — ≥6
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('GE: parseWeirdGloop normalizes the name-keyed payload', () => {
  const p = parseWeirdGloop(WG_DRAGON_BONES, 'Dragon bones');
  assert.equal(p.name, 'Dragon bones');
  assert.equal(p.id, '536');
  assert.equal(p.price, 1082);
  assert.equal(p.volume, 996319);
  assert.equal(p.source, 'weirdgloop');
});

test('GE: parseWeirdGloop falls back to the first key when name unknown', () => {
  const p = parseWeirdGloop(WG_DRAGON_BONES);
  assert.equal(p.name, 'Dragon bones');
  assert.equal(p.price, 1082);
});

test('GE: price() fetches by name (preferred Weird Gloop source)', async () => {
  __setFetch(jsonFetch(WG_DRAGON_BONES));
  const p = await price('Dragon bones');
  __setFetch(null);
  assert.equal(p.price, 1082);
  assert.equal(p.source, 'weirdgloop');
});

test('GE: parseRsGeDetail handles "1,082" string prices and +2 / -11.0% deltas', () => {
  const p = parseRsGeDetail(RS_GE_DRAGON_BONES);
  assert.equal(p.price, 1082);          // comma stripped
  assert.equal(p.todayChange, 2);       // "+2" → 2
  assert.equal(p.day30, '-11.0%');
  assert.equal(p.members, false);
  assert.equal(p.source, 'rs-ge');
});

test('GE: priceById() uses the official RS detail endpoint', async () => {
  __setFetch(jsonFetch(RS_GE_DRAGON_BONES));
  const p = await priceById(536);
  __setFetch(null);
  assert.equal(p.name, 'Dragon bones');
  assert.equal(p.price, 1082);
});

test('GE: price() soft-fails to null on network error and on not-ok', async () => {
  __setFetch(throwingFetch());
  assert.equal(await price('Dragon bones'), null);
  __setFetch(notOkFetch());
  assert.equal(await price('Dragon bones'), null);
  __setFetch(null);
  // bad input
  assert.equal(await price(''), null);
  assert.equal(await price(null), null);
  assert.equal(parseWeirdGloop(null), null);
  assert.equal(parseRsGeDetail({}), null);
});

test('GE: priceAlert is a pure compare — below / above / none, accepts object or number', () => {
  assert.equal(priceAlert(1082, { below: 1100 }).triggered, true);
  assert.equal(priceAlert(1082, { below: 1100 }).direction, 'below');
  assert.equal(priceAlert(1082, { above: 2000 }).triggered, false);
  assert.equal(priceAlert(2500, { above: 2000 }).triggered, true);
  // object form carries the name through
  const a = priceAlert({ price: 1082, name: 'Dragon bones' }, { below: 1100 });
  assert.equal(a.name, 'Dragon bones');
  assert.equal(a.triggered, true);
  // no threshold → not triggered, no throw
  assert.equal(priceAlert(1082, {}).triggered, false);
  assert.equal(priceAlert(null, { below: 5 }).triggered, false);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (2) HISCORES  — ≥6
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('hiscores: parseHiscores names skills in the fixed order', () => {
  const h = parseHiscores(HISCORES_CSV, 'Zezima');
  assert.equal(h.player, 'Zezima');
  assert.equal(h.skills.Overall.level, 3211);
  assert.equal(h.skills.Overall.xp, 5709998811);
  assert.equal(h.skills.Attack.level, 120);
  assert.equal(h.skills.Magic.level, 120);
});

test('hiscores: unranked sentinel (-1) becomes null, not -1', () => {
  const h = parseHiscores(HISCORES_CSV);
  assert.equal(h.skills.Cooking.level, null);
  assert.equal(h.skills.Cooking.rank, null);
  assert.equal(h.skills.Cooking.xp, null);
});

test('hiscores: SKILL_ORDER starts with Overall and includes Necromancy (RS3 newest)', () => {
  assert.equal(SKILL_ORDER[0], 'Overall');
  assert.ok(SKILL_ORDER.includes('Necromancy'));
  assert.ok(SKILL_ORDER.includes('Archaeology'));
  assert.ok(SKILL_ORDER.includes('Invention'));
});

test('hiscores: fetch + parse via stubbed text fetch', async () => {
  __setFetch(textFetch(HISCORES_CSV));
  const h = await hiscores('Zezima');
  __setFetch(null);
  assert.equal(h.skills.Strength.level, 120);
});

test('hiscores: soft-fails to null (404 / error / empty / bad input)', async () => {
  __setFetch(notOkFetch());
  assert.equal(await hiscores('Nobody'), null);
  __setFetch(throwingFetch());
  assert.equal(await hiscores('Nobody'), null);
  __setFetch(null);
  assert.equal(await hiscores(''), null);
  assert.equal(parseHiscores(''), null);
  assert.equal(parseHiscores('   \n  '), null);
  assert.equal(parseHiscores(null), null);
});

test('hiscores: formatStats produces a Discord block with the no-automation footer', () => {
  const block = formatStats(parseHiscores(HISCORES_CSV, 'Zezima'));
  assert.match(block, /RS3 stats — Zezima/);
  assert.match(block, /Total level: 3211/);
  assert.match(block, /Attack 120/);
  assert.match(block, /no game automation/i);
  assert.equal(formatStats(null), '');     // soft
  assert.equal(formatStats({}), '');
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (3) TRAVELLING MERCHANT  — ≥6
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('merchant: always four slots, slot 1 is the fixed map', () => {
  const m = merchantToday(new Date('2026-06-03T12:00:00Z'));
  assert.equal(m.slots.length, 4);
  assert.equal(m.slots[0], MERCHANT_FIXED);
  assert.equal(m.deterministic, true);
});

test('merchant: rotation is a PURE function of the UTC day (same day → same stock)', () => {
  const a = merchantToday(new Date('2026-06-03T00:30:00Z'));
  const b = merchantToday(new Date('2026-06-03T23:30:00Z'));
  assert.deepEqual(a.slots, b.slots);
  assert.equal(a.dayNumber, b.dayNumber);
});

test('merchant: rotating slots advance with the day number (modulo pool size)', () => {
  const d0 = merchantToday(new Date('2026-06-03T12:00:00Z'));
  const d1 = merchantToday(new Date('2026-06-04T12:00:00Z'));
  // slot C should step to the next pool item (offset c=0, interval 1)
  const i0 = MERCHANT_POOL_C.indexOf(d0.slots[3]);
  const i1 = MERCHANT_POOL_C.indexOf(d1.slots[3]);
  assert.equal(i1, (i0 + 1) % MERCHANT_POOL_C.length);
});

test('merchant: slots 2 and 3 are drawn from the AB pool and never collide', () => {
  for (let k = 0; k < 25; k++) {
    const m = merchantToday(new Date(Date.UTC(2026, 5, 3 + k)));
    assert.ok(MERCHANT_POOL_AB.includes(m.slots[1]));
    assert.ok(MERCHANT_POOL_AB.includes(m.slots[2]));
    assert.notEqual(m.slots[1], m.slots[2], `day +${k}: slots 2 & 3 collided`);
  }
});

test('merchant: calibrateMerchant recovers offsets that reproduce an observed day', () => {
  const date = new Date('2026-06-03T12:00:00Z');
  const observed = { a: 'Anima crystal', b: 'Livid plant', c: 'Harmonic dust' };
  const offsets = calibrateMerchant(date, observed);
  assert.ok(offsets);
  const m = merchantToday(date, { offsets });
  assert.equal(m.slots[1], 'Anima crystal');
  assert.equal(m.slots[2], 'Livid plant');
  assert.equal(m.slots[3], 'Harmonic dust');
});

test('merchant: calibrate returns null for an unknown item; merchant handles bad date', () => {
  assert.equal(calibrateMerchant(new Date(), { a: 'Not an item', b: 'x', c: 'y' }), null);
  const m = merchantToday('not-a-date');
  assert.deepEqual(m.slots, []);
  assert.equal(utcDayNumber('not-a-date'), null);
});

test('merchant: discordFormat.merchant renders all four slots + provenance + footer', () => {
  const s = discordFormat.merchant(merchantToday(new Date('2026-06-03T12:00:00Z')));
  assert.match(s, /Travelling Merchant/);
  assert.match(s, /1\. Uncharted island map/);
  assert.match(s, /4\./);
  assert.match(s, /00:00 UTC/);
  assert.match(s, /no game automation/i);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (4) FLASH EVENTS + VOICE OF SEREN  — ≥6
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('flash: 14-event rotation, special events flagged', () => {
  assert.equal(FLASH_EVENTS.length, 14);
  assert.equal(FLASH_EVENTS[0].name, 'Spider Swarm');
  assert.equal(FLASH_EVENTS.find((e) => e.name === 'Stryke the Wyrm').special, true);
  assert.equal(FLASH_EVENTS.filter((e) => e.special).length, 4);
});

test('flash: flashEventAt is deterministic clock math — advances one event per hour, wraps at 14', () => {
  const anchor = { anchorHour: 100000, anchorIndex: 0 };
  const at = (h) => new Date(h * 3600000);
  assert.equal(flashEventAt(at(100000), anchor).index, 0);
  assert.equal(flashEventAt(at(100001), anchor).index, 1);
  assert.equal(flashEventAt(at(100013), anchor).index, 13);
  assert.equal(flashEventAt(at(100014), anchor).index, 0); // wrap
});

test('flash: anchorIndex offsets the sequence', () => {
  const anchor = { anchorHour: 100000, anchorIndex: 5 };
  assert.equal(flashEventAt(new Date(100000 * 3600000), anchor).index, 5);
  assert.equal(flashEventAt(new Date(100001 * 3600000), anchor).event, FLASH_EVENTS[6].name);
});

test('flash: default anchor flags calibrationNeeded; custom anchor does not', () => {
  assert.equal(flashEventAt(new Date()).calibrationNeeded, true);
  assert.equal(flashEventAt(new Date(), { anchorHour: 1, anchorIndex: 0 }).calibrationNeeded, false);
});

test('flash: flashSchedule returns N consecutive hourly events; bad date → []', () => {
  const sched = flashSchedule(new Date('2026-06-03T12:00:00Z'), 6, { anchorHour: 0, anchorIndex: 0 });
  assert.equal(sched.length, 6);
  // consecutive indices (mod 14)
  for (let i = 1; i < sched.length; i++) {
    assert.equal(sched[i].index, (sched[i - 1].index + 1) % 14);
  }
  assert.deepEqual(flashSchedule('not-a-date'), []);
  assert.equal(utcHourNumber('not-a-date'), null);
});

test('seren: eight clans, two active per hour, marked NON-deterministic (live source needed)', () => {
  const v = voiceOfSerenNote();
  assert.equal(v.clans.length, 8);
  assert.deepEqual(v.clans, SEREN_CLANS);
  assert.equal(v.activePerHour, 2);
  assert.equal(v.cooldownHours, 2);
  assert.equal(v.deterministic, false);
  assert.match(v.note, /pseudo-random/i);
});

test('seren: passing a live active pair renders it (and filters junk clans)', () => {
  const v = voiceOfSerenNote({ active: ['Ithell', 'Trahaearn', 'NotAClan'] });
  assert.deepEqual(v.active, ['Ithell', 'Trahaearn']);
  assert.match(v.note, /Ithell & Trahaearn/);
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// (5) DISCORD FORMAT HELPERS  — ≥6
// ══════════════════════════════════════════════════════════════════════════════════════════════════
test('discordFormat.price renders gp + volume + source + footer', () => {
  const s = discordFormat.price(parseWeirdGloop(WG_DRAGON_BONES, 'Dragon bones'));
  assert.match(s, /\*\*Dragon bones\*\*/);
  assert.match(s, /gp/);
  assert.match(s, /Weird Gloop/);
  assert.match(s, /no game automation/i);
  assert.equal(discordFormat.price(null), 'No price found.');
});

test('discordFormat.price labels the RS GE source and today/30d deltas', () => {
  const s = discordFormat.price(parseRsGeDetail(RS_GE_DRAGON_BONES));
  assert.match(s, /RuneScape GE/);
  assert.match(s, /30d -11\.0%/);
});

test('discordFormat.alert renders triggered and not-triggered forms', () => {
  const hit = discordFormat.alert(priceAlert({ price: 1082, name: 'Dragon bones' }, { below: 1100 }));
  assert.match(hit, /🔔/);
  assert.match(hit, /below/);
  const miss = discordFormat.alert(priceAlert({ price: 1082, name: 'Dragon bones' }, { above: 5000 }));
  assert.match(miss, /No alert/);
  assert.match(hit, /no game automation/i);
});

test('discordFormat.stats wraps formatStats and handles missing players', () => {
  const s = discordFormat.stats(parseHiscores(HISCORES_CSV, 'Zezima'));
  assert.match(s, /RS3 stats — Zezima/);
  assert.equal(discordFormat.stats(null), 'Player not found on the hiscores.');
});

test('discordFormat.flash renders now/+Nh schedule with special star + footer', () => {
  const sched = flashSchedule(new Date('2026-06-03T12:00:00Z'), 4, { anchorHour: 0, anchorIndex: 2 });
  const s = discordFormat.flash(sched);
  assert.match(s, /Wilderness Flash Events/);
  assert.match(s, /now /);
  assert.match(s, /\+1h/);
  assert.match(s, /⭐/);           // anchorIndex 2 = Stryke the Wyrm (special) at "now"
  assert.match(s, /no game automation/i);
  assert.equal(discordFormat.flash([]), 'Flash-event schedule unavailable.');
});

test('discordFormat.seren renders the live pair or the live-source caveat', () => {
  const live = discordFormat.seren(voiceOfSerenNote({ active: ['Ithell', 'Trahaearn'] }));
  assert.match(live, /Ithell & Trahaearn/);
  const stub = discordFormat.seren(voiceOfSerenNote());
  assert.match(stub, /live source/i);
  assert.match(stub, /no game automation/i);
});

test('fmtGp: compact gp formatting (b / m / k / units)', () => {
  assert.equal(fmtGp(5709998811), '5.71b');
  assert.equal(fmtGp(996319), '996.3k');
  assert.equal(fmtGp(1082), '1.1k');
  assert.equal(fmtGp(7), '7');
  assert.equal(fmtGp(null), '—');
});
