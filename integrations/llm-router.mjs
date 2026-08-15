// llm-router.mjs — provider-agnostic LLM router: FREE-first, round-robin load-balanced, with fallback
// (tasks #135 model-routing, #181 wiki LLM fallback; cost fix — spread across all free keys, don't lean on metered Gemini).
//
// One job: hand it a prompt, it tries a ladder of LLM providers (each guarded by its own env key,
// skipped if the key is absent) and returns the first good answer. It NEVER throws — on total
// failure it returns { text:'', error }. This is the swap-in for the wiki's geminiClient and for
// any other AI caller that wants resilience when Gemini is down / rate-limited / key-expired.
//
//   import { complete, availableProviders } from './integrations/llm-router.mjs';
//   const { text, provider, model } = await complete('Explain VKBT', { task: 'cheap' });
//
// CLI:   node integrations/llm-router.mjs "your prompt here"
//        node integrations/llm-router.mjs --providers          (booleans only, never key values)
//
// SECURITY: this module reads API keys from env to authenticate requests, but never prints, logs,
// or returns any key (or any portion of one). availableProviders() reports presence as a boolean.

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// ── Provider table ──────────────────────────────────────────────────────────────────────────
// kind: 'gemini' = generativelanguage REST shape; 'openai' = /chat/completions shape.
// model can be overridden per-provider via env (e.g. OPENROUTER_MODEL) — matches the existing
// geminiClient convention (GEMINI_MODEL) and OPENROUTER_INTEGRATION.md.
export const PROVIDERS = [
  {
    name: 'gemini',
    env: 'GEMINI_API_KEY',
    kind: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  },
  {
    name: 'openrouter',
    env: 'OPENROUTER_API_KEY',
    kind: 'openai',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    // OPENROUTER_INTEGRATION.md recommends a FREE Llama 4 model; overridable via OPENROUTER_MODEL.
    model: () => process.env.OPENROUTER_MODEL || 'meta-llama/llama-4-maverick:free',
    extraHeaders: {
      // OpenRouter asks for these for attribution/ranking; harmless if the values are generic.
      'HTTP-Referer': 'https://github.com/HinduTempleCoins/Bot',
      'X-Title': 'MELEK Bot',
    },
  },
  {
    name: 'github',
    env: 'GITHUB_TOKEN',
    kind: 'openai',
    // GitHub Models OpenAI-compatible endpoint.
    endpoint: 'https://models.inference.ai.azure.com/chat/completions',
    model: () => process.env.GITHUB_MODELS_MODEL || 'gpt-4o',
  },
  {
    name: 'groq',
    env: 'GROQ_API_KEY',
    kind: 'openai',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },
  {
    // KEYLESS backstop. Pollinations' text endpoint is OpenAI-compatible and needs no key, so the
    // ladder ALWAYS resolves to *some* model with zero operator key (mirrors the keyless image
    // fallback in genai-providers.mjs). Anonymous requests are heavily rate-limited (429s expected on
    // a shared IP) — it sits LAST in every order, used only when no keyed provider answers. This is
    // what unblocks keyless wiki/article generation: no GEMINI_API_KEY (or any key) needed.
    name: 'pollinations',
    env: null,                     // keyless: no env var gates it
    keyless: true,
    kind: 'openai',
    endpoint: 'https://text.pollinations.ai/openai',
    model: () => process.env.POLLINATIONS_MODEL || 'openai',
  },
];

const PROVIDER_BY_NAME = Object.fromEntries(PROVIDERS.map((p) => [p.name, p]));

