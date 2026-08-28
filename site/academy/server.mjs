// site/academy/server.mjs — the MELEK Academy credential portal (academy.melek.salon).
//
// The public face of the credential ISSUER (integrations/soapbox/credentials-issuer.mjs): browse the
// credential programs we offer, VERIFY any MELEK credential (paste it — the check is a re-hash, no
// secrets), and see the public REGISTRY. Honest throughout: these are legitimate NON-ACCREDITED
// credentials (church-issued religious credentials, MELEK Press passes, and course-completion certs) —
// never college credit, a CEU, or a government license, and we say so on every page.
//
// Issuance itself is TEMPLE/OPERATOR-GATED (a bad actor must not be able to self-mint an ordination or a
// press pass): /issue is disabled unless ACADEMY_ISSUER_TOKEN is set and presented. The portal ships
// safe as browse + verify + registry.
//
//   PORT=8143 BASE_URL=https://academy.melek.salon node site/academy/server.mjs
//   import { handler, homePage, programView, verifyView } from './server.mjs'   // tests
//
// Pure render, esc() everywhere, handler(req,res) exported, CLI guarded. No network. No keys.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';
import {
  PROGRAMS, ISSUERS, CREDENTIAL_TYPES, getProgram,
  verifyCredential, toOpenBadge, createRegistry,
} from '../../integrations/soapbox/credentials-issuer.mjs';

const PORT = +(process.env.PORT || 8143);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://academy.melek.salon').replace(/\/$/, '');
const WITNESS = process.env.WITNESS_URL || 'https://witness.melek.salon';
const ISSUER_TOKEN = process.env.ACADEMY_ISSUER_TOKEN || ''; // unset ⇒ issuance disabled (browse+verify only)

