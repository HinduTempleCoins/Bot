// commands/alpha-report.mjs — Hathor's !commands menu LIVE on alpha.melek.salon.
//
// Phase 2 of BRIEF.md §10 is the deterministic command menu. This is the menu's first
// public surface: a read-only pass over the LIVE MELEK testnet that (a) runs every menu
// command against real chain data so visitors see real replies, and (b) scans recent
// posts + their replies for `!command` invocations in the wild and shows what Hathor
// WOULD reply — dry-run, nothing is broadcast from here (the posting key is not on this
// box; replies go live once the operator places it).
//
//   MELEK_RPC_URL=http://127.0.0.1:8090 node commands/alpha-report.mjs --out /var/www/alpha-melek-salon/commands
//
// Soft-fail like cheetah/alpha-report.mjs: if the RPC is down the page SAYS so.

import { writeFile, mkdir } from 'node:fs/promises';
import { handle, parseCommand, COMMANDS } from './menu.mjs';
import { priceUsd } from '../integrations/price-oracle.mjs';
import { readUserActivity } from '../witness/chain-reader.js';
import { detectCompletedStages, nextStageFor, loadStages } from '../tutorial/detector.js';
import { networkLabel } from '../integrations/melek-chain.mjs';

const RPC_URL = process.env.MELEK_RPC_URL || 'http://127.0.0.1:8090';
const POST_LIMIT = parseInt(process.env.COMMANDS_ALPHA_LIMIT || '20', 10);
const WITNESS_ACCOUNT = 'hathor';

let _fetch = globalThis.fetch;
export function __setFetch(f) { _fetch = f || globalThis.fetch; }

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- condenser RPC -----------------------------------------------------------

async function rpc(method, params) {
  const res = await _fetch(RPC_URL, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`rpc ${method} HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error.message || JSON.stringify(j.error)}`);
  return j.result;
}

async function chainHead() {
  try {
    const p = await rpc('condenser_api.get_dynamic_global_properties', []);
    return { headBlock: p.head_block_number, witness: p.current_witness, time: p.time };
  } catch { return null; }
}

// Minimal adapter shim so witness/chain-reader.js (written against a dhive-style
// client) runs over the raw condenser RPC with no extra dependency.
function adapterShim() {
  return {
    client: {
      call: (api, method, params) => rpc(`${api}.${method}`, params),
      database: {
        getAccounts: (names) => rpc('condenser_api.get_accounts', [names]),
        call: (method, params) => rpc(`condenser_api.${method}`, params),
      },
    },
  };
}

// ---- live deps for the menu ----------------------------------------------------
// The same injection seam the tests use, wired to the real testnet.

export function liveDeps() {
  return {
    getAccount: async (name) => {
      const accounts = await rpc('condenser_api.get_accounts', [[name]]);
      const a = accounts?.[0];
      if (!a) return null;
      return {
        balance: a.balance,
        vesting_shares: a.vesting_shares,
        savings_balance: a.savings_balance,
        post_count: a.post_count,
        reputation: a.reputation,
      };
    },
    getWitness: async (name) => {
      const w = await rpc('condenser_api.get_witness_by_account', [name]);
      if (!w) return null;
      return {
        url: w.url,
        signing_key: w.signing_key,
        last_confirmed_block_num: w.last_confirmed_block_num,
        total_missed: w.total_missed,
      };
    },
    getPrice: (symbol) => priceUsd(symbol),
    getTutorialProgress: async (account) => {
      const accounts = await rpc('condenser_api.get_accounts', [[account]]);
      if (!accounts?.[0]) return null;
      const activity = await readUserActivity(adapterShim(), account);
      const completions = detectCompletedStages(activity);
      // Only stages the detector can actually evaluate (the Tier-A spine).
      const tierA = loadStages().stages.filter((s) => s.tier === 'A' && s.key in completions);
      const stages = tierA.map((s) => ({
        key: s.key,
        label: s.label,
        complete: Boolean(completions[s.key]?.complete),
      }));
      const next = nextStageFor(activity);
      return {
        stages,
        next: next && next.tier === 'A' ? { key: next.key, label: next.label } : null,
      };
    },
  };
}

