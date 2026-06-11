// work-gate.mjs — PRANA AI-work gate: redundant-recompute verification layer.
//
// PRANA gates PoW block rewards on whether a registered pool actually completed the DAO's
// dispatched AI work (design: PRANA_EVM_OPTIONS path B — an off-chain K-of-N attestation
// oracle co-signs a per-epoch "verified-work-units" vector that the on-chain RewardRouter
// reads to split the subsidy). PoW still secures the chain; this gate only secures the right
// to be PAID. This module is the verification METHOD the attesters run before they sign:
// REDUNDANT RECOMPUTATION on deterministic jobs — the same job is run by N pools (and,
// optionally, re-run locally by the attester); bitwise agreement on the canonical result is
// the proof. No cryptographic proof-of-inference is claimed (none exists cheaply in 2026);
// agreement + threshold attestation is the realistic gate.
//
//   Deterministic by construction. No network, no eval, no Math.random / Date.now (a seeded
//   PRNG drives the sample jobs so a recompute is reproducible). Soft-fail: every entry point
//   returns a typed result and never throws. Mirrors the house style of compute-core.mjs.
//
//   import { canonicalize, digest, consensus, recompute, verifyEpoch } from './work-gate.mjs'
//   node integrations/work-gate.mjs --demo

import { createHash } from 'node:crypto';

const SOURCE = 'PRANA work-gate (redundant-recompute verification; off-chain attester input)';

// ── canonical serialization: stable, key-order-independent, so equal results hash equal ──────
/** Deterministic canonical string for any JSON-ish value (object keys sorted recursively). */
export function canonicalize(value) {
  const seen = new WeakSet();
  const enc = (v) => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'number') return Object.is(v, -0) ? '0' : JSON.stringify(v);
      return JSON.stringify(v ?? null);
    }
    if (seen.has(v)) return '"[circular]"';
    seen.add(v);
    if (Array.isArray(v)) return '[' + v.map(enc).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + enc(v[k])).join(',') + '}';
  };
  try { return enc(value); } catch { return JSON.stringify(String(value)); }
}

