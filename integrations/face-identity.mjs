// face-identity.mjs — Node wrapper over face-identity/identity.py (free/CPU ArcFace). For USER uploads:
// map a real face → embedding, and verify two faces are the same person. Soft-fails if Python/insightface
// is absent (returns {ok:false}) so the studio degrades. Hathor is a signature-trained character, not this.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const run = promisify(execFile);
const PY = process.env.IDENTITY_PY || 'python3';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'face-identity', 'identity.py');
async function call(args) {
  try { const { stdout } = await run(PY, [SCRIPT, ...args], { timeout: 60000, maxBuffer: 1 << 26 }); return JSON.parse(stdout.trim().split('\n').pop()); }
  catch (e) { return { ok: false, error: String(e && e.message).slice(0, 120) }; }
}
export const embed = (image) => call(['embed', image]);
export const verify = (a, b) => call(['verify', a, b]);   // {ok, score, same}
export const mapdir = (dir) => call(['mapdir', dir]);
