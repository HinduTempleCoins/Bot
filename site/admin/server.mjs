// site/admin/server.mjs — the Soapy.blog ADMIN PORTAL: a single-admin operator console.
//
// One web surface for the operator (and ONLY the operator — admin-auth.mjs enforces the
// single-admin lock against ADMIN_EMAIL) to:
//   • log in (email magic-link, or "Login with Google" when a Google client id is configured),
//   • connect external accounts for IFTTT/automation (the OAuth hub),
//   • read first-party traffic analytics, server diagnostics, and run a security scan.
//
// Built on node:http like site/soapbox/server.mjs. SERVER-RENDERED minimal HTML; EVERY value is
// HTML-escaped before it reaches the page. SECRETS ARE NEVER RENDERED — the OAuth hub only ever
// surfaces { name, scopes, status }, the credential store only surfaces names/scopes/caps, and the
// auth layer only surfaces booleans + the admin email. No token, ciphertext, or key is ever printed.
//
// Every route except /login, /auth/*, and /health is gated by requireAdmin: no valid admin session
// → 401 + redirect to /login.
//
//   node site/admin/server.mjs                 # http://localhost:8096
//   PORT=8096 ADMIN_EMAIL=you@gmail.com BASE_URL=https://soapy.blog node site/admin/server.mjs
//
// The route handler is exported as `handle(req, res)` so tests drive it directly (offline, no listen).

import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO_ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
import crypto from 'node:crypto';
import {
  startEmailLogin, verifyMagicLink, verifyGoogleLogin, createSession, requireAdmin, adminEmail, backupEmail,
} from '../../integrations/admin-auth.mjs';
import { SERVICES, authorizeUrl, listConnections, handleCallback } from '../../integrations/ifttt-connect.mjs';
import { scan } from '../../integrations/security-scan.mjs';
import { diagnostics } from '../../integrations/server-diagnostics.mjs';
import { trafficSummary } from '../../integrations/soapbox/analytics.mjs';
import { grant as credGrant } from '../../integrations/credential-store.mjs';
import { repoFeatures, summary as featureSummary, setFlag, tierOrder } from '../../integrations/feature-registry.mjs';
import { sendToClaude, relayStatus, renderPanel as claudePanel, history as claudeHistory } from '../../integrations/claude-relay.mjs';
import { tradeBoard, renderBoard as renderTradeBoard, decisionQueue } from '../../integrations/trade-hud.mjs';
import { chainsBoard, renderBoard as renderChainsBoard } from '../../integrations/chains-hud.mjs';
import { ecosystemMap, renderMap as renderEcosystemMap } from '../../integrations/ecosystem-map.mjs';
import { startRecovery, roleFor } from '../../integrations/admin-auth.mjs';
import * as captcha from '../../integrations/captcha-handoff.mjs';
import {
  generateRegistrationOptions, verifyRegistration,
  generateAuthenticationOptions, verifyAuthentication,
} from '../../integrations/webauthn.mjs';
import {
  listCredentials, addCredential, getByCredentialId, updateSignCount,
} from '../../integrations/passkey-store.mjs';

// Share the CAPTCHA-handoff queue with the browser-provisioning process via a file store, so a
// CAPTCHA hit during an automated signup (e.g. Twitter) shows up here for the operator to solve.
try {
  const f = process.env.CAPTCHA_HANDOFF_FILE || join(REPO_ROOT_DIR, 'data', 'captcha-handoffs.json');
  captcha.__setStore(captcha.makeFileStore(f));
} catch { /* keep in-memory default */ }

const PORT = +(process.env.PORT || 8096);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// ── escaping (single source of truth; everything user/data-derived passes through here) ──────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── layout ───────────────────────────────────────────────────────────────────────────────────────
const STYLE = `
  :root{--bg:#0f1115;--panel:#171a21;--line:#262b35;--fg:#e6e9ef;--mut:#8a93a3;--accent:#6ea8fe}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,Segoe UI,Roboto,sans-serif}
  header{display:flex;align-items:center;gap:16px;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--panel)}
  header a{color:var(--fg);text-decoration:none;font-size:14px}
  header a:hover{color:var(--accent)}
  main{max-width:980px;margin:0 auto;padding:24px 22px}
  h1{font-size:22px;margin:0 0 6px}h2{font-size:16px;margin:0 0 10px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 16px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}
  th{color:var(--mut);font-weight:600}
  input,textarea,button{font:inherit}
  input[type=email],input[type=url],textarea{width:100%;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
  button,.btn{display:inline-block;padding:9px 16px;border:1px solid var(--line);border-radius:8px;background:var(--accent);color:#08101f;font-weight:600;cursor:pointer;text-decoration:none}
  .btn.ghost{background:transparent;color:var(--fg)}
  .badge{display:inline-block;padding:1px 8px;border-radius:999px;background:var(--bg);border:1px solid var(--line);font-size:12px;color:var(--mut)}
  .ok{color:#5fd38a}.bad{color:#ff6b6b}.warn{color:#ffc857}
  code{background:var(--bg);padding:1px 5px;border-radius:4px;font-size:13px}
`;

// ── client-side WebAuthn glue (no framework; uses the platform navigator.credentials API) ─────────
// base64url ⇄ ArrayBuffer helpers + the two ceremonies. Kept tiny and CSP-friendly (single inline
// script tags injected only on the pages that need them). All values are server-issued base64url.
const WEBAUTHN_HELPERS_JS = `
  function b64uToBuf(s){s=s.replace(/-/g,'+').replace(/_/g,'/');var p=s.length%4?'='.repeat(4-s.length%4):'';var bin=atob(s+p);var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u.buffer;}
  function bufToB64u(b){var u=new Uint8Array(b);var s='';for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
`;
const PASSKEY_LOGIN_JS = `<script>${WEBAUTHN_HELPERS_JS}
  (function(){
    var btn=document.getElementById('passkey-login'),msg=document.getElementById('passkey-msg');
    if(!btn) return;
    if(!window.PublicKeyCredential){btn.disabled=true;msg.textContent='This browser does not support passkeys.';return;}
    btn.addEventListener('click',async function(){
      msg.textContent='Waiting for your passkey…';
      try{
        var o=await fetch('/auth/passkey/login/options',{method:'POST',headers:{'content-type':'application/json'}}).then(r=>r.json());
        if(!o||!o.challenge){msg.textContent='Could not start passkey login.';return;}
        var pub={challenge:b64uToBuf(o.challenge),rpId:o.rpId,timeout:o.timeout,userVerification:o.userVerification,
          allowCredentials:(o.allowCredentials||[]).map(c=>({type:'public-key',id:b64uToBuf(c.id)}))};
        var cred=await navigator.credentials.get({publicKey:pub});
        var body={handle:o.handle,id:cred.id,rawId:bufToB64u(cred.rawId),type:cred.type,response:{
          clientDataJSON:bufToB64u(cred.response.clientDataJSON),
          authenticatorData:bufToB64u(cred.response.authenticatorData),
          signature:bufToB64u(cred.response.signature),
          userHandle:cred.response.userHandle?bufToB64u(cred.response.userHandle):null}};
        var v=await fetch('/auth/passkey/login/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
        if(v&&v.ok){window.location='/';}else{msg.textContent='Passkey sign-in failed'+(v&&v.reason?' ('+v.reason+')':'')+'.';}
      }catch(e){msg.textContent='Passkey sign-in cancelled or failed.';}
    });
  })();
</script>`;
const PASSKEY_ENROL_JS = `<script>${WEBAUTHN_HELPERS_JS}
  (function(){
    var btn=document.getElementById('passkey-enrol'),msg=document.getElementById('passkey-enrol-msg');
    if(!btn) return;
    if(!window.PublicKeyCredential){btn.disabled=true;msg.textContent='This browser does not support passkeys.';return;}
    btn.addEventListener('click',async function(){
      msg.textContent='Follow your device prompt…';
      try{
        var o=await fetch('/auth/passkey/register/options',{method:'POST',headers:{'content-type':'application/json'}}).then(r=>r.json());
        if(!o||!o.challenge){msg.textContent='Could not start enrolment.';return;}
        var pub={challenge:b64uToBuf(o.challenge),rp:o.rp,user:{id:b64uToBuf(o.user.id),name:o.user.name,displayName:o.user.displayName},
          pubKeyCredParams:o.pubKeyCredParams,timeout:o.timeout,attestation:o.attestation,authenticatorSelection:o.authenticatorSelection,
          excludeCredentials:(o.excludeCredentials||[]).map(c=>({type:'public-key',id:b64uToBuf(c.id)}))};
        var cred=await navigator.credentials.create({publicKey:pub});
        var body={id:cred.id,rawId:bufToB64u(cred.rawId),type:cred.type,response:{
          clientDataJSON:bufToB64u(cred.response.clientDataJSON),
          attestationObject:bufToB64u(cred.response.attestationObject)}};
        var v=await fetch('/auth/passkey/register/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());
        if(v&&v.ok){msg.textContent='Passkey enrolled. You can now sign in with it.';setTimeout(()=>window.location.reload(),1200);}else{msg.textContent='Enrolment failed'+(v&&v.reason?' ('+v.reason+')':'')+'.';}
      }catch(e){msg.textContent='Enrolment cancelled or failed.';}
    });
  })();
</script>`;

