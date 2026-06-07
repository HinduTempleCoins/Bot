// SoapBox multi-coin pool frontend. Reads the Miningcore API (/api/pools) and
// renders a coin menu + per-coin stats + per-coin connect instructions + the
// "done-for-them" Start-Mining wizard (incl. the phone path).
// Algo families: cryptonote/RandomX (xmrig) and ethereum/Ethash-Etchash (GPU miners).

import {
  resolveCoin, validateAddress, poolLoginAddress, genConfig, genStartScripts, genOneLiners,
  genEthCommand, genPhone, PHONE_WARNING, IOS_NOTE, MINERS,
  buildManifest, genWindowsLauncher, genWindowsBat, genPosixLauncher,
} from './wizard.mjs';
import { qrcode } from './qrcode.mjs';
import { mountPicker } from './wallet-picker.mjs';
import { MyCoinsStore } from './mycoins.mjs';

// One shared store for every picker on the page (soft-null outside the browser).
let _wpStore;
function wpStore() {
  if (_wpStore === undefined) { try { _wpStore = new MyCoinsStore(); } catch { _wpStore = null; } }
  return _wpStore;
}

// Mount a saved-wallets chip row above `input` (created once as `hostId`). The user's
// wallets are right there to select; missing ones grey out to /wallet/?coin=… (operator
// 2026-06-06: never make a returning miner re-type an address).
function mountWalletChips(hostId, input, chains, onPick) {
  if (!input || !input.insertAdjacentElement) return null;
  // always a FRESH host: replacing the old node disconnects any previous picker's storage
  // listener (it checks isConnected), so a re-opened wizard never gets stale-coin chips.
  const old = document.getElementById(hostId);
  if (old && old.remove) old.remove();
  const host = document.createElement('div');
  host.id = hostId;
  input.insertAdjacentElement('beforebegin', host);
  return mountPicker({ host, input, chains, store: wpStore(), onPick });
}

// chain descriptors for pickers: wizard profile -> picker chain
function chainFor(profile) {
  if (!profile) return null;
  const key = Object.keys({ monero: 1, zephyr: 1, ethereum_classic: 1 }).find(
    (k) => resolveCoin(k) === profile,
  ) || profile.symbol.toLowerCase();
  const evm = profile.addr && profile.addr.type === 'evm';
  return {
    coin: key, symbol: profile.symbol, name: profile.name,
    ...(evm ? { match: ['evm', 'etc'] } : {}),
  };
}

const API = '/api';
const POOL_HOST = location.hostname || 'pool.soapbox.community';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

// ---- theme toggle (SoapBox light/dark) ----
(function theme() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const sync = () => { btn.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀' : '☾'; };
  btn.onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? '' : 'light';
    if (cur) document.documentElement.setAttribute('data-theme', cur);
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('sb-theme', cur); } catch (e) {}
    sync();
  };
  sync();
})();

// Coins that are configured-but-disabled (node not yet provisioned/synced) and should
// show on the menu as "coming online" without claiming live functionality.
// Mirrors the disabled pools[] entries in config.json so the menu stays honest.
// Zephyr first (operator Addendum 23: ZEPH is the recommended browser/phone coin), then
// Monero mainnet. Both honest "coming online" until their daemons sync + a share accepts.
const COMING_SOON = [
  { sym: 'ZEPH', name: 'Zephyr (ZEPH)', algo: 'RandomX / CryptoNote', note: 'node syncing' },
  { sym: 'XMR', name: 'Monero (mainnet)', algo: 'RandomX / CryptoNote', note: 'coming online' }
];

function fmtHash(h) {
  h = Number(h) || 0;
  const u = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s'];
  let i = 0; while (h >= 1000 && i < u.length - 1) { h /= 1000; i++; }
  return h.toFixed(2) + ' ' + u[i];
}
function fmtNum(n) { return (Number(n) || 0).toLocaleString(); }

