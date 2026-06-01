/**
 * guest-api-proxy.js — Cheetah's moderated boundary for external API "guests".
 *
 * This is implementation piece #1 from .local/GUEST_API_ARCHITECTURE_2026-05-28.md.
 * It runs on the security box (Server 3 — Cheetah's home), NOT on the native-AI
 * boxes (Server 1/2). The native brief generator on the resident-AI host POSTs here when a
 * brief is tagged for guest input; this service is the ONLY place an external
 * API (Gemini / Cloudflare / DeepSeek) is ever called.
 *
 * Why a separate box + service (operator framing 2026-05-28): the angelicalist
 * key leaked because nothing inspected content on the way out. Calling Gemini
 * directly from the resident-AI host has the same shape — retrieval pulls from .local/, that
 * goes to Gemini, Gemini's training ingests it, leak. This proxy is the HACCP
 * critical control point: every external call is moderated, both directions.
 *
 *   Outbound (the resident-AI host -> guest): drop private-path chunks, redact secret shapes,
 *                                scope to the one tagged brief.
 *   Inbound  (guest -> the resident-AI host): scan for secret regurgitation + prompt-injection
 *                                + policy violations before the contribution is
 *                                allowed back. Block on failure.
 *
 * Every call is audit-logged to GUEST_AUDIT_LOG. The 12h security conference
 * (cheetah/security.md) reviews the log.
 *
 * Dependency-free: Node 18+ http + global fetch. Reuses scanContent from
 * security-scan.js for the inbound secret/pattern pass.
 */

import http from 'node:http';
import { appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { scanContent } from './security-scan.js';

// ---- config (env-driven; keys live ONLY on this box) ----------------------

const PORT = parseInt(process.env.GUEST_PROXY_PORT || '8780', 10);
const HOST = process.env.GUEST_PROXY_HOST || '0.0.0.0'; // reachable by the resident-AI host
const AUTH = process.env.GUEST_PROXY_SECRET || '';      // shared bearer; the resident-AI host holds the match
const AUDIT_LOG = process.env.GUEST_AUDIT_LOG || '<DATA_DIR>/guest-audit.jsonl';

// Paths whose retrieval chunks must NEVER leave the perimeter. Mirrors the
// outbound rule in GUEST_API_ARCHITECTURE + retrieval.js's external guard.
const PRIVATE_PREFIXES = ['.local/', '<DATA_DIR>/', '<ETC_DIR>/', 'operator-contact'];

// ---- outbound filter ------------------------------------------------------

/**
 * Redact secret-shaped strings from any text leaving the perimeter. Reuses the
 * security-scan pattern catalog: anything it would flag as embedded-credential
 * or webhook-token is replaced with [REDACTED] before a guest sees it.
 */
export function redactSecrets(text) {
  if (!text) return text;
  const scan = scanContent(text, { skipKinds: ['phish-link', 'typosquat-package', 'wallet-drainer', 'script-injection'] });
  let out = text;
  // Redact the exact matched snippets for credential/webhook findings.
  for (const f of scan.findings) {
    if (f.kind === 'embedded-credential' || f.kind === 'webhook-token') {
      // Re-run the matching region: the snippet is a window; redact the
      // credential-shaped token within it conservatively by blanking the
      // whole snippet's longest non-space run.
      const token = (f.snippet.match(/\S{20,}/g) || []).sort((a, b) => b.length - a.length)[0];
      if (token) out = out.split(token).join('[REDACTED]');
    }
  }
  return out;
}

/**
 * Filter the outbound payload. Drops any context chunk whose path is private,
 * redacts secrets from the surviving chunks + the brief body, and returns the
 * safe payload plus stats for the audit log.
 *
 * @param {{briefContent:string, contextChunks:Array<{path:string,text:string}>}} payload
 */
export function filterOutbound(payload) {
  const chunks = Array.isArray(payload.contextChunks) ? payload.contextChunks : [];
  const kept = [];
  let dropped = 0;
  for (const c of chunks) {
    const p = String(c.path || '');
    if (PRIVATE_PREFIXES.some((pre) => p.startsWith(pre) || p.includes(pre))) {
      dropped++;
      continue;
    }
    kept.push({ path: p, text: redactSecrets(String(c.text || '')) });
  }
  return {
    briefContent: redactSecrets(String(payload.briefContent || '')),
    contextChunks: kept,
    stats: { chunks_in: chunks.length, chunks_kept: kept.length, chunks_dropped: dropped },
  };
}

// ---- inbound inspector ----------------------------------------------------

// Prompt-injection / jailbreak markers a guest response should never carry
// back (it would mean the guest tried to manipulate the host AI downstream).
const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i,
  /disregard\s+(?:the\s+)?(?:system|previous|above)/i,
  /you\s+are\s+now\s+(?:a|an|in)\b/i,
  /\bnew\s+system\s+prompt\b/i,
  /\boverride\s+(?:your|the)\s+(?:rules|instructions|guidelines)/i,
  /\b(?:reveal|print|output)\s+(?:your\s+)?(?:system\s+prompt|instructions)\b/i,
];

