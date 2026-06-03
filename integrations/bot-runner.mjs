// bot-runner.mjs — ONE job executor with capability PLUGINS (queue #171).
//
// Builds conceptually on freakazoid.mjs (the dumb pipe) + bot-surfaces.mjs (one runner,
// many surfaces). Where bot-surfaces routes a REPLY to a surface adapter, this routes a
// JOB to a capability PLUGIN. Pure + stubs, no network, no keys.
//
// THE SHAPE:
//   A job is { type, schedule, capability, params }.
//     - type       picks the registered PLUGIN (trade | mining | watcher | wearable).
//     - schedule   is metadata the outer scheduler reads (cron-ish); the runner ignores it.
//     - capability names a GRANT the plugin is allowed to use.
//     - params     is the plugin's input.
//   runJob(job, grants) looks up the plugin, hands it the GRANTED CAPABILITY (a scoped,
//   revocable handle — NEVER a raw secret), and returns the plugin's result/intent.
//
// THE RULE — REQUEST A CAPABILITY, NOT A SECRET (CLAUDE.md "Zero WIF" + BRIEF.md §7):
//   A plugin asks for a capability by name; the runner resolves it from `grants` and passes
//   the GRANT object in. A grant is a handle (vault ref + scope), not a WIF and not a token
//   value. The plugin calls the capability; it never sees, logs, or stores a secret.
//
// ONE WALLET TO SETTLE:
//   Only settlement plugins (mining, gated wearable) move value, and they settle to ONE
//   wallet via an injected `sign`. trade keeps custody with the USER (no settle); watcher
//   only notifies (no signing). Settlement is a DRY-RUN intent by default — `sign` defaults
//   to a stub returning { simulated: true }; nothing of value moves until a real grant signs.
//
// SHIP BEFORE HIVESIGNER:
//   This is the routing + capability boundary, provable offline today. The real signer
//   (MELEK-Signer / HiveSigner with a scoped bearer token) slots in later as the `sign`
//   grant; the runner shape does not change.
//
//   import { registerPlugin, runJob, tradePlugin, miningPlugin, watcherPlugin, wearablePlugin } from './bot-runner.mjs'
//   node integrations/bot-runner.mjs   // dry-run demo over a tiny job set (no network, no key)

const str = (v) => (v == null ? '' : String(v));
const trim = (v) => str(v).trim();

// ---- capability resolution --------------------------------------------------
//
// A plugin requests a capability BY NAME. The runner resolves it from the `grants`
// map into a GRANT HANDLE — a scoped reference, never the secret itself. If the
// capability was not granted, the handle is { granted:false } and the plugin must
// degrade (no value moves without a grant).
function resolveCapability(name, grants = {}) {
  const key = trim(name);
  if (!key) return { name: null, granted: false, ref: null, scope: null };
  const g = grants[key];
  if (!g) return { name: key, granted: false, ref: null, scope: null };
  // Normalize whatever the caller registered into a HANDLE. We deliberately do NOT
  // copy any `secret`/`wif`/`token` value through — only the reference + scope.
  return {
    name: key,
    granted: true,
    ref: g.ref ?? `vault://capabilities/${key}`,
    scope: g.scope ?? null,
    // a capability may carry a `call` function (the actual scoped operation); pass it
    // through so the plugin can invoke it without ever holding the underlying secret.
    call: typeof g.call === 'function' ? g.call : null,
  };
}

// ---- default SIGN — a DRY-RUN settlement grant that signs nothing ------------
// Mirrors freakazoid's defaultSign: holds no key, no network, broadcasts nothing.
// The real grant is a scoped signer capability injected by the vault/runner.
export async function defaultSign(intent = {}) {
  return { simulated: true, broadcast: false, op: intent.op || 'transfer', to: intent.to ?? null };
}

// ---- plugin stubs -----------------------------------------------------------
//
// Each plugin: async (job, capability, { sign }) -> result/intent.
//   - job        the full job { type, schedule, capability, params }
//   - capability the resolved GRANT HANDLE (never a secret)
//   - sign       the settlement grant (DRY-RUN by default)
// A plugin that moves value produces a settle-INTENT and runs it through `sign`.

// TRADE — analyzes/places trades; custody STAYS WITH THE USER. No settle, no signing here.
// The capability is a scoped exchange/market handle; the runner never holds user funds.
export async function tradePlugin(job = {}, capability = {}, _ctx = {}) {
  const params = job.params ?? {};
  return {
    type: 'trade',
    settles: false,          // custody stays user-side; this plugin never settles
    custody: 'user',
    capability: capability.name ?? null,
    granted: !!capability.granted,
    action: {
      kind: 'trade-intent',
      market: trim(params.market) || null,
      side: trim(params.side) || null,
      amount: params.amount ?? null,
    },
    note: 'analysis/placement only — custody and settlement stay with the user',
  };
}

// MINING — settles mined rewards to the ONE wallet. Produces a settle-intent through `sign`.
export async function miningPlugin(job = {}, capability = {}, ctx = {}) {
  const params = job.params ?? {};
  const sign = typeof ctx.sign === 'function' ? ctx.sign : defaultSign;
  const intent = {
    op: 'transfer',
    capability: capability.name ?? null,
    to: trim(params.wallet) || 'hathor',   // one wallet to settle
    amount: params.amount ?? null,
    asset: trim(params.asset) || null,
    memo: 'mining settlement',
  };
  const settled = capability.granted ? await sign(intent) : { simulated: true, broadcast: false, reason: 'capability-not-granted' };
  return { type: 'mining', settles: true, custody: 'wallet', capability: capability.name ?? null, granted: !!capability.granted, intent, settled };
}

