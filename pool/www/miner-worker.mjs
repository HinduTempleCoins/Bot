// SoapBox browser miner — Web Worker (the hashing thread).
//
// Runs real, spec-compliant RandomX (vendored randomx.js) off the UI thread. The main
// thread (miner.mjs) speaks stratum to the pool via the WS bridge and hands each worker a
// job: the hashing blob, the seed_hash (RandomX key for the current epoch), a 32-bit
// target, and a nonce lane (offset + stride) so N workers never test the same nonce.
//
// The worker:
//   - (re)initialises the 256 MiB RandomX cache only when the seed_hash changes (epoch),
//   - writes the 4-byte nonce into the blob at the Monero offset (39),
//   - hashes, checks the hash against the target (RandomX result is little-endian; a share
//     meets target when the top 32 bits of the hash, read little-endian, are <= target),
//   - posts 'share' when one is found and periodic 'hashrate' samples.
//
// This is a module worker: { type: 'module' }. ESM import of the vendored lib.

import { randomx_init_cache, randomx_create_vm } from './vendor/randomx/randomx.mjs';

const NONCE_OFFSET = 39; // Monero block-hashing-blob nonce offset (4 bytes LE)

let vm = null;
let currentSeed = null;     // hex string of the seed currently initialised
let job = null;             // { blobBytes, seedHex, target(uint32), jobId, lane:{offset,stride} }
let running = false;
let nonce = 0;

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

// Top 32 bits of the 32-byte hash, read the way miners compare to a compact target:
// the last 4 bytes of the hash interpreted little-endian. share is valid if <= target.
function hashTop32LE(hash) {
  return ((hash[31] << 24) | (hash[30] << 16) | (hash[29] << 8) | hash[28]) >>> 0;
}

function ensureSeed(seedHex) {
  if (currentSeed === seedHex && vm) return;
  // (re)build cache + vm for the new epoch seed. This is the HEAVY step — in a browser the
  // RandomX cache build can take a minute or more per worker on first start. Report it, so
  // the page never shows a silent 0 H/s while we grind; surface failure instead of dying mute.
  try {
    self.postMessage({ type: 'status', state: 'initializing RandomX (first start can take a minute)…' });
    const key = hexToBytes(seedHex);
    const cache = randomx_init_cache(key);
    vm = randomx_create_vm(cache);
    currentSeed = seedHex;
    self.postMessage({ type: 'status', state: 'hashing' });
  } catch (e) {
    vm = null;
    self.postMessage({ type: 'error', message: 'RandomX init failed: ' + ((e && e.message) || 'unknown') });
  }
}

function setJob(j) {
  job = {
    blobBytes: hexToBytes(j.blob),
    seedHex: j.seed_hash,
    target: j.target >>> 0,
    jobId: j.job_id,
    lane: j.lane || { offset: 0, stride: 1 },
  };
  ensureSeed(job.seedHex);
  // start this worker's nonce in its lane
  nonce = job.lane.offset >>> 0;
}

function writeNonce(blob, n) {
  blob[NONCE_OFFSET] = n & 0xff;
  blob[NONCE_OFFSET + 1] = (n >>> 8) & 0xff;
  blob[NONCE_OFFSET + 2] = (n >>> 16) & 0xff;
  blob[NONCE_OFFSET + 3] = (n >>> 24) & 0xff;
}

function nonceHex(n) {
  // little-endian 4-byte nonce as 8 hex chars (stratum 'nonce' field)
  const b = [(n & 0xff), (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
  return b.map((x) => x.toString(16).padStart(2, '0')).join('');
}
function bytesToHex(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0'); return s;
}

let lastSample = 0;
let hashesSinceSample = 0;

// One slice of work: hash a small batch, yielding to the event loop between slices so
// throttling (sleep between slices) and new jobs can be applied. Returns quickly.
function workSlice() {
  if (!running || !job || !vm) return;
  const BATCH = 16; // hashes per slice; small so throttle + job updates stay responsive
  const { blobBytes, target, lane, jobId } = job;
  for (let i = 0; i < BATCH; i++) {
    writeNonce(blobBytes, nonce);
    const hash = vm.calculate_hash(blobBytes);
    hashesSinceSample++;
    if (hashTop32LE(hash) <= target) {
      self.postMessage({ type: 'share', jobId, nonce: nonceHex(nonce), result: bytesToHex(hash) });
    }
    nonce = (nonce + lane.stride) >>> 0;
  }
  // periodic hashrate sample (~every 1s)
  const now = Date.now();
  if (now - lastSample >= 1000) {
    const hs = hashesSinceSample / ((now - lastSample) / 1000);
    self.postMessage({ type: 'hashrate', hs });
    hashesSinceSample = 0;
    lastSample = now;
  }
}

// throttle: 0..1 fraction of time spent working. 1 = full speed (no sleep). We approximate
// by sleeping (1-throttle)/throttle * sliceTime between slices.
let throttle = 0.5;
let sliceMs = 0; // measured slice duration, used to compute the pause

async function loop() {
  while (running) {
    const t0 = Date.now();
    workSlice();
    sliceMs = Date.now() - t0;
    if (throttle < 1) {
      const pause = Math.max(0, Math.round(sliceMs * (1 - throttle) / Math.max(throttle, 0.05)));
      if (pause > 0) await new Promise((r) => setTimeout(r, pause));
      else await new Promise((r) => setTimeout(r, 0));
    } else {
      await new Promise((r) => setTimeout(r, 0)); // always yield so messages process
    }
  }
}

self.onmessage = (e) => {
  const m = e.data || {};
  switch (m.type) {
    case 'job':
      setJob(m.job);
      lastSample = Date.now(); hashesSinceSample = 0;
      break;
    case 'throttle': {
      const n = Number(m.value);
      throttle = Math.min(1, Math.max(0.05, Number.isFinite(n) ? n : 0.5));
      break;
    }
    case 'start':
      if (!running) { running = true; lastSample = Date.now(); loop(); }
      break;
    case 'stop':
      running = false;
      break;
  }
};
