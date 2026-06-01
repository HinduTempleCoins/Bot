// Safety-critical: the sanitizer is THE boundary between raw private trade data and the
// external API AIs. These tests prove secret shapes never survive into the shareable copy
// and that private figures are coarsened to bands. Guards the zero-WIF rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, toMarkdown, redact, SECRET_SHAPES } from './trade-sanitizer.mjs';

const leaks = (s) => SECRET_SHAPES.some((re) => re.test(s));

test('redact scrubs a WIF private key', () => {
  const wif = '5JLw5dgQAx6rhZEgNN5C2ds1V47Rwena5evVjzqzeUFGuWXgFP8';
  assert.ok(!redact(`key ${wif} end`).includes(wif));
  assert.match(redact(`key ${wif} end`), /«redacted»/);
});

test('redact scrubs a bot-token shape, google key, IPv4, and private paths', () => {
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345.Abc012.AbCdEfGhIjKlMnOpQrStUvWxYz0';
  const gkey = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
  const out = redact(`t=${token} g=${gkey} ip=10.0.0.5 p=/var/melek-bot/brain/x`);
  assert.ok(!out.includes(token), 'token leaked');
  assert.ok(!out.includes(gkey), 'google key leaked');
  assert.ok(!out.includes('10.0.0.5'), 'ip leaked');
  assert.match(out, /«path»/);
});

test('sanitize → markdown is boundary-clean even when raw is poisoned with secrets', () => {
  const poisoned = {
    window_ops: 2000,
    totals: { realizedHive: 873.17, unrealizedHive: 1153.47, netHive: 2026.64 },
    tokens: [{ symbol: 'SWAP.LTC', issued: false, netHive: -6424.29, buys: 169, sells: 1, heldHive: 0 }],
    findings: ['SINK: SWAP.LTC bled. key=5JLw5dgQAx6rhZEgNN5C2ds1V47Rwena5evVjzqzeUFGuWXgFP8'],
    suggestions: ['Stop. host=/etc/melek-bot/secret ip=192.168.1.50'],
  };
  const md = toMarkdown(sanitize(poisoned));
  assert.ok(!leaks(md), 'a secret shape survived into the shareable markdown');
  assert.ok(!md.includes('192.168.1.50'));
  assert.ok(!md.includes('/etc/melek-bot/secret'));
});

test('sanitize coarsens exact private figures into bands (no raw balances)', () => {
  const raw = {
    window_ops: 2000,
    totals: { realizedHive: 873.17, unrealizedHive: 1153.47, netHive: 2026.64 },
    tokens: [{ symbol: 'VKBT', issued: true, netHive: -138.39, buys: 455, sells: 0, heldHive: 62.59 }],
    findings: [], suggestions: [],
  };
  const clean = sanitize(raw);
  // exact figures must not appear verbatim; banded values are rounded
  assert.equal(clean.totals.netHiveBand % 50, 0, 'net should be rounded to a 50-band');
  assert.equal(clean.tokens[0].holdingValueBand, '<100');
  assert.equal(clean.tokens[0].role, 'issued-by-us');
  assert.ok(!JSON.stringify(clean).includes('2026.64'), 'exact net leaked');
});
