// site/connect/server.mjs — "Connect your own API keys" (connect.pentecaust.com).
//
// A MELEK-Signer-gated surface where a signed-in tenant adds their OWN third-party API keys (AI
// providers, CourtListener, exchanges, …). The keys are stored ENCRYPTED AT REST and used as
// CAPABILITIES — a connected key is never handed back to any caller or page as plaintext, never
// logged, never written to the repo. This is the operator's "connect your own keys via MELEK-Signer"
// ask, built on the existing capability vault (see connections.mjs for the wiring + invariants).
//
// AUTH. Identity is a MELEK-Signer session, verified exactly the way the other family surfaces do it
// (pentecaust/sso.mjs → sessionFromCookie → the signed-in MELEK account). The tenant IS that account.
// Every mutating/reading route FAILS CLOSED when there is no session (401). /auth/* is delegated to
// the shared SSO handler so "Sign in with MELEK" works end to end.
//
// House style: ESM .mjs, esc() on all interpolation, handler(req,res) exported for tests, CLI guarded
// by the argv check, PORT/BASE_URL env, injectable auth seam (__setWhoami), soft-fail-never-throw,
// offline `node --test` (no network — the capability-USE examples take an injected executor).
//
//   PORT=8188 node site/connect/server.mjs
//   node site/connect/server.mjs --demo        # offline capability-use demo (no network, no real key)

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { handler as ssoHandler, sessionFromCookie, selfOriginFor } from '../../pentecaust/sso.mjs';
import {
  connectProvider, listConnections, revokeConnection, useConnection,
} from './connections.mjs';
import {
  GENAI_PROVIDERS, mintLinkToken, verifyLinkToken, linkPageHtml, normImageJob, RUNNERS, isAllowedOrigin, bearer,
} from './genai.mjs';

const PORT = +(process.env.PORT || 8188);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── auth seam ─────────────────────────────────────────────────────────────────────────────────────
// Default: the MELEK-Signer session cookie → the signed-in account (or null). Tests inject a stand-in
// via __setWhoami so identity can be set without cookie plumbing; production always uses the real SSO
// verify. Either way, no route trusts an account named in the request body/query (the IDOR guard).
let _whoami = (req) => {
  const s = sessionFromCookie((req && req.headers && req.headers.cookie) || '');
  return s && s.account ? s.account : null;
};
export function __setWhoami(fn) { _whoami = typeof fn === 'function' ? fn : ((req) => {
  const s = sessionFromCookie((req && req.headers && req.headers.cookie) || '');
  return s && s.account ? s.account : null;
}); }