// Algorithm family for a pool object (Miningcore exposes coin.family / coin.algorithm).
function familyOf(pool) {
  const c = pool.coin || {};
  const fam = (c.family || c.type || '').toLowerCase();
  if (fam.includes('crypto')) return 'cryptonote';
  if (fam.includes('eth')) return 'ethereum';
  const sym = (c.symbol || c.type || '').toUpperCase();
  if (['XMR', 'WOW', 'RTM'].includes(sym)) return 'cryptonote';
  if (['ETH', 'ETC', 'ETHW'].includes(sym)) return 'ethereum';
  return 'other';
}

function algoLabel(pool) {
  const fam = familyOf(pool);
  if (fam === 'cryptonote') return 'RandomX / CryptoNote';
  if (fam === 'ethereum') return 'Ethash / Etchash';
  return (pool.coin && (pool.coin.algorithm || pool.coin.family)) || 'PoW';
}

async function load() {
  let pools = [];
  try {
    const r = await fetch(API + '/pools');
    const j = await r.json();
    pools = j.pools || j || [];
  } catch (e) {
    $('#coins').innerHTML = '<div class="loading">Pool API unreachable. Try again shortly.</div>';
    return;
  }
  renderMenu(pools);
}

function renderMenu(pools) {
  const grid = $('#coins');
  grid.innerHTML = '';
  if (!pools.length && !COMING_SOON.length) {
    grid.innerHTML = '<div class="loading">No pools configured yet.</div>';
    return;
  }
  pools.forEach(p => {
    const c = p.coin || {};
    const stats = p.poolStats || {};
    const card = el('button', 'coin');
    card.innerHTML =
      `<span class="sym">${(c.symbol || c.type || p.id || '').toUpperCase()}</span>` +
      `<span class="algo">${algoLabel(p)}</span>` +
      `<div class="name">${c.name || c.canonicalName || p.id}</div>` +
      `<div class="mini"><span class="dot up"></span><b>${fmtHash(stats.poolHashrate)}</b> &middot; ${fmtNum(stats.connectedMiners)} miners</div>`;
    card.onclick = () => showDetail(p);
    grid.appendChild(card);
  });
  // Configured-but-disabled coins (e.g. Monero mainnet, node not synced) — honest "coming online".
  COMING_SOON.forEach(s => {
    const card = el('button', 'coin');
    card.disabled = true;
    card.innerHTML =
      `<span class="sym">${s.sym}</span>` +
      `<span class="algo">${s.algo}</span>` +
      `<div class="name">${s.name}</div>` +
      `<div class="mini"><span class="dot gold"></span>${s.note}</div>`;
    grid.appendChild(card);
  });
}

