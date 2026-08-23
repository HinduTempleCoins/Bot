// music-catalog.test.mjs — offline tests for the PD/CC-open music catalog reader.
// All network is stubbed via __setFetch; no live calls, no keys. Run:
//   node --test integrations/soapbox/music-catalog.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  search, searchIA, searchCcMixter, freePd, jamendo,
  isAllowedLicense, normalizeTrack, attributionLine,
  renderList, dataNote, __setFetch,
} from './music-catalog.mjs';

function jsonFetch(payload, { ok = true } = {}) {
  return async () => ({ ok, json: async () => payload });
}
function throwingFetch() {
  return async () => { throw new Error('network down'); };
}
// URL-routed mock so search() can exercise IA + ccMixter with distinct payloads in one call.
function routedFetch(iaPayload, ccPayload) {
  return async (url) => {
    const u = String(url);
    if (u.includes('archive.org')) return { ok: true, json: async () => iaPayload };
    if (u.includes('ccmixter.org')) return { ok: true, json: async () => ccPayload };
    return { ok: false, json: async () => ({}) };
  };
}

// ── the load-bearing license filter ──────────────────────────────────────────────────────────────────
test('isAllowedLicense: CC0 / CC-BY / CC-BY-SA / PD pass; NC / reserved / empty fail', () => {
  // allowed
  assert.equal(isAllowedLicense('CC0'), true);
  assert.equal(isAllowedLicense('CC-BY'), true);
  assert.equal(isAllowedLicense('CC BY-SA'), true);
  assert.equal(isAllowedLicense('Public Domain'), true);
  assert.equal(isAllowedLicense('pd'), true);
  assert.equal(isAllowedLicense('https://creativecommons.org/licenses/by-sa/4.0/'), true);
  assert.equal(isAllowedLicense('https://creativecommons.org/publicdomain/zero/1.0/'), true);
  assert.equal(isAllowedLicense('Attribution'), true);          // ccMixter spelled-out form
  // filtered OUT — the non-negotiable NC exclusion
  assert.equal(isAllowedLicense('CC-NC'), false);
  assert.equal(isAllowedLicense('NC'), false);
  assert.equal(isAllowedLicense('CC BY-NC'), false);
  assert.equal(isAllowedLicense('CC BY-NC-SA'), false);
  assert.equal(isAllowedLicense('Attribution NonCommercial'), false);
  assert.equal(isAllowedLicense('https://creativecommons.org/licenses/by-nc/4.0/'), false);
  assert.equal(isAllowedLicense('all-rights-reserved'), false);
  assert.equal(isAllowedLicense('All Rights Reserved'), false);
  assert.equal(isAllowedLicense('CC BY-ND'), false);            // ND not in the allowed set
  assert.equal(isAllowedLicense(''), false);
  assert.equal(isAllowedLicense(null), false);
});

// ── normalizeTrack: NC dropped (null), CC-BY kept with attribution, CC0 no attribution ───────────────
test('normalizeTrack drops NC (returns null)', () => {
  assert.equal(normalizeTrack({ id: 1, title: 'x', license: 'CC BY-NC' }, 'ccMixter'), null);
  assert.equal(normalizeTrack({ id: 2, title: 'y', license: 'All Rights Reserved' }, 'x'), null);
  assert.equal(normalizeTrack({ id: 3, title: 'z', license: '' }, 'x'), null);
});

test('normalizeTrack keeps CC-BY, fills attribution, stamps posture=host + streamUrl', () => {
  const t = normalizeTrack(
    { id: 7, title: 'Sunrise', artist: 'Alice', license: 'CC-BY', streamUrl: 'https://e.x/7.mp3' },
    'ccMixter',
  );
  assert.ok(t);
  assert.equal(t.id, '7');
  assert.equal(t.title, 'Sunrise');
  assert.equal(t.source, 'ccMixter');
  assert.equal(t.license, 'CC BY');
  assert.equal(t.streamUrl, 'https://e.x/7.mp3');
  assert.equal(t.posture, 'host');
  assert.match(t.attribution, /Sunrise/);
  assert.match(t.attribution, /Alice/);
  assert.match(t.attribution, /CC BY/);
});

