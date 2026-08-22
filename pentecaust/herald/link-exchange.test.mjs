// pentecaust/herald/link-exchange.test.mjs — offline, deterministic tests for the Herald backlink exchange.
// node --test. No network, no disk: an in-memory storage object + an injectable, advanceable clock.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLinkExchange, normDomain } from './link-exchange.mjs';

// A mutable clock helper so tests can "advance time" to exercise the rotation gap deterministically.
function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
}

const fresh = (over = {}) => {
  const clk = makeClock();
  const ex = createLinkExchange({ storage: {}, now: clk.now, minGapMs: 1000, ...over });
  return { ex, clk };
};

test('addMember registers, normalises, and soft-fails on bad/dupe input', () => {
  const { ex } = fresh();
  const a = ex.addMember({ domain: 'HTTPS://WWW.Alpha.com/path', url: 'https://alpha.com' });
  assert.equal(a.ok, true);
  assert.equal(a.member.domain, 'alpha.com'); // scheme/www/path stripped, lowercased

  // bad input returns a shaped failure, never throws
  assert.equal(ex.addMember({}).ok, false);
  assert.equal(ex.addMember({ domain: 'not a domain' }).ok, false);
  assert.equal(ex.addMember({ domain: 'nodot' }).ok, false);

  // duplicate member rejected
  assert.equal(ex.addMember({ domain: 'alpha.com' }).ok, false);

  // default url derived from domain when omitted
  const b = ex.addMember({ domain: 'beta.io' });
  assert.equal(b.member.url, 'https://beta.io');
  assert.equal(ex.members().length, 2);
});

test('matchPairs produces valid, non-self, non-dupe ordered pairs', () => {
  const { ex } = fresh();
  for (const d of ['a.com', 'b.com', 'c.com', 'd.com']) ex.addMember({ domain: d });
  const pairs = ex.matchPairs();
  assert.ok(pairs.length > 0);
  const used = new Set();
  for (const p of pairs) {
    assert.notEqual(p.from, p.to);                 // no self-pairing
    assert.ok(ex.memberStats(p.from).ok);          // both are real members
    assert.ok(ex.memberStats(p.to).ok);
    assert.equal(used.has(p.from), false);         // each member at most once per round
    assert.equal(used.has(p.to), false);
    used.add(p.from); used.add(p.to);
  }
  // deterministic: same inputs → identical output
  assert.deepEqual(ex.matchPairs(), pairs);
});

test('dupe control blocks repeating the same ordered (from,to) pairing', () => {
  const { ex, clk } = fresh();
  for (const d of ['a.com', 'b.com']) ex.addMember({ domain: d });

  const first = ex.matchPairs();
  assert.equal(first.length, 1);
  const { from, to } = first[0];

  const rec = ex.recordPlacement({ from, to, at: clk.now() });
  assert.equal(rec.ok, true);

  // recording the identical ordered pair again is refused (one-to-one dupe control at the log)
  assert.equal(ex.recordPlacement({ from, to, at: clk.now() }).ok, false);

  // advance well past the gap so rotation is not what blocks the re-match
  clk.advance(10_000);
  const next = ex.matchPairs();
  // the already-placed ordered pair must not reappear; only the reverse (to→from) may
  for (const p of next) assert.notEqual(`${p.from} ${p.to}`, `${from} ${to}`);
  if (next.length) assert.deepEqual(next[0], { from: to, to: from, at: clk.now() });
});

