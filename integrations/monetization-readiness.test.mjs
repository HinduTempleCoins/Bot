// monetization-readiness.test.mjs — OFFLINE tests for the go-live readiness aggregator.
// No network: pure aggregation over the registries. Asserts: a report row per money-making vertical,
// missing-pieces flagging (no affiliate id, no payment provider, disclosure absence detection),
// soft-fail on an absent module (checkout/payment not built yet -> flagged, never thrown), checkout
// readiness shape, summary counts, and HTML render escapes + shows the summary.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  readiness,
  readinessFor,
  readinessForName,
  listVerticals,
  checkoutReadiness,
  summary,
  renderReport,
  affiliateGoLiveChecklist,
  renderChecklist,
} from './monetization-readiness.mjs';

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, val] of Object.entries(vars)) {
    if (val === undefined) delete process.env[k];
    else process.env[k] = val;
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const [k, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[k];
      else process.env[k] = val;
    }
  });
}

test('listVerticals includes the money-making verticals (coupons, financial-products, insurance)', () => {
  const v = listVerticals();
  for (const k of ['coupons', 'financial-products', 'insurance']) {
    assert.ok(v.includes(k), `missing vertical ${k}`);
  }
});

test('readiness produces a report row per vertical with the expected shape', async () => {
  const reports = await readiness();
  assert.equal(reports.length, listVerticals().length);
  for (const r of reports) {
    assert.ok(typeof r.vertical === 'string');
    assert.ok(['affiliate', 'checkout', 'both', 'none'].includes(r.earnsVia));
    assert.equal(typeof r.ready, 'boolean');
    assert.ok(Array.isArray(r.missing));
    assert.ok(typeof r.notes === 'string');
    assert.ok(Array.isArray(r.mechanisms));
  }
});

test('checkoutReadiness reports the payment layer state (present when checkout.mjs exists), never throws', () => {
  // checkout.mjs / payment-apis.mjs were built under #261; the probe reports them. The shape is always
  // safe: { present, providers:[...], missing:[...] }. (If they were absent it would report not-built.)
  const ck = checkoutReadiness();
  assert.equal(typeof ck.present, 'boolean');
  assert.ok(Array.isArray(ck.providers));
  assert.ok(Array.isArray(ck.missing));
  if (!ck.present) assert.match(ck.missing[0], /not built yet/i);
});

test('flags a missing affiliate network id when the env is unset', async () => {
  await withEnv({ CJ_PUBLISHER_ID: undefined, IMPACT_PARTNER_ID: undefined, RAKUTEN_AFFILIATE_ID: undefined }, async () => {
    const r = await readinessForName('coupons');
    assert.ok(r, 'coupons report exists');
    // coupons uses an affiliate network (rakuten) — with the env unset, the affiliate gap must be flagged
    // in `missing` so the operator's punch-list shows it (even if a checkout path also earns).
    const flaggedAffiliate = r.missing.some((m) => /affiliate network id/i.test(m));
    assert.ok(flaggedAffiliate, `expected an affiliate-id flag, got: ${JSON.stringify(r.missing)}`);
  });
});

test('the HARD affiliate-id blocker clears once a network id IS configured', async () => {
  // coupons uses a single network (rakuten). With RAKUTEN_AFFILIATE_ID set, the hard "no affiliate
  // network id configured" blocker must clear and the vertical reports ready.
  await withEnv({ RAKUTEN_AFFILIATE_ID: 'RAK123' }, async () => {
    const r = await readinessForName('coupons');
    assert.ok(r);
    const hardBlock = r.missing.some((m) => /no affiliate network id configured/i.test(m));
    assert.equal(hardBlock, false, 'no hard affiliate-id blocker once configured');
    assert.equal(r.ready, true);
    assert.ok(r.configuredNetworkEnvs.includes('RAKUTEN_AFFILIATE_ID'));
  });
});

test('insurance report earns via an affiliate/checkout path and detects its disclosure discipline', async () => {
  await withEnv({ CJ_PUBLISHER_ID: 'PUB1' }, async () => {
    const r = await readinessForName('insurance');
    assert.ok(r);
    assert.ok(['affiliate', 'both', 'checkout'].includes(r.earnsVia));
    // disclosure present -> not flagged as missing
    assert.ok(!r.missing.some((m) => /disclosure not detected/i.test(m)));
    assert.equal(r.ready, true);
  });
});

test('readinessForName returns null for an unknown vertical', async () => {
  assert.equal(await readinessForName('nope-nope'), null);
});

test('soft-fails (never throws) when a vertical reader module is absent', async () => {
  // defensive dynamic import: a missing reader module must yield a not-ready row flagging the gap.
  const r = await readinessFor({ vertical: 'ghost', module: './soapbox/does-not-exist.mjs', directoryIds: ['coupons'] });
  assert.equal(r.vertical, 'ghost');
  assert.ok(r.missing.some((m) => /not loadable/i.test(m)));
  assert.equal(r.ready, false);
});

