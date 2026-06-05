// End-to-end accepted-share proof for the browser-mining path.
//
//   node pool/bridge/proof-share.mjs <ws-url> <monero-stagenet-address> [seconds]
//
// Simulates exactly what the in-page miner does, but headless: opens a WebSocket to the
// pool bridge (/ws), logs in via Monero stratum, mines the job with the SAME vendored
// RandomX (randomx.js) the browser uses, and submits shares. Exits 0 on the FIRST accepted
// share, 1 on timeout/no-share. This is the brief's hard "AT LEAST ONE ACCEPTED SHARE"
// proof — runnable from the box (ws://127.0.0.1:8110) or anywhere (wss://…/ws).
//
// It depends on `ws` (already a dependency) and the vendored randomx.js. No keys.
//
// NOTE: requires the pool's daemon to be SERVING JOBS. On stagenet that means
// melek-mc-monerod must be SYNCED (else miningcore issues no block template and stratum
// has no work — the run will report "no job received").

import { WebSocket } from 'ws';
import { randomx_init_cache, randomx_create_vm } from '../www/vendor/randomx/randomx.mjs';
import { buildLogin, buildSubmit, parseJob, parseLoginSession } from '../www/miner.mjs';

const NONCE_OFFSET = 39;
const [, , wsUrl, address, secondsArg] = process.argv;
if (!wsUrl || !address) {
  console.error('usage: node proof-share.mjs <ws-url> <monero-stagenet-address> [seconds]');
  process.exit(2);
}
const BUDGET_MS = (Number(secondsArg) || 120) * 1000;

function hexToBytes(h) { h = h.replace(/^0x/, ''); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
function bytesToHex(b) { let s = ''; for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0'); return s; }
function hashTop32LE(h) { return ((h[31] << 24) | (h[30] << 16) | (h[29] << 8) | h[28]) >>> 0; }
function writeNonce(blob, n) { blob[NONCE_OFFSET] = n & 0xff; blob[NONCE_OFFSET + 1] = (n >>> 8) & 0xff; blob[NONCE_OFFSET + 2] = (n >>> 16) & 0xff; blob[NONCE_OFFSET + 3] = (n >>> 24) & 0xff; }
function nonceHex(n) { return [(n & 0xff), (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].map((x) => x.toString(16).padStart(2, '0')).join(''); }

let vm = null, seed = null, job = null, sessionId = null, submitId = 100, gotJob = false, hashes = 0;
const t0 = Date.now();
const ws = new WebSocket(wsUrl);

function ensureSeed(seedHex) {
  if (seed === seedHex && vm) return;
  console.log('[proof] init RandomX cache for seed', seedHex.slice(0, 16) + '…');
  vm = randomx_create_vm(randomx_init_cache(hexToBytes(seedHex)));
  seed = seedHex;
}

function mineTick() {
  if (!job || !vm || ws.readyState !== WebSocket.OPEN) return;
  const blob = job.blobBytes;
  const end = Date.now() + 200; // hash for ~200ms, then yield to read the socket
  while (Date.now() < end) {
    writeNonce(blob, job.nonce);
    const h = vm.calculate_hash(blob);
    hashes++;
    if (hashTop32LE(h) <= job.target) {
      const id = submitId++;
      const nonce = nonceHex(job.nonce);
      console.log('[proof] SHARE found @ nonce', job.nonce, 'top32=0x' + (hashTop32LE(h) >>> 0).toString(16), '<= target 0x' + job.target.toString(16));
      ws.send(JSON.stringify(buildSubmit({ sessionId, jobId: job.job_id, nonce, result: bytesToHex(h), id })));
    }
    job.nonce = (job.nonce + 1) >>> 0;
  }
  setImmediate(mineTick);
}

function applyJob(j) {
  ensureSeed(j.seed_hash);
  job = { ...j, blobBytes: hexToBytes(j.blob), nonce: 0 };
  gotJob = true;
  const hs = hashes / Math.max(0.001, (Date.now() - t0) / 1000);
  console.log('[proof] job', j.job_id, 'target=0x' + j.target.toString(16), 'height=' + j.height, ' (~' + hs.toFixed(1) + ' H/s so far)');
}

ws.on('open', () => { console.log('[proof] connected', wsUrl); ws.send(JSON.stringify(buildLogin({ address, worker: 'proof', id: 1 }))); });
ws.on('message', (data) => {
  let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
  if (msg.id === 1 && msg.result) { sessionId = parseLoginSession(msg) || sessionId; const j = parseJob(msg); if (j) { applyJob(j); mineTick(); } return; }
  if (msg.id === 1 && msg.error) { console.error('[proof] login rejected:', msg.error.message); process.exit(1); }
  if (msg.method === 'job') { const j = parseJob(msg); if (j) applyJob(j); return; }
  if (msg.id >= 100 && (msg.result || msg.error)) {
    if (msg.result && (msg.result.status === 'OK' || msg.result.status === 'KEEP')) {
      console.log('[proof] ✓ SHARE ACCEPTED by the pool. hashes=' + hashes + ' elapsed=' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
      process.exit(0);
    } else {
      console.log('[proof] share rejected:', (msg.error && msg.error.message) || JSON.stringify(msg.result), '(retrying)');
    }
  }
});
ws.on('error', (e) => { console.error('[proof] ws error', e.message); process.exit(1); });
ws.on('close', () => { console.error('[proof] ws closed before an accepted share'); process.exit(1); });

setTimeout(() => {
  console.error('[proof] TIMEOUT after ' + (BUDGET_MS / 1000) + 's.' + (gotJob ? ' Got jobs but no accepted share in budget — measure H/s / lower diff.' : ' NO JOB received — is the stagenet daemon synced and serving templates?'));
  process.exit(1);
}, BUDGET_MS);
