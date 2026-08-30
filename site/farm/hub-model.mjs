// hub-model.mjs — the GUIDED YIELD FARM hub model (pure, testable, no chain, no network).
//
// The Yield Farm is "like Witness School for Staking and Burn-Mining Hash Rates and regular Yield
// Farming" (operator 2026-08-30): a guided, educational + interactive hub that TEACHES and LETS YOU DO
// each earning mechanic. UX = the Mining Pool's "direction + grey tiles that light up as you complete
// each step". This module is the single source of truth for the TILES (what each is, why, the steps,
// and how a tile decides grey→active→lit), so both the server render and the client progress agree.
//
// Four mechanics, each a tile:
//   1. apis       — forever-lock WMELEK → APIS-Hash → mine APIS (engine custom_json; PERMANENT).
//   2. burnmine   — burn PoL/inputs → mint KULA (BurnMine, EVM tx on PRANA).
//   3. liquidity  — provide LP → stake LP in the gauge → earn MWALI (LiquidityGauge, EVM tx on PRANA).
//   4. vekula     — lock KULA → veKULA boost + gauge votes + fee dividend (regular yield farming).
//
// NB (operator, load-bearing): MWALI is the PoL / LIQUIDITY reward, NOT a casino token. There is no
// casino token here and no gambling mechanic. House style: pure arithmetic/strings, soft-fail, esc()
// is the caller's job, NEVER throws for bad input.

const A0 = '0x0000000000000000000000000000000000000000';

/** True when `addr` is a usable 0x…40hex address (not zero / not a placeholder). */
export function hasAddr(addr) {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr) && addr.toLowerCase() !== A0;
}

/**
 * hubTiles — the ordered tile definitions for the guided hub. Pure: given the resolved on-chain config
 * (contract addresses that may or may not be live yet) it returns the tiles, marking EVM tiles `gated`
 * when their contract isn't configured on this network. Each tile carries plain-language what/why, the
 * ordered sub-steps, and the `action` metadata the client uses to wire the real op.
 *
 * @param {object} cfg { engine:{ stakeToken }, prana:{ name, chainId, burnMine, gauge, kula, mwali, lp } }
 * @returns {Array<object>} tiles
 */