// ── Routing: free providers are load-balanced first; Gemini is a metered backstop ─────────────
// The keyed FREE providers (groq, openrouter, github) sit at the HEAD of every default order and are
// rotated round-robin per call (see orderFor) so each key shares the load and stays inside its free
// tier — nothing hammers one provider. Gemini has a *metered* tier (it bills once free quota is spent),
// so it is demoted to the tail and reached ONLY if every free provider fails; pollinations (keyless)
// is the final rung so generation always resolves. Pass { prefer:'gemini' } to force Gemini when you
// explicitly want it. This is the "use all the AIs, don't fall back onto the paid one" routing.
const TASK_ORDERS = {
  default: ['groq', 'openrouter', 'github', 'gemini', 'pollinations'],
  cheap:   ['groq', 'openrouter', 'github', 'gemini', 'pollinations'],
  quality: ['github', 'openrouter', 'groq', 'gemini', 'pollinations'],
  long:    ['openrouter', 'groq', 'github', 'gemini', 'pollinations'],
};

/**
 * Is this provider usable right now? Keyless providers are always usable; keyed ones need their env
 * key present. Used by the ladder to skip dead rungs and by availableProviders() for reporting.
 */
function providerUsable(p) {
  // $0 HARD-PIN: Gemini is the ONLY metered provider (it bills once its free quota is spent). It is
  // OFF by default and only usable when the operator explicitly opts in with LLM_ALLOW_GEMINI=1.
  // The keyless Pollinations backstop still guarantees the ladder always resolves, so nothing breaks.
  if (p.name === 'gemini' && process.env.LLM_ALLOW_GEMINI !== '1') return false;
  return p.keyless ? true : Boolean(process.env[p.env]);
}

/**
 * Which providers can answer right now. Booleans ONLY — never the key value. Keyless providers
 * (e.g. pollinations) report true with no key present.
 * @returns {{ [name:string]: boolean }}
 */
export function availableProviders() {
  const out = {};
  for (const p of PROVIDERS) out[p.name] = providerUsable(p);
  return out;
}

// Round-robin cursor: rotated once per default call so the FREE head providers share the load
// (call 1 → groq first, call 2 → openrouter first, call 3 → github first, …) instead of one
// provider absorbing every request. Module-scoped on purpose; process-lifetime is the right window.
let _rr = 0;

// Providers kept at a FIXED tail (never rotated to the front by round-robin): the metered Gemini
// tier and the keyless backstop. They are only reached when the free head providers all fail.
const TAIL = new Set(['gemini', 'pollinations']);

// Test hook: reset the round-robin cursor so unit tests get deterministic ordering. Not used in prod.
export function __resetRotation() { _rr = 0; }

