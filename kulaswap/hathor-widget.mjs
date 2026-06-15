// hathor-widget.mjs — Hathor's EMBEDDABLE floating chat box. Drop her onto ANY surface with one tag:
//
//   <script>window.__HATHOR_WIDGET = { endpoint: 'https://chat.melek.salon/chat' }</script>
//   <script type="module" src="hathor-widget.mjs"></script>
//
// Self-contained on purpose (no imports) so it works same-origin on the pool, the condenser, the
// witness school, etc. — "expand her presence." It renders a gold launcher bubble bottom-right; click
// opens a chat panel that POSTs to Hathor's /chat server (the same deterministic brain as the alpha
// page). The /chat server CORS-allows each embedding origin. No keys are ever requested or handled.
//
// House style: framework-free, esc() EVERYTHING before innerHTML, injectable fetch + doc for offline
// tests, soft-fail (a network/parse error becomes a friendly fallback, the widget never breaks), and
// the DOM auto-mount is guarded so importing this file in a test does not touch the DOM.

// SELF-CONTAINED by default: Hathor's deterministic brain runs CLIENT-SIDE on the pool (mode:'local'),
// so her chat box needs no server, no CORS, no chain — she is a portable persona, not a chain service.
// Set window.__HATHOR_WIDGET.mode='remote' (+ endpoint) to instead POST to a chat server.
export const DEFAULT_ENDPOINT = 'https://alpha.melek.salon/chat';

// Lazy, memoized, soft-fail import of the vendored browser brain (pool/www/hathor-brain.mjs).
let _brain = null;
async function loadBrain(inject) {
  if (inject) return inject;
  if (_brain) return _brain;
  try { _brain = await import('./hathor-brain.mjs'); } catch { _brain = null; }
  return _brain;
}

/**
 * Get Hathor's reply. mode:'local' (default) runs the deterministic brain in the browser; mode:'remote'
 * POSTs to the chat server. Always soft-fails to a friendly line. `opts.brain` injects a brain for tests.
 * @returns {Promise<{reply:string, kind:string, done:boolean, state:object|null}>}
 */
export async function respond(message, state = null, opts = {}) {
  const mode = opts.mode || 'local';
  if (mode === 'remote') return sendChat(message, state, opts);
  const brain = await loadBrain(opts.brain);
  if (!brain || typeof brain.handleMessage !== 'function') {
    return { reply: "I'm here — ask me about signing up, keys, or how the pool works.", kind: 'error', done: false, state };
  }
  try {
    const out = await brain.handleMessage({ user: 'pool-guest', text: String(message ?? ''), state }, {});
    return { reply: out.reply, kind: out.kind || 'answer', done: !!out.done, state: out.state ?? null };
  } catch {
    return { reply: "Sorry — I hit a snag. Try asking how to sign up, or type !help.", kind: 'error', done: false, state };
  }
}

/** Escape for safe innerHTML insertion. Used on every piece of dynamic text. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * POST one message to Hathor's chat server. PURE except for the injected fetch. Soft-fails to a
 * friendly fallback so the widget never throws. Carries `state` for the multi-turn walkthrough.
 * @returns {Promise<{reply:string, kind:string, done:boolean, state:object|null}>}
 */
export async function sendChat(message, state = null, opts = {}) {
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { reply: "I can't reach my chat service from here right now.", kind: 'error', done: false, state };
  try {
    const res = await f(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: String(message ?? ''), state }),
    });
    const data = await res.json();
    if (!res.ok || !data || typeof data.reply !== 'string') {
      return { reply: "Sorry — I hit a snag answering that. Try again, or the signup page is always there.", kind: 'error', done: false, state };
    }
    return { reply: data.reply, kind: data.kind || 'answer', done: !!data.done, state: data.state ?? null };
  } catch {
    return { reply: "I couldn't reach my chat service just now. Give it another try in a moment.", kind: 'error', done: false, state };
  }
}