export function hubTiles(cfg = {}) {
  const engine = cfg.engine || {};
  const prana = cfg.prana || {};
  const stakeToken = String(engine.stakeToken || 'WMELEK').toUpperCase();
  const gaugeLive = hasAddr(prana.gauge);
  const burnLive = hasAddr(prana.burnMine);
  const lp = prana.lp || {};

  return [
    {
      id: 'apis',
      num: 1,
      emoji: '🐝',
      title: `Forever-Lock ${stakeToken} → APIS-Hash`,
      tagline: 'Permanent stake that mines APIS forever.',
      what:
        `Forever-lock ${stakeToken} and it mints soulbound APIS-Hash 1:1. APIS-Hash mines APIS on a ` +
        'fixed schedule (~1000 APIS/day, decaying 10%/yr), split pro-rata by your share of the hive.',
      why:
        'APIS is the MELEK-Engine fuel — burned to create tokens and pay engine resource fees. Being an ' +
        'early locker captures the early emission. This is the WorkerBee mining mint.',
      warn: `PERMANENT — there is no unstake. The ${stakeToken} is gone (non-redeemable); APIS-Hash is soulbound.`,
      steps: [
        { label: 'Load your engine balances', detail: `See your liquid ${stakeToken}, APIS-Hash, pending APIS.` },
        { label: `Choose how much ${stakeToken} to forever-lock`, detail: 'This is irreversible — start small to learn.' },
        { label: 'Sign the foreverLock op in your wallet', detail: 'Client-signed custom_json — keys never touch the server.' },
      ],
      action: { kind: 'engine', contract: 'workerbee', op: 'foreverLock', endpoint: '/api/stake-op' },
      gated: false,
      // lit when the account holds any APIS-Hash.
      lit: { source: 'engine', field: 'apisHash', gt: 0 },
    },
    {
      id: 'burnmine',
      num: 2,
      emoji: '🔥',
      title: 'Burn-Mine → KULA hash rate',
      tagline: 'Burn an input token, mint KULA at a fixed ratio.',
      what:
        'The Burn Mine is a real supply sink: you burn an input token (PoL and others) and it mints KULA ' +
        'to you. The simple mine is a fixed ratio (kulaOut = amountIn × num / den); the epoch "hash rate" ' +
        'model splits a fixed reward pro-rata across everyone who burned that epoch — difficulty rises as ' +
        'more people burn, so yield falls, exactly like real mining.',
      why:
        'Burning is deflationary for the input and a KULA mint path — it links the tokens and rewards ' +
        'the people who commit supply. Competitive, not guaranteed yield: you can get back less than you burn.',
      warn: 'Burning is irreversible. The input token is destroyed — treat it like real mining, not a deposit.',
      steps: [
        { label: 'Connect to PRANA', detail: `${prana.name || 'PRANA'} (chain ${prana.chainId || '—'}) in your EVM wallet.` },
        { label: 'Approve the mine to spend your input token', detail: 'One-time ERC-20 approval.' },
        { label: 'Call mine() — burn input, receive KULA', detail: 'Client-side EVM tx; keys stay in your wallet.' },
      ],
      action: { kind: 'evm', method: 'burnMine', address: prana.burnMine || '', abi: 'BurnMine' },
      gated: !burnLive,
      gateReason: burnLive ? '' : 'The Burn Mine is not yet deployed on this network — this is the explainer until it is.',
      lit: { source: 'local', mark: 'burnmine' },
    },
    {
      id: 'liquidity',
      num: 3,
      emoji: '💧',
      title: 'Provide Liquidity → Stake LP → Earn MWALI',
      tagline: 'Proof-of-Liquidity: depth over time is paid in MWALI.',
      what:
        'Add liquidity to a KULA pair (e.g. wVKBT/KULA or wCURE/KULA) to receive LP tokens, then stake ' +
        'the LP in the LiquidityGauge. The gauge streams MWALI rewards by stake × time (the battle-tested ' +
        'Synthetix StakingRewards accrual), so real, sustained liquidity is rewarded — not a one-block flash.',
      why:
        'MWALI is the Proof-of-Liquidity reward. Deep, sticky liquidity makes every swap on KulaSwap ' +
        'better; the gauge pays you MWALI for providing it. (MWALI is a liquidity reward, not a casino token.)',
      warn: 'Providing liquidity carries impermanent-loss risk if the pair price moves. Understand it before you add.',
      steps: [
        { label: 'Add liquidity to a KULA pair', detail: 'Router.addLiquidity → you receive LP tokens.' },
        { label: 'Approve + stake your LP in the gauge', detail: 'gauge.stake(amount) — client-side EVM tx.' },
        { label: 'Let it accrue, then claim MWALI', detail: 'gauge.earned() rises over time; gauge.getReward() pays MWALI.' },
      ],
      action: {
        kind: 'evm', method: 'gauge', address: prana.gauge || '', abi: 'LiquidityGauge',
        rewardToken: prana.mwali || '', pairs: [
          lp.wvkbtKula ? { name: 'wVKBT / KULA LP', address: lp.wvkbtKula } : null,
          lp.wcureKula ? { name: 'wCURE / KULA LP', address: lp.wcureKula } : null,
        ].filter(Boolean),
      },
      gated: !gaugeLive,
      gateReason: gaugeLive ? '' : 'The MWALI LiquidityGauge is staged for mainnet but not yet deployed — see the staged deploy script.',
      lit: { source: 'onchain', field: 'gaugeStaked', gt: 0 },
    },
    {
      id: 'vekula',
      num: 4,
      emoji: '🔒',
      title: 'Lock KULA → veKULA (regular yield farming)',
      tagline: 'Boost your rewards, vote the gauges, earn the dividend.',
      what:
        'Lock KULA for up to 4 years to get veKULA. Longer lock → a bigger boost (up to 2.5×) on your farm ' +
        'rewards, plus vote weight to steer which pools get emissions, plus a share of the fee dividend. This ' +
        'is the regular yield-farming layer: the emission split, single-stake, and the ve lock-boost curve.',
      why:
        'Locking aligns you with the protocol: you earn more from the same rewards, you help decide where ' +
        'emissions flow, and you share in real yield. It is the classic ve(3,3) flywheel.',
      warn: 'Locked KULA is illiquid until the lock expires. Pick a lock length you can commit to.',
      steps: [
        { label: 'See the emission split', detail: 'Where each epoch of KULA flows across the reward surfaces.' },
        { label: 'Pick a lock length', detail: '13 weeks → 4 years; longer = bigger boost + more vote weight.' },
        { label: 'Lock KULA → veKULA', detail: 'Then vote gauges and claim the dividend.' },
      ],
      action: { kind: 'info', method: 'veKula' },
      gated: false,
      lit: { source: 'local', mark: 'vekula' },
    },
  ];
}