// WATCHER — observes and NOTIFIES. No signing, no settlement, ever. Mirrors watcher/ module.
export async function watcherPlugin(job = {}, capability = {}, _ctx = {}) {
  const params = job.params ?? {};
  return {
    type: 'watcher',
    settles: false,
    custody: 'none',
    capability: capability.name ?? null,
    granted: !!capability.granted,
    notify: {
      kind: 'notify-intent',
      channel: trim(params.channel) || 'file',
      subject: trim(params.subject) || 'watcher alert',
      body: trim(params.body) || '',
    },
    note: 'notify only — never signs, never settles',
  };
}

// WEARABLE — GATED payout from wearable/device data. Settles ONLY if the gate passes,
// then through `sign` to the one wallet. Gate-fail produces no settlement.
export async function wearablePlugin(job = {}, capability = {}, ctx = {}) {
  const params = job.params ?? {};
  const sign = typeof ctx.sign === 'function' ? ctx.sign : defaultSign;
  const gatePassed = params.gate === true || params.gatePassed === true;
  const intent = {
    op: 'transfer',
    capability: capability.name ?? null,
    to: trim(params.wallet) || 'hathor',   // one wallet to settle
    amount: params.amount ?? null,
    asset: trim(params.asset) || null,
    memo: 'wearable gated payout',
  };
  let settled;
  if (!gatePassed) {
    settled = { simulated: true, broadcast: false, reason: 'gate-not-passed' };
  } else if (!capability.granted) {
    settled = { simulated: true, broadcast: false, reason: 'capability-not-granted' };
  } else {
    settled = await sign(intent);
  }
  return { type: 'wearable', settles: true, gated: true, gatePassed, custody: 'wallet', capability: capability.name ?? null, granted: !!capability.granted, intent, settled };
}

// ---- plugin registry --------------------------------------------------------

export const PLUGINS = new Map();

export function registerPlugin(type, handler) {
  const key = trim(type);
  if (!key) throw new Error('registerPlugin: type must be a non-empty string');
  if (typeof handler !== 'function') throw new Error(`registerPlugin: handler for "${key}" must be a function`);
  PLUGINS.set(key, handler);
  return handler;
}

// Seed the registry with the four built-in plugins.
registerPlugin('trade', tradePlugin);
registerPlugin('mining', miningPlugin);
registerPlugin('watcher', watcherPlugin);
registerPlugin('wearable', wearablePlugin);

// ---- runJob -----------------------------------------------------------------
//
// Look up the plugin for job.type, resolve the requested CAPABILITY from `grants`
// into a grant handle (never a secret), and dispatch. Unknown type SOFT-FAILS:
// returns { ok:false, error } — never throws. Settlement defaults to DRY-RUN via
// the injected `sign` (or the simulated stub).
export async function runJob(job = {}, grants = {}) {
  const type = trim(job.type);
  const plugin = PLUGINS.get(type);
  if (!plugin) {
    return { ok: false, type: type || null, error: `no plugin registered for type "${type || '(empty)'}"` };
  }
  const capability = resolveCapability(job.capability, grants);
  const sign = typeof grants.sign === 'function' ? grants.sign : defaultSign;
  const result = await plugin(job, capability, { sign });
  return { ok: true, type, capability: capability.name ?? null, result };
}

// ---- CLI: dry-run demo over a tiny job set (no network, no key) --------------

if (process.argv[1] && process.argv[1].endsWith('bot-runner.mjs')) {
  // grants: capability handles (refs + scope), NOT secrets. The runner never holds a WIF.
  const grants = {
    'exchange:read': { ref: 'vault://capabilities/exchange:read', scope: 'markets,balances' },
    'pool:rewards': { ref: 'vault://capabilities/pool:rewards', scope: 'claim' },
    'alert:telegram': { ref: 'vault://capabilities/alert:telegram', scope: 'send' },
    'signer:wallet': { ref: 'vault://capabilities/signer:wallet', scope: 'transfer:capped' },
    // sign defaults to DRY-RUN; a real scoped signer would replace this.
  };
  const jobs = [
    { type: 'trade', schedule: '*/5 * * * *', capability: 'exchange:read', params: { market: 'MELEK:HIVE', side: 'buy', amount: 10 } },
    { type: 'mining', schedule: '0 * * * *', capability: 'pool:rewards', params: { wallet: 'hathor', amount: 2.5, asset: 'MELEK' } },
    { type: 'watcher', schedule: '* * * * *', capability: 'alert:telegram', params: { channel: 'telegram', subject: 'price move', body: '+8% on MELEK:HIVE' } },
    { type: 'wearable', schedule: '0 0 * * *', capability: 'signer:wallet', params: { wallet: 'hathor', amount: 1, asset: 'MELEK', gate: true } },
    { type: 'unknown', schedule: 'never', capability: 'nope', params: {} },
  ];
  console.log('bot-runner — DRY-RUN demo (no network, no key)\n');
  console.log('registered plugins:', [...PLUGINS.keys()].join(', '), '\n');
  for (const job of jobs) {
    const out = await runJob(job, grants);
    console.log(`job   : type=${job.type} capability=${job.capability ?? '(none)'}`);
    console.log(`result: ${JSON.stringify(out)}\n`);
  }
}
