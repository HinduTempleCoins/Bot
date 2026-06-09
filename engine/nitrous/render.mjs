/**
 * nitrous/render.mjs — the Nitrous equivalent: a per-token front-end GENERATOR.
 *
 * Hive-Engine's Nitrous (steem-apps/condenser fork) gives each Scotbot tribe
 * its own branded condenser. This is the same idea, minimised: a FACTORY that,
 * given a token symbol + a theme config, renders a branded, read-only feed/site
 * for that one token — its posts, holders, rewards, and a leaderboard. One
 * function, many tokens; nothing hardcoded to a single tribe.
 *
 * Design rules (house style + engine model):
 *   - Template-based, no build step, no framework (matches engine/ui/render.mjs).
 *   - PURE + read-only: takes a state snapshot + symbol + theme, returns an
 *     HTML string. No keys, no broadcast, no network here — the page fetches
 *     the engine's existing read API (/contracts/*) client-side for live data.
 *   - esc() ALL interpolation (theme strings + token/account names are
 *     attacker-influenced: a token name or account is user-chosen at L1).
 *   - Reuses the reward contract's collections (rewardPosts / rewardVotes) and
 *     the tokens/balances collections — no new data source.
 *
 * Theme config (all optional; sensible defaults):
 *   { name, tagline, accent, bg, ink, apiBase, l1ExplorerBase, logoText }
 */

import { fromBaseUnits } from '../lib/decimal.mjs';

/** HTML-escape every interpolated value. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

/** A safe hex/CSS-colour or fall back. Prevents style-attr injection. */
function safeColor(c, fallback) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]{3,20}$/.test(c) ? c : fallback;
}

const DEFAULT_THEME = {
  tagline: 'A MELEK-Engine token tribe',
  accent: '#d8b35a',
  bg: '#0d0b14',
  card: '#16131f',
  ink: '#e9e4f5',
  mut: '#9a90b5',
  line: '#2a2438',
  apiBase: '', // same-origin by default; set to the engine API base if split
  l1ExplorerBase: '', // e.g. an explorer to link posts; blank = no links
  logoText: '◆',
};

/**
 * Pull a token's view + holders + reward posts/leaderboard out of a state
 * snapshot. Pure. Returns null if the token does not exist.
 */
export function tokenSnapshot(state, symbol) {
  const sym = String(symbol || '').toUpperCase();
  const token = state.findOne('tokens', { symbol: sym });
  if (!token) return null;
  const prec = token.precision;

  const holders = state
    .find('balances', { symbol: sym })
    .filter((b) => BigInt(b.balance) > 0n || BigInt(b.stake || '0') > 0n)
    .map((b) => ({
      account: b.account,
      balance: fromBaseUnits(BigInt(b.balance), prec),
      stake: fromBaseUnits(BigInt(b.stake || '0'), prec),
      _sort: BigInt(b.balance) + BigInt(b.stake || '0'),
    }))
    .sort((a, b) => (b._sort > a._sort ? 1 : b._sort < a._sort ? -1 : a.account.localeCompare(b.account)));

  const posts = state
    .find('rewardPosts', { symbol: sym })
    .map((p) => ({
      author: p.author,
      permlink: p.permlink,
      postKey: p.postKey,
      votes: p.votes,
      openedBlock: p.openedBlock,
      maturesBlock: p.maturesBlock,
      paid: p.paid,
      emitted: p.emitted || null,
      _w: BigInt(p.rewardWeight || '0'),
    }))
    .sort((a, b) => (b._w > a._w ? 1 : b._w < a._w ? -1 : a.postKey.localeCompare(b.postKey)));

  const rule = state.findOne('rewardRules', { symbol: sym });
  const ruleView = rule
    ? {
        emissionPerWindow: fromBaseUnits(BigInt(rule.emissionPerWindow), prec),
        windowBlocks: rule.windowBlocks,
        authorPct: (rule.authorBps / 100).toFixed(2),
        curatorPct: ((10000 - rule.authorBps) / 100).toFixed(2),
        curve: rule.curve,
        enabled: rule.enabled,
      }
    : null;

  // Earnings leaderboard: total emitted to each author across paid posts.
  const earned = new Map();
  for (const p of posts) {
    if (p.paid && p.emitted) {
      const cur = earned.get(p.author) || 0;
      earned.set(p.author, cur + Number(p.emitted));
    }
  }
  const leaderboard = [...earned.entries()]
    .map(([account, total]) => ({ account, total: total.toFixed(prec) }))
    .sort((a, b) => Number(b.total) - Number(a.total) || a.account.localeCompare(b.account));

  return {
    token: {
      symbol: token.symbol,
      name: token.name,
      issuer: token.issuer,
      precision: prec,
      supply: fromBaseUnits(BigInt(token.supply), prec),
      maxSupply: fromBaseUnits(BigInt(token.maxSupply), prec),
      url: token.url,
      immutable: token.supplyCapImmutable,
    },
    rule: ruleView,
    holders,
    posts,
    leaderboard,
  };
}

