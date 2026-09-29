// media-sync.mjs — the CPU worker pushes finished media to the web host over HTTPS with the Video Studio worker token
// (no SSH between servers). Mounted under the worker API in video-studio.mjs:
//   GET /video-studio/api/worker/sync/<target>/list        → { ok, files: { relpath: size } }   (for diffing)
//   PUT /video-studio/api/worker/sync/<target>/<relpath>   → body = the file bytes
// targets: remakes · anims · docs · maps (their public dirs), transcripts (an incoming dir; a job.json arriving triggers
// the Pentecaust ingest into the transcript store). The public manifests (remakes/anims/docs manifest.json, maps
// index.json) are what the @shilpa-shastra cycle reads, so new work flows on-chain once it lands here.
// Safety: strict relpaths, extension allowlist, size caps, temp-file + rename (a reader never sees half a file), JSON
// validated (manifests must have the expected list, and may not shrink by more than half — a broken build can't blank
// a gallery), audit log. The worker uploads media first and the manifest last.

import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { REMAKES_DIR } from './remakes.mjs';
import { ANIMS_DIR } from './animations.mjs';
import { DOCS_DIR } from './documentaries.mjs';
import { MAPS_DIR } from './maps.mjs';

const MB = 1024 * 1024;
export const CAPS = { mp4: 2048 * MB, jpg: 25 * MB, jpeg: 25 * MB, png: 25 * MB, webp: 25 * MB, json: 25 * MB, vtt: 8 * MB };
const REL_RE = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]{0,120}\/){0,3}[A-Za-z0-9_][A-Za-z0-9._-]{0,120}$/;

/** target → { dir(), manifest name (last to upload), list key the manifest must carry } */
export function targets(vsDir) {
  return {
    remakes: { dir: () => REMAKES_DIR(), manifest: 'manifest.json', key: 'scenes' },
    anims: { dir: () => ANIMS_DIR(), manifest: 'manifest.json', key: 'clips' },
    docs: { dir: () => DOCS_DIR(), manifest: 'manifest.json', key: 'films' },
    maps: { dir: () => MAPS_DIR(), manifest: 'index.json', key: 'clips' },
    transcripts: { dir: () => join(vsDir, 'sync-incoming', 'transcripts'), manifest: null, key: null, ingest: true },
  };
}

/** → { ok, ext } | { ok:false, error } */
export function validRel(rel) {
  const r = String(rel || '');
  if (!REL_RE.test(r) || r.split('/').some((s) => s === '.' || s === '..' || s.startsWith('.'))) return { ok: false, error: 'bad path' };
  const ext = (/\.([a-z0-9]+)$/i.exec(r) || [])[1];
  if (!ext || !CAPS[ext.toLowerCase()]) return { ok: false, error: 'extension not allowed' };
  return { ok: true, ext: ext.toLowerCase() };
}

function audit(vsDir, rec) {
  try { fs.mkdirSync(vsDir, { recursive: true }); fs.appendFileSync(join(vsDir, 'sync-audit.jsonl'), JSON.stringify({ ts: Date.now(), ...rec }) + '\n'); } catch {}
}

/** Walk a target dir (≤ 4 levels) → { relpath: size }. Skips dotfiles / temp files. */
export function listFiles(dir) {
  const out = {};
  const walk = (d, rel, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 3) walk(join(d, e.name), r, depth + 1); } else if (e.isFile() && validRel(r).ok) {
        try { out[r] = fs.statSync(join(d, e.name)).size; } catch {}
      }
    }
  };
  walk(dir, '', 0);
  return out;
}

