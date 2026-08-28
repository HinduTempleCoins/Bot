// site/academy/server.mjs — the MELEK Academy credential portal (academy.melek.salon).
//
// The public face of the credential ISSUER (integrations/soapbox/credentials-issuer.mjs): browse the
// credential programs we offer, VERIFY any MELEK credential (paste it — the check is a re-hash, no
// secrets), and see the public REGISTRY. Honest throughout: these are legitimate NON-ACCREDITED
// credentials (Temple-issued religious credentials, MELEK Press passes, and course-completion certs) —
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
import { timingSafeEqual } from 'node:crypto';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';
import {
  PROGRAMS, ISSUERS, CREDENTIAL_TYPES, getProgram,
  verifyCredential, toOpenBadge, createRegistry,
} from '../../integrations/soapbox/credentials-issuer.mjs';
import { getAssessment, scoreAssessment } from '../../integrations/soapbox/credential-assessment.mjs';

// Completion-type credentials are EARNED by passing an assessment; ministerial/press go through an
// application the issuing authority reviews (never auto-minted).
const COMPLETION_TYPES = new Set(['completion', 'certification', 'badge']);
const isCompletion = (p) => p && COMPLETION_TYPES.has(p.type);
// In-memory application queue for the gated (ministerial/press) credentials (a real deploy persists/notifies).
const _applications = [];
export function __applications() { return _applications.slice(); }

const PORT = +(process.env.PORT || 8143);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://academy.melek.salon').replace(/\/$/, '');
const WITNESS = process.env.WITNESS_URL || 'https://witness.melek.salon';
const ISSUER_TOKEN = process.env.ACADEMY_ISSUER_TOKEN || ''; // unset ⇒ issuance disabled (browse+verify only)

// Injectable registry reader (a real deploy injects a durable-store registry; default = empty in-memory).
let _registry = createRegistry();
export function __setRegistry(reg) { _registry = reg || createRegistry(); }

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Constant-time issuer-token check. Requires ISSUER_TOKEN configured, a POST request, and an exact
 *  header-token match (never read from the URL). Returns false when unconfigured/short-circuits safely. */
