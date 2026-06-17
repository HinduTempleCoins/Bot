// page.test.mjs — offline. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comingSoonPage, esc } from './page.mjs';

test('renders a branded coming-soon page with the shared nav + back link', () => {
  const h = comingSoonPage({ section: 'Shopping', blurb: 'Honest deal comparison.', current: 'shopping' });
  assert.match(h, /<title>Shopping — SoapBox \(coming soon\)<\/title>/);
  assert.match(h, /class=enav/);                         // shared ecosystem nav present
  assert.match(h, /Coming soon/);
  assert.match(h, /Honest deal comparison\./);
  assert.match(h, /soapbox\.community/);                 // back-to-hub link
  assert.match(h, /noindex,follow/);                     // don't index a stub
});

test('escapes the section name', () => {
  const h = comingSoonPage({ section: '<x>"&' });
  assert.match(h, /&lt;x&gt;/);
  assert.ok(!h.includes('<x>'));
});

test('esc neutralizes html', () => {
  assert.equal(esc('<a>"&'), '&lt;a&gt;&quot;&amp;');
});

test('defaults are safe (no section/blurb)', () => {
  const h = comingSoonPage();
  assert.match(h, /SoapBox/);
  assert.match(h, /class=enav/);
});