// ---- pull recent posts + replies, find !commands in the wild --------------------

/** Recent root posts + their direct replies, normalized. Soft-fails to []. */
export async function fetchRecentContent({ limit = POST_LIMIT } = {}) {
  try {
    const raw = await rpc('condenser_api.get_discussions_by_created', [{ tag: '', limit }]);
    const posts = (raw || []).map((p) => ({
      author: p.author, permlink: p.permlink, body: p.body || '', created: p.created, kind: 'post',
    })).filter((p) => p.author && p.body);
    const out = [...posts];
    for (const p of posts) {
      try {
        const replies = await rpc('condenser_api.get_content_replies', [p.author, p.permlink]);
        for (const r of replies || []) {
          if (r.author && r.body) {
            out.push({ author: r.author, permlink: r.permlink, body: r.body, created: r.created, kind: 'reply' });
          }
        }
      } catch { /* replies are best-effort; the post set stands */ }
    }
    return out;
  } catch (e) {
    return Object.assign([], { error: e.message });
  }
}

/**
 * Find `!command` invocations in content and compute the reply Hathor WOULD post.
 * Never broadcasts. The witness's own comments are skipped (it doesn't command itself).
 */
export async function runMenuOnContent(content, deps) {
  const found = [];
  for (const item of content) {
    if (item.author === WITNESS_ACCOUNT) continue;
    const parsed = parseCommand(item.body);
    if (!parsed) continue;
    let reply;
    try {
      reply = await handle(item.body, deps);
    } catch (e) {
      reply = `(error: ${e.message})`;
    }
    found.push({
      author: item.author, permlink: item.permlink, created: item.created, kind: item.kind,
      command: item.body.trim().split('\n')[0].slice(0, 120),
      reply,
    });
  }
  return found;
}

// ---- the demo: every menu command run against the live chain ---------------------

const DEMO_INVOCATIONS = [
  '!help',
  `!witness ${WITNESS_ACCOUNT}`,
  `!balance ${WITNESS_ACCOUNT}`,
  '!price btc',
  '!signup',
  `!tutorial ${WITNESS_ACCOUNT}`,
];

export async function runDemo(deps) {
  const out = [];
  for (const text of DEMO_INVOCATIONS) {
    let reply;
    try {
      reply = await handle(text, deps);
    } catch (e) {
      reply = `(error: ${e.message})`;
    }
    out.push({ command: text, reply });
  }
  return out;
}

// ---- the report page --------------------------------------------------------------

