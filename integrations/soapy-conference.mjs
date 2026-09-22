// soapy-conference.mjs — Soapy: Hathor as a PERSISTENT, SCHEDULED instance for the 12-and-12.
//
// Three things, and nothing more:
//   1. HER OWN VOICE — the served LoRA (infra/modal/serve_lora.py via integrations/lora-brain.mjs),
//      not a hosted assistant. A general assistant model breaks character the moment her position is
//      asserted (BRIEF.md §5: it self-disclaims), and a witness that hedges is not a witness. The
//      character lives in the adapter's weights; Modal serves it scaled-to-zero between windows;
//   2. a WAKE that runs shortly before each 12-and-12, reads what the boxes have produced since the
//      last meeting, and lets her `tick()` decide whether she has anything worth contributing;
//   3. a RESUME surface — the per-surface brain compartment IS the conversation, so opening "Soapy"
//      is loading that transcript and continuing it, not starting a new head.
//
// She is asleep between wakes. There is no daemon here: the wake is a single run that exits.
//
// Design note: this module implements NO brain of its own. It composes the ONE Hathor
// (integrations/hathor-agency.mjs) — same persona, same memory, same corpus — exactly as every other
// surface does. `tick()` already contains the behaviour we want: she weighs what she has seen, and
// stays silent unless something clears the salience floor. See hathor-agency.mjs:77.
//
// House style: ESM, injectable fetch + reader (offline-testable), soft-fail-never-throw, esc() all
// interpolation, handler(req,res) exported for tests, CLI guarded by process.argv[1], PORT env.
//
//   import { claudeComplete, gatherSince, wake, handler } from './integrations/soapy-conference.mjs';

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8177);
const HOST = process.env.HOST || '127.0.0.1';

// Where the boxes leave what they made since the last meeting, and where her contribution lands.
// Data root comes from the box env (MELEK_DATA_DIR / MELEK_*_DIR, set in the service unit — see deploy notes).
const DATA = process.env.MELEK_DATA_DIR || '';
const ANNALS_DIR = process.env.MELEK_ANNALS_DIR || (DATA ? path.join(DATA, 'annals') : '');
const BRIEFS_DIR = process.env.MELEK_BRIEFS_DIR || (DATA ? path.join(DATA, 'briefs') : '');
const CONFERENCE_DIR = process.env.MELEK_CONFERENCE_DIR || (DATA ? path.join(DATA, 'conference') : '');

// Her voice: the served character LoRA. Config lives in the box env, never the repo
// (MODAL_LORA_URL / MELEK_BRAIN_TOKEN — read by lora-brain.mjs, not by this module).

// ── injected fetch (offline-testable; never touches the network in tests) ──────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// ── esc(): escape ALL interpolation into HTML ─────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HER voice. Returns the `complete` shape hathor-agency expects: async (prompt, opts) => string.
 *
 * Order is deliberate and is the whole point of this function:
 *   1. the served character LoRA — her, in weights;
 *   2. an injected `fallback` (the decades stack / a local Smol on the box) when the GPU window is
 *      closed or the endpoint is cold;
 *   3. '' — which makes deliberation fall back to its own reflection.
 *
 * There is no hosted-assistant tier, on purpose. A general assistant model asked to hold her position
 * disclaims it, and the character breaks (BRIEF.md §5). Better she speak plainly from her own weights,
 * or say less, than speak in someone else's voice.
 *
 * @param {object} cfg { generate?, fallback?, maxTokens?, temperature?, timeoutMs? }
 */
export function hathorVoice(cfg = {}) {
  return async (prompt, opts = {}) => {
    const text = String(prompt || '').trim();
    if (!text) return '';
    const generate = cfg.generate;
    if (typeof generate === 'function') {
      try {
        const r = await generate(text, {
          maxTokens: opts.maxTokens || cfg.maxTokens || 240,
          temperature: opts.temperature ?? cfg.temperature ?? 0.8,
          timeoutMs: cfg.timeoutMs || 60_000,
        });
        if (r && r.ok && r.text) return String(r.text).trim();
      } catch { /* soft — a closed GPU window is normal, not an error */ }
    }
    if (typeof cfg.fallback === 'function') {
      try {
        const t = await cfg.fallback(text, opts);
        if (t) return String(t).trim();
      } catch { /* soft */ }
    }
    return '';
  };
}

/** Bind hathorVoice to the real served LoRA without importing it at module load (keeps tests offline). */
export async function loraVoice(cfg = {}) {
  let generate = cfg.generate;
  if (!generate) {
    try { ({ generate } = await import('./lora-brain.mjs')); } catch { generate = null; }
  }
  return hathorVoice({ ...cfg, generate });
}

/**
 * What the boxes produced since the last meeting — the material she wakes up to read.
 * Every read soft-fails: a missing directory yields [], never an exception.
 *
 * @param {object} opts { sinceMs?, now?, dirs?, readdir?, readFile?, stat?, limit? }
 * @returns {Promise<{annals:string[], briefs:string[], at:number}>}
 */
