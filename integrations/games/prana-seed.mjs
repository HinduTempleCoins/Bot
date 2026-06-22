// prana-seed.mjs — interface to the SEED GAME (PRANA CommitRevealRaffle). A ticketed raffle whose winning
// ticket is drawn from a FUTURE blockhash — the seed nobody can predict or grind (commit-reveal fairness).
// Players buy tickets at a fixed ERC-20 price; after the draw block, anyone calls draw() and the prize pool
// pays the winning ticket. This is the canonical "Token Casino" primitive; the same shape generalizes to
// the gacha/oracle-draw seed games (swap the address + the action verbs).
//
// KEY CUSTODY: signs nothing, holds no key, no network. Call descriptors = { contract, fn, args } for the
// edge to submit; reads via __setReader. Soft-fail-never-throw.
//
//   import { buyTicketCall, drawCall, approveCall, readState, __setReader } from './prana-seed.mjs'

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const RAFFLE_ADDRESS = () => String(env('SEED_RAFFLE_ADDRESS', '') || '').trim();
const B = (x) => BigInt(x);
const at = (opts) => (opts && opts.contract) || RAFFLE_ADDRESS();

/** buyTicket(count) — buy `count` tickets at the fixed ticketPrice (needs prior ERC-20 approve of token). */
export function buyTicketCall(count, opts = {}) {
  const n = B(count);
  if (n <= 0n) throw new Error('count must be > 0');
  return { contract: at(opts), fn: 'buyTicket', args: [n] };
}
/** draw() — anyone may trigger the draw once block.number passes drawBlock; pays the winning ticket. */
export function drawCall(opts = {}) { return { contract: at(opts), fn: 'draw', args: [] }; }

/** A standard ERC-20 approve so the raffle can pull the ticket price (the casino "buy-in" step). */
export function approveCall(tokenAddress, amount, opts = {}) {
  return { contract: tokenAddress, fn: 'approve', args: [at(opts), B(amount)] };
}

// ── reads (injected reader) ──────────────────────────────────────────────────────────────────────────
let _reader = null;
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : null; }
async function read(fn, args = []) { if (!_reader) return null; try { return await _reader(fn, args); } catch { return null; } }

/**
 * readState — the round at a glance for a UI tile: ticketPrice, ticketsSold, prizePool, drawBlock, and
 * whether the draw is callable yet (headBlock past drawBlock). Soft-null fields when no reader is set.
 */
export async function readState({ headBlock } = {}) {
  const [ticketPrice, ticketCount, prizePool, drawBlock] = await Promise.all([
    read('ticketPrice'), read('ticketCount'), read('prizePool'), read('drawBlock'),
  ]);
  const drawable = (headBlock != null && drawBlock != null) ? B(headBlock) >= B(drawBlock) : null;
  return { ticketPrice, ticketsSold: ticketCount, prizePool, drawBlock, drawable };
}

if (process.argv[1] && process.argv[1].endsWith('prana-seed.mjs')) {
  console.log(JSON.stringify({
    raffle: RAFFLE_ADDRESS() || '(set SEED_RAFFLE_ADDRESS)',
    buy: buyTicketCall(3), draw: drawCall(),
  }, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2));
}
