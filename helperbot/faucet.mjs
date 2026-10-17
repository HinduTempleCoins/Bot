// faucet.mjs — !faucet: route a user to the faucet(s) that ACTUALLY work today, checked live at call time.
//
//   !faucet                 → list faucets with their live status
//   !faucet prana 0x…       → PRANA TESTNET (alpha, chainId 108369) drip to that public address
//   !faucet melek [testnet] → MELEK has no gas and no drip: the "faucet" is FREE ACCOUNT CREATION (keys are
//                             generated in YOUR browser; Hathor's welcomer then grants TESTS/MELEK + POWER)
//   !faucet prana mainnet   → Under Construction (no mainnet PRANA faucet — PRANA is mined)
//
// The user supplies only a PUBLIC address or account name. The bot never asks for, sees or holds a key; the
// PRANA faucet signs with its own node-managed account server-side.
//
// Anti-abuse in front of the faucet's own 24h/address limit: per-chat-user cooldown, per-address cooldown,
// platform account-age gate (Discord snowflake age), optional karma gate (injected reader), and a global
// daily drip cap. The bot only calls the drip endpoint when HELPERBOT_FAUCET_LIVE=1; otherwise it is a
// dry run that says exactly what it would do.

import { getText, postJSON, prana, melek, CFG as LIVE } from './live.mjs';
import { defaultStore, dayKey } from './store.mjs';
import { scanSecrets } from './secret-guard.mjs';
import { PRANA_ALPHA_CHAIN_ID } from './addresses.mjs';

export const UNDER_CONSTRUCTION = (what) => `🚧 ${what} is under construction and not available yet.`;

export function faucetConfig(env = process.env) {
  return {
    pranaFaucetUrl: env.PRANA_FAUCET_URL || 'https://faucet.alpha.soapbox.community',
    melekTestnetHealth: env.MELEK_FAUCET_TESTNET_HEALTH || 'https://alpha.melek.salon/faucet/health',
    melekMainnetHealth: env.MELEK_FAUCET_MAINNET_HEALTH || 'https://melek.salon/faucet/health',
    userCooldownH: Number(env.HELPERBOT_FAUCET_USER_COOLDOWN_H || 24),
    addrCooldownH: Number(env.HELPERBOT_FAUCET_ADDR_COOLDOWN_H || 24),
    minAccountAgeDays: Number(env.HELPERBOT_FAUCET_MIN_AGE_DAYS || 7),
    minKarma: Number(env.HELPERBOT_FAUCET_MIN_KARMA || 0),
    globalDailyDrips: Number(env.HELPERBOT_FAUCET_DAILY_CAP || 50),
    live: env.HELPERBOT_FAUCET_LIVE === '1',
  };
}

/** Live status of every faucet. Each entry: { id, works, detail }. Never throws. */
export async function probeFaucets(cfg = faucetConfig()) {
  const [page, alphaChain, mt, mm] = await Promise.all([
    getText(cfg.pranaFaucetUrl + '/'), prana.chainId('alpha'),
    getText(cfg.melekTestnetHealth), getText(cfg.melekMainnetHealth),
  ]);
  const j = (t) => { try { return JSON.parse(t); } catch { return null; } };
  const pageOk = !!page && /Get test PRANA/i.test(page) && !/not configured/i.test(page);
  const chainOk = alphaChain === PRANA_ALPHA_CHAIN_ID;
  const mtj = j(mt);
  const mmj = j(mm);
  return {
    'prana-testnet': { works: pageOk && chainOk, detail: !page ? 'faucet page unreachable' : !pageOk ? 'faucet page not serving drips' : !chainOk ? 'alpha chain RPC unreachable' : 'drip page + alpha chain (108369) live' },
    'melek-testnet': { works: !!(mtj && mtj.ok && mtj.testnet), detail: mtj && mtj.ok ? `account-creation faucet live (creator @${mtj.creator})` : 'account faucet health check failed' },
    'melek-mainnet': { works: !!(mmj && mmj.ok && mmj.mainnet), detail: mmj && mmj.ok ? `account-creation faucet live (creator @${mmj.creator})` : 'account faucet health check failed' },
    'prana-mainnet': { works: false, detail: 'no mainnet faucet — PRANA is mined' },
  };
}

export async function faucetList(cfg = faucetConfig()) {
  const s = await probeFaucets(cfg);
  const mark = (x) => (x.works ? '✅' : '🚧');
  return [
    '**Faucets** (checked live just now):',
    `${mark(s['prana-testnet'])} PRANA testnet gas — \`!faucet prana 0xYourAddress\` · ${s['prana-testnet'].detail}`,
    `${mark(s['melek-testnet'])} MELEK testnet — free account + welcome grant: \`!faucet melek testnet\` · ${s['melek-testnet'].detail}`,
    `${mark(s['melek-mainnet'])} MELEK mainnet — free account (may be invite-gated): \`!faucet melek\` · ${s['melek-mainnet'].detail}`,
    `🚧 PRANA mainnet — no faucet; mine it: \`!guide mining\``,
    'I only ever need a PUBLIC address or account name.',
  ].join('\n');
}

const HOUR = 3600_000;