function showDetail(p) {
  const c = p.coin || {}, stats = p.poolStats || {}, net = p.networkStats || {};
  $('#coins').parentElement.classList.add('hidden');
  $('#doors-section').classList.add('hidden');
  $('#ecosystem-note').classList.add('hidden');
  $('#wallet-note').classList.add('hidden');
  $('#browser-mine')?.classList.add('hidden');
  $('#launcher')?.classList.add('hidden');
  const d = $('#detail');
  d.classList.remove('hidden');
  $('#d-title').innerHTML = `${c.name || p.id} <small class="muted" style="font-size:14px;font-weight:400">(${(c.symbol || '').toUpperCase()} &middot; ${algoLabel(p)})</small>`;

  $('#d-stats').innerHTML = [
    ['Pool hashrate', fmtHash(stats.poolHashrate)],
    ['Miners', fmtNum(stats.connectedMiners)],
    ['Network hashrate', fmtHash(net.networkHashrate)],
    ['Network difficulty', fmtNum(Math.round(net.networkDifficulty || 0))],
    ['Block height', fmtNum(net.blockHeight)],
    ['Pool fee', ((p.poolFeePercent != null ? p.poolFeePercent : 0) + '%')]
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  setupWizard(p);
  renderConnect(p);
}

function renderConnect(p) {
  const c = p.coin || {}, fam = familyOf(p);
  const ports = p.ports || {};
  const box = $('#d-connect');
  let html = '';

  const portRows = Object.keys(ports).map(port => {
    const info = ports[port] || {};
    return `<div class="port"><span class="pname">${info.name || ('Port ' + port)}</span> &mdash; <code class="mono">${POOL_HOST}:${port}</code>` +
      (info.difficulty != null ? ` &middot; start diff ${info.difficulty}` : '') + `</div>`;
  }).join('');
  html += portRows || '<div class="port">Stratum ports are being provisioned for this coin.</div>';

  const firstPort = Object.keys(ports)[0];

  if (fam === 'cryptonote') {
    html += `<h3>Mine with xmrig (CPU/GPU, RandomX)</h3>` +
      `<pre><code class="mono">xmrig -o ${POOL_HOST}:${firstPort || 4444} \\
      -u YOUR_${(c.symbol || 'XMR').toUpperCase()}_ADDRESS \\
      -p worker1 -a rx/0 --no-color</code></pre>` +
      `<p class="muted" style="font-size:13px">Use any valid ${(c.name || 'coin')} address as <code>-u</code> &mdash; that address (yours) is where the pool pays you. The pool never holds your keys.</p>`;
  } else if (fam === 'ethereum') {
    html += `<h3>Mine with an Ethash/Etchash GPU miner (lolMiner / gminer / ethminer)</h3>` +
      `<pre><code class="mono">lolMiner --algo ETCHASH \\
        --pool stratum+tcp://${POOL_HOST}:${firstPort || 5550} \\
        --user 0xYOUR_ADDRESS.worker1</code></pre>` +
      `<pre><code class="mono">ethminer -P stratum1+tcp://0xYOUR_ADDRESS.worker1@${POOL_HOST}:${firstPort || 5550}</code></pre>` +
      `<p class="muted" style="font-size:13px">Etchash needs a GPU miner; CPU mining is not practical for this algorithm. Your <code>0x…</code> address is your payout target.</p>`;
  } else {
    html += `<h3>Connect</h3><pre><code class="mono">Point your miner at stratum+tcp://${POOL_HOST}:${firstPort || ''}\nUser = your ${(c.symbol || 'coin')} address, password = worker name</code></pre>`;
  }
  box.innerHTML = html;
}

$('#back').onclick = () => {
  $('#detail').classList.add('hidden');
  $('#coins').parentElement.classList.remove('hidden');
  $('#doors-section').classList.remove('hidden');
  $('#ecosystem-note').classList.remove('hidden');
  $('#wallet-note').classList.remove('hidden');
  $('#browser-mine')?.classList.remove('hidden');
  $('#launcher')?.classList.remove('hidden');
};

// ====================================================================
// DONE-FOR-THEM "Start Mining" wizard
// ====================================================================

// Map a hardware choice -> the stratum port to use for this pool.
// CPU/Phone -> lowest-difficulty cryptonote port; AMD/NVIDIA GPU on cryptonote -> high-end
// port if present; ethereum coins always use their single GPU port.
function pickPort(pool, hw) {
  const ports = Object.keys(pool.ports || {}).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (!ports.length) return familyOf(pool) === 'ethereum' ? 5550 : 4444;
  if (familyOf(pool) === 'ethereum') return ports[0];
  // cryptonote: CPU/Phone -> first (low diff); GPU -> last (high diff) if more than one.
  if (hw === 'cpu' || hw === 'phone') return ports[0];
  return ports[ports.length - 1];
}

const HW_OPTIONS = {
  cryptonote: [
    { id: 'cpu', label: 'CPU', desc: 'Any laptop/desktop processor' },
    { id: 'amd', label: 'AMD GPU', desc: 'RandomX runs on CPU; GPU adds little' },
    { id: 'nvidia', label: 'NVIDIA GPU', desc: 'RandomX runs on CPU; GPU adds little' },
    { id: 'phone', label: 'Phone', desc: 'Android via Termux (participation only)' },
  ],
  ethereum: [
    { id: 'amd', label: 'AMD GPU', desc: 'lolMiner / ethminer' },
    { id: 'nvidia', label: 'NVIDIA GPU', desc: 'lolMiner / gminer' },
  ],
};

let WIZ = { pool: null, coinKey: null, hw: null };

function setupWizard(pool) {
  const fam = familyOf(pool);
  const c = pool.coin || {};
  // Resolve our coin profile from the pool id / symbol; fall back to family default.
  const profile = resolveCoin(pool.id) || resolveCoin(c.symbol) ||
    (fam === 'ethereum' ? resolveCoin('ethereum_classic') : resolveCoin('monero'));
  WIZ = { pool, coinKey: profile ? profile.symbol.toLowerCase() : null, hw: null, profile };

  $('#w-coin-sym').textContent = (c.symbol || profile?.symbol || 'coin').toUpperCase();
  $('#w-addr').value = '';
  $('#w-addr-msg').textContent = '';
  $('#w-out').classList.add('hidden');
  $('#w-out').innerHTML = '';

  const help = $('#w-wallet-help');
  help.href = (profile && profile.walletHelp) || '#';

  // hardware buttons
  const hwBox = $('#w-hw');
  hwBox.innerHTML = '';
  (HW_OPTIONS[fam] || HW_OPTIONS.cryptonote).forEach(opt => {
    const b = el('button', 'hw-btn');
    b.innerHTML = `<b>${opt.label}</b><span>${opt.desc}</span>`;
    b.onclick = () => {
      WIZ.hw = opt.id;
      hwBox.querySelectorAll('.hw-btn').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
      renderWizardOutput();
    };
    hwBox.appendChild(b);
  });

  const addr = $('#w-addr');
  addr.oninput = () => { validateLive(); if (WIZ.hw) renderWizardOutput(); };

  // saved-wallets chips for THIS coin: returning miners select, never re-type. The chip
  // row re-mounts per wizard open (the coin changes); a fresh wallet made on /wallet/
  // in another tab appears live via the picker's storage listener.
  addr.value = '';
  const ch = chainFor(profile);
  if (ch) {
    mountWalletChips('w-wallets', addr, [ch], () => {
      validateLive();
      if (WIZ.hw) renderWizardOutput();
    });
    if ((addr.value || '').trim()) validateLive();
  }
}

function validateLive() {
  const v = validateAddress(WIZ.profile, $('#w-addr').value);
  const msg = $('#w-addr-msg');
  const a = $('#w-addr').value.trim();
  if (!a) { msg.textContent = ''; msg.className = 'wiz-msg'; return false; }
  if (v.ok) { msg.textContent = '✓ looks like a valid address'; msg.className = 'wiz-msg ok'; return true; }
  msg.textContent = '✗ ' + v.reason; msg.className = 'wiz-msg bad'; return false;
}

function renderWizardOutput() {
  const out = $('#w-out');
  if (!WIZ.hw) { out.classList.add('hidden'); return; }
  const address = $('#w-addr').value.trim();
  const okAddr = validateLive();
  if (!address) {
    out.classList.remove('hidden');
    out.innerHTML = '<p class="muted" style="font-size:13px">Paste your wallet address above and we&rsquo;ll generate your setup.</p>';
    return;
  }
  if (!okAddr) {
    out.classList.remove('hidden');
    out.innerHTML = '<p class="wiz-msg bad" style="font-size:13px">Fix the address above to generate a valid setup.</p>';
    return;
  }
  out.classList.remove('hidden');
  WIZ.hw === 'phone' ? renderPhoneOut(out, address) : renderDesktopOut(out, address);
}

function renderDesktopOut(out, address) {
  const pool = WIZ.pool, fam = familyOf(pool), profile = WIZ.profile;
  const port = pickPort(pool, WIZ.hw);
  const coinKey = profile.symbol.toLowerCase();

  if (fam === 'ethereum') {
    const cmd = genEthCommand({ coin: coinKey, address, host: POOL_HOST, port });
    out.innerHTML =
      `<h4>Ready GPU command (${profile.symbol} &middot; Etchash)</h4>` +
      `<p class="muted" style="font-size:13px">${cmd.note}</p>` +
      codeBlock('lolMiner', cmd.lolminer) +
      codeBlock('ethminer (alt)', cmd.ethminer) +
      `<p class="wiz-help">Get the miner from its official release page: ` +
      `<a href="${cmd.download}" target="_blank" rel="noopener">lolMiner (GitHub)</a>. ` +
      `We never rehost binaries.</p>`;
    wireCopyButtons(out);
    return;
  }

  // cryptonote / RandomX -> full done-for-them kit
  // Bake the pool-network form of the address into the kit (Monero side is stagenet
  // while we test — a mainnet address would be rejected at the stratum login).
  const { address: loginAddr } = poolLoginAddress(coinKey, address);
  const cfg = genConfig({ coin: coinKey, address: loginAddr, host: POOL_HOST, port, worker: 'soapbox' });
  const liners = genOneLiners({ coin: coinKey, address: loginAddr, host: POOL_HOST, port, worker: 'soapbox' });
  out.innerHTML =
    `<h4>Your setup &mdash; ${profile.symbol} on ${POOL_HOST}:${port}</h4>` +
    `<div class="wiz-dl">` +
      `<button class="wiz-btn" id="dl-zip">⬇ Download setup .zip (config + start script)</button>` +
      `<button class="wiz-btn ghost" id="dl-cfg">⬇ config.json only</button>` +
    `</div>` +
    `<p class="wiz-help">The zip has your <code>config.json</code> (address baked in) plus ` +
    `<code>start.bat</code> (Windows) and <code>start.sh</code> (Linux/Mac). Unzip it next to ` +
    `the official xmrig v${MINERS.xmrig.version}, then run the start file.</p>` +
    `<h4>Or paste one line (it downloads official xmrig, checks its SHA256, then mines)</h4>` +
    codeBlock('Windows — PowerShell', liners.powershell) +
    codeBlock('Linux / Mac — Terminal', liners.sh) +
    `<p class="wiz-help">These download the official xmrig v${MINERS.xmrig.version} from ` +
    `<a href="${MINERS.xmrig.releasePage}" target="_blank" rel="noopener">xmrig&rsquo;s GitHub releases</a> ` +
    `and verify the SHA256 before running. We never rehost the binary.</p>`;

  $('#dl-zip').onclick = () => downloadZip(`soapbox-${profile.symbol.toLowerCase()}-miner.zip`, [
    { name: 'config.json', data: JSON.stringify(cfg, null, 2) },
    { name: 'start.bat', data: genStartScripts({ platform: 'windows' }) },
    { name: 'start.sh', data: genStartScripts({ platform: 'linux' }) },
    { name: 'README.txt', data: zipReadme(profile, POOL_HOST, port) },
  ]);
  $('#dl-cfg').onclick = () => downloadText('config.json', JSON.stringify(cfg, null, 2));
  wireCopyButtons(out);
}

function renderPhoneOut(out, address) {
  const pool = WIZ.pool, profile = WIZ.profile;
  const port = pickPort(pool, 'phone');
  // Same stagenet-twin conversion as the desktop kit — the phone QR config must log in too.
  const loginAddr = poolLoginAddress(profile.symbol.toLowerCase(), address).address;
  const phone = genPhone({ coin: profile.symbol.toLowerCase(), address: loginAddr, host: POOL_HOST, port, worker: 'phone' });

  if (!phone.supported) {
    out.innerHTML =
      `<div class="warn"><b>Phones can&rsquo;t mine ${profile.symbol}.</b> ${phone.reason}</div>` +
      `<p class="wiz-help">Pick <b>Monero</b> from the coin menu for the phone path &mdash; it&rsquo;s phone-ready today on this pool.</p>`;
    return;
  }

  out.innerHTML =
    `<div class="warn"><b>Read first:</b> ${PHONE_WARNING}</div>` +
    `<h4>Android (Termux)</h4>` +
    `<ol class="wiz-steps">${phone.steps.map(s => `<li>${linkify(s)}</li>`).join('')}</ol>` +
    `<div class="qr-wrap"><div id="w-qr" class="qr"></div>` +
      `<div class="qr-side">` +
        `<div class="k">Scan this from the phone, or copy the command</div>` +
        codeBlock('Termux command', phone.command) +
      `</div>` +
    `</div>` +
    `<div class="note ios"><b>iPhone:</b> ${IOS_NOTE}</div>`;

  // render the QR (SVG, no canvas) from the self-contained Termux command
  try {
    const q = qrcode(0, 'M');
    q.addData(phone.qrPayload);
    q.make();
    $('#w-qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
  } catch (e) {
    $('#w-qr').innerHTML = '<span class="muted" style="font-size:12px">QR unavailable — copy the command.</span>';
  }
  wireCopyButtons(out);
}

// ---- small UI helpers ----
function esc(s) { return String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
function codeBlock(label, text) {
  return `<div class="cblock"><div class="cb-head"><span class="cb-label">${esc(label)}</span>` +
    `<button class="copy" data-copy="${esc(text)}">Copy</button></div>` +
    `<pre><code class="mono">${esc(text)}</code></pre></div>`;
}
function wireCopyButtons(root) {
  root.querySelectorAll('.copy').forEach(b => {
    b.onclick = () => {
      const t = b.getAttribute('data-copy');
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(
        () => { b.textContent = 'Copied ✓'; setTimeout(() => b.textContent = 'Copy', 1400); },
        () => { b.textContent = 'Copy failed'; setTimeout(() => b.textContent = 'Copy', 1400); }
      );
    };
  });
}
function zipReadme(profile, host, port) {
  return [
    `SoapBox Mining Pool — ${profile.name} (${profile.symbol}) setup`,
    ``,
    `1. Download the OFFICIAL xmrig v${MINERS.xmrig.version} from:`,
    `   ${MINERS.xmrig.releasePage}`,
    `   (verify the SHA256 against the SHA256SUMS file on that page).`,
    `2. Unzip xmrig and put config.json + start.bat/start.sh in the SAME folder as the xmrig binary.`,
    `3. Run start.bat (Windows) or ./start.sh (Linux/Mac).`,
    ``,
    `Pool: ${host}:${port}`,
    `You are paid to the address baked into config.json. The pool never holds your keys.`,
    ``,
    `We do not rehost miner binaries — always get xmrig from its official GitHub release.`,
  ].join('\r\n');
}

// ---- downloads (no dependencies) ----
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadText(filename, text) {
  downloadBlob(filename, new Blob([text], { type: 'application/octet-stream' }));
}
// Minimal STORED (uncompressed) ZIP writer — no library needed. Good for small text files.
function downloadZip(filename, files) {
  downloadBlob(filename, makeZip(files));
}
function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const crcTable = makeZip._crc || (makeZip._crc = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })());
  const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  for (const f of files) {
    const data = enc.encode(f.data);
    const name = enc.encode(f.name);
    const crc = crc32(data);
    const local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
    chunks.push(new Uint8Array(local), name, data);
    const cd = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset));
    central.push(new Uint8Array(cd), name);
    offset += local.length + name.length + data.length;
  }
  const cdStart = offset;
  let cdLen = 0; central.forEach(c => cdLen += c.length);
  const end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cdLen), u32(cdStart), u16(0));
  return new Blob([...chunks, ...central, new Uint8Array(end)], { type: 'application/zip' });
}

