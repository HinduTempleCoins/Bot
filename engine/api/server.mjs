/**
 * server.mjs — Melek-Engine public read API + web UI.
 *
 * REST + JSON-RPC endpoints mirroring Hive-Engine's contracts API shape so
 * existing tooling ports easily, plus a small no-build web UI. Read-only:
 * the API never holds keys and never broadcasts. The "create / issue /
 * transfer" UI page builds the custom_json client-side; the user broadcasts it
 * with their own key (keys never reach the server) — §7 / key-custody rule.
 *
 * Security study §6 E item 12: per-IP rate limit + standard security headers.
 */

import { createServer } from 'node:http';
import { config, genesis } from '../config.mjs';
import { fromBaseUnits } from '../lib/decimal.mjs';
import { renderUI } from '../ui/render.mjs';
import { makeHandler as makeTokenToolsHandler } from '../lib/token-tools.mjs';
import { workerbee } from '../contracts/workerbee.mjs';

// The MELEK-Engine wallet + payouts viewer. Self-contained, no build, read-only. Shows YOUR token
// balances and the payouts for the tokens of YOUR choosing (a watchlist). Uses textContent only.
const WALLET_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MELEK Wallet & Payouts</title>
<style>body{font-family:system-ui,sans-serif;max-width:780px;margin:1.5rem auto;padding:0 1rem;color:#1a1a2e}
h1{font-size:1.3rem}h2{font-size:1rem;margin-top:1.5rem}input{padding:.4rem;border:1px solid #ccc;border-radius:6px}
button{padding:.4rem .8rem;border:0;border-radius:6px;background:#2e3b8f;color:#fff;cursor:pointer}
table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.9rem}th,td{border:1px solid #e0e0e0;padding:.35rem .5rem;text-align:left}
th{background:#f4f4fb}.muted{color:#777;font-size:.85rem}</style></head>
<body><h1>🪽 MELEK-Engine Wallet & Payouts</h1>
<p class="muted">Your token balances, and the payouts for the tokens of your choosing. Read-only.</p>
<h2>Your wallet</h2>
<div><input id="acct" placeholder="your account (e.g. melekvankush)"><button onclick="loadWallet()">Load wallet</button></div>
<div id="wallet"></div>
<h2>Payouts — tokens of your choosing</h2>
<div><input id="watch" placeholder="symbols to watch, comma-separated (e.g. SCROLL,APIS)" size="40"><button onclick="loadPayouts()">Show payouts</button></div>
<div id="payouts"></div>
<script>
function el(t,txt){var e=document.createElement(t);if(txt!=null)e.textContent=txt;return e}
function table(headers,rows){var t=document.createElement('table');var tr=document.createElement('tr');
headers.forEach(function(h){tr.appendChild(el('th',h))});t.appendChild(tr);
rows.forEach(function(r){var x=document.createElement('tr');r.forEach(function(c){x.appendChild(el('td',String(c)))});t.appendChild(x)});return t}
async function getJSON(u){try{var r=await fetch(u);return await r.json()}catch(e){return null}}
async function loadWallet(){var a=document.getElementById('acct').value.trim();var box=document.getElementById('wallet');box.textContent='';
if(!a)return;var rows=await getJSON('/api/balances?account='+encodeURIComponent(a))||[];
if(!rows.length){box.appendChild(el('p','No balances for @'+a+'.'));return}
box.appendChild(table(['Token','Liquid','Staked'],rows.map(function(b){return [b.symbol,b.balance,b.stake||'0']})))}
async function loadPayouts(){var syms=document.getElementById('watch').value.split(/[\\s,]+/).map(function(s){return s.trim().toUpperCase()}).filter(Boolean);
var box=document.getElementById('payouts');box.textContent='';
for(var i=0;i<syms.length;i++){var sym=syms[i];
var tribe=(await getJSON('/api/tribes?symbol='+sym))||[];var rule=tribe[0];
box.appendChild(el('h3',sym+(rule?' — tribe: '+(rule.authorBps/100)+'% author / '+((10000-rule.authorBps)/100)+'% curator, '+rule.emissionPerWindow+' base/window, '+rule.curve:' — not a reward tribe')));
var pays=(await getJSON('/api/payouts?symbol='+sym))||[];
if(!pays.length){box.appendChild(el('p','No payouts yet for '+sym+'.'));continue}
box.appendChild(table(['Author','Emitted','Paid','Votes','Post'],pays.map(function(p){return [p.author,p.emitted||'-',p.paid?'yes':'pending',p.votes,p.permlink]})))}}
</script></body></html>`;

// ScotTube — the dTube clone. Lists video posts tagged for a video tribe (from L1), plays the
// user's own video URL, and shows each video's SCOT earnings. Reward = the SAME SCOT loop: a video
// post tagged for the tribe earns the tribe token when stakers vote (no stake needed to earn).
// Read-only; the "post a video" form builds the op for the user to sign (keyless). textContent only.
const DTUBE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MELEK ScotTube</title>
<style>body{font-family:system-ui,sans-serif;max-width:880px;margin:1.5rem auto;padding:0 1rem;color:#1a1a2e}
h1{font-size:1.3rem}.vid{border:1px solid #e0e0e0;border-radius:8px;padding:.8rem;margin:.8rem 0}
.vid h3{margin:.2rem 0;font-size:1.05rem}.earn{color:#2e7d32;font-weight:600}video,iframe{width:100%;max-height:420px;border:0;border-radius:6px;background:#000}
input,textarea{padding:.4rem;border:1px solid #ccc;border-radius:6px;width:100%;margin:.2rem 0;box-sizing:border-box}
button{padding:.4rem .8rem;border:0;border-radius:6px;background:#2e3b8f;color:#fff;cursor:pointer}.muted{color:#777;font-size:.85rem}
details{margin:1rem 0;border:1px solid #e0e0e0;border-radius:8px;padding:.6rem}pre{white-space:pre-wrap;word-break:break-all;background:#f4f4fb;padding:.5rem;border-radius:6px}</style></head>
<body><h1>🎬 MELEK ScotTube</h1>
<p class="muted">Videos tagged for the <b id="tg">reel</b> tribe. Posting a video and getting upvoted by stakers earns you the tribe token — you need zero of it to earn it.</p>
<div id="feed">loading…</div>
<details><summary>Post a video (builds the op — sign it in your wallet)</summary>
<input id="pv-author" placeholder="your account"><input id="pv-title" placeholder="title">
<input id="pv-url" placeholder="video URL (your own / IPFS / licensed embed)"><textarea id="pv-desc" placeholder="description"></textarea>
<button onclick="buildPost()">Build post op</button><pre id="pv-out"></pre></details>
<script>
var RPC='https://alpha.melek.salon/rpc', TAG='reel', SYMBOL='REEL';
function el(t,txt){var e=document.createElement(t);if(txt!=null)e.textContent=txt;return e}
async function rpc(method,params){try{var r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',method:method,params:params,id:1})});return (await r.json()).result}catch(e){return null}}
async function getJSON(u){try{return await (await fetch(u)).json()}catch(e){return null}}
function videoUrl(meta){if(!meta)return null;if(typeof meta.video==='string')return meta.video;if(meta.video&&meta.video.url)return meta.video.url;if(Array.isArray(meta.links))return meta.links.find(function(l){return /\\.(mp4|webm|ogg)$/i.test(l)})||null;return null}
async function load(){var feed=document.getElementById('feed');feed.textContent='';
var posts=await rpc('condenser_api.get_discussions_by_created',[{tag:TAG,limit:20}])||[];
var pays=await getJSON('/api/payouts?symbol='+SYMBOL)||[];
var earnByPost={};pays.forEach(function(p){earnByPost[p.postKey]=p});
var vids=posts.filter(function(p){var m;try{m=JSON.parse(p.json_metadata||'{}')}catch(e){m={}}; p._url=videoUrl(m); return p._url});
if(!vids.length){feed.appendChild(el('p','No '+TAG+' videos yet. Post one below (tag it "'+TAG+'").'));return}
vids.forEach(function(p){var d=document.createElement('div');d.className='vid';
d.appendChild(el('h3',p.title||'(untitled)'));d.appendChild(el('div','by @'+p.author));
var safe=null;try{var uu=new URL(p._url);if(uu.protocol==='http:'||uu.protocol==='https:')safe=uu}catch(e){}
var media;
if(!safe){media=el('div','(unsupported or unsafe video URL — not rendered)')}
else if(/\\.(mp4|webm|ogg)$/i.test(safe.pathname)){media=document.createElement('video');media.controls=true;media.src=safe.href}
else if(/(^|\\.)(youtube\\.com|youtube-nocookie\\.com|youtu\\.be|vimeo\\.com|ipfs\\.io|w3s\\.link|archive\\.org)$/i.test(safe.hostname)){media=document.createElement('iframe');media.src=safe.href;media.setAttribute('sandbox','allow-scripts allow-same-origin allow-presentation');media.allowFullscreen=true}
else{media=el('a','▶ open video ('+safe.hostname+')');media.href=safe.href;media.target='_blank';media.rel='noopener noreferrer'}
d.appendChild(media);
var e=earnByPost[p.author+'/'+p.permlink];d.appendChild(el('div',e?('💰 earned '+(e.emitted||'pending')+' '+SYMBOL+(e.paid?'':' (pending payout)')):'no SCOT earnings yet'));
if(e)d.querySelector('div:last-child').className='earn';
feed.appendChild(d)})}
function buildPost(){var a=document.getElementById('pv-author').value.trim();var t=document.getElementById('pv-title').value.trim();var u=document.getElementById('pv-url').value.trim();var ds=document.getElementById('pv-desc').value.trim();
var permlink='reel-'+Date.now().toString(36);
var op=['comment',{parent_author:'',parent_permlink:TAG,author:a,permlink:permlink,title:t,body:ds+'\\n\\n'+u,json_metadata:JSON.stringify({app:'melek/scottube',tags:[TAG,'video'],video:u})}];
document.getElementById('pv-out').textContent=JSON.stringify(op,null,2)}
load();
</script></body></html>`;

const HITS = new Map(); // ip -> { count, resetAt }

function rateLimited(ip) {
  const now = Date.now();
  let h = HITS.get(ip);
  if (!h || now > h.resetAt) {
    h = { count: 0, resetAt: now + 60_000 };
    HITS.set(ip, h);
  }
  h.count++;
  return h.count > config.rateLimitPerMin;
}

function send(res, code, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  });
  res.end(payload);
}

/** Project a token row for the API (base units -> decimal strings). */
function tokenView(t) {
  return {
    symbol: t.symbol,
    name: t.name,
    issuer: t.issuer,
    precision: t.precision,
    maxSupply: fromBaseUnits(BigInt(t.maxSupply), t.precision),
    supply: fromBaseUnits(BigInt(t.supply), t.precision),
    circulatingSupply: fromBaseUnits(BigInt(t.circulatingSupply), t.precision),
    supplyCapImmutable: t.supplyCapImmutable,
    url: t.url,
    createdBlock: t.createdBlock,
  };
}

function balanceView(state, b) {
  const t = state.findOne('tokens', { symbol: b.symbol });
  const prec = t ? t.precision : 3;
  return {
    account: b.account,
    symbol: b.symbol,
    balance: fromBaseUnits(BigInt(b.balance), prec),
    stake: fromBaseUnits(BigInt(b.stake || '0'), prec),
  };
}

/**
 * Build the HTTP handler over a live State. The engine keeps state fresh in
 * the background; this only reads it.
 */
export function makeHandler(state, opts = {}) {
  // The token-tools surface (engine side-tokens + native SMT/NAI) is mounted at
  // /tools. It reads the same live engine State and, when provided, an injected
  // smtSummary reader (integrations/smt-info.mjs) so the SMT half is live too.
  // It NEVER signs/broadcasts — /tools/api/build only builds + validates ops.
  const tokenTools = makeTokenToolsHandler({ state, smtSummary: opts.smtSummary });

  return function handler(req, res) {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (rateLimited(ip)) return send(res, 429, { error: 'rate limited' });

    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const q = url.searchParams;

    // --- token tools (mounted under /tools, prefix stripped before delegating) ---
    if (path === '/tools' || path === '/tools/' || path.startsWith('/tools/')) {
      const sub = path === '/tools' ? '/' : path.slice('/tools'.length) || '/';
      const subReq = Object.create(req);
      subReq.url = sub + url.search;
      return tokenTools(subReq, res);
    }

    try {
      // --- /wallet : the MELEK-Engine wallet + payouts viewer (your balances + the payouts for
      // the tokens of your choosing). Self-contained page; reads the read-only /api endpoints. ---
      if (path === '/wallet' || path === '/wallet/') {
        return send(res, 200, WALLET_HTML, 'text/html; charset=utf-8');
      }
      // --- /dtube : ScotTube — video feed (by tribe tag) + per-video SCOT earnings + post-builder ---
      if (path === '/dtube' || path === '/dtube/') {
        return send(res, 200, DTUBE_HTML, 'text/html; charset=utf-8');
      }

      // --- health ---
      if (path === '/health') {
        return send(res, 200, {
          ok: true,
          lastBlock: state.meta.lastBlock,
          stateHash: state.meta.stateHash,
          sidechainId: config.sidechainId,
        });
      }

      // --- chain status / state checkpoint (§6 C item 7) ---
      if (path === '/status' || path === '/api/status') {
        return send(res, 200, {
          sidechainId: config.sidechainId,
          chainId: config.chainId,
          lastBlock: state.meta.lastBlock,
          lastBlockId: state.meta.lastBlockId,
          stateHash: state.hash(),
          feeToken: genesis.feeToken,
          minerToken: genesis.minerToken,
          tokenCount: state.collection('tokens').length,
          seams: {
            gateway: config.seams.gateway.enabled,
            dexSettlement: config.seams.dexSettlement.enabled,
          },
        });
      }

      // --- contracts API (Hive-Engine shape) ---
      // GET /contracts/tokens?symbol=APIS   -> token(s)
      if (path === '/contracts/tokens' || path === '/api/tokens') {
        const symbol = q.get('symbol');
        const rows = symbol
          ? state.find('tokens', { symbol: symbol.toUpperCase() })
          : state.collection('tokens');
        return send(res, 200, rows.map(tokenView));
      }

      // GET /contracts/balances?account=hathor[&symbol=APIS]
      if (path === '/contracts/balances' || path === '/api/balances') {
        const account = q.get('account');
        const symbol = q.get('symbol');
        if (!account) return send(res, 400, { error: 'account required' });
        const query = { account };
        if (symbol) query.symbol = symbol.toUpperCase();
        const rows = state.find('balances', query).filter((b) => BigInt(b.balance) > 0n || BigInt(b.stake || '0') > 0n);
        return send(res, 200, rows.map((b) => balanceView(state, b)));
      }

      // --- NFT contract (read-only) ---
      // GET /contracts/nft/collections[?collection=KUSHSEED]
      if (path === '/contracts/nft/collections' || path === '/api/nft/collections') {
        const collection = (q.get('collection') || '').toUpperCase();
        const rows = collection ? state.find('nftCollections', { collection }) : state.collection('nftCollections');
        return send(res, 200, rows);
      }
      // GET /contracts/nft/types?collection=KUSHSEED[&tokenId=VANKUSH] -> the type registry + traits + supply
      if (path === '/contracts/nft/types' || path === '/api/nft/types') {
        const collection = (q.get('collection') || '').toUpperCase();
        const tokenId = (q.get('tokenId') || '').toUpperCase();
        const query = {};
        if (collection) query.collection = collection;
        if (tokenId) query.tokenId = tokenId;
        return send(res, 200, state.find('nftTypes', query));
      }
      // GET /contracts/nft/balances?account=hathor[&collection=KUSHSEED] -> an account's NFT holdings.
      // The Seeds wallet page reads this: each row carries tokenId + count (>0) + the type's traits.
      if (path === '/contracts/nft/balances' || path === '/api/nft/balances') {
        const account = q.get('account');
        if (!account) return send(res, 400, { error: 'account required' });
        const collection = (q.get('collection') || '').toUpperCase();
        const query = { account };
        if (collection) query.collection = collection;
        const rows = state.find('nftBalances', query).filter((b) => BigInt(b.count || '0') > 0n).map((b) => {
          const type = state.findOne('nftTypes', { collection: b.collection, tokenId: b.tokenId });
          return {
            account: b.account, collection: b.collection, tokenId: b.tokenId, symbol: b.tokenId,
            count: b.count, balance: b.count, traits: type ? type.traits : {},
          };
        });
        return send(res, 200, rows);
      }

      // GET /contracts/seeds[?symbol=VANKUSH] -> the Seed Mint registry (which seeds exist + their kind/traits)
      if (path === '/contracts/seeds' || path === '/api/seeds') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        const rows = symbol ? state.find('seeds', { symbol }) : state.collection('seeds');
        return send(res, 200, rows);
      }
      // GET /contracts/seeds/plants[?account=x&symbol=y] -> the plant (burn) log the grow game reads
      if (path === '/contracts/seeds/plants' || path === '/api/seeds/plants') {
        const account = q.get('account');
        const symbol = (q.get('symbol') || '').toUpperCase();
        let rows = state.collection('plantLog');
        if (account) rows = rows.filter((r) => r.account === account);
        if (symbol) rows = rows.filter((r) => r.symbol === symbol);
        return send(res, 200, rows.slice(-200));
      }

      // GET /contracts/holders?symbol=APIS   -> who holds a token
      if (path === '/contracts/holders' || path === '/api/holders') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        if (!symbol) return send(res, 400, { error: 'symbol required' });
        const rows = state
          .find('balances', { symbol })
          .filter((b) => BigInt(b.balance) > 0n || BigInt(b.stake || '0') > 0n);
        return send(res, 200, rows.map((b) => balanceView(state, b)));
      }

      // GET /contracts/issuance?symbol=APIS  -> append-only issuance log
      if (path === '/contracts/issuance' || path === '/api/issuance') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        const rows = symbol ? state.find('issuanceLog', { symbol }) : state.collection('issuanceLog');
        return send(res, 200, rows);
      }

      // GET /api/tribes  -> every SCOT reward rule (tribe): symbol, tag, emission, window, split, curve
      if (path === '/contracts/tribes' || path === '/api/tribes') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        const rows = symbol ? state.find('rewardRules', { symbol }) : state.collection('rewardRules');
        return send(res, 200, rows);
      }

      // GET /api/payouts?symbol=X[&author=Y]  -> reward posts for a tribe (who earned, paid status).
      // This is the data behind "see the payouts for the tokens of your choosing."
      if (path === '/contracts/payouts' || path === '/api/payouts') {
        const symbol = (q.get('symbol') || '').toUpperCase();
        const author = q.get('author');
        let rows = symbol ? state.find('rewardPosts', { symbol }) : state.collection('rewardPosts');
        if (author) rows = rows.filter((r) => r.author === author);
        // newest first; cap
        rows = rows.slice().sort((a, b) => (b.openedBlock || 0) - (a.openedBlock || 0)).slice(0, 200);
        return send(res, 200, rows);
      }

      // --- WorkerBee issuance lottery (read-only) ---
      // The block to evaluate "pending"/"emission now" at: ?block=N, default the
      // engine's last processed L1 block (so views match the live schedule).
      const wbBlock = (() => {
        const b = Number(q.get('block'));
        return Number.isInteger(b) && b > 0 ? b : (state.meta.lastBlock || 0);
      })();
      const wbCtx = (sender) => ({ sender, blockNum: wbBlock, blockId: state.meta.lastBlockId, txId: 'view', authLevel: 'posting' });

      // GET /contracts/workerbee  -> the fixed emission schedule + totals
      if (path === '/contracts/workerbee' || path === '/api/workerbee') {
        return send(res, 200, workerbee.emissionInfo(state, wbCtx('view')));
      }
      // GET /contracts/workerbee/apishash?account=x -> soulbound mining power
      if (path === '/contracts/workerbee/apishash' || path === '/api/workerbee/apishash') {
        const account = q.get('account');
        if (!account) return send(res, 400, { error: 'account required' });
        return send(res, 200, workerbee.apisHashOf(state, wbCtx(account), { account }));
      }
      // GET /contracts/workerbee/total -> total APIS-Hash locked
      if (path === '/contracts/workerbee/total' || path === '/api/workerbee/total') {
        return send(res, 200, workerbee.totalApisHash(state));
      }
      // GET /contracts/workerbee/pending?account=x -> accrued-but-unclaimed APIS
      if (path === '/contracts/workerbee/pending' || path === '/api/workerbee/pending') {
        const account = q.get('account');
        if (!account) return send(res, 400, { error: 'account required' });
        return send(res, 200, workerbee.apisHashPending(state, wbCtx(account), { account }));
      }
      // GET /contracts/workerbee/locks[?account=x] -> the permanent-lock log
      if (path === '/contracts/workerbee/locks' || path === '/api/workerbee/locks') {
        const account = q.get('account');
        let rows = state.collection('workerbeeLocks');
        if (account) rows = rows.filter((r) => r.account === account);
        return send(res, 200, rows.slice(-200));
      }

      // GET /contracts/history?account=x  -> processed ops touching account
      if (path === '/contracts/history' || path === '/api/history') {
        const account = q.get('account');
        let rows = state.collection('processed');
        if (account) rows = rows.filter((r) => r.sender === account);
        return send(res, 200, rows.slice(-200));
      }

      // GET /contracts/bridge/deposits[?symbol=APIS&since=<block>]  -> side-tokens transferred to the
      // bridge custody, to be minted on PRANA. The off-chain engine-bridge-watcher reads these.
      if (path === '/contracts/bridge/deposits' || path === '/api/bridge/deposits') {
        let rows = state.collection('bridgeDeposits');
        const symbol = (q.get('symbol') || '').toUpperCase();
        const since = Number(q.get('since') || 0);
        if (symbol) rows = rows.filter((r) => r.symbol === symbol);
        if (since) rows = rows.filter((r) => Number(r.block) >= since);
        return send(res, 200, rows.slice(-500));
      }

      // --- JSON-RPC (Hive-Engine "find" shape) ---
      if (path === '/rpc/contracts' && req.method === 'POST') {
        return readBody(req).then((body) => {
          let rpcReq;
          try {
            rpcReq = JSON.parse(body);
          } catch {
            return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'parse error' }, id: null });
          }
          const { id = null, params = {} } = rpcReq;
          const { contract, table, query = {} } = params;
          let result = [];
          if (contract === 'tokens' && table === 'tokens') {
            result = state.find('tokens', normSymbol(query)).map(tokenView);
          } else if (contract === 'tokens' && table === 'balances') {
            result = state.find('balances', normSymbol(query)).map((b) => balanceView(state, b));
          } else if (contract === 'workerbee' && table === 'miners') {
            result = state.find('workerbeeMiners', query);
          } else if (contract === 'workerbee' && table === 'pool') {
            result = state.find('workerbeePool', query);
          } else if (contract === 'workerbee' && table === 'locks') {
            result = state.find('workerbeeLocks', query);
          }
          return send(res, 200, { jsonrpc: '2.0', result, id });
        });
      }

      // --- UI ---
      if (path === '/' || path === '/index.html') {
        return send(res, 200, renderUI(state), 'text/html; charset=utf-8');
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  };
}

function normSymbol(query) {
  const out = { ...query };
  if (out.symbol) out.symbol = String(out.symbol).toUpperCase();
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

export async function startServer(state) {
  // Best-effort: wire the live SMT/NAI reader into the /tools surface. If the
  // module or RPC env isn't present, /tools still renders (SMT half soft-empty).
  let smtSummary;
  try {
    ({ smtSummary } = await import('../../integrations/smt-info.mjs'));
  } catch {
    /* no smt reader — /tools shows the engine half only */
  }
  const server = createServer(makeHandler(state, { smtSummary }));
  server.listen(config.apiPort, config.apiHost, () => {
    console.log(`[engine-api] listening http://${config.apiHost}:${config.apiPort}`);
  });
  return server;
}
