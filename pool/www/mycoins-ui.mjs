// mycoins-ui.mjs — the "My Coins" page controller (pool-as-wallet, Addendum 24).
//
// Renders every coin the user tracks in one place, each with a Hive-Engine-style RIGHT-SIDE
// option rail (Mine / Wallet / Stake / Trade / Info). Stake & Trade are honestly gated
// ("opens with PRANA / the Melek-Engine DEX seam") — present, never fake.
//
// Adding a coin: generate a fresh wallet IN THE BROWSER (walletgen.mjs, keys never leave the
// device, show-seed-once custody gate from custody.mjs) OR paste an address. Both feed the
// localStorage-backed data layer (mycoins.mjs), which merges with the live Miningcore API.
//
// Spend lock (Addendum 25): the one-wallet outflow-approval TOGGLE is rendered here as a
// pattern placeholder — actual sending does not exist yet and is labelled honestly. Mining
// and receiving never need it.

import { MyCoinsStore, buildMyCoinsView } from './mycoins.mjs';
import {
  WALLET_COINS, resolveWalletCoin, generateWallet, CUSTODY_NOTICE,
} from './walletgen/walletgen.mjs';
import {
  pickConfirmationPositions, checkConfirmation, buildBackupText, SEED_REVEAL_WARNING,
} from './walletgen/custody.mjs';
import { validateAddress, resolveCoin } from './wizard.mjs';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// ---- theme toggle (same as the main page) ----
(function theme() {
  if (typeof document === 'undefined') return; // headless (node --test) — skip
  const btn = $('#theme-toggle');
  if (!btn) return;
  const sync = () => { btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀' : '☾'; };
  btn.onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? '' : 'light';
    if (cur) document.documentElement.setAttribute('data-theme', cur); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('sb-theme', cur); } catch (e) {}
    sync();
  };
  sync();
})();

// Lazily construct the store (needs localStorage) so the module imports cleanly under
// node --test, where there is no localStorage and only the pure helpers are exercised.
let _store = null;
function store() { return (_store ||= new MyCoinsStore()); }

// Map a walletgen coin key -> the My Coins data-layer coin key + default network.
// (walletgen uses 'ethereum_classic'; the data layer keys match.)
const NETWORK_DEFAULT = { monero: 'stagenet', zephyr: 'mainnet', ethereum_classic: 'testnet' };

// ===========================================================================
// Spend lock toggle (Addendum 25) — UI pattern only; sending is not implemented.
// ===========================================================================
function setupSpendToggle() {
  const btn = $('#spend-toggle');
  const note = $('#spend-toggle-note');
  if (!btn) return;
  let approved = false;
  let timer = null;
  const render = () => {
    btn.setAttribute('aria-checked', String(approved));
    btn.textContent = approved ? '🔓 Approve (sending unlocked)' : '🔒 Locked';
    btn.classList.toggle('ghost', approved);
    note.textContent = approved
      ? 'Outflows would be allowed now. Auto re-locks in a moment. (Sending is not wired yet.)'
      : 'Receiving & mining work while locked. Flip to allow an outflow.';
  };
  btn.onclick = () => {
    approved = !approved;
    if (timer) { clearTimeout(timer); timer = null; }
    if (approved) timer = setTimeout(() => { approved = false; render(); }, 15000); // timed re-lock
    render();
  };
  render();
}

// ===========================================================================
// Add-a-coin: coin select + generate/paste paths.
// ===========================================================================
function fillCoinSelect() {
  const sel = $('#ac-coin');
  sel.innerHTML = '';
  for (const [key, c] of Object.entries(WALLET_COINS)) {
    const o = el('option'); o.value = key; o.textContent = `${c.name} (${c.symbol})`;
    sel.appendChild(o);
  }
}

function setupAddCoin() {
  const sel = $('#ac-coin');
  const pasteBox = $('#ac-paste-box');
  const genBox = $('#ac-gen-box');

  $('#ac-paste').onclick = () => {
    genBox.classList.add('hidden'); genBox.innerHTML = '';
    pasteBox.classList.toggle('hidden');
    $('#ac-addr').focus();
  };
  $('#ac-generate').onclick = () => {
    pasteBox.classList.add('hidden');
    runGenerate(sel.value, genBox);
  };

  const addrIn = $('#ac-addr');
  const addrMsg = $('#ac-addr-msg');
  const validate = () => {
    const a = (addrIn.value || '').trim();
    // map walletgen coin -> wizard coin profile for validation
    const wcoin = sel.value === 'ethereum_classic' ? 'ethereum_classic' : sel.value;
    const prof = resolveCoin(wcoin) || resolveCoin(sel.value);
    if (!a) { addrMsg.textContent = ''; addrMsg.className = 'wiz-msg'; return false; }
    const v = prof ? validateAddress(prof, a) : { ok: true };
    if (v.ok) { addrMsg.textContent = '✓ looks like a valid address'; addrMsg.className = 'wiz-msg ok'; return true; }
    addrMsg.textContent = '✗ ' + v.reason; addrMsg.className = 'wiz-msg bad'; return false;
  };
  addrIn.addEventListener('input', validate);

  $('#ac-addr-save').onclick = () => {
    if (!validate()) { addrIn.focus(); return; }
    saveAddress(sel.value, addrIn.value.trim());
    addrIn.value = ''; addrMsg.textContent = '';
    pasteBox.classList.add('hidden');
    renderList();
  };
}