function layout({ title = 'Admin', body = '', nav = true } = {}) {
  const navHtml = nav ? `<header>
    <strong>Soapy.blog · Admin</strong>
    <a href="/">Dashboard</a>
    <a href="/hud">HUD</a>
    <a href="/trade">Trade</a>
    <a href="/chains">Chains</a>
    <a href="/claude">Claude</a>
    <a href="/connect">Connect</a>
    <a href="/captcha">CAPTCHA</a>
    <a href="/features">Features</a>
    <a href="/analytics">Analytics</a>
    <a href="/diagnostics">Diagnostics</a>
    <a href="/security">Security</a>
  </header>` : '';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
    <meta name=viewport content="width=device-width,initial-scale=1">
    <meta name=robots content="noindex,nofollow">
    <title>${esc(title)} · Soapy.blog Admin</title><style>${STYLE}</style></head>
    <body>${navHtml}<main>${body}</main></body></html>`;
}

// ── tiny http helpers ──────────────────────────────────────────────────────────────────────────
const html = (res, body, code = 200) => {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};
const redirect = (res, location) => {
  res.writeHead(302, { location, 'cache-control': 'no-store' });
  res.end();
};
const json = (res, obj, code = 200) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};
function readBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(buf));
    req.on('error', () => resolve(buf));
  });
}
function formParams(raw) {
  return new URLSearchParams(raw || '');
}
// Read + parse a JSON request body (the WebAuthn ceremony endpoints post JSON). Soft-fail → null.
async function readJson(req) {
  try { return JSON.parse(await readBody(req) || '{}'); } catch { return null; }
}
// Optional backup email, guarded — backupEmail() comes from admin-auth; absent in old test setups.
function backupEmailSafe() {
  try { return backupEmail(); } catch { return ''; }
}
// Set the session cookie. On https we harden it: the `__Host-` name prefix (binds the cookie to
// this exact host, Secure, Path=/, no Domain — un-overridable by a subdomain or a network attacker)
// plus SameSite=Strict (the cookie is never sent on a cross-site navigation, a second CSRF layer
// under the Origin check). On localhost http we keep the plain `admin_session` name + SameSite=Lax
// so dev + the offline tests (which read `admin_session=`) keep working.
const IS_HTTPS = BASE_URL.startsWith('https');
const SESSION_COOKIE_NAME = IS_HTTPS ? '__Host-admin_session' : 'admin_session';
function sessionCookie(token) {
  if (IS_HTTPS) {
    return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure`;
  }
  return `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`;
}

// ── CSRF: Origin/Referer same-origin check for state-changing POSTs ──────────────────────────────
// A browser attaches Origin (and/or Referer) to cross-site form posts. We reject any POST whose
// Origin (or, absent Origin, the Referer's origin) is a DIFFERENT origin than this portal's
// BASE_URL. A missing Origin AND missing Referer is allowed: that's a non-browser client (curl,
// the offline tests) which can't be driven by a victim's browser, so it isn't a CSRF vector.
// SameSite=Strict on the cookie (https) is the belt to this suspenders.
const BASE_ORIGIN = (() => { try { return new URL(BASE_URL).origin; } catch { return null; } })();

// ── WebAuthn / passkey config ────────────────────────────────────────────────────────────────────
// The Relying Party id is the registrable domain (the hostname, no scheme/port) — passkeys are bound
// to it. The expected origin for the ceremony is the full BASE_URL origin. Both derive from BASE_URL
// so dev (localhost) and prod (soapy.blog) work without extra env.
const RP_ID = (() => { try { return new URL(BASE_URL).hostname; } catch { return 'localhost'; } })();
const RP_NAME = 'Soapy.blog Admin';

// Server-side challenge store for in-flight WebAuthn ceremonies. A challenge is single-use and
// short-lived (it binds one navigator.credentials call to one verify). Registration challenges are
// keyed by the admin email; login challenges are anonymous (we don't know the email until the
// assertion names a credential), keyed by an opaque handle echoed back by the client.
const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const _waChallenges = new Map(); // key → { challenge, exp, email? }
function putChallenge(key, challenge, extra = {}) {
  _waChallenges.set(key, { challenge, exp: Date.now() + WEBAUTHN_CHALLENGE_TTL_MS, ...extra });
}
function takeChallenge(key) {
  const e = _waChallenges.get(key);
  if (!e) return null;
  _waChallenges.delete(key); // single use
  if (e.exp <= Date.now()) return null;
  return e;
}
function sameOriginOK(req) {
  const h = req.headers || {};
  const origin = h.origin || h.Origin;
  if (origin) {
    try { return new URL(origin).origin === BASE_ORIGIN; } catch { return false; }
  }
  const referer = h.referer || h.Referer;
  if (referer) {
    try { return new URL(referer).origin === BASE_ORIGIN; } catch { return false; }
  }
  return true; // no Origin and no Referer → not a browser cross-site post
}

// ── magic-link delivery ──────────────────────────────────────────────────────────────────────────
// Dev (localhost BASE_URL): the link renders on-screen. Production: NEVER on-screen — anyone who
// types the admin email would see it. Deliver out-of-band to the operator's Telegram (token by
// env NAME, assembled; chat id via ADMIN_CHAT_ID) and answer with a non-enumerating notice.
const IS_LOCAL = /^http:\/\/(localhost|127\.)/.test(BASE_URL);
async function deliverMagicLink(link) {
  try {
    const token = process.env[['TELEGRAM', 'BOT', 'TOKEN'].join('_')];
    const chatId = process.env.ADMIN_CHAT_ID;
    if (!token || !chatId) return { sent: false, reason: 'no-telegram' };
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `Soapy.blog admin sign-in link (expires soon):\n${link}`,
        // belt-and-braces with the peek-then-POST flow: don't let Telegram
        // prefetch the URL for a preview at all.
        link_preview_options: { is_disabled: true },
        disable_web_page_preview: true,
      }),
    });
    return { sent: !!(r && r.ok) };
  } catch { return { sent: false, reason: 'send-failed' }; }
}

