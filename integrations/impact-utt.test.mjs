// impact-utt.test.mjs — OFFLINE tests for the Impact.com UTT <head> snippet.
// No network. Asserts: the snippet embeds the CDN src, calls both impactStat('transformLinks') and
// impactStat('trackImpression'), defaults to the known account id, honors the IMPACT_ACCOUNT_ID env
// override, and rejects a malformed override (falling back to the default — no <head> injection).

import { test } from 'node:test';
import assert from 'node:assert';
import {
  DEFAULT_ACCOUNT_ID, impactAccountId, impactUttSrc, impactUtt,
} from './impact-utt.mjs';

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

test('default account id + src', () => {
  withEnv({ IMPACT_ACCOUNT_ID: undefined }, () => {
    assert.equal(impactAccountId(), DEFAULT_ACCOUNT_ID);
    assert.equal(impactUttSrc(), `https://utt.impactcdn.com/${DEFAULT_ACCOUNT_ID}.js`);
  });
});

test('snippet contains the CDN src and both impactStat calls', () => {
  withEnv({ IMPACT_ACCOUNT_ID: undefined }, () => {
    const s = impactUtt();
    assert.match(s, /^<script type="text\/javascript">/);
    assert.ok(s.trim().endsWith('</script>'));
    assert.ok(s.includes(impactUttSrc()), 'embeds the CDN src url');
    assert.ok(s.includes(`https://utt.impactcdn.com/${DEFAULT_ACCOUNT_ID}.js`));
    assert.ok(s.includes("impactStat('transformLinks')"), 'calls transformLinks');
    assert.ok(s.includes("impactStat('trackImpression')"), 'calls trackImpression');
  });
});

test('IMPACT_ACCOUNT_ID env overrides the account id in src + snippet', () => {
  withEnv({ IMPACT_ACCOUNT_ID: 'P-OVERRIDE-1234-5678' }, () => {
    assert.equal(impactAccountId(), 'P-OVERRIDE-1234-5678');
    assert.equal(impactUttSrc(), 'https://utt.impactcdn.com/P-OVERRIDE-1234-5678.js');
    const s = impactUtt();
    assert.ok(s.includes('https://utt.impactcdn.com/P-OVERRIDE-1234-5678.js'));
    assert.ok(!s.includes(DEFAULT_ACCOUNT_ID), 'default id not present when overridden');
  });
});

test('env override is trimmed', () => {
  withEnv({ IMPACT_ACCOUNT_ID: '  P-TRIMMED-9  ' }, () => {
    assert.equal(impactAccountId(), 'P-TRIMMED-9');
  });
});

test('malformed override is rejected -> falls back to default (no injection)', () => {
  for (const bad of ['', '   ', 'not-an-id', 'P-<script>alert(1)</script>', 'X-123', 'P- has space']) {
    withEnv({ IMPACT_ACCOUNT_ID: bad }, () => {
      assert.equal(impactAccountId(), DEFAULT_ACCOUNT_ID, `rejects ${JSON.stringify(bad)}`);
      const s = impactUtt();
      assert.ok(!s.includes('<script>alert'), 'no markup injected into head');
    });
  }
});
