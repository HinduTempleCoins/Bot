// wallet-picker.mjs — "your wallets, right there to select" (operator, 2026-06-06).
//
// Once a user makes (or pastes) a wallet on /wallet/, it lands in the shared My Coins store
// (mycoins.mjs, localStorage). This module turns that store into a row of SELECTABLE chips
// next to every payout-address box, so a returning miner never re-types an address:
//
//   [ ⛏ XMR 4AbC…xYz ]  [ + ZEPH — make this wallet ]
//      ^ saved: click fills the box     ^ greyed: click → /wallet/?coin=zephyr
//
// Chains the user hasn't made a wallet for yet render GREY — a standing prompt that clicking
// takes them to the wallet page to create that wallet. The last wallet they mined with is
// remembered (localStorage) and auto-selected on the next visit.
//
// DESIGN RULES (house style):
//   - The model is PURE (pickerModel) — node --test covers it with no DOM, no localStorage.
//   - DOM work takes an injected `doc`; storage is injected too. Soft-fail everywhere:
//     a broken store renders the make-wallet chips, never throws.
//   - Addresses only — this module never sees or stores private keys (custody boundary).

// ---------------------------------------------------------------------------
// last-used wallet memory (per coin) — why the box "is just there" on return.
// ---------------------------------------------------------------------------
const CHOICE_KEY = 'soapbox.minewallet.v1';

function defaultStorage() {
  return (typeof globalThis !== 'undefined' && globalThis.localStorage) ? globalThis.localStorage : null;
}

