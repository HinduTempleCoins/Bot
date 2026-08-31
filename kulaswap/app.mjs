// app.mjs — KulaSwap swap UI logic. Framework-free. esc() all dynamic text. The PURE helpers
// (slippage/deadline/path/quote) are exported + offline-tested. The wallet + contract calls
// lazy-load ethers from a CDN INSIDE the browser-only functions, so importing this module in a
// node test never touches the network and the DOM wiring (guarded at the bottom) never runs.
//
// EVM-only for now: chainReady() chains swap; non-EVM (TRON/EOS/Solana/…) are shown but disabled
// until their adapters ship. Non-custodial: every swap is confirmed in the user's own wallet.

import { quoteSwap } from './kula-quote.mjs';
import { CHAINS, DEFAULT_CHAIN, ROUTER_ABI, FACTORY_ABI, PAIR_ABI, ERC20_ABI, isNative, chainReady, allChains } from './kula-config.mjs';
import { mountPanels, cdpWiring, stakeWiring } from './dex-panels.mjs';
import { cdpMarketLive, veLive } from './kula-config-addresses.mjs';

const SECONDS_PER_WEEK = 7 * 24 * 60 * 60;
// The swap tab defaults to PRANA MAINNET (chainId 712217) — the live AMM + 4 seeded pairs. The CDP +
// veKULA contracts are on the same mainnet; Borrow/Stake txs are built for 712217 and the wallet is
// switched to it per action.
const MAINNET_KEY = 'prana-mainnet';