// The widget's own scoped CSS (injected once). Namespaced under .hathor-w so it never collides with
// the host page (the pool's own styles, the condenser's, etc.).
const STYLE = `
.hathor-w,.hathor-w *{box-sizing:border-box}
.hathor-w-launch{position:fixed;right:18px;bottom:18px;z-index:2147483600;width:58px;height:58px;border:0;border-radius:50%;
  background:radial-gradient(circle at 30% 30%,#d4a23c,#7a5a18);color:#1a1304;font-size:26px;cursor:pointer;
  box-shadow:0 6px 22px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center}
.hathor-w-launch:active{filter:brightness(.93)}
.hathor-w-panel{position:fixed;right:18px;bottom:88px;z-index:2147483600;width:360px;max-width:calc(100vw - 24px);
  height:520px;max-height:calc(100vh - 120px);background:#131826;color:#e8e6e3;border:1px solid #222a3a;border-radius:14px;
  display:none;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.5);
  font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.hathor-w-panel.open{display:flex}
.hathor-w-head{display:flex;align-items:center;gap:.6rem;padding:.7rem .8rem;border-bottom:1px solid #222a3a;background:#0f1422}
.hathor-w-av{width:30px;height:30px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#d4a23c,#7a5a18);flex:0 0 auto}
.hathor-w-title{font-weight:700;font-size:.95rem}
.hathor-w-sub{color:#9aa4b2;font-size:.72rem}
.hathor-w-x{margin-left:auto;background:transparent;border:0;color:#9aa4b2;font-size:1.2rem;cursor:pointer;line-height:1}
.hathor-w-list{flex:1 1 auto;overflow-y:auto;padding:.85rem;display:flex;flex-direction:column;gap:.7rem}
.hathor-w-msg{display:flex;flex-direction:column;max-width:88%}
.hathor-w-msg.me{align-self:flex-end;align-items:flex-end}
.hathor-w-msg.h{align-self:flex-start;align-items:flex-start}
.hathor-w-who{font-size:.64rem;color:#9aa4b2;margin:0 .3rem .12rem}
.hathor-w-msg.h .hathor-w-who{color:#d4a23c}
.hathor-w-bub{padding:.55rem .8rem;border-radius:12px;white-space:pre-wrap;word-wrap:break-word;border:1px solid #222a3a}
.hathor-w-msg.h .hathor-w-bub{background:#0f1422;border-bottom-left-radius:4px}
.hathor-w-msg.me .hathor-w-bub{background:#1c2435;border-bottom-right-radius:4px}
.hathor-w-typing .hathor-w-bub{color:#9aa4b2;letter-spacing:.15em}
.hathor-w-form{display:flex;gap:.45rem;padding:.6rem;border-top:1px solid #222a3a;background:#0f1422}
.hathor-w-in{flex:1 1 auto;background:#0b0e14;border:1px solid #222a3a;border-radius:9px;color:#e8e6e3;font:inherit;padding:.5rem .7rem}
.hathor-w-in:focus{outline:none;border-color:#d4a23c}
.hathor-w-send{background:#d4a23c;color:#1a1304;border:0;border-radius:9px;padding:.5rem .9rem;font:inherit;font-weight:700;cursor:pointer}`;

const OPENING = "Hello, I'm Hathor — the witness of MELEK. You're mining here; ask me anything about it: "
  + "how the pool works, claiming your coins, signing up on MELEK, keys, any of it. If you'd like me to "
  + 'walk you through it step by step, just say "I have no idea what I\'m doing."';

/**
 * Mount the floating widget. Idempotent (won't double-mount). DOM is fully injected — the host page
 * needs nothing but the script tag. All deps injectable for tests.
 * @param {object} [opts]
 * @param {string} [opts.endpoint]   chat server URL (default window.__HATHOR_WIDGET.endpoint or DEFAULT)
 * @param {Document} [opts.doc]      defaults to document
 * @param {typeof fetch} [opts.fetch]
 * @returns {{open:Function, close:Function, submit:Function, el:Element}|null}
 */
