// app.mjs — KulaSwap swap UI logic. Framework-free. esc() all dynamic text. The PURE helpers
// (slippage/deadline/path/quote) are exported + offline-tested. The wallet + contract calls
// lazy-load ethers from a CDN INSIDE the browser-only functions, so importing this module in a
// node test never touches the network and the DOM wiring (guarded at the bottom) never runs.
//
// EVM-only for now: chainReady() chains swap; non-EVM (TRON/EOS/Solana/…) are shown but disabled
// until their adapters ship. Non-custodial: every swap is confirmed in the user's own wallet.

import { quoteSwap } from './kula-quote.mjs';
import { CHAINS, DEFAULT_CHAIN, ROUTER_ABI, FACTORY_ABI, PAIR_ABI, ERC20_ABI, isNative, chainReady, allChains } from './kula-config.mjs';

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
  const chainSel = $('chain'), tinSel = $('token-in'), toutSel = $('token-out');
  const amtIn = $('amount-in'), amtOut = $('amount-out'), swapBtn = $('swap'), connectBtn = $('connect');
  const statusEl = $('status'), chainNote = $('chain-note'), impactEl = $('impact'), minoutEl = $('minout'),
    feeLine = $('fee-line'), balIn = $('bal-in'), slipEl = $('slippage');
  let provider = null, signer = null, account = null;
  let chain = CHAINS[DEFAULT_CHAIN];
  let reserves = null; // {reserveIn, reserveOut, decIn, decOut}

  const note = (el, kind, msg) => { el.className = msg ? `note ${kind}` : ''; el.textContent = msg || ''; };

  function fillChains() {
    chainSel.innerHTML = allChains().map((c) =>
      `<option value="${esc(c.key)}">${esc(c.name)} · ${esc(c.dex)}${chainReady(c) ? '' : c.type === 'evm' ? ' (verify)' : ' (soon)'}</option>`).join('');
    chainSel.value = chain.key;
  }
  function fillTokens() {
    const toks = chain.tokens || [{ symbol: chain.native.symbol, address: 'native', decimals: chain.native.decimals }];
    const opts = toks.map((t, i) => `<option value="${i}">${esc(t.symbol)}</option>`).join('');
    tinSel.innerHTML = opts; toutSel.innerHTML = opts;
    if (toks.length > 1) toutSel.value = '1';
  }
  function curTokens() {
    const toks = chain.tokens || [{ symbol: chain.native.symbol, address: 'native', decimals: chain.native.decimals }];
    return { tin: toks[+tinSel.value] || toks[0], tout: toks[+toutSel.value] || toks[0] };
  }

  function onChainChange() {
    chain = CHAINS[chainSel.value] || chain;
    fillTokens(); reserves = null; amtOut.value = '';
    feeLine.textContent = `fee ${(chain.feeBps / 100).toFixed(2)}%`;
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

  async function refreshQuote() {
    refreshSwapBtn();
    const a = Number.parseFloat(amtIn.value);
    if (!(a > 0) || !chainReady(chain)) { amtOut.value = ''; impactEl.textContent = 'price impact: —'; minoutEl.textContent = 'min received: —'; return; }
    try {
      const { ethers } = { ethers: await getEthers() };
      const { tin, tout } = curTokens();
      const ro = provider || new ethers.JsonRpcProvider(chain.rpcUrl);
      const factory = new ethers.Contract(chain.factory, FACTORY_ABI, ro);
      const path = buildPath(chain, tin, tout);
      const pairAddr = await factory.getPair(path[0], path[path.length - 1]);
      if (pairAddr === ethers.ZeroAddress) { note(statusEl, 'warn', 'No liquidity pool for this pair yet.'); amtOut.value = ''; return; }
      const pair = new ethers.Contract(pairAddr, PAIR_ABI, ro);
      const [r0, r1] = await pair.getReserves();
      const token0 = (await pair.token0()).toLowerCase();
      const inIs0 = path[0].toLowerCase() === token0;
      const decIn = tin.decimals, decOut = tout.decimals;
      const resIn = Number(ethers.formatUnits(inIs0 ? r0 : r1, decIn));
      const resOut = Number(ethers.formatUnits(inIs0 ? r1 : r0, decOut));
      const q = estimate({ amountIn: a, reserveIn: resIn, reserveOut: resOut, feeBps: chain.feeBps });
      amtOut.value = q.amountOut ? q.amountOut.toPrecision(8) : '';
      impactEl.textContent = `price impact: ${(q.priceImpact * 100).toFixed(2)}%`;
      const bps = slippageBps(slipEl.value);
      minoutEl.textContent = `min received: ${(q.amountOut * (1 - bps / 10000)).toPrecision(6)} ${esc(tout.symbol)}`;
      note(statusEl, '', '');
    } catch (e) { note(statusEl, 'err', `Quote failed: ${esc((e && e.message) || e)}`); }
  }

  async function connect() {
    try {
      if (!window.ethereum) { note(statusEl, 'err', 'No EVM wallet found. Install MetaMask (or any injected wallet).'); return; }
      const { ethers } = { ethers: await getEthers() };
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      signer = await provider.getSigner();
      account = await signer.getAddress();
      connectBtn.textContent = `${account.slice(0, 6)}…${account.slice(-4)}`;
      connectBtn.classList.add('connected');
      await ensureChain();
      refreshSwapBtn(); refreshQuote();
    } catch (e) { note(statusEl, 'err', `Connect failed: ${esc((e && e.message) || e)}`); }
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
      note(statusEl, 'warn', 'Confirm the swap in your wallet…');
      const tx = await router.swapExactTokensForTokens(amountIn, minOut, path, account, deadlineFrom(Math.floor(Date.now() / 1000)));
      note(statusEl, 'warn', `Swapping… ${esc(tx.hash.slice(0, 10))}`);
      await tx.wait();
      note(statusEl, 'ok', `Swapped! ${chain.explorer}/tx/${tx.hash}`);
      refreshQuote();
    } catch (e) { note(statusEl, 'err', `Swap failed: ${esc((e && e.shortMessage) || (e && e.message) || e)}`); }
  }

  fillChains(); onChainChange();
  chainSel.addEventListener('change', () => { onChainChange(); refreshQuote(); });
  [tinSel, toutSel].forEach((s) => s.addEventListener('change', refreshQuote));
  amtIn.addEventListener('input', refreshQuote);
  slipEl.addEventListener('input', refreshQuote);
  connectBtn.addEventListener('click', connect);
  swapBtn.addEventListener('click', doSwap);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount());
  else mount();
}