/** Deterministic accent colour for a token symbol (for the little token dot). Pure + exported. */
export function tokenColor(symbol) {
  const s = String(symbol || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `radial-gradient(circle at 32% 30%, hsl(${h} 70% 62%), hsl(${(h + 40) % 360} 60% 32%))`;
}

/** Classify a price impact fraction (0.012 = 1.2%) into a severity class. Pure + exported. */
export function impactClass(frac) {
  const p = Math.abs(Number(frac) || 0);
  if (p < 0.01) return 'imp-lo';
  if (p < 0.05) return 'imp-mid';
  return 'imp-hi';
}

const fmtNum = (n, d = 6) => {
  const x = Number(n);
  if (!Number.isFinite(x) || x === 0) return '0';
  if (Math.abs(x) >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(Number(x.toPrecision(d)));
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── PURE helpers (offline-tested) ───────────────────────────────────────────────────────────────
/** slippage % (e.g. 0.5) → basis points (50), clamped to [0, 5000] (0–50%). */
export function slippageBps(pct) {
  const n = Number.parseFloat(pct);
  if (!Number.isFinite(n) || n < 0) return 50;          // default 0.5%
  return Math.min(5000, Math.round(n * 100));
}

/** amountOut (BigInt, on-chain exact) minus slippage → minimum received (BigInt). */
export function applySlippage(amountOut, bps) {
  const a = typeof amountOut === 'bigint' ? amountOut : BigInt(Math.trunc(Number(amountOut) || 0));
  const b = BigInt(Math.max(0, Math.min(10000, Number(bps) | 0)));
  return (a * (10000n - b)) / 10000n;
}

/** unix deadline `minutes` from `nowSec` (default now). */
export function deadlineFrom(nowSec, minutes = 20) {
  const base = Number.isFinite(+nowSec) ? Math.floor(+nowSec) : 0;
  return base + Math.max(1, Math.floor(minutes)) * 60;
}

/** Router swap path; routes through wnative when one leg is the native coin. */
export function buildPath(chain, tokenIn, tokenOut) {
  const inAddr = isNative(chain, tokenIn) ? chain.wnative : tokenIn.address;
  const outAddr = isNative(chain, tokenOut) ? chain.wnative : tokenOut.address;
  if (inAddr === outAddr) return [inAddr];
  return [inAddr, outAddr];
}

/** Off-chain estimate for the UI (the on-chain getAmountsOut is the source of truth at swap time). */
export function estimate({ amountIn, reserveIn, reserveOut, feeBps }) {
  return quoteSwap({ amountIn, reserveIn, reserveOut, feeBps });
}

// ── browser-only: lazy ethers + DOM wiring ──────────────────────────────────────────────────────
let _ethers = null;
async function getEthers() {
  if (_ethers) return _ethers;
  _ethers = await import('https://esm.sh/ethers@6');   // browser only
  return _ethers;
}

function mount(doc = document) {
  const $ = (id) => doc.getElementById(id);
  const tinSel = $('token-in'), toutSel = $('token-out');
  const amtIn = $('amount-in'), amtOut = $('amount-out'), swapBtn = $('swap'), connectBtn = $('connect');
  const connectLbl = $('connect-lbl'), statusEl = $('status'), chainNote = $('chain-note');
  const chainName = $('chain-name'), chainDex = $('chain-dex'), slipEl = $('slippage'), dlEl = $('deadline');
  const dotIn = $('dot-in'), dotOut = $('dot-out'), balIn = $('bal-in'), maxIn = $('max-in');
  const rateEl = $('rate'), refreshBtn = $('refresh'), gearBtn = $('gear'), settings = $('settings');
  const details = $('details'), dRate = $('d-rate'), dImpact = $('d-impact'), dMin = $('d-minout'), dFee = $('d-fee'), dRoute = $('d-route');
  const sPrice = $('s-price'), sTvl = $('s-tvl'), sFee = $('s-fee');
  let provider = null, signer = null, account = null;
  let chain = CHAINS[DEFAULT_CHAIN];
  let reserves = null; // { resIn, resOut } for the current pair (for panels/stats)
  let balances = {};   // symbol → human balance string

  const note = (el, kind, msg) => { if (!el) return; el.className = msg ? `note ${kind}` : ''; el.textContent = msg || ''; };

  function fillTokens() {
    const toks = chain.tokens || [{ symbol: chain.native.symbol, address: 'native', decimals: chain.native.decimals }];
    const opts = toks.map((t, i) => `<option value="${i}">${esc(t.symbol)}</option>`).join('');
    tinSel.innerHTML = opts; toutSel.innerHTML = opts;
    if (toks.length > 1) toutSel.value = '1';
    paintDots();
  }
  function curTokens() {
    const toks = chain.tokens || [{ symbol: chain.native.symbol, address: 'native', decimals: chain.native.decimals }];
    return { tin: toks[+tinSel.value] || toks[0], tout: toks[+toutSel.value] || toks[0] };
  }
  function paintDots() {
    const { tin, tout } = curTokens();
    if (dotIn) dotIn.style.background = tokenColor(tin.symbol);
    if (dotOut) dotOut.style.background = tokenColor(tout.symbol);
  }

  function onChainChange() {
    fillTokens(); reserves = null; amtOut.value = '';
    if (chainName) chainName.textContent = chain.name;
    if (chainDex) chainDex.textContent = chain.dex;
    if (sFee) sFee.textContent = `${(chain.feeBps / 100).toFixed(2)}%`;
    if (sPrice) sPrice.textContent = '—';
    if (sTvl) sTvl.textContent = '—';
    if (chain.type !== 'evm') note(chainNote, 'warn', `${chain.name} support is coming — ${esc(chain.dex)} needs its ${esc(chain.type)} adapter.`);
    else if (!chainReady(chain)) note(chainNote, 'warn', `${chain.name}: router addresses not yet verified — swap disabled (a wrong address loses funds).`);
    else note(chainNote, '', '');
    refreshSwapBtn();
  }

  function refreshSwapBtn() {
    if (!account) { swapBtn.disabled = true; swapBtn.textContent = 'Connect a wallet'; return; }
    if (!chainReady(chain)) { swapBtn.disabled = true; swapBtn.textContent = `${chain.name} not enabled`; return; }
    const a = Number.parseFloat(amtIn.value);
    swapBtn.disabled = !(a > 0);
    swapBtn.textContent = a > 0 ? 'Swap' : 'Enter an amount';
  }

  function showRate(msg, spinning) {
    if (!rateEl) return;
    rateEl.firstElementChild.innerHTML = msg || '';
    if (refreshBtn) refreshBtn.classList.toggle('spin', !!spinning);
  }
  function clearDetails() {
    if (details) details.hidden = true;
    showRate('', false);
  }

  async function refreshQuote() {
    refreshSwapBtn();
    const a = Number.parseFloat(amtIn.value);
    if (!(a > 0) || !chainReady(chain)) { amtOut.value = ''; clearDetails(); return; }
    showRate('Fetching best price…', true);
    try {
      const { ethers } = { ethers: await getEthers() };
      const { tin, tout } = curTokens();
      const ro = provider || new ethers.JsonRpcProvider(chain.rpcUrl);
      const factory = new ethers.Contract(chain.factory, FACTORY_ABI, ro);
      const path = buildPath(chain, tin, tout);
      const pairAddr = await factory.getPair(path[0], path[path.length - 1]);
      if (pairAddr === ethers.ZeroAddress) { note(statusEl, 'warn', 'No liquidity pool for this pair yet.'); amtOut.value = ''; clearDetails(); return; }
      const pair = new ethers.Contract(pairAddr, PAIR_ABI, ro);
      const [r0, r1] = await pair.getReserves();
      const token0 = (await pair.token0()).toLowerCase();
      const inIs0 = path[0].toLowerCase() === token0;
      const resIn = Number(ethers.formatUnits(inIs0 ? r0 : r1, tin.decimals));
      const resOut = Number(ethers.formatUnits(inIs0 ? r1 : r0, tout.decimals));
      reserves = { resIn, resOut };
      const q = estimate({ amountIn: a, reserveIn: resIn, reserveOut: resOut, feeBps: chain.feeBps });
      amtOut.value = q.amountOut ? q.amountOut.toPrecision(8) : '';
      // rate + details
      const rate = a > 0 ? q.amountOut / a : 0;
      showRate(`1 ${esc(tin.symbol)} ≈ <span class="v">${fmtNum(rate)} ${esc(tout.symbol)}</span>`, false);
      if (sPrice) sPrice.textContent = `${fmtNum(rate, 4)} ${esc(tout.symbol)}`;
      if (sTvl) sTvl.textContent = `${fmtNum(resOut, 4)} ${esc(tout.symbol)}`;
      const bps = slippageBps(slipEl.value);
      const minOut = q.amountOut * (1 - bps / 10000);
      if (details) {
        details.hidden = false;
        dRate.textContent = `1 ${tin.symbol} = ${fmtNum(rate)} ${tout.symbol}`;
        dImpact.textContent = `${(q.priceImpact * 100).toFixed(2)}%`;
        dImpact.className = `v ${impactClass(q.priceImpact)}`;
        dMin.textContent = `${fmtNum(minOut)} ${tout.symbol}`;
        dFee.textContent = `${(chain.feeBps / 100).toFixed(2)}%`;
        dRoute.textContent = path.length > 1 ? `${tin.symbol} → ${tout.symbol}` : tin.symbol;
      }
      note(statusEl, '', '');
    } catch (e) { note(statusEl, 'err', `Quote failed: ${esc((e && e.message) || e)}`); clearDetails(); }
  }

  function flip() {
    const iv = tinSel.value, ov = toutSel.value;
    tinSel.value = ov; toutSel.value = iv;
    amtIn.value = amtOut.value && amtOut.value !== '0' ? amtOut.value : amtIn.value;
    paintDots(); refreshBalances(); refreshQuote();
  }

  async function refreshBalances() {
    if (!account || !provider) { if (maxIn) maxIn.hidden = true; return; }
    try {
      const { ethers } = { ethers: await getEthers() };
      const { tin } = curTokens();
      let human;
      if (isNative(chain, tin)) { human = ethers.formatUnits(await provider.getBalance(account), tin.decimals); }
      else {
        const erc = new ethers.Contract(tin.address, ERC20_ABI, provider);
        human = ethers.formatUnits(await erc.balanceOf(account), tin.decimals);
      }
      balances[tin.symbol] = human;
      if (balIn) balIn.textContent = `Balance: ${fmtNum(human, 6)} ${esc(tin.symbol)}`;
      if (maxIn) maxIn.hidden = !(Number(human) > 0);
    } catch { if (balIn) balIn.textContent = 'Balance: —'; if (maxIn) maxIn.hidden = true; }
  }

  async function connect() {
    try {
      if (!window.ethereum) { note(statusEl, 'err', 'No EVM wallet found. Install MetaMask (or any injected wallet).'); return; }
      const { ethers } = { ethers: await getEthers() };
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      signer = await provider.getSigner();
      account = await signer.getAddress();
      if (connectLbl) connectLbl.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
      connectBtn.classList.add('connected');
      unlockCtas();
      await ensureChain();
      refreshBalances(); refreshSwapBtn(); refreshQuote();
    } catch (e) { note(statusEl, 'err', `Connect failed: ${esc((e && e.message) || e)}`); }
  }

  function unlockCtas() {
    // Pool/Farm remain interactive calculators (no on-chain add-liquidity wiring yet).
    [['lp-cta', 'Add liquidity'], ['farm-cta', 'Stake LP']].forEach(([id, label]) => {
      const b = $(id); if (b) { b.disabled = false; b.textContent = label; }
    });
    // Borrow (CDP) + Stake (veKULA) are LIVE on PRANA mainnet — enable only when the address guard passes;
    // a zero address (not deployed) must read "not live" and never build a tx.
    const cdpBtn = $('cdp-cta');
    if (cdpBtn) {
      if (cdpMarketLive()) { cdpBtn.disabled = false; cdpBtn.textContent = 'Approve & Borrow'; }
      else { cdpBtn.disabled = true; cdpBtn.textContent = 'Borrow not live yet'; }
    }
    const stakeBtn = $('stake-cta');
    if (stakeBtn) {
      if (veLive()) { stakeBtn.disabled = false; stakeBtn.textContent = 'Approve & Lock'; }
      else { stakeBtn.disabled = true; stakeBtn.textContent = 'Staking not live yet'; }
    }
  }

  // ── mainnet DeFi actions (Borrow / Stake) — client-side signed, keyless ─────────────────────────
  /** Switch the wallet to PRANA mainnet (712217) and refresh provider+signer against it. */
  async function ensureMainnet() {
    const mc = CHAINS[MAINNET_KEY];
    const { ethers } = { ethers: await getEthers() };
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: mc.chainIdHex }] }); }
    catch (e) {
      if (e && e.code === 4902) {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: mc.chainIdHex, chainName: `${mc.name} (mainnet)`, rpcUrls: [mc.rpcUrl],
          nativeCurrency: mc.native, blockExplorerUrls: [mc.explorer] }] });
      } else throw e;
    }
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    account = await signer.getAddress();
  }

  /** Sign+broadcast one unsigned descriptor {to,data,value} via the user's wallet; wait for it. */
  async function sendDescriptor(d) {
    const tx = await signer.sendTransaction({ to: d.to, data: d.data, value: d.value || '0x0' });
    await tx.wait();
    return tx;
  }

  /** Ensure `spender` may pull `amountUnits` of `token`; approve (max needed) if the allowance is short. */
  async function ensureAllowance(token, spender, amountUnits, approveDescriptorFor, statusEl) {
    const { ethers } = { ethers: await getEthers() };
    const erc = new ethers.Contract(token, ERC20_ABI, signer);
    let allow = 0n;
    try { allow = await erc.allowance(account, spender); } catch { allow = 0n; }
    if (allow >= amountUnits) return;
    note(statusEl, 'warn', 'Approve KULA in your wallet…');
    await sendDescriptor(approveDescriptorFor(amountUnits.toString()));
  }

  async function doBorrow() {
    const cdpStatus = $('cdp-status');
    const w = cdpWiring();
    if (!w.live) { note(cdpStatus, 'warn', 'The borrow market is not live yet.'); return; }
    if (!signer || !account) { note(cdpStatus, 'err', 'Connect a wallet first.'); return; }
    const coll = Number.parseFloat(($('cdp-coll') || {}).value);
    const debt = Number.parseFloat(($('cdp-debt') || {}).value);
    if (!(coll > 0)) { note(cdpStatus, 'warn', 'Enter an amount of KULA to lock.'); return; }
    try {
      const { ethers } = { ethers: await getEthers() };
      note(cdpStatus, 'warn', 'Switch to PRANA mainnet in your wallet…');
      await ensureMainnet();
      const collUnits = ethers.parseUnits(String(coll), 18);
      await ensureAllowance(w.collateral, w.vault, collUnits, w.approveCollateral, cdpStatus);
      note(cdpStatus, 'warn', 'Confirm the deposit (lock KULA)…');
      await sendDescriptor(w.deposit(collUnits.toString()));
      if (debt > 0) {
        const debtUnits = ethers.parseUnits(String(debt), 18);
        note(cdpStatus, 'warn', 'Confirm the borrow (mint mMELEK)…');
        await sendDescriptor(w.borrow(debtUnits.toString()));
        note(cdpStatus, 'ok', `Locked ${coll} KULA · borrowed ${debt} mMELEK.`);
      } else {
        note(cdpStatus, 'ok', `Locked ${coll} KULA. Enter an mMELEK amount to borrow.`);
      }
    } catch (e) { note(cdpStatus, 'err', `Borrow failed: ${esc((e && e.shortMessage) || (e && e.message) || e)}`); }
  }

  async function doStake() {
    const stakeStatus = $('stake-status');
    const w = stakeWiring();
    if (!w.live) { note(stakeStatus, 'warn', 'Staking is not live yet.'); return; }
    if (!signer || !account) { note(stakeStatus, 'err', 'Connect a wallet first.'); return; }
    const amt = Number.parseFloat(($('stake-amt') || {}).value);
    const weeks = Number.parseFloat(($('stake-weeks') || {}).value);
    if (!(amt > 0)) { note(stakeStatus, 'warn', 'Enter an amount of KULA to lock.'); return; }
    if (!(weeks > 0)) { note(stakeStatus, 'warn', 'Enter a lock length (1–208 weeks).'); return; }
    try {
      const { ethers } = { ethers: await getEthers() };
      const durSec = Math.min(Math.floor(weeks * SECONDS_PER_WEEK), w.maxLockSeconds);
      note(stakeStatus, 'warn', 'Switch to PRANA mainnet in your wallet…');
      await ensureMainnet();
      const amtUnits = ethers.parseUnits(String(amt), 18);
      await ensureAllowance(w.kula, w.veKula, amtUnits, w.approve, stakeStatus);
      note(stakeStatus, 'warn', 'Confirm the lock in your wallet…');
      await sendDescriptor(w.lock(amtUnits.toString(), durSec));
      note(stakeStatus, 'ok', `Locked ${amt} KULA for ${Math.round(weeks)} weeks → veKULA.`);
    } catch (e) { note(stakeStatus, 'err', `Lock failed: ${esc((e && e.shortMessage) || (e && e.message) || e)}`); }
  }

  async function ensureChain() {
    if (!provider || chain.type !== 'evm') return;
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.chainIdHex }] }); }
    catch (e) {
      if (e && e.code === 4902) {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: chain.chainIdHex, chainName: chain.name, rpcUrls: [chain.rpcUrl],
          nativeCurrency: chain.native, blockExplorerUrls: [chain.explorer] }] });
      }
    }
  }

  async function doSwap() {
    if (!signer || !chainReady(chain)) return;
    try {
      const { ethers } = { ethers: await getEthers() };
      await ensureChain();
      const { tin, tout } = curTokens();
      const path = buildPath(chain, tin, tout);
      const amountIn = ethers.parseUnits(String(amtIn.value), tin.decimals);
      const router = new ethers.Contract(chain.router, ROUTER_ABI, signer);
      const amounts = await router.getAmountsOut(amountIn, path);          // on-chain source of truth
      const minOut = applySlippage(amounts[amounts.length - 1], slippageBps(slipEl.value));
      // approve if the input is an ERC20 (native handled by swapExactETH* in a fuller build)
      if (!isNative(chain, tin)) {
        const erc = new ethers.Contract(tin.address, ERC20_ABI, signer);
        const allow = await erc.allowance(account, chain.router);
        if (allow < amountIn) { note(statusEl, 'warn', 'Approve the token in your wallet…'); await (await erc.approve(chain.router, amountIn)).wait(); }
      }
      const mins = Math.max(1, Number.parseInt(dlEl && dlEl.value, 10) || 20);
      note(statusEl, 'warn', 'Confirm the swap in your wallet…');
      const tx = await router.swapExactTokensForTokens(amountIn, minOut, path, account, deadlineFrom(Math.floor(Date.now() / 1000), mins));
      note(statusEl, 'warn', `Swapping… ${esc(tx.hash.slice(0, 10))}`);
      await tx.wait();
      note(statusEl, 'ok', `Swapped! ${chain.explorer}/tx/${tx.hash}`);
      refreshBalances(); refreshQuote();
    } catch (e) { note(statusEl, 'err', `Swap failed: ${esc((e && e.shortMessage) || (e && e.message) || e)}`); }
  }

  // ── tabs ──
  function selectTab(name) {
    doc.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    doc.querySelectorAll('.pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  }
  doc.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));

  // ── settings popover ──
  if (gearBtn && settings) {
    gearBtn.addEventListener('click', (e) => { e.stopPropagation(); settings.hidden = !settings.hidden; });
    doc.addEventListener('click', (e) => { if (!settings.hidden && !settings.contains(e.target) && e.target !== gearBtn) settings.hidden = true; });
    doc.querySelectorAll('#slip-presets .preset[data-slip]').forEach((b) => b.addEventListener('click', () => {
      doc.querySelectorAll('#slip-presets .preset').forEach((x) => x.classList.remove('on'));
      b.classList.add('on'); slipEl.value = b.dataset.slip; refreshQuote();
    }));
    slipEl.addEventListener('input', () => { doc.querySelectorAll('#slip-presets .preset[data-slip]').forEach((x) => x.classList.remove('on')); refreshQuote(); });
  }

  // panels (Pool / Farm / Borrow calculators) — real math from the CDP/farm/pool models
  mountPanels(doc, { getReserves: () => (reserves ? { reservesKula: reserves.resIn, reservesWmelek: reserves.resOut } : {}) });

  onChainChange();
  [tinSel, toutSel].forEach((s) => s.addEventListener('change', () => { paintDots(); refreshBalances(); refreshQuote(); }));
  amtIn.addEventListener('input', refreshQuote);
  if (maxIn) maxIn.addEventListener('click', () => { const b = balances[curTokens().tin.symbol]; if (b) { amtIn.value = b; refreshQuote(); } });
  if ($('flip')) $('flip').addEventListener('click', flip);
  if (refreshBtn) refreshBtn.addEventListener('click', refreshQuote);
  connectBtn.addEventListener('click', connect);
  swapBtn.addEventListener('click', doSwap);

  // Borrow / Stake transactional CTAs (mainnet CDP + veKULA).
  const cdpCta = $('cdp-cta'); if (cdpCta) cdpCta.addEventListener('click', doBorrow);
  const stakeCta = $('stake-cta'); if (stakeCta) stakeCta.addEventListener('click', doStake);
  // Reflect the zero-address guard even before connect: a not-live market never offers a live button.
  if (cdpCta && !cdpMarketLive()) { cdpCta.disabled = true; cdpCta.textContent = 'Borrow not live yet'; }
  if (stakeCta && !veLive()) { stakeCta.disabled = true; stakeCta.textContent = 'Staking not live yet'; }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
  else mount();
}
