// wallet.mjs — the WALLET front door for the SoapBox mining pool
// (pool.soapbox.community/wallet — moves to akasha.soapbox.community when PRANA launches).
//
// This is the "all your wallets in one place" page. It is a thin controller on top of the
// SAME pieces My Coins uses, so /wallet and mycoins.html see the EXACT SAME wallets:
//   - walletgen.mjs  : client-side, non-custodial wallet generation (keys never leave browser)
//   - custody.mjs    : show-seed-once gate + spend-lock outflow-approval pattern
//   - mycoins.mjs    : the localStorage-backed data layer (one STORAGE_KEY shared with My Coins)
//
// One card per coin: Zephyr (ZEPH), Monero (XMR), and the one EVM address (covers ETC now,
// PRANA at launch). Each card lets you GENERATE a fresh wallet here OR PASTE an address you
// already control; once added the address shows, and per-coin quick actions deep-link to the
// existing surfaces (Mine / Pool stats / My Coins).
//
// Privacy: no telemetry, no external scripts, every interpolation goes through esc(). The only
// thing that ever leaves the device is the public RECEIVE ADDRESS (the mining payout username).

import { MyCoinsStore, buildMyCoinsView } from '../mycoins.mjs';
import {
  WALLET_COINS, resolveWalletCoin, generateWallet, CUSTODY_NOTICE,
} from '../walletgen/walletgen.mjs';
import {
  pickConfirmationPositions, checkConfirmation, buildBackupText, SEED_REVEAL_WARNING,
} from '../walletgen/custody.mjs';
import { validateAddress, resolveCoin } from '../wizard.mjs';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// Map a walletgen coin key -> the My Coins data-layer default network (kept identical to
// mycoins-ui.mjs so a wallet added here lands on the same poolId record as one added there).
const NETWORK_DEFAULT = { monero: 'stagenet', zephyr: 'mainnet', ethereum_classic: 'testnet' };

// The PRANA / Akasha migration note, surfaced verbatim by the page. The seed is what carries:
// the same recovery phrase / private key restores the same wallet on the Akasha surface.
export const PRANA_MIGRATION_NOTE =
  'This wallet will move to akasha.soapbox.community when PRANA launches — your wallet comes ' +
  'with you (same seed). Nothing here is custodial: because the secret lives only on your ' +
  'device, moving surfaces changes nothing about who controls your coins.';

// ---------------------------------------------------------------------------
// Per-coin quick actions: deep links to the EXISTING surfaces. Outflow ("Send") is honestly
// gated — sending does not exist in this build yet (see the spend-lock banner).
// Returns plain data so it is unit-testable without a DOM.
// ---------------------------------------------------------------------------
export function quickActions(walletCoinKey) {
  const c = resolveWalletCoin(walletCoinKey);
  const sym = c ? c.symbol : String(walletCoinKey || '').toUpperCase();
  return [
    { label: '⛏ Mine', href: '../index.html#mine', live: true, title: `Set up mining for ${sym}` },
    { label: '📊 Pool stats', href: '../index.html#mine', live: true, title: `${sym} pool stats & details` },
    { label: '🪙 My Coins', href: '../mycoins.html', live: true, title: 'Balances, payouts & workers' },
    { label: '↗ Send', href: null, live: false, soon: 'PRANA', title: 'Sending opens with PRANA / the Akasha wallet' },
  ];
}

function actionsHtml(walletCoinKey) {
  const acts = quickActions(walletCoinKey).map((a) => {
    if (a.live) return `<a class="mc-opt live" href="${esc(a.href)}" title="${esc(a.title)}">${esc(a.label)}</a>`;
    return `<button class="mc-opt soon" type="button" disabled title="${esc(a.title)}">${esc(a.label)}` +
      (a.soon ? ` <span class="mc-soon">${esc(a.soon)}</span>` : '') + `</button>`;
  }).join('');
  return `<div class="mc-rail">${acts}</div>`;
}

// Lazily construct the store (needs localStorage) so the module imports cleanly under
// node --test, where there is no localStorage and only the pure helpers are exercised.
let _store = null;
function store() { return (_store ||= new MyCoinsStore()); }

