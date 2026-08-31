// Offline tests for the growth funnel. Pure inputs — no disk, no network, no env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFunnel, collectFunnel, renderFunnelHtml, funnelHandler } from './growth-funnel.mjs';

test('computeFunnel — sums reach, computes stages + conversions', () => {
  const f = computeFunnel({
    reachByCampaign: { 'join-melek': { total: 100 }, 'kula-defi': 40 },
    leads: 20, verifiedLeads: 12, subscribers: 8, signups: 4, invitesOutstanding: 30,
  });
  assert.equal(f.ok, true);
  assert.equal(f.reach, 140);
  assert.equal(f.reachByCampaign['join-melek'], 100);
  assert.equal(f.stages.find((s) => s.key === 'leads').value, 20);
  assert.equal(f.stages.find((s) => s.key === 'leads').ofPrev, 14.3);      // 20/140
  assert.equal(f.conversion.signupsPerReach, 2.9);                          // 4/140
});

test('computeFunnel — empty input is a safe zero funnel (no division-by-zero)', () => {
  const f = computeFunnel({});
  assert.equal(f.reach, 0);
  assert.equal(f.signups, 0);
  assert.equal(f.stages.find((s) => s.key === 'leads').ofPrev, null);       // null, not NaN/0
  assert.equal(f.conversion.signupsPerReach, null);
});

test('computeFunnel — negatives/garbage coerce to 0, never throw', () => {
  const f = computeFunnel({ leads: -5, subscribers: 'x', signups: NaN, reachByCampaign: null });
  assert.equal(f.leads, 0);
  assert.equal(f.subscribers, 0);
  assert.equal(f.signups, 0);
  assert.equal(f.reach, 0);
});

test('collectFunnel — binds live sources; scopes reach to our campaign codes', () => {
  const f = collectFunnel({
    scanStats: () => ({ 'join-melek': { total: 50 }, 'unrelated-qr': { total: 999 } }),
    leadPipeline: () => ({ new: 5, contacted: 3 }),
    verifiedLeads: () => 4,
    senderStats: () => ({ subscribers: 6 }),
    inviteStats: () => ({ registeredAccounts: 2, invitesOutstanding: 18, invitesRedeemed: 2 }),
    campaignCodes: ['join-melek', 'kula-defi'],
    now: () => 123,
  });
  assert.equal(f.reach, 50, 'unrelated /go code excluded');
  assert.equal(f.reachByCampaign['kula-defi'], 0, 'our zero-click campaign still listed');
  assert.equal(f.reachByCampaign['unrelated-qr'], undefined);
  assert.equal(f.leads, 8);
  assert.equal(f.subscribers, 6);
  assert.equal(f.signups, 2);
  assert.equal(f.invitesOutstanding, 18);
  assert.equal(f.generatedAt, 123);
});

test('collectFunnel — a dead source degrades to 0, does not throw', () => {
  const f = collectFunnel({
    scanStats: () => { throw new Error('boom'); },
    senderStats: () => { throw new Error('boom'); },
  });
  assert.equal(f.ok, true);
  assert.equal(f.reach, 0);
  assert.equal(f.subscribers, 0);
});

test('renderFunnelHtml — escapes + renders stages, never throws', () => {
  const html = renderFunnelHtml(computeFunnel({ reachByCampaign: { 'join-melek': 10 }, leads: 3, signups: 1, invitesOutstanding: 5 }));
  assert.match(html, /Reach/);
  assert.match(html, /join-melek/);
  assert.doesNotThrow(() => renderFunnelHtml(null));
});

test('funnelHandler — returns JSON funnel', async () => {
  const handler = funnelHandler({ senderStats: () => ({ subscribers: 3 }) });
  let code = 0; let body = '';
  const res = { writeHead: (c) => { code = c; }, end: (b) => { body = b || ''; } };
  await handler({ method: 'GET', url: '/api/funnel' }, res);
  assert.equal(code, 200);
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.equal(j.subscribers, 3);
});