function saveAddress(walletCoinKey, address) {
  const network = NETWORK_DEFAULT[walletCoinKey] || 'mainnet';
  try {
    store().add({ coin: walletCoinKey, address, network });
  } catch (e) {
    // ZEPH pool id may not exist yet (enabled:false) — fall back to a generic record so the
    // generated wallet is still saved/visible; stats just show "no live pool yet".
    store().add({ coin: walletCoinKey, address, poolId: `${walletCoinKey}-pending`, network });
  }
}

// ---- generate-wallet flow with the show-once custody gate ----
function runGenerate(walletCoinKey, box) {
  const c = resolveWalletCoin(walletCoinKey);
  if (!c) return;
  let wallet;
  try {
    wallet = generateWallet(walletCoinKey); // uses crypto.getRandomValues; throws if no CSPRNG
  } catch (e) {
    box.classList.remove('hidden');
    box.innerHTML = `<p class="wiz-msg bad">Could not generate a wallet: ${esc(e.message)}</p>`;
    return;
  }

  box.classList.remove('hidden');
  box.innerHTML = '';

  // Step 1: reveal warning + reveal button.
  const warn = el('div', 'warn', `<b>Before you see your secret:</b> ${esc(SEED_REVEAL_WARNING)}`);
  warn.style.fontSize = '12.5px';
  box.appendChild(warn);

  const revealBtn = el('button', 'wiz-btn', '👁 Reveal my backup (once)');
  box.appendChild(revealBtn);

  revealBtn.onclick = () => {
    revealBtn.remove();
    revealStep(wallet, c, box);
  };
}

function revealStep(wallet, c, box) {
  const secretLabel = wallet.mnemonic ? 'Recovery phrase (25 words)' : 'Private key';
  const secret = wallet.mnemonic || wallet.privateKey;

  const panel = el('div', 'card');
  panel.style.marginTop = '10px';
  panel.innerHTML =
    `<div class="k">${esc(c.symbol)} — write this down now</div>` +
    `<p class="muted" style="font-size:12.5px;margin:6px 0">${esc(CUSTODY_NOTICE)}</p>` +
    `<div class="wiz-lab">${esc(secretLabel)}</div>` +
    `<div class="mono" style="background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;word-break:break-word;font-size:13px">${esc(secret)}</div>` +
    `<div class="wiz-lab" style="margin-top:8px">Your ${esc(c.symbol)} receive address</div>` +
    `<div class="mono" style="font-size:12px;word-break:break-all">${esc(wallet.address)}</div>`;
  box.appendChild(panel);

  const dlRow = el('div', 'wiz-dl');
  const dlBtn = el('button', 'wiz-btn ghost', '⬇ Download backup (.txt)');
  dlBtn.onclick = () => {
    const blob = new Blob([buildBackupText(wallet)], { type: 'text/plain' });
    const a = el('a'); a.href = URL.createObjectURL(blob);
    a.download = `soapbox-${c.symbol.toLowerCase()}-backup.txt`;
    document.body.appendChild(a); a.click(); a.remove();
  };
  dlRow.appendChild(dlBtn);
  panel.appendChild(dlRow);

  // Step 2: confirmation gate.
  if (wallet.mnemonic) {
    const positions = pickConfirmationPositions(25, 3,
      () => (globalThis.crypto ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 : Math.random()));
    confirmStep(wallet, c, box, positions);
  } else {
    // EVM: no mnemonic words to quiz — require a typed "I saved it" acknowledgement.
    ackStep(wallet, c, box);
  }
}

function confirmStep(wallet, c, box, positions) {
  const gate = el('div', 'wiz-field');
  gate.style.marginTop = '10px';
  gate.innerHTML = `<div class="wiz-lab">Confirm you wrote it down — type words ${positions.join(', ')}</div>`;
  const inputs = {};
  for (const p of positions) {
    const wrap = el('div'); wrap.style.margin = '4px 0';
    const lab = el('span', 'muted'); lab.style.fontSize = '12px'; lab.textContent = `word ${p}: `;
    const inp = el('input', 'wiz-input mono'); inp.style.maxWidth = '200px'; inp.style.display = 'inline-block';
    inp.autocomplete = 'off'; inp.spellcheck = false;
    inputs[p] = inp;
    wrap.appendChild(lab); wrap.appendChild(inp); gate.appendChild(wrap);
  }
  const msg = el('div', 'wiz-msg'); gate.appendChild(msg);
  const row = el('div', 'wiz-dl');
  const ok = el('button', 'wiz-btn', '✓ Confirm & save this wallet');
  row.appendChild(ok); gate.appendChild(row);
  box.appendChild(gate);

  ok.onclick = () => {
    const answers = {}; for (const p of positions) answers[p] = inputs[p].value;
    const r = checkConfirmation(wallet.mnemonic, positions, answers);
    if (!r.ok) { msg.textContent = `✗ word(s) ${r.wrong.join(', ')} don't match — check your backup`; msg.className = 'wiz-msg bad'; return; }
    finishGenerate(wallet, c, box);
  };
}