// ====================================================================
// SoapBox Miner — universal launcher ("one download, pick inside")
// ====================================================================
const MANIFEST_PATH = '/launcher-manifest.json';
const MANIFEST_URL = `${location.protocol}//${POOL_HOST}${MANIFEST_PATH}`;

// Build a fallback manifest from the SAME source (wizard.mjs) the static file is built
// from, themed to this host. The launcher prefers the live served file; this baked-in copy
// is only used if the pool is unreachable at run time.
function launcherManifest() {
  return buildManifest({ host: POOL_HOST });
}

function readLauncherAddresses() {
  // Monero side of the pool is stagenet (testing) — hand the launcher the stagenet
  // twin of the user's address so the baked miner config logs in successfully.
  const xmr = poolLoginAddress('monero', ($('#l-xmr')?.value || '')).address;
  const evm = ($('#l-evm')?.value || '').trim();
  return { monero: xmr, evm };
}

// Live-validate the two optional launcher address fields (blank is allowed — prompted on run).
function validateLauncherFields() {
  const checks = [
    ['#l-xmr', '#l-xmr-msg', 'monero'],
    ['#l-evm', '#l-evm-msg', 'ethereum_classic'],
  ];
  for (const [inSel, msgSel, coin] of checks) {
    const input = $(inSel), msg = $(msgSel);
    if (!input || !msg) continue;
    const a = input.value.trim();
    if (!a) { msg.textContent = ''; msg.className = 'wiz-msg'; continue; }
    const v = validateAddress(coin, a);
    if (v.ok) { msg.textContent = '✓ looks valid'; msg.className = 'wiz-msg ok'; }
    else { msg.textContent = '✗ ' + v.reason; msg.className = 'wiz-msg bad'; }
  }
}

