// pentecaust/herald/flows.test.mjs — offline + deterministic. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlows, memStorage, handler } from './flows.mjs';

// A fixed clock so every run timestamp is reproducible.
const fixedNow = () => 1000;

function seed() {
  const flows = createFlows({ now: fixedNow });
  flows.defineFlow({
    id: 'lead->campaign',
    name: 'Onboard a verified lead',
    trigger: 'lead.verified',
    steps: [
      { action: 'lead-crm.move', params: { leadId: '{{event.leadId}}', stage: 'onboarding' } },
      { action: 'campaign.advance', params: { lead: '{{prev.leadId}}', campaign: '{{event.campaignId}}' } },
      { action: 'crossposter.post', params: { note: 'welcome {{prev.lead}} to {{prev.campaign}}' } },
    ],
  });
  return flows;
}

test('defineFlow validates and stores a good flow', () => {
  const flows = createFlows({ now: fixedNow });
  const r = flows.defineFlow({ id: 'f1', name: 'F1', trigger: 'e', steps: [{ action: 'analytics.track' }] });
  assert.equal(r.ok, true);
  assert.equal(r.flow.id, 'f1');
  assert.equal(r.flow.enabled, true);
  assert.equal(r.flow.definedAt, 1000);
  assert.equal(r.flow.steps[0].action, 'analytics.track');
  assert.deepEqual(r.flow.steps[0].params, {}); // default params
  assert.equal(flows.listFlows().length, 1);
});

