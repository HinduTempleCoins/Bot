// discord-engine-info.mjs — Hathor answers MELEK-Engine (testnet L2 token layer) questions on
// Discord and anywhere the chain reader is used. READ-ONLY: it queries the engine API and formats a
// reply. No keys, soft-fail-never-throw, injectable fetch so the offline tests need no network.
//
//   !engine                      → token overview (symbol · supply · issuer)
//   !token <SYMBOL>              → one token's details (+ tribe/reward rule if it's a SCOT tribe)
//   !engine balance @user [SYM]  → an account's engine balances (balance + staked)
//   !payouts <SYMBOL> [@author]  → recent SCOT payouts for a tribe
//
//   import { engineInfo } from './discord-engine-info.mjs'
//   await engineInfo('!token MANNA', { fetch, apiBase: 'http://127.0.0.1:8098' })

const DEFAULT_API = process.env.MELEK_ENGINE_API || 'http://127.0.0.1:8098';

function esc(s) { return String(s ?? '').replace(/[<>&`]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '`': "'" }[c])); }
function acct(s) { return String(s || '').replace(/^@/, '').trim().toLowerCase(); }

async function getJSON(f, url) {
  try {
    const r = await f(url);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Parse "!engine|!token|!payouts ..." → { kind, symbol?, account? } | null
export function parseEngine(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/^\s*[!/](engine|token|payouts?)\b\s*(.*)$/is);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const args = (m[2] || '').split('\n')[0].trim().split(/\s+/).filter(Boolean);
  if (verb === 'token') return { kind: 'token', symbol: (args[0] || '').toUpperCase() };
  if (verb.startsWith('payout')) return { kind: 'payouts', symbol: (args[0] || '').toUpperCase(), account: acct(args[1] || '') };
  // !engine [balance @user [SYM]] | [overview]
  if ((args[0] || '').toLowerCase() === 'balance') {
    return { kind: 'balance', account: acct(args[1] || ''), symbol: (args[2] || '').toUpperCase() };
  }
  if (args[0] && /^[A-Za-z]/.test(args[0])) return { kind: 'token', symbol: args[0].toUpperCase() };
  return { kind: 'overview' };
}

export async function engineInfo(text, { fetch: f = globalThis.fetch, apiBase = DEFAULT_API } = {}) {
  const q = parseEngine(text);
  if (!q) return '';
  const base = String(apiBase).replace(/\/$/, '');

  if (q.kind === 'overview') {
    const toks = await getJSON(f, `${base}/api/tokens`);
    if (!Array.isArray(toks) || !toks.length) return '⚙️ MELEK-Engine (testnet): no tokens found right now.';
    const lines = toks.slice(0, 15).map((t) => `• **${esc(t.symbol)}** — supply ${esc(t.supply ?? t.circulatingSupply ?? '?')} · issuer @${esc(t.issuer || '?')}`);
    return `⚙️ **MELEK-Engine (testnet)** — ${toks.length} token(s):\n${lines.join('\n')}\n_Ask \`!token <SYMBOL>\` for details._`;
  }

  if (q.kind === 'token') {
    if (!q.symbol) return 'Usage: `!token <SYMBOL>` — e.g. `!token MANNA`.';
    const arr = await getJSON(f, `${base}/api/tokens?symbol=${encodeURIComponent(q.symbol)}`);
    const t = Array.isArray(arr) ? arr[0] : arr;
    if (!t) return `⚙️ No MELEK-Engine token **${esc(q.symbol)}** on the testnet.`;
    let out = `⚙️ **${esc(t.symbol)}** (MELEK-Engine testnet)\n`
      + `• supply: ${esc(t.supply ?? t.circulatingSupply ?? '?')}${t.maxSupply ? ` / max ${esc(t.maxSupply)}` : ''}\n`
      + `• issuer: @${esc(t.issuer || '?')} · precision ${esc(t.precision ?? '?')}`;
    // is it a SCOT tribe?
    const tribes = await getJSON(f, `${base}/api/tribes`);
    const tribe = Array.isArray(tribes) ? tribes.find((r) => String(r.symbol).toUpperCase() === q.symbol) : null;
    if (tribe) {
      out += `\n• 🏷️ SCOT tribe: tag \`${esc(tribe.tag || q.symbol.toLowerCase())}\` · ${esc(tribe.emissionPerWindow ?? '?')}/window · author ${esc(tribe.authorBps ?? 5000) / 100}%`;
    }
    return out;
  }

  if (q.kind === 'balance') {
    if (!q.account) return 'Usage: `!engine balance @user [SYMBOL]`.';
    const url = `${base}/api/balances?account=${encodeURIComponent(q.account)}` + (q.symbol ? `&symbol=${encodeURIComponent(q.symbol)}` : '');
    const arr = await getJSON(f, url);
    if (!Array.isArray(arr) || !arr.length) return `💼 @${esc(q.account)} holds no${q.symbol ? ' ' + esc(q.symbol) : ''} MELEK-Engine tokens.`;
    const lines = arr.slice(0, 20).map((b) => `• ${esc(b.symbol)}: ${esc(b.balance ?? 0)}${b.stake && Number(b.stake) ? ` (+${esc(b.stake)} staked)` : ''}`);
    return `💼 **@${esc(q.account)}** — MELEK-Engine balances:\n${lines.join('\n')}`;
  }

  if (q.kind === 'payouts') {
    if (!q.symbol) return 'Usage: `!payouts <SYMBOL> [@author]`.';
    const url = `${base}/api/payouts?symbol=${encodeURIComponent(q.symbol)}` + (q.account ? `&author=${encodeURIComponent(q.account)}` : '');
    const arr = await getJSON(f, url);
    if (!Array.isArray(arr) || !arr.length) return `🏷️ No ${esc(q.symbol)} payouts recorded yet.`;
    const lines = arr.slice(0, 12).map((p) => `• @${esc(p.author)}/${esc(p.permlink)} → author ${esc(p.authorAmount ?? p.author_amount ?? '?')} · curators ${esc(p.curatorAmount ?? p.curator_amount ?? '?')}`);
    return `🏷️ **${esc(q.symbol)}** recent payouts:\n${lines.join('\n')}`;
  }

  return '';
}
