// ad-slot.test.mjs — offline, no network. Verifies the env-gated slot contract: no-op when disabled,
// placeholder when no publisher id, real AdSense tag when AD_CLIENT is set, esc() safety, and that the
// loaders + impression/click tracker only fire when configured.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adSlot, headTags, adsenseLoader, skimlinksLoader, adTrackerJs, slotStyles,
  adsEnabled, adClient, adUnitId, skimlinksJs, railStatus, esc,
} from './ad-slot.mjs';

const CLIENT = 'ca-pub-1234567890123456';

test('disabled → true no-op (empty string), never a broken tag', () => {
  assert.equal(adSlot('law-top'), '');                          // no enabled flag, no ADS_ENABLED
  assert.equal(adSlot('law-top', { enabled: false, env: { AD_CLIENT: CLIENT } }), '');
  // global kill switch wins even when enabled + configured
  assert.equal(adSlot('law-top', { enabled: true, env: { ADS_DISABLED: '1', AD_CLIENT: CLIENT } }), '');
  assert.equal(headTags({ enabled: false }), '');
});

test('enabled, NO publisher id → labeled placeholder (no ad script)', () => {
  const html = adSlot('law-top', { enabled: true, env: {} });
  assert.match(html, /ad-slot--ph/);
  assert.match(html, /data-ad-placement="law-top"/);
  assert.match(html, /AD_CLIENT/);                              // tells the operator what to set
  assert.doesNotMatch(html, /adsbygoogle/);                    // no real ad code without an id
  assert.doesNotMatch(html, /googlesyndication/);
});

test('enabled, AD_CLIENT set → real AdSense <ins> unit with escaped client + unit id', () => {
  const env = { AD_CLIENT: CLIENT, AD_SLOT_LAW_TOP: '9876543210' };
  const html = adSlot('law-top', { enabled: true, env });
  assert.match(html, /class="adsbygoogle"/);
  assert.match(html, new RegExp(`data-ad-client="${CLIENT}"`));
  assert.match(html, /data-ad-slot="9876543210"/);
  assert.match(html, /data-full-width-responsive="true"/);
  assert.match(html, /adsbygoogle=window\.adsbygoogle\|\|\[\]\)\.push\(\{\}\)/);
  assert.match(html, /data-ad-placement="law-top"/);           // tracking key present
});

test('per-placement unit id falls back to AD_SLOT_ID', () => {
  assert.equal(adUnitId('law-top', { AD_SLOT_LAW_TOP: '111' }), '111');
  assert.equal(adUnitId('law-top', { AD_SLOT_ID: '222' }), '222');
  assert.equal(adUnitId('law-top', { AD_SLOT_LAW_TOP: '111', AD_SLOT_ID: '222' }), '111'); // specific wins
  assert.equal(adUnitId('law-top', {}), '');
});

test('placement is escaped into the data attribute (no HTML injection)', () => {
  const html = adSlot('"><script>x', { enabled: true, env: {} });
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&quot;&gt;&lt;script&gt;x/);
  // esc() itself
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

test('adsenseLoader only when AD_CLIENT set; scoped to the publisher', () => {
  assert.equal(adsenseLoader({}), '');
  const s = adsenseLoader({ AD_CLIENT: CLIENT });
  assert.match(s, /googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-1234567890123456/);
  assert.match(s, /crossorigin="anonymous"/);
});

test('skimlinks: direct URL or built from a valid publisher id; else empty', () => {
  assert.equal(skimlinksJs({}), '');
  assert.equal(skimlinksJs({ SKIMLINKS_JS: 'https://s.skimresources.com/js/1X2.skimlinks.js' }),
    'https://s.skimresources.com/js/1X2.skimlinks.js');
  assert.equal(skimlinksJs({ SKIMLINKS_PUBLISHER_ID: '123456X987654' }),
    'https://s.skimresources.com/js/123456X987654.skimlinks.js');
  assert.equal(skimlinksJs({ SKIMLINKS_PUBLISHER_ID: 'not-an-id' }), '');   // don't fabricate a URL
  assert.match(skimlinksLoader({ SKIMLINKS_PUBLISHER_ID: '123456X987654' }), /skimlinks\.js/);
  assert.equal(skimlinksLoader({}), '');
});

test('adTrackerJs: posts ad_impression + ad_click to our own collector, text/plain', () => {
  const js = adTrackerJs({ ANALYTICS_BASE: 'https://soapy.blog' });
  assert.match(js, /"https:\/\/soapy\.blog"/);
  assert.match(js, /ad_impression/);
  assert.match(js, /ad_click/);
  assert.match(js, /\/px/);
  assert.match(js, /text\/plain/);                              // sendBeacon no-cors constraint
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /rel~=sponsored/);                           // affiliate links are tracked too
});

test('headTags: gated bundle — nothing until enabled, loaders only when configured', () => {
  assert.equal(headTags({ enabled: false, env: { AD_CLIENT: CLIENT } }), '');
  // enabled but unconfigured → still emits the tracker (measure inventory before an id exists)
  const bare = headTags({ enabled: true, env: {} });
  assert.doesNotMatch(bare, /googlesyndication/);
  assert.match(bare, /ad_impression/);
  // configured → loader + tracker
  const full = headTags({ enabled: true, env: { AD_CLIENT: CLIENT, SKIMLINKS_PUBLISHER_ID: '123456X987654' } });
  assert.match(full, /googlesyndication/);
  assert.match(full, /skimlinks\.js/);
  assert.match(full, /ad_click/);
});

test('adsEnabled: kill switch > opts.enabled > ADS_ENABLED env; default off', () => {
  assert.equal(adsEnabled({}, {}), false);
  assert.equal(adsEnabled({}, { ADS_ENABLED: '1' }), true);
  assert.equal(adsEnabled({ enabled: true }, {}), true);
  assert.equal(adsEnabled({ enabled: true }, { ADS_DISABLED: 'yes' }), false); // kill wins
  assert.equal(adsEnabled({ enabled: false }, { ADS_ENABLED: '1' }), false);
});

test('railStatus reports presence only (no secret values)', () => {
  const st = railStatus({ enabled: true, env: { AD_CLIENT: CLIENT, AD_SLOT_ID: '9', SKIMLINKS_PUBLISHER_ID: '1X2' } });
  assert.equal(st.enabled, true);
  assert.equal(st.adsense.configured, true);
  assert.equal(st.adsense.defaultUnit, true);
  assert.equal(st.skimlinks.configured, true);
  assert.equal(typeof st.tracker.collector, 'string');
  // must NOT leak the id value anywhere in the snapshot
  assert.doesNotMatch(JSON.stringify(st), new RegExp(CLIENT));
});

test('slotStyles is a plain non-empty CSS string', () => {
  const css = slotStyles();
  assert.match(css, /\.ad-slot/);
  assert.match(css, /\.ad-slot--ph/);
});

test('adClient reads AD_CLIENT then ADSENSE_CLIENT alias', () => {
  assert.equal(adClient({ AD_CLIENT: 'a' }), 'a');
  assert.equal(adClient({ ADSENSE_CLIENT: 'b' }), 'b');
  assert.equal(adClient({}), '');
});
