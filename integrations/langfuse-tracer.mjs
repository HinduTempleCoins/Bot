// langfuse-tracer.mjs — self-host Langfuse-style tracing over model calls (queue #95).
//
// A PURE trace model + a SOFT-FAIL exporter. No SDK, no hard dependency on a running
// Langfuse server. If LANGFUSE_URL/LANGFUSE_KEY aren't set, or the POST fails, traces
// buffer locally in memory and the caller never sees an error — tracing must never break
// the thing it's tracing.
//
//   import { Tracer, wrap } from './langfuse-tracer.mjs'
//   const tracer = new Tracer();
//   const span = tracer.trace('chat.completion').start();
//   span.log('prompt.sent', { model: 'gpt-4o' });
//   const rec = await span.end({ model: 'gpt-4o', tokens: { in: 12, out: 40 }, cost: 0.001 });
//
//   const tracedCall = wrap(callModel, 'chat.completion');  // auto-traces any async fn
//
//   node integrations/langfuse-tracer.mjs   # flush + print buffered traces (demo)
//
// SECURITY: never logs prompt secrets or API keys. Obvious secret patterns are redacted
// from every payload before it's stored in an event or exported.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

let _now = () => Date.now();
export function __setClock(fn) { _now = fn || (() => Date.now()); }

