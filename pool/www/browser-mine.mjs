// SoapBox pool — "Mine right now in your browser" UI glue.
//
// Wires the top-of-page browser-mining card to the BrowserMiner controller (miner.mjs),
// which talks Monero stratum to the pool over the WSS /ws bridge and runs real RandomX in
// Web Workers (miner-worker.mjs). Address validation reuses the wizard module so the field
// behaves like every other address field on the page.

import { BrowserMiner } from './miner.mjs';
import { validateAddress, poolLoginAddress } from './wizard.mjs';
import { MyCoinsStore } from './mycoins.mjs';
import { mountPicker } from './wallet-picker.mjs';

// The chains relevant to BROWSER mining (RandomX family), ZEPHYR FIRST (operator Addendum
// 23: ZEPH is THE browser/phone coin). The `gated` flag is the STATIC default — overridden
// at runtime by pickBrowserCoin() once we learn from /api/pools whether the ZEPH stratum is
// actually live. While gated, ZEPH's chip informs (wallet ready / make one) rather than
// filling the box, and the miner falls back to Monero.
export const BROWSER_CHAINS = [
  { coin: 'zephyr', symbol: 'ZEPH', name: 'Zephyr', gated: true },
  { coin: 'monero', symbol: 'XMR', name: 'Monero' },
];

// Browser-minable coins in PREFERENCE order (Zephyr first, Monero fallback). Each maps to
// the wizard coin key (for validateAddress / poolLoginAddress) and the /api/pools id used to
// detect live availability. `convert` flags the coins whose pool runs a test-net twin (only
// Monero stagenet today) so the start handler knows to call poolLoginAddress.
export const BROWSER_COINS = [
  { key: 'zephyr', symbol: 'ZEPH', name: 'Zephyr', poolId: 'zeph', convert: false },
  { key: 'monero', symbol: 'XMR', name: 'Monero', poolId: 'xmr-stagenet', convert: true },
];

// Is a given pool object (from /api/pools) actually accepting miners right now? Miningcore /
// the node-pool expose pools with an id + optional poolStats. We treat a pool as live if it
// is present and not explicitly disabled. (A freshly-added-but-still-syncing pool can be
// listed with enabled:false; the ZEPH shim only appears here once its stratum is open.)
function poolIsLive(p) {
  if (!p || typeof p !== 'object') return false;
  if (p.enabled === false) return false;
  return true;
}

/**
 * Decide which coin the browser miner should mine, and whether Zephyr is available yet.
 * PURE — pass the /api/pools array (or null when the API was unreachable).
 *
 * Policy (operator: Zephyr-first, Monero fallback, never break live mining):
 *   - If the ZEPH pool is live in the API → mine Zephyr.
 *   - Otherwise → mine Monero (the always-on fallback), and report ZEPH as still gated so
 *     the UI shows "switching on" rather than offering a dead button.
 *   - If the API is unreachable we cannot confirm ZEPH is live, so we stay on the safe
 *     fallback (Monero) — we never optimistically point the miner at a stratum that may not
 *     be accepting shares.
 *
 * @param {Array|null} pools  the /api/pools list (each item has an `id`/`poolId`)
 * @returns {{ coin: object, zephyrLive: boolean, reason: string }}
 */
export function pickBrowserCoin(pools) {
  const zeph = BROWSER_COINS.find((c) => c.key === 'zephyr');
  const monero = BROWSER_COINS.find((c) => c.key === 'monero');
  const list = Array.isArray(pools) ? pools : [];
  const idOf = (p) => String((p && (p.id || p.poolId)) || '').toLowerCase();
  const zephPool = list.find((p) => idOf(p) === zeph.poolId);
  if (zephPool && poolIsLive(zephPool)) {
    return { coin: zeph, zephyrLive: true, reason: 'zephyr pool is live' };
  }
  return {
    coin: monero,
    zephyrLive: false,
    reason: zephPool ? 'zephyr pool present but not yet accepting' : 'zephyr pool not yet listed',
  };
}

// Fetch /api/pools and resolve the preferred browser coin. Soft-fails to the Monero
// fallback (never throws) so a flaky pool API can never break the live miner.
export async function resolveBrowserCoin(fetchImpl) {
  const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return pickBrowserCoin(null);
  try {
    const r = await f('/api/pools');
    const j = await r.json();
    const pools = (j && (j.pools || j)) || [];
    return pickBrowserCoin(Array.isArray(pools) ? pools : []);
  } catch {
    return pickBrowserCoin(null);
  }
}

