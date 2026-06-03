// private-assistant.mjs — the private-assistant core (task #133).
//
// The OpenClaw-on-free-VPS + local-Ollama idea: a provider-agnostic assistant orchestrator that
// routes between a LOCAL model (Ollama) and capability tools, and is PRIVACY-FIRST by construction.
//
// The governing rule: data stays LOCAL by default. `cloudAllowed` defaults to false; while it is
// false, ask() NEVER routes to a cloud model — not even when the local model signals low confidence.
// A cloud escalation can only happen when the operator has explicitly flipped cloudAllowed to true.
// This is the whole point of the module, and the tests assert it.
//
// Write-capable tools (calendar.write, email.send, …) NEVER auto-execute. A side-effecting tool run
// without an explicit { confirm:true } returns { ok:false, needsConfirm:true } and does nothing.
//
// Everything is injectable so the whole thing runs offline in tests:
//   • the local model is a function (prompt, {context}) → { text, confidence } — default is a stub.
//   • cloud is reached via llm-router.complete() (defensive import), wired only when allowed.
//   • tools are injected/registered; no live network, no secrets, in this file.
//
//   import { createAssistant } from './integrations/private-assistant.mjs';
//   const a = createAssistant();                       // local-only, private
//   const r = await a.ask('summarize my day');         // { answer, usedModel:'local', private:true }
//   a.registerTool('email.send', sendFn, { sideEffects:true });
//   await a.run('email.send', args);                   // { ok:false, needsConfirm:true } — refused
//   await a.run('email.send', args, { confirm:true }); // executes
//
// CLI:  node integrations/private-assistant.mjs "your prompt"        (local stub only; never cloud)

// ── defensive import of the cloud executor (llm-router) ────────────────────────────────────────
// We import lazily + defensively so this module loads even if llm-router is absent or changes shape.
// The cloud path is ONLY ever taken when cloudAllowed is true; if the import fails we soft-fail back
// to the local answer rather than throwing.
let _cloudComplete = null;
async function cloudComplete(prompt, opts) {
  if (_cloudComplete === null) {
    try {
      const mod = await import('./llm-router.mjs');
      _cloudComplete = typeof mod.complete === 'function' ? mod.complete : false;
    } catch {
      _cloudComplete = false;
    }
  }
  if (!_cloudComplete) return null;
  try {
    const r = await _cloudComplete(prompt, opts);
    if (r == null) return null;
    // llm-router.complete() returns { text }; an injected fake may return a raw string.
    if (typeof r === 'string') return r;
    return r.text ? r.text : null;
  } catch {
    return null;
  }
}
// Test seam: allow injecting a fake cloud completer (so cloud-escalation is testable offline).
export function __setCloudComplete(fn) {
  _cloudComplete = typeof fn === 'function' ? fn : null;
}

// ── default LOCAL model: an offline stub ───────────────────────────────────────────────────────
// Production wires Ollama in its place via createAssistant({ model }) or assistant.__setModel(fn).
// A model fn receives (prompt, { context }) and returns { text, confidence } where confidence is in
// [0,1]. A return of just a string is tolerated and treated as high confidence.
function defaultLocalModel(prompt) {
  return {
    text: `[local stub] ${String(prompt || '').slice(0, 200)}`,
    confidence: 1,
  };
}

// Below this confidence, the local answer is considered "low confidence" and is eligible for a
// cloud escalation — but ONLY if cloudAllowed is true. Overridable per-assistant.
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

function normalizeModelResult(res) {
  if (res == null) return { text: '', confidence: 0 };
  if (typeof res === 'string') return { text: res, confidence: 1 };
  const text = typeof res.text === 'string' ? res.text : '';
  let confidence = typeof res.confidence === 'number' ? res.confidence : 1;
  if (!Number.isFinite(confidence)) confidence = 1;
  confidence = Math.max(0, Math.min(1, confidence));
  return { text, confidence };
}

/**
 * Create a privacy-first assistant instance.
 *
 * @param {object}   [opts]
 * @param {Function} [opts.model]              local model: (prompt,{context}) => {text,confidence}
 * @param {object}   [opts.tools]             { name: fn | { fn, sideEffects } } pre-registered tools
 * @param {boolean}  [opts.cloudAllowed=false] PRIVACY GATE. false ⇒ never routes to a cloud model.
 * @param {number}   [opts.confidenceThreshold] below this, local answer is "low confidence"
 * @returns assistant instance
 */
