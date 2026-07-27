// crm/builder.test.mjs — OFFLINE. Injected LLM (and the no-LLM template path). Covers: LLM plan parsing,
// deterministic fallback, facts-only opener (signal-grounded, no fabrication), merge-field render, and the
// deliverability guardrail (spammy words scrubbed). Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignPlan, personalizeOpener, renderStep, __setLLM } from './builder.mjs';

test('buildCampaignPlan: no LLM → a real 3-touch template plan', async () => {
  __setLLM(null);
  const plan = await buildCampaignPlan({ goal: 'book demos', valueProp: 'AI onboarding for MELEK' });
  assert.equal(plan.source, 'template');
  assert.equal(plan.sequence.length, 3);
  assert.deepEqual(plan.sequence.map((s) => s.delayDays), [0, 3, 7]);
  assert.ok(plan.sequence[0].body.includes('{{first_name}}'), 'uses merge fields');
  assert.ok(plan.icp.valueProp.includes('AI onboarding'));
});

test('buildCampaignPlan: LLM JSON (even fenced/prose-wrapped) is parsed into the schema', async () => {
  __setLLM(async () => '```json\n' + JSON.stringify({
    icp: { titles: ['Head of Growth'], industries: ['SaaS'], keywords: ['hiring SDRs'], valueProp: 'v' },
    angle: 'You are scaling outbound',
    sequence: [{ channel: 'email', delayDays: 0, subject: 'Hi {{first_name}}', body: 'About {{company}}' }],
  }) + '\n```');
  const plan = await buildCampaignPlan({ goal: 'x' });
  assert.equal(plan.source, 'llm');
  assert.deepEqual(plan.icp.titles, ['Head of Growth']);
  assert.equal(plan.sequence[0].subject, 'Hi {{first_name}}');
  __setLLM(null);
});

test('buildCampaignPlan: broken LLM output falls back, never throws', async () => {
  __setLLM(async () => 'sorry I cannot help with that');
  const plan = await buildCampaignPlan({ goal: 'x', valueProp: 'thing' });
  assert.equal(plan.source, 'template');
  assert.equal(plan.sequence.length, 3);
  __setLLM(async () => { throw new Error('llm down'); });
  const plan2 = await buildCampaignPlan({ goal: 'x' });
  assert.equal(plan2.source, 'template', 'a throwing LLM still yields a plan');
  __setLLM(null);
});

test('guardrail: spammy words are scrubbed from copy (deliverability)', async () => {
  __setLLM(async () => JSON.stringify({
    angle: 'Act now for a FREE guaranteed win!!!',
    sequence: [{ channel: 'email', delayDays: 0, subject: 'FREE demo', body: 'risk-free guarantee, buy now' }],
  }));
  const plan = await buildCampaignPlan({ goal: 'x' });
  assert.doesNotMatch(plan.angle, /\bFREE\b|guaranteed|Act now|!!!/i);
  assert.doesNotMatch(plan.sequence[0].subject, /FREE/i);
  assert.doesNotMatch(plan.sequence[0].body, /risk-?free|guarantee|buy now/i);
  __setLLM(null);
});

test('personalizeOpener: grounds in the signal only; honest generic when no signal', async () => {
  __setLLM(null);
  const withSignal = await personalizeOpener({ name: 'Jane Roe', company: 'Acme', signal: 'just raised a Series A' });
  assert.ok(withSignal.includes('Series A'), 'uses the verified signal');
  assert.ok(withSignal.length <= 200);
  const noSignal = await personalizeOpener({ name: 'John Doe' }, { angle: 'onboarding help' });
  assert.ok(/John/.test(noSignal), 'still addresses them');
  assert.doesNotMatch(noSignal, /Series A/, 'invents no fact when there is no signal');
});

test('personalizeOpener: LLM line is used + capped + scrubbed', async () => {
  __setLLM(async () => 'Saw you are hiring 5 SDRs — congrats!!! act now');
  const line = await personalizeOpener({ name: 'Jane', company: 'Acme', signal: 'hiring 5 SDRs' });
  assert.doesNotMatch(line, /!!!|act now/i, 'scrubbed');
  assert.ok(line.length <= 200);
  __setLLM(null);
});

test('renderStep: merge fields substituted from the lead at send time', () => {
  const step = { channel: 'email', delayDays: 0, subject: 'Hi {{first_name}}', body: '{{name}} at {{company}} ({{title}})' };
  const out = renderStep(step, { name: 'Jane Roe', company: 'Acme', title: 'CTO' });
  assert.equal(out.subject, 'Hi Jane');
  assert.equal(out.body, 'Jane Roe at Acme (CTO)');
  // missing lead fields → safe defaults, no leftover {{...}}
  const out2 = renderStep(step, {});
  assert.doesNotMatch(out2.body, /\{\{/);
});