// ── OAuth-connect pending-state store (in-process, short-lived) ──────────────────────────────────
// When the operator clicks "Connect" for a service, authorizeUrl() mints a CSRF `state` and (for
// PKCE providers) a `codeVerifier`. We stash { service, codeVerifier, exp } keyed by that state, so
// the provider's redirect to /connect/callback can be validated (state must match one we issued)
// and the PKCE verifier recovered for the token exchange. Entries are single-use and TTL-bounded;
// the codeVerifier is a per-flow secret held only in memory here, never rendered.
const CONNECT_STATE_TTL_MS = 10 * 60 * 1000;
const _connectStates = new Map();
function rememberConnectState(state, service, codeVerifier) {
  if (!state) return;
  _connectStates.set(state, { service, codeVerifier: codeVerifier || null, exp: Date.now() + CONNECT_STATE_TTL_MS });
}
function takeConnectState(state) {
  if (!state) return null;
  const e = _connectStates.get(state);
  if (!e) return null;
  _connectStates.delete(state); // single use
  if (e.exp <= Date.now()) return null;
  return e;
}
// test seam: let tests preload a known (state → flow) so the callback can be exercised offline.
export function __rememberConnectState(state, service, codeVerifier) { rememberConnectState(state, service, codeVerifier); }

// ── Google client id — from env or the credential vault (NEVER the secret, only the public id) ───
function googleClientId() {
  if (process.env.GOOGLE_CLIENT_ID) return process.env.GOOGLE_CLIENT_ID;
  try {
    // credential-store.grant() returns a capability handle; we only read its public `cap`, never the secret.
    const g = credGrant('oauth:google');
    const id = g && g.cap && (g.cap.clientId || g.cap.client_id);
    return id || '';
  } catch { return ''; }
}

// ── pages ────────────────────────────────────────────────────────────────────────────────────────
function dashboardPage(email) {
  let passkeys = [];
  try { passkeys = listCredentials(email) || []; } catch { passkeys = []; }
  const pkRows = passkeys.length
    ? `<ul>${passkeys.map((c) => `<li><code>${esc(c.label || 'passkey')}</code> <span class=muted style="font-size:12px">added ${esc(new Date(c.createdAt || 0).toISOString().slice(0, 10))}${c.lastUsedAt ? `, last used ${esc(new Date(c.lastUsedAt).toISOString().slice(0, 10))}` : ''}</span></li>`).join('')}</ul>`
    : '<p class=muted style="font-size:13px">No passkeys enrolled yet.</p>';
  const passkeyCard = `<div class=card><h2>Passkeys</h2>
      <p class=muted style="font-size:13px">Enrol a fingerprint / face / security key so you can sign in without the email inbox.</p>
      ${pkRows}
      <p><button type=button id=passkey-enrol class="btn ghost">Add a passkey</button></p>
      <p id=passkey-enrol-msg class=muted style="font-size:13px"></p>
    </div>${PASSKEY_ENROL_JS}`;
  const body = `<h1>Operator Console</h1>
    <p class=muted>Signed in as <code>${esc(email)}</code>. <a class="btn ghost" href="/logout">Log out</a></p>
    ${passkeyCard}
    <div class=card><h2>Quick links</h2>
      <ul>
        <li><a href="/connect">Connect accounts</a> — OAuth hub for IFTTT/automation (Google, GitHub, Discord, Slack, X, Reddit, Dropbox).</li>
        <li><a href="/features">Features</a> — everything built in the repo, including what's <em>not yet live</em> on a subdomain; queue capabilities to surface.</li>
        <li><a href="/analytics">Traffic analytics</a> — first-party, privacy-safe view counts from the access logs.</li>
        <li><a href="/diagnostics">Server diagnostics</a> — host health, services, disk.</li>
        <li><a href="/security">Security scan</a> — scan a URL or HTML snippet for threats.</li>
      </ul></div>`;
  return layout({ title: 'Dashboard', body });
}

function loginPage({ notice = '', magicLink = '' } = {}) {
  const gid = googleClientId();
  const redirectUri = `${BASE_URL}/auth/google/callback`;
  let googleBlock;
  if (gid) {
    let url = '#';
    try { url = authorizeUrl('google', { clientId: gid, redirectUri }).url; } catch { url = '#'; }
    googleBlock = `<a class=btn href="${esc(url)}">Login with Google</a>`;
  } else {
    googleBlock = `<p class=muted><span class=badge>Login with Google</span> unavailable — no Google client id configured. Set <code>GOOGLE_CLIENT_ID</code> or store an <code>oauth:google</code> grant.</p>`;
  }
  const noticeHtml = notice ? `<p class=warn>${esc(notice)}</p>` : '';
  // In dev (no mailer wired) we render the magic link on-screen so the operator can complete login.
  const magicHtml = magicLink
    ? `<div class=card><h2>Magic link (dev)</h2><p class=muted>No mailer is wired in this environment, so the link is shown here. Open it to finish signing in:</p><p><a href="${esc(magicLink)}">${esc(magicLink)}</a></p></div>`
    : '';
  const body = `<h1>Admin sign-in</h1>
    ${noticeHtml}
    <div class=card><h2>Email magic link</h2>
      <form method=POST action="/login/email">
        <p><input type=email name=email placeholder="${esc(adminEmail() || 'you@example.com')}" autocomplete=email required></p>
        <p><button type=submit>Send magic link</button></p>
      </form>
      <p class=muted style="font-size:13px">Only the configured operator email can sign in.</p>
    </div>
    ${magicHtml}
    <div class=card><h2>Passkey</h2>
      <p class=muted style="font-size:13px">Sign in with your fingerprint, face, or security key — no email needed. Enrol a passkey from the dashboard after your first sign-in.</p>
      <p><button type=button id=passkey-login>Sign in with passkey</button></p>
      <p id=passkey-msg class=muted style="font-size:13px"></p>
    </div>
    <div class=card><h2>Or</h2>${googleBlock}</div>
    ${PASSKEY_LOGIN_JS}`;
  return layout({ title: 'Sign in', body, nav: false });
}