function ackStep(wallet, c, box) {
  const gate = el('div', 'wiz-field'); gate.style.marginTop = '10px';
  gate.innerHTML = `<label class="wiz-lab"><input type="checkbox" id="ac-ack"> I have saved my private key offline. I understand it cannot be recovered.</label>`;
  const row = el('div', 'wiz-dl');
  const ok = el('button', 'wiz-btn', '✓ Save this wallet'); ok.disabled = true;
  row.appendChild(ok); gate.appendChild(row); box.appendChild(gate);
  $('#ac-ack', gate).addEventListener('change', (e) => { ok.disabled = !e.target.checked; });
  ok.onclick = () => finishGenerate(wallet, c, box);
}

function finishGenerate(wallet, c, box) {
  saveAddress(c.key, wallet.address);
  box.innerHTML = `<p class="wiz-msg ok">✓ ${esc(c.symbol)} wallet saved. Your address is below — point your miner at it.</p>` +
    `<div class="mono" style="font-size:12px;word-break:break-all">${esc(wallet.address)}</div>`;
  renderList();
}

// ===========================================================================
// The coin list + Hive-Engine-style right-side option rail.
// ===========================================================================
function railHtml(coinKey, address) {
  // Mine deep-links to the per-coin wizard on the main page; Wallet generates/receives;
  // Stake/Trade are honestly gated; Info opens the per-coin detail.
  const mineHref = `index.html#mine`;
  return (
    `<div class="mc-rail">` +
    `<a class="mc-opt live" href="${esc(mineHref)}" title="Set up mining for this coin">⛏ Mine</a>` +
    `<a class="mc-opt" href="#add-coin" title="Generate or receive into this wallet">👛 Wallet</a>` +
    `<button class="mc-opt soon" type="button" disabled title="Staking opens with PRANA">📥 Stake <span class="mc-soon">PRANA</span></button>` +
    `<button class="mc-opt soon" type="button" disabled title="Trading opens with the Melek-Engine DEX seam">↔ Trade <span class="mc-soon">PRANA DEX</span></button>` +
    `<a class="mc-opt" href="index.html#mine" title="Pool stats &amp; details">ℹ Info</a>` +
    `</div>`
  );
}

function coinCard(group) {
  const symUp = (group.coin || '').toUpperCase();
  const t = group.totals || {};
  const card = el('div', 'card');
  card.style.display = 'flex';
  card.style.gap = '14px';
  card.style.alignItems = 'stretch';

  const main = el('div');
  main.style.flex = '1 1 auto';
  const addrRows = group.addresses.map((a) => {
    const s = a.stats || {};
    const live = a.ok
      ? `<span class="muted">pending</span> <b>${(s.pendingBalance || 0).toFixed(6)}</b> · <span class="muted">paid</span> <b>${(s.totalPaid || 0).toFixed(6)}</b> · <span class="muted">${(s.hashrate || 0).toFixed(1)} H/s · ${s.workerCount || 0} worker(s)</span>`
      : `<span class="muted">no live pool yet (node syncing or not started)</span>`;
    return `<div style="margin:4px 0"><div class="mono" style="font-size:11.5px;word-break:break-all">${esc(a.address)}</div><div style="font-size:12.5px">${live}</div></div>`;
  }).join('');

  main.innerHTML =
    `<div class="k">${esc(symUp)}</div>` +
    `<h3 style="margin:4px 0 6px">${esc(symUp)} · ${group.addresses.length} address${group.addresses.length === 1 ? '' : 'es'}</h3>` +
    `<div style="font-size:12.5px;margin-bottom:6px">Total pending <b>${(t.pendingBalance || 0).toFixed(6)}</b> · paid <b>${(t.totalPaid || 0).toFixed(6)}</b> · ${(t.hashrate || 0).toFixed(1)} H/s</div>` +
    addrRows;

  card.appendChild(main);
  card.insertAdjacentHTML('beforeend', railHtml(group.coin, group.addresses[0]?.address));
  return card;
}

async function renderList() {
  const list = $('#mc-list');
  const view = await buildMyCoinsView(store()).catch((e) => ({ coins: [], empty: true, error: e.message }));
  if (view.empty) {
    list.innerHTML = `<div class="note">No coins yet. Use <b>Add a coin</b> above to generate a wallet or paste an address.</div>`;
    return;
  }
  list.innerHTML = '';
  list.style.display = 'grid';
  for (const group of view.coins) list.appendChild(coinCard(group));
}

// ---- boot ----
if (typeof document !== 'undefined') {
  const boot = () => {
    setupSpendToggle();
    fillCoinSelect();
    setupAddCoin();
    renderList();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}

export { setupSpendToggle, railHtml, coinCard };