/**
 * renderTokenSite — THE FACTORY. Given a state snapshot, a token symbol, and an
 * optional theme, return a complete branded read-only HTML page for that token.
 *
 * If the token doesn't exist, returns a small 404-style page (soft-fail; never
 * throws), so a generator serving arbitrary /:symbol routes degrades cleanly.
 */
export function renderTokenSite(state, symbol, theme = {}) {
  const t = { ...DEFAULT_THEME, ...theme };
  const accent = safeColor(t.accent, DEFAULT_THEME.accent);
  const bg = safeColor(t.bg, DEFAULT_THEME.bg);
  const card = safeColor(t.card, DEFAULT_THEME.card);
  const ink = safeColor(t.ink, DEFAULT_THEME.ink);
  const mut = safeColor(t.mut, DEFAULT_THEME.mut);
  const line = safeColor(t.line, DEFAULT_THEME.line);

  const snap = tokenSnapshot(state, symbol);
  if (!snap) return renderMissing(symbol, t, { accent, bg, ink });

  const { token, rule, holders, posts, leaderboard } = snap;
  const title = t.name || token.name || token.symbol;

  const holderRows =
    holders.length
      ? holders
          .slice(0, 50)
          .map(
            (h, i) => `<tr><td class="rank">${i + 1}</td><td>@${esc(h.account)}</td>
        <td class="num">${esc(h.balance)}</td><td class="num">${esc(h.stake)}</td></tr>`,
          )
          .join('\n')
      : `<tr><td colspan="4" class="empty">no holders yet</td></tr>`;

  const postRows =
    posts.length
      ? posts
          .slice(0, 50)
          .map((p) => {
            const link = t.l1ExplorerBase
              ? `<a href="${esc(t.l1ExplorerBase)}/@${esc(p.author)}/${esc(p.permlink)}">@${esc(p.author)}/${esc(p.permlink)}</a>`
              : `@${esc(p.author)}/${esc(p.permlink)}`;
            const status = p.paid
              ? `<span class="pill paid">paid ${esc(p.emitted || '0')} ${esc(token.symbol)}</span>`
              : `<span class="pill">matures @block ${esc(p.maturesBlock)}</span>`;
            return `<tr><td>${link}</td><td class="num">${esc(p.votes)}</td><td>${status}</td></tr>`;
          })
          .join('\n')
      : `<tr><td colspan="3" class="empty">no reward posts yet</td></tr>`;

  const boardRows =
    leaderboard.length
      ? leaderboard
          .slice(0, 25)
          .map(
            (l, i) =>
              `<tr><td class="rank">${i + 1}</td><td>@${esc(l.account)}</td><td class="num">${esc(l.total)} ${esc(token.symbol)}</td></tr>`,
          )
          .join('\n')
      : `<tr><td colspan="3" class="empty">no rewards distributed yet</td></tr>`;

  const ruleBlock = rule
    ? `<p><span class="pill">${esc(rule.emissionPerWindow)} ${esc(token.symbol)} / window</span>
       <span class="pill">window ${esc(rule.windowBlocks)} blocks</span>
       <span class="pill">author ${esc(rule.authorPct)}% · curator ${esc(rule.curatorPct)}%</span>
       <span class="pill">${esc(rule.curve)} curve</span>
       <span class="pill ${rule.enabled ? 'paid' : ''}">${rule.enabled ? 'emitting' : 'paused'}</span></p>`
    : `<p class="sub">No reward pool configured for this token yet.</p>`;

  const apiBase = esc(t.apiBase || '');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(token.symbol)}</title>
<style>
:root{--bg:${bg};--card:${card};--ink:${ink};--mut:${mut};--accent:${accent};--line:${line}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{padding:30px 20px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,${card},${bg})}
.brand{display:flex;align-items:center;gap:12px;max-width:1000px;margin:0 auto}
.logo{font-size:30px;color:var(--accent);line-height:1}
h1{margin:0;font-size:24px;letter-spacing:.5px}h1 b{color:var(--accent)}
.tag{color:var(--mut);font-size:13px;margin-top:2px}
main{max-width:1000px;margin:0 auto;padding:20px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:16px 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.stat .k{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.4px}
.stat .v{font-size:20px;font-weight:700;color:var(--accent);margin-top:4px;font-variant-numeric:tabular-nums}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin:16px 0}
h2{font-size:15px;margin:0 0 12px;color:var(--accent);text-transform:uppercase;letter-spacing:.5px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.4px}
.num{text-align:right;font-variant-numeric:tabular-nums}.rank{color:var(--mut);width:36px}
.empty{color:var(--mut);text-align:center;padding:18px}
.pill{display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--mut);margin:2px 4px 2px 0}
.pill.paid{color:var(--accent);border-color:var(--accent)}
.sub{color:var(--mut);font-size:13px}a{color:var(--accent)}
footer{max-width:1000px;margin:0 auto;padding:24px 20px;color:var(--mut);font-size:12px;border-top:1px solid var(--line)}
@media(max-width:680px){.stats{grid-template-columns:1fr 1fr}}
</style></head>
<body>
<header><div class="brand">
  <div class="logo">${esc(t.logoText)}</div>
  <div><h1>${esc(title)} <b>${esc(token.symbol)}</b></h1>
  <div class="tag">${esc(t.tagline)}</div></div>
