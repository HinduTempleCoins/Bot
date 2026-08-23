// pentecaust/herald/flows.mjs — the Herald AUTOMATION-FLOWS engine (Activepieces/n8n-style, our own clean impl).
//
// A small, embeddable trigger→steps automation spine that wires the Herald lanes together, e.g.
// "when a lead is verified → add it to a campaign → schedule a crosspost". A flow is a named TRIGGER
// event plus an ordered array of STEPS `{ action, params }`, where `action` names a Herald capability
// ('prompt-packs.fill', 'crossposter.post', 'lead-crm.move', 'analytics.track', 'campaign.advance',
// 'airdrop.plan', …).
//
// run() is a PLANNER / dry-run: it resolves simple `{{event.x}}` / `{{prev.y}}` template refs against the
// incoming event and prior step outputs, and emits an ordered array of PLANNED actions
// `{ step, action, params, resolvedFrom }` — like our other orchestrators emit unsigned calls. It does NOT
// touch the network or call other modules. A `dispatch` seam lets a daemon inject real executors
// {action: fn}; when absent, actions are just recorded as planned (each step's resolved params double as its
// output so `{{prev.*}}` still chains in dry-run).
//
// Deterministic + offline + soft-fail-never-throw: bad shapes yield a shaped `{ ok:false }`, never an
// exception. State lives in an INJECTABLE in-memory storage; a clock is INJECTED so runs are reproducible.
//
//   import { createFlows, handler } from './flows.mjs'
//   const flows = createFlows({ now: () => 0 });
//   flows.defineFlow({ id:'lead->campaign', name:'Onboard verified lead', trigger:'lead.verified',
//     steps:[ { action:'campaign.advance', params:{ lead:'{{event.leadId}}' } },
//             { action:'crossposter.post', params:{ ref:'{{prev.lead}}' } } ] });
//   flows.trigger('lead.verified', { leadId: 'abc' });   // → collected plans
//   node pentecaust/herald/flows.mjs                       # demo flow + plan

import { fileURLToPath } from 'node:url';
import { esc } from '../../integrations/soapbox/seo.mjs';

export { esc };

const clean = (s) => String(s == null ? '' : s).trim();
const isObj = (o) => o != null && typeof o === 'object' && !Array.isArray(o);

// A full-string template ref: the whole value IS one `{{ ... }}` (type-preserving resolution).
const FULL_REF = /^\{\{\s*([\w.$-]+)\s*\}\}$/;
// An embedded template ref (may appear inside a larger string, many times).
const EMBED_REF = /\{\{\s*([\w.$-]+)\s*\}\}/g;

// ── injectable in-memory storage ────────────────────────────────────────────────────────────────────────
// The default keeps flows + run history in memory. A caller may inject any object exposing the same methods
// (e.g. a durable store) — the engine only ever calls these.
export function memStorage() {
  const flows = new Map();
  const runs = [];
  return {
    saveFlow(flow) { flows.set(flow.id, flow); return flow; },
    getFlow(id) { return flows.get(clean(id)) || null; },
    allFlows() { return [...flows.values()]; },
    addRun(run) { runs.push(run); return run; },
    listRuns() { return runs.slice(); },
  };
}

// ── template resolution ─────────────────────────────────────────────────────────────────────────────────

