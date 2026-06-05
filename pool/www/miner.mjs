// SoapBox browser miner — main-thread controller.
//
// Owns the WebSocket to the pool bridge (/ws), speaks Monero stratum (login -> job ->
// submit), and fans jobs out to a pool of Web Workers (miner-worker.mjs) that do the real
// RandomX hashing. Aggregates hashrate, counts accepted shares, and reports state via an
// onEvent callback so the page can render live counters.
//
// Honest by construction: the pool re-validates every share's RandomX proof, so nothing
// here can fake a share. The worst case is zero accepted shares (slow hardware), never a
// fake one.
//
// The pure stratum helpers (targetToUint32, parseJob, buildLogin, buildSubmit,
// difficultyFromTarget) are exported for unit tests and have no DOM/Worker/WS dependency.

// ---- pure stratum helpers (unit-tested) ----------------------------------------------

// Monero/xmrig compact target -> a uint32 we compare the hash's top-32-LE against.
// The job 'target' is a little-endian hex string. 4-byte targets are used as-is; 8-byte
// targets are the high 4 bytes (xmrig convention: 64-bit target, compare top word).
export function targetToUint32(targetHex) {
  const h = (targetHex || '').replace(/^0x/, '');
  if (h.length === 8) {
    // little-endian 4 bytes -> uint32
    const b = [0, 1, 2, 3].map((i) => parseInt(h.substr(i * 2, 2), 16));
    return ((b[3] << 24) | (b[2] << 16) | (b[1] << 8) | b[0]) >>> 0;
  }
  if (h.length === 16) {
    // 8-byte LE target; take the most-significant 32 bits (bytes 4..7 LE)
    const b = [4, 5, 6, 7].map((i) => parseInt(h.substr(i * 2, 2), 16));
    return ((b[3] << 24) | (b[2] << 16) | (b[1] << 8) | b[0]) >>> 0;
  }
  // unknown length: be permissive but safe — treat as max (hardest), so we never
  // over-claim a share.
  return 0xffffffff >>> 0;
}

// Approximate difficulty implied by a compact uint32 target (for display only).
export function difficultyFromTarget(target) {
  const t = (target >>> 0) || 1;
  return Math.max(1, Math.round(0xffffffff / t));
}

// Pull the job object out of either a login result or an unsolicited 'job' push.
export function parseJob(msg) {
  if (!msg || typeof msg !== 'object') return null;
  let job = null;
  if (msg.result && msg.result.job) job = msg.result.job;
  else if (msg.method === 'job' && msg.params) job = msg.params;
  if (!job || !job.blob || !job.job_id || !job.seed_hash) return null;
  return {
    blob: job.blob,
    job_id: job.job_id,
    seed_hash: job.seed_hash,
    target: targetToUint32(job.target),
    targetHex: job.target,
    height: job.height,
    algo: job.algo || 'rx/0',
  };
}

export function buildLogin({ address, worker = 'browser', id = 1 }) {
  return { id, jsonrpc: '2.0', method: 'login', params: { login: address, pass: worker, agent: 'SoapBoxBrowserMiner/1.0 (randomx.js)', algo: ['rx/0'] } };
}

export function buildSubmit({ sessionId, jobId, nonce, result, id }) {
  return { id, jsonrpc: '2.0', method: 'submit', params: { id: sessionId, job_id: jobId, nonce, result } };
}

// Sniff a login-success session id from the login result.
export function parseLoginSession(msg) {
  if (msg && msg.result && (msg.result.id || msg.result.status === 'OK')) return msg.result.id || null;
  return null;
}

// ---- the browser miner (DOM/Worker/WS) -----------------------------------------------

const DEFAULTS = {
  // wss path fronted by Caddy. In the page we pass an absolute wss:// URL.
  wsUrl: null,
  workerUrl: new URL('./miner-worker.mjs', import.meta.url).href,
  threads: 0,       // 0 => auto (hardwareConcurrency - 1, capped)
  throttle: 0.5,
  worker: 'browser',
};