// The pool IS the wallet (operator 2026-06-06): never make the user go GET an address —
// auto-fill from the shared My Coins wallet store when one exists, and put "create your
// wallet right here" one click away (/wallet/ writes to the SAME store; a `storage`
// listener live-fills the field when they come back from generating).
export function prefillFromWallet(addrIn, { coin = 'monero', store, doc } = {}) {
  if (!addrIn) return null;
  let s = store;
  if (!s) { try { s = new MyCoinsStore(); } catch { s = null; } }
  const d = doc || (typeof document !== 'undefined' ? document : null);
  const fill = () => {
    if (!s) return null;
    const rec = s.list().find((r) => r.coin === coin && r.address);
    if (rec && !(addrIn.value || '').trim()) { addrIn.value = rec.address; return rec.address; }
    return null;
  };
  const got = fill();
  if (d && !d.getElementById('bm-make-wallet') && addrIn.insertAdjacentElement) {
    const a = d.createElement('a');
    a.id = 'bm-make-wallet';
    a.href = '/wallet/';
    a.textContent = got ? 'Manage your wallet →' : 'No address? The pool makes you one — create your wallet here →';
    a.className = 'wiz-msg';
    addrIn.insertAdjacentElement('afterend', a);
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', () => {
      if (fill() && d) {
        const link = d.getElementById('bm-make-wallet');
        if (link) link.textContent = 'Manage your wallet →';
      }
    });
  }
  return got;
}

const $ = (s) => document.querySelector(s);
// The bridge is fronted by Caddy at wss://<pool host>/ws. On http (local dev) use ws://.
// Computed lazily (inside init) so the module imports cleanly in a non-browser (test) env.
function wsUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function fmtHash(h) {
  h = Number(h) || 0;
  const u = ['H/s', 'KH/s', 'MH/s'];
  let i = 0; while (h >= 1000 && i < u.length - 1) { h /= 1000; i++; }
  return h.toFixed(2) + ' ' + u[i];
}

