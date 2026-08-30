// apishash-panel.mjs — the "APIS-Hash" panel + guidepost for the SoapBox mining pool.
//
// The pool is where hashers already are, so it is the natural place to surface the OTHER lane of
// the "chain-is-the-pool see-saw": raw hashing (what the miner above is doing) vs. APIS-Hash
// (locked-position mining). This panel is a READ-ONLY display + links:
//
//   • It shows a connected/entered MELEK account its soulbound APIS-Hash balance, its earned APIS,
//     and (from the WorkerBee) its share of total APIS-Hash.
//   • If the account holds 0 APIS-Hash, it becomes a GUIDEPOST: plain-language call-to-action that
//     you can also mine APIS by forever-locking wMELEK → APIS-Hash, with the honest
//     PERMANENT / non-redeemable warning, linking to the Yield Farm hub's forever-lock step and
//     the dev docs. It does NOT rebuild the lock flow — it links to it (site/farm, PR #822).
//
// House style: framework-free, esc() EVERYTHING before innerHTML, injectable fetch for offline
// tests, soft-fail-never-throw (an unreachable engine yields an honest empty state, never a fake
// number). NO keys, NO signing, NO broadcasting — the pool never touches value here.
//
// Engine reads point at the MAINNET engine when configured / reachable, else the live TESTNET
// engine. The base is env-configurable for the static page via window.__ENGINE_API (an inline
// <script> in index.html), and both a mainnet and a testnet base are tried in turn.

// The forever-lock action lives in the guided Yield Farm hub; #apis-panel is its lock step.
export const FARM_LOCK_URL = 'https://farm.soapbox.community/#apis-panel';
export const DEV_DOCS_URL = 'https://witness.melek.salon/dev';
export const MAINNET_ENGINE = 'https://engine.melek.salon';
export const TESTNET_ENGINE = 'https://engine.alpha.melek.salon';
export const HASH_SYMBOL = 'APIS-HASH';
export const APIS_SYMBOL = 'APIS';
export const ACCOUNT_KEY = 'sb-melek-account'; // localStorage convenience key

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (m) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

// The ordered list of engine bases to try: a configured/mainnet base first, then the testnet as a
// fallback. window.__ENGINE_API (if set) takes the first slot.
export function engineBases(win = (typeof window !== 'undefined' ? window : undefined)) {
  const configured = win && typeof win.__ENGINE_API === 'string' && win.__ENGINE_API.trim()
    ? win.__ENGINE_API.trim().replace(/\/$/, '')
    : null;
  const bases = [];
  if (configured) bases.push(configured);
  if (!bases.includes(MAINNET_ENGINE)) bases.push(MAINNET_ENGINE);
  if (!bases.includes(TESTNET_ENGINE)) bases.push(TESTNET_ENGINE);
  return bases;
}

// Normalise "@alice" / " Alice " -> "alice".
export function cleanAccount(s) {
  return String(s || '').trim().replace(/^@/, '').toLowerCase();
}

// Pull a numeric balance out of a /contracts/balances response (an array of {balance} rows, or a
// bare object/number depending on the engine build). Soft: any surprise -> 0.
export function balanceOf(resp) {
  if (resp == null) return 0;
  if (Array.isArray(resp)) {
    const row = resp[0];
    return row && row.balance != null ? Number(row.balance) || 0 : 0;
  }
  if (typeof resp === 'object') return resp.balance != null ? Number(resp.balance) || 0 : 0;
  return Number(resp) || 0;
}

// Your share of the mined-together APIS-Hash pool, as a fraction in [0,1] (or null if unknown).
export function computeShare(apisHash, totalApisHash) {
  const mine = Number(apisHash) || 0;
  const total = Number(totalApisHash) || 0;
  if (!(total > 0) || !(mine > 0)) return null;
  return Math.min(mine / total, 1);
}

export function formatAmount(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  if (v === 0) return '0';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return String(Math.round(v * 1e6) / 1e6);
}

export function formatSharePct(share) {
  if (share == null) return '—';
  const pct = share * 100;
  if (pct > 0 && pct < 0.001) return '<0.001%';
  return `${(Math.round(pct * 1000) / 1000)}%`;
}

