// prana-seed.test.mjs — OFFLINE. Call descriptors + injected reads for the raffle/casino interface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.SEED_RAFFLE_ADDRESS = '0x' + 'ra'.repeat(20);
const { buyTicketCall, drawCall, approveCall, readState, __setReader } = await import('./prana-seed.mjs');

const RAFFLE = '0x' + 'ra'.repeat(20);

test('buyTicket / draw / approve build the right calls', () => {
  const b = buyTicketCall(3);
  assert.equal(b.fn, 'buyTicket'); assert.equal(b.contract, RAFFLE); assert.deepEqual(b.args, [3n]);
  assert.throws(() => buyTicketCall(0));
  assert.equal(drawCall().fn, 'draw');
  const a = approveCall('0x' + 'cc'.repeat(20), 1000);
  assert.equal(a.fn, 'approve'); assert.equal(a.contract, '0x' + 'cc'.repeat(20));
  assert.deepEqual(a.args, [RAFFLE, 1000n]);   // approve the raffle to pull the buy-in
});

test('readState assembles the round + computes drawable from headBlock', async () => {
  __setReader(async (fn) => ({ ticketPrice: 5n, ticketCount: 12n, prizePool: 60n, drawBlock: 100n }[fn]));
  const s = await readState({ headBlock: 101 });
  assert.equal(s.ticketPrice, 5n); assert.equal(s.ticketsSold, 12n); assert.equal(s.prizePool, 60n);
  assert.equal(s.drawBlock, 100n); assert.equal(s.drawable, true);
  const s2 = await readState({ headBlock: 99 });
  assert.equal(s2.drawable, false);   // not past the draw block yet
  __setReader(null);
  assert.equal((await readState()).ticketPrice, null);   // no reader → soft-null
});