/** Walk a dot-path (`a.b.c`) into an object; undefined on any miss. Never throws. */
function getPath(root, ref) {
  const parts = String(ref).split('.');
  const head = parts[0];
  let cur = head === 'event' || head === 'prev' ? root[head] : undefined;
  for (let i = 1; i < parts.length; i++) {
    if (cur == null) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

/** Resolve one value against { event, prev }. Records each ref it resolved into `from` (path → ref). */
function resolveValue(val, ctx, path, from) {
  if (typeof val === 'string') {
    const full = val.match(FULL_REF);
    if (full) {
      const ref = full[1];
      from[path] = ref;
      const got = getPath(ctx, ref);
      return got === undefined ? '' : got; // missing ref → '' (deterministic; never undefined in the plan)
    }
    if (EMBED_REF.test(val)) {
      EMBED_REF.lastIndex = 0;
      const refs = [];
      const out = val.replace(EMBED_REF, (_m, ref) => {
        refs.push(ref);
        const got = getPath(ctx, ref);
        return got === undefined || got === null ? '' : String(got);
      });
      if (refs.length) from[path] = refs.length === 1 ? refs[0] : refs.slice();
      return out;
    }
    return val;
  }
  if (Array.isArray(val)) return val.map((v, i) => resolveValue(v, ctx, `${path}[${i}]`, from));
  if (isObj(val)) {
    const o = {};
    for (const k of Object.keys(val)) o[k] = resolveValue(val[k], ctx, path ? `${path}.${k}` : k, from);
    return o;
  }
  return val;
}

/** Resolve a step's params object against { event, prev }. Returns { params, resolvedFrom }. */
function resolveParams(params, ctx) {
  const from = {};
  const resolved = isObj(params) ? resolveValue(params, ctx, '', from) : {};
  return { params: resolved, resolvedFrom: from };
}

// ── shape validation (soft-fail) ────────────────────────────────────────────────────────────────────────

function validateFlow(def) {
  if (!isObj(def)) return { ok: false, error: 'flow must be an object' };
  const id = clean(def.id);
  if (!id) return { ok: false, error: 'flow.id is required' };
  const trigger = clean(def.trigger);
  if (!trigger) return { ok: false, error: `flow "${id}": trigger event name is required` };
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    return { ok: false, error: `flow "${id}": steps must be a non-empty array` };
  }
  const steps = [];
  for (let i = 0; i < def.steps.length; i++) {
    const s = def.steps[i];
    if (!isObj(s)) return { ok: false, error: `flow "${id}": step ${i} must be an object` };
    const action = clean(s.action);
    if (!action) return { ok: false, error: `flow "${id}": step ${i} needs an action` };
    if (s.params != null && !isObj(s.params)) {
      return { ok: false, error: `flow "${id}": step ${i} params must be an object` };
    }
    steps.push({ action, params: isObj(s.params) ? s.params : {} });
  }
  return { ok: true, flow: { id, name: clean(def.name) || id, trigger, steps } };
}

// ── the factory ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * createFlows({ storage, now }) → the automation-flows engine.
 * @param {object}   [storage]  injectable store (defaults to in-memory memStorage()).
 * @param {function} [now]      injected clock returning a timestamp (defaults to Date.now; inject for tests).
 */
export function createFlows({ storage, now } = {}) {
  const store = storage || memStorage();
  const clock = typeof now === 'function' ? now : () => Date.now();
  let runSeq = 0;

  /** Define (or replace) a flow. Validates shape; soft-fails to { ok:false, error } — never throws. */
  function defineFlow(def) {
    const v = validateFlow(def);
    if (!v.ok) return v;
    const flow = { ...v.flow, enabled: true, definedAt: clock() };
    try { store.saveFlow(flow); } catch (e) { return { ok: false, error: esc(String((e && e.message) || e)) }; }
    return { ok: true, flow };
  }

  function listFlows() {
    try { return store.allFlows(); } catch { return []; }
  }
  function getFlow(id) {
    try { return store.getFlow(id); } catch { return null; }
  }

  function setEnabled(id, enabled) {
    const flow = getFlow(id);
    if (!flow) return { ok: false, error: `no flow "${clean(id)}"` };
    const next = { ...flow, enabled: !!enabled };
    try { store.saveFlow(next); } catch (e) { return { ok: false, error: esc(String((e && e.message) || e)) }; }
    return { ok: true, flow: next };
  }
  const disableFlow = (id) => setEnabled(id, false);
  const enableFlow = (id) => setEnabled(id, true);

  /**
   * Run a flow against an event: PLAN the ordered actions (dry-run) and record the run in history.
   * With `executors` injected, each step's action fn is invoked and its return becomes that step's output
   * (feeding `{{prev.*}}`); without it, the resolved params double as the output so chaining still works.
   * Soft-fails to a shaped { ok:false } — never throws.
   */
  function run(flowId, event = {}, opts = {}) {
    const flow = getFlow(flowId);
    if (!flow) return { ok: false, error: `no flow "${clean(flowId)}"`, actions: [] };
    const executors = isObj(opts.executors) ? opts.executors : null;
    const ev = isObj(event) ? event : {};

    const actions = [];
    let prev = {};
    let dispatched = false;
    for (let idx = 0; idx < flow.steps.length; idx++) {
      const step = flow.steps[idx];
      const { params, resolvedFrom } = resolveParams(step.params, { event: ev, prev });
      actions.push({ step: idx, action: step.action, params, resolvedFrom });

      let output = params; // dry-run default: resolved params are the step's output
      const fn = executors && executors[step.action];
      if (typeof fn === 'function') {
        dispatched = true;
        try {
          const r = fn(params, { event: ev, prev, step: idx, flow });
          if (r !== undefined) output = r;
        } catch { /* soft-fail one executor; keep planning */ }
      }
      prev = isObj(output) ? output : { value: output };
    }

    const runRec = {
      id: `run-${++runSeq}`,
      flowId: flow.id,
      trigger: flow.trigger,
      at: clock(),
      dispatched,
      event: ev,
      actions,
    };
    try { store.addRun(runRec); } catch { /* history is best-effort */ }
    return { ok: true, flowId: flow.id, runId: runRec.id, dispatched, actions };
  }

  /**
   * Fire an event: run every ENABLED flow whose trigger matches `eventName`, in definition order.
   * Returns { ok, event, ran:[{flowId,...run}] } collecting each plan. Never throws.
   */
  function trigger(eventName, payload = {}, opts = {}) {
    const name = clean(eventName);
    const matches = listFlows().filter((f) => f && f.enabled && f.trigger === name);
    const ran = matches.map((f) => run(f.id, payload, opts));
    return { ok: true, event: name, count: ran.length, ran };
  }

  /** Past runs, newest-last as recorded. Optional { flowId } filter. Never throws. */
  function history(filter = {}) {
    let runs = [];
    try { runs = store.listRuns(); } catch { runs = []; }
    const fid = clean(filter && filter.flowId);
    return fid ? runs.filter((r) => r && r.flowId === fid) : runs;
  }

  return {
    defineFlow, run, trigger,
    listFlows, getFlow, history,
    disableFlow, enableFlow,
    _store: store,
  };
}

// ── optional tiny HTTP surface ──────────────────────────────────────────────────────────────────────────
// A single process-wide engine for a daemon to poke. POST /api/flows {id,name,trigger,steps} → define;
// POST /api/trigger {event,payload} → collected plans; GET /api/flows → list; GET /health → { ok:true }.
// Planner only — no executors are wired here (a daemon injects those in-process via createFlows/run).

const _engine = createFlows();

function readBody(req) {
  return new Promise((resolve) => {
    try {
      if (req.body != null) return resolve(typeof req.body === 'string' ? safeJson(req.body) : req.body);
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(safeJson(data)));
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
}
function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  try {
    if (typeof res.writeHead === 'function') res.writeHead(code, { 'Content-Type': 'application/json' });
    else { res.statusCode = code; if (res.setHeader) res.setHeader('Content-Type', 'application/json'); }
  } catch { /* soft-fail headers */ }
  res.end(body);
}

/** handler(req,res) — soft-fail, JSON only. esc() is applied to any echoed error text. */
export async function handler(req, res) {
  const url = String(req.url || '');
  const method = String(req.method || 'GET').toUpperCase();
  const path = url.split('?')[0];
  try {
    if (path === '/health') return sendJson(res, 200, { ok: true, service: 'herald-flows' });
    if (path === '/api/flows' && method === 'GET') return sendJson(res, 200, { ok: true, flows: _engine.listFlows() });
    if (path === '/api/flows' && method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, _engine.defineFlow(body || {}));
    }
    if (path === '/api/trigger' && method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, _engine.trigger((body && body.event) || '', (body && body.payload) || {}));
    }
    return sendJson(res, 404, { ok: false, error: esc(`no route for ${method} ${path}`) });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: esc(String((e && e.message) || e)) });
  }
}

// ── CLI demo ────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flows = createFlows({ now: () => 0 });
  flows.defineFlow({
    id: 'lead->campaign->crosspost',
    name: 'Onboard a verified lead',
    trigger: 'lead.verified',
    steps: [
      { action: 'lead-crm.move', params: { leadId: '{{event.leadId}}', stage: 'onboarding' } },
      { action: 'campaign.advance', params: { lead: '{{prev.leadId}}', campaign: '{{event.campaignId}}' } },
      { action: 'crossposter.post', params: { ref: '{{prev.lead}}', channel: 'x' } },
    ],
  });
  const out = flows.trigger('lead.verified', { leadId: 'lead-42', campaignId: 'welcome' });
  console.log(JSON.stringify(out, null, 2));
}