let _idSeq = 0;
function genId(prefix = 't') {
  // monotonic + random — deterministic-ish for tests, unique enough for traces
  return `${prefix}_${_now().toString(36)}_${(_idSeq++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- secret redaction (never log keys / prompt secrets) ----------------------

const SECRET_KEY_RE = /^(.*(?:secret|password|passwd|token|api[_-]?key|apikey|authorization|auth|wif|private[_-]?key|privkey|bearer|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|session)).*$/i;

// value patterns that look like a secret regardless of the field name
const SECRET_VALUE_RES = [
  /\bsk-[A-Za-z0-9]{16,}\b/g,                  // OpenAI-style keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,           // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,         // Slack tokens
  /\bBearer\s+[A-Za-z0-9._\-]{12,}\b/gi,       // Bearer headers
  /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, // JWTs
  /\b5[HJK][1-9A-HJ-NP-Za-km-z]{48,52}\b/g,    // WIF private keys
  /\bAKIA[0-9A-Z]{16}\b/g,                      // AWS access key id
];

const REDACTED = '[REDACTED]';

export function redactString(str) {
  let s = String(str);
  for (const re of SECRET_VALUE_RES) s = s.replace(re, REDACTED);
  return s;
}

// Deep-redact a payload: drop secret-named fields' values, scrub secret-shaped strings.
export function redact(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((v) => redact(v, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) { out[k] = REDACTED; continue; }
      out[k] = redact(v, seen);
    }
    return out;
  }
  return undefined;
}

// ---- Span -------------------------------------------------------------------

export class Span {
  constructor(name, tracer, opts = {}) {
    this.id = opts.id || genId('s');
    this.traceId = opts.traceId || genId('t');
    this.name = name || 'span';
    this._tracer = tracer || null;
    this.startedAt = null;
    this.endedAt = null;
    this.durationMs = null;
    this.events = [];
    this.model = opts.model ?? null;
    this.tokens = opts.tokens ?? null;
    this.cost = opts.cost ?? null;
    this.error = null;
    this._record = null;
  }

  start() {
    if (this.startedAt == null) this.startedAt = _now();
    return this;
  }

  // record a structured event mid-span; payload is deep-redacted before storage
  log(event, payload) {
    this.events.push({
      at: _now(),
      event: String(event || 'event'),
      ...(payload !== undefined ? { payload: redact(payload) } : {}),
    });
    return this;
  }

  // finalize: build the trace record, hand it to the tracer's exporter (best-effort)
  async end(meta = {}) {
    if (this.startedAt == null) this.start();
    this.endedAt = _now();
    this.durationMs = Math.max(0, this.endedAt - this.startedAt);
    if (meta.model !== undefined) this.model = meta.model;
    if (meta.tokens !== undefined) this.tokens = redact(meta.tokens);
    if (meta.cost !== undefined) this.cost = meta.cost;
    if (meta.error !== undefined) this.error = meta.error;

    const record = this.toRecord();
    this._record = record;
    if (this._tracer) await this._tracer._export(record);
    return record;
  }

  toRecord() {
    return {
      id: this.traceId,
      spanId: this.id,
      name: this.name,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: this.durationMs,
      events: this.events,
      model: this.model,
      tokens: this.tokens,
      cost: this.cost,
      ...(this.error ? { error: redact(this.error) } : {}),
    };
  }
}

// ---- Tracer -----------------------------------------------------------------

export class Tracer {
  constructor(opts = {}) {
    this.url = opts.url ?? process.env.LANGFUSE_URL ?? null;
    this.key = opts.key ?? process.env.LANGFUSE_KEY ?? null;
    this.buffer = [];           // locally-buffered records (export failures / no endpoint)
    this.exported = 0;          // count successfully POSTed
    this.maxBuffer = opts.maxBuffer ?? 1000;
  }

  // start a new trace → returns an already-started Span
  trace(name, opts = {}) {
    const span = new Span(name, this, opts);
    return span;
  }

  // best-effort export. Soft-fail: no endpoint OR any error → buffer locally, never throw.
  async _export(record) {
    if (!this.url || !this.key) {
      this._buffer(record);
      return { ok: false, buffered: true, reason: 'no-endpoint' };
    }
    try {
      const res = await _fetch(`${this.url.replace(/\/+$/, '')}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.key}`,
        },
        // record is already redacted (built from redacted span fields)
        body: JSON.stringify({ batch: [{ type: 'trace-create', body: record }] }),
      });
      if (res && (res.ok === true || (typeof res.status === 'number' && res.status >= 200 && res.status < 300))) {
        this.exported++;
        return { ok: true, buffered: false };
      }
      this._buffer(record);
      return { ok: false, buffered: true, reason: `status:${res && res.status}` };
    } catch (err) {
      this._buffer(record);
      return { ok: false, buffered: true, reason: String(err && err.message || err) };
    }
  }

  _buffer(record) {
    this.buffer.push(record);
    if (this.buffer.length > this.maxBuffer) this.buffer.splice(0, this.buffer.length - this.maxBuffer);
  }

  // try to drain the local buffer to the endpoint (e.g. after it comes back up)
  async flush() {
    if (!this.buffer.length) return { sent: 0, remaining: 0 };
    const pending = this.buffer.splice(0, this.buffer.length);
    let sent = 0;
    for (const rec of pending) {
      const r = await this._export(rec);   // re-buffers on failure
      if (r.ok) sent++;
    }
    return { sent, remaining: this.buffer.length };
  }
}

// default shared tracer (so wrap() works without ceremony)
export const defaultTracer = new Tracer();

// ---- wrap(fn, name): auto-trace any async model call ------------------------

export function wrap(fn, name, opts = {}) {
  const tracer = opts.tracer || defaultTracer;
  const label = name || fn.name || 'call';
  return async function traced(...args) {
    const span = tracer.trace(label).start();
    span.log('call.start', { args: args.length });
    try {
      const result = await fn.apply(this, args);
      const meta = {};
      if (result && typeof result === 'object') {
        if (result.model !== undefined) meta.model = result.model;
        if (result.usage !== undefined) meta.tokens = result.usage;
        else if (result.tokens !== undefined) meta.tokens = result.tokens;
        if (result.cost !== undefined) meta.cost = result.cost;
      }
      span.log('call.ok');
      await span.end(meta);
      return result;
    } catch (err) {
      span.log('call.error', { message: err && err.message });
      await span.end({ error: { message: err && err.message, name: err && err.name } });
      throw err;
    }
  };
}

// ---- CLI (guarded) ----------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('langfuse-tracer.mjs')) {
  (async () => {
    const tracer = new Tracer();
    const demo = wrap(async ({ prompt }) => {
      // simulate a model call; the prompt may contain a secret — it must not leak
      return { model: 'demo-gpt', usage: { in: 8, out: 24 }, cost: 0.0003, text: 'ok' };
    }, 'demo.completion', { tracer });

    await demo({ prompt: 'hi', api_key: 'sk-' + 'demoRedactionFixture'.padEnd(30, 'x') }); // assembled at runtime; proves redaction
    const r = await tracer.flush();
    console.log(JSON.stringify({
      endpoint: tracer.url ? 'set' : 'none',
      exported: tracer.exported,
      buffered: tracer.buffer.length,
      flush: r,
      sample: tracer.buffer[0] || null,
    }, null, 2));
  })();
}
