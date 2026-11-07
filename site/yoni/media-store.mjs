// site/yoni/media-store.mjs — the gallery and video index, and the slots producers upload into.
//
// ⭐ THE BYTES NEVER TOUCH OUR SERVER.
// A producer asks for a SLOT; we hand back a presigned PUT and the browser sends the file straight to
// object storage. Our box signs a URL and writes one line of JSON. That is deliberate: proxying media
// through the web tier would put somebody else's video in our process memory and our bandwidth bill, and
// a § 2257-covered file is the last thing that should pass through a server that does not need it.
//
// ⭐ THE SIZE LIMIT IS SIGNED INTO THE URL.
// harddrive's presigner signs the exact content length, so storage itself rejects an upload of any other
// size. The cap is not a promise our code keeps — it is a condition the storage enforces, which means a
// producer cannot talk our server into accepting a bigger file by lying to it.
//
// ⭐ COMMIT IS SEPARATE FROM UPLOAD, AND NOTHING IS PUBLISHED UNTIL IT HAPPENS.
// An abandoned upload is an orphan object, not a published item: the index is the only thing the surfaces
// read. That ordering is what makes § 9.4.1 pre-publication review possible at all — a file can exist in
// storage and still be unpublished, which is where a review step belongs.
//
// ⭐ WHAT THE INDEX HOLDS.
// A key, a surface, the producer's handle, a caption and a time. No viewer data, no uploader identity
// beyond the handle the operator issued, and nothing from the file itself.
//
// House style: ESM, injectable IO/clock/config, soft-fail-never-throw.

import fs from 'node:fs';
import path from 'node:path';
import { storageConfig, presignPut, presignGet, objectKey } from '../../integrations/harddrive.mjs';

export const SURFACES = Object.freeze({
  gallery: { kinds: ['jpg', 'jpeg', 'png', 'webp'], maxBytes: 25 * 1024 * 1024, label: 'still image' },
  video: { kinds: ['mp4', 'webm', 'mov'], maxBytes: 2 * 1024 * 1024 * 1024, label: 'video' },
});

export const indexPath = (env = process.env) =>
  String(env.YONI_MEDIA_FILE || '/var/lib/yoni/media.jsonl');

let _io = null;
export function __setIO(io) { _io = io && typeof io === 'object' ? io : null; }
function io() {
  return _io || {
    read: (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } },
    append: (p, line) => {
      try { fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
        fs.appendFileSync(p, line, { mode: 0o600 }); return true; } catch { return false; }
    },
  };
}
const now = (o) => (o && typeof o.now === 'function' ? o.now() : Date.now());
const str = (s, n = 200) => String(s == null ? '' : s).trim().slice(0, n);

export const extOf = (filename) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(str(filename, 300));
  return m ? m[1].toLowerCase() : '';
};

/** Ask for an upload slot. Returns a presigned PUT the browser uses directly. */
export function slotFor({ handle, surface, filename, bytes } = {}, opts = {}) {
  const s = str(surface, 20);
  const spec = SURFACES[s];
  if (!spec) return { ok: false, reason: `not an uploadable surface: ${s || '(none)'}` };

  const h = str(handle, 60);
  if (!h) return { ok: false, reason: 'no producer handle' };

  const ext = extOf(filename);
  if (!spec.kinds.includes(ext)) {
    return { ok: false, reason: `${s} takes ${spec.kinds.join(', ')} — not ${ext || 'a file with no extension'}` };
  }
  const n = Math.floor(Number(bytes));
  if (!(n > 0)) return { ok: false, reason: 'the exact file size is required to sign the upload' };
  if (n > spec.maxBytes) {
    return { ok: false, reason: `a ${spec.label} may be up to ${Math.round(spec.maxBytes / 1024 / 1024)}MB` };
  }

  const cfg = opts.config || storageConfig();
  if (!cfg.configured) return { ok: false, reason: 'object storage is not configured' };

  const key = `yoni/${s}/${objectKey(h, filename)}`;
  let putUrl = '';
  try { putUrl = presignPut(cfg, key, { expiresIn: 900, contentLength: n }); }
  catch (e) { return { ok: false, reason: `could not sign the upload: ${String((e && e.message) || e).slice(0, 80)}` }; }
  return { ok: true, key, putUrl, bytes: n, surface: s, expiresInSec: 900 };
}

/** Publish it. Until this runs the object is an orphan, not an item. */
export function commit({ key, handle, surface, caption = '', bytes = 0 } = {}, opts = {}) {
  const k = str(key, 400);
  const s = str(surface, 20);
  const h = str(handle, 60);
  if (!k || !SURFACES[s] || !h) return { ok: false, reason: 'key, surface and handle are all required' };
  if (!k.startsWith(`yoni/${s}/`)) return { ok: false, reason: 'that key does not belong to this surface' };
  const rec = { op: 'add', key: k, surface: s, handle: h, caption: str(caption, 300), bytes: Math.max(0, Math.floor(Number(bytes) || 0)), at: now(opts) };
  return io().append(opts.path || indexPath(opts.env), `${JSON.stringify(rec)}\n`)
    ? { ok: true, item: rec } : { ok: false, reason: 'could not write the index' };
}

/** Take something down. The object may linger in storage; the surfaces stop showing it immediately. */
export function remove(key, opts = {}) {
  const k = str(key, 400);
  if (!k) return { ok: false, reason: 'a key is required' };
  return io().append(opts.path || indexPath(opts.env), `${JSON.stringify({ op: 'remove', key: k, at: now(opts) })}\n`)
    ? { ok: true } : { ok: false, reason: 'could not write the index' };
}

/** Fold the log. Newest first. A remove wins over any earlier add. */
export function listMedia({ surface = '', limit = 200 } = {}, opts = {}) {
  const byKey = new Map();
  for (const line of String(io().read(opts.path || indexPath(opts.env)) || '').split('\n')) {
    const t = line.trim(); if (!t) continue;
    let r; try { r = JSON.parse(t); } catch { continue; }
    const k = str(r.key, 400); if (!k) continue;
    if (r.op === 'remove') byKey.delete(k);
    else if (r.op === 'add') byKey.set(k, r);
  }
  let out = [...byKey.values()];
  if (surface) out = out.filter((i) => i.surface === surface);
  return out.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, Math.max(0, limit));
}

/** A short-lived URL to actually view one item. Minted per request, never stored. */
export function viewUrlFor(key, opts = {}) {
  const cfg = opts.config || storageConfig();
  if (!cfg.configured) return '';
  try { return presignGet(cfg, str(key, 400), { expiresIn: opts.expiresIn || 600 }); }
  catch { return ''; }
}

export { storageConfig };