export function reportHtml({ demo, wild, head, generatedAt, rpcError }) {
  const demoRows = demo.map((d) => `<tr>
      <td><code>${esc(d.command)}</code></td>
      <td><pre>${esc(d.reply)}</pre></td>
    </tr>`).join('\n');

  const wildRows = wild.map((w) => `<tr>
      <td>@${esc(w.author)}/${esc(w.permlink)}<div class=mut>${esc(w.kind)} · ${esc(w.created)}</div></td>
      <td><code>${esc(w.command)}</code></td>
      <td><pre>${esc(w.reply)}</pre></td>
    </tr>`).join('\n');

  const menuList = COMMANDS.slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `<li><code>!${esc(c.name)}${c.args ? ' ' + esc(c.args) : ''}</code> — ${esc(c.help.split('\n')[0])}</li>`)
    .join('\n');

  return `<!doctype html>
<html lang=en><head>
<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>!commands — Hathor's menu on the MELEK Testnet</title>
<meta name=robots content="noindex,follow">
<style>
  :root{--bg:#0b0d10;--card:#14181d;--ink:#e8edf2;--mut:#8b97a6;--acc:#d9a441;--line:#222a33}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  header{border-bottom:1px solid var(--line);padding:14px 20px;display:flex;gap:18px;align-items:center}
  header .brand{font-weight:700;color:var(--acc)} header a{color:var(--mut);text-decoration:none;font-size:14px}
  header .netlabel{font-size:11px;font-weight:700;letter-spacing:.3px;color:var(--acc);
    border:1px solid var(--acc);border-radius:8px;padding:2px 8px}
  .wrap{max-width:980px;margin:0 auto;padding:34px 20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin:14px 0}
  h1{font-size:22px;margin:0 0 6px} h2{font-size:17px;margin:0 0 6px} .mut{color:var(--mut);font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:8px} td,th{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
  th{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.4px}
  a{color:var(--acc)} code{color:var(--acc);font-size:13px}
  pre{white-space:pre-wrap;background:#11151a;border:1px solid var(--line);border-radius:6px;padding:10px;font-size:12px;margin:0}
  ul{margin:6px 0;padding-left:20px} li{margin:3px 0}
</style></head><body>
<header><span class=brand>MELEK</span><span class=netlabel>${esc(networkLabel())}</span><a href="/trending">Trending</a><a href="/cheetah/">Cheetah</a><a href="/commands/">!commands</a><a href="/">Disclaimer</a></header>
<div class=wrap>
  <div class=card>
    <h1>⚡ !commands — Hathor's deterministic menu</h1>
    <p class=mut>Phase 2 of the MELEK AI Witness: a fixed menu of <b>deterministic commands</b>
      (no LLM, no surprises) anyone can use in a comment or reply on the chain. This page is the
      menu running against the <b>live testnet</b>: real lookups, real chain data. Replies shown
      here are a <b>dry-run</b> — on-chain replying switches on when the witness's posting key is
      installed on its host.</p>
    <p class=mut>${head
      ? `chain head <code>#${esc(String(head.headBlock))}</code> · witness <code>@${esc(head.witness)}</code> · ${esc(head.time)} UTC`
      : `<b>testnet RPC unreachable</b>${rpcError ? ` — ${esc(rpcError)}` : ''} (the node may be restarting; this page keeps the last good run)`}
      · report generated ${esc(generatedAt)}</p>
    <ul>${menuList}</ul>
  </div>
  <div class=card>
    <h2>Live demo — every command, real chain data</h2>
    <table>
      <tr><th>command</th><th>Hathor's reply</th></tr>
      ${demoRows || '<tr><td colspan=2 class=mut>RPC unreachable — no live demo this run.</td></tr>'}
    </table>
  </div>
  <div class=card>
    <h2>Found in the wild — ${wild.length} invocation${wild.length === 1 ? '' : 's'} in recent posts &amp; replies</h2>
    <table>
      <tr><th>where</th><th>command</th><th>what Hathor would reply (dry-run)</th></tr>
      ${wildRows || '<tr><td colspan=3 class=mut>No !commands found in recent testnet content. Try one — post a comment starting with <code>!help</code>.</td></tr>'}
    </table>
  </div>
  <p class=mut>Raw data: <a href="report.json">report.json</a></p>
</div>
</body></html>`;
}

// ---- CLI -----------------------------------------------------------------------------

export async function buildReport() {
  const head = await chainHead();
  const deps = liveDeps();
  const demo = head ? await runDemo(deps) : [];
  const content = await fetchRecentContent();
  const wild = await runMenuOnContent(content, deps);
  return {
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
    head,
    rpcError: content.error || (head ? null : 'RPC unreachable'),
    demo,
    wild,
  };
}

if (process.argv[1] && process.argv[1].endsWith('alpha-report.mjs')) {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx > -1 ? process.argv[outIdx + 1] : '/tmp/commands-alpha';
  const report = await buildReport();
  await mkdir(outDir, { recursive: true });
  await writeFile(`${outDir}/index.html`, reportHtml(report));
  await writeFile(`${outDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(`[commands-alpha] ${report.demo.length} demo commands, ${report.wild.length} found in the wild → ${outDir}/index.html` +
    (report.rpcError ? ` (RPC error: ${report.rpcError})` : ''));
}