test('rotation gap blocks a too-soon second pairing until the clock advances', () => {
  const { ex, clk } = fresh({ minGapMs: 1000 });
  for (const d of ['a.com', 'b.com', 'c.com', 'd.com']) ex.addMember({ domain: d });

  // Place one link a↔ pairing now; both endpoints go on cooldown.
  const p0 = ex.matchPairs()[0];
  ex.recordPlacement({ from: p0.from, to: p0.to, at: clk.now() });

  // Immediately after: the two cooled members cannot take a new pairing this tick.
  const soon = ex.matchPairs();
  const cooled = new Set([p0.from, p0.to]);
  for (const p of soon) {
    assert.equal(cooled.has(p.from), false);
    assert.equal(cooled.has(p.to), false);
  }

  // Advance past minGapMs → the cooled members become eligible again.
  clk.advance(1000);
  const later = ex.matchPairs();
  const seen = new Set();
  for (const p of later) { seen.add(p.from); seen.add(p.to); }
  assert.ok(seen.has(p0.from) || seen.has(p0.to));
});

test('fair distribution prefers the least-linked members', () => {
  const { ex, clk } = fresh({ minGapMs: 0 }); // isolate fairness from rotation
  for (const d of ['a.com', 'b.com', 'c.com', 'd.com']) ex.addMember({ domain: d });

  // Give a.com and b.com a head start of links so they are the "most-linked".
  ex.recordPlacement({ from: 'a.com', to: 'c.com', at: clk.now() });
  ex.recordPlacement({ from: 'b.com', to: 'd.com', at: clk.now() });
  // now c.com and d.com each have 1, a.com/b.com each have 1 too... give a.com one more so it leads.
  ex.recordPlacement({ from: 'a.com', to: 'd.com', at: clk.now() });
  // counts: a=2, b=1, c=1, d=2  → least-linked are b and c; matcher should pair those first.

  const pairs = ex.matchPairs();
  assert.ok(pairs.length > 0);
  // The very first pair's `from` is the least-linked, earliest-alphabetical eligible member: b.com.
  assert.equal(pairs[0].from, 'b.com');
});

test('memberStats and history are correct and ordered', () => {
  const { ex } = fresh();
  for (const d of ['a.com', 'b.com', 'c.com']) ex.addMember({ domain: d });

  ex.recordPlacement({ from: 'a.com', to: 'b.com', at: 100 });
  ex.recordPlacement({ from: 'c.com', to: 'a.com', at: 300 });
  ex.recordPlacement({ from: 'a.com', to: 'c.com', at: 200 });

  const a = ex.memberStats('a.com');
  assert.equal(a.ok, true);
  assert.equal(a.given, 2);       // a→b, a→c
  assert.equal(a.received, 1);    // c→a
  assert.equal(a.total, 3);
  assert.equal(a.lastPlacement.at, 300); // most recent touching a.com

  // history for a domain: only placements involving it, sorted by time ascending
  const hist = ex.history({ domain: 'a.com' });
  assert.deepEqual(hist.map((p) => p.at), [100, 200, 300]);

  // full history sorted too
  assert.deepEqual(ex.history().map((p) => p.at), [100, 200, 300]);

  // unknown member soft-fails
  assert.equal(ex.memberStats('zzz.com').ok, false);
  assert.deepEqual(ex.history({ domain: 'zzz.com' }), []);
});

test('recordPlacement soft-fails on self/unknown/bad input, never throws', () => {
  const { ex } = fresh();
  ex.addMember({ domain: 'a.com' });
  assert.equal(ex.recordPlacement({ from: 'a.com', to: 'a.com' }).ok, false); // self
  assert.equal(ex.recordPlacement({ from: 'a.com', to: 'ghost.com' }).ok, false); // unknown
  assert.equal(ex.recordPlacement({}).ok, false); // missing
});

test('pendingFor returns only pairs touching the domain; normDomain is exported', () => {
  const { ex } = fresh();
  for (const d of ['a.com', 'b.com', 'c.com', 'd.com']) ex.addMember({ domain: d });
  const pend = ex.pendingFor('a.com');
  for (const p of pend) assert.ok(p.from === 'a.com' || p.to === 'a.com');
  assert.deepEqual(ex.pendingFor('zzz.com'), []);
  assert.equal(normDomain('HTTPS://WWW.X.COM/y'), 'x.com');
});
