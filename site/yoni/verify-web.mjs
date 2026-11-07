// site/yoni/verify-web.mjs — the selfie intake for the `verified` gate.
//
// ⭐ THE IMAGE IS NEVER KEPT. THAT IS THE ENTIRE DESIGN CONSTRAINT.
// insightface reads a file path, so the bytes must touch a disk for a moment. Everything here exists to
// make that moment as short and as contained as possible: a random name in a dedicated scratch directory,
// 0600, unlinked in a `finally` so it goes even if the model throws, and the directory swept of anything
// stale on every call. No image is logged, echoed, returned, or copied. The gate record that comes out
// the far end carries a provider reference and nothing else — assertNoPII in the model is the backstop,
// not the policy.
//
// ⭐ WE SNIFF THE BYTES, WE DO NOT BELIEVE THE HEADER.
// A declared content-type is a claim by the client. The magic bytes are checked instead, and anything that
// is not a JPEG, PNG or WebP is refused before it is written. A gate that will run an arbitrary file
// through a native image decoder on a stranger's say-so is a gate with a hole in it.
//
// ⭐ NOT /tmp. EVER.
// The scratch directory is explicit and ours. A world-writable shared temp is the wrong place for somebody's
// face even for two seconds.
//
// House style: ESM, soft-fail-never-throw, injectable fs/clock/provider so it all tests offline.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const MAX_BYTES = 8 * 1024 * 1024;        // a selfie, not a RAW file
export const SCRATCH_DIR = process.env.YONI_SCRATCH || '/var/lib/yoni/scratch';
export const STALE_MS = 60 * 1000;                // anything older than a minute is a leak; sweep it

/** Magic-byte sniff. Returns an extension, or null if it is not an image we will decode. */
export function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

let _io = null;
export function __setIO(io) { _io = io && typeof io === 'object' ? io : null; }
function io() {
  return _io || {
    mkdir: (d) => { try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); return true; } catch { return false; } },
    write: (p, b) => { try { fs.writeFileSync(p, b, { mode: 0o600 }); return true; } catch { return false; } },
    unlink: (p) => { try { fs.unlinkSync(p); return true; } catch { return false; } },
    list: (d) => { try { return fs.readdirSync(d); } catch { return []; } },
    age: (p) => { try { return Date.now() - fs.statSync(p).mtimeMs; } catch { return 0; } },
  };
}

/** Delete anything left behind by an earlier crash. Called on every intake, cheap and bounded. */
export function sweep(dir = SCRATCH_DIR, { staleMs = STALE_MS } = {}) {
  let removed = 0;
  for (const name of io().list(dir)) {
    const p = path.join(dir, name);
    if (io().age(p) > staleMs) { io().unlink(p); removed += 1; }
  }
  return removed;
}

/**
 * Run one selfie through a provider and guarantee the file is gone afterwards.
 * `provider` is the agegate provider shape ({ check({image}) }). Returns the provider's own verdict.
 */
export async function checkSelfie(buf, { provider, dir = SCRATCH_DIR, marginYears } = {}) {
  if (!provider || typeof provider.check !== 'function') return { ok: false, reason: 'no provider' };
  if (!buf || !buf.length) return { ok: false, reason: 'no image received', retryable: true };
  if (buf.length > MAX_BYTES) {
    return { ok: false, reason: `image over ${Math.round(MAX_BYTES / 1024 / 1024)}MB — send a smaller one`, retryable: true };
  }
  const ext = sniff(buf);
  if (!ext) return { ok: false, reason: 'that is not a JPEG, PNG or WebP image', retryable: true };

  sweep(dir);
  if (!io().mkdir(dir)) return { ok: false, reason: 'no scratch directory', retryable: true };
  const file = path.join(dir, `${randomBytes(16).toString('hex')}.${ext}`);
  if (!io().write(file, buf)) return { ok: false, reason: 'could not stage the image', retryable: true };

  try {
    return await provider.check({ image: file, marginYears });
  } catch (e) {
    return { ok: false, reason: `check failed: ${String((e && e.message) || e).slice(0, 80)}`, retryable: true };
  } finally {
    // The one line this module exists for. It runs on success, on refusal and on a thrown model.
    io().unlink(file);
  }
}

/** Read a raw request body up to the cap. Over the cap, the connection is dropped rather than buffered. */
export function readRawBody(req, limit = MAX_BYTES) {
  return new Promise((resolve) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { chunks.length = 0; req.destroy(); return resolve(null); }
      chunks.push(c);
    });
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0)));
    req.on('error', () => resolve(null));
  });
}