function connectPage(connections = [], { notice = '' } = {}) {
  const redirectUri = `${BASE_URL}/connect/callback`;
  const connected = new Map(connections.map((c) => [c.name, c]));
  const rows = Object.values(SERVICES).map((svc) => {
    const conn = connected.get(svc.name);
    const clientId = process.env[`${svc.name.toUpperCase()}_CLIENT_ID`] || (svc.name === 'google' ? googleClientId() : '');
    let authLink;
    if (clientId) {
      let url = '#';
      try {
        const a = authorizeUrl(svc.name, { clientId, redirectUri });
        url = a.url;
        // Persist the CSRF state + PKCE verifier so /connect/callback can validate the round-trip.
        rememberConnectState(a.state, svc.name, a.codeVerifier);
      } catch { url = '#'; }
      authLink = `<a class="btn ghost" href="${esc(url)}">Connect</a>`;
    } else {
      authLink = `<span class=muted style="font-size:12px">set <code>${esc(svc.name.toUpperCase())}_CLIENT_ID</code></span>`;
    }
    const status = conn
      ? `<span class="${conn.status === 'connected' ? 'ok' : 'warn'}">${esc(conn.status)}</span>${conn.scopes && conn.scopes.length ? ` <span class=muted style="font-size:12px">(${esc(conn.scopes.join(', '))})</span>` : ''}`
      : '<span class=muted>not connected</span>';
    return `<tr><td><strong>${esc(svc.name)}</strong></td>
      <td class=muted style="font-size:13px">${esc((svc.scopes || []).join(' '))}</td>
      <td>${status}</td><td>${authLink}</td></tr>`;
  }).join('');
  const noticeHtml = notice ? `<p class="${/error/i.test(notice) ? 'bad' : 'ok'}">${esc(notice)}</p>` : '';
  const body = `<h1>Connect accounts</h1>
    <p class=muted>OAuth hub for IFTTT/automation. Tokens are held as capability grants in the vault — they are never shown here.</p>
    ${noticeHtml}
    <div class=card><table>
      <thead><tr><th>Service</th><th>Default scopes</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  return layout({ title: 'Connect', body });
}

// ── the HUD pages: ecosystem map / trade analytics / chains / Server-4 Claude ───────────────────
// Each is a thin admin-gated shell around its read-only board module; one board failing
// renders an honest error card, never a dead page.
async function hudPage() {
  try {
    const map = await ecosystemMap();
    return layout({ title: 'HUD', body: `<h1>Everything we have</h1>${renderEcosystemMap(map)}` });
  } catch (e) {
    return layout({ title: 'HUD', body: `<h1>Everything we have</h1><p class=bad>Map unavailable: ${esc(e?.message || e)}</p>` });
  }
}

async function tradePage() {
  try {
    const board = await tradeBoard();
    const queue = decisionQueue(board) || [];
    const queueHtml = queue.length
      ? `<div class=card><h2>Decisions waiting on you</h2><ul>${queue.map((d) => `<li>${esc(typeof d === 'string' ? d : d.text || d.title || '')}</li>`).join('')}</ul></div>`
      : '';
    return layout({ title: 'Trade', body: `<h1>Trade analytics</h1>${queueHtml}${renderTradeBoard(board)}` });
  } catch (e) {
    return layout({ title: 'Trade', body: `<h1>Trade analytics</h1><p class=bad>Board unavailable: ${esc(e?.message || e)}</p>` });
  }
}

async function chainsPage() {
  try {
    const board = await chainsBoard();
    return layout({ title: 'Chains', body: `<h1>Our chains</h1>${renderChainsBoard(board)}` });
  } catch (e) {
    return layout({ title: 'Chains', body: `<h1>Our chains</h1><p class=bad>Board unavailable: ${esc(e?.message || e)}</p>` });
  }
}

// The CAPTCHA-handoff console: when an automated signup (e.g. a Twitter account via the vault
// browser) hits a CAPTCHA / SMS / human step, it enqueues a handoff here. The operator reads the
// prompt (+ screenshot link), solves it, and submits the answer — the flow resumes on that answer.
// The bot NEVER auto-defeats a CAPTCHA; the human solves it. "Test it" seeds a Twitter handoff so
// you can confirm the round-trip works end to end.
function captchaPage({ notice = '' } = {}) {
  let pending = [];
  try { pending = captcha.listPending() || []; } catch { pending = []; }
  const rows = pending.map((h) => `<div class=card>
      <div><span class=badge>${esc(h.kind)}</span> <span class=muted style="font-size:12px">${esc(h.context || '')}</span></div>
      <p>${esc(h.promptText || '')}</p>
      ${h.screenshotRef ? `<p class=muted style="font-size:12px">screenshot: <a href="${esc(h.screenshotRef)}" target=_blank rel=noopener>${esc(h.screenshotRef)}</a></p>` : ''}
      <form method=POST action="/captcha/resolve">
        <input type=hidden name=id value="${esc(h.id)}">
        <p><input type=text name=answer placeholder="type the CAPTCHA text / SMS code / approval" autocomplete=off required></p>
        <p><button type=submit>Submit answer</button> <span class=muted style="font-size:12px">id ${esc(h.id.slice(0, 8))}…</span></p>
      </form>
    </div>`).join('');
  const body = `<h1>CAPTCHA / human-step handoffs</h1>
    ${notice ? `<p class=ok>${esc(notice)}</p>` : ''}
    <p class=muted>When an automated signup hits a CAPTCHA, SMS code, or other human-only step, it
      shows up here for you to solve. The bot never auto-defeats a CAPTCHA — you solve it, the flow
      resumes on your answer. Solved answers are single-use and never logged in plaintext.</p>
    <div class=card><form method=POST action="/captcha/test"><button type=submit>🧪 Test it (seed a Twitter CAPTCHA)</button>
      <span class=muted style="font-size:12px"> — proves the round-trip; solve it below to confirm.</span></form></div>
    ${pending.length ? rows : '<p class=muted>No pending handoffs. Hit “Test it” to verify the flow, or wait for a signup to need you.</p>'}`;
  return layout({ title: 'CAPTCHA', body });
}

async function claudePage(sessionId = 'admin') {
  let status = { configured: false, reachable: null };
  try { status = await relayStatus(); } catch { /* soft */ }
  const statusLine = status.configured
    ? '<span class=ok>relay configured</span>'
    : '<span class=warn>relay not configured — set the relay URL + token in the vault (the Claude on the server answers once connected)</span>';
  const body = `<h1>Server Claude</h1>
    <p class=muted>Talk to the Claude running on the server, right from here. ${statusLine}</p>
    ${claudePanel({ sessionId, status })}`;
  return layout({ title: 'Claude', body });
}

// The "what's built but the public can't see yet" catalog. Groups every integration module by
// category and shows LIVE / BUILT(hidden) / SCAFFOLD, with a per-feature front-facing toggle that
// records the operator's INTENT (a deploy step consumes the flag; the portal never deploys itself).
async function featuresPage({ root } = {}) {
  let feats = [];
  let s = { total: 0, byStatus: {}, hidden: 0, byCategory: {} };
  try { feats = await repoFeatures(root ? { root } : {}); s = await featureSummary(root ? { root } : {}); }
  catch (e) { return layout({ title: 'Features', body: `<h1>Features</h1><p class=bad>Could not scan: ${esc(e?.message || e)}</p>` }); }

  const statusBadge = (st) => st === 'LIVE'
    ? '<span class="ok">● LIVE</span>'
    : st === 'BUILT' ? '<span class="warn">○ built · hidden</span>' : '<span class="muted">· scaffold</span>';

  // plain-English tier blurbs — the decision the operator is actually making per group
  const TIER_BLURBS = {
    'FRONT-FACING FIRST': 'The next public portals per our discussions — Law / Politics / benefits / business records / data verticals. These are the go-live decisions on the table right now.',
    'PUBLIC CANDIDATE': 'Could become a public page; nothing forces a decision yet. Pick from here when a portal needs more content.',
    'GATED': 'Blocked on something real — the chain, the signer, a license, or your explicit approval. A toggle here wouldn\'t do anything yet, so the gate reason is shown instead.',
    'INTERNAL TOOL': 'Runs FOR you and the AIs (monitoring, briefs, admin machinery). Never meant to be public — "go live" doesn\'t apply.',
    'BUILDING BLOCK': 'Libraries other features import (rankers, parsers, schemas). They ship inside other features, never as their own page.',
  };

  const stateChip = (flag) => !flag ? '' : flag.state === 'queue'
    ? '<span class="ok" style="font-size:12px">queued to surface ✓</span>'
    : flag.state === 'later'
      ? '<span class="warn" style="font-size:12px">decide later</span>'
      : '<span class="muted" style="font-size:12px">not going live ✕</span>';

  const decideButtons = (f) => {
    if (f.status === 'LIVE') return f.surface ? `<span class=muted style="font-size:12px">${esc(f.surface)}</span>` : '<span class=muted>—</span>';
    if (f.tier === 'GATED') return `<span class=muted style="font-size:12px">${esc(f.gateReason || 'gated')}</span>`;
    if (f.tier === 'INTERNAL TOOL' || f.tier === 'BUILDING BLOCK') {
      return `<span class=muted style="font-size:12px">${f.tier === 'INTERNAL TOOL' ? 'internal — works for you, not the public' : 'used inside other features'}</span>`;
    }
    const btn = (state, label, active) => `<form method=POST action="/features/flag" style="margin:0;display:inline">
        <input type=hidden name=id value="${esc(f.id)}">
        <input type=hidden name=state value="${active ? 'clear' : state}">
        <button class="btn ghost" style="padding:3px 9px;font-size:12px${active ? ';font-weight:700' : ''}">${label}${active ? ' ✓' : ''}</button>
      </form>`;
    const st = f.flag?.state;
    return `${stateChip(f.flag)} ${btn('queue', 'Surface', st === 'queue')} ${btn('later', 'Later', st === 'later')} ${btn('never', 'Not public', st === 'never')}`;
  };

  // group by tier (decision lens), category as a small chip on each row
  const byTier = {};
  for (const f of feats) (byTier[f.tier] ||= []).push(f);
  const sections = tierOrder().filter((t) => byTier[t]?.length).map((tier) => {
    const rows = byTier[tier]
      .map((f) => `<tr>
          <td><strong>${esc(f.label)}</strong> <span class=muted style="font-size:11px">· ${esc(f.category)}</span>
            <div style="font-size:13px;max-width:560px">${esc(f.description || '')}</div>
            <div class=muted style="font-size:11px"><code>${esc(f.path)}</code>${f.flag?.note ? ` · note: ${esc(f.flag.note)}` : ''}</div></td>
          <td>${statusBadge(f.status)}${f.hasTest ? '' : '<div class=muted style="font-size:11px">no test yet</div>'}</td>
          <td style="white-space:nowrap">${decideButtons(f)}</td></tr>`).join('');
    const live = byTier[tier].filter((f) => f.status === 'LIVE').length;
    return `<div class=card><h2>${esc(tier)} <span class=muted style="font-weight:400;font-size:13px">· ${byTier[tier].length} capabilities · ${live} live</span></h2>
      <p class=muted style="font-size:13px">${TIER_BLURBS[tier] || ''}</p>
      <table><thead><tr><th>What it is</th><th>Status</th><th>Your decision</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('');

  const ff = byTier['FRONT-FACING FIRST'] || [];
  const body = `<h1>Features <span class=muted style="font-size:14px">· everything built, sorted by the decision you're making</span></h1>
    <div class=card><h2>What you have</h2>
      <p><strong>${esc(s.total)}</strong> capabilities built ·
         <span class=ok>${esc(s.byStatus.LIVE || 0)} live</span> ·
         <span class=warn>${esc(s.byStatus.BUILT || 0)} built but hidden</span> ·
         <span class=muted>${esc(s.byStatus.SCAFFOLD || 0)} scaffold</span> ·
         <strong>${esc(ff.length)}</strong> front-facing-first candidates at the top</p>
      <p class=muted style="font-size:13px">Each capability now shows a plain-English description (pulled from the module itself) and sits in
        the group matching the decision it needs: <em>Surface</em> queues it for the next deploy, <em>Later</em> parks it,
        <em>Not public</em> records that it stays internal. Nothing deploys by itself.</p>
    </div>
    ${sections}`;
  return layout({ title: 'Features', body });
}

