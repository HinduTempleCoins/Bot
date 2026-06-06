// SoapBox pool — "Mine right now in your browser" UI glue.
//
// Wires the top-of-page browser-mining card to the BrowserMiner controller (miner.mjs),
// which talks Monero stratum to the pool over the WSS /ws bridge and runs real RandomX in
// Web Workers (miner-worker.mjs). Address validation reuses the wizard module so the field
// behaves like every other address field on the page.

import { BrowserMiner } from './miner.mjs';
import { validateAddress, poolLoginAddress } from './wizard.mjs';
import { MyCoinsStore } from './mycoins.mjs';

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

  const validate = () => {
    const a = (addrIn.value || '').trim();
    if (!a) { addrMsg.textContent = ''; addrMsg.className = 'wiz-msg'; return false; }
    const v = validateAddress('monero', a);
    if (v.ok) { addrMsg.textContent = '✓ looks like a valid Monero address'; addrMsg.className = 'wiz-msg ok'; return true; }
    addrMsg.textContent = '✗ ' + v.reason; addrMsg.className = 'wiz-msg bad'; return false;
  };
  addrIn.addEventListener('input', validate);

  // wallet-first: fill the address from the user's own in-browser wallet (or offer to make one)
  if (prefillFromWallet(addrIn)) validate();

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
    // The pool's Monero side is STAGENET while we test; the wallet makes mainnet
    // addresses. Log in with the stagenet twin (same keys) so the pool accepts it.
    const { address, converted } = poolLoginAddress('monero', addrIn.value);
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
