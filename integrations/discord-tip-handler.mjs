// discord-tip-handler.mjs — the !tip / `/tip` command handler that connects the live Discord bot to
// the MELEK chain (the PIZZA-bot hookup). Parses the command via the tested discord-chain-bridge,
// applies the anti-flood / anti-drain caps, builds the on-chain tip op, and (for a TOKEN tip) emits
// the MELEK-Engine custom_json the host broadcasts as @hathor. The bot holds NO key — the broadcaster
// + the Hathor key are INJECTED by the host (index.js fetches the JIT vault key), so this module is
// fully offline-testable and never logs a key.
//
//   const out = await handleTip('/tip @alice 5 MANNA', { from: 'bob', deps: { broadcast, ledger, rules } });
//   -> { ok, reply, op? }   (op is the Graphene op the host broadcast; reply is the Discord message)

import { parseCommand, makeTipLedger, BRIDGE_DEFAULTS } from './discord-chain-bridge.mjs';

const SIDECHAIN = 'mse-testnet-melek';

// engine token transfer op (active auth) — what Hathor signs to tip a token.
export function tokenTipOp({ from, to, symbol, amount }) {
  return ['custom_json', {
    required_auths: [from], required_posting_auths: [], id: SIDECHAIN,
    json: JSON.stringify({ contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol, to, quantity: String(amount) } }),
  }];
}

// Parse "/tip @user <amount> [SYMBOL]" -> { to, amount, symbol }. Reuses the bridge parser for to/amount
// and pulls an optional uppercase token symbol (default: the configured native tip token).
export function parseTip(text, { defaultSymbol = 'TESTS' } = {}) {
  const cmd = parseCommand(String(text).replace(/^\//, '!')); // accept both / and ! prefixes
  if (!cmd || cmd.cmd !== 'tip') return null;
  const sym = (cmd.raw || []).map((s) => String(s).toUpperCase()).find((s) => /^[A-Z]{1,10}$/.test(s) && s !== (cmd.to || '').toUpperCase());
  return { to: cmd.to, amount: cmd.amount, symbol: sym || defaultSymbol };
}

/**
 * Handle a tip command end to end. `deps`:
 *   broadcast(op)        -> broadcasts the op as @hathor (the bot, the tipper). REQUIRED for a real tip.
 *   tipFrom              -> the on-chain account that tips (default 'hathor').
 *   ledger, rules        -> anti-abuse (default a fresh ledger + BRIDGE_DEFAULTS).
 *   now                  -> clock (testable).
 */
export async function handleTip(text, { from, deps = {} } = {}) {
  const rules = deps.rules || BRIDGE_DEFAULTS;
  const ledger = deps.ledger || makeTipLedger();
  const now = deps.now || Date.now();
  const tipFrom = deps.tipFrom || 'hathor';

  const t = parseTip(text);
  if (!t) return { ok: false, kind: 'noop', reply: '' };
  if (!from) return { ok: false, reply: 'I could not tell who is tipping.' };
  if (!t.to) return { ok: false, reply: 'Usage: `/tip @user <amount> [TOKEN]`' };
  const amount = Number(t.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reply: 'Tip amount must be a positive number.' };

  // anti-flood / anti-drain (per Discord tipper)
  const gate = ledger.check(from, amount, rules, now);
  if (!gate.ok) return { ok: false, reply: `🛑 ${gate.reason}` };

  if (!deps.broadcast) return { ok: false, reply: 'Tipping is not wired to the chain here.' };
  const op = tokenTipOp({ from: tipFrom, to: t.to, symbol: t.symbol, amount });
  try {
    const r = await deps.broadcast(op);
    if (r && r.error) return { ok: false, reply: `Tip failed: ${String(r.error).slice(0, 80)}` };
    ledger.record(from, amount, now);
    return { ok: true, op, reply: `🍕 @${tipFrom} tipped **${amount} ${t.symbol}** to @${t.to} on MELEK! (tx ${r && (r.id || r.trx_id) ? String(r.id || r.trx_id).slice(0, 10) : 'sent'})` };
  } catch (e) {
    return { ok: false, reply: `Tip failed: ${String(e.message || e).slice(0, 80)}` };
  }
}