// Injectable registry reader (a real deploy injects a durable-store registry; default = empty in-memory).
let _registry = createRegistry();
export function __setRegistry(reg) { _registry = reg || createRegistry(); }

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TRACKS = [
  ['press', 'Press'], ['ministry', 'Ministry'], ['ai', 'Angelic AI'], ['crypto', 'Crypto'],
  ['civics', 'Civics'], ['library', 'Library'], ['esoteric', 'Esoteric'],
];

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:940px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:28px} h2{font-size:18px;margin:18px 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)} .lead{font-size:16px;color:var(--mut);max-width:76ch;margin:6px 0 4px}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:16px 18px;margin:12px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
  .prog{display:block;border:1px solid var(--line2);border-radius:10px;padding:14px 16px;background:var(--panel)}
  .prog:hover{border-color:var(--blue);text-decoration:none}
  .prog .t{font-weight:700;font-size:15px;color:var(--fg)} .prog:hover .t{color:var(--blue)}
  .prog .d{color:var(--mut);font-size:13px;margin-top:4px}
  .tag{display:inline-block;font-size:11px;font-weight:700;border-radius:7px;padding:2px 8px;margin-bottom:6px;background:#1f6feb33;color:var(--blue)}
  .tag.min{background:#d2992233;color:var(--gold)} .tag.press{background:#3fb95033;color:var(--up)}
  .note{font-size:12.5px;color:var(--mut);border-left:3px solid var(--line2);padding:4px 0 4px 12px;margin-top:8px}
  .band{background:#d2992215;border:1px solid #d2992240;border-radius:10px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  textarea,input{width:100%;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);font:13px ui-monospace,Menlo,monospace;padding:10px 12px}
  textarea{min-height:150px;resize:vertical}
  button{background:#1f6feb;border:0;border-radius:8px;color:#fff;font-weight:700;padding:9px 18px;cursor:pointer;font-size:14px}
  .ok{color:var(--up);font-weight:700} .bad{color:var(--down);font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:13px} td,th{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left}
  code{background:#0b0f14;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12.5px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:24px 22px;margin-top:22px;border-top:1px solid var(--line);line-height:1.7}
</style>`;

const FOOTER = `<footer>
  <b>Honest by design.</b> MELEK Academy credentials are <b>legitimate but non-accredited</b>: they are
  <b>not</b> college credit, a CEU, or a government license. A credential's authority is its issuer —
  the <b>Temple</b> (a church, for religious credentials), <b>MELEK Press</b> (a publisher, for press
  passes), or <b>MELEK Academy</b> (for course completion). Every credential is verifiable by re-hashing —
  <a href="/verify">check one here</a>. This page holds no keys and mints nothing on its own.
  <div style="margin-top:8px"><a href="/">Academy</a> · <a href="/verify">Verify</a> ·
    <a href="/registry">Registry</a> · <a href="${esc(WITNESS)}">Witness School</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'MELEK Academy — earn and verify legitimate non-accredited credentials: church-issued religious credentials, MELEK Press passes, and course-completion certificates, issued as verifiable Open Badges.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="index,follow,max-image-preview:large">
<link rel=canonical href="${esc(canonical)}">${STYLE}${NAV_STYLE}</head><body>
<div class=enav-strip style="background:var(--panel,#14181d);border-bottom:1px solid var(--line2,#222a33);padding:7px 18px">${navBar({ current: 'academy' })}</div>
<header class=topbar><a class=brand href="/">🎓 MELEK Academy <span>· credentials</span></a>
  <div class=topbar-r><a href="/">Programs</a><a href="/verify">Verify</a><a href="/registry">Registry</a><a href="${esc(WITNESS)}">Witness School</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

const tagClass = (type) => (type === 'ministerial' ? 'min' : type === 'press' ? 'press' : '');

// ── / — home ────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const byTrack = TRACKS.map(([tk, label]) => {
    const list = PROGRAMS.filter((p) => p.track === tk);
    if (!list.length) return '';
    return `<h2>${esc(label)}</h2><div class=grid>${list.map((p) => `
      <a class=prog href="/program/${esc(p.id)}">
        <span class="tag ${tagClass(p.type)}">${esc(CREDENTIAL_TYPES[p.type].label)}</span>
        <div class=t>${esc(p.name)}</div><div class=d>${esc(p.description)}</div></a>`).join('')}</div>`;
  }).join('');
  const body = `<h1>MELEK Academy <span class=muted style="font-size:14px">· earn a credential, verify a credential</span></h1>
    <p class=lead>A credential is only as real as who stands behind it. MELEK issues <b>legitimate,
      non-accredited</b> credentials on the authority of what we actually are — a <b>church</b> and a
      <b>publisher</b> — plus honest <b>certificates of completion</b> for our courses. Each one is a
      <b>verifiable Open Badge</b> (anyone can re-hash it to prove it is genuine), built to anchor on the
      MELEK/PRANA chain.</p>

    <div class=card><h2 style="margin-top:0">Why these are real (without accreditation)</h2>
      <p class=muted style="font-size:14px">Accreditation only matters for <i>college credit</i>, <i>CEUs</i>,
        or a <i>government license</i>. Everything else — the Udemy/Edovo/Credly world — is legitimate
        non-accredited credentialing. Ours rest on:</p>
      <ul class=muted style="font-size:14px">
        <li><b>The Temple</b> — an IRS-recognized church (§ 508(c)(1)(A)); churches <b>ordain</b> and issue
          religious credentials under the First Amendment.</li>
        <li><b>MELEK Press</b> — a publisher; news organizations issue <b>press passes</b> under freedom of
          the press. (A pass credentials you as MELEK press; a given venue decides whether to grant access on it.)</li>
        <li><b>MELEK Academy</b> — honest <b>certificates of completion</b> and skill badges for our courses
          (Angelic AI, Crypto, and more). Proof of completion — not a degree.</li>
      </ul></div>

    ${byTrack}
    <div class=band>These are non-accredited credentials — not college credit, not a CEU, not a license.
      Educational and religious credentials issued by their named authority. Nothing here is legal, medical,
      or financial advice, and no earnings or outcomes are promised.</div>`;
  return page('MELEK Academy — earn and verify credentials', body, { canonical: `${BASE_URL}/` });
}

// ── /program/:id ──────────────────────────────────────────────────────────────────────────────────
export function programView(id) {
  const p = getProgram(id);
  if (!p) return page('Program not found — MELEK Academy', `<h1>Not found</h1><p class=muted>No program <code>${esc(id)}</code>. <a href="/">See all programs →</a></p>`, { canonical: `${BASE_URL}/` });
  const issuer = ISSUERS[CREDENTIAL_TYPES[p.type].issuer];
  const canIssue = Boolean(ISSUER_TOKEN);
  const body = `<p style="margin:0 0 4px"><a href="/">← all programs</a></p>
    <span class="tag ${tagClass(p.type)}">${esc(CREDENTIAL_TYPES[p.type].label)}</span>
    <h1>${esc(p.name)}</h1>
    <p class=lead>${esc(p.description)}</p>
    <div class=card><h3>Issued by</h3><p class=muted style="font-size:14px"><b>${esc(issuer.name)}</b> — ${esc(issuer.basis)}</p>
      <h3 style="margin-top:12px">How you earn it</h3><p class=muted style="font-size:14px">${esc(p.criteria)}</p>
      <div class=note>${esc(p.note)}</div></div>
    <div class=card><h3>The credential you receive</h3>
      <p class=muted style="font-size:14px">A verifiable <b>Open Badge 3.0</b> with a unique id (e.g.
        <code>MELEK-${esc(CREDENTIAL_TYPES[p.type].code)}-…</code>) and a SHA-256 verification hash over its
        fields. Anyone can confirm it on the <a href="/verify">Verify</a> page; it is built to anchor on the
        MELEK/PRANA chain for a permanent public record.</p>
      <p style="margin-top:8px">${canIssue
        ? '<b>Request:</b> issuance for this program is enabled on this instance — contact the issuer to be credentialed.'
        : 'Issuance is <b>gated to the issuing authority</b> (the Temple / MELEK Press / MELEK Academy) — you cannot self-mint a credential here. Enroll through the course or ministry track, and the credential is issued to you on completion.'}</p></div>`;
  return page(`${p.name} — MELEK Academy`, body, { canonical: `${BASE_URL}/program/${p.id}` });
}

// ── /verify ───────────────────────────────────────────────────────────────────────────────────────
// Accepts either ?id=<credential id> (registry lookup) or ?c=<base64url credential JSON> (self-contained
// re-hash — no registry, no secrets). The paste form base64-encodes client-side into ?c=.
export function verifyView({ id = '', c = '' } = {}) {
  let result = '';
  if (id) {
    const v = _registry.verify(id);
    const cred = _registry.get(id);
    result = renderResult(v, cred, `registry id ${esc(id)}`);
  } else if (c) {
    let cred = null;
    try { cred = JSON.parse(Buffer.from(String(c), 'base64').toString('utf8')); } catch { cred = null; }
    result = cred ? renderResult(verifyCredential(cred), cred, 'pasted credential') : `<div class=card><span class=bad>Could not parse</span> — that is not a valid credential JSON.</div>`;
  }
  const body = `<h1>Verify a credential</h1>
    <p class=lead>Paste a MELEK credential's JSON below. Verification is a <b>re-hash</b> — we recompute the
      SHA-256 over its fields and compare; any tampering fails. No account, no secrets, works offline.</p>
    <form method=get action="/verify" onsubmit="try{this.c.value=btoa(unescape(encodeURIComponent(this.raw.value)));this.raw.name=''}catch(e){}">
      <textarea name=raw placeholder='{ "id": "MELEK-…", "verification": { "hash": "…" }, … }'></textarea>
      <input type=hidden name=c>
      <div style="margin-top:10px"><button type=submit>Verify</button>
        <span class=muted style="font-size:13px;margin-left:10px">or look up by id: <code>/verify?id=MELEK-…</code></span></div>
    </form>
    ${result}`;
  return page('Verify a credential — MELEK Academy', body, { canonical: `${BASE_URL}/verify`, });
}

function renderResult(v, cred, sourceLabel) {
  const head = v.valid
    ? `<span class=ok>✓ VALID</span> — ${esc(v.reason)}`
    : `<span class=bad>✗ NOT VALID</span> — ${esc(v.reason)}`;
  const detail = cred && cred.id ? `
    <table>
      <tr><th>Credential</th><td>${esc(cred.program && cred.program.name)}</td></tr>
      <tr><th>Id</th><td><code>${esc(cred.id)}</code></td></tr>
      <tr><th>Recipient</th><td>${esc(cred.recipient && cred.recipient.name)}</td></tr>
      <tr><th>Issued by</th><td>${esc(cred.issuer && cred.issuer.name)}</td></tr>
      <tr><th>Issued</th><td>${esc(cred.issuedAt)}${cred.expiresAt ? ` · expires ${esc(cred.expiresAt)}` : ''}</td></tr>
      <tr><th>Type</th><td>${esc(cred.typeLabel || (cred.type || ''))} · <b>non-accredited</b></td></tr>
      <tr><th>On-chain anchor</th><td>${cred.verification && cred.verification.anchor ? esc(cred.verification.anchor) : '<span class=muted>not yet anchored (issuer-hash verified)</span>'}</td></tr>
    </table>` : '';
  return `<div class=card><h3 style="margin-top:0">Result — ${esc(sourceLabel)}</h3><p style="font-size:16px">${head}</p>${detail}</div>`;
}

// ── /registry ─────────────────────────────────────────────────────────────────────────────────────
export function registryView() {
  const list = _registry.list();
  const rows = list.length
    ? `<table><tr><th>Id</th><th>Credential</th><th>Recipient</th><th>Issued</th></tr>${list.map((c) => `
      <tr><td><code>${esc(c.id)}</code></td><td>${esc(c.program && c.program.name)}</td>
        <td>${esc(c.recipient && c.recipient.name)}</td><td>${esc(c.issuedAt)}</td></tr>`).join('')}</table>`
    : `<p class=muted>No credentials issued on this instance yet. When the Temple, MELEK Press, or the Academy
        issues a credential, it appears here — and every one is checkable on <a href="/verify">Verify</a>.</p>`;
  return page('Credential registry — MELEK Academy', `<h1>Public registry</h1>
    <p class=lead>Every MELEK credential issued on this instance, publicly listed and independently verifiable.
      Built to anchor each verification hash on the MELEK/PRANA chain.</p>
    <div class=card>${rows}</div>`, { canonical: `${BASE_URL}/registry` });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}
const SITEMAP_PATHS = ['/', '/verify', '/registry', ...PROGRAMS.map((p) => `/program/${p.id}`)];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.6' }))));
    }
    if (path === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({ name: 'MELEK Academy — credentials', baseUrl: BASE_URL, summary: 'Earn and verify legitimate non-accredited MELEK credentials: church-issued religious credentials, MELEK Press passes, and course-completion certificates, as verifiable Open Badges.', links: [{ label: 'Programs', path: '/' }, { label: 'Verify a credential', path: '/verify' }, { label: 'Registry', path: '/registry' }] }));
    }
    if (path === '/') return sendHtml(res, homePage());
    if (path === '/verify' || path === '/verify.html') return sendHtml(res, verifyView({ id: url.searchParams.get('id') || '', c: url.searchParams.get('c') || '' }));
    if (path === '/registry') return sendHtml(res, registryView());
    const pm = path.match(/^\/program\/([a-z0-9-]+)$/);
    if (pm) return sendHtml(res, programView(pm[1]));
    // /issue — TEMPLE/OPERATOR-GATED. Disabled unless a valid issuer token is presented. No self-mint.
    if (path === '/issue') {
      const tok = url.searchParams.get('token') || (req.headers && req.headers['x-issuer-token']) || '';
      if (!ISSUER_TOKEN || tok !== ISSUER_TOKEN) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, reason: 'issuance is gated to the issuing authority' })); }
      const r = _registry.issue({ programId: url.searchParams.get('program') || '', recipientName: url.searchParams.get('name') || '', recipientId: url.searchParams.get('rid') || '' });
      res.writeHead(r.ok ? 200 : 400, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(r.ok ? { ok: true, credential: r.credential, openBadge: toOpenBadge(r.credential, { baseUrl: BASE_URL }) } : r));
    }
    res.writeHead(302, { location: '/' }); return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/academy\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Academy on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