/**
 * tileState — resolve one tile to a display state from detected on-chain state + local completion marks.
 *   'gated'  → the mechanic isn't live on this network yet (show explainer, no action).
 *   'lit'    → the user has completed / is participating in this mechanic.
 *   'grey'   → available but not yet started.
 * @param {object} tile   a hubTiles() entry
 * @param {object} state  { engine:{apisHash}, onchain:{gaugeStaked}, marks:{ [id]: true } }
 */
export function tileState(tile, state = {}) {
  if (!tile || typeof tile !== 'object') return 'grey';
  if (tile.gated) return 'gated';
  const lit = tile.lit || {};
  const marks = state.marks || {};
  if (lit.source === 'engine') {
    const v = Number((state.engine || {})[lit.field]);
    if (Number.isFinite(v) && v > (lit.gt || 0)) return 'lit';
  } else if (lit.source === 'onchain') {
    const v = Number((state.onchain || {})[lit.field]);
    if (Number.isFinite(v) && v > (lit.gt || 0)) return 'lit';
  } else if (lit.source === 'local') {
    if (marks[lit.mark] || marks[tile.id]) return 'lit';
  }
  return 'grey';
}

/** progressSummary — {done, total, gated} across the tiles for the header progress meter. */
export function progressSummary(tiles = [], state = {}) {
  let done = 0, gated = 0;
  for (const t of tiles) {
    const s = tileState(t, state);
    if (s === 'lit') done += 1;
    else if (s === 'gated') gated += 1;
  }
  return { done, total: tiles.length, gated, pct: tiles.length ? Math.round((done / tiles.length) * 100) : 0 };
}

// Minimal ABIs the client needs for the EVM actions (kept here so server + client share one definition).
export const ABIS = Object.freeze({
  ERC20: [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
  ],
  BurnMine: [
    'function input() view returns (address)',
    'function output() view returns (address)',
    'function quote(uint256 amountIn) view returns (uint256)',
    'function mine(uint256 amountIn) returns (uint256)',
  ],
  LiquidityGauge: [
    'function stakeToken() view returns (address)',
    'function rewardToken() view returns (address)',
    'function balanceOf(address) view returns (uint256)',
    'function earned(address) view returns (uint256)',
    'function stake(uint256 amount)',
    'function withdraw(uint256 amount)',
    'function getReward()',
  ],
});

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('hub-model.mjs')) {
  const tiles = hubTiles({ engine: { stakeToken: 'WMELEK' }, prana: { name: 'PRANA', chainId: 712217 } });
  for (const t of tiles) console.log(`#${t.num} ${t.emoji} ${t.title} — ${t.gated ? 'GATED' : 'live'} (${tileState(t, {})})`);
  console.log('progress:', progressSummary(tiles, { engine: { apisHash: 5 }, marks: { vekula: true } }));
}