function setupLauncher() {
  const winBtn = $('#dl-win'), nixBtn = $('#dl-nix');
  if (!winBtn || !nixBtn) return;
  $('#l-xmr')?.addEventListener('input', validateLauncherFields);
  $('#l-evm')?.addEventListener('input', validateLauncherFields);

  // saved-wallets chips for the launcher fields too: select, don't re-type.
  mountWalletChips('l-xmr-wallets', $('#l-xmr'),
    [{ coin: 'monero', symbol: 'XMR', name: 'Monero' }], validateLauncherFields);
  mountWalletChips('l-evm-wallets', $('#l-evm'),
    [{ coin: 'ethereum_classic', symbol: 'ETC', name: 'EVM (0x…)', match: ['evm', 'etc'] }], validateLauncherFields);
  validateLauncherFields();

  winBtn.onclick = () => {
    const addresses = readLauncherAddresses();
    const manifest = launcherManifest();
    const ps1 = genWindowsLauncher({ addresses, manifest, manifestUrl: MANIFEST_URL });
    const bat = genWindowsBat({ ps1Name: 'SoapBoxMiner.ps1' });
    // Ship both files in one zip so the .bat shim sits next to the .ps1 it launches.
    downloadZip('SoapBoxMiner-Windows.zip', [
      { name: 'SoapBoxMiner.ps1', data: ps1 },
      { name: 'SoapBoxMiner.bat', data: bat },
      { name: 'READ-ME-FIRST.txt', data: launcherReadme('windows') },
    ]);
  };
  nixBtn.onclick = () => {
    const addresses = readLauncherAddresses();
    const manifest = launcherManifest();
    const sh = genPosixLauncher({ addresses, manifest, manifestUrl: MANIFEST_URL });
    downloadText('soapbox-miner.sh', sh);
  };
}