// ===========================================================================
// Spend lock toggle (Addendum 25) — UI pattern only; sending is not implemented yet.
// Mirrors mycoins-ui.mjs so the two pages behave identically.
// ===========================================================================
export function setupSpendToggle() {
  const btn = $('#spend-toggle');
  const note = $('#spend-toggle-note');
  if (!btn) return;
  let approved = false;
  let timer = null;
  const render = () => {
    btn.setAttribute('aria-checked', String(approved));
    btn.textContent = approved ? '🔓 Approve (sending unlocked)' : '🔒 Locked';
    btn.classList.toggle('ghost', approved);
    if (note) note.textContent = approved
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
// One card per supported coin (ZEPH / XMR / EVM). Shows the saved address(es) if any, a
// Generate-here button, a Paste-address path, and the per-coin quick-action rail.
// `savedGroup` is the data-layer view for this coin (may be undefined when nothing saved).
// Pure string builder -> unit testable without a DOM.
// ===========================================================================
export function walletCardHtml(walletCoinKey, savedGroup) {
  const c = resolveWalletCoin(walletCoinKey);
  if (!c) return '';
  const addrs = (savedGroup && savedGroup.addresses) || [];
  const addrList = addrs.length
    ? addrs.map((a) => `<div class="mono" style="font-size:11.5px;word-break:break-all;margin:3px 0">${esc(a.address)}</div>`).join('')
    : `<div class="muted" style="font-size:12.5px">No ${esc(c.symbol)} wallet yet — generate one here, or paste an address you already control.</div>`;
  const evmNote = c.family === 'evm'
    ? `<div class="muted" style="font-size:11.5px;margin-top:4px">One EVM address — covers Ethereum Classic now, PRANA at launch.</div>`
    : '';
  return (
    `<div class="card" data-coin="${esc(walletCoinKey)}" style="display:flex;gap:14px;align-items:stretch">` +
      `<div style="flex:1 1 auto">` +
        `<div class="k">${esc(c.symbol)}</div>` +
        `<h3 style="margin:4px 0 6px">${esc(c.name)} <span class="muted" style="font-weight:400">(${esc(c.symbol)})</span></h3>` +
        `<div class="w-addrs">${addrList}</div>` +
        evmNote +
        `<div class="wiz-dl" style="margin-top:10px">` +
          `<button class="wiz-btn" data-act="generate">✦ Generate a wallet here</button>` +
          `<button class="wiz-btn ghost" data-act="paste">＋ Paste an address I have</button>` +
        `</div>` +
        `<div class="w-paste wiz-field hidden" style="margin-top:8px">` +
          `<label class="wiz-lab">Your ${esc(c.symbol)} receive address</label>` +
          `<input class="wiz-input mono" type="text" autocomplete="off" spellcheck="false" placeholder="paste your receive address">` +
          `<div class="wiz-msg"></div>` +
          `<div class="wiz-dl" style="margin-top:6px"><button class="wiz-btn" data-act="paste-save">Save address</button></div>` +
        `</div>` +
        `<div class="w-gen wiz-out hidden" style="margin-top:8px"></div>` +
      `</div>` +
      actionsHtml(walletCoinKey) +
    `</div>`
  );
}

function saveAddress(walletCoinKey, address) {
  const network = NETWORK_DEFAULT[walletCoinKey] || 'mainnet';
  try {
    store().add({ coin: walletCoinKey, address, network });
  } catch (e) {
    // ZEPH pool id may not exist yet (enabled:false) — fall back to a generic record so the
    // generated wallet is still saved/visible across both pages; stats just show "no live pool".
    store().add({ coin: walletCoinKey, address, poolId: `${walletCoinKey}-pending`, network });
  }
}

// ---- generate-wallet flow with the show-once custody gate (same gate as My Coins) ----
function runGenerate(walletCoinKey, box) {
  const c = resolveWalletCoin(walletCoinKey);
  if (!c) return;
  let wallet;
  try {
    wallet = generateWallet(walletCoinKey); // crypto.getRandomValues; throws if no CSPRNG
  } catch (e) {
    box.classList.remove('hidden');
    box.innerHTML = `<p class="wiz-msg bad">Could not generate a wallet: ${esc(e.message)}</p>`;
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = '';

  const warn = el('div', 'warn', `<b>Before you see your secret:</b> ${esc(SEED_REVEAL_WARNING)}`);
  warn.style.fontSize = '12.5px';
  box.appendChild(warn);

  const revealBtn = el('button', 'wiz-btn', '👁 Reveal my backup (once)');
  box.appendChild(revealBtn);
  revealBtn.onclick = () => { revealBtn.remove(); revealStep(wallet, c, box); };
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

  if (wallet.mnemonic) {
    const positions = pickConfirmationPositions(25, 3,
      () => (globalThis.crypto ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 : Math.random()));
    confirmStep(wallet, c, box, positions);
  } else {
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
    finishGenerate(wallet, c);
  };
}

function ackStep(wallet, c, box) {
  const gate = el('div', 'wiz-field'); gate.style.marginTop = '10px';
  gate.innerHTML = `<label class="wiz-lab"><input type="checkbox" class="w-ack"> I have saved my private key offline. I understand it cannot be recovered.</label>`;
  const row = el('div', 'wiz-dl');
  const ok = el('button', 'wiz-btn', '✓ Save this wallet'); ok.disabled = true;
  row.appendChild(ok); gate.appendChild(row); box.appendChild(gate);
  $('.w-ack', gate).addEventListener('change', (e) => { ok.disabled = !e.target.checked; });
  ok.onclick = () => finishGenerate(wallet, c);
}

function finishGenerate(wallet, c) {
  saveAddress(c.key, wallet.address);
  renderCards();
}

// ===========================================================================
// Card wiring: per-card generate / paste / save handlers, delegated from the rendered HTML.
// ===========================================================================
function wireCard(card) {
  const coin = card.getAttribute('data-coin');
  const pasteBox = $('.w-paste', card);
  const genBox = $('.w-gen', card);
  const addrIn = $('.w-paste input', card);
  const addrMsg = $('.w-paste .wiz-msg', card);

  const validate = () => {
    const a = (addrIn.value || '').trim();
    const prof = resolveCoin(coin);
    if (!a) { addrMsg.textContent = ''; addrMsg.className = 'wiz-msg'; return false; }
    const v = prof ? validateAddress(prof, a) : { ok: true };
    if (v.ok) { addrMsg.textContent = '✓ looks like a valid address'; addrMsg.className = 'wiz-msg ok'; return true; }
    addrMsg.textContent = '✗ ' + v.reason; addrMsg.className = 'wiz-msg bad'; return false;
  };
  addrIn.addEventListener('input', validate);

  card.querySelectorAll('[data-act]').forEach((btn) => {
    const act = btn.getAttribute('data-act');
    if (act === 'generate') btn.onclick = () => { pasteBox.classList.add('hidden'); runGenerate(coin, genBox); };
    if (act === 'paste') btn.onclick = () => {
      genBox.classList.add('hidden'); genBox.innerHTML = '';
      pasteBox.classList.toggle('hidden');
      if (!pasteBox.classList.contains('hidden')) addrIn.focus();
    };
    if (act === 'paste-save') btn.onclick = () => {
      if (!validate()) { addrIn.focus(); return; }
      saveAddress(coin, addrIn.value.trim());
      addrIn.value = ''; addrMsg.textContent = '';
      pasteBox.classList.add('hidden');
      renderCards();
    };
  });
}

// Render one card per supported coin, merged with whatever the shared data layer already has.
async function renderCards() {
  const host = $('#wallet-cards');
  if (!host) return;
  let byCoin = {};
  try {
    const view = await buildMyCoinsView(store());
    for (const g of view.coins) byCoin[g.coin] = g;
  } catch (e) { byCoin = {}; }

  host.innerHTML = Object.keys(WALLET_COINS).map((k) => walletCardHtml(k, byCoin[k])).join('');
  host.querySelectorAll('.card[data-coin]').forEach(wireCard);
}

// ---- theme toggle (same pattern as the other pool pages) ----
function setupTheme() {
  if (typeof document === 'undefined') return;
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
}

// ---- boot ----
if (typeof document !== 'undefined') {
  const boot = () => { setupTheme(); setupSpendToggle(); renderCards(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