/** Validate a JSON body for this path. → error string or '' */
export function checkJson(buf, target, rel, t, dir) {
  let j;
  try { j = JSON.parse(buf.toString('utf8')); } catch { return 'invalid JSON'; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return 'JSON must be an object';
  if (t.manifest && rel === t.manifest) {
    if (!Array.isArray(j[t.key])) return `manifest must have a "${t.key}" list`;
    try {
      const cur = JSON.parse(fs.readFileSync(join(dir, rel), 'utf8'));
      const had = Array.isArray(cur[t.key]) ? cur[t.key].length : 0;
      if (had >= 4 && j[t.key].length < had / 2) return `refusing to shrink ${t.key} from ${had} to ${j[t.key].length}`;
    } catch { /* no current manifest */ }
  }
  return '';
}

/** Stream a PUT body into <dir>/<rel> via a temp file. → { code, body } */
export function receive(req, target, rel, { vsDir }) {
  const T = targets(vsDir);
  const t = T[target];
  if (!t) return Promise.resolve({ code: 404, body: { ok: false, error: 'unknown target' } });
  const v = validRel(rel);
  if (!v.ok) return Promise.resolve({ code: 400, body: { ok: false, error: v.error } });
  const dir = t.dir();
  const full = join(dir, rel);
  const cap = CAPS[v.ext];
  return new Promise((resolve) => {
    let n = 0; let over = false; const chunks = [];
    const isJson = v.ext === 'json';
    let tmp = '';
    let ws = null;
    try {
      fs.mkdirSync(dirname(full), { recursive: true });
      tmp = join(dirname(full), `.sync-${randomBytes(6).toString('hex')}.tmp`);
      if (!isJson) ws = fs.createWriteStream(tmp);
    } catch { resolve({ code: 500, body: { ok: false, error: 'cannot write' } }); return; }
    const fail = (code, error) => { try { if (ws) ws.destroy(); fs.rmSync(tmp, { force: true }); } catch {} audit(vsDir, { target, rel, ok: false, error }); resolve({ code, body: { ok: false, error } }); };
    req.on('data', (c) => {
      n += c.length;
      if (n > cap) { over = true; return; }
      if (isJson) chunks.push(c); else ws.write(c);
    });
    req.on('error', () => fail(400, 'upload interrupted'));
    req.on('end', () => {
      if (over) return fail(413, 'too large');
      if (!n) return fail(400, 'empty body');
      const finish = () => {
        try {
          fs.renameSync(tmp, full);
        } catch { return fail(500, 'cannot write'); }
        audit(vsDir, { target, rel, ok: true, bytes: n });
        if (t.ingest && /(^|\/)job\.json$/.test(rel)) return ingest(dir, rel, vsDir).then((r) => resolve({ code: 200, body: { ok: true, bytes: n, ingested: r } }));
        resolve({ code: 200, body: { ok: true, bytes: n } });
      };
      if (isJson) {
        const buf = Buffer.concat(chunks);
        const err = checkJson(buf, target, rel, t, dir);
        if (err) return fail(400, err);
        try { fs.writeFileSync(tmp, buf); } catch { return fail(500, 'cannot write'); }
        return finish();
      }
      ws.end(finish);
    });
  });
}

// transcripts: <incoming>/<src>/<id>/job.json arriving (after its .vtt) → Pentecaust ingest into the transcript store
async function ingest(incoming, rel, vsDir) {
  const m = /^([a-z]{2,10})\/([A-Za-z0-9._-]+)\/job\.json$/.exec(rel);
  if (!m) return false;
  try {
    const { ingestOne } = await import('../../pentecaust/transcripts/seek.mjs');
    const r = ingestOne(m[1], m[2], incoming);
    audit(vsDir, { target: 'transcripts', rel, ingested: !!(r && r.b) });
    return !!(r && r.b);
  } catch { return false; }
}

/** Route under /video-studio/api/worker/sync/…  (caller has already checked the worker token). true if handled. */
export async function syncRoute(req, res, path, method, { vsDir, json }) {
  const m = /^\/video-studio\/api\/worker\/sync\/([a-z]+)\/(.+)$/.exec(path);
  if (!m) return false;
  const T = targets(vsDir);
  if (!T[m[1]]) { json(res, 404, { ok: false, error: 'unknown target' }); return true; }
  if (m[2] === 'list' && method === 'GET') { json(res, 200, { ok: true, files: listFiles(T[m[1]].dir()) }); return true; }
  if (method !== 'PUT') { json(res, 405, { ok: false }); return true; }
  const r = await receive(req, m[1], decodeURIComponent(m[2]), { vsDir });
  json(res, r.code, r.body);
  return true;
}
