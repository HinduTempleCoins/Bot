// melek-login-embed.mjs — "Login with MELEK" for ANY website. The embeddable, third-party button SDK.
//
// This is the piece that makes MELEK a login option OTHER PLACES — the same way a site drops in
// "Log in with Google/Facebook." A site owner adds ONE tag:
//
//   <script src="https://soapy.blog/widgets/melek-login-embed.js"
//           data-melek-login data-client-id="their-app" data-target="#melek-login"></script>
//
// …and gets a real "Log in with MELEK" button. On click it opens the MELEK-Signer consent screen in a
// popup; the signer's hosted postback (`/oauth2/postback`, backed server-side by melek-login.completeLogin)
// exchanges the code and postMessages the verified identity back to the opener. The SDK then fires a
// `melek:login` CustomEvent and calls window.MelekLogin.onLogin({account,onchain}) — the host page decides
// what to do with the identity. No password, no key, and no token ever touches the third-party page.
//
// Testable like widget-suite.loaderScript: embedScript(opts) returns the browser JS as a string (pure,
// esc'd config, no eval), and handler() serves it. Offline-tested. Never throws.
//
//   import { embedScript, handler, POSTBACK_PATH } from './melek-login-embed.mjs'

import http from 'node:http';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8152);
const HOST = process.env.HOST || '127.0.0.1';

// Where the button assets + the OAuth consent/postback live. On go-live this is the public signer origin.
export const DEFAULT_SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
// The hosted bridge page that finishes the code exchange and postMessages the identity to the opener.
export const POSTBACK_PATH = '/oauth2/postback';

