// persona-card.mjs — renders a MELEK persona as a portable "signature card" (the first rung of the
// better-than-Gravatar cross-surface identity). READ-ONLY, zero keys, never throws. Serves
// /card/:name.svg (a ~520x120 signature banner usable directly as a forum [img] sig and an HTML email
// <img> sig), plus /card/:name.json for the IFTTT/embed feed and /health. See
// .local/PORTABLE_IDENTITY_SIGCARD_SPEC.md.
//
//   PORT=7085 PERSONA_AVATAR_BASE=https://melek.salon node integrations/persona-card.mjs
//   then Caddy: handle /card/* { reverse_proxy 127.0.0.1:7085 }   (e.g. id.melek.salon/card/*)
//
//   import { cardSvg, cardJson, handler, __setFetch } from './persona-card.mjs'
import { createServer } from 'node:http';
import { persona, __setFetch as personaSetFetch } from './persona.mjs';

export function __setFetch(fn) { personaSetFetch(fn); }

const PORT = +(process.env.PORT || 7085);
const HOST = process.env.HOST || '127.0.0.1';

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * cardSvg(p, {avatarData}) — pure renderer. avatarData (a data: URI) inlines the avatar for strict
 * email clients (?embed=1); otherwise the avatar is a live <image href> to the avatar service. A
 * fully-empty persona still returns a valid SVG (name-only), never throws.
 */
export function cardSvg(p = {}, { avatarData } = {}) {
  const title = esc(p.renName || p.account || 'unknown');
  const sub = esc(p.renName && p.account ? `@${p.account}` : (p.network || 'MELEK'));
  const posts = p.postCount != null ? `${p.postCount} posts` : '';
  const subLine = esc(posts ? `${p.renName && p.account ? `@${p.account}` : (p.network || 'MELEK')} · ${posts}` : sub);
  const liquid = p.balances && p.balances.liquid ? esc(p.balances.liquid) : '—';
  const vesting = p.balances && p.balances.vesting ? esc(p.balances.vesting) : '';
  const capLine = esc(vesting ? `${liquid}   ·   ${vesting}` : liquid);
  const avatarHref = avatarData ? esc(avatarData) : esc(p.avatarUrl || '');
  const avatar = avatarHref
    ? `<image href="${avatarHref}" x="20" y="20" width="80" height="80" clip-path="url(#clip)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="60" cy="60" r="40" fill="#141a24" stroke="#232c3a"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="120" viewBox="0 0 520 120" role="img" aria-label="${title} on MELEK">
  <defs><clipPath id="clip"><circle cx="60" cy="60" r="40"/></clipPath></defs>
  <rect x="0.5" y="0.5" width="519" height="119" rx="12" fill="#0b0d12" stroke="#232c3a"/>
  ${avatar}
  <text x="120" y="47" fill="#e9eef5" font-family="Segoe UI,Arial,sans-serif" font-size="22" font-weight="700">${title}</text>
  <text x="120" y="69" fill="#8896a6" font-family="Segoe UI,Arial,sans-serif" font-size="13">${subLine}</text>
  <text x="120" y="95" fill="#d9a441" font-family="ui-monospace,Menlo,monospace" font-size="14">${capLine}</text>
  <rect x="462" y="12" width="46" height="16" rx="4" fill="#d9a441"/>
  <text x="485" y="24" text-anchor="middle" fill="#1a1305" font-family="Segoe UI,Arial,sans-serif" font-size="10" font-weight="700">ALPHA</text>
</svg>`;
}

/** cardJson(p) — the persona + a share caption + the card image URL, for the IFTTT/embed feed. */
export function cardJson(p = {}, baseUrl = '') {
  const key = p.renName || p.account || '';
  return {
    account: p.account || '', renName: p.renName || null, network: p.network || '',
    balances: p.balances || {}, postCount: p.postCount ?? null, avatarUrl: p.avatarUrl || '',
    caption: key ? `${key} on MELEK` : 'MELEK',
    cardUrl: key && baseUrl ? `${baseUrl.replace(/\/$/, '')}/card/${encodeURIComponent(key)}.svg` : '',
    ok: !!p.ok,
  };
}

// fetch an avatar and inline it as a data: URI (?embed=1). Soft-fail: returns null on any error.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setEmbedFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
async function inlineAvatar(url) {
  try {
    const r = await _fetch(url, { redirect: 'follow' });
    if (!r || !r.ok) return null;
    const mime = (r.headers.get && r.headers.get('content-type')) || 'image/png';
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

function parseCardPath(pathname) {
  const m = String(pathname || '').match(/^\/card\/(.+?)(\.svg|\.json)?\/?$/i);
  if (!m) return null;
  return { name: decodeURIComponent(m[1] || ''), ext: (m[2] || '.svg').toLowerCase() };
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    const parsed = parseCardPath(path);
    if (!parsed || !parsed.name) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    const p = await persona(parsed.name).catch(() => ({ account: parsed.name, ok: false, balances: {} }));
    if (parsed.ext === '.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' });
      return res.end(JSON.stringify(cardJson(p, process.env.BASE_URL || '')));
    }
    let avatarData;
    if (url.searchParams.get('embed') === '1' && p.avatarUrl) avatarData = await inlineAvatar(p.avatarUrl);
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=300' });
    return res.end(cardSvg(p, { avatarData }));
  } catch {
    // last-resort: a valid empty card, never a 500 for a sig <img>
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
    return res.end(cardSvg({ account: 'unknown', balances: {} }));
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => console.log(`persona-card on http://${HOST}:${PORT}  (/card/:name.svg)`));
}
