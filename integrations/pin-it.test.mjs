import { test } from 'node:test';
import assert from 'node:assert';
import { pinItHref, pinItButton, PIN_IT_JS, PIN_IT_CSS, pinItAll } from './pin-it.mjs';

const IMG = 'https://hathor.soapbox.community/img/a1.png';

test('the save link carries the picture, the page it was on, and the title', () => {
  const href = pinItHref({ url: IMG, source: 'https://melek.salon/@ryan/post', title: 'The Lyre', as: 'friend' });
  assert.match(href, /^https:\/\/pin\.melek\.salon\/save\?/);
  const q = new URL(href).searchParams;
  assert.equal(q.get('url'), IMG);
  assert.equal(q.get('source'), 'https://melek.salon/@ryan/post');
  assert.equal(q.get('title'), 'The Lyre');
  assert.equal(q.get('as'), 'friend');
});

test('a picture address that is not http(s) gets no button at all', () => {
  assert.equal(pinItHref({ url: 'javascript:alert(1)' }), '');
  assert.equal(pinItHref({ url: 'data:image/png;base64,AA' }), '');
  assert.equal(pinItButton({ url: 'javascript:alert(1)' }), '');
  assert.match(pinItButton({ url: IMG }), /class=pin-it href="https:\/\/pin\.melek\.salon\/save\?/);
});

test('a bad source is dropped rather than passed through', () => {
  const q = new URL(pinItHref({ url: IMG, source: 'javascript:alert(1)' })).searchParams;
  assert.equal(q.get('source'), null);
});

test('titles cannot break out of the markup', () => {
  const html = pinItButton({ url: IMG, title: '"><script>alert(1)</script>' });
  assert.equal(html.includes('<script>'), false);
});

test('the page script skips small pictures and anything marked no-pin', () => {
  assert.match(PIN_IT_JS, /data-no-pin/);
  assert.match(PIN_IT_JS, /MIN=160/);
  assert.match(PIN_IT_JS, /melek_me/);           // signs the pin as you, when you are signed in
  assert.doesNotThrow(() => new Function(PIN_IT_JS.replace(/<\/?script>/g, '')));
  assert.match(pinItAll(), /pin-it-wrap/);
  assert.match(PIN_IT_CSS, /hover:none/);        // touch screens get a visible button
});