const jsStr = (s) => JSON.stringify(String(s == null ? '' : s)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

/**
 * The self-contained browser SDK. A site includes it once; it auto-mounts a "Log in with MELEK" button
 * for every `<script data-melek-login>` tag (and honours window.MelekLogin = {clientId,target,onLogin}).
 *
 * @param {object} [opts]
 * @param {string} [opts.signer]  the signer origin (default DEFAULT_SIGNER)
 * @param {string} [opts.label]   button label
 * @returns {string} browser JavaScript (serve with a JS content-type)
 */
export function embedScript({ signer, label = 'Log in with MELEK' } = {}) {
  const origin = String(signer || DEFAULT_SIGNER).trim().replace(/\/+$/, '') || DEFAULT_SIGNER;
  return `/* Login with MELEK — embeddable button SDK (Alpha). One tag, any site. */
(function(){
  if (window.__melekLoginEmbed) return; window.__melekLoginEmbed = true;
  var SIGNER = ${jsStr(origin)};
  var POSTBACK = SIGNER + ${jsStr(POSTBACK_PATH)};
  var DEFAULT_LABEL = ${jsStr(label)};

  function cfgFromScript(s){
    var g = window.MelekLogin || {};
    return {
      clientId: (s && s.getAttribute('data-client-id')) || g.clientId || 'external',
      scope:    (s && s.getAttribute('data-scope')) || g.scope || 'identity',
      target:   (s && s.getAttribute('data-target')) || g.target || null,
      label:    (s && s.getAttribute('data-label')) || g.label || DEFAULT_LABEL,
      onLogin:  g.onLogin || null
    };
  }

  // Open the consent popup and resolve with the verified identity the postback posts back.
  function login(cfg){
    return new Promise(function(resolve, reject){
      var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      var redirect = encodeURIComponent(POSTBACK);
      var url = SIGNER + '/oauth2/authorize?response_type=code&client_id='
        + encodeURIComponent(cfg.clientId) + '&scope=' + encodeURIComponent(cfg.scope)
        + '&redirect_uri=' + redirect + '&state=' + encodeURIComponent(state) + '&display=popup';
      var w = 460, h = 640;
      var x = (window.screen.width - w) / 2, y = (window.screen.height - h) / 2;
      var pop = window.open(url, 'melek_login', 'width='+w+',height='+h+',left='+x+',top='+y);
      function onMsg(ev){
        // ONLY trust messages from the signer origin — never accept an identity from any other window.
        if (ev.origin !== SIGNER) return;
        var d = ev.data || {};
        if (!d || d.type !== 'melek:login' || d.state !== state) return;
        window.removeEventListener('message', onMsg);
        try { pop && pop.close(); } catch(e){}
        if (d.error || !d.account) { reject(new Error(d.error || 'login failed')); return; }
        var id = { account: d.account, onchain: d.onchain !== false, provider: d.provider || 'melek' };
        try { window.dispatchEvent(new CustomEvent('melek:login', { detail: id })); } catch(e){}
        if (typeof cfg.onLogin === 'function') { try { cfg.onLogin(id); } catch(e){} }
        resolve(id);
      }
      window.addEventListener('message', onMsg);
      if (!pop) { window.removeEventListener('message', onMsg); reject(new Error('popup blocked')); }
    });
  }

  function button(cfg){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'melek-login-btn';
    b.textContent = cfg.label;
    b.style.cssText = 'display:inline-flex;align-items:center;gap:.5em;padding:.55em 1em;border:0;'
      + 'border-radius:8px;background:#1a1440;color:#f4e9c1;font:600 14px system-ui,sans-serif;'
      + 'cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.25)';
    b.addEventListener('click', function(){ login(cfg).catch(function(e){
      try { window.dispatchEvent(new CustomEvent('melek:login-error', { detail: { message: String(e && e.message || e) } })); } catch(_){}
    }); });
    return b;
  }

  function mount(s){
    var cfg = cfgFromScript(s);
    var host = cfg.target ? document.querySelector(cfg.target) : null;
    var el = button(cfg);
    if (host) host.appendChild(el);
    else if (s && s.parentNode) s.parentNode.insertBefore(el, s.nextSibling);
    else document.body.appendChild(el);
  }

  // Expose a programmatic API too: MelekLogin.open() logs in without a rendered button.
  window.MelekLogin = window.MelekLogin || {};
  window.MelekLogin.open = function(o){ return login(cfgFromScript(null)); };

  function init(){
    var tags = document.querySelectorAll('script[data-melek-login]');
    if (tags.length) { for (var i=0;i<tags.length;i++) mount(tags[i]); }
    else if (window.MelekLogin && window.MelekLogin.target) mount(null);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();`;
}

/**
 * The HTML the signer serves at POSTBACK_PATH after a successful code exchange: it postMessages the
 * verified identity to window.opener (scoped to targetOrigin) and closes. Server passes the already-
 * verified {account, onchain, provider, state}. Values are JSON-encoded + </script>-defanged.
 */
export function postbackHtml({ account, onchain = true, provider = 'melek', state = '', error = '', targetOrigin } = {}) {
  // Never postMessage the identity to '*': the server MUST pass the opener origin it derived from the
  // OAuth client's registered redirect_uri, so the payload can only reach the site that started the login.
  const origin = String(targetOrigin || '').trim();
  if (!origin || origin === '*') throw new Error('postbackHtml: explicit targetOrigin (registered opener origin) required');
  const payload = jsStr(JSON.stringify({ type: 'melek:login', account: account || '', onchain: !!onchain, provider, state, error }));
  const to = jsStr(origin);
  return `<!doctype html><meta charset=utf-8><title>MELEK login</title>`
    + `<body style="font:14px system-ui;background:#1a1440;color:#f4e9c1;text-align:center;padding:3em">`
    + `<p>Signing you in with MELEK\u2026 you can close this window.</p>`
    + `<script>(function(){try{var d=JSON.parse(${payload});`
    + `if(window.opener)window.opener.postMessage(d,${to});}catch(e){}`
    + `setTimeout(function(){try{window.close();}catch(e){}},300);})();</script>`;
}

/** GET /melek-login.js (the SDK) and /melek-login.css noop. Serves the embeddable script. Never throws. */
export async function handler(req, res, opts = {}) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/melek-login.js' || url.pathname === '/widgets/melek-login-embed.js') {
      const body = embedScript({ signer: opts.signer || url.searchParams.get('signer') || undefined });
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch {
    try { res.writeHead(500); res.end('error'); } catch { /* headers sent */ }
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  http.createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    console.log(`melek-login-embed on http://${HOST}:${PORT}/melek-login.js (signer ${DEFAULT_SIGNER})`);
  });
}
