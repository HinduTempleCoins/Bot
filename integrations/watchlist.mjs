// watchlist.mjs — single place the integrations layer reads "what to watch" from.
// No keys, no secrets. Everything here is public market metadata. Env-overridable so
// the operator can change the watched tokens/accounts without editing code.
//
//   TRADE_ACCOUNT=kalivankush            # the bot's on-chain account (Way-1 forensics)
//   ISSUED_TOKENS=VKBT,CURE              # tokens this operator issues / tries to push
//   WATCH_TOKENS=VKBT,CURE,SWAP.LTC,...  # tokens to snapshot in the market explorer
//
// Importers: tradebot-forensics, hive-engine-market, market-depth, arb-scanner,
// trade-analyzer, digest. Keeps the "what" out of the "how".

function list(envVal, fallback) {
  const v = (envVal || '').trim();
  if (!v) return fallback;
  return v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

// the account the trade bot actually trades as (confirmed on-chain: kalivankush)
export const TRADE_ACCOUNT = (process.env.TRADE_ACCOUNT || 'kalivankush').trim();

// candidate accounts the forensics probe checks when no account is given
export const CANDIDATE_ACCOUNTS = list(
  process.env.CANDIDATE_ACCOUNTS,
  ['angelicalist', 'punicwax', 'vankush', 'kalivankush'],
);

// tokens this operator issues (self-push detection / parity analysis applies to these)
export const ISSUED_TOKENS = list(process.env.ISSUED_TOKENS, ['VKBT', 'CURE']);

// default set the market explorer + depth view snapshot. Includes the HE-native tokens that ALSO
// trade on outside exchanges (SPS/DEC/LEO — see he-external-listings.mjs) so we watch their
// Hive-Engine ↔ external gap, not just the SWAP.X wrappers and our own issued tokens.
export const WATCH_TOKENS = list(
  process.env.WATCH_TOKENS,
  ['VKBT', 'CURE', 'SWAP.LTC', 'SWAP.BLURT', 'SWAP.DOGE', 'BBH', 'SPS', 'DEC', 'LEO'],
);

// SWAP wrapper token -> coingecko id (the real asset it tracks) for arbitrage
export const SWAP_PAIRS = {
  'SWAP.BTC': 'bitcoin', 'SWAP.ETH': 'ethereum', 'SWAP.LTC': 'litecoin',
  'SWAP.DOGE': 'dogecoin', 'SWAP.BLURT': 'blurt', 'SWAP.STEEM': 'steem',
  'SWAP.HBD': 'hive_dollar', 'SWAP.EOS': 'eos', 'SWAP.MATIC': 'matic-network',
};

// thresholds (env-overridable numbers)
const num = (v, d) => (v != null && v !== '' && !Number.isNaN(+v) ? +v : d);
export const ARB_THRESHOLD = num(process.env.ARB_THRESHOLD, 0.03);   // 3% edge worth flagging
export const PARITY_TARGET = num(process.env.PARITY_TARGET, 1.0);    // issued-token strategic target (HIVE)

export default {
  TRADE_ACCOUNT, CANDIDATE_ACCOUNTS, ISSUED_TOKENS, WATCH_TOKENS,
  SWAP_PAIRS, ARB_THRESHOLD, PARITY_TARGET,
};