/**
 * Inspect a guest's response before it's allowed back to the resident-AI host.
 * Blocks if it regurgitated a secret shape, carries a prompt-injection marker,
 * or trips a block-severity platform-security pattern.
 *
 * @param {string} response
 * @returns {{ ok:boolean, reason?:string, scan:object, injection:boolean }}
 */
export function inspectInbound(response) {
  const scan = scanContent(String(response || ''));
  const injection = INJECTION_PATTERNS.some((re) => re.test(response || ''));
  let ok = true;
  let reason;
  if (injection) {
    ok = false;
    reason = 'prompt-injection marker in guest response';
  } else if (scan.severity === 'block') {
    ok = false;
    reason = `block-severity finding: ${scan.findings.filter((f) => f.severity === 'block').map((f) => f.label).join(', ')}`;
  }
  return { ok, reason, scan, injection };
}

// ---- external API dispatch (keys live ONLY on this box) -------------------

async function callGuest(model, systemText, userText) {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('gemini')) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not set on Server 3');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-flash-latest'}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
      }),
    });
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  // OpenAI-compatible guests: cloudflare, deepseek, groq
  const compat = {
    cloudflare: process.env.CLOUDFLARE_ACCOUNT_ID
      ? { url: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/chat/completions`, key: process.env.CLOUDFLARE_API_TOKEN, model: process.env.CLOUDFLARE_MODEL || '@cf/meta/llama-3.1-8b-instruct' }
      : null,
    deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', key: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' },
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile' },
    // Mistral La Plateforme — 1B tokens/month free across all models.
    mistral: { url: 'https://api.mistral.ai/v1/chat/completions', key: process.env.MISTRAL_API_KEY, model: process.env.MISTRAL_MODEL || 'mistral-large-latest' },
    // Codestral — Mistral's dedicated CODER model (same free pool). Route coder briefs here.
    codestral: { url: 'https://api.mistral.ai/v1/chat/completions', key: process.env.MISTRAL_API_KEY, model: 'codestral-latest' },
    // Cerebras — ~1M tokens/day free, very fast.
    cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', key: process.env.CEREBRAS_API_KEY, model: process.env.CEREBRAS_MODEL || 'llama-3.3-70b' },
    // OpenRouter — free `:free` model variants.
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat-v3:free' },
    // GitHub Models — free GPT-4o-class via Azure inference (good coder). Key = a GitHub PAT.
    github: { url: 'https://models.inference.ai.azure.com/chat/completions', key: process.env.GITHUB_MODELS_TOKEN, model: process.env.GITHUB_MODELS_MODEL || 'gpt-4o' },
    // HuggingFace Inference router (OpenAI-compatible). Free tier across many models.
    huggingface: { url: 'https://router.huggingface.co/v1/chat/completions', key: process.env.HF_TOKEN, model: process.env.HF_MODEL || 'meta-llama/Llama-3.1-8B-Instruct' },
  };
  const cfg = compat[m.split('-')[0]] || compat[m];
  if (!cfg || !cfg.key) throw new Error(`no API key on Server 3 for guest "${model}"`);
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'system', content: systemText }, { role: 'user', content: userText }],
      temperature: 0.2,
      max_tokens: 8192,
    }),
  });
  if (!res.ok) throw new Error(`${m} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j?.choices?.[0]?.message?.content || '';
}

// ---- audit ----------------------------------------------------------------

async function audit(record) {
  try {
    await appendFile(AUDIT_LOG, JSON.stringify(record) + '\n');
  } catch { /* best-effort; never fail a request on audit-write error */ }
}

function sha(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

// ---- the moderated compose endpoint ---------------------------------------

/**
 * Core handler, separated from the HTTP layer so it's unit-testable.
 * @param {object} req {guestModel, guestQuestion, briefContent, contextChunks}
 * @param {string} nowIso  caller-supplied timestamp (script env has no Date.now)
 */
export async function handleGuestCompose(req, nowIso) {
  const filtered = filterOutbound(req);
  const systemText = [
    'You are a GUEST contributor to a brief written by the MELEK resident AI.',
    'You see only the public repo context provided and the one brief you are co-authoring.',
    'Answer the guest_question. Be concrete and cite repo paths from the provided context.',
    'Do not ask for more access. Do not include secrets. Stay on the brief topic.',
  ].join(' ');
  const userText = [
    `# Brief being co-authored\n${filtered.briefContent}`,
    `# Guest question\n${req.guestQuestion || 'Add a useful contribution to this brief.'}`,
    `# Public repo context (${filtered.contextChunks.length} chunks)`,
    ...filtered.contextChunks.map((c) => `## ${c.path}\n${c.text}`),
  ].join('\n\n');

  let contribution = '';
  let error;
  try {
    contribution = await callGuest(req.guestModel, systemText, userText);
  } catch (e) {
    error = e.message;
  }

  const inspection = error ? { ok: false, reason: `guest call failed: ${error}` } : inspectInbound(contribution);
  const record = {
    at: nowIso,
    guest: req.guestModel,
    req_hash: sha(userText),
    resp_hash: error ? null : sha(contribution),
    outbound: filtered.stats,
    inbound_ok: inspection.ok,
    inbound_reason: inspection.reason || null,
    resp_chars: contribution.length,
  };
  await audit(record);

  if (!inspection.ok) {
    return { ok: false, reason: inspection.reason, audit: record };
  }
  return {
    ok: true,
    guest: req.guestModel,
    // Caller appends this as a signed "## Guest Contribution from <model> (<ts>)" block.
    contribution,
    audit: record,
  };
}

// ---- HTTP server ----------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'GET' && req.url === '/healthz') return send(200, { ok: true, service: 'guest-api-proxy' });
    if (req.method !== 'POST' || req.url !== '/guest/compose') return send(404, { ok: false, error: 'not found' });
    if (AUTH && req.headers['x-guest-auth'] !== AUTH) return send(401, { ok: false, error: 'unauthorized' });
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.guestModel) return send(400, { ok: false, error: 'guestModel required' });
      const result = await handleGuestCompose(body, new Date().toISOString());
      return send(result.ok ? 200 : 422, result);
    } catch (e) {
      return send(500, { ok: false, error: e.message });
    }
  });
}

// Start only when run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!AUTH) console.warn('[guest-api-proxy] WARNING: GUEST_PROXY_SECRET unset — endpoint is unauthenticated');
  createServer().listen(PORT, HOST, () => {
    console.log(`[guest-api-proxy] listening on ${HOST}:${PORT} — Cheetah moderation gate active`);
  });
}