export function initBrowserMine() {
  const startBtn = $('#bm-start');
  const stopBtn = $('#bm-stop');
  if (!startBtn || !stopBtn) return; // section not present

  const addrIn = $('#bm-addr');
  const addrMsg = $('#bm-addr-msg');
  const throttle = $('#bm-throttle');
  const throttleVal = $('#bm-throttle-val');
  const statusEl = $('#bm-status');
  const hashEl = $('#bm-hashrate');
  const acceptedEl = $('#bm-accepted');
  const threadsEl = $('#bm-threads');

  let miner = null;

  // The active browser-mining coin. Starts on the safe Monero fallback and is upgraded to
  // Zephyr once /api/pools confirms the ZEPH stratum is live (resolveBrowserCoin below).
  // Everything coin-specific (validation, login conversion, save) reads activeCoin.
  let activeCoin = BROWSER_COINS.find((c) => c.key === 'monero');

  const validate = () => {
    const a = (addrIn.value || '').trim();
    if (!a) { addrMsg.textContent = ''; addrMsg.className = 'wiz-msg'; return false; }
    const v = validateAddress(activeCoin.key, a);
    if (v.ok) { addrMsg.textContent = `✓ looks like a valid ${activeCoin.name} address`; addrMsg.className = 'wiz-msg ok'; return true; }
    addrMsg.textContent = '✗ ' + v.reason; addrMsg.className = 'wiz-msg bad'; return false;
  };
  addrIn.addEventListener('input', validate);

  // Reflect the active coin into the radio picker (#bm-coin-pick) + the ZEPH status line.
  // When Zephyr is live we select + enable its radio; otherwise Monero stays selected and
  // the ZEPH row reads "switching on". The picker is informational here — the actual coin is
  // resolved from pool availability — so the radios are kept in sync, not user-authoritative.
  const reflectCoin = (zephyrLive) => {
    const zRadio = document.querySelector('input[name="bm-coin"][value="zephyr"]');
    const mRadio = document.querySelector('input[name="bm-coin"][value="monero"]');
    if (zRadio) { zRadio.disabled = !zephyrLive; zRadio.checked = zephyrLive; }
    if (mRadio) { mRadio.checked = !zephyrLive; }
    const zStatus = document.getElementById('bm-zeph-status');
    if (zStatus && zephyrLive) {
      zStatus.textContent = 'live now — mining to your ZEPH address';
      zStatus.className = 'wiz-msg ok';
    }
  };

  // wallet-first (operator 2026-06-06): the user's saved wallets appear as SELECTABLE chips
  // above the box — returning miners pick instead of re-typing. Chains without a wallet show
  // grey "make this wallet" chips that lead to /wallet/?coin=…; the last-used wallet is
  // remembered and auto-selected next visit.
  {
    let host = document.getElementById('bm-wallets');
    if (!host && addrIn.insertAdjacentElement) {
      host = document.createElement('div');
      host.id = 'bm-wallets';
      addrIn.insertAdjacentElement('beforebegin', host);
    }
    let store = null;
    try { store = new MyCoinsStore(); } catch { store = null; }
    const mounted = host && mountPicker({
      host, input: addrIn, chains: BROWSER_CHAINS, store,
      onPick: () => validate(),
    });
    if (mounted && mounted.model.selected) validate();
    // fallback for any odd environment where the picker can't mount
    if (!mounted && prefillFromWallet(addrIn)) validate();
    // a pasted "own wallet" that actually mines gets saved → it's a chip next visit
    if (mounted) {
      startBtn.addEventListener('click', () => {
        const a = (addrIn.value || '').trim();
        if (a && validateAddress(activeCoin.key, a).ok) mounted.saveOwn(activeCoin.key, a);
      });
    }
  }

  // Resolve the preferred browser coin from pool availability (Zephyr-first, Monero
  // fallback). Soft-fails to Monero; flips the picker to ZEPH live when its stratum opens.
  resolveBrowserCoin().then(({ coin, zephyrLive }) => {
    activeCoin = coin;
    reflectCoin(zephyrLive);
    validate();
  }).catch(() => { /* stay on the Monero fallback */ });

  throttle.addEventListener('input', () => {
    const pct = Number(throttle.value);
    throttleVal.textContent = pct + '%';
    if (miner) miner.setThrottle(pct / 100);
  });

  const onEvent = (e) => {
    switch (e.type) {
      case 'status':
        if (e.state) statusEl.textContent = e.state;
        if (e.threads != null) threadsEl.textContent = String(e.threads);
        break;
      case 'hashrate':
        hashEl.textContent = fmtHash(e.total);
        break;
      case 'accepted':
        acceptedEl.textContent = String(e.accepted);
        break;
      case 'job':
        statusEl.textContent = 'mining (diff ' + e.difficulty + ')';
        break;
      case 'error':
        statusEl.textContent = 'error: ' + (e.message || 'unknown');
        break;
    }
  };

  const setRunningUI = (on) => {
    startBtn.disabled = on;
    stopBtn.disabled = !on;
    addrIn.disabled = on;
  };

  startBtn.addEventListener('click', () => {
    if (!validate()) { addrIn.focus(); return; }
    // The pool's Monero side is STAGENET while we test; the wallet makes mainnet addresses,
    // so we log in with the stagenet twin (same keys). The ZEPH pool is mainnet, so its
    // addresses pass through unchanged. poolLoginAddress is a no-op for non-monero coins,
    // but gate it on activeCoin.convert so the copy below only shows for the stagenet case.
    const { address, converted } = activeCoin.convert
      ? poolLoginAddress(activeCoin.key, addrIn.value)
      : { address: (addrIn.value || '').trim(), converted: false };
    if (converted) {
      addrMsg.textContent = '✓ pool runs Monero stagenet (testing) — mining to your address’s stagenet twin ' + address.slice(0, 8) + '… (same keys, same seed)';
      addrMsg.className = 'wiz-msg ok';
    }
    miner = new BrowserMiner({
      wsUrl: wsUrl(),
      throttle: Number(throttle.value) / 100,
      worker: 'browser',
      onEvent,
    });
    miner.start(address);
    setRunningUI(true);
    statusEl.textContent = 'connecting…';
  });

  stopBtn.addEventListener('click', () => {
    if (miner) { miner.stop(); miner = null; }
    setRunningUI(false);
    statusEl.textContent = 'stopped';
    hashEl.textContent = '0 H/s';
  });

  // Mobile-friendly: pause when the tab is hidden (saves battery/heat), resume on return
  // only if it was running. The worker also self-yields, but stopping the WS is cleaner.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && miner) { miner.setThrottle(0.05); statusEl.textContent = 'paused (tab hidden)'; }
    else if (!document.hidden && miner) { miner.setThrottle(Number(throttle.value) / 100); statusEl.textContent = 'mining'; }
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initBrowserMine);
  else initBrowserMine();
}
