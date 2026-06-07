// account-ui.mjs — shared glue for the MELEK testnet account pages (signup + key checker).
// Everything secret stays in the browser (graphene-keys.mjs); this module only renders,
// copies, and talks to the PUBLIC endpoints (/rpc chain reads, /faucet/create with public
// keys only). Exported pure-ish helpers are offline-testable with an injected fetch/doc.

import {
  keysFromLogin, generateMasterPassword, classifySecret, ROLES,
} from './graphene-keys.mjs';
import {
  newGateState, markDelivered, setConfirmInput, canCreate, gateReason,
} from './account-gate.mjs';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── chain + faucet (public data only crosses the wire) ──────────────────────

export async function getAccount(name) {
  const r = await _fetch('/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_accounts', params: [[String(name || '').toLowerCase()]] }),
  });
  const d = await r.json().catch(() => null);
  const a = d && Array.isArray(d.result) ? d.result[0] : null;
  return a && a.name ? a : null;
}

/** On-chain public keys per role, as plain arrays of key strings. */
export function chainPubs(account) {
  const grab = (auth) => (auth && Array.isArray(auth.key_auths) ? auth.key_auths.map((k) => k[0]) : []);
  return {
    owner: grab(account.owner), active: grab(account.active),
    posting: grab(account.posting), memo: account.memo_key ? [account.memo_key] : [],
  };
}

export async function faucetCreate({ name, pubs }) {
  const r = await _fetch('/faucet/create', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      ownerPub: pubs.owner, activePub: pubs.active, postingPub: pubs.posting, memoPub: pubs.memo,
    }),
  });
  return r.json().catch(() => ({ ok: false, reason: 'faucet unreachable' }));
}

// ── the copy button (operator 2026-06-06: never make them highlight a key) ──

export function copyButtonHtml(value, label = 'Copy') {
  // value rides in a data attribute; wireCopyButtons reads it back out — no inline JS.
  return `<button type="button" class="copy-btn" data-copy="${esc(value)}">${esc(label)}</button>`;
}