test('defineFlow soft-fails (never throws) on bad shape', () => {
  const flows = createFlows({ now: fixedNow });
  for (const bad of [
    null,
    'nope',
    { id: '', trigger: 'e', steps: [{ action: 'a' }] },        // no id
    { id: 'x', trigger: '', steps: [{ action: 'a' }] },        // no trigger
    { id: 'x', trigger: 'e', steps: [] },                      // empty steps
    { id: 'x', trigger: 'e', steps: 'no' },                    // steps not array
    { id: 'x', trigger: 'e', steps: [{ action: '' }] },        // step no action
    { id: 'x', trigger: 'e', steps: [{ action: 'a', params: 7 }] }, // bad params
  ]) {
    const r = flows.defineFlow(bad);
    assert.equal(r.ok, false);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(flows.listFlows().length, 0); // nothing stored
});

test('run resolves {{event.x}} + {{prev.y}} deterministically, ordered planned actions', () => {
  const flows = seed();
  const r = flows.run('lead->campaign', { leadId: 'L1', campaignId: 'welcome' });
  assert.equal(r.ok, true);
  assert.equal(r.dispatched, false); // no executors → pure plan
  assert.equal(r.actions.length, 3);

  // ordered by step index
  assert.deepEqual(r.actions.map((a) => a.step), [0, 1, 2]);
  assert.deepEqual(r.actions.map((a) => a.action),
    ['lead-crm.move', 'campaign.advance', 'crossposter.post']);

  // step 0: {{event.leadId}} resolved, static kept
  assert.deepEqual(r.actions[0].params, { leadId: 'L1', stage: 'onboarding' });
  assert.deepEqual(r.actions[0].resolvedFrom, { leadId: 'event.leadId' });

  // step 1: {{prev.leadId}} chains from step 0 output; {{event.campaignId}} from event
  assert.deepEqual(r.actions[1].params, { lead: 'L1', campaign: 'welcome' });
  assert.deepEqual(r.actions[1].resolvedFrom, { lead: 'prev.leadId', campaign: 'event.campaignId' });

  // step 2: embedded refs inside a larger string, both from prev (step 1 output)
  assert.equal(r.actions[2].params.note, 'welcome L1 to welcome');

  // determinism: identical event → identical plan
  const r2 = flows.run('lead->campaign', { leadId: 'L1', campaignId: 'welcome' });
  assert.deepEqual(r2.actions, r.actions);
});

test('run soft-fails on unknown flow', () => {
  const flows = seed();
  const r = flows.run('nope', {});
  assert.equal(r.ok, false);
  assert.deepEqual(r.actions, []);
});

test('missing refs resolve to empty string (never undefined)', () => {
  const flows = createFlows({ now: fixedNow });
  flows.defineFlow({ id: 'm', trigger: 'e', steps: [{ action: 'a', params: { x: '{{event.nope}}' } }] });
  const r = flows.run('m', {});
  assert.equal(r.actions[0].params.x, '');
});

test('trigger runs only enabled flows with the matching trigger', () => {
  const flows = createFlows({ now: fixedNow });
  flows.defineFlow({ id: 'a', trigger: 'evt.x', steps: [{ action: 'analytics.track' }] });
  flows.defineFlow({ id: 'b', trigger: 'evt.x', steps: [{ action: 'campaign.advance' }] });
  flows.defineFlow({ id: 'c', trigger: 'evt.other', steps: [{ action: 'analytics.track' }] });

  const r = flows.trigger('evt.x', { hi: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.deepEqual(r.ran.map((x) => x.flowId).sort(), ['a', 'b']);

  // disable one → only the other fires
  flows.disableFlow('a');
  const r2 = flows.trigger('evt.x', {});
  assert.deepEqual(r2.ran.map((x) => x.flowId), ['b']);

  // no matching trigger → empty
  assert.equal(flows.trigger('evt.none', {}).count, 0);
});

test('injected executors are called and feed {{prev.*}}', () => {
  const flows = createFlows({ now: fixedNow });
  flows.defineFlow({
    id: 'exec',
    trigger: 'go',
    steps: [
      { action: 'lead-crm.move', params: { leadId: '{{event.id}}' } },
      { action: 'crossposter.post', params: { ref: '{{prev.crmId}}' } },
    ],
  });
  const calls = [];
  const executors = {
    'lead-crm.move': (params, ctx) => { calls.push(['move', params, ctx.step]); return { crmId: 'CRM-' + params.leadId }; },
    'crossposter.post': (params) => { calls.push(['post', params]); return { posted: true }; },
  };
  const r = flows.run('exec', { id: '9' }, { executors });
  assert.equal(r.ok, true);
  assert.equal(r.dispatched, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['move', { leadId: '9' }, 0]);
  // second step's {{prev.crmId}} came from the FIRST executor's return, not the resolved params
  assert.deepEqual(r.actions[1].params, { ref: 'CRM-9' });
});

test('a throwing executor soft-fails without breaking the plan', () => {
  const flows = createFlows({ now: fixedNow });
  flows.defineFlow({ id: 't', trigger: 'go', steps: [
    { action: 'boom', params: { a: '{{event.a}}' } },
    { action: 'next', params: { b: 1 } },
  ] });
  const r = flows.run('t', { a: 'x' }, { executors: { boom: () => { throw new Error('nope'); } } });
  assert.equal(r.ok, true);
  assert.equal(r.actions.length, 2);
  assert.deepEqual(r.actions[0].params, { a: 'x' }); // still planned
});

test('history records runs and filters by flowId', () => {
  const flows = seed();
  flows.defineFlow({ id: 'other', trigger: 'lead.verified', steps: [{ action: 'analytics.track' }] });
  flows.run('lead->campaign', { leadId: 'L1' });
  flows.trigger('lead.verified', { leadId: 'L2' }); // runs both flows

  const all = flows.history();
  assert.equal(all.length, 3);
  assert.ok(all.every((h) => h.at === 1000)); // injected clock

  const only = flows.history({ flowId: 'lead->campaign' });
  assert.equal(only.length, 2);
  assert.ok(only.every((h) => h.flowId === 'lead->campaign'));
});

test('disable/enable toggles the enabled flag', () => {
  const flows = createFlows({ now: fixedNow });
  flows.defineFlow({ id: 'x', trigger: 'e', steps: [{ action: 'a' }] });
  assert.equal(flows.getFlow('x').enabled, true);
  assert.equal(flows.disableFlow('x').flow.enabled, false);
  assert.equal(flows.getFlow('x').enabled, false);
  assert.equal(flows.enableFlow('x').flow.enabled, true);
  assert.equal(flows.disableFlow('missing').ok, false); // soft-fail on unknown
});

test('injectable storage: caller store receives flows + runs', () => {
  const store = memStorage();
  const flows = createFlows({ storage: store, now: fixedNow });
  flows.defineFlow({ id: 's', trigger: 'e', steps: [{ action: 'a' }] });
  flows.run('s', {});
  assert.equal(store.allFlows().length, 1);
  assert.equal(store.listRuns().length, 1);
});

test('handler soft-fails and serves the planner surface (offline)', async () => {
  const mk = () => {
    const res = { code: 0, headers: {}, body: '' };
    res.writeHead = (c, h) => { res.code = c; res.headers = h || {}; };
    res.end = (b) => { res.body = b; };
    return res;
  };

  let res = mk();
  await handler({ url: '/health', method: 'GET' }, res);
  assert.deepEqual(JSON.parse(res.body), { ok: true, service: 'herald-flows' });

  res = mk();
  await handler({ url: '/api/flows', method: 'POST', body: { id: 'h1', trigger: 'e', steps: [{ action: 'a' }] } }, res);
  assert.equal(JSON.parse(res.body).ok, true);

  res = mk();
  await handler({ url: '/api/trigger', method: 'POST', body: { event: 'e', payload: {} } }, res);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.equal(out.count, 1);

  res = mk();
  await handler({ url: '/nope', method: 'GET' }, res);
  assert.equal(JSON.parse(res.body).ok, false);
});