test('summary reports totals + checkout state + byEarnsVia breakdown', async () => {
  const s = await summary();
  assert.equal(s.total, listVerticals().length);
  assert.ok(s.ready + s.notReady === s.total);
  assert.equal(typeof s.checkout.present, 'boolean');
  assert.ok(typeof s.byEarnsVia === 'object');
});

test('renderReport escapes content + shows the summary line', async () => {
  const reports = await readiness();
  const s = await summary();
  const html = renderReport(reports, s);
  assert.ok(html.includes('Monetization go-live readiness'));
  assert.ok(html.includes('verticals ready to earn'));
  assert.ok(html.includes('no data-selling'));
  // ensure no unescaped angle brackets leak from a vertical name (all are plain ids here, but check shape)
  assert.ok(html.includes('<table'));
});

// --- affiliateGoLiveChecklist — the operator's go-live punch-list -----------

test('affiliateGoLiveChecklist returns the expected shape per vertical', async () => {
  const rows = await affiliateGoLiveChecklist();
  assert.equal(rows.length, listVerticals().length);
  for (const r of rows) {
    assert.ok(typeof r.vertical === 'string');
    assert.ok(Array.isArray(r.networks));
    assert.equal(typeof r.disclosurePresent, 'boolean');
    assert.equal(typeof r.dataSellGuard, 'boolean');
    assert.equal(typeof r.ready, 'boolean');
    for (const n of r.networks) {
      assert.ok(typeof n.name === 'string');
      assert.ok(n.envVar == null || /^[A-Z0-9_]+$/.test(n.envVar), `env var should be UPPER_SNAKE: ${n.envVar}`);
      assert.equal(typeof n.configured, 'boolean');
    }
  }
});

test('affiliateGoLiveChecklist FLAGS missing ids (no env set → networks unconfigured, names env to set)', async () => {
  await withEnv({ CJ_PUBLISHER_ID: undefined, AFFIL_CJ_PID: undefined, IMPACT_PARTNER_ID: undefined, AFFIL_IMPACT_ID: undefined, RAKUTEN_AFFILIATE_ID: undefined, AFFIL_RAKUTEN_ID: undefined }, async () => {
    const rows = await affiliateGoLiveChecklist();
    const ins = rows.find((r) => r.vertical === 'insurance');
    assert.ok(ins, 'insurance row present');
    assert.ok(ins.networks.length > 0, 'insurance draws on at least one network');
    for (const n of ins.networks) {
      assert.equal(n.configured, false, `${n.name} should be flagged unconfigured`);
      assert.ok(n.envVar, 'tells the operator which env var to set');
    }
    // insurance has a leadgen line (health) → it must carry the no-data-selling guard.
    assert.equal(ins.dataSellGuard, true, 'insurance carries buildLeadGen guard');
    assert.equal(ins.disclosurePresent, true, 'insurance carries the FTC disclosure');
  });
});

test('affiliateGoLiveChecklist flips a network to configured when its id (or AFFIL_* alias) is set', async () => {
  await withEnv({ AFFIL_CJ_PID: 'PUBX' }, async () => {
    const rows = await affiliateGoLiveChecklist();
    const cjUser = rows.find((r) => r.networks.some((n) => n.key === 'cj'));
    assert.ok(cjUser, 'some vertical uses CJ');
    const cj = cjUser.networks.find((n) => n.key === 'cj');
    assert.equal(cj.configured, true, 'CJ flips configured via the AFFIL_CJ_PID alias');
  });
});

test('affiliateGoLiveChecklist detects the no-data-selling guard on the lead-gen verticals', async () => {
  const rows = await affiliateGoLiveChecklist();
  for (const v of ['real-estate', 'auto-marketplace', 'local-pros']) {
    const r = rows.find((x) => x.vertical === v);
    assert.ok(r, `row for ${v}`);
    assert.equal(r.dataSellGuard, true, `${v} must carry a buildLeadGen no-data-selling guard`);
  }
});

test('renderChecklist escapes + shows env vars and signup links', async () => {
  await withEnv({ CJ_PUBLISHER_ID: undefined, AFFIL_CJ_PID: undefined }, async () => {
    const rows = await affiliateGoLiveChecklist();
    const html = renderChecklist(rows);
    assert.ok(html.includes('Affiliate go-live checklist'));
    assert.ok(html.includes('<code>CJ_PUBLISHER_ID</code>') || html.includes('CJ_PUBLISHER_ID'));
    assert.ok(/sign up:/.test(html) || /signup/.test(html));
    assert.ok(html.includes('<table'));
  });
});
