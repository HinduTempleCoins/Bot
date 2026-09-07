import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAX_PROVIDERS, DEAD_PROVIDERS, CONVERSIONS, conversion, faxProvider,
  estimateFax, recommend, sendFax, handler,
} from './doc-services.mjs';

test('every fax provider declares price, ad status and whether it has an API', () => {
  for (const p of Object.values(FAX_PROVIDERS)) {
    assert.ok(p.id && p.label, 'id/label');
    assert.ok(['api', 'webform'].includes(p.kind), `kind: ${p.id}`);
    assert.equal(typeof p.perPageUSD, 'number', `perPageUSD: ${p.id}`);
    assert.equal(typeof p.adCoverPage, 'boolean', `adCoverPage: ${p.id}`);
    assert.ok(p.note, `every provider must carry its caveat: ${p.id}`);
  }
});

test('Twilio is recorded as dead, with the date, rather than omitted', () => {
  assert.ok(DEAD_PROVIDERS.twilio);
  assert.equal(DEAD_PROVIDERS.twilio.diedOn, '2021-12-17');
  assert.equal(faxProvider('twilio'), null, 'a dead provider is not selectable');
});

test('estimateFax multiplies pages by faxes and respects a monthly minimum', () => {
  const t = estimateFax({ providerId: 'telnyx', pages: 4, faxes: 10 });
  assert.equal(t.pages, 40);
  assert.equal(t.usageUSD, 0.28);
  assert.equal(t.totalFirstMonthUSD, 0.28);

  const m = estimateFax({ providerId: 'mfax', pages: 1, faxes: 1 });
  assert.equal(m.overMinimum, false);
  assert.equal(m.totalFirstMonthUSD, 25, 'a monthly minimum dominates a tiny send');
});

test('estimateFax returns null for an unknown provider rather than guessing zero', () => {
  assert.equal(estimateFax({ providerId: 'nope', pages: 1 }), null);
});

test('⭐ an ad-supported service is EXCLUDED from an evidentiary send, with the reason', () => {
  const r = recommend({ pages: 2, faxes: 1, evidentiary: true });
  assert.ok(!r.ranked.some((p) => p.provider === 'faxzero'));
  const ex = r.excluded.find((e) => e.id === 'faxzero');
  assert.ok(ex, 'the exclusion must be reported, not silent');
  assert.match(ex.reason, /transmission report belongs to the service/);
});

test('a web-form service is excluded even when the send is not evidentiary', () => {
  const r = recommend({ pages: 2, faxes: 1, evidentiary: false });
  assert.ok(!r.ranked.some((p) => p.provider === 'faxzero'), 'no API means it cannot be automated');
  assert.ok(r.excluded.some((e) => e.id === 'faxzero'));
});

test('recommend ranks by real first-month cost, so a monthly minimum cannot win a small send', () => {
  const r = recommend({ pages: 4, faxes: 10 });
  assert.equal(r.best.provider, 'telnyx');
  assert.equal(r.best.totalFirstMonthUSD, 0.28);
  const mfax = r.ranked.find((p) => p.provider === 'mfax');
  assert.ok(mfax.totalFirstMonthUSD > r.best.totalFirstMonthUSD);
});

test('recommend always surfaces the dead ends and the manual alternative', () => {
  const r = recommend({ pages: 1, faxes: 1 });
  assert.ok(r.deadEnds.some((d) => d.id === 'twilio'));
  assert.match(r.manualAlternative.why, /transmission report/);
});

test('lossy conversions are flagged as lossy', () => {
  assert.equal(conversion('pdf-to-docx').lossy, true);
  assert.equal(conversion('md-to-pdf').lossy, false);
  assert.equal(conversion('pdf-ocr').lossy, false, 'OCR adds a text layer without altering the image');
  for (const c of CONVERSIONS) {
    if (c.lossy) assert.ok(c.note, `a lossy conversion must say why it matters: ${c.id}`);
  }
});

test('conversion lookup is null for unknown', () => {
  assert.equal(conversion('nope'), null);
});

test('⭐ sendFax does NOTHING without an injected transport', async () => {
  const r = await sendFax({ providerId: 'telnyx', to: '+15551234567',
    document: { filename: 'a.pdf' } });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'transport');
});

test('sendFax refuses a provider that has no API', async () => {
  const r = await sendFax({ providerId: 'faxzero', to: '+15551234567',
    document: { filename: 'a.pdf' }, transport: async () => ({ ok: true }) });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'provider');
  assert.match(r.reason, /no API/);
});

test('sendFax rejects an unusable number before the network', async () => {
  let called = false;
  const r = await sendFax({ providerId: 'telnyx', to: '12345',
    document: { filename: 'a.pdf' }, transport: async () => { called = true; return { ok: true }; } });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'number');
  assert.equal(called, false);
});

test('sendFax requires a document with a filename', async () => {
  const r = await sendFax({ providerId: 'telnyx', to: '(214) 653-7481',
    transport: async () => ({ ok: true }) });
  assert.equal(r.stage, 'document');
});

test('sendFax normalises the number and keeps the transmission report', async () => {
  const r = await sendFax({ providerId: 'telnyx', to: '(214) 653-7481',
    document: { filename: 'request.pdf' },
    transport: async ({ to }) => ({ ok: true, id: 'fx1', transmissionReport: `sent to ${to}` }) });
  assert.equal(r.ok, true);
  assert.equal(r.to, '2146537481');
  assert.equal(r.transmissionReport, 'sent to 2146537481',
    'the report is the whole reason for faxing — it must survive');
});

test('sendFax classifies a busy line as retryable and never throws', async () => {
  const busy = await sendFax({ providerId: 'telnyx', to: '2146537481',
    document: { filename: 'a.pdf' },
    transport: async () => { throw new Error('line busy'); } });
  assert.equal(busy.retryable, true);
  const hard = await sendFax({ providerId: 'telnyx', to: '2146537481',
    document: { filename: 'a.pdf' },
    transport: async () => { throw new Error('invalid destination'); } });
  assert.equal(hard.ok, false);
  assert.equal(hard.retryable, false);
});

test('handler states plainly that there is no free fax API', () => {
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  handler({ url: '/' }, res);
  const j = JSON.parse(res.body);
  assert.equal(j.fax.free, false);
  assert.match(j.fax.why, /Twilio Programmable Fax was discontinued/);
  assert.equal(j.fax.cheapest, 'telnyx');
});

test('no credential field on any provider', () => {
  for (const p of Object.values(FAX_PROVIDERS)) {
    for (const k of Object.keys(p)) {
      assert.ok(!['apikey', 'secret', 'token', 'password'].includes(k.toLowerCase()),
        `${p.id} must not carry ${k}`);
    }
  }
});
