// infra-metrics.mjs — Prometheus/Grafana/Uptime-Kuma-style infra metrics for chains/nodes/bots
// (queue #97). PURE registry + exposition: no globals scraped, no I/O except the optional
// uptimeCheck pinger (which takes an injected fetch). This is the body of a /metrics endpoint.
//
// SECURITY: metric labels NEVER carry secrets or real hostnames/IPs. Callers pass generic labels
// (role: 'chain', node: 'a', target: 'rpc-1'); uptimeCheck strips host/path from any URL before it
// could ever reach a label — only a caller-supplied generic `name` is recorded.
//
//   import { Registry, uptimeCheck } from './infra-metrics.mjs'
//   const reg = new Registry();
//   reg.counter('blocks_produced_total', { role: 'witness' }).inc();
//   reg.gauge('peers', { node: 'a' }).set(8);
//   reg.histogram('rpc_latency_seconds').observe(0.12);
//   res.end(reg.renderProm());            // Prometheus text exposition (the /metrics body)
//
//   node integrations/infra-metrics.mjs    // demo render

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- name / label validation (Prometheus exposition rules) ------------------
const NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertName(name) {
  if (!NAME_RE.test(String(name || ''))) {
    throw new Error(`invalid metric name: ${JSON.stringify(name)}`);
  }
}
function cleanLabels(labels = {}) {
  const out = {};
  for (const [k, v] of Object.entries(labels)) {
    if (!LABEL_RE.test(k)) throw new Error(`invalid label name: ${JSON.stringify(k)}`);
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
}
// escape a label value per exposition format: backslash, double-quote, newline
function escapeVal(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
// stable key for a label set (sorted, so {a,b} === {b,a})
function labelKey(labels) {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}
function renderLabels(labels, extra) {
  const all = { ...labels, ...(extra || {}) };
  const keys = Object.keys(all).sort();
  if (keys.length === 0) return '';
  return '{' + keys.map((k) => `${k}="${escapeVal(all[k])}"`).join(',') + '}';
}
function fmtNum(n) {
  if (n === Infinity) return '+Inf';
  if (n === -Infinity) return '-Inf';
  if (Number.isNaN(n)) return 'NaN';
  return String(n);
}

// ---- metric instances -------------------------------------------------------
class Counter {
  constructor(labels) { this.labels = labels; this.value = 0; }
  inc(n = 1) {
    if (n < 0) throw new Error('counter cannot decrease');
    this.value += n;
    return this;
  }
}
class Gauge {
  constructor(labels) { this.labels = labels; this.value = 0; }
  set(n) { this.value = Number(n); return this; }
  inc(n = 1) { this.value += n; return this; }
  dec(n = 1) { this.value -= n; return this; }
}
export const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
class Histogram {
  constructor(labels, buckets = DEFAULT_BUCKETS) {
    this.labels = labels;
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.counts = this.buckets.map(() => 0); // cumulative computed at render
    this._bucketCounts = this.buckets.map(() => 0); // per-bucket (non-cumulative)
    this.sum = 0;
    this.count = 0;
  }
  observe(v) {
    const x = Number(v);
    this.sum += x;
    this.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (x <= this.buckets[i]) { this._bucketCounts[i] += 1; break; }
    }
    return this;
  }
}

// a family groups instances of one metric name (one HELP/TYPE, many label sets)
class Family {
  constructor(name, type, help) {
    assertName(name);
    this.name = name;
    this.type = type;
    this.help = help || `${name} (${type})`;
    this.children = new Map(); // labelKey -> instance
    this.histBuckets = DEFAULT_BUCKETS;
  }
  child(rawLabels) {
    const labels = cleanLabels(rawLabels);
    const key = labelKey(labels);
    let inst = this.children.get(key);
    if (!inst) {
      if (this.type === 'counter') inst = new Counter(labels);
      else if (this.type === 'gauge') inst = new Gauge(labels);
      else inst = new Histogram(labels, this.histBuckets);
      this.children.set(key, inst);
    }
    return inst;
  }
}

export class Registry {
  constructor() { this.families = new Map(); }

  _family(name, type, help) {
    let fam = this.families.get(name);
    if (!fam) { fam = new Family(name, type, help); this.families.set(name, fam); }
    else if (fam.type !== type) {
      throw new Error(`metric ${name} already registered as ${fam.type}, not ${type}`);
    } else if (help && fam.help.endsWith('(' + type + ')')) {
      fam.help = help; // upgrade default help if a real one is supplied later
    }
    return fam;
  }

  counter(name, labels = {}, help) { return this._family(name, 'counter', help).child(labels); }
  gauge(name, labels = {}, help) { return this._family(name, 'gauge', help).child(labels); }
  histogram(name, labels = {}, opts = {}) {
    const fam = this._family(name, 'histogram', opts.help);
    if (opts.buckets) fam.histBuckets = [...opts.buckets].sort((a, b) => a - b);
    return fam.child(labels);
  }

  // convenience verbs operating by (name, labels)
  inc(name, labels = {}, n = 1) { return this.counter(name, labels).inc(n); }
  set(name, labels = {}, n) { return this.gauge(name, labels).set(n); }
  observe(name, labels = {}, v) { return this.histogram(name, labels).observe(v); }

  // Prometheus text exposition format (HELP + TYPE header per family, sorted by name)
  renderProm() {
    const lines = [];
    const names = [...this.families.keys()].sort();
    for (const name of names) {
      const fam = this.families.get(name);
      lines.push(`# HELP ${name} ${fam.help.replace(/\n/g, ' ')}`);
      lines.push(`# TYPE ${name} ${fam.type}`);
      for (const inst of fam.children.values()) {
        if (fam.type === 'histogram') {
          let cumulative = 0;
          for (let i = 0; i < fam.histBuckets.length; i++) {
            cumulative += inst._bucketCounts[i];
            const le = fmtNum(fam.histBuckets[i]);
            lines.push(`${name}_bucket${renderLabels(inst.labels, { le })} ${cumulative}`);
          }
          lines.push(`${name}_bucket${renderLabels(inst.labels, { le: '+Inf' })} ${inst.count}`);
          lines.push(`${name}_sum${renderLabels(inst.labels)} ${fmtNum(inst.sum)}`);
          lines.push(`${name}_count${renderLabels(inst.labels)} ${inst.count}`);
        } else {
          lines.push(`${name}${renderLabels(inst.labels)} ${fmtNum(inst.value)}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  // snapshot for healthSummary / JSON consumers
  snapshot() {
    const out = {};
    for (const [name, fam] of this.families) {
      out[name] = { type: fam.type, series: [...fam.children.values()].map((inst) => {
        if (fam.type === 'histogram') {
          return { labels: inst.labels, count: inst.count, sum: inst.sum };
        }
        return { labels: inst.labels, value: inst.value };
      }) };
    }
    return out;
  }
}

// shared default registry, like prom-client's
export const registry = new Registry();

// ---- uptime checking --------------------------------------------------------
// targets: [{ name, url, timeoutMs? }]. NEVER record url/host in a label — only `name`.
export async function uptimeCheck(targets = [], opts = {}) {
  const fetchFn = opts.fetch || _fetch;
  const timeoutMs = opts.timeoutMs || 5000;
  const list = Array.isArray(targets) ? targets : [targets];
  const results = await Promise.all(list.map(async (t) => {
    const name = t.name || 'target';
    const start = Date.now();
    try {
      const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), t.timeoutMs || timeoutMs) : null;
      let res;
      try {
        res = await fetchFn(t.url, { method: t.method || 'GET', signal: ctl ? ctl.signal : undefined });
      } finally { if (timer) clearTimeout(timer); }
      const latencyMs = Date.now() - start;
      const status = (res && typeof res.status === 'number') ? res.status : 0;
      const up = !!(res && (res.ok !== undefined ? res.ok : (status >= 200 && status < 400)));
      return { name, up, status, latencyMs };
    } catch (e) {
      // soft-fail: a down target never throws, it reports down
      return { name, up: false, status: 0, latencyMs: Date.now() - start, error: e && e.message ? e.message : 'error' };
    }
  }));
  return results;
}

// record uptime results into a registry as generic gauges (no host labels)
export function recordUptime(reg, results) {
  for (const r of results) {
    reg.gauge('uptime_up', { target: r.name }, 'target reachable (1) or not (0)').set(r.up ? 1 : 0);
    reg.gauge('uptime_latency_ms', { target: r.name }, 'last probe latency in ms').set(r.latencyMs);
  }
  return reg;
}

// roll up a set of uptime results into a single health view
export function healthSummary(results = []) {
  const total = results.length;
  const up = results.filter((r) => r.up).length;
  const down = total - up;
  const lats = results.filter((r) => r.up).map((r) => r.latencyMs);
  const avgLatencyMs = lats.length ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : 0;
  let status = 'ok';
  if (total === 0) status = 'unknown';
  else if (down === total) status = 'down';
  else if (down > 0) status = 'degraded';
  return {
    status,
    total,
    up,
    down,
    avgLatencyMs,
    targets: results.map((r) => ({ name: r.name, up: r.up, latencyMs: r.latencyMs })),
  };
}

// ---- CLI demo (guarded) -----------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('infra-metrics.mjs')) {
  const reg = new Registry();
  reg.counter('blocks_produced_total', { role: 'witness' }, 'blocks produced').inc(42);
  reg.gauge('peers', { node: 'a' }, 'connected peers').set(8);
  const h = reg.histogram('rpc_latency_seconds', { role: 'chain' }, { help: 'rpc round-trip seconds' });
  [0.02, 0.08, 0.3, 1.2].forEach((v) => h.observe(v));
  console.log(reg.renderProm());

  const targets = [
    { name: 'rpc-1', url: 'https://example.invalid/health' },
  ];
  const results = await uptimeCheck(targets, { timeoutMs: 1500 }).catch(() => []);
  recordUptime(reg, results);
  console.log('# health', JSON.stringify(healthSummary(results)));
}
