import { test } from 'node:test';
import assert from 'node:assert';
import {
  Registry,
  uptimeCheck,
  healthSummary,
  recordUptime,
  DEFAULT_BUCKETS,
} from './infra-metrics.mjs';

test('counter increments and renders', () => {
  const reg = new Registry();
  reg.counter('blocks_produced_total', { role: 'witness' }).inc();
  reg.counter('blocks_produced_total', { role: 'witness' }).inc(4);
  const out = reg.renderProm();
  assert.match(out, /blocks_produced_total\{role="witness"\} 5/);
});

test('counter cannot decrease', () => {
  const reg = new Registry();
  assert.throws(() => reg.counter('c').inc(-1), /cannot decrease/);
});

test('gauge set/inc/dec', () => {
  const reg = new Registry();
  reg.gauge('peers', { node: 'a' }).set(10);
  reg.gauge('peers', { node: 'a' }).dec(2);
  reg.gauge('peers', { node: 'a' }).inc(1);
  const out = reg.renderProm();
  assert.match(out, /peers\{node="a"\} 9/);
});

test('same labels in any order map to one series', () => {
  const reg = new Registry();
  reg.counter('reqs', { a: '1', b: '2' }).inc();
  reg.counter('reqs', { b: '2', a: '1' }).inc();
  const out = reg.renderProm();
  const matches = out.match(/^reqs\{/gm) || [];
  assert.equal(matches.length, 1, 'one series, not two');
  assert.match(out, /reqs\{a="1",b="2"\} 2/);
});

test('histogram records buckets, sum, count cumulatively', () => {
  const reg = new Registry();
  const h = reg.histogram('rpc_latency_seconds', {}, { buckets: [0.1, 0.5, 1] });
  [0.05, 0.2, 0.2, 2].forEach((v) => h.observe(v));
  const out = reg.renderProm();
  // cumulative: le=0.1 -> 1 (the 0.05); le=0.5 -> 3 (+two 0.2s); le=1 -> 3; le=+Inf -> 4 (+the 2)
  assert.match(out, /rpc_latency_seconds_bucket\{le="0\.1"\} 1/);
  assert.match(out, /rpc_latency_seconds_bucket\{le="0\.5"\} 3/);
  assert.match(out, /rpc_latency_seconds_bucket\{le="1"\} 3/);
  assert.match(out, /rpc_latency_seconds_bucket\{le="\+Inf"\} 4/);
  assert.match(out, /rpc_latency_seconds_sum 2\.45/);
  assert.match(out, /rpc_latency_seconds_count 4/);
});

test('renderProm emits valid HELP and TYPE lines', () => {
  const reg = new Registry();
  reg.counter('blocks_produced_total', {}, 'blocks produced by the witness').inc();
  reg.gauge('peers', {}, 'connected peers').set(3);
  reg.histogram('lat', {}, { help: 'latency' }).observe(0.1);
  const out = reg.renderProm();
  assert.match(out, /^# HELP blocks_produced_total blocks produced by the witness$/m);
  assert.match(out, /^# TYPE blocks_produced_total counter$/m);
  assert.match(out, /^# HELP peers connected peers$/m);
  assert.match(out, /^# TYPE peers gauge$/m);
  assert.match(out, /^# TYPE lat histogram$/m);
  assert.ok(out.endsWith('\n'), 'trailing newline');
});

test('label values are escaped', () => {
  const reg = new Registry();
  reg.gauge('g', { msg: 'a"b\\c' }).set(1);
  const out = reg.renderProm();
  assert.match(out, /g\{msg="a\\"b\\\\c"\} 1/);
});

test('invalid metric names and labels are rejected', () => {
  const reg = new Registry();
  assert.throws(() => reg.counter('bad-name'), /invalid metric name/);
  assert.throws(() => reg.counter('ok', { 'bad-label': 'x' }), /invalid label name/);
});

test('re-registering a name with a different type throws', () => {
  const reg = new Registry();
  reg.counter('x').inc();
  assert.throws(() => reg.gauge('x'), /already registered/);
});

test('DEFAULT_BUCKETS is a sorted ascending list', () => {
  for (let i = 1; i < DEFAULT_BUCKETS.length; i++) {
    assert.ok(DEFAULT_BUCKETS[i] > DEFAULT_BUCKETS[i - 1]);
  }
});

test('uptimeCheck marks up from injected fetch', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200 });
  const res = await uptimeCheck([{ name: 'rpc-1', url: 'https://secret.host/health' }], { fetch: fakeFetch });
  assert.equal(res.length, 1);
  assert.equal(res[0].up, true);
  assert.equal(res[0].status, 200);
  assert.equal(res[0].name, 'rpc-1');
  assert.equal(typeof res[0].latencyMs, 'number');
});

test('uptimeCheck marks down on non-ok status', async () => {
  const fakeFetch = async () => ({ ok: false, status: 503 });
  const res = await uptimeCheck([{ name: 'node', url: 'http://x/y' }], { fetch: fakeFetch });
  assert.equal(res[0].up, false);
  assert.equal(res[0].status, 503);
});

test('uptimeCheck soft-fails (never throws) when fetch rejects', async () => {
  const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
  const res = await uptimeCheck([{ name: 'down', url: 'http://x' }], { fetch: fakeFetch });
  assert.equal(res[0].up, false);
  assert.equal(res[0].status, 0);
  assert.match(res[0].error, /ECONNREFUSED/);
});

test('uptimeCheck never leaks host/url into the result label key (only name)', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200 });
  const res = await uptimeCheck([{ name: 'generic', url: 'https://10.0.0.5:8090/secret' }], { fetch: fakeFetch });
  assert.equal(res[0].url, undefined, 'url not echoed into result');
  assert.equal(res[0].name, 'generic');
});

test('recordUptime writes generic gauges with no host labels', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200 });
  const res = await uptimeCheck([{ name: 'rpc-1', url: 'https://10.0.0.5/x' }], { fetch: fakeFetch });
  const reg = new Registry();
  recordUptime(reg, res);
  const out = reg.renderProm();
  assert.match(out, /uptime_up\{target="rpc-1"\} 1/);
  assert.match(out, /uptime_latency_ms\{target="rpc-1"\}/);
  assert.doesNotMatch(out, /10\.0\.0\.5/, 'no host/IP anywhere in exposition');
});

test('healthSummary rolls up up/down/degraded', () => {
  assert.equal(healthSummary([]).status, 'unknown');
  assert.equal(healthSummary([{ name: 'a', up: true, latencyMs: 10 }]).status, 'ok');
  assert.equal(healthSummary([{ name: 'a', up: false, latencyMs: 0 }]).status, 'down');
  const mixed = healthSummary([
    { name: 'a', up: true, latencyMs: 10 },
    { name: 'b', up: false, latencyMs: 0 },
  ]);
  assert.equal(mixed.status, 'degraded');
  assert.equal(mixed.total, 2);
  assert.equal(mixed.up, 1);
  assert.equal(mixed.down, 1);
  assert.equal(mixed.avgLatencyMs, 10, 'averages only reachable targets');
});
