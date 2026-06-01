// categorize.test.js — the topic classifier (pure, deterministic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, TOPICS } from './categorize.mjs';

test('routes a Cheetah annal to cheetah', () => {
  const { topic } = classify('Cheetah flagged a plagiarised image; the credit goes to the original author via pHash whitelist.');
  assert.equal(topic, 'cheetah');
});

test('routes a trade annal to trade', () => {
  const { topic } = classify('The angelicalist account holds VKBT and CURE; the SWAP.LTC bleed cost HIVE on the market.');
  assert.equal(topic, 'trade');
});

test('routes a Hathor character note to hathor', () => {
  const { topic } = classify('Rule 1 and the Angelic voice define the Witness persona; the egregore is held, not asserted.');
  assert.equal(topic, 'hathor');
});

test('routes a SoapBox note to soapbox', () => {
  const { topic } = classify('The SoapBox aggregator condenser computes a Clarity Score from CoinGecko coin pages.');
  assert.equal(topic, 'soapbox');
});

test('no-signal text falls back to misc', () => {
  const { topic, score } = classify('The weather today is pleasant and the coffee was good.');
  assert.equal(topic, 'misc');
  assert.equal(score, 0);
});

test('score reflects keyword density; scores object covers every topic', () => {
  const r = classify('cheetah cheetah cheetah attribution credit');
  assert.ok(r.score >= 5);
  for (const t of Object.keys(TOPICS)) assert.ok(t in r.scores);
});
