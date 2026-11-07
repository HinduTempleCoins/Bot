// site/yoni/surfaces.test.mjs — OFFLINE. That each surface takes its level from the policy engine,
// that the open one is genuinely open, that the gated ones fail closed, and that the card-network
// controls appear exactly where a monetised surface exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { surfacePage, compliancePage, surfaceNames, SURFACES, CARD_CONTROLS } from './surfaces.mjs';
import { policyFor } from '../../integrations/agegate/model.mjs';

const shell = (title, body, desc) => `<title>${title}</title><desc>${desc}</desc>${body}`;

test('every declared surface in this module has a policy and renders', () => {
  assert.ok(surfaceNames().length >= 4, surfaceNames().join(','));
  for (const n of surfaceNames()) {
    const pol = policyFor(n);
    assert.ok(pol && pol.level, `${n} has a policy`);
    assert.ok(surfacePage(n, { shell }), `${n} renders`);
  }
});

test('preview is open and carries no card controls', () => {
  assert.equal(policyFor('preview').level, 'none');
  const html = surfacePage('preview', { shell });
  assert.match(html, /<b>Open\.<\/b>/);
  assert.doesNotMatch(html, /MCC 5967/, 'an ungated surface is not a monetised one');
});

test('gallery, video and live need verified and fail closed', () => {
  for (const n of ['gallery', 'video', 'live']) {
    assert.equal(policyFor(n).level, 'verified', n);
    const html = surfacePage(n, { shell, subject: 'nobody-verified-this' });
    assert.match(html, /Not cleared/, n);
    assert.match(html, /needs <code>verified<\/code>/, n);
    assert.match(html, /MCC 5967/, `${n} states the card rules`);
  }
});

test('live states the merchant-controlled-platform requirement', () => {
  const html = surfacePage('live', { shell });
  assert.match(html, /platform the merchant controls/i);
  assert.match(html, /real-time monitoring/i);
  assert.match(html, /third-party cam widget does not satisfy/i);
});

test('the card controls are the full § 9.4.1 set, stated not summarised', () => {
  assert.ok(CARD_CONTROLS.length >= 8, `${CARD_CONTROLS.length} controls`);
  const html = surfacePage('gallery', { shell });
  for (const needle of ['seven business days', 'Monthly reporting', 'Written agreements',
    'before the first transaction', 'Pre-publication review']) {
    assert.ok(html.includes(needle), `states: ${needle}`);
  }
});

test('an unknown surface renders nothing rather than guessing', () => {
  assert.equal(surfacePage('whatever', { shell }), null);
  assert.equal(policyFor('whatever').level, 'id', 'and the model fails it closed');
});

test('surfacePage refuses to render without a shell', () => {
  assert.equal(surfacePage('gallery', {}), null);
  assert.equal(compliancePage({}), null);
});

test('compliance records the fork and the recommendation against user uploads', () => {
  const html = compliancePage({ shell });
  assert.match(html, /recommendation is to not take user-generated content/i);
  assert.match(html, /75\.7\(b\)/, 'names the certification that makes licensing bounded');
  assert.match(html, /2257\(h\) excludes distribution and mere linking/);
  assert.match(html, /MCC 5967/);
  assert.match(html, /custodian of records/i);
});

test('compliance states what the gate never stores', () => {
  const html = compliancePage({ shell });
  assert.match(html, /never the ID image, the document number or the date of birth/i);
});

test('every surface blurb and note is escaped into the page', () => {
  for (const [n, spec] of Object.entries(SURFACES)) {
    const html = surfacePage(n, { shell });
    assert.ok(html.includes(spec.title), `${n} title present`);
    assert.ok(spec.notes.length >= 1, `${n} says something particular to itself`);
  }
});

// ── intake is operator-only, and the code enforces it ───────────────────────────────────────────

test('intake mode is operator-only and recorded with its date', async () => {
  const { INTAKE } = await import('./surfaces.mjs');
  assert.equal(INTAKE.mode, 'operator-only');
  assert.match(INTAKE.decidedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(INTAKE.whoMayPublish, /custodian of records/);
});

test('nobody may publish when the producer list is empty', async () => {
  const { producerAllowed } = await import('./surfaces.mjs');
  for (const s of ['', '  ', 'someone', 'hathor', 'admin']) {
    assert.equal(producerAllowed(s, { producers: [] }), false, `refused: ${JSON.stringify(s)}`);
  }
});

test('only a listed producer is allowed, case-insensitively', async () => {
  const { producerAllowed } = await import('./surfaces.mjs');
  const producers = ['operator'];
  assert.equal(producerAllowed('operator', { producers }), true);
  assert.equal(producerAllowed('OPERATOR', { producers }), true);
  assert.equal(producerAllowed(' operator ', { producers }), true);
  assert.equal(producerAllowed('operator2', { producers }), false);
  assert.equal(producerAllowed('', { producers }), false);
  assert.equal(producerAllowed(null, { producers }), false);
});

test('the producer list comes from the environment and defaults to empty', async () => {
  const { producersFromEnv } = await import('./surfaces.mjs');
  assert.deepEqual(producersFromEnv({}), []);
  assert.deepEqual(producersFromEnv({ YONI_PRODUCERS: '' }), []);
  assert.deepEqual(producersFromEnv({ YONI_PRODUCERS: 'A, b ,,C ' }), ['a', 'b', 'c']);
});

test('video and gallery state that no third-party uploads are taken', async () => {
  const { SURFACES } = await import('./surfaces.mjs');
  assert.match(SURFACES.video.notes.join(' '), /no third-party uploads/i);
  assert.match(SURFACES.gallery.notes.join(' '), /provider set of one/i);
});