export class BrowserMiner {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.onEvent = opts.onEvent || (() => {});
    this.ws = null;
    this.workers = [];
    this.sessionId = null;
    this.job = null;
    this.accepted = 0;
    this.rejected = 0;
    this.submitId = 100;
    this.pendingSubmits = new Map(); // id -> {nonce}
    this.hashByWorker = new Map();   // idx -> last h/s
    this.running = false;
    this.address = null;
    this._reconnectTimer = null;
    this._WS = opts.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this._WorkerImpl = opts.WorkerImpl || (typeof Worker !== 'undefined' ? Worker : null);
  }

  threadCount() {
    if (this.cfg.threads > 0) return this.cfg.threads;
    const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    return Math.max(1, Math.min(hc - 1, 8)); // leave one core for the UI; cap at 8
  }

  emit(type, data) { try { this.onEvent({ type, ...data }); } catch {} }

  start(address) {
    if (this.running) return;
    this.address = address;
    this.running = true;
    this.accepted = 0; this.rejected = 0;
    this.spawnWorkers();
    this.connect();
    this.emit('status', { state: 'connecting' });
  }

  stop() {
    this.running = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    for (const w of this.workers) { try { w.postMessage({ type: 'stop' }); w.terminate(); } catch {} }
    this.workers = [];
    this.hashByWorker.clear();
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.emit('status', { state: 'stopped' });
    this.emit('hashrate', { total: 0 });
  }

  setThrottle(v) {
    const n = Number(v);
    this.cfg.throttle = Math.min(1, Math.max(0.05, Number.isFinite(n) ? n : 0.5));
    for (const w of this.workers) w.postMessage({ type: 'throttle', value: this.cfg.throttle });
  }

  spawnWorkers() {
    const n = this.threadCount();
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new this._WorkerImpl(this.cfg.workerUrl, { type: 'module' });
      const idx = i;
      w.onmessage = (e) => this.onWorkerMessage(idx, e.data);
      w.postMessage({ type: 'throttle', value: this.cfg.throttle });
      this.workers.push(w);
    }
    this.emit('status', { threads: n });
  }

  onWorkerMessage(idx, m) {
    if (!m) return;
    if (m.type === 'hashrate') {
      this.hashByWorker.set(idx, m.hs);
      let total = 0; for (const v of this.hashByWorker.values()) total += v;
      this.emit('hashrate', { total, threads: this.workers.length });
    } else if (m.type === 'share') {
      this.submitShare(m);
    }
  }

  submitShare({ jobId, nonce, result }) {
    if (!this.ws || this.ws.readyState !== 1 || !this.job || jobId !== this.job.job_id) return;
    const id = this.submitId++;
    this.pendingSubmits.set(id, { nonce });
    this.send(buildSubmit({ sessionId: this.sessionId, jobId, nonce, result, id }));
    this.emit('share-found', { nonce });
  }

  send(obj) { try { this.ws.send(JSON.stringify(obj)); } catch {} }

  connect() {
    if (!this._WS) { this.emit('error', { message: 'WebSocket unavailable in this environment' }); return; }
    let ws;
    try { ws = new this._WS(this.cfg.wsUrl); } catch (e) { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.emit('status', { state: 'connected' });
      this.send(buildLogin({ address: this.address, worker: this.cfg.worker, id: 1 }));
    };
    ws.onmessage = (ev) => this.onStratum(ev.data);
    ws.onclose = () => { if (this.running) { this.emit('status', { state: 'reconnecting' }); this.scheduleReconnect(); } };
    ws.onerror = () => { /* close handler will reconnect */ };
  }

  scheduleReconnect() {
    if (!this.running || this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => { this._reconnectTimer = null; if (this.running) this.connect(); }, 3000);
  }

  onStratum(raw) {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    // login result
    if (msg.id === 1 && msg.result) {
      this.sessionId = parseLoginSession(msg) || this.sessionId;
      const job = parseJob(msg);
      if (job) this.applyJob(job);
      return;
    }
    // login/submit error
    if (msg.id === 1 && msg.error) { this.emit('error', { message: msg.error.message || 'login rejected' }); return; }

    // submit result
    if (this.pendingSubmits.has(msg.id)) {
      const ok = msg.result && (msg.result.status === 'OK' || msg.result.status === 'KEEP');
      if (ok) { this.accepted++; this.emit('accepted', { accepted: this.accepted }); }
      else { this.rejected++; this.emit('rejected', { rejected: this.rejected, reason: msg.error && msg.error.message }); }
      this.pendingSubmits.delete(msg.id);
      return;
    }

    // unsolicited job push
    if (msg.method === 'job') {
      const job = parseJob(msg);
      if (job) this.applyJob(job);
    }
  }

  applyJob(job) {
    this.job = job;
    const stride = this.workers.length || 1;
    this.workers.forEach((w, i) => {
      w.postMessage({ type: 'job', job: { ...job, lane: { offset: i, stride } } });
      w.postMessage({ type: 'start' });
    });
    this.emit('job', { jobId: job.job_id, difficulty: difficultyFromTarget(job.target), height: job.height });
  }
}