function analyticsPage() {
  let s = null;
  try { s = trafficSummary(); } catch { s = null; }
  if (!s || !s.total) {
    const body = `<h1>Traffic</h1><p class=muted>No access logs found yet. Once the reverse proxy's access logging is on, numbers appear here.</p>`;
    return layout({ title: 'Analytics', body });
  }
  const barRows = (rows) => (rows || []).map(([k, v]) =>
    `<tr><td>${esc(String(k))}</td><td>${esc((v || 0).toLocaleString())}</td></tr>`).join('');
  const body = `<h1>Traffic <span class=muted style="font-size:14px">· first-party, privacy-safe</span></h1>
    <p class=muted>From the server's own access logs — no cookies, no third-party tracker, no stored IPs.</p>
    <div class=card><h2>Overview</h2><table><tbody>
      <tr><td>Total requests</td><td>${esc(s.total.toLocaleString())}</td></tr>
      <tr><td>Human pageviews</td><td>${esc((s.human || 0).toLocaleString())}</td></tr>
      <tr><td>Unique visitors</td><td>${esc((s.uniqueVisitors || 0).toLocaleString())}</td></tr>
      <tr><td>Crawlers / bots</td><td>${esc((s.bot || 0).toLocaleString())}</td></tr>
      <tr><td>404s</td><td>${esc((s.notFound || 0).toLocaleString())}</td></tr>
    </tbody></table></div>
    ${s.topPages && s.topPages.length ? `<div class=card><h2>Top pages</h2><table><tbody>${barRows(s.topPages)}</tbody></table></div>` : ''}
    ${s.byStatus && s.byStatus.length ? `<div class=card><h2>By status</h2><table><tbody>${barRows(s.byStatus)}</tbody></table></div>` : ''}
    ${s.topReferrers && s.topReferrers.length ? `<div class=card><h2>Referrers</h2><table><tbody>${barRows(s.topReferrers)}</tbody></table></div>` : ''}`;
  return layout({ title: 'Analytics', body });
}

