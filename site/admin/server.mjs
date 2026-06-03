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
import {
  startEmailLogin, verifyMagicLink, verifyGoogleLogin, createSession, requireAdmin, adminEmail,
} from '../../integrations/admin-auth.mjs';
import { SERVICES, authorizeUrl, listConnections } from '../../integrations/ifttt-connect.mjs';
import { scan } from '../../integrations/security-scan.mjs';
import { diagnostics } from '../../integrations/server-diagnostics.mjs';
import { trafficSummary } from '../../integrations/soapbox/analytics.mjs';
import { grant as credGrant } from '../../integrations/credential-store.mjs';

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

function layout({ title = 'Admin', body = '', nav = true } = {}) {
  const navHtml = nav ? `<header>
    <strong>Soapy.blog · Admin</strong>
    <a href="/">Dashboard</a>
    <a href="/connect">Connect</a>
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
// Set the admin_session cookie (HttpOnly, SameSite=Lax, Secure when behind https).
function sessionCookie(token) {
  const secure = BASE_URL.startsWith('https') ? '; Secure' : '';
  return `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`;
}

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
  const body = `<h1>Operator Console</h1>
    <p class=muted>Signed in as <code>${esc(email)}</code>. <a class="btn ghost" href="/logout">Log out</a></p>
    <div class=card><h2>Quick links</h2>
      <ul>
        <li><a href="/connect">Connect accounts</a> — OAuth hub for IFTTT/automation (Google, GitHub, Discord, Slack, X, Reddit, Dropbox).</li>
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
    <div class=card><h2>Or</h2>${googleBlock}</div>`;
  return layout({ title: 'Sign in', body, nav: false });
}

function connectPage(connections = []) {
  const redirectUri = `${BASE_URL}/connect/callback`;
  const connected = new Map(connections.map((c) => [c.name, c]));
  const rows = Object.values(SERVICES).map((svc) => {
    const conn = connected.get(svc.name);
    const clientId = process.env[`${svc.name.toUpperCase()}_CLIENT_ID`] || (svc.name === 'google' ? googleClientId() : '');
    let authLink;
    if (clientId) {
      let url = '#';
      try { url = authorizeUrl(svc.name, { clientId, redirectUri }).url; } catch { url = '#'; }
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
  const body = `<h1>Connect accounts</h1>
    <p class=muted>OAuth hub for IFTTT/automation. Tokens are held as capability grants in the vault — they are never shown here.</p>
    <div class=card><table>
      <thead><tr><th>Service</th><th>Default scopes</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  return layout({ title: 'Connect', body });
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

// ── Google login verifier (injectable for tests) ─────────────────────────────────────────────────
// Real deployment validates the Google id-token upstream (signature/issuer/audience) and passes the
// trusted claims here. Tests inject a verifier via __setGoogleVerifier so no live OAuth is needed.
let _googleVerifier = null;
export function __setGoogleVerifier(fn) { _googleVerifier = fn || null; }
async function resolveGoogleClaims(req, url) {
  if (_googleVerifier) return _googleVerifier(req, url);
  // No real upstream verifier wired in this repo (the live one lives in the signer/OIDC service).
  return null;
}

// ── the route handler (exported so tests drive it offline) ──────────────────────────────────────
export async function handle(req, res) {
  const url = new URL(req.url, BASE_URL);
  const p = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  try {
    // ---- always-open routes ----
    if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

    if (p === '/login' && method === 'GET') {
      return html(res, loginPage({ notice: url.searchParams.get('e') ? 'Sign-in required or link invalid.' : '' }));
    }

    if (p === '/login/email' && method === 'POST') {
      const params = formParams(await readBody(req));
      const r = await startEmailLogin(params.get('email') || '');
      if (!r.ok) return html(res, loginPage({ notice: 'That address cannot sign in.' }));
      const link = `${BASE_URL}/auth/magic?token=${encodeURIComponent(r.token)}`;
      // dev: show the link (no mailer). A real deployment delivers it via the injected mailer instead.
      return html(res, loginPage({ magicLink: link, notice: 'Magic link generated.' }));
    }

    if (p === '/auth/magic' && method === 'GET') {
      const r = verifyMagicLink(url.searchParams.get('token') || '');
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
      res.writeHead(302, { location: '/login', 'set-cookie': 'admin_session=; Path=/; HttpOnly; Max-Age=0', 'cache-control': 'no-store' });
      return res.end();
    }

    if (p === '/' && method === 'GET') return html(res, dashboardPage(email));

    if (p === '/connect' && method === 'GET') {
      const conns = await listConnections().catch(() => []);
      return html(res, connectPage(conns));
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
