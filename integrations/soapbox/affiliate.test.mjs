// affiliate.test.mjs — OFFLINE tests for the affiliate lead-out. No network. Asserts correct
// vendor URLs, affiliate tag injected when env present + omitted when absent, borrow links present,
// and a non-empty FTC disclosure. We mutate process.env per-test and restore it after.

import { test } from 'node:test';
import assert from 'node:assert';
import { buyLinks, affiliateUrl, ftcDisclosure } from './affiliate.mjs';

const ISBN = '9780140449136';

// run a body with a controlled env, restoring originals afterward
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, val] of Object.entries(vars)) {
    if (val === undefined) delete process.env[k];
    else process.env[k] = val;
  }
  try { return fn(); }
  finally {
    for (const [k, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  }
}

test('buyLinks returns buy + borrow links, all shaped {vendor,url,kind}', () => {
  withEnv({ AMAZON_ASSOC_TAG: undefined, BOOKSHOP_AFF_ID: undefined }, () => {
    const links = buyLinks(ISBN);
    assert.ok(links.length >= 6);
    for (const l of links) {
      assert.ok(l.vendor && typeof l.vendor === 'string');
      assert.ok(/^https:\/\//.test(l.url), `url should be https: ${l.url}`);
      assert.ok(l.kind === 'buy' || l.kind === 'borrow');
    }
    assert.ok(links.some((l) => l.kind === 'buy'));
    assert.ok(links.some((l) => l.kind === 'borrow'), 'borrow links must be present');
  });
});

test('borrow links: Open Library, WorldCat, Libby all present', () => {
  const links = buyLinks(ISBN);
  const borrowVendors = links.filter((l) => l.kind === 'borrow').map((l) => l.vendor);
  assert.ok(borrowVendors.includes('openlibrary'));
  assert.ok(borrowVendors.includes('worldcat'));
  assert.ok(borrowVendors.includes('libby'));
});

test('Bookshop is the primary buy vendor and points at bookshop.org', () => {
  const links = buyLinks(ISBN);
  const buys = links.filter((l) => l.kind === 'buy');
  assert.equal(buys[0].vendor, 'bookshop', 'bookshop should be first/primary buy link');
  assert.ok(buys[0].url.includes('bookshop.org'));
});

test('Amazon: tag injected when AMAZON_ASSOC_TAG present', () => {
  withEnv({ AMAZON_ASSOC_TAG: 'soapbox-20' }, () => {
    const url = affiliateUrl('amazon', ISBN);
    assert.ok(url.includes('amazon.com'));
    assert.ok(url.includes('tag=soapbox-20'), `expected tag in: ${url}`);
    assert.ok(url.includes(ISBN));
  });
});

test('Amazon: soft-falls to plain link with NO tag when env absent', () => {
  withEnv({ AMAZON_ASSOC_TAG: undefined }, () => {
    const url = affiliateUrl('amazon', ISBN);
    assert.ok(url.includes('amazon.com'));
    assert.ok(!url.includes('tag='), `expected no tag in: ${url}`);
  });
});

test('Bookshop: affiliate id injected into /a/<id>/ path when present', () => {
  withEnv({ BOOKSHOP_AFF_ID: '12345' }, () => {
    const url = affiliateUrl('bookshop', ISBN);
    assert.ok(url.includes('/a/12345/'), `expected affiliate path in: ${url}`);
  });
});

test('Bookshop: soft-falls to non-affiliate path when env absent', () => {
  withEnv({ BOOKSHOP_AFF_ID: undefined }, () => {
    const url = affiliateUrl('bookshop', ISBN);
    assert.ok(url.includes('bookshop.org'));
    assert.ok(!url.includes('/a/'), `expected no /a/ affiliate path in: ${url}`);
  });
});

test('used/rare + audiobook vendors point at the right hosts', () => {
  assert.ok(affiliateUrl('abebooks', ISBN).includes('abebooks.com'));
  assert.ok(affiliateUrl('betterworldbooks', ISBN).includes('betterworldbooks.com'));
  assert.ok(affiliateUrl('librofm', ISBN).includes('libro.fm'));
});

test('title/author search input (no ISBN) builds search URLs', () => {
  withEnv({ AMAZON_ASSOC_TAG: undefined, BOOKSHOP_AFF_ID: undefined }, () => {
    const links = buyLinks({ title: 'The Republic', author: 'Plato' });
    assert.ok(links.length >= 6);
    const amazon = links.find((l) => l.vendor === 'amazon');
    assert.ok(amazon.url.includes('Republic'), `expected search term in: ${amazon.url}`);
  });
});

test('unknown vendor returns null', () => {
  assert.equal(affiliateUrl('nonsense', ISBN), null);
});

test('ftcDisclosure is a non-empty string mentioning the disclosure', () => {
  const d = ftcDisclosure();
  assert.equal(typeof d, 'string');
  assert.ok(d.length > 0);
  assert.ok(/affiliate|associate/i.test(d));
});