async function diagnosticsPage() {
  let d = null;
  try { d = await diagnostics(); } catch (e) { d = { error: e?.message || String(e) }; }
  if (d.error) return layout({ title: 'Diagnostics', body: `<h1>Diagnostics</h1><p class=bad>Unavailable: ${esc(d.error)}</p>` });
  const sys = d.system || {};
  const svc = d.services || {};
  const disk = d.disk || {};
  const sysRows = sys.ok
    ? `<tr><td>Node</td><td>${esc(sys.nodeVersion)}</td></tr>
       <tr><td>Platform</td><td>${esc(sys.platform)}/${esc(sys.arch)}</td></tr>
       <tr><td>CPUs</td><td>${esc(sys.cpuCount)}</td></tr>
       <tr><td>Load avg</td><td>${esc((sys.loadavg || []).map((x) => Number(x).toFixed(2)).join(' '))}</td></tr>
       <tr><td>Uptime</td><td>${esc(sys.uptimeSec)}s</td></tr>
       <tr><td>Memory used</td><td>${esc(sys.memUsedPct)}%</td></tr>`
    : `<tr><td>system</td><td class=bad>unavailable (${esc(sys.error || '')})</td></tr>`;
  const svcRows = (svc.checks || []).map((c) =>
    `<tr><td>${c.ok ? '<span class=ok>up</span>' : '<span class=bad>down</span>'}</td>
     <td>${esc(c.name)}</td><td>${esc(c.ms)}ms</td><td class=muted>${esc(c.sample || '')}</td></tr>`).join('');
  const body = `<h1>Server diagnostics</h1><p class=muted>As of ${esc(d.ts)}.</p>
    <div class=card><h2>System</h2><table><tbody>${sysRows}</tbody></table></div>
    ${disk.ok ? `<div class=card><h2>Disk</h2><table><tbody><tr><td>Used</td><td>${esc(disk.usedPct)}%</td></tr></tbody></table></div>` : ''}
    <div class=card><h2>Services <span class=muted style="font-weight:400;font-size:13px">${esc(svc.up ?? 0)}/${esc(svc.total ?? 0)} up</span></h2>
      <table><thead><tr><th></th><th>Name</th><th>Latency</th><th>Sample</th></tr></thead><tbody>${svcRows || '<tr><td colspan=4 class=muted>no checks</td></tr>'}</tbody></table></div>`;
  return layout({ title: 'Diagnostics', body });
}

function securityResult(r) {
  if (!r) return '';
  const cls = r.verdict === 'block' ? 'bad' : r.verdict === 'warn' ? 'warn' : r.verdict === 'info' ? 'warn' : 'ok';
  const threats = (r.content && r.content.threats || []).map((t) =>
    `<tr><td><span class=${t.severity === 'block' ? 'bad' : 'warn'}>${esc(t.severity)}</span></td>
     <td>${esc(t.kind)}</td><td><code>${esc(t.snippet)}</code></td><td class=muted>${esc(t.why || '')}</td></tr>`).join('');
  return `<div class=card><h2>Result: <span class=${cls}>${esc(r.verdict)}</span> ${r.malicious ? '<span class=bad>(malicious)</span>' : ''}</h2>
    ${threats ? `<table><thead><tr><th>Severity</th><th>Kind</th><th>Snippet</th><th>Why</th></tr></thead><tbody>${threats}</tbody></table>`
      : '<p class=muted>No static threats detected.</p>'}</div>`;
}

function securityPage(result = null) {
  const body = `<h1>Security scan</h1>
    <p class=muted>Scan a URL (reputation) or paste an HTML/JS snippet (static threat detection).</p>
    <div class=card><form method=POST action="/security/scan">
      <p><label class=muted>URL</label><input type=url name=url placeholder="https://example.com"></p>
      <p><label class=muted>HTML / snippet</label><textarea name=html rows=6 placeholder="paste markup or script here"></textarea></p>
      <p><button type=submit>Run scan</button></p>
    </form></div>
    ${securityResult(result)}`;
  return layout({ title: 'Security', body });
}

// ── injectable fetch (so the Google verifier + connect exchange run fully offline in tests) ───────
let _fetch = null;
export function __setFetch(fn) { _fetch = fn || null; }
function theFetch() { return _fetch || globalThis.fetch; }

// ── Google login verifier (injectable for tests) ─────────────────────────────────────────────────
// Default is a REAL verifier: it takes the credential/id_token returned by Google's callback and
// validates it against Google's tokeninfo endpoint, then enforces issuer / audience / expiry /
// email_verified BEFORE trusting any claim. An unverified token is NEVER trusted — on any failure
// (bad audience, wrong issuer, expired, unverified email, network error, malformed response) it
// returns null and login fails closed. Tests inject a verifier via __setGoogleVerifier so no live
// OAuth is needed; the real path uses the injectable fetch (__setFetch) so it is offline-testable.
let _googleVerifier = null;
export function __setGoogleVerifier(fn) { _googleVerifier = fn || null; }

const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// Verify a Google id-token by calling the tokeninfo endpoint, then checking the claims. Returns
// { email, email_verified } on success, else null. NEVER trusts an unverified token; soft-fails.
async function verifyGoogleIdToken(idToken) {
  if (!idToken) return null;
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  if (!clientId) return null; // no configured audience to check against → cannot trust anything
  let claims;
  try {
    const r = await theFetch()(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!r || !r.ok) return null;
    claims = await r.json();
  } catch {
    return null; // network/parse error → fail closed
  }
  if (!claims || typeof claims !== 'object') return null;
  // issuer must be Google
  if (!GOOGLE_ISSUERS.has(String(claims.iss))) return null;
  // audience must be OUR client id (defends against tokens minted for another app)
  if (String(claims.aud) !== String(clientId)) return null;
  // expiry (tokeninfo reports `exp` as unix seconds) must be in the future
  const expSec = Number(claims.exp);
  if (!Number.isFinite(expSec) || expSec * 1000 <= Date.now()) return null;
  // email must be present and verified (tokeninfo returns string "true"/"false" or boolean)
  const email = String(claims.email || '').trim().toLowerCase();
  if (!email) return null;
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!verified) return null;
  return { email, email_verified: true };
}

// ── OAuth token exchange (real provider code→token POST, via the injectable fetch) ───────────────
// Build the `exchange` fn handleCallback() calls. It POSTs the authorization code to the provider's
// token endpoint with the standard OAuth2 grant params, reading the client secret by ENV NAME only
// (never a literal, never returned, never logged). Returns the provider's token response object so
// handleCallback can store it as a grant. Soft-fail: a non-OK response throws (handleCallback's
// caller catches and redirects to ?error=), so a failed exchange never half-stores a grant.
function makeExchange({ clientId, clientSecretEnv, redirectUri, tokenUrl }) {
  return async ({ code, codeVerifier, tokenUrl: svcTokenUrl }) => {
    const endpoint = svcTokenUrl || tokenUrl;
    const clientSecret = clientSecretEnv ? process.env[clientSecretEnv] : '';
    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('redirect_uri', redirectUri || '');
    if (clientId) form.set('client_id', clientId);
    if (clientSecret) form.set('client_secret', clientSecret);
    if (codeVerifier) form.set('code_verifier', codeVerifier); // PKCE
    const r = await theFetch()(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    });
    if (!r || !r.ok) throw new Error(`token endpoint returned ${r ? r.status : 'no-response'}`);
    return r.json();
  };
}

async function resolveGoogleClaims(req, url) {
  if (_googleVerifier) return _googleVerifier(req, url);
  // Real path: the id-token arrives as ?credential= or ?id_token= on the callback (Google Identity
  // Services posts/redirects a `credential`; classic code flow may carry `id_token`).
  const idToken = url.searchParams.get('credential') || url.searchParams.get('id_token') || '';
  return verifyGoogleIdToken(idToken);
}