function launcherReadme(os) {
  const common = [
    'SoapBox Miner — one download, pick your coin inside.',
    '',
    'These scripts are PLAIN TEXT. Open them in a text editor to read exactly what they do:',
    '  - fetch the live coin menu from the pool (or use the copy baked into the script),',
    '  - download ONLY the official miner from its GitHub release and verify its SHA256,',
    '  - write a config with YOUR address as the mining username and start mining.',
    'Your address is never sent anywhere except to the pool as your payout username.',
    '',
  ];
  if (os === 'windows') {
    return common.concat([
      'TO RUN: double-click SoapBoxMiner.bat (it runs the .ps1 next to it).',
      '',
      'Windows will likely show a SmartScreen / Defender warning because this is an',
      'unsigned community script. That warning appears for ANY unsigned script — it is not',
      'a sign that something is wrong. Choose "More info" -> "Run anyway" if you trust it,',
      'or read SoapBoxMiner.ps1 first. The .bat only bypasses the execution policy for THIS',
      'file (standard -ExecutionPolicy Bypass) and changes no system setting. We never ask',
      'you to disable Defender or SmartScreen.',
    ]).join('\r\n') + '\r\n';
  }
  return common.concat([
    'TO RUN:  chmod +x soapbox-miner.sh && ./soapbox-miner.sh',
    'Needs: curl, tar, python3, and sha256sum or shasum.',
    'macOS Apple Silicon uses the matching xmrig build; Etchash GPU coins are not',
    'supported on macOS.',
  ]).join('\n');
}

load();
setupLauncher();
setInterval(() => { if ($('#detail').classList.contains('hidden')) load(); }, 30000);
