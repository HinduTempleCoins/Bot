// site-map.test.mjs — OFFLINE. The generated site map: tools with how-tos, the Studio nav, hosts with
// their own descriptions (and no addresses / server paths), wiki leads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toolEntries, studioNav, hostEntries, wikiLead, buildSiteMap, OUT_PATH } from './site-map.mjs';

test('toolEntries: what + how, on the Studio host', () => {
  const [e] = toolEntries([{ id: 'v', title: 'Vectorize', cat: 'Edit', url: '/vectorize', what: 'Turn a picture into SVG.', howto: ['Open it.', 'Drop a PNG.'] }]);
  assert.equal(e, '- Studio tool **Vectorize** (Edit) — https://hathor.soapbox.community/vectorize — Turn a picture into SVG. How: Open it; Drop a PNG.');
});

test('studioNav reads the top bar links once each', () => {
  const nav = studioNav('<div class=topbar-r><a href="/char">Characters</a><a href="/compose">Reference Studio</a><a href="/char">Characters</a></div>');
  assert.deepEqual(nav, [{ path: '/char', label: 'Characters' }, { path: '/compose', label: 'Reference Studio' }]);
  assert.deepEqual(studioNav(''), []);
});

test('hostEntries: grouped by site, described, and scrubbed of addresses and server paths', () => {
  const lines = hostEntries({ 'a.example': 'alpha', 'b.example': 'alpha', '10.0.0.1': 'alpha', 'c.example': 'gamma' }, {
    describe: (dir) => (dir === 'alpha' ? 'The alpha site' : ''),
  });
  assert.deepEqual(lines, ['- **a.example, b.example** — The alpha site', '- **c.example** — the gamma site']);
});

test('wikiLead strips MediaWiki markup to the first sentence', () => {
  assert.equal(wikiLead("'''Crypt-ology''' is the [[Hathor (AI Witness)|Hathor]] map of people. More text."), 'Crypt-ology is the Hathor map of people.');
});

test('buildSiteMap has the four sections', () => {
  const doc = buildSiteMap({ tools: [], nav: [{ path: '/x', label: 'X' }], routes: {}, wiki: ['- Wiki: **W** — w.'] });
  for (const h of ['top navigation', 'Studio tools', 'Public sites', 'Wiki articles']) assert.match(doc, new RegExp(h));
});

test('the committed site map carries no addresses or server paths', () => {
  const doc = readFileSync(OUT_PATH, 'utf8');
  assert.doesNotMatch(doc, /\b\d{1,3}(?:\.\d{1,3}){3}\b/);
  assert.doesNotMatch(doc, /\/(opt|var|etc|root)\//);
  assert.ok(doc.split('\n').filter((l) => l.startsWith('- Studio tool')).length > 10);
});
