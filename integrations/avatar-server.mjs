// avatar-server.mjs — serves /u/:user/avatar[/:size] for the MELEK condenser, which was requesting them
// and getting 404 everywhere (no avatar route existed), so no profile pictures ever showed.
//
// A user sets their picture in the Wallet → it lands in their account's json_metadata.profile.profile_image.
// This service reads that from the chain and 302-REDIRECTS to it (the browser fetches it — no server-side
// SSRF/proxy). When none is set, it returns a deterministic identicon PNG so every account still has a face.
// READ-ONLY, no keys, soft-fails (never throws; a bad account → identicon).
//
//   MELEK_RPC_URL=http://127.0.0.1:18090 AVATAR_PORT=7082 node integrations/avatar-server.mjs
//   then Caddy: handle /u/* { reverse_proxy 127.0.0.1:7082 }

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

const RPC = () => process.env.MELEK_RPC_URL || process.env.MELEK_RPC || 'http://127.0.0.1:18090';
const SIZES = { small: 64, medium: 128, large: 256 };

/** Parse `/u/<user>/avatar` or `/u/<user>/avatar/<size>` → { user, px } | null. Pure. */
export function parseAvatarPath(pathname) {
  const m = String(pathname || '').match(/^\/u\/([a-z0-9.-]{2,20})\/avatar(?:\/(small|medium|large))?\/?$/i);
  if (!m) return null;
  return { user: m[1].toLowerCase(), px: SIZES[(m[2] || 'medium').toLowerCase()] || 128 };
}

/** A deterministic 5×5 mirrored identicon SVG for a username (GitHub-style). Pure. */
export function identiconSvg(user, px = 128) {
  const h = createHash('sha256').update(String(user || '?')).digest();
  const hue = h[0] * 360 / 256;
  const fg = `hsl(${hue.toFixed(0)} 58% 47%)`, bg = `hsl(${hue.toFixed(0)} 30% 94%)`;
  const cell = px / 5;
  let rects = '';
  for (let col = 0; col < 3; col++) for (let row = 0; row < 5; row++) {
    if (h[col * 5 + row] & 1) {
      for (const c of (col === 2 ? [2] : [col, 4 - col])) rects += `<rect x="${c * cell}" y="${row * cell}" width="${cell}" height="${cell}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><rect width="${px}" height="${px}" fill="${bg}"/><g fill="${fg}">${rects}</g></svg>`;
}

/** Decide what to serve for an account object. Pure. → { redirect } | { identicon } */
export function resolveAvatar(account, user, px) {
  let img = '';
  try {
    const meta = JSON.parse((account && (account.posting_json_metadata || account.json_metadata)) || '{}');
    img = (meta.profile && meta.profile.profile_image) || '';
  } catch { /* bad metadata → identicon */ }
  if (/^https:\/\/[^\s"'<>]+$/i.test(img)) return { redirect: img };
  return { identicon: identiconSvg(user, px) };
}

async function fetchAccount(user) {
  try {
    const r = await _fetch(RPC(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_accounts', params: [[user]] }),
    });
    const j = await r.json();
    return (j && j.result && j.result[0]) || null;
  } catch { return null; }
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    const p = parseAvatarPath(url.pathname);
    if (!p) { res.writeHead(404); return res.end('not an avatar path'); }
    const account = await fetchAccount(p.user);
    const r = resolveAvatar(account, p.user, p.px);
    if (r.redirect) {
      res.writeHead(302, { location: r.redirect, 'cache-control': 'public, max-age=600' });
      return res.end();
    }
    const sharpMod = await import('sharp');
    const sharp = sharpMod.default || sharpMod;
    const png = await sharp(Buffer.from(r.identicon)).png().toBuffer();
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' });
    return res.end(png);
  } catch (e) {
    res.writeHead(500); return res.end('avatar error');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.AVATAR_PORT || 7082);
  createServer(handler).listen(PORT, '127.0.0.1', () => console.log(`melek-avatar: :${PORT} | rpc ${RPC()}`));
}