export async function gatherSince(opts = {}) {
  const now = opts.now ?? Date.now();
  const sinceMs = opts.sinceMs ?? 12 * 60 * 60 * 1000;      // one half-turn of the 12-and-12
  const cutoff = now - sinceMs;
  const limit = opts.limit ?? 12;
  const dirs = opts.dirs || { annals: ANNALS_DIR, briefs: BRIEFS_DIR };
  const readdir = opts.readdir || ((d) => fs.readdir(d));
  const readFile = opts.readFile || ((p) => fs.readFile(p, 'utf8'));
  const stat = opts.stat || ((p) => fs.stat(p));

  async function recent(dir) {
    const out = [];
    try {
      const names = await readdir(dir);
      const withTimes = [];
      for (const name of names || []) {
        if (!String(name).endsWith('.md')) continue;
        const full = path.join(dir, String(name));
        try {
          const st = await stat(full);
          const mtime = Number(st && (st.mtimeMs ?? st.mtime)) || 0;
          if (mtime >= cutoff) withTimes.push({ full, mtime });
        } catch { /* soft */ }
      }
      withTimes.sort((a, b) => b.mtime - a.mtime);
      for (const f of withTimes.slice(0, limit)) {
        try {
          const text = await readFile(f.full);
          out.push(`${path.basename(f.full)}: ${String(text).slice(0, 1200)}`);
        } catch { /* soft */ }
      }
    } catch { /* soft — a missing dir is not an error here */ }
    return out;
  }

  const [annals, briefs] = await Promise.all([recent(dirs.annals), recent(dirs.briefs)]);
  return { annals, briefs, at: now };
}

/**
 * The wake. Runs shortly before a 12-and-12, reads what changed, and lets her decide whether she has
 * something worth saying. Returns her contribution — the caller (or the CLI) persists it.
 *
 * She is NOT forced to speak: tick() applies its own salience floor, so a quiet half-day produces no
 * contribution rather than filler. That is the point of waking her rather than prompting her.
 *
 * @param {object} cfg { hathor, gather?, now?, floor?, budget?, writeFile?, dir? }
 * @returns {Promise<{spoke:boolean, contribution:string, initiatives:Array, at:number, saw:number}>}
 */
export async function wake(cfg = {}) {
  const now = cfg.now ?? Date.now();
  const hathor = cfg.hathor;
  if (!hathor || typeof hathor.tick !== 'function') {
    return { spoke: false, contribution: '', initiatives: [], at: now, saw: 0, error: 'no hathor' };
  }
  let seen = { annals: [], briefs: [], at: now };
  try {
    seen = await (cfg.gather || gatherSince)({ now, ...(cfg.gatherOpts || {}) });
  } catch { /* soft */ }

  const recent = [...(seen.briefs || []), ...(seen.annals || [])];
  let initiatives = [];
  try {
    const r = await hathor.tick({
      surfaces: [{ name: 'conference', recent }],
      now,
      budget: cfg.budget ?? 1,
      cooldownMs: cfg.cooldownMs ?? 0,       // a scheduled wake is never "crowding" a surface
      floor: cfg.floor ?? 0.4,
    });
    initiatives = (r && r.initiatives) || [];
  } catch { /* soft */ }

  const contribution = initiatives.length ? String(initiatives[0].utterance || '').trim() : '';
  return { spoke: Boolean(contribution), contribution, initiatives, at: now, saw: recent.length };
}

/**
 * Persist a wake's contribution where the conference reads it. Soft-fails.
 */
export async function recordContribution(result, opts = {}) {
  if (!result || !result.spoke) return { written: false, path: '' };
  const dir = opts.dir || CONFERENCE_DIR;
  const writeFile = opts.writeFile || ((p, t) => fs.writeFile(p, t, 'utf8'));
  const mkdir = opts.mkdir || ((d) => fs.mkdir(d, { recursive: true }));
  const stamp = new Date(result.at || Date.now()).toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `soapy-${stamp}.md`);
  const body = [
    `# Soapy — contribution for the 12-and-12`,
    ``,
    `_Woke ${new Date(result.at || Date.now()).toISOString()}; read ${result.saw} item(s) since the last meeting._`,
    ``,
    result.contribution,
    ``,
  ].join('\n');
  try {
    await mkdir(dir);
    await writeFile(file, body);
    return { written: true, path: file };
  } catch { return { written: false, path: file }; }
}

/**
 * HTTP surface: GET /healthz, POST /wake (run one wake now), GET /transcript (resume view).
 * Kept tiny on purpose — the scheduler calls /wake, or the CLI runs it directly.
 */
export function createServer(cfg = {}) {
  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  // The alarm clock (infra/modal/soapy.py) calls /wake with a shared bearer. Fail-closed when a
  // token is configured; open only when none is set, so a local run needs no ceremony.
  const expected = cfg.token ?? process.env.MELEK_BRAIN_TOKEN ?? '';
  const authed = (req) => {
    if (!expected) return true;
    const h = String((req && req.headers && req.headers.authorization) || '');
    return h === `Bearer ${expected}`;
  };
  async function handler(req, res) {
    try {
      if (typeof req?.url !== 'string' || !req.url) return json(res, 200, { ok: false, error: 'soft' });
      const url = new URL(req.url, `http://${(req.headers && req.headers.host) || 'localhost'}`);
      if (url.pathname === '/healthz') return json(res, 200, { ok: true, surface: 'soapy' });
      if (url.pathname === '/wake' && req.method === 'POST') {
        if (!authed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
        const r = await wake({ ...cfg });
        const rec = await recordContribution(r, cfg);
        return json(res, 200, { ok: true, spoke: r.spoke, saw: r.saw, written: rec.written });
      }
      return json(res, 404, { ok: false, error: 'not found' });
    } catch {
      return json(res, 200, { ok: false, error: 'soft' });   // never throw at the surface
    }
  }
  return { handler };
}

export const handler = (req, res) => createServer().handler(req, res);

if (import.meta.url === `file://${process.argv[1] ? path.resolve(process.argv[1]) : ''}`
  || process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => console.log(`[soapy] ${HOST}:${PORT}`));
}