/** Read the per-coin last-used map: { monero: '4…', … }. Soft-fails to {}. */
export function lastChoices(storage = defaultStorage()) {
  try {
    const raw = storage ? storage.getItem(CHOICE_KEY) : null;
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

/** Remember that `coin` was last mined to `address`. Soft-fails silently. */
export function rememberChoice(coin, address, storage = defaultStorage()) {
  try {
    if (!storage || !coin || !address) return;
    const m = lastChoices(storage);
    m[String(coin).toLowerCase()] = String(address).trim();
    storage.setItem(CHOICE_KEY, JSON.stringify(m));
  } catch { /* memory is a convenience, never an error */ }
}

// ---------------------------------------------------------------------------
// the pure model
// ---------------------------------------------------------------------------

/** Shorten an address for a chip label: 4AbCdEf…XyZ9. Pure. */
export function shortAddr(a) {
  const s = String(a || '').trim();
  return s.length <= 14 ? s : `${s.slice(0, 7)}…${s.slice(-4)}`;
}

/**
 * Build the picker model. Pure — pass the chains to show and the saved records.
 *
 * @param {object} opts
 * @param {Array<{coin:string, symbol?:string, name?:string, match?:string[]}>} opts.chains
 *        the chains relevant to THIS address box (e.g. browser mining → monero + zephyr).
 *        `match` lists extra store coin-keys that satisfy the chain (e.g. an EVM box is
 *        satisfied by 'ethereum_classic' or a generic 'evm' record).
 * @param {Array<{coin:string, address:string, label?:string}>} [opts.records]  My Coins rows
 * @param {object} [opts.lastUsed]  per-coin last-used map (lastChoices())
 * @returns {{ chips: Array<{coin, symbol, name, address|null, have, selected, href, text}>, selected: object|null }}
 */
export function pickerModel({ chains = [], records = [], lastUsed = {} } = {}) {
  const recs = Array.isArray(records) ? records.filter((r) => r && r.coin && r.address) : [];
  const chips = [];
  for (const ch of chains) {
    if (!ch || !ch.coin) continue;
    const keys = [String(ch.coin).toLowerCase(), ...((ch.match || []).map((k) => String(k).toLowerCase()))];
    const mine = recs.filter((r) => keys.includes(String(r.coin).toLowerCase()));
    const symbol = ch.symbol || ch.coin.toUpperCase();
    const name = ch.name || symbol;
    if (mine.length === 0) {
      chips.push({
        coin: ch.coin, symbol, name, address: null, have: false, gated: !!ch.gated, selected: false,
        href: `/wallet/?coin=${encodeURIComponent(ch.coin)}`,
        text: `+ ${symbol} — make this wallet`,
      });
      continue;
    }
    if (ch.gated) {
      // wallet exists but this chain isn't minable here yet (e.g. ZEPH while its chain
      // syncs): an informational chip, not a fill-the-box pick.
      chips.push({
        coin: ch.coin, symbol, name, address: mine[0].address, have: true, gated: true,
        selected: false, href: null,
        text: `✓ ${symbol} wallet ready — mining opens soon`,
      });
      continue;
    }
    const last = lastUsed[String(ch.coin).toLowerCase()];
    for (const r of mine) {
      chips.push({
        coin: ch.coin, symbol, name, address: r.address, have: true, gated: false,
        selected: !!last && last === r.address,
        href: null,
        text: `⛏ ${symbol} ${shortAddr(r.address)}${r.label ? ` (${r.label})` : ''}`,
      });
    }
  }
  // exactly one selection: the remembered one, else the first saved pickable chip.
  let selected = chips.find((c) => c.selected) || null;
  if (!selected) {
    selected = chips.find((c) => c.have && !c.gated) || null;
    if (selected) selected.selected = true;
  } else {
    chips.forEach((c) => { if (c !== selected) c.selected = false; });
  }
  return { chips, selected };
}

// ---------------------------------------------------------------------------
// DOM renderer + mount glue (injected doc; safe under node --test)
// ---------------------------------------------------------------------------

/**
 * Render the chip row into `host`. Saved chips are buttons (click → onPick(chip));
 * missing chips are grey links to the wallet page. Re-renderable (idempotent).
 */
export function renderPicker(host, model, { doc, onPick, onOwn } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!host || !d || !model) return null;
  host.innerHTML = '';
  host.className = 'wp-row';
  for (const chip of model.chips) {
    if (chip.have && chip.gated) {
      const s = d.createElement('span');
      s.className = 'wp-chip wp-gated';
      s.textContent = chip.text;
      s.title = `Your ${chip.symbol} wallet is saved — this chain joins the miner when it's ready`;
      s.setAttribute('data-coin', chip.coin);
      host.appendChild(s);
    } else if (chip.have) {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'wp-chip' + (chip.selected ? ' wp-sel' : '');
      b.textContent = chip.text;
      b.title = chip.address;
      b.setAttribute('data-coin', chip.coin);
      b.setAttribute('data-address', chip.address);
      b.addEventListener('click', () => { if (onPick) onPick(chip); });
      host.appendChild(b);
    } else {
      const a = d.createElement('a');
      a.className = 'wp-chip wp-missing';
      a.href = chip.href;
      a.textContent = chip.text;
      a.title = `You don't have a ${chip.symbol} wallet yet — click to create one on the wallet page`;
      a.setAttribute('data-coin', chip.coin);
      host.appendChild(a);
    }
  }
  // "Sign into your own wallet" (operator 2026-06-06): always available — creating one with
  // us stays the loud path, but pasting an existing wallet is one click away. The button
  // clears + focuses the address box; an address that actually mines gets SAVED, so next
  // visit it's a regular chip.
  if (onOwn) {
    const b = d.createElement('button');
    b.type = 'button';
    b.className = 'wp-chip wp-own';
    b.textContent = '✎ use my own wallet';
    b.title = 'Paste an address from a wallet you already have — it never leaves your browser except as your mining username';
    b.addEventListener('click', () => onOwn());
    host.appendChild(b);
  }
  return host;
}

/**
 * Mount a picker above an address input: build the model from the live store, render,
 * auto-fill the input with the selected wallet, remember picks, and live-refresh when
 * the wallet page (another tab) adds a wallet (storage event).
 *
 * @param {object} opts
 * @param {Element} opts.host     container to render chips into
 * @param {HTMLInputElement} opts.input  the address box the chips fill
 * @param {Array} opts.chains     as pickerModel
 * @param {{list:Function}} [opts.store]    MyCoinsStore-like (injected in tests)
 * @param {object} [opts.storage] localStorage-like for the last-used memory
 * @param {object} [opts.doc]     document (injected in tests)
 * @param {(chip:object)=>void} [opts.onPick]  extra hook after the input is filled
 * @returns {{ refresh:Function, model:object, saveOwn:Function }|null}
 */
export function mountPicker({ host, input, chains, store, storage, doc, onPick } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!host || !input || !d) return null;
  const stor = storage || defaultStorage();

  const build = () => {
    let records = [];
    try { records = store ? store.list() : []; } catch { records = []; }
    return pickerModel({ chains, records, lastUsed: lastChoices(stor) });
  };

  let model = build();

  const own = () => {
    input.value = '';
    if (input.focus) input.focus();
    if (onPick) onPick(null); // null = "typing their own" — callers may re-validate/clear msgs
  };

  const pick = (chip, { fromUser = true } = {}) => {
    if (!chip || !chip.have) return;
    input.value = chip.address;
    if (fromUser) rememberChoice(chip.coin, chip.address, stor);
    model.chips.forEach((c) => { c.selected = c === chip; });
    renderPicker(host, model, { doc: d, onPick: (c) => pick(c), onOwn: own });
    if (onPick) onPick(chip);
  };

  renderPicker(host, model, { doc: d, onPick: (c) => pick(c), onOwn: own });

  // auto-fill on load: the remembered (or only) wallet is "just there" — but never
  // overwrite something the user already typed.
  if (model.selected && !(input.value || '').trim()) pick(model.selected, { fromUser: false });

  const refresh = () => {
    if (host.isConnected === false) return; // a re-mounted page replaced this picker — stand down
    model = build();
    renderPicker(host, model, { doc: d, onPick: (c) => pick(c), onOwn: own });
    if (model.selected && !(input.value || '').trim()) pick(model.selected, { fromUser: false });
  };

  /**
   * Persist a pasted "own wallet" address into the store (called by the page when the
   * address is actually USED, e.g. mining starts) — it becomes a chip on the next visit.
   */
  const saveOwn = (coin, address) => {
    const a = String(address || '').trim();
    if (!a || !store || !store.add) return false;
    try {
      const already = store.list().some((r) => r.address === a);
      if (!already) store.add({ coin, address: a, label: 'my wallet' });
      rememberChoice(coin, a, stor);
      refresh();
      return true;
    } catch { return false; }
  };

  // live-refresh when a wallet is created in another tab (/wallet/ writes the same store)
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', refresh);
  }

  return { refresh, saveOwn, get model() { return model; } };
}
