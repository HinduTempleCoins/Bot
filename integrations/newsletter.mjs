// newsletter.mjs — opt-in email list + contact form for the SoapBox/MELEK sites. ONE store, double opt-in.
//
// The flow the operator wants (2026-06-17): the Subscribe widget AND an imported COLD list both FEED INTO
// the same store — but nobody is mailable until they CONFIRM (click the link). So:
//   subscribe (widget) OR coldImport (a cold list)  →  status: 'pending' + a confirm token
//   user clicks the confirm link                     →  status: 'confirmed'  (the only list we ever mail)
// This keeps the list legal + clean (CAN-SPAM/GDPR): a bought/cold address can be invited once, but only
// becomes a real subscriber if the human opts in. Unconfirmed addresses are never bulk-mailed.
//
// Pure logic + injectable store/sender/clock/token → fully offline-testable. House style: ESM, esc(),
// soft-fail. The HTTP shell (handle) + the footer widget (subscribeWidget) live here too.

import { randomBytes } from 'node:crypto';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function validEmail(e) { return EMAIL_RE.test(String(e || '').trim()); }
const norm = (e) => String(e || '').trim().toLowerCase();

export function emptyStore() { return { subs: {}, contacts: [] }; }

// confirm tokens are a security primitive (a guessable token forges an opt-in) → CSPRNG, ≥128 bits.
let _rnd = () => randomBytes(32).toString('base64url');
export function __setTokenFn(fn) { _rnd = fn || (() => randomBytes(32).toString('base64url')); }

/**
 * addSubscriber(store, {email, source}, {now}) — add/refresh a PENDING subscriber with a confirm token.
 * `source` tags where it came from ('widget' | 'cold' | 'signup' | ...). Returns {status, email, token}.
 *   status: 'pending' (new/re-invite), 'already-confirmed' (no-op), 'invalid'.
 */
export function addSubscriber(store, { email, source = 'widget' } = {}, { now = Date.now() } = {}) {
  const e = norm(email);
  if (!validEmail(e)) return { status: 'invalid', email: e };
  const cur = store.subs[e];
  if (cur && cur.status === 'confirmed') return { status: 'already-confirmed', email: e };
  const token = (cur && cur.token) || _rnd();
  store.subs[e] = { email: e, status: 'pending', source: (cur && cur.source) || source, token, createdAt: (cur && cur.createdAt) || now, invitedAt: now };
  return { status: 'pending', email: e, token };
}

/** coldImport(store, emails, {now}) — feed a cold list in as PENDING (each gets a confirm token). Returns
 *  { added, invalid, alreadyConfirmed, pending:[{email,token}] } — caller sends each a single confirm invite. */
export function coldImport(store, emails = [], { now = Date.now() } = {}) {
  const out = { added: 0, invalid: 0, alreadyConfirmed: 0, pending: [] };
  for (const raw of (Array.isArray(emails) ? emails : [])) {
    const r = addSubscriber(store, { email: raw, source: 'cold' }, { now });
    if (r.status === 'pending') { out.added++; out.pending.push({ email: r.email, token: r.token }); }
    else if (r.status === 'already-confirmed') out.alreadyConfirmed++;
    else out.invalid++;
  }
  return out;
}

/** confirm(store, token, {now}) — graduate a pending sub to CONFIRMED. Returns {ok, email}. */
export function confirm(store, token, { now = Date.now() } = {}) {
  if (!token) return { ok: false, reason: 'no-token' };
  const hit = Object.values(store.subs).find((s) => s.token === token);
  if (!hit) return { ok: false, reason: 'not-found' };
  hit.status = 'confirmed'; hit.confirmedAt = now;
  return { ok: true, email: hit.email };
}

/** unsubscribe(store, token-or-email) — mark unsubscribed (honored forever). */
export function unsubscribe(store, idOrEmail) {
  const byTok = Object.values(store.subs).find((s) => s.token === idOrEmail);
  const hit = byTok || store.subs[norm(idOrEmail)];
  if (!hit) return { ok: false };
  hit.status = 'unsubscribed'; return { ok: true, email: hit.email };
}

/** confirmedList(store) — the ONLY list we ever bulk-mail. */
export function confirmedList(store) {
  return Object.values(store.subs).filter((s) => s.status === 'confirmed').map((s) => s.email);
}

export function recordContact(store, { email, name = '', message = '' } = {}, { now = Date.now() } = {}) {
  const e = norm(email);
  if (!validEmail(e) || !String(message).trim()) return { ok: false, reason: 'invalid' };
  store.contacts.push({ email: e, name: String(name).slice(0, 120), message: String(message).slice(0, 4000), at: now });
  return { ok: true };
}