// ── page ────────────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--flame:#ff8c2b;--ember:#e0453a;--ok:#36c08a}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px}
 .wrap{max-width:760px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
 .brand{font-size:22px;font-weight:800}.brand b{color:var(--flame)}
 .authbar{margin-left:auto;display:inline-flex;gap:8px;align-items:center;font-size:13px}
 .btn{padding:8px 12px;border-radius:9px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);font:inherit;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap}
 .btn.primary{background:var(--flame);color:#1a1006;border-color:var(--flame)}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:14px;padding:14px;margin-bottom:12px}
 .lead{color:var(--mut);max-width:64ch}
 label{display:block;font-size:12px;color:var(--mut);margin:8px 0 3px}
 input,select{width:100%;padding:9px 11px;border:1px solid var(--bd);border-radius:9px;background:#0e131b;color:var(--fg);font:inherit}
 .row{display:flex;gap:10px;flex-wrap:wrap}.row>div{flex:1;min-width:160px}
 .item{display:flex;gap:10px;align-items:center;border:1px solid var(--bd);border-radius:11px;padding:10px 12px;margin-top:8px}
 .chip{font-size:11px;border:1px solid var(--bd);border-radius:999px;padding:2px 8px;color:var(--mut)}
 .chip.ok{color:var(--ok);border-color:var(--ok)}.chip.rev{color:var(--ember);border-color:var(--ember)}
 .mut{color:var(--mut)}.note{font-size:12px;color:var(--mut);margin-top:8px}
 footer{color:var(--mut);font-size:12px;margin-top:22px}a{color:var(--gold)}
</style>`;

function signedOutPage() {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Connect your API keys — MELEK</title>
<meta name=description content="Connect your own third-party API keys to MELEK. Stored encrypted, used as capabilities — never handed back as plaintext.">
<meta name=robots content="noindex">${STYLE}</head><body><div class=wrap>
<header><span class=brand>🔑 <b>Connect</b> your keys</span>
 <span class=authbar><a class="btn primary" href="/auth/login">Sign in with MELEK</a></span></header>
<div class=card>
 <p class=lead>Bring your own API keys — AI providers, CourtListener, and more. They are stored
  <b>encrypted at rest</b> and used only as <b>capabilities</b>: MELEK runs a request with your key
  and returns the result. Your key is never shown back to you, never logged, never leaves the vault.</p>
 <p class=note>Sign in with MELEK-Signer to connect a key.</p>
</div>
<footer>Connect · part of <a href="https://pentecaust.com">Pentecaust</a> · keys are a capability, never plaintext</footer>
</div></body></html>`;
}

function signedInPage(who) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Connect your API keys — MELEK</title>
<meta name=description content="Connect your own third-party API keys to MELEK. Stored encrypted, used as capabilities — never handed back as plaintext.">
<meta name=robots content="noindex">${STYLE}</head><body><div class=wrap>
<header><span class=brand>🔑 <b>Connect</b> your keys</span>
 <span class=authbar>@${esc(who)} <a class=btn href="/auth/logout">Log out</a></span></header>
<div class=card>
 <p class=lead>Add a third-party API key. It is encrypted at rest the instant you submit it and used
  only as a capability — MELEK never shows it back to you or logs it.</p>
 <div class=row>
  <div><label for=provider>Provider</label>
   <input id=provider list=provs placeholder="e.g. fal, gemini, worker, openai" autocapitalize=off autocomplete=off>
   <datalist id=provs>${GENAI_PROVIDERS.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('')}<option value=openai><option value=courtlistener></datalist></div>
  <div><label for=scope>Scope</label>
   <input id=scope placeholder="e.g. llm:complete (optional)" autocapitalize=off autocomplete=off></div>
 </div>
 <div class=row>
  <div id=wurl-box style="display:none"><label for=wurl>Worker URL (https)</label>
   <input id=wurl placeholder="https://you--hathor-studio-worker-serve.modal.run" autocapitalize=off autocomplete=off></div>
  <div><label for=key id=keylabel>API key</label>
   <input id=key type=password placeholder="paste your key — stored encrypted, never shown again" autocomplete=off></div>
  <div><label for=cap>Call cap</label>
   <input id=cap type=number min=0 placeholder="max calls (optional)"></div>
 </div>
 <p class=note>For <b>Hathor Studio</b>: connect <b>fal</b>, <b>gemini</b>, or <b>worker</b> (your own copy of the Studio engine on a PC, Colab or Modal GPU), then press
  "Link Pentecaust" on the Studio's <a href="https://hathor.soapbox.community/engines">Your engines</a> page.</p>
 <p style="margin-top:12px"><button class="btn primary" id=connect>Connect key</button></p>
 <p class=note id=msg></p>
</div>
<div class=card>
 <h3 style="margin:0 0 6px">Your connected providers</h3>
 <p class=note>The key is never listed — only the provider, scope, cap and status.</p>
 <div id=list></div>
</div>
<footer>Connect · part of <a href="https://pentecaust.com">Pentecaust</a> · keys are a capability, never plaintext</footer>
</div>
<script>
const $=id=>document.getElementById(id);
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(p,o)=>{try{const r=await fetch(p,o);return await r.json();}catch(e){return{ok:false,reason:'network'};}};
async function load(){const j=await api('/connections');const cs=(j&&j.connections)||[];
 if(!cs.length){$('list').innerHTML='<p class=mut>No keys connected yet.</p>';return;}
 $('list').innerHTML=cs.map(c=>{
  const cap=c.cap&&c.cap.calls!=null?(' · cap '+E(c.cap.calls)+' calls'):'';
  const st=c.revoked?'<span class="chip rev">revoked</span>':'<span class="chip ok">active</span>';
  return '<div class=item><div style="flex:1"><b>'+E(c.provider)+'</b> <span class=chip>'+E(c.scope)+'</span>'+cap
   +' '+st+'</div>'+(c.revoked?'':'<button class=btn data-r="'+E(c.provider)+'">Revoke</button>')+'</div>';}).join('');
 for(const b of document.querySelectorAll('[data-r]'))b.onclick=async()=>{
  const r=await api('/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({provider:b.dataset.r})});
  if(r&&r.ok)load();else alert((r&&r.reason)||'could not revoke');};}
const isW=()=>$('provider').value.trim().toLowerCase()==='worker';
$('provider').oninput=()=>{$('wurl-box').style.display=isW()?'':'none';$('keylabel').textContent=isW()?'Worker password (CPU_SD_TOKEN)':'API key';};
$('connect').onclick=async()=>{
 const provider=$('provider').value.trim(),scope=$('scope').value.trim(),capN=$('cap').value.trim();
 let key=$('key').value;
 if(isW()){const u=$('wurl').value.trim();if(!/^https:\/\//.test(u)){$('msg').textContent='Worker URL must start with https://';return;}key=JSON.stringify({url:u,token:key});$('wurl').value='';}
 if(!provider||!key){$('msg').textContent='Provider and key are required.';return;}
 const body={provider,scope};if(key)body.key=key;if(capN!=='')body.cap={calls:Number(capN)};
 const r=await api('/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 $('key').value='';
 if(r&&r.ok){$('msg').textContent='Connected '+provider+' — encrypted at rest. Your key is not shown back.';$('provider').value='';$('scope').value='';$('cap').value='';load();}
 else $('msg').textContent=(r&&r.reason)||'could not connect';};
load();
</script></body></html>`;
}

// ── request helpers ────────────────────────────────────────────────────────────────────────────
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
// Small JSON body reader. Soft-fail to null on over-limit / parse error. Never logs the body (it may
// carry a raw key). Also accepts application/x-www-form-urlencoded for a plain HTML form POST.
function readBody(req, max = 16384) { // image requests pass a larger max
  return new Promise((resolve) => {
    let d = ''; let over = false;
    req.on('data', (c) => { d += c; if (d.length > max) { over = true; req.destroy(); } });
    req.on('end', () => {
      if (over) return resolve(null);
      const ct = String((req.headers && req.headers['content-type']) || '');
      if (ct.includes('application/x-www-form-urlencoded')) {
        try { const p = new URLSearchParams(d); resolve(Object.fromEntries(p.entries())); } catch { resolve(null); }
        return;
      }
      try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

// ── /v1/genai/* — the Studio's calls. CORS to the allowlisted Studio origin only; Bearer link token. ──
function cors(req) {
  const o = String((req.headers && req.headers.origin) || '');
  return isAllowedOrigin(o) ? { 'access-control-allow-origin': o, vary: 'origin',
    'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' } : {};
}
function sendJsonC(req, res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors(req) });
  res.end(JSON.stringify(obj));
}
async function genaiApi(req, res, path, method) {
  if (method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
  const link = verifyLinkToken(bearer(req));
  if (!link) return sendJsonC(req, res, 401, { ok: false, reason: 'link Pentecaust again' });
  const tenant = link.account;
  if (path === '/v1/genai/providers' && method === 'GET') {
    const providers = listConnections(tenant).filter((c) => !c.revoked && GENAI_PROVIDERS.some((g) => g.id === c.provider)).map((c) => c.provider);
    return sendJsonC(req, res, 200, { ok: true, account: tenant, providers });
  }
  if (path === '/v1/genai/image' && method === 'POST') {
    const b = await readBody(req, 12 * 1024 * 1024);
    if (b == null) return sendJsonC(req, res, 400, { ok: false, reason: 'bad body' });
    const n = normImageJob(b);
    if (!n.ok) return sendJsonC(req, res, 400, n);
    try {
      // The key is decrypted only inside this callback; what comes back is the image, never the key.
      const out = await useConnection(tenant, n.provider, (secret) => RUNNERS[n.provider](secret, n.job), 1);
      return sendJsonC(req, res, 200, { ok: true, src: out.src, note: out.note });
    } catch (e) {
      const msg = String((e && e.message) || e);
      // never echo anything that could contain the key; provider errors are already trimmed
      return sendJsonC(req, res, /no connection/.test(msg) ? 404 : 502, { ok: false, reason: msg.slice(0, 200) });
    }
  }
  return sendJsonC(req, res, 404, { ok: false, reason: 'not-found' });
}

// ── handler ──────────────────────────────────────────────────────────────────────────────────────
export async function handler(req, res) {
  try {
    const path = (String((req && req.url) || '/').split('?')[0] || '/').replace(/\/+$/, '') || '/';
    const method = (req && req.method ? req.method : 'GET').toUpperCase();

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

    // MELEK-Signer login / callback / me / logout — the identity for this whole surface.
    if (path === '/auth' || path.startsWith('/auth/')) {
      return ssoHandler(req, res, { selfOrigin: selfOriginFor(req, BASE_URL), idpOrigin: process.env.SSO_IDP_ORIGIN || 'https://pentecaust.com' });
    }

    // ── Hathor Studio: generate with keys held HERE (see genai.mjs). Token auth, no cookies. ──
    if (path.startsWith('/v1/genai/')) return genaiApi(req, res, path, method);

    const who = _whoami(req);

    if (path === '/studio-link') {
      const origin = new URL(String(req.url || '/'), 'http://x').searchParams.get('origin') || '';
      if (!isAllowedOrigin(origin)) return sendJson(res, 400, { ok: false, reason: 'origin not allowed' });
      if (!who) { // sign in first, then come straight back here (the IdP callback lands on '/')
        res.writeHead(302, { location: '/auth/login', 'set-cookie': `pcl_next=${encodeURIComponent(origin)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900` });
        return res.end('');
      }
      const providers = listConnections(who).filter((c) => !c.revoked && GENAI_PROVIDERS.some((g) => g.id === c.provider)).map((c) => c.provider);
      return sendHtml(res, linkPageHtml({ token: mintLinkToken(who, { origin }), account: who, origin, providers }));
    }

    if (path === '/') {
      const next = /(?:^|;\s*)pcl_next=([^;]+)/.exec(String((req.headers && req.headers.cookie) || ''));
      if (who && next && isAllowedOrigin(decodeURIComponent(next[1]))) {
        res.writeHead(302, { location: `/studio-link?origin=${encodeURIComponent(decodeURIComponent(next[1]))}`, 'set-cookie': 'pcl_next=; Path=/; Max-Age=0' });
        return res.end('');
      }
      return sendHtml(res, who ? signedInPage(who) : signedOutPage());
    }

    // Everything below REQUIRES a MELEK-Signer session. Fail closed.
    if (path === '/connections' && method === 'GET') {
      if (!who) return sendJson(res, 401, { ok: false, reason: 'sign in with MELEK first' });
      return sendJson(res, 200, { ok: true, connections: listConnections(who) });
    }

    if (path === '/connect' && method === 'POST') {
      if (!who) return sendJson(res, 401, { ok: false, reason: 'sign in with MELEK first' });
      const b = await readBody(req);
      if (b == null) return sendJson(res, 400, { ok: false, reason: 'bad body' });
      // The tenant is the SESSION account — never a field in the body (IDOR guard).
      const r = connectProvider(who, { provider: b.provider, scope: b.scope, key: b.key, cap: b.cap });
      // r never contains the key; connectProvider returns a redacted view or a reason.
      return sendJson(res, r.ok ? 200 : 400, r);
    }

    if (path === '/revoke' && method === 'POST') {
      if (!who) return sendJson(res, 401, { ok: false, reason: 'sign in with MELEK first' });
      const b = await readBody(req);
      if (b == null) return sendJson(res, 400, { ok: false, reason: 'bad body' });
      const ok = revokeConnection(who, b.provider);
      return sendJson(res, ok ? 200 : 404, ok ? { ok: true, provider: String(b.provider || '') } : { ok: false, reason: 'no such connection' });
    }

    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch {
    return sendJson(res, 500, { ok: false, reason: 'error' });
  }
}

// ── capability-use examples (the point of the whole thing) ──────────────────────────────────────
// These PROVE a connected key is usable without ever exposing it. Each takes an INJECTED executor so
// the path is exercised offline (no network, no real key) in tests. In production the executor is the
// real provider call — and the secret only ever exists inside the callback, never in the caller.

/**
 * A connected AI-provider key, used the way integrations/llm-router.mjs uses one: as a Bearer token
 * on an OpenAI-compatible call. The router itself reads keys from env; here we route the TENANT's
 * connected key through the same request shape without the key ever leaving the vault. `call` is the
 * injected transport: (secret, prompt) -> completion text.
 */
export async function exampleAiComplete(tenant, prompt, { call } = {}) {
  if (typeof call !== 'function') throw new Error('exampleAiComplete: an injected `call(secret, prompt)` is required');
  // The key is decrypted only inside this callback and dropped when it returns; we get back text.
  return useConnection(tenant, 'openai', (secret) => call(secret, prompt), 1);
}

/**
 * A connected CourtListener token, used to run a search. `search` is the injected transport:
 * (secret, query) -> results. The tenant never sees their token; they get search results.
 */
export async function exampleCourtListenerSearch(tenant, query, { search } = {}) {
  if (typeof search !== 'function') throw new Error('exampleCourtListenerSearch: an injected `search(secret, query)` is required');
  return useConnection(tenant, 'courtlistener', (secret) => search(secret, query), 1);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--demo') {
    // Offline proof that a connected key is a capability, never plaintext. No network, fake key.
    process.env.VAULT_MASTER_KEY = process.env.VAULT_MASTER_KEY || 'd'.repeat(64);
    const tenant = 'demo-user';
    const fake = 'cl-token-NOT-A-REAL-SECRET-0000';
    const conn = connectProvider(tenant, { provider: 'courtlistener', scope: 'search', key: fake, cap: { calls: 3 } });
    console.log('connect ->', conn);                       // redacted: no key
    console.log('list    ->', listConnections(tenant));    // no key
    // Inject a fake search transport; assert the token reaches it but never the caller.
    const injected = (secret, q) => ({ query: q, tokenLen: secret.length, tokenSeen: secret === fake });
    exampleCourtListenerSearch(tenant, 'first amendment', { search: injected }).then((r) => {
      console.log('use     ->', r);                        // result only — the key stayed in the vault
      console.log('revoke  ->', revokeConnection(tenant, 'courtlistener'));
      console.log('list    ->', listConnections(tenant));  // now revoked:true
    });
  } else {
    createServer(handler).listen(PORT, HOST, () => {
      console.log(`Connect (BYO API keys) on http://${HOST}:${PORT} (${BASE_URL})`);
    });
  }
}