export function createAssistant({
  model = defaultLocalModel,
  tools = {},
  cloudAllowed = false,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
} = {}) {
  let _model = typeof model === 'function' ? model : defaultLocalModel;
  const _cloudAllowed = Boolean(cloudAllowed);
  const _threshold = Number.isFinite(confidenceThreshold) ? confidenceThreshold : DEFAULT_CONFIDENCE_THRESHOLD;

  // tool registry: name → { fn, sideEffects:boolean }
  const _tools = new Map();
  function registerTool(name, fn, { sideEffects = false } = {}) {
    if (!name || typeof name !== 'string') throw new Error('registerTool: name is required');
    if (typeof fn !== 'function') throw new Error(`registerTool(${name}): fn must be a function`);
    _tools.set(name, { fn, sideEffects: Boolean(sideEffects) });
    return name;
  }
  // ingest pre-registered tools
  for (const [name, spec] of Object.entries(tools || {})) {
    if (typeof spec === 'function') registerTool(name, spec, { sideEffects: false });
    else if (spec && typeof spec.fn === 'function') registerTool(name, spec.fn, { sideEffects: spec.sideEffects });
  }

  /**
   * Ask the assistant. Routes LOCAL first; escalates to cloud ONLY if cloudAllowed AND the local
   * answer is low-confidence. Never throws — soft-fails to whatever local produced.
   * @returns {Promise<{answer:string, usedModel:'local'|'cloud', private:boolean, confidence:number}>}
   */
  async function ask(prompt, { context = null } = {}) {
    let local;
    try {
      local = normalizeModelResult(await _model(prompt, { context }));
    } catch {
      local = { text: '', confidence: 0 };
    }

    const lowConfidence = local.confidence < _threshold;

    // PRIVACY GATE — the load-bearing assertion of this module. If cloud is not explicitly allowed,
    // we return the local answer NO MATTER how low its confidence is. Data never leaves the host.
    if (!_cloudAllowed || !lowConfidence) {
      return { answer: local.text, usedModel: 'local', private: true, confidence: local.confidence };
    }

    // cloudAllowed AND low confidence → escalate. The operator has opted in to cloud for this run.
    const cloudText = await cloudComplete(prompt, { context });
    if (cloudText && cloudText.trim()) {
      return { answer: cloudText, usedModel: 'cloud', private: false, confidence: local.confidence };
    }
    // Cloud unavailable / failed → soft-fall back to the local answer (still private).
    return { answer: local.text, usedModel: 'local', private: true, confidence: local.confidence };
  }

  /**
   * Run a registered capability tool. Side-effecting tools require an explicit { confirm:true }.
   * Without confirm, a write tool returns { ok:false, needsConfirm:true } and does NOT execute.
   * @returns {Promise<{ok:boolean, result?:*, needsConfirm?:boolean, error?:string}>}
   */
  async function run(toolName, args = {}, { confirm = false } = {}) {
    const tool = _tools.get(toolName);
    if (!tool) return { ok: false, error: `unknown tool: ${toolName}` };

    // Never auto-execute writes. The operator confirms every side-effecting action.
    if (tool.sideEffects && !confirm) {
      return { ok: false, needsConfirm: true, tool: toolName };
    }

    try {
      const result = await tool.fn(args);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e?.message || 'tool failed' };
    }
  }

  /** Test/production seam: swap the local model after construction. */
  function __setModel(fn) {
    _model = typeof fn === 'function' ? fn : defaultLocalModel;
  }

  return {
    ask,
    run,
    registerTool,
    __setModel,
    get cloudAllowed() { return _cloudAllowed; },
    get tools() { return [..._tools.keys()]; },
    _isSideEffecting(name) { return Boolean(_tools.get(name)?.sideEffects); },
  };
}

/**
 * Audit view of an assistant's privacy posture. localOnly is true exactly when cloud is disallowed.
 * @returns {{ cloudAllowed:boolean, localOnly:boolean, tools:string[] }}
 */
export function privacyPosture(assistant) {
  const cloudAllowed = Boolean(assistant?.cloudAllowed);
  return {
    cloudAllowed,
    localOnly: !cloudAllowed,
    tools: Array.isArray(assistant?.tools) ? assistant.tools.slice() : [],
  };
}

// ── CLI (guarded) — local stub only; NEVER reaches cloud (cloudAllowed defaults false) ─────────
if (process.argv[1] && process.argv[1].endsWith('private-assistant.mjs')) {
  const prompt = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim()
    || 'Hello — what can you do privately?';
  const a = createAssistant(); // local-only by construction
  const res = await a.ask(prompt);
  console.log(JSON.stringify({ ...res, posture: privacyPosture(a) }, null, 2));
}