export function wireCopyButtons(root, { clipboard, doc, onCopySuccess } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const clip = clipboard || (typeof navigator !== 'undefined' ? navigator.clipboard : null);
  if (!root || !d) return 0;
  let wired = 0;
  for (const btn of root.querySelectorAll('.copy-btn[data-copy]')) {
    btn.addEventListener('click', async () => {
      const v = btn.getAttribute('data-copy') || '';
      let ok = false;
      try { if (clip && clip.writeText) { await clip.writeText(v); ok = true; } } catch { ok = false; }
      if (!ok) { // fallback: hidden textarea select+execCommand
        try {
          const ta = d.createElement('textarea');
          ta.value = v; ta.style.position = 'fixed'; ta.style.opacity = '0';
          d.body.appendChild(ta); ta.select(); ok = d.execCommand && d.execCommand('copy'); ta.remove();
        } catch { ok = false; }
      }
      btn.textContent = ok ? '✓ Copied' : 'Copy failed — select it manually';
      if (ok && typeof onCopySuccess === 'function') onCopySuccess();
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
    wired++;
  }
  return wired;
}

// ── rendering ────────────────────────────────────────────────────────────────

/** The save-these block: master password + the four keys, each with a Copy button. Pure HTML. */
export function keysBlockHtml(name, password, keys) {
  const row = (label, value, note = '') =>
    `<div class="krow"><div class="klab">${esc(label)}${note ? ` <span class="muted">${esc(note)}</span>` : ''}</div>` +
    `<code class="kval">${esc(value)}</code>${copyButtonHtml(value)}</div>`;
  return [
    `<div class="keys-block">`,
    `<h3>Save ALL of this — it cannot be recovered for you</h3>`,
    row('Account', name),
    row('Master password', password, '← log in with THIS'),
    ...ROLES.map((r) => row(`${r[0].toUpperCase()}${r.slice(1)} key`, keys[r].wif,
      r === 'posting' ? '(also works for login)' : r === 'owner' ? '(keep offline — full control)' : '')),
    `</div>`,
  ].join('\n');
}

/** The downloadable keys file content. Plain text the user keeps. */
export function keysFileText(name, password, keys) {
  return [
    `============================================================`,
    `  MELEK TESTNET account credentials — KEEP THIS FILE SAFE`,
    `  [TestNet not MELEK]`,
    `============================================================`,
    `WARNING: anyone with these lines controls this account. Nobody`,
    `can recover them for you — not the operator, not the witness.`,
    `Store this file somewhere private and back it up.`,
    `Generated in your browser; the server never saw the private lines.`,
    ``,
    `Account:          ${name}`,
    `Master password:  ${password}   <-- log in with this`,
    ``,
    ...ROLES.flatMap((r) => [
      `${r} private key:  ${keys[r].wif}`,
      `${r} public key:   ${keys[r].pub}`,
    ]),
    ``,
    `Login: https://alpha.melek.salon  (username: ${name}, password: the master password)`,
    `[TestNet not MELEK] — these are testnet credentials.`,
  ].join('\n');
}

// ── page controllers (browser only; guarded so import is side-effect-free) ──

export async function runSignup({ name, doc }) {
  const d = doc || document;
  const out = d.getElementById('out');
  const n = String(name || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{2,15}$/.test(n)) {
    out.innerHTML = `<p class="bad">Pick a name: 3–16 chars, lowercase letters/numbers/hyphens, starting with a letter.</p>`;
    return;
  }
  out.innerHTML = `<p class="muted">checking availability…</p>`;
  if (await getAccount(n)) {
    out.innerHTML = `<p class="bad">"${esc(n)}" is taken — try another name.</p>`;
    return;
  }
  // Fresh credentials every time this runs — refreshing / re-running resets the whole gate.
  const password = await generateMasterPassword();
  const keys = await keysFromLogin(n, password);
  let gate = newGateState();

  out.innerHTML = [
    keysBlockHtml(n, password, keys),
    `<div class="gate">`,
    `<h3>Before you can create the account</h3>`,
    `<p class="muted small">There is no recovery. You must keep these credentials, then prove it below — the button stays locked until both steps are done.</p>`,
    `<p class="gate-step"><b>1.</b> Get your keys: `,
    `<button type="button" id="dl" class="wiz-btn">⬇ Download my keys</button>`,
    ` <span class="muted small">(or use a Copy button above)</span> `,
    `<span id="delivered-ok" class="ok small" hidden>✓ saved</span></p>`,
    `<p class="gate-step"><b>2.</b> Re-type your master password to confirm you have it:</p>`,
    `<input id="confirm" class="wiz-input mono" type="text" autocomplete="off" spellcheck="false" placeholder="paste or type your master password">`,
    `<p id="gate-reason" class="muted small"></p>`,
    `<p><button type="button" id="create" class="wiz-btn" disabled>Create my account</button></p>`,
    `<div id="create-msg"></div>`,
    `</div>`,
  ].join('\n');

  const createBtn = d.getElementById('create');
  const reasonEl = d.getElementById('gate-reason');
  const deliveredOk = d.getElementById('delivered-ok');
  const refreshGate = () => {
    createBtn.disabled = !canCreate(gate, password);
    if (deliveredOk) deliveredOk.hidden = !gate.delivered;
    if (reasonEl) reasonEl.textContent = gateReason(gate, password);
  };
  const markGotKeys = () => { gate = markDelivered(gate); refreshGate(); };

  wireCopyButtons(out, { onCopySuccess: markGotKeys });
  d.getElementById('dl').addEventListener('click', () => {
    const blob = new Blob([keysFileText(n, password, keys)], { type: 'text/plain' });
    const a = d.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `melek-testnet-${n}-keys.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    markGotKeys();
  });
  d.getElementById('confirm').addEventListener('input', (e) => {
    gate = setConfirmInput(gate, e.target.value);
    refreshGate();
  });
  refreshGate();

  createBtn.addEventListener('click', async () => {
    if (!canCreate(gate, password)) return; // belt-and-suspenders: never create through a closed gate
    createBtn.disabled = true;
    const msg = d.getElementById('create-msg');
    msg.innerHTML = `<p class="muted">creating on the testnet…</p>`;
    const pubs = Object.fromEntries(ROLES.map((r) => [r, keys[r].pub])); // PUBLIC keys only cross the wire
    const res = await faucetCreate({ name: n, pubs });
    if (res && res.ok) {
      out.innerHTML = createdReminderHtml(n, password, keys);
      wireCopyButtons(out);
    } else {
      createBtn.disabled = false;
      msg.innerHTML = `<p class="bad">creation failed: ${esc((res && res.reason) || 'unknown')} — your keys are still yours; try again in a minute.</p>`;
    }
  });
}

/** Post-creation screen: show the password once more + verify/continue links. Pure HTML. */
export function createdReminderHtml(name, password, keys) {
  return [
    `<div class="done-block">`,
    `<p class="ok">✅ <b>@${esc(name)}</b> is live on the testnet. <span class="tag">[TestNet not MELEK]</span></p>`,
    `<h3>One last time — this is your password. Make sure it is saved.</h3>`,
    `<div class="krow"><div class="klab">Master password <span class="muted">← log in with THIS</span></div>` +
      `<code class="kval">${esc(password)}</code>${copyButtonHtml(password)}</div>`,
    `<p class="muted small">There is no recovery. If you have not saved your keys file yet, download it now from the field above before you leave this page.</p>`,
    `<p><a href="keycheck.html" class="wiz-btn">Verify you saved it right</a> ` +
      `<a href="welcome.html?name=${encodeURIComponent(name)}" class="wiz-btn">Continue to Welcome →</a></p>`,
    `<p class="muted small">Then <a href="/">log in</a> with your master password.</p>`,
    `</div>`,
  ].join('\n');
}

export async function runKeycheck({ name, secret, doc }) {
  const d = doc || document;
  const out = d.getElementById('out');
  const n = String(name || '').trim().toLowerCase();
  if (!n || !secret) { out.innerHTML = `<p class="bad">Enter both the account name and the saved string.</p>`; return; }
  out.innerHTML = `<p class="muted">reading the account from the chain… (your pasted string does NOT leave this page)</p>`;
  const acct = await getAccount(n);
  if (!acct) { out.innerHTML = `<p class="bad">No account "${esc(n)}" on the testnet — check the spelling (it must be exact).</p>`; return; }
  const verdict = await classifySecret(n, secret, chainPubs(acct));
  const cls = verdict.kind === 'no-match' ? 'bad' : 'ok';
  out.innerHTML = `<p class="${cls}"><b>${esc(verdict.hint)}</b></p>`;
}