/** sha256 hex of the canonical form — the agreement key two pools' results are compared on. */
export function digest(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

// ── consensus over pool submissions ──────────────────────────────────────────────────────────
/**
 * Group submissions by result-digest and find the plurality cluster.
 * @param submissions [{ pool, result }]
 * @param opts { threshold } minimum agreeing fraction (0..1) for consensus to be "reached"
 * @returns { reached, hash, total, agree:[pool], dissent:[pool], clusters:[{hash,pools}] }
 */
export function consensus(submissions, { threshold = 0.5 } = {}) {
  const rows = Array.isArray(submissions) ? submissions.filter((s) => s && s.pool != null) : [];
  const total = rows.length;
  const base = { reached: false, hash: null, total, agree: [], dissent: [], clusters: [], source: SOURCE };
  if (!total) return base;

  const byHash = new Map();
  for (const s of rows) {
    const h = digest(s.result);
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(String(s.pool));
  }
  const clusters = [...byHash.entries()]
    .map(([hash, pools]) => ({ hash, pools }))
    // tie-break deterministically: larger cluster first, then lexicographically smaller hash
    .sort((a, b) => b.pools.length - a.pools.length || (a.hash < b.hash ? -1 : 1));

  const top = clusters[0];
  const frac = top.pools.length / total;
  const reached = frac >= threshold && top.pools.length >= 2; // need agreement, not a lone result
  const agree = reached ? top.pools.slice() : [];
  const agreeSet = new Set(agree);
  const dissent = rows.map((s) => String(s.pool)).filter((p) => !agreeSet.has(p));
  return { reached, hash: reached ? top.hash : null, total, agree, dissent, clusters, source: SOURCE };
}

// ── deterministic recompute of verifiable job specs (the attester's independent check) ────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Re-run a deterministic job spec locally so an attester can verify a pool's result by recompute.
 * Supported job types (the launch set: deterministic Monte-Carlo / arithmetic):
 *   { type:'sum',  inputs:[n...] }
 *   { type:'mean', inputs:[n...] }
 *   { type:'montecarlo-pi', seed:int, iters:int }   → estimate of pi, fixed by the seed
 * @returns { ok, result } or { ok:false, reason }
 */
export function recompute(job) {
  if (!job || typeof job !== 'object') return { ok: false, reason: 'no-job' };
  const t = job.type;
  if (t === 'sum' || t === 'mean') {
    if (!Array.isArray(job.inputs) || job.inputs.some((x) => typeof x !== 'number' || !Number.isFinite(x)))
      return { ok: false, reason: 'bad-inputs' };
    const sum = job.inputs.reduce((a, b) => a + b, 0);
    return { ok: true, result: t === 'sum' ? sum : (job.inputs.length ? sum / job.inputs.length : 0) };
  }
  if (t === 'montecarlo-pi') {
    const iters = Number.isInteger(job.iters) && job.iters > 0 ? job.iters : 0;
    const seed = Number.isInteger(job.seed) ? job.seed : 0;
    if (!iters) return { ok: false, reason: 'bad-iters' };
    const rnd = mulberry32(seed);
    let inside = 0;
    for (let i = 0; i < iters; i++) {
      const x = rnd(), y = rnd();
      if (x * x + y * y <= 1) inside++;
    }
    return { ok: true, result: (4 * inside) / iters };
  }
  return { ok: false, reason: `unsupported-type:${t}` };
}

// ── per-epoch verification → the verified-work-units vector the RewardRouter consumes ─────────
/**
 * Verify an epoch of dispatched jobs and produce the work-units vector.
 * @param epoch { jobs:[{ id, weight?, submissions:[{pool,result}], spec? }] }
 *   - spec (optional): a recompute()-able job; if present, consensus must MATCH the local
 *     recompute or the whole job is rejected (catches a colluding majority on a checkable job).
 * @param opts { threshold }
 * @returns { units:{ pool:number }, perJob:[...], verified:int, rejected:int, source }
 */
export function verifyEpoch(epoch, { threshold = 0.5 } = {}) {
  const jobs = epoch && Array.isArray(epoch.jobs) ? epoch.jobs : [];
  const units = Object.create(null);
  const perJob = [];
  let verified = 0, rejected = 0;

  for (const job of jobs) {
    const id = job && job.id != null ? String(job.id) : `job${perJob.length}`;
    const weight = Number.isFinite(job && job.weight) && job.weight > 0 ? job.weight : 1;
    const con = consensus(job && job.submissions, { threshold });

    let recomputeOk = true, recomputeNote = 'no-spec';
    if (job && job.spec) {
      const rc = recompute(job.spec);
      if (!rc.ok) { recomputeOk = false; recomputeNote = `recompute-failed:${rc.reason}`; }
      else if (!con.reached) { recomputeOk = false; recomputeNote = 'no-consensus-to-check'; }
      else { recomputeOk = digest(rc.result) === con.hash; recomputeNote = recomputeOk ? 'matches-recompute' : 'consensus-differs-from-recompute'; }
    }

    const accepted = con.reached && recomputeOk;
    if (accepted) {
      verified++;
      for (const pool of con.agree) units[pool] = (units[pool] || 0) + weight;
    } else {
      rejected++;
    }
    perJob.push({ id, weight, accepted, agree: con.agree, dissent: con.dissent, recompute: recomputeNote });
  }
  return { units, perJob, verified, rejected, jobs: jobs.length, source: SOURCE };
}

// ── CLI (guarded; never runs on import) ───────────────────────────────────────────────────────
const isMain = (() => { try { return process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href; } catch { return false; } })();
if (isMain) {
  const arg = process.argv[2];
  if (arg === '--demo') {
    const spec = { type: 'montecarlo-pi', seed: 42, iters: 100000 };
    const truth = recompute(spec).result;
    const epoch = { jobs: [{
      id: 'pi-1', weight: 10, spec,
      submissions: [
        { pool: 'poolA', result: truth },         // honest, recomputed correctly
        { pool: 'poolB', result: truth },          // honest
        { pool: 'poolC', result: 3.14 },           // wrong / lazy
      ],
    }] };
    console.log(JSON.stringify(verifyEpoch(epoch, { threshold: 0.5 }), null, 2));
  } else {
    console.log('usage: node integrations/work-gate.mjs --demo');
  }
}