test('normalizeTrack keeps CC0 with an EMPTY attribution line', () => {
  const t = normalizeTrack({ id: 9, title: 'Piano', artist: 'FreePD', license: 'CC0' }, 'FreePD');
  assert.ok(t);
  assert.equal(t.license, 'CC0');
  assert.equal(t.attribution, '');
  assert.equal(t.posture, 'host');
});

// ── attributionLine: required for BY-family, empty for CC0/PD ─────────────────────────────────────────
test('attributionLine correct for CC-BY / CC-BY-SA vs empty for CC0 / PD', () => {
  assert.match(attributionLine({ title: 'T', artist: 'A', license: 'CC BY', source: 'ccMixter' }), /“T” by A — CC BY/);
  assert.match(attributionLine({ title: 'T', artist: 'A', license: 'CC BY-SA' }), /CC BY-SA/);
  assert.equal(attributionLine({ title: 'T', artist: 'A', license: 'CC0' }), '');
  assert.equal(attributionLine({ title: 'T', artist: 'A', license: 'Public Domain' }), '');
  assert.equal(attributionLine({ license: '' }), '');
});

// ── Internet Archive (keyless) ───────────────────────────────────────────────────────────────────────
const iaPayload = {
  response: {
    docs: [
      { identifier: 'ia-by', title: 'Open Song', creator: 'Alice', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' },
      { identifier: 'ia-nc', title: 'NC Song', creator: 'Bob', licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/' }, // NC → dropped
      { identifier: 'ia-78', title: 'Old 78', creator: 'Vintage', collection: ['78rpm', 'opensource_audio'] },                 // no licenseurl → PD by age
    ],
  },
};

test('searchIA parses docs, drops NC, PD-tags 78rpm, sets IA embed streamUrl + posture host', async () => {
  __setFetch(jsonFetch(iaPayload));
  const r = await searchIA({ query: 'song' });
  __setFetch(null);
  assert.equal(r.length, 2);                                  // ia-nc dropped
  const byTrack = r.find((t) => t.id === 'ia-by');
  assert.equal(byTrack.license, 'CC BY');
  assert.equal(byTrack.streamUrl, 'https://archive.org/embed/ia-by');
  assert.equal(byTrack.posture, 'host');
  assert.match(byTrack.attribution, /Open Song/);
  const pd78 = r.find((t) => t.id === 'ia-78');
  assert.equal(pd78.license, 'Public Domain');
  assert.equal(pd78.attribution, '');                        // PD → no attribution owed
  assert.ok(!r.some((t) => t.id === 'ia-nc'));
});

test('searchIA soft-fails to [] on network error and on a malformed payload', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await searchIA({ query: 'x' }), []);
  __setFetch(jsonFetch({ nope: true }));
  assert.deepEqual(await searchIA({ query: 'x' }), []);
  __setFetch(null);
});

// ── ccMixter (keyless) ───────────────────────────────────────────────────────────────────────────────
const ccPayload = [
  { upload_id: 11, upload_name: 'Sunrise', user_name: 'alice', license_name: 'Attribution', file_page_url: 'https://ccmixter.org/f/11', files: [{ download_url: 'https://dig.ccmixter.org/dl/11.mp3' }] },
  { upload_id: 12, upload_name: 'NC Track', user_name: 'bob', license_name: 'Attribution Noncommercial (3.0)', files: [] }, // NC → dropped
];

test('searchCcMixter parses results, drops NC, stamps license + streamUrl', async () => {
  __setFetch(jsonFetch(ccPayload));
  const r = await searchCcMixter({ tag: 'sun' });
  __setFetch(null);
  assert.equal(r.length, 1);                                  // NC dropped
  assert.equal(r[0].title, 'Sunrise');
  assert.equal(r[0].license, 'CC BY');
  assert.equal(r[0].source, 'ccMixter');
  assert.equal(r[0].streamUrl, 'https://dig.ccmixter.org/dl/11.mp3');
  assert.match(r[0].attribution, /Sunrise/);
});