export function mountHathorWidget(opts = {}) {
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.body) return null;
  if (doc.getElementById('hathor-w-root')) return null;   // already mounted
  const cfg = (typeof window !== 'undefined' && window.__HATHOR_WIDGET) || {};
  const endpoint = opts.endpoint || cfg.endpoint || DEFAULT_ENDPOINT;
  const mode = opts.mode || cfg.mode || 'local';
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : undefined);

  if (!doc.getElementById('hathor-w-style')) {
    const st = doc.createElement('style');
    st.id = 'hathor-w-style'; st.textContent = STYLE;
    doc.head.appendChild(st);
  }

  const root = doc.createElement('div');
  root.id = 'hathor-w-root'; root.className = 'hathor-w';
  root.innerHTML = `
    <button class="hathor-w-launch" id="hathor-w-launch" aria-label="Ask Hathor" title="Ask Hathor">✦</button>
    <section class="hathor-w-panel" id="hathor-w-panel" role="dialog" aria-label="Chat with Hathor">
      <div class="hathor-w-head">
        <span class="hathor-w-av"></span>
        <div><div class="hathor-w-title">Hathor</div><div class="hathor-w-sub">witness of MELEK · ask me anything</div></div>
        <button class="hathor-w-x" id="hathor-w-x" aria-label="Close">×</button>
      </div>
      <div class="hathor-w-list" id="hathor-w-list"></div>
      <form class="hathor-w-form" id="hathor-w-form">
        <input class="hathor-w-in" id="hathor-w-in" autocomplete="off" placeholder="Ask Hathor…" aria-label="Message">
        <button class="hathor-w-send" type="submit">Send</button>
      </form>
    </section>`;
  doc.body.appendChild(root);

  const panel = doc.getElementById('hathor-w-panel');
  const list = doc.getElementById('hathor-w-list');
  const form = doc.getElementById('hathor-w-form');
  const input = doc.getElementById('hathor-w-in');
  let state = null, busy = false, opened = false;

  function bubble(who, text) {
    const cls = who === 'me' ? 'me' : 'h';
    const name = who === 'me' ? 'You' : 'Hathor';
    list.insertAdjacentHTML('beforeend',
      `<div class="hathor-w-msg ${cls}"><span class="hathor-w-who">${esc(name)}</span><span class="hathor-w-bub">${esc(text)}</span></div>`);
    list.scrollTop = list.scrollHeight;
  }
  function typing(on) {
    const ex = doc.getElementById('hathor-w-typing');
    if (on && !ex) { list.insertAdjacentHTML('beforeend', '<div class="hathor-w-msg h hathor-w-typing" id="hathor-w-typing"><span class="hathor-w-who">Hathor</span><span class="hathor-w-bub">…</span></div>'); list.scrollTop = list.scrollHeight; }
    if (!on && ex) ex.remove();
  }
  async function submit(text) {
    if (busy || !String(text).trim()) return;
    busy = true; bubble('me', text); input.value = ''; typing(true);
    const out = await respond(text, state, { mode, endpoint, fetch: fetchImpl, brain: opts.brain });
    typing(false); state = out.state; bubble('hathor', out.reply); busy = false;
    if (input.focus) input.focus();
  }
  function open() {
    panel.classList.add('open');
    if (!opened) { opened = true; bubble('hathor', OPENING); }   // greet on first open
    if (input.focus) input.focus();
  }
  function close() { panel.classList.remove('open'); }

  doc.getElementById('hathor-w-launch').addEventListener('click', () => (panel.classList.contains('open') ? close() : open()));
  doc.getElementById('hathor-w-x').addEventListener('click', close);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(input.value); });

  return { open, close, submit, el: root };
}

// Auto-mount when loaded as a module in a page (guarded so tests can import without a DOM).
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountHathorWidget());
  else mountHathorWidget();
}