function orderFor({ task, prefer } = {}) {
  const base = (TASK_ORDERS[task] || TASK_ORDERS.default).slice();
  // Explicit preference wins outright (e.g. prefer:'gemini' when the caller really wants it).
  if (prefer && PROVIDER_BY_NAME[prefer]) {
    return [prefer, ...base.filter((n) => n !== prefer)];
  }
  // Load-balance the free, keyed head; keep Gemini + keyless backstop pinned to the tail.
  const head = base.filter((n) => !TAIL.has(n));
  const tail = base.filter((n) => TAIL.has(n));
  const usableHead = head.filter((n) => providerUsable(PROVIDER_BY_NAME[n]));
  if (usableHead.length > 1) {
    const shift = _rr++ % usableHead.length;
    const rotated = usableHead.slice(shift).concat(usableHead.slice(0, shift));
    const deadHead = head.filter((n) => !usableHead.includes(n)); // key-absent; skipped, kept for order
    return [...rotated, ...deadHead, ...tail];
  }
  return base;
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────────────────────
async function postJson(url, headers, body, timeout = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA, ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const textBody = await r.text();
    if (!r.ok) {
      // Surface status (incl. 429 rate-limit) so the ladder falls through; do NOT echo headers/keys.
      const err = new Error(`HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return textBody ? JSON.parse(textBody) : {};
  } finally {
    clearTimeout(t);
  }
}

// ── Per-kind callers ───────────────────────────────────────────────────────────────────────
async function callGemini(provider, key, prompt, opts) {
  const model = provider.model();
  const url = `${provider.endpoint}/${model}:generateContent`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.25,
      maxOutputTokens: opts.maxTokens ?? 4096,
    },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  // Gemini auth header — value is the key, never logged.
  const j = await postJson(url, { 'x-goog-api-key': key }, body, opts.timeout);
  const text =
    j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text.trim()) throw new Error('empty completion');
  return { text, model };
}

async function callOpenAICompatible(provider, key, prompt, opts) {
  const model = provider.model();
  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });
  const body = {
    model,
    messages,
    temperature: opts.temperature ?? 0.25,
    max_tokens: opts.maxTokens ?? 4096,
  };
  // Keyless providers (pollinations) send no Authorization header; keyed ones send Bearer <key>.
  const headers = { ...(provider.extraHeaders || {}) };
  if (key) headers.authorization = `Bearer ${key}`;
  const j = await postJson(provider.endpoint, headers, body, opts.timeout);
  const text = j?.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw new Error('empty completion');
  return { text, model };
}

function callProvider(provider, key, prompt, opts) {
  if (provider.kind === 'gemini') return callGemini(provider, key, prompt, opts);
  return callOpenAICompatible(provider, key, prompt, opts);
}

/**
 * Complete a prompt by trying a provider ladder. Never throws.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {'cheap'|'quality'|'long'} [opts.task]   routing hint (biases provider order)
 * @param {string} [opts.prefer]                   force a provider first (e.g. 'gemini')
 * @param {string} [opts.system]                   optional system instruction
 * @param {number} [opts.maxTokens]                output cap (default 4096)
 * @param {number} [opts.temperature]              default 0.25 (factual)
 * @param {number} [opts.timeout]                  per-call ms (default 30000)
 * @param {(msg:string)=>void} [opts.log]          optional logger (no keys ever passed in)
 * @returns {Promise<{text:string, provider?:string, model?:string, error?:string, attempts?:Array}>}
 */
export async function complete(prompt, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const order = orderFor(opts);
  const attempts = [];

  for (const name of order) {
    const provider = PROVIDER_BY_NAME[name];
    if (!provider) continue;
    const key = provider.keyless ? '' : process.env[provider.env];
    if (!provider.keyless && !key) {
      attempts.push({ provider: name, skipped: 'no-key' });
      log(`[llm-router] ${name}: skipped (key absent)`);
      continue;
    }
    try {
      log(`[llm-router] ${name}: trying…`);
      const { text, model } = await callProvider(provider, key, prompt, opts);
      log(`[llm-router] ${name}: ok (${model})`);
      attempts.push({ provider: name, ok: true });
      return { text, provider: name, model, attempts };
    } catch (e) {
      const reason = e?.status ? `HTTP ${e.status}` : e?.message || 'error';
      attempts.push({ provider: name, error: reason });
      log(`[llm-router] ${name}: failed (${reason}) — falling through`);
    }
  }

  return {
    text: '',
    error: 'all providers failed or no keys present',
    attempts,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('llm-router.mjs');

if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === '--providers' || args[0] === '-p') {
    // Booleans only — never key values.
    console.log(JSON.stringify(availableProviders(), null, 2));
    process.exit(0);
  }
  const prompt = args.filter((a) => !a.startsWith('--')).join(' ').trim();
  if (!prompt) {
    console.error('usage: node integrations/llm-router.mjs "your prompt"   [--task cheap|quality|long] [--prefer gemini]');
    console.error('       node integrations/llm-router.mjs --providers');
    process.exit(1);
  }
  const task = (args[args.indexOf('--task') + 1] && args.includes('--task')) ? args[args.indexOf('--task') + 1] : undefined;
  const prefer = (args.includes('--prefer')) ? args[args.indexOf('--prefer') + 1] : undefined;

  console.error('[llm-router] providers present:', JSON.stringify(availableProviders()));
  const res = await complete(prompt, { task, prefer, log: (m) => console.error(m) });
  if (res.error) {
    console.error(`\n✗ ${res.error}`);
    console.error('  attempts:', JSON.stringify(res.attempts));
    process.exit(2);
  }
  console.error(`\n✓ answered by ${res.provider} (${res.model})\n`);
  console.log(res.text);
}