// ── the footer widget (Subscribe + Contact) — drop into any site footer ─────────────────────────────
export function subscribeWidget({ base = '', heading = 'Stay in the loop' } = {}) {
  const b = String(base).replace(/\/$/, '');
  return `<style>
  .nl-widget{max-width:680px;margin:1.4rem auto;padding:1rem;border:1px solid var(--line,#222a3a);border-radius:12px;background:var(--panel,#131826)}
  .nl-widget h3{margin:.1rem 0 .5rem;font-size:1rem;color:var(--gold,#d4a23c)}
  .nl-widget form{display:flex;flex-wrap:wrap;gap:.4rem;margin:.3rem 0}
  .nl-widget input,.nl-widget textarea{flex:1;min-width:180px;font:inherit;padding:.5rem .6rem;border-radius:8px;border:1px solid var(--line,#222a3a);background:var(--bg,#0b0e14);color:var(--fg,#e8e6e3)}
  .nl-widget button{background:var(--gold,#d4a23c);color:#1a1304;font-weight:700;border:0;border-radius:8px;padding:.5rem .9rem;cursor:pointer}
  .nl-widget .nl-msg{font-size:.85rem;color:var(--mut,#9aa4b2);margin-top:.3rem}
  .nl-widget .nl-note{font-size:.75rem;color:var(--mut,#9aa4b2);margin-top:.2rem}
  </style>
  <div class=nl-widget>
    <h3>${esc(heading)}</h3>
    <form onsubmit="return nlSub(event)"><input type=email name=email placeholder="you@email.com" required autocomplete=email>
      <button>Subscribe</button></form>
    <div class=nl-note>Double opt-in — we email a confirm link; no spam, unsubscribe anytime. (Newsletter + drops/airdrop news.)</div>
    <div id=nl-sub-msg class=nl-msg></div>
    <details style="margin-top:.6rem"><summary style="cursor:pointer;color:var(--gold,#d4a23c)">Contact us</summary>
      <form onsubmit="return nlContact(event)" style="margin-top:.4rem;flex-direction:column">
        <input type=email name=email placeholder="your email" required>
        <textarea name=message placeholder="your message" rows=3 required></textarea>
        <button>Send</button></form>
      <div id=nl-contact-msg class=nl-msg></div></details>
  </div>
  <script>
  async function nlPost(u,d){try{const r=await fetch('${b}'+u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});return await r.json()}catch(e){return{ok:false}}}
  async function nlSub(ev){ev.preventDefault();const f=ev.target;const m=document.getElementById('nl-sub-msg');m.textContent='…';const r=await nlPost('/api/subscribe',{email:f.email.value});m.textContent=r&&r.ok?'Check your email for a confirm link. 🙏':(r&&r.error||'Try again.');if(r&&r.ok)f.reset();return false}
  async function nlContact(ev){ev.preventDefault();const f=ev.target;const m=document.getElementById('nl-contact-msg');m.textContent='…';const r=await nlPost('/api/contact',{email:f.email.value,message:f.message.value});m.textContent=r&&r.ok?'Got it — we\\'ll be in touch.':'Try again.';if(r&&r.ok)f.reset();return false}
  </script>`;
}

/**
 * handle(req,res,deps) — mounts /api/subscribe (POST {email}), /api/confirm?token=, /api/contact (POST).
 * deps: { load()->store, save(store), sendConfirm({email,token,confirmUrl}), now, baseUrl }. Returns true
 * if it handled the path (so a host can chain). Soft-fail.
 */
export async function handle(req, res, deps = {}) {
  const load = deps.load || (() => emptyStore());
  const save = deps.save || (() => {});
  const baseUrl = (deps.baseUrl || '').replace(/\/$/, '');
  let url; try { url = new URL(req.url, 'http://x'); } catch { return false; }
  const p = url.pathname;
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const body = async () => { try { let s = ''; for await (const c of req) s += c; return JSON.parse(s || '{}'); } catch { return {}; } };

  if (p === '/api/subscribe' && req.method === 'POST') {
    const { email } = await body();
    const store = await load();
    const r = addSubscriber(store, { email, source: 'widget' });
    if (r.status === 'invalid') return json(200, { ok: false, error: 'Enter a valid email.' }), true;
    if (r.status === 'pending' && typeof deps.sendConfirm === 'function') {
      await deps.sendConfirm({ email: r.email, token: r.token, confirmUrl: `${baseUrl}/api/confirm?token=${r.token}` }).catch(() => {});
    }
    await save(store);
    return json(200, { ok: true, status: r.status }), true;
  }
  if (p === '/api/confirm') {
    const store = await load();
    const r = confirm(store, url.searchParams.get('token'));
    await save(store);
    res.writeHead(r.ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset=utf-8><body style="font:16px system-ui;background:#0b0e14;color:#e8e6e3;text-align:center;padding:3rem">${r.ok ? '✅ Confirmed — you\'re on the list. Thank you!' : 'This link is invalid or expired.'} <p><a style="color:#d4a23c" href="${esc(baseUrl || '/')}">← Home</a></p>`);
    return true;
  }
  if (p === '/api/contact' && req.method === 'POST') {
    const { email, name, message } = await body();
    const store = await load();
    const r = recordContact(store, { email, name, message });
    if (r.ok) { await save(store); if (typeof deps.onContact === 'function') await deps.onContact({ email, name, message }).catch(() => {}); }
    return json(r.ok ? 200 : 200, { ok: r.ok, error: r.ok ? undefined : 'Enter email + a message.' }), true;
  }
  return false;
}