</div></header>
<main>
  <div class="stats">
    <div class="stat"><div class="k">Supply</div><div class="v">${esc(token.supply)}</div></div>
    <div class="stat"><div class="k">Max Supply</div><div class="v">${esc(token.maxSupply)}${token.immutable ? ' 🔒' : ''}</div></div>
    <div class="stat"><div class="k">Holders</div><div class="v">${esc(holders.length)}</div></div>
    <div class="stat"><div class="k">Issuer</div><div class="v" style="font-size:15px">@${esc(token.issuer)}</div></div>
  </div>

  <div class="card"><h2>Reward Pool</h2>${ruleBlock}</div>

  <div class="card"><h2>Posts</h2>
    <table><thead><tr><th>Post</th><th class="num">Votes</th><th>Status</th></tr></thead>
    <tbody>${postRows}</tbody></table>
  </div>

  <div class="card"><h2>Rewards Leaderboard</h2>
    <table><thead><tr><th>#</th><th>Account</th><th class="num">Earned</th></tr></thead>
    <tbody>${boardRows}</tbody></table>
  </div>

  <div class="card"><h2>Holders</h2>
    <table><thead><tr><th>#</th><th>Account</th><th class="num">Liquid</th><th class="num">Staked</th></tr></thead>
    <tbody>${holderRows}</tbody></table>
  </div>
</main>
<footer>
  Read-only ${esc(token.symbol)} tribe page · generated by MELEK-Engine nitrous ·
  data from <a href="${apiBase}/contracts/tokens?symbol=${esc(token.symbol)}">/contracts/tokens</a>.
  Keys never touch this page.
</footer>
<script>
// Optional live refresh of supply/holders from the engine read API. Read-only;
// degrades silently if the API base is unset or unreachable (soft-fail).
var API=${JSON.stringify(t.apiBase || '')};var SYM=${JSON.stringify(token.symbol)};
async function tick(){try{
  var r=await fetch(API+'/contracts/tokens?symbol='+encodeURIComponent(SYM));
  if(!r.ok)return;var rows=await r.json();var t=rows&&rows[0];if(!t)return;
  var v=document.querySelectorAll('.stat .v');if(v[0])v[0].textContent=t.supply;
}catch(e){}}
if(API){tick();setInterval(tick,15000);}
</script>
</body></html>`;
}

/** Small soft-fail page for an unknown symbol. Never throws. */
function renderMissing(symbol, t, c) {
  const sym = esc(String(symbol || '').toUpperCase());
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sym} — not found</title>
<style>body{margin:0;background:${c.bg};color:${c.ink};font:16px/1.6 system-ui,sans-serif;
display:grid;place-items:center;height:100vh;text-align:center}a{color:${c.accent}}
h1{color:${c.accent}}</style></head><body><div>
<h1>${esc(t.logoText)} ${sym}</h1>
<p>No such token on this MELEK-Engine.</p>
<p class="sub"><a href="/">browse tokens</a></p>
</div></body></html>`;
}

/**
 * makeNitrousHandler — bind the generator to a live State as an HTTP handler.
 * Routes:  /            -> simple index of tokens that have a page
 *          /:SYMBOL     -> the branded token site
 * `themeFor(symbol)` lets the caller supply per-token theme config (e.g. from a
 * registry); defaults to the engine theme. Read-only, no keys, soft-fail.
 */
export function makeNitrousHandler(state, themeFor = () => ({})) {
  return function handler(req, res) {
    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }
    const send = (code, html) => {
      res.writeHead(code, {
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      });
      res.end(html);
    };
    try {
      if (pathname === '/' || pathname === '/index.html') {
        return send(200, renderIndex(state));
      }
      const sym = pathname.replace(/^\/+/, '').split('/')[0].toUpperCase();
      const html = renderTokenSite(state, sym, themeFor(sym) || {});
      const exists = !!state.findOne('tokens', { symbol: sym });
      return send(exists ? 200 : 404, html);
    } catch (e) {
      return send(500, `<!doctype html><title>error</title><pre>${esc(e.message)}</pre>`);
    }
  };
}

/** Index of every token (each links to its generated page). */
function renderIndex(state) {
  const rows = state
    .collection('tokens')
    .map((t) => `<li><a href="/${esc(t.symbol)}">${esc(t.symbol)}</a> — ${esc(t.name)} (@${esc(t.issuer)})</li>`)
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MELEK-Engine · tribes</title>
<style>body{margin:0;background:#0d0b14;color:#e9e4f5;font:15px/1.6 system-ui,sans-serif;padding:30px}
a{color:#d8b35a}h1 b{color:#d8b35a}ul{line-height:2}</style></head>
<body><h1>MELEK-<b>Engine</b> token tribes</h1>
<p>Each token has a generated read-only front-end:</p>
<ul>${rows || '<li>no tokens yet</li>'}</ul></body></html>`;
}
