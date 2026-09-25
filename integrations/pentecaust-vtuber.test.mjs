// integrations/pentecaust-vtuber.test.mjs — offline, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHOW_EFFECTS, EMOJI_EFFECTS, FX_EFFECTS, listEffects, effectStyles, showPageHtml, hubFragmentHtml,
} from './pentecaust-vtuber.mjs';

const ALLOWED_SCRIPT_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

// Pull every host that a page actually LOADS SCRIPT from: <script src=...>, `import … from 'url'`,
// and dynamic `import('url')`. (Model/data URLs given as string values are NOT script loads.)
function scriptHosts(html) {
  const hosts = [];
  const push = (u) => { try { hosts.push(new URL(u).host); } catch { /* ignore non-URL */ } };
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/import\s+[^'"]*from\s*['"]([^'"]+)['"]/g)) push(m[1]);
  for (const m of html.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) push(m[1]);
  return hosts;
}

test('effect registry has the documented shape (id/title/kind + kind-specific fields)', () => {
  assert.ok(Array.isArray(SHOW_EFFECTS) && SHOW_EFFECTS.length > 0);
  assert.equal(SHOW_EFFECTS.length, EMOJI_EFFECTS.length + FX_EFFECTS.length);
  const ids = new Set();
  for (const e of SHOW_EFFECTS) {
    assert.equal(typeof e.id, 'string'); assert.ok(e.id.length > 0);
    assert.equal(typeof e.title, 'string'); assert.ok(e.title.length > 0);
    assert.ok(e.kind === 'emoji' || e.kind === 'fx', `bad kind ${e.kind}`);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`); ids.add(e.id);
    if (e.kind === 'emoji') {
      assert.equal(typeof e.glyph, 'string'); assert.ok(e.glyph.length > 0);
    } else {
      assert.equal(typeof e.css, 'string'); assert.ok(e.css.includes('@keyframes'), `${e.id} css needs a keyframe`);
      assert.ok(['particles', 'overlay', 'toggle', 'stage'].includes(e.mode), `bad mode ${e.mode}`);
    }
  }
});

test('listEffects filters by kind', () => {
  assert.deepEqual(listEffects('emoji').map((e) => e.id), EMOJI_EFFECTS.map((e) => e.id));
  assert.deepEqual(listEffects('fx').map((e) => e.id), FX_EFFECTS.map((e) => e.id));
  assert.equal(listEffects().length, SHOW_EFFECTS.length);
});

test('effectStyles emits the shared emoji keyframe plus every fx css', () => {
  const s = effectStyles();
  assert.ok(s.startsWith('<style') && s.endsWith('</style>'));
  assert.ok(s.includes('pcz-float'));
  for (const f of FX_EFFECTS) assert.ok(s.includes(`pcz-${f.id}`) || s.includes(f.css.slice(0, 20)));
});

test('showPageHtml is a self-contained document with the control + donation elements', () => {
  const html = showPageHtml({ title: 'My Show', host: 'Ava', donate: { patreon: 'https://patreon.com/ava' } });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('<video id=pcz-cam'), 'webcam video element');
  assert.ok(html.includes('id=pcz-avatar'), 'avatar canvas');
  assert.ok(html.includes('id=pcz-overlay'), 'overlay layer');
  assert.ok(html.includes('id=pcz-start'), 'start-camera control');
  assert.ok(html.includes('FaceLandmarker'), 'in-browser face tracking');
  // a control trigger exists for every registered effect
  for (const e of SHOW_EFFECTS) {
    if (e.kind === 'emoji') assert.ok(html.includes(`data-glyph="${e.glyph}"`), `emoji trigger ${e.id}`);
    else assert.ok(html.includes(`data-fx="${e.id}"`), `fx trigger ${e.id}`);
  }
  // donation / creator-funding surface
  assert.ok(html.includes('id=pcz-support'), 'support section');
  assert.ok(html.includes('id=pcz-in-patreon'), 'patreon field');
  assert.ok(html.includes('id=pcz-in-pact'), 'pact page field');
  assert.ok(html.includes('https://patreon.com/ava'), 'passed patreon link rendered');
  assert.ok(/no custody/i.test(html), 'states we take no payment custody');
});

test('showPageHtml escapes all interpolation (no injection via title/host/character)', () => {
  const evil = '"><script>alert(1)</script>';
  const html = showPageHtml({ title: evil, host: evil, characterName: evil, donate: { customLabel: evil } });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'value appears escaped');
  // the only <script> in the document is our own module script
  const scriptOpens = html.match(/<script\b/gi) || [];
  assert.equal(scriptOpens.length, 1, 'exactly one (our own) script tag');
});

test('showPageHtml loads scripts ONLY from cdnjs.cloudflare.com or cdn.jsdelivr.net', () => {
  const html = showPageHtml({ title: 'X', characterUrl: 'https://evil.example/x.png' });
  const hosts = scriptHosts(html);
  assert.ok(hosts.length > 0, 'expected at least one script/import load');
  for (const h of hosts) assert.ok(ALLOWED_SCRIPT_HOSTS.includes(h), `disallowed script host: ${h}`);
  // the character URL is data, injected as a JSON string, never as a script load
  assert.ok(!scriptHosts(html).includes('evil.example'));
});

test('showPageHtml only rejects a non-http character URL / bad donate URL (no accidental script src)', () => {
  const html = showPageHtml({ title: 'X', donate: { patreon: 'javascript:alert(1)', kofi: 'https://ko-fi.com/x' } });
  // a non-http funding URL is never turned into a clickable link (no javascript: href)
  assert.ok(!/href\s*=\s*["']javascript:/i.test(html), 'non-http funding URL must not become an href');
  assert.ok(html.includes('https://ko-fi.com/x'), 'valid funding URL kept');
});

test('hubFragmentHtml lists shows and links per-show; escapes titles', () => {
  const frag = hubFragmentHtml({ shows: [
    { id: 'abc', title: 'Ava Live', host: 'Ava', live: true, characterUrl: 'https://cdn.example/a.png' },
    { id: 'x"y', title: '<b>Bad</b>', host: 'B' },
  ] });
  assert.ok(frag.includes('Pentecaust'));
  assert.ok(frag.includes('/pentecaust/s/abc'), 'per-show link');
  assert.ok(frag.includes('LIVE'), 'live badge');
  assert.ok(frag.includes('&lt;b&gt;Bad&lt;/b&gt;'), 'title escaped');
  assert.ok(!frag.includes('<b>Bad</b>'), 'no raw injected title');
  assert.ok(frag.includes('/pentecaust/s/x%22y'), 'show id url-encoded in link');
});

test('hubFragmentHtml shows an empty state with no shows', () => {
  const frag = hubFragmentHtml({ shows: [] });
  assert.ok(/no shows yet/i.test(frag));
  assert.ok(frag.includes('/compose'));
});

test('nothing throws on empty / missing args (soft-fail)', () => {
  assert.doesNotThrow(() => showPageHtml());
  assert.doesNotThrow(() => hubFragmentHtml());
  assert.doesNotThrow(() => effectStyles());
  assert.ok(showPageHtml().startsWith('<!doctype html>'));
});
