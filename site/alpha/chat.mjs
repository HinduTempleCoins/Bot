// site/alpha/chat.mjs — browser logic for Hathor's chat widget (chat.html).
//
// Framework-free. The DOM wiring is at the bottom (guarded so importing this file in a test does not
// touch the DOM). The transport (sendChat) takes an INJECTABLE fetch so it is offline-testable, and
// esc() escapes EVERYTHING before it reaches innerHTML. No keys are ever requested or handled here.

// The chat endpoint. Same-origin by default (the page is served from the alpha origin and the chat
// server is reverse-proxied at /chat); override via window.__CHAT_ENDPOINT for other deployments.
export const DEFAULT_ENDPOINT = '/chat';

/** Escape for safe innerHTML insertion. Used on every piece of dynamic text. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * POST one message to the chat server and return the parsed reply. PURE except for the injected fetch.
 * Soft-fails: on any network/parse error it returns a friendly fallback rather than throwing, so the
 * widget never breaks. Carries `state` for the multi-turn walkthrough.
 *
 * @param {string} message
 * @param {object|null} state            prior walkthrough state (round-tripped)
 * @param {object} [opts]
 * @param {string} [opts.endpoint]       defaults to DEFAULT_ENDPOINT
 * @param {typeof fetch} [opts.fetch]    injectable; defaults to globalThis.fetch
 * @returns {Promise<{ reply: string, kind: string, done: boolean, state: object|null }>}
 */
export async function sendChat(message, state = null, opts = {}) {
  const endpoint = opts.endpoint || DEFAULT_ENDPOINT;
  const doFetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : globalThis.fetch);
  const fallback = { reply: "I couldn't reach the chain just now — try again in a moment.", kind: 'nudge', done: false, state };
  if (!doFetch) return fallback;
  try {
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, state: state || undefined }),
    });
    const j = await res.json();
    if (!j || j.ok !== true || typeof j.reply !== 'string') return fallback;
    return {
      reply: j.reply,
      kind: typeof j.kind === 'string' ? j.kind : 'reply',
      done: Boolean(j.done),
      state: j.state && typeof j.state === 'object' ? j.state : null,
    };
  } catch {
    return fallback;
  }
}

/**
 * Build the HTML for one chat bubble. Pure; escapes the text. `who` is 'me' or 'hathor'.
 * @returns {string}
 */
export function bubbleHtml(who, text) {
  const cls = who === 'me' ? 'msg me' : 'msg hathor';
  const name = who === 'me' ? 'You' : 'Hathor';
  return `<div class="${cls}"><span class="who">${esc(name)}</span><span class="bubble">${esc(text)}</span></div>`;
}

// ── DOM wiring (guarded — only runs in a real browser with the expected elements) ───────────────────
export function mount(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc) return null;
  const list = doc.getElementById('chat-list');
  const input = doc.getElementById('chat-input');
  const form = doc.getElementById('chat-form');
  if (!list || !input || !form) return null;

  const endpoint = (typeof window !== 'undefined' && window.__CHAT_ENDPOINT) || DEFAULT_ENDPOINT;
  let state = null;
  let busy = false;

  function append(who, text) {
    list.insertAdjacentHTML('beforeend', bubbleHtml(who, text));
    list.scrollTop = list.scrollHeight;
  }
  function appendTyping() {
    list.insertAdjacentHTML('beforeend', '<div class="msg hathor typing" id="chat-typing"><span class="who">Hathor</span><span class="bubble">…</span></div>');
    list.scrollTop = list.scrollHeight;
  }
  function clearTyping() {
    const t = doc.getElementById('chat-typing');
    if (t) t.remove();
  }

  async function submit(text) {
    if (busy || !text.trim()) return;
    busy = true;
    append('me', text);
    input.value = '';
    appendTyping();
    const out = await sendChat(text, state, { endpoint });
    clearTyping();
    state = out.state;
    append('hathor', out.reply);
    busy = false;
    input.focus();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(input.value);
  });

  // A warm opening line so the page is never empty (a disposition, not a chain greeting).
  append('hathor', "Hello, I'm Hathor. I can walk you through making an account here, step by step. Just say \"make me an account\" — or ask me anything.");
  input.focus();
  return { submit, get state() { return state; } };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  // Auto-mount when loaded as a module in the page.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount());
  } else {
    mount();
  }
}
