// SoapBox multi-coin pool frontend. Reads the Miningcore API (/api/pools) and
// renders a coin menu + per-coin stats + per-coin connect instructions.
// Algo families: cryptonote/RandomX (xmrig) and ethereum/Ethash-Etchash (GPU miners).

const API = '/api';
const POOL_HOST = location.hostname || 'pool.soapbox.community';

const $ = (s, r = document) => r.querySelector(s);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };

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
  // fall back on symbol heuristics
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
  if (!pools.length) {
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
      `<div class="mini">${fmtHash(stats.poolHashrate)} &middot; ${fmtNum(stats.connectedMiners)} miners</div>`;
    card.onclick = () => showDetail(p);
    grid.appendChild(card);
  });
}

function showDetail(p) {
  const c = p.coin || {}, stats = p.poolStats || {}, net = p.networkStats || {};
  $('#coins').parentElement.classList.add('hidden');
  $('#ecosystem-note').classList.add('hidden');
  const d = $('#detail');
  d.classList.remove('hidden');
  $('#d-title').innerHTML = `${c.name || p.id} <small style="color:var(--muted);font-size:14px">(${(c.symbol || '').toUpperCase()} &middot; ${algoLabel(p)})</small>`;

  $('#d-stats').innerHTML = [
    ['Pool hashrate', fmtHash(stats.poolHashrate)],
    ['Miners', fmtNum(stats.connectedMiners)],
    ['Network hashrate', fmtHash(net.networkHashrate)],
    ['Network difficulty', fmtNum(Math.round(net.networkDifficulty || 0))],
    ['Block height', fmtNum(net.blockHeight)],
    ['Pool fee', ((p.poolFeePercent != null ? p.poolFeePercent : (p.totalPaid != null ? 0 : 0)) + '%')]
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  renderConnect(p);
}

function renderConnect(p) {
  const c = p.coin || {}, fam = familyOf(p);
  const ports = p.ports || {};
  const box = $('#d-connect');
  let html = '';

  const portRows = Object.keys(ports).map(port => {
    const info = ports[port] || {};
    return `<div class="port"><span class="pname">${info.name || ('Port ' + port)}</span> &mdash; <code>${POOL_HOST}:${port}</code>` +
      (info.difficulty != null ? ` &middot; start diff ${info.difficulty}` : '') + `</div>`;
  }).join('');
  html += portRows || '<div class="port">Stratum ports are being provisioned for this coin.</div>';

  const firstPort = Object.keys(ports)[0];

  if (fam === 'cryptonote') {
    html += `<h3>Mine with xmrig (CPU/GPU, RandomX)</h3>` +
      `<pre><code>xmrig -o ${POOL_HOST}:${firstPort || 4444} \\
      -u YOUR_${(c.symbol || 'XMR').toUpperCase()}_ADDRESS \\
      -p worker1 -a rx/0 --no-color</code></pre>` +
      `<p style="color:var(--muted);font-size:13px">Use any valid ${(c.name || 'coin')} address as <code>-u</code> to mine to your own balance.</p>`;
  } else if (fam === 'ethereum') {
    html += `<h3>Mine with an Ethash/Etchash GPU miner (lolMiner / gminer / ethminer)</h3>` +
      `<pre><code>lolMiner --algo ETCHASH \\
        --pool stratum+tcp://${POOL_HOST}:${firstPort || 5550} \\
        --user 0xYOUR_ADDRESS.worker1</code></pre>` +
      `<pre><code>ethminer -P stratum1+tcp://0xYOUR_ADDRESS.worker1@${POOL_HOST}:${firstPort || 5550}</code></pre>` +
      `<p style="color:var(--muted);font-size:13px">Etchash needs a GPU miner; CPU mining is not practical for this algorithm.</p>`;
  } else {
    html += `<h3>Connect</h3><pre><code>Point your miner at stratum+tcp://${POOL_HOST}:${firstPort || ''}\nUser = your ${(c.symbol || 'coin')} address, password = worker name</code></pre>`;
  }
  box.innerHTML = html;
}

$('#back').onclick = () => {
  $('#detail').classList.add('hidden');
  $('#coins').parentElement.classList.remove('hidden');
  $('#ecosystem-note').classList.remove('hidden');
};

load();
setInterval(() => { if ($('#detail').classList.contains('hidden')) load(); }, 30000);