/** Anti-abuse gate — PURE over the store. Returns { ok, why }. */
export function gate({ store, platform, userId, address, accountCreatedAt, karma, now }, cfg) {
  const u = store.get(`faucet:user:${platform}:${userId}`, null);
  if (u && now - u < cfg.userCooldownH * HOUR) return { ok: false, why: `You already used the faucet — again in ${Math.ceil((cfg.userCooldownH * HOUR - (now - u)) / HOUR)}h.` };
  const a = store.get(`faucet:addr:${String(address).toLowerCase()}`, null);
  if (a && now - a < cfg.addrCooldownH * HOUR) return { ok: false, why: 'That address was funded recently — try again tomorrow.' };
  if (cfg.minAccountAgeDays > 0) {
    if (!accountCreatedAt) return { ok: false, why: 'I can\'t confirm your chat account\'s age here — use the faucet page directly.' };
    if ((now - accountCreatedAt) / (24 * HOUR) < cfg.minAccountAgeDays) return { ok: false, why: `Your chat account must be at least ${cfg.minAccountAgeDays} days old to use the bot faucet.` };
  }
  if (cfg.minKarma > 0 && !(Number(karma) >= cfg.minKarma)) return { ok: false, why: `The bot faucet needs ${cfg.minKarma}+ karma.` };
  const g = Number(store.get(`faucet:global:${dayKey(now)}`, 0));
  if (g >= cfg.globalDailyDrips) return { ok: false, why: 'Today\'s faucet budget is used up — back at 00:00 UTC.' };
  return { ok: true };
}

/**
 * faucetCommand(args, { platform, userId, accountCreatedAt, karma }, { store, cfg, now })
 * Never throws; always returns reply text.
 */
export async function faucetCommand(args = [], who = {}, { store = defaultStore(), cfg = faucetConfig(), now = Date.now() } = {}) {
  try {
    const which = String(args[0] || '').toLowerCase();
    const rest = args.slice(1).map((s) => String(s));
    if (!which) return await faucetList(cfg);

    if (which === 'melek' || which === 'tests') {
      const net = rest.includes('testnet') || which === 'tests' ? 'melek-testnet' : 'melek-mainnet';
      const s = (await probeFaucets(cfg))[net];
      if (!s.works) return UNDER_CONSTRUCTION(`The MELEK ${net === 'melek-testnet' ? 'testnet' : 'mainnet'} account faucet`) + ` (${s.detail})`;
      const url = net === 'melek-testnet' ? 'https://alpha.melek.salon/account/signup.html' : 'https://wallet.melek.salon/signup';
      return [
        `MELEK has no gas, so its faucet is a FREE ACCOUNT: open ${url}`,
        '1. Pick a name → "Generate my keys" (made in YOUR browser) 2. Save them 3. Re-type the master password 4. "Create my account".',
        `Hathor's welcomer then sends a small ${net === 'melek-testnet' ? 'TESTS' : 'MELEK'} grant + POWER. Want me to walk you through and check each step on-chain? \`!guide signup @yourname${net === 'melek-testnet' ? ' testnet' : ' mainnet'}\``,
        'Never paste your keys or password here.',
      ].join('\n');
    }

    if (which === 'prana') {
      if (rest.includes('mainnet')) return UNDER_CONSTRUCTION('A mainnet PRANA faucet') + ' Mainnet PRANA is mined — `!guide mining`.';
      const address = rest.find((x) => /^0x/i.test(x)) || '';
      if (scanSecrets(rest.join(' ')).hit) return 'That looks like a private key — never share it. I only need your PUBLIC 0x address (42 characters).';
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return 'Usage: `!faucet prana 0xYourAddress` — your PUBLIC address (0x + 40 hex). Testnet only (chain 108369).';
      const s = (await probeFaucets(cfg))['prana-testnet'];
      if (!s.works) return UNDER_CONSTRUCTION('The PRANA testnet faucet') + ` (${s.detail})`;
      const g = gate({ store, platform: who.platform, userId: who.userId, address, accountCreatedAt: who.accountCreatedAt, karma: who.karma, now }, cfg);
      if (!g.ok) return g.why;
      if (!cfg.live) {
        return `DRY RUN (bot faucet not switched on yet): I would request a testnet PRANA drip to ${address}. You can use the faucet yourself right now: ${cfg.pranaFaucetUrl}/`;
      }
      const r = await postJSON(`${cfg.pranaFaucetUrl}/api/drip`, { address });
      if (!r || !r.ok) {
        const msg = r && (r.error || r.reason) ? String(r.error || r.reason).slice(0, 120) : 'faucet did not answer';
        return `The faucet declined: ${msg}`;
      }
      store.set(`faucet:user:${who.platform}:${who.userId}`, now);
      store.set(`faucet:addr:${address.toLowerCase()}`, now);
      store.set(`faucet:global:${dayKey(now)}`, Number(store.get(`faucet:global:${dayKey(now)}`, 0)) + 1);
      const tx = r.txHash || r.tx || '';
      return `✅ Sent ${r.amount ?? ''} test PRANA to ${address}${tx ? ` · ${LIVE.pranascan.alpha}/tx/${tx}` : ''}`;
    }
    return 'Faucets: `!faucet` (list) · `!faucet prana 0x…` · `!faucet melek [testnet]`';
  } catch {
    return 'The faucet helper hit an error — nothing was requested. Try again shortly.';
  }
}

export { melek };