// Read one account's APIS-Hash position from the engine. PURE except for the injected fetch.
// Tries each engine base in turn; the first base that answers wins. Soft-fails to {ok:false}.
//
// @param {string} account         MELEK account name
// @param {object} [opts]
// @param {typeof fetch} [opts.fetch]
// @param {string[]} [opts.bases]  engine bases to try (default: engineBases())
export async function fetchApisHash(account, opts = {}) {
  const acct = cleanAccount(account);
  if (!acct) return { ok: false, reason: 'no-account' };
  const f = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return { ok: false, reason: 'no-fetch' };
  const bases = opts.bases || engineBases();
  const a = encodeURIComponent(acct);

  const getJson = async (url) => {
    try {
      const r = await f(url, { cache: 'no-store' });
      return r && r.ok ? await r.json() : null;
    } catch { return null; }
  };

  for (const base of bases) {
    const root = String(base).replace(/\/$/, '');
    const [hashBal, apisBal, worker] = await Promise.all([
      getJson(`${root}/contracts/balances?account=${a}&symbol=${HASH_SYMBOL}`),
      getJson(`${root}/contracts/balances?account=${a}&symbol=${APIS_SYMBOL}`),
      getJson(`${root}/contracts/workerbee`),
    ]);
    // Consider the base "answered" if ANY of the three reads returned data.
    if (hashBal == null && apisBal == null && worker == null) continue;
    const apisHash = balanceOf(hashBal);
    const apis = balanceOf(apisBal);
    const totalApisHash = worker
      ? Number(worker.totalApisHash ?? worker.totalHash ?? 0) || 0
      : 0;
    const emissionPerDay = worker
      ? (worker.emissionPerDay ?? worker.perDay ?? worker.emission ?? null)
      : null;
    return {
      ok: true,
      account: acct,
      base: root,
      apisHash,
      apis,
      totalApisHash,
      emissionPerDay: emissionPerDay == null ? null : Number(emissionPerDay),
      share: computeShare(apisHash, totalApisHash),
    };
  }
  return { ok: false, reason: 'engine-unreachable', account: acct };
}

// ---------------------------------------------------------------------------
// Rendering. Two states share the numbers row; the guidepost swaps in when the
// account holds 0 APIS-Hash (or when there is no data yet / the engine is down).
// ---------------------------------------------------------------------------

// The see-saw framing — short, always shown at the top of the panel.
export function seesawHtml() {
  return (
    `<p class="muted" style="font-size:13px;margin:0 0 12px">` +
    `The pool has <strong>two lanes</strong>, and both feed the reward. One is <strong>raw hashing</strong> ` +
    `&mdash; the miner above, hardware doing work. The other is <strong>APIS-Hash</strong> &mdash; ` +
    `<em>locked-position</em> mining: you forever-lock wMELEK and it mints soulbound APIS-Hash 1:1, which ` +
    `mines <strong>APIS</strong> on a fixed schedule. Same see-saw, two ways to sit on it.` +
    `</p>`
  );
}

// The guidepost call-to-action, shown when the account holds 0 APIS-Hash.
export function guidepostHtml() {
  return (
    `<div class="note" style="margin:12px 0 0">` +
    `<strong>You&rsquo;re mining hashes.</strong> You can also mine <strong>APIS</strong> by ` +
    `forever-locking wMELEK &rarr; APIS-Hash. It mints <strong>soulbound</strong> mining power 1:1 that ` +
    `earns APIS on a fixed schedule, pro-rata by your share.` +
    `<div class="warn" style="margin:10px 0">` +
    `<b>PERMANENT &amp; non-redeemable.</b> Forever-locking wMELEK is one-way &mdash; there is ` +
    `<strong>no unstake</strong> and the APIS-Hash it mints is soulbound (non-transferable). ` +
    `Only lock what you mean to commit forever.` +
    `</div>` +
    `<div class="wiz-dl">` +
    `<a class="wiz-btn" href="${esc(FARM_LOCK_URL)}" target="_blank" rel="noopener">Here&rsquo;s how &mdash; forever-lock on the Yield Farm &rarr;</a>` +
    `<a class="wiz-btn ghost" href="${esc(DEV_DOCS_URL)}" target="_blank" rel="noopener">Dev docs</a>` +
    `</div>` +
    `<div class="muted" style="font-size:12px;margin-top:8px">` +
    `You sign the lock in <em>your own</em> wallet on the Yield Farm &mdash; the pool never sees a key ` +
    `and never moves value. This panel is read-only.` +
    `</div>` +
    `</div>`
  );
}

