// smart-home.test.mjs — OFFLINE. Verifies the HA bridge builds correct requests with an injected
// fetch, that the capability token is USED (Authorization header) but NEVER returned or logged, that
// the control verbs map to the right domain/service, and that everything soft-fails without a token.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  __setFetch, callService, states, turnOn, turnOff, setScene, armCameras,
} from './smart-home.mjs';

// Build a fake fetch that records every request and returns a canned response.
function recorder({ ok = true, status = 200, json = {} } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok, status, json: async () => json };
  };
  return { fn, calls };
}

const TOKEN = 'llat_super_secret_capability_grant_xyz';
const OPTS = { token: TOKEN, baseUrl: 'http://ha.test:8123' };

test('callService builds the correct HA service POST with the injected fetch', async () => {
  const rec = recorder({ json: [{ entity_id: 'light.kitchen', state: 'on' }] });
  __setFetch(rec.fn);

  const res = await callService({ domain: 'light', service: 'turn_on', data: { entity_id: 'light.kitchen' } }, OPTS);

  assert.equal(res.ok, true);
  assert.equal(res.status, 200);
  assert.equal(rec.calls.length, 1);
  const { url, opts } = rec.calls[0];
  assert.equal(url, 'http://ha.test:8123/api/services/light/turn_on');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(opts.body), { entity_id: 'light.kitchen' });
  __setFetch(null);
});

test('the token is used in the Authorization header but NEVER returned or in the result', async () => {
  const rec = recorder();
  __setFetch(rec.fn);

  const res = await callService({ domain: 'light', service: 'turn_on' }, OPTS);

  // Used: Bearer header carries the grant.
  assert.equal(rec.calls[0].opts.headers.authorization, `Bearer ${TOKEN}`);
  // Never returned: the token must not appear anywhere in the serialized result.
  assert.equal(JSON.stringify(res).includes(TOKEN), false, 'token must not leak into the return value');
  __setFetch(null);
});

test('a token-getter function is accepted (capability injected, not held raw)', async () => {
  const rec = recorder();
  __setFetch(rec.fn);

  const res = await callService(
    { domain: 'switch', service: 'turn_off' },
    { token: async () => TOKEN, baseUrl: 'http://ha.test:8123' },
  );

  assert.equal(res.ok, true);
  assert.equal(rec.calls[0].opts.headers.authorization, `Bearer ${TOKEN}`);
  __setFetch(null);
});

test('states() reads entity states via GET /api/states', async () => {
  const entities = [{ entity_id: 'light.kitchen', state: 'on' }, { entity_id: 'lock.front', state: 'locked' }];
  const rec = recorder({ json: entities });
  __setFetch(rec.fn);

  const res = await states(OPTS);

  assert.equal(res.ok, true);
  assert.equal(rec.calls[0].url, 'http://ha.test:8123/api/states');
  assert.equal(rec.calls[0].opts.method, 'GET');
  assert.equal(rec.calls[0].opts.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(res.states, entities);
  __setFetch(null);
});

test('turnOn / turnOff map to the right domain + service from the entity_id', async () => {
  const rec = recorder();
  __setFetch(rec.fn);

  await turnOn('light.kitchen', OPTS);
  await turnOff('switch.fan', OPTS);

  assert.equal(rec.calls[0].url, 'http://ha.test:8123/api/services/light/turn_on');
  assert.deepEqual(JSON.parse(rec.calls[0].opts.body), { entity_id: 'light.kitchen' });
  assert.equal(rec.calls[1].url, 'http://ha.test:8123/api/services/switch/turn_off');
  assert.deepEqual(JSON.parse(rec.calls[1].opts.body), { entity_id: 'switch.fan' });
  __setFetch(null);
});

test('setScene maps a bare name and a full entity_id to scene.turn_on', async () => {
  const rec = recorder();
  __setFetch(rec.fn);

  await setScene('movie_night', OPTS);
  await setScene('scene.bedtime', OPTS);

  assert.equal(rec.calls[0].url, 'http://ha.test:8123/api/services/scene/turn_on');
  assert.deepEqual(JSON.parse(rec.calls[0].opts.body), { entity_id: 'scene.movie_night' });
  assert.deepEqual(JSON.parse(rec.calls[1].opts.body), { entity_id: 'scene.bedtime' }, 'no double scene. prefix');
  __setFetch(null);
});

test('armCameras maps to alarm_control_panel.alarm_arm_away', async () => {
  const rec = recorder();
  __setFetch(rec.fn);

  await armCameras(OPTS);

  assert.equal(rec.calls[0].url, 'http://ha.test:8123/api/services/alarm_control_panel/alarm_arm_away');
  assert.deepEqual(JSON.parse(rec.calls[0].opts.body), { entity_id: 'alarm_control_panel.home' });
  __setFetch(null);
});

test('soft-fail without a token: returns {ok:false}, never throws, no fetch', async () => {
  const rec = recorder();
  __setFetch(rec.fn);

  const a = await callService({ domain: 'light', service: 'turn_on' }, {});
  const b = await states({});
  const c = await turnOn('light.kitchen', {});

  assert.equal(a.ok, false);
  assert.equal(b.ok, false);
  assert.equal(c.ok, false);
  assert.equal(rec.calls.length, 0, 'no request attempted without a capability grant');
  __setFetch(null);
});

test('soft-fail on a thrown fetch and on non-ok status (never throws, never leaks token)', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const thrown = await callService({ domain: 'light', service: 'turn_on' }, OPTS);
  assert.equal(thrown.ok, false);
  assert.equal(JSON.stringify(thrown).includes(TOKEN), false);

  __setFetch(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const bad = await states(OPTS);
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 401);
  __setFetch(null);
});