test('searchCcMixter soft-fails to [] on network error and on non-array payload', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await searchCcMixter({ tag: 'x' }), []);
  __setFetch(jsonFetch({ not: 'an array' }));
  assert.deepEqual(await searchCcMixter({ tag: 'x' }), []);
  __setFetch(null);
});

// ── FreePD (static / keyless) ────────────────────────────────────────────────────────────────────────
test('freePd returns CC0 seed tracks, name-filterable, all allowed + host posture', async () => {
  const all = await freePd();
  assert.ok(all.length >= 5);
  assert.ok(all.every((t) => t.source === 'FreePD' && t.license === 'CC0' && t.posture === 'host'));
  assert.ok(all.every((t) => t.attribution === '' && isAllowedLicense(t.license)));
  const piano = await freePd({ query: 'piano' });
  assert.equal(piano.length, 1);
  assert.equal(piano[0].title, 'Piano');
});

// ── Jamendo (key-gated; soft-skip) ───────────────────────────────────────────────────────────────────
test('jamendo soft-skips to [] when no key is injected (never touches fetch)', async () => {
  __setFetch(throwingFetch());   // proves it never calls fetch when unkeyed
  const r = await jamendo({ query: 'anything' });
  __setFetch(null);
  assert.deepEqual(r, []);
});

// ── merged search excludes NC and merges the keyless sources ─────────────────────────────────────────
test('search merges IA + ccMixter + FreePD, license-filtered + deduped', async () => {
  __setFetch(routedFetch(iaPayload, ccPayload));
  const r = await search({ query: 'piano' });   // 'piano' also matches a FreePD seed
  __setFetch(null);
  assert.ok(r.some((t) => t.source === 'Internet Archive'));
  assert.ok(r.some((t) => t.source === 'ccMixter'));
  assert.ok(r.some((t) => t.source === 'FreePD'));
  assert.ok(r.every((t) => t.posture === 'host'));
  assert.ok(r.every((t) => isAllowedLicense(t.license)));
});

test('NC tracks in the mock responses are EXCLUDED from search results', async () => {
  __setFetch(routedFetch(iaPayload, ccPayload));
  const r = await search({ query: 'song' });
  __setFetch(null);
  assert.ok(!r.some((t) => t.title === 'NC Song'));   // IA NC excluded
  assert.ok(!r.some((t) => t.title === 'NC Track'));  // ccMixter NC excluded
  assert.ok(!r.some((t) => /nc/i.test(canonOf(t.license))));
});
function canonOf(lic) { return String(lic || '').toLowerCase().replace(/\s+/g, '-'); }

test('search soft-fails to [] when every source errors', async () => {
  __setFetch(throwingFetch());
  const r = await search({ query: 'x' });   // IA + ccMixter throw → []; FreePD still returns CC0 seeds
  __setFetch(null);
  assert.ok(Array.isArray(r));
  assert.ok(r.every((t) => t.source === 'FreePD'));   // only the offline source survives
});

// ── rendering ────────────────────────────────────────────────────────────────────────────────────────
test('renderList escapes a malicious title, shows attribution + data note', () => {
  const html = renderList([
    { title: '<script>alert(1)</script>', artist: 'x', license: 'CC BY', source: 'ccMixter', streamUrl: 'https://e.x/1', attribution: '“t” by x — CC BY', posture: 'host' },
  ]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('CC BY'));
  assert.ok(html.includes('attribution'));
  assert.ok(html.includes('Free &amp; open music'));
});

test('renderList handles empty / null and dataNote names the NC-excluded rule', () => {
  assert.ok(renderList([]).includes('No open-licensed tracks'));
  assert.ok(renderList(null).includes('</section>'));
  assert.match(dataNote(), /NonCommercial \(NC\) excluded/);
  assert.match(dataNote(), /Internet Archive/);
});