// The numbers row (APIS-Hash, earned APIS, share of the network). Always honest: shows em-dashes
// when a figure is unknown.
export function statsHtml(data) {
  const hash = data && data.ok ? formatAmount(data.apisHash) : '—';
  const apis = data && data.ok ? formatAmount(data.apis) : '—';
  const share = data && data.ok ? formatSharePct(data.share) : '—';
  const emit = data && data.ok && data.emissionPerDay != null
    ? `${formatAmount(data.emissionPerDay)} APIS/day`
    : '—';
  return (
    `<div class="stat-grid">` +
    `<div class="stat"><div class="k">Your APIS-Hash</div><div class="v" id="ah-hash">${esc(hash)}</div></div>` +
    `<div class="stat"><div class="k">Your APIS earned</div><div class="v" id="ah-apis">${esc(apis)}</div></div>` +
    `<div class="stat"><div class="k">Your share of hash</div><div class="v" id="ah-share">${esc(share)}</div></div>` +
    `<div class="stat"><div class="k">Network emission</div><div class="v" id="ah-emit">${esc(emit)}</div></div>` +
    `</div>`
  );
}

// The whole panel body for a given data result. `state` is one of:
//   'empty'  — nothing entered yet
//   'down'   — engine unreachable (honest empty state)
//   'have'   — account holds APIS-Hash (show numbers, no guidepost)
//   'guide'  — account holds 0 APIS-Hash (show numbers + guidepost)
export function panelBodyHtml(data) {
  let msg = '';
  let body = '';
  if (!data) {
    msg = `<div class="muted" style="font-size:12.5px;margin:0 0 4px">Enter your MELEK account to see your APIS-Hash position.</div>`;
    body = statsHtml(null) + guidepostHtml();
  } else if (!data.ok) {
    msg = `<div class="muted" style="font-size:12.5px;margin:0 0 4px">The engine didn&rsquo;t answer just now &mdash; showing no numbers rather than fake ones. The other lane still works:</div>`;
    body = statsHtml(null) + guidepostHtml();
  } else if (Number(data.apisHash) > 0) {
    msg = `<div class="muted" style="font-size:12.5px;margin:0 0 4px">Live from the engine for <b>@${esc(data.account)}</b>. You&rsquo;re on both lanes.</div>`;
    body = statsHtml(data);
  } else {
    msg = `<div class="muted" style="font-size:12.5px;margin:0 0 4px">Live from the engine for <b>@${esc(data.account)}</b> &mdash; you hold no APIS-Hash yet.</div>`;
    body = statsHtml(data) + guidepostHtml();
  }
  return msg + body;
}

// ---------------------------------------------------------------------------
// Mount (browser only). Reads an entered MELEK account (persisted for convenience),
// looks it up read-only, and paints the panel.
// ---------------------------------------------------------------------------
export function mountApisHashPanel(opts = {}) {
  if (typeof document === 'undefined') return null;
  const root = opts.root || document.getElementById('apishash');
  if (!root) return null;
  const input = root.querySelector('#ah-account');
  const loadBtn = root.querySelector('#ah-load');
  const bodyEl = root.querySelector('#ah-body');
  if (!bodyEl) return null;
  const fetchImpl = opts.fetch || (typeof fetch !== 'undefined' ? fetch : undefined);

  const paint = (data) => { bodyEl.innerHTML = panelBodyHtml(data); };

  const load = async () => {
    const acct = cleanAccount(input && input.value);
    if (!acct) { paint(null); return; }
    try { localStorage.setItem(ACCOUNT_KEY, acct); } catch (e) {}
    bodyEl.innerHTML = `<div class="muted" style="font-size:12.5px">Looking up <b>@${esc(acct)}</b>&hellip;</div>`;
    const data = await fetchApisHash(acct, { fetch: fetchImpl }).catch(() => ({ ok: false, reason: 'error' }));
    paint(data);
  };

  if (loadBtn) loadBtn.onclick = load;
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });

  // Restore a previously-entered account and auto-load it; otherwise show the empty/guidepost state.
  let saved = '';
  try { saved = localStorage.getItem(ACCOUNT_KEY) || ''; } catch (e) {}
  if (saved && input) { input.value = saved; load(); } else { paint(null); }

  return { load, paint };
}

// ---- boot ----
if (typeof document !== 'undefined') {
  const boot = () => mountApisHashPanel();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}