// ── the route handler (exported so tests drive it offline) ──────────────────────────────────────
export async function handle(req, res) {
  const url = new URL(req.url, BASE_URL);
  const p = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  try {
    // ---- CSRF: reject cross-site state-changing requests before any handler runs ----
    // Every POST is a state-changing route; a browser-driven cross-site post (Origin != our origin)
    // is refused with 403. Same-origin posts and non-browser clients (no Origin/Referer) pass.
    if (method === 'POST' && !sameOriginOK(req)) {
      res.writeHead(403, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return res.end('403 forbidden (cross-origin)');
    }

    // ---- always-open routes ----
    if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

    if (p === '/login' && method === 'GET') {
      return html(res, loginPage({ notice: url.searchParams.get('e') ? 'Sign-in required or link invalid.' : '' }));
    }

    if (p === '/login/email' && method === 'POST') {
      const params = formParams(await readBody(req));
      const r = await startEmailLogin(params.get('email') || '');
      // Non-enumerating in production: same answer whether or not the address is allowed.
      const sentNotice = 'If that address can sign in, a sign-in link has been sent to the operator.';
      if (!r.ok) return html(res, loginPage({ notice: IS_LOCAL ? 'That address cannot sign in.' : sentNotice }));
      const link = `${BASE_URL}/auth/magic?token=${encodeURIComponent(r.token)}`;
      if (IS_LOCAL) return html(res, loginPage({ magicLink: link, notice: 'Magic link generated (dev).' }));
      const d = await deliverMagicLink(link);
      // Log delivery outcome (status only — never the link/token) so silent failures are debuggable.
      console.log(`[admin-auth] magic-link delivery: sent=${d.sent}${d.reason ? ` reason=${d.reason}` : ''}`);
      // ADMIN_BOOTSTRAP=1 — one-time first-login escape hatch when no out-of-band delivery is wired
      // yet. Only ever reachable for the single allowed admin email (startEmailLogin already gated).
      // Operator turns it off after first sign-in.
      if (!d.sent && process.env.ADMIN_BOOTSTRAP === '1') {
        return html(res, loginPage({ magicLink: link, notice: 'Bootstrap link — set ADMIN_BOOTSTRAP=0 after you sign in.' }));
      }
      return html(res, loginPage({ notice: sentNotice }));
    }

    if (p === '/auth/magic' && method === 'GET') {
      // PEEK only — never consume on GET. Messenger link-preview bots (Telegram,
      // Slack, iMessage) GET every URL they see; consuming here burned the
      // operator's link before he could tap it ("already-used"). The human
      // confirms with the POST below, which is when the token is spent.
      const tok = url.searchParams.get('token') || '';
      const r = verifyMagicLink(tok, { consume: false });
      if (!r.ok) return html(res, loginPage({ notice: `Link invalid (${r.reason}).` }), 400);
      const body = `<h1>Complete sign-in</h1>
        <div class=card><p class=muted>Press the button to finish signing in as <code>${esc(r.email)}</code>.</p>
        <form method=POST action="/auth/magic"><input type=hidden name=token value="${esc(tok)}">
        <p><button type=submit>Sign in</button></p></form></div>`;
      return html(res, layout({ title: 'Complete sign-in', body }));
    }

    if (p === '/auth/magic' && method === 'POST') {
      const params = formParams(await readBody(req));
      const r = verifyMagicLink(params.get('token') || ''); // consumes — single use
      if (!r.ok) return html(res, loginPage({ notice: `Link invalid (${r.reason}).` }), 400);
      const s = createSession(r.email);
      if (!s.ok) return html(res, loginPage({ notice: 'Could not create session.' }), 400);
      res.writeHead(302, { location: '/', 'set-cookie': sessionCookie(s.token), 'cache-control': 'no-store' });
      return res.end();
    }

    if (p === '/auth/google/callback' && method === 'GET') {
      const claims = await resolveGoogleClaims(req, url);
      const r = verifyGoogleLogin(claims);
      if (!r.ok) return html(res, loginPage({ notice: `Google sign-in failed (${r.reason}).` }), 400);
      const s = createSession(r.email);
      if (!s.ok) return html(res, loginPage({ notice: 'Could not create session.' }), 400);
      res.writeHead(302, { location: '/', 'set-cookie': sessionCookie(s.token), 'cache-control': 'no-store' });
      return res.end();
    }

    // ---- passkey LOGIN (always-open: a passkey IS the credential; allowlist enforced on verify) ----
    // Options: anonymous (we don't know who's logging in yet). We mint a challenge, stash it under an
    // opaque handle echoed back by the client, and offer the credentials registered for any admin so a
    // platform authenticator can pick one. NOT enumerable beyond "an admin has passkeys".
    if (p === '/auth/passkey/login/options' && method === 'POST') {
      const handle = crypto.randomBytes(16).toString('hex');
      const allowIds = [];
      for (const e of [adminEmail(), backupEmailSafe()].filter(Boolean)) {
        for (const c of (listCredentials(e) || [])) allowIds.push(c.credentialId);
      }
      const opts = generateAuthenticationOptions({ rpId: RP_ID, allowCredentialIds: allowIds });
      putChallenge(`login:${handle}`, opts.challenge);
      return json(res, { ...opts, handle });
    }

    // Verify: look the credential up by id → its owner email; the email MUST be on the allowlist;
    // verify the assertion against the stored public key + challenge + origin + rpId; bump signCount;
    // mint the SAME session cookie magic-link issues. Fails closed on every mismatch.
    if (p === '/auth/passkey/login/verify' && method === 'POST') {
      const data = await readJson(req);
      const ch = takeChallenge(`login:${data?.handle || ''}`);
      if (!ch) return json(res, { ok: false, reason: 'no-challenge' }, 400);
      const hit = getByCredentialId(data?.id);
      if (!hit) return json(res, { ok: false, reason: 'unknown-credential' }, 400);
      if (!roleFor(hit.email)) return json(res, { ok: false, reason: 'not-admin' }, 403);
      const v = verifyAuthentication(data, hit.credential, {
        expectedChallenge: ch.challenge, expectedOrigin: BASE_ORIGIN, expectedRpId: RP_ID,
      });
      if (!v.ok) return json(res, { ok: false, reason: v.reason }, 400);
      updateSignCount(hit.credential.credentialId, v.newSignCount);
      const s = createSession(hit.email);
      if (!s.ok) return json(res, { ok: false, reason: 'session' }, 400);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': sessionCookie(s.token), 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true }));
    }

    // ---- recovery (backup email regains primary access; self-gated with allowBackup) ----
    if (p === '/recovery' && method === 'GET') {
      const g = requireAdmin(req, { allowBackup: true });
      if (!g.ok) return redirect(res, '/login?e=1');
      const r = await startRecovery(req).catch(() => ({ ok: false }));
      const body = r.ok
        ? `<h1>Recovery</h1><p class=ok>A fresh sign-in link for the primary account was issued.</p>${r.link ? `<p class=muted>Dev (no mailer): <a href="${esc(r.link)}">${esc(r.link)}</a></p>` : ''}`
        : `<h1>Recovery</h1><p class=warn>Recovery is only available from the backup account's session.</p>`;
      return html(res, layout({ title: 'Recovery', body, nav: false }));
    }

    // ---- gate everything else ----
    const gate = requireAdmin(req);
    if (!gate.ok) {
      // browsers get a redirect to the login page; API/no-html clients get a 401.
      const wantsHtml = (req.headers?.accept || '').includes('text/html');
      if (wantsHtml) return redirect(res, '/login?e=1');
      res.writeHead(401, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return res.end('401 unauthorized');
    }
    const email = gate.email;

    if (p === '/logout' && method === 'GET') {
      const clear = IS_HTTPS
        ? `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`
        : 'admin_session=; Path=/; HttpOnly; Max-Age=0';
      res.writeHead(302, { location: '/login', 'set-cookie': clear, 'cache-control': 'no-store' });
      return res.end();
    }

    // ---- passkey ENROLMENT (admin-gated: only a signed-in admin can register a passkey) ----
    if (p === '/auth/passkey/register/options' && method === 'POST') {
      const existing = (listCredentials(email) || []).map((c) => c.credentialId);
      const opts = generateRegistrationOptions({
        rpId: RP_ID, rpName: RP_NAME,
        userId: email, userName: email, userDisplayName: email,
        excludeCredentialIds: existing,
      });
      putChallenge(`reg:${email}`, opts.challenge, { email });
      return json(res, opts);
    }

    if (p === '/auth/passkey/register/verify' && method === 'POST') {
      const data = await readJson(req);
      const ch = takeChallenge(`reg:${email}`);
      if (!ch) return json(res, { ok: false, reason: 'no-challenge' }, 400);
      const v = verifyRegistration(data, {
        expectedChallenge: ch.challenge, expectedOrigin: BASE_ORIGIN, expectedRpId: RP_ID,
      });
      if (!v.ok) return json(res, { ok: false, reason: v.reason }, 400);
      const stored = addCredential(email, v, { label: 'passkey' });
      if (!stored.ok) return json(res, { ok: false, reason: stored.reason }, 400);
      return json(res, { ok: true });
    }

    if (p === '/' && method === 'GET') return html(res, dashboardPage(email));

    if (p === '/connect' && method === 'GET') {
      const conns = await listConnections().catch(() => []);
      const connectedSvc = url.searchParams.get('connected');
      const errSvc = url.searchParams.get('error');
      const notice = connectedSvc
        ? `Connected ${connectedSvc} — its token is held as a capability grant in the vault.`
        : errSvc ? `Could not connect: ${errSvc}.` : '';
      return html(res, connectPage(conns, { notice }));
    }

    // ---- OAuth connect round-trip: the provider redirects here with ?code=&state= ----
    // Validate the state against one WE issued (CSRF), recover the PKCE verifier for that flow,
    // then exchange the code for a token via a REAL exchange fn (provider POST through the
    // injectable fetch; the client secret is read by env NAME only and never returned/logged).
    // handleCallback stores the token as a vault grant and returns only a public descriptor.
    if (p === '/connect/callback' && method === 'GET') {
      const state = url.searchParams.get('state') || '';
      const code = url.searchParams.get('code') || '';
      const providerErr = url.searchParams.get('error') || '';
      if (providerErr) return redirect(res, `/connect?error=${encodeURIComponent(providerErr)}`);
      const flow = takeConnectState(state);
      if (!flow || !code) return redirect(res, '/connect?error=invalid_state');
      const service = flow.service;
      const svc = SERVICES[service];
      if (!svc) return redirect(res, '/connect?error=unknown_service');
      const clientId = process.env[`${service.toUpperCase()}_CLIENT_ID`] || (service === 'google' ? googleClientId() : '');
      const clientSecretEnv = `${service.toUpperCase()}_CLIENT_SECRET`; // env NAME only — never the value here
      const redirectUri = `${BASE_URL}/connect/callback`;
      try {
        await handleCallback(service, {
          code,
          codeVerifier: flow.codeVerifier,
          clientId,
          clientSecretEnv,
          redirectUri,
          exchange: makeExchange({ clientId, clientSecretEnv, redirectUri, tokenUrl: svc.tokenUrl }),
        });
        return redirect(res, `/connect?connected=${encodeURIComponent(service)}`);
      } catch (e) {
        console.log(`[connect] exchange failed for ${service}: ${e?.message || 'error'}`);
        return redirect(res, `/connect?error=${encodeURIComponent(service)}`);
      }
    }

    if (p === '/hud' && method === 'GET') return html(res, await hudPage());
    if (p === '/trade' && method === 'GET') return html(res, await tradePage());
    if (p === '/chains' && method === 'GET') return html(res, await chainsPage());
    if (p === '/claude' && method === 'GET') return html(res, await claudePage());

    // JSON transcript for the messenger panel's ~5s poll. Admin-gated (we are past requireAdmin
    // here). Returns only display-safe fields — timestamp, from, text — never internal turn shape.
    if (p === '/claude/history' && method === 'GET') {
      const sessionId = (url.searchParams.get('sessionId') || 'admin').trim();
      const turns = (claudeHistory(sessionId) || []).map((t) => ({
        ts: t.ts,
        from: t.role === 'user' ? (t.from || 'ryan') : 'claude',
        text: t.text || '',
      }));
      return json(res, { sessionId, history: turns });
    }

    if (p === '/claude/send' && method === 'POST') {
      const params = formParams(await readBody(req));
      const message = (params.get('message') || '').trim();
      const sessionId = (params.get('sessionId') || 'admin').trim();
      if (message) await sendToClaude({ message, sessionId, from: email }).catch(() => {});
      return redirect(res, '/claude');
    }

    if (p === '/captcha' && method === 'GET') return html(res, captchaPage());

    if (p === '/captcha/test' && method === 'POST') {
      await captcha.requestHandoff({
        kind: 'captcha',
        context: 'twitter signup (test)',
        promptText: 'TEST: a Twitter/X signup hit a CAPTCHA. Type any text here to confirm the solve flow works.',
        screenshotRef: null,
      }).catch(() => {});
      return redirect(res, '/captcha');
    }

    if (p === '/captcha/resolve' && method === 'POST') {
      const params = formParams(await readBody(req));
      const id = (params.get('id') || '').trim();
      const answer = (params.get('answer') || '').trim();
      let notice = 'Could not resolve that handoff (expired or unknown).';
      if (id && answer) {
        const r = captcha.resolveHandoff(id, { answer, by: email });
        if (r && r.ok !== false) notice = 'Solved — the signup flow can now resume on your answer.';
      }
      return html(res, captchaPage({ notice }));
    }

    if (p === '/features' && method === 'GET') return html(res, await featuresPage());

    if (p === '/features/flag' && method === 'POST') {
      const params = formParams(await readBody(req));
      const fid = (params.get('id') || '').trim();
      // new decision states (queue | later | never | clear); legacy on=1/0 still accepted
      let state = (params.get('state') || '').trim();
      if (!state) state = (params.get('on') === '1' || /^(true|on|yes)$/i.test(params.get('on') || '')) ? 'queue' : 'clear';
      const note = (params.get('note') || '').trim();
      if (fid) await setFlag(fid, state, note).catch(() => {});
      return redirect(res, '/features');
    }

    if (p === '/analytics' && method === 'GET') return html(res, analyticsPage());

    if (p === '/diagnostics' && method === 'GET') return html(res, await diagnosticsPage());

    if (p === '/security' && method === 'GET') return html(res, securityPage());

    if (p === '/security/scan' && method === 'POST') {
      const params = formParams(await readBody(req));
      const arg = {};
      const u = (params.get('url') || '').trim();
      const h = params.get('html') || '';
      if (u) arg.url = u;
      if (h) arg.html = h;
      const result = await scan(arg).catch((e) => ({ verdict: 'clean', malicious: false, content: { threats: [], score: 0, clean: true }, error: e?.message }));
      return html(res, securityPage(result));
    }

    // gated 404
    return html(res, layout({ title: 'Not found', body: '<h1>404</h1><p class=muted><a href="/">← dashboard</a></p>' }), 404);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e?.message || String(e)));
  }
}

// ── boot (only when run directly) ────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('site/admin/server.mjs')) {
  if (!adminEmail()) console.warn('[admin] ADMIN_EMAIL not set — no one can sign in until it is.');
  createServer(handle).listen(PORT, HOST, () => {
    console.log(`Soapy.blog admin portal on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