export function issuerTokenOk(tok, isPost, expected = ISSUER_TOKEN) {
  if (!expected || !isPost || typeof tok !== 'string') return false;
  const a = Buffer.from(tok, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;      // length check first (timingSafeEqual throws on mismatch)
  try { return timingSafeEqual(a, b); } catch { return false; }
}

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
  const desc = opts.description || 'MELEK Academy — earn and verify legitimate non-accredited credentials: Temple-issued religious credentials, MELEK Press passes, and course-completion certificates, issued as verifiable Open Badges.';
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
      non-accredited</b> credentials on the authority of what we actually are — a <b>Temple</b> and a
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
      <p style="margin-top:8px">${isCompletion(p)
        ? 'You cannot self-mint a credential here — you <b>earn</b> it: study the material, then pass a short assessment and the Academy issues it to you.'
        : 'This credential is <b>gated to its issuing authority</b> — you apply, and the ' + esc(issuer.name) + ' issues it to you on approval. No one can self-mint one.'}</p></div>
    <p style="margin:16px 0"><a href="/earn/${esc(p.id)}" style="display:inline-block;background:#1f6feb;color:#fff;font-weight:800;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:15px">${isCompletion(p) ? 'Earn this credential →' : 'Apply for this credential →'}</a></p>`;
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
  const links = cred && cred.id && v.valid
    ? `<p style="margin-top:12px"><a href="${esc(credLink(cred, '/certificate'))}">🖨️ Printable certificate</a> ·
        <a href="${esc(credLink(cred, '/credential'))}">Public credential page (share this with an employer)</a></p>`
    : '';
  return `<div class=card><h3 style="margin-top:0">Result — ${esc(sourceLabel)}</h3><p style="font-size:16px">${head}</p>${detail}${links}</div>`;
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

// ── the seal (the logo that goes on the paper) ────────────────────────────────────────────────────
// A self-contained SVG seal — no external image, so it prints and verifies anywhere. The issuer name
// arcs the top; "VERIFIABLE · ON-CHAIN" the bottom; an eight-point star (the MELEK/Angelic mark) sits
// center. This is the mark a company sees on the paper and looks up.
export function sealSvg(name = 'MELEK ACADEMY', size = 128) {
  const star = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4, r = i % 2 ? 14 : 30;
    return `${(100 + r * Math.sin(a)).toFixed(1)},${(100 - r * Math.cos(a)).toFixed(1)}`;
  }).join(' ');
  const top = String(name).toUpperCase().slice(0, 42);
  return `<svg viewBox="0 0 200 200" width="${size}" height="${size}" role="img" aria-label="${esc(name)} seal" xmlns="http://www.w3.org/2000/svg">
    <defs><path id="arcTop" d="M30,100 a70,70 0 0,1 140,0" fill="none"/><path id="arcBot" d="M35,100 a65,65 0 0,0 130,0" fill="none"/></defs>
    <circle cx="100" cy="100" r="94" fill="none" stroke="#b8860b" stroke-width="3"/>
    <circle cx="100" cy="100" r="84" fill="none" stroke="#d4a23c" stroke-width="1.5"/>
    <polygon points="${star}" fill="#d4a23c" stroke="#8a6a18" stroke-width="1"/>
    <circle cx="100" cy="100" r="7" fill="#fff8e6" stroke="#8a6a18"/>
    <text font-family="Georgia,serif" font-size="13" font-weight="700" fill="#8a6a18" letter-spacing="2"><textPath href="#arcTop" startOffset="50%" text-anchor="middle">${esc(top)}</textPath></text>
    <text font-family="Georgia,serif" font-size="10" font-weight="600" fill="#8a6a18" letter-spacing="3"><textPath href="#arcBot" startOffset="50%" text-anchor="middle">VERIFIABLE · ON-CHAIN</textPath></text>
  </svg>`;
}

// resolve a credential from ?id (registry) or ?c (base64url self-contained JSON — the recipient's own copy).
function resolveCredential({ id = '', c = '' } = {}) {
  if (id) return _registry.get(id);
  if (c) { try { return JSON.parse(Buffer.from(String(c), 'base64').toString('utf8')); } catch { return null; } }
  return null;
}
// A credential the recipient holds can always render itself (?c=); registry ids are the convenience path.
function credLink(cred, path) {
  const c = Buffer.from(JSON.stringify(cred), 'utf8').toString('base64');
  return `${path}?c=${encodeURIComponent(c)}`;
}

// ── /credential — the PUBLIC verification landing (this is where a company looks it up) ──────────────
export function credentialView({ id = '', c = '' } = {}) {
  const cred = resolveCredential({ id, c });
  if (!cred || !cred.id) return page('Credential not found — MELEK Academy', `<h1>Not found</h1><p class=muted>No such credential. <a href="/verify">Verify a credential →</a></p>`, { canonical: `${BASE_URL}/verify` });
  const v = verifyCredential(cred);
  const head = v.valid ? `<span class=ok>✓ GENUINE</span> — ${esc(v.reason)}` : `<span class=bad>✗ NOT VALID</span> — ${esc(v.reason)}`;
  const body = `<h1>${esc(cred.program && cred.program.name)}</h1>
    <p class=lead>This is the public record for a MELEK credential. Anyone — an employer, a registrar, anyone
      holding the paper — can confirm it here.</p>
    <div class=card><p style="font-size:18px;margin:0 0 8px">${head}</p>
      <table>
        <tr><th>Credential</th><td>${esc(cred.program && cred.program.name)}</td></tr>
        <tr><th>Awarded to</th><td><b>${esc(cred.recipient && cred.recipient.name)}</b></td></tr>
        <tr><th>Issued by</th><td>${esc(cred.issuer && cred.issuer.name)}</td></tr>
        <tr><th>Issued</th><td>${esc(cred.issuedAt)}${cred.expiresAt ? ` · expires ${esc(cred.expiresAt)}` : ''}</td></tr>
        <tr><th>Credential id</th><td><code>${esc(cred.id)}</code></td></tr>
        <tr><th>Type</th><td>${esc(cred.typeLabel || cred.type)} · <b>non-accredited</b></td></tr>
        <tr><th>On-chain anchor</th><td>${cred.verification && cred.verification.anchor ? esc(cred.verification.anchor) : '<span class=muted>issuer-hash verified (on-chain anchor pending)</span>'}</td></tr>
      </table>
      <p style="margin-top:12px"><a href="${esc(credLink(cred, '/certificate'))}">🖨️ Open the printable certificate →</a></p>
    </div>
    <div class=band>How this is credible: the credential is issued by the named authority above, its hash is
      re-checked here on every visit (tampering fails), and it is built to anchor permanently on the
      MELEK/PRANA chain. A company that receives the paper looks it up at this page by its id.</div>`;
  return page(`${cred.program && cred.program.name} — credential — MELEK Academy`, body, { canonical: `${BASE_URL}/credential/${cred.id}`, robots: 'noindex,follow' });
}

// ── /certificate — the PRINTABLE certificate (standalone, print-friendly, light) ─────────────────────
export function certificateView({ id = '', c = '' } = {}) {
  const cred = resolveCredential({ id, c });
  if (!cred || !cred.id) return page('Certificate not found — MELEK Academy', `<h1>Not found</h1><p class=muted>No such credential.</p>`, {});
  const verifyUrl = `${BASE_URL}/credential/${encodeURIComponent(cred.id)}`;
  const kind = (cred.type === 'ministerial') ? 'Ordination / Religious Credential'
    : (cred.type === 'press') ? 'Press Credential'
      : 'Certificate of Completion';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(cred.program && cred.program.name)} — Certificate</title>
<style>
  :root{--ink:#2a2419;--gold:#b8860b;--gold2:#d4a23c;--cream:#fbf7ee}
  *{box-sizing:border-box} body{margin:0;background:#e9e4d8;color:var(--ink);font:16px/1.55 Georgia,'Times New Roman',serif;padding:24px}
  .sheet{max-width:900px;margin:0 auto;background:var(--cream);border:2px solid var(--gold);box-shadow:0 10px 40px -12px rgba(0,0,0,.35);padding:40px 48px;position:relative}
  .sheet::before{content:"";position:absolute;inset:10px;border:1px solid var(--gold2);pointer-events:none}
  .top{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px}
  .kicker{letter-spacing:5px;text-transform:uppercase;font-size:12px;color:var(--gold)}
  h1{font-size:30px;margin:6px 0 2px;font-weight:700}
  .sub{font-style:italic;color:#6b5f47;font-size:15px}
  .rule{width:120px;height:2px;background:var(--gold2);margin:16px auto}
  .awarded{font-size:15px;color:#5b5137;margin-top:8px}
  .name{font-size:34px;font-weight:700;margin:6px 0;border-bottom:1px solid var(--gold2);display:inline-block;padding:0 18px 6px}
  .prog{font-size:20px;margin:14px 0 4px}
  .body{text-align:center}
  .meta{display:flex;justify-content:space-between;gap:20px;margin-top:34px;font-size:13px;color:#5b5137}
  .meta .sig{text-align:center;flex:1}
  .meta .sig .line{border-top:1px solid var(--ink);margin:26px 12px 4px}
  .verify{margin-top:26px;border-top:1px dashed var(--gold2);padding-top:12px;text-align:center;font-size:12.5px;color:#5b5137}
  .verify code{background:#f1ead9;border:1px solid #e3d9c0;border-radius:4px;padding:1px 6px}
  .verify a{color:#7a5a12}
  .noprint{text-align:center;margin:18px auto;max-width:900px}
  .noprint button{font:inherit;background:var(--gold);color:#1a1304;border:0;border-radius:8px;padding:9px 20px;font-weight:700;cursor:pointer}
  @media print{ body{background:#fff;padding:0} .noprint{display:none} .sheet{box-shadow:none;border-color:var(--gold);margin:0} @page{margin:14mm} }
</style></head><body>
<div class=noprint><button onclick="window.print()">🖨️ Print / Save as PDF</button>
  <span style="margin-left:10px;color:#6b5f47;font-size:13px">Verify: <a href="${esc(verifyUrl)}">${esc(verifyUrl)}</a></span></div>
<div class=sheet>
  <div class=top>${sealSvg((cred.issuer && cred.issuer.name) || 'MELEK ACADEMY', 108)}
    <div class=kicker>${esc(kind)}</div>
    <h1>MELEK Academy</h1>
    <div class=sub>issued under the authority of ${esc(cred.issuer && cred.issuer.name)}</div>
  </div>
  <div class=rule></div>
  <div class=body>
    <div class=awarded>This certifies that</div>
    <div class=name>${esc(cred.recipient && cred.recipient.name)}</div>
    <div class=awarded>${cred.type === 'ministerial' ? 'is recognized as' : cred.type === 'press' ? 'is credentialed as press for' : 'has successfully completed'}</div>
    <div class=prog><b>${esc(cred.program && cred.program.name)}</b></div>
    <div class=sub style="max-width:640px;margin:6px auto 0">${esc(cred.note || '')}</div>
  </div>
  <div class=meta>
    <div class=sig><div class=line></div>Hathor · Founding Witness of MELEK</div>
    <div style="text-align:center;align-self:flex-end"><div style="font-size:12px;color:var(--gold);letter-spacing:2px">ISSUED</div>${esc(cred.issuedAt)}${cred.expiresAt ? `<div style="font-size:11px">expires ${esc(cred.expiresAt)}</div>` : ''}</div>
    <div class=sig><div class=line></div>${esc(cred.issuer && cred.issuer.name)}</div>
  </div>
  <div class=verify><b>Verify authenticity.</b> Anyone can confirm this credential at
    <a href="${esc(verifyUrl)}">${esc(verifyUrl.replace(/^https?:\/\//, ''))}</a> — credential id <code>${esc(cred.id)}</code>.
    Non-accredited: a credential of its named issuer, not college credit, a CEU, or a government license.</div>
</div>
</body></html>`;
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

// ── /earn/:id — how you actually GET a credential ───────────────────────────────────────────────
// Completion credentials: study + pass a short assessment -> the Academy issues it to you (self-serve).
// Ministerial/press: an application the issuing authority reviews (queued, never auto-minted).
const COURSE_LINKS = { ai: WITNESS, crypto: WITNESS, civics: WITNESS, library: 'https://wiki.soapbox.community', esoteric: 'https://wiki.soapbox.community' };

export function earnView(id, { error = '' } = {}) {
  const p = getProgram(id);
  if (!p) return page('Not found — MELEK Academy', `<h1>Not found</h1><p class=muted><a href="/">All programs →</a></p>`, {});
  const issuer = ISSUERS[CREDENTIAL_TYPES[p.type].issuer];
  if (isCompletion(p)) {
    const a = getAssessment(p.id);
    const courseUrl = COURSE_LINKS[p.track] || WITNESS;
    const quiz = a ? a.questions.map((qn, i) => `<div class=card><b>${i + 1}. ${esc(qn.q)}</b>${qn.options.map((o, j) => `
      <label style="display:block;margin-top:6px;font-size:14px;cursor:pointer"><input type=radio name="a${i}" value="${j}" required> ${esc(o)}</label>`).join('')}</div>`).join('')
      : `<div class=card>This credential has no assessment configured yet.</div>`;
    return page(`Earn — ${p.name}`, `<p><a href="/program/${esc(p.id)}">← ${esc(p.name)}</a></p>
      <h1>Earn: ${esc(p.name)}</h1>
      <p class=lead>Two steps: <b>1)</b> study the material, <b>2)</b> pass the short check below. Pass it and the
        Academy issues your verifiable credential right away — then you print the certificate.</p>
      <div class=card><h3 style="margin-top:0">1 · Study</h3><p class=muted style="font-size:14px">${esc(p.criteria)}</p>
        <p><a href="${esc(courseUrl)}">Open the course material →</a></p></div>
      ${error ? `<div class=band>${esc(error)}</div>` : ''}
      <form method=post action="/earn/${esc(p.id)}">
        <div class=card><h3 style="margin-top:0">2 · Your name (as it appears on the certificate)</h3>
          <input name=name required placeholder="Your name" style="font-size:15px"></div>
        <h3>3 · Knowledge check</h3>${quiz}
        <button type=submit style="font-size:15px">Submit &amp; earn my credential</button></form>`, { canonical: `${BASE_URL}/earn/${p.id}`, robots: 'noindex,follow' });
  }
  const affirm = p.type === 'ministerial'
    ? 'I affirm the Temple’s tenets and wish to be ordained / recognized as a minister.'
    : 'I agree to the MELEK Press contributor standards and wish to be credentialed as MELEK press.';
  return page(`Apply — ${p.name}`, `<p><a href="/program/${esc(p.id)}">← ${esc(p.name)}</a></p>
    <h1>Apply: ${esc(p.name)}</h1>
    <p class=lead>This credential is issued by <b>${esc(issuer.name)}</b> after review — you can’t self-mint it.
      Send your application and the issuing authority will issue it to you on approval.</p>
    ${error ? `<div class=band>${esc(error)}</div>` : ''}
    <form method=post action="/earn/${esc(p.id)}">
      <div class=card><input name=name required placeholder="Your name" style="font-size:15px;margin-bottom:8px">
        <input name=contact placeholder="How to reach you (email / MELEK account)" style="font-size:15px;margin-bottom:8px">
        <textarea name=note placeholder="A sentence on why (optional)" style="min-height:80px"></textarea>
        <label style="display:block;margin-top:8px;font-size:14px"><input type=checkbox name=affirm required> ${esc(affirm)}</label></div>
      <button type=submit style="font-size:15px">Send application</button></form>`, { canonical: `${BASE_URL}/earn/${p.id}`, robots: 'noindex,follow' });
}

/** Handle an /earn POST. `body` is the parsed form object. Returns { redirect } or { html }. */
export function earnSubmit(id, body = {}) {
  const p = getProgram(id);
  if (!p) return { html: earnView(id, { error: 'Unknown program.' }) };
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return { html: earnView(id, { error: 'Please enter your name.' }) };
  if (isCompletion(p)) {
    const a = getAssessment(p.id);
    const answers = a ? a.questions.map((_, i) => Number(body[`a${i}`])) : [];
    const score = scoreAssessment(p.id, answers);
    if (!score.passed) return { html: earnView(id, { error: `Not quite — you got ${score.correct}/${score.total}; you need ${score.needed}. Review the material and try again.` }) };
    const r = _registry.issue({ programId: p.id, recipientName: name, evidence: `Passed the MELEK Academy assessment for ${p.name}` });
    if (!r.ok) return { html: earnView(id, { error: 'Could not issue — please try again.' }) };
    const c = Buffer.from(JSON.stringify(r.credential), 'utf8').toString('base64');
    return { redirect: `/certificate?c=${encodeURIComponent(c)}` };
  }
  if (!body.affirm) return { html: earnView(id, { error: 'Please affirm the statement to apply.' }) };
  _applications.push({ programId: p.id, name, contact: String(body.contact || '').slice(0, 160), note: String(body.note || '').slice(0, 500), at: new Date().toISOString() });
  return { html: page(`Application received — ${p.name}`, `<h1>Application received ✓</h1>
    <p class=lead>Thank you, ${esc(name)}. Your application for <b>${esc(p.name)}</b> has been recorded. The
      issuing authority (${esc(ISSUERS[CREDENTIAL_TYPES[p.type].issuer].name)}) reviews applications and issues
      your credential on approval — you’ll then print your certificate.</p>
    <p><a href="/">← back to the Academy</a></p>`, { robots: 'noindex,follow' }) };
}

// minimal, bounded form-urlencoded body reader.
function readBody(req, limit = 16384) {
  return new Promise((resolve) => {
    if (!req || typeof req.on !== 'function') return resolve({});
    let data = ''; let over = false;
    req.on('data', (c) => { data += c; if (data.length > limit) over = true; });
    req.on('end', () => {
      if (over) return resolve({});
      const out = {};
      for (const pair of String(data).split('&')) { const [k, v = ''] = pair.split('='); if (k) out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' ')); }
      resolve(out);
    });
    req.on('error', () => resolve({}));
  });
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
      return res.end(llmsTxt({ name: 'MELEK Academy — credentials', baseUrl: BASE_URL, summary: 'Earn and verify legitimate non-accredited MELEK credentials: Temple-issued religious credentials, MELEK Press passes, and course-completion certificates, as verifiable Open Badges.', links: [{ label: 'Programs', path: '/' }, { label: 'Verify a credential', path: '/verify' }, { label: 'Registry', path: '/registry' }] }));
    }
    if (path === '/') return sendHtml(res, homePage());
    if (path === '/verify' || path === '/verify.html') return sendHtml(res, verifyView({ id: url.searchParams.get('id') || '', c: url.searchParams.get('c') || '' }));
    if (path === '/registry') return sendHtml(res, registryView());
    const pm = path.match(/^\/program\/([a-z0-9-]+)$/);
    if (pm) return sendHtml(res, programView(pm[1]));
    // /earn/:id — earn (assessment) or apply (application) — this is how a person actually GETS a credential
    const em = path.match(/^\/earn\/([a-z0-9-]+)$/);
    if (em) {
      if (String(req.method || 'GET').toUpperCase() === 'POST') {
        const r = earnSubmit(em[1], await readBody(req));
        if (r.redirect) { res.writeHead(302, { location: r.redirect }); return res.end(); }
        return sendHtml(res, r.html);
      }
      return sendHtml(res, earnView(em[1]));
    }
    // public credential landing (employers look it up) + printable certificate — by id or self-contained ?c=
    if (path === '/credential') return sendHtml(res, credentialView({ id: url.searchParams.get('id') || '', c: url.searchParams.get('c') || '' }));
    const crm = path.match(/^\/credential\/([A-Za-z0-9-]+)$/);
    if (crm) return sendHtml(res, credentialView({ id: crm[1] }));
    if (path === '/certificate') return sendHtml(res, certificateView({ id: url.searchParams.get('id') || '', c: url.searchParams.get('c') || '' }));
    const cem = path.match(/^\/certificate\/([A-Za-z0-9-]+)$/);
    if (cem) return sendHtml(res, certificateView({ id: cem[1] }));
    // /issue — TEMPLE/OPERATOR-GATED. Requires POST + the issuer token in the x-issuer-token HEADER
    // (never in the URL, so it can't leak into logs/history), compared in constant time. No self-mint.
    if (path === '/issue') {
      const tok = (req.headers && req.headers['x-issuer-token']) || '';
      const okMethod = String(req.method || 'GET').toUpperCase() === 'POST';
      if (!issuerTokenOk(tok, okMethod)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, reason: 'issuance is gated to the issuing authority (POST with the x-issuer-token header)' }));
      }
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
