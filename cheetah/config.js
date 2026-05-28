/**
 * config.js — Cheetah's runtime configuration.
 *
 * All knobs live in env vars; this file normalizes them with sensible
 * defaults and validates shape at startup.
 */

import 'dotenv/config';

export const CHEETAH_ACCOUNT = process.env.CHEETAH_ACCOUNT || 'cheetah';

// Similarity threshold: a match must score at or above this on Jaccard
// (0..1) to be surfaced as a finding. Below threshold, it's noise.
// Operator can tune up if Cheetah is too chatty, down if it misses matches.
export const SIMILARITY_THRESHOLD = parseFloat(
  process.env.CHEETAH_SIMILARITY_THRESHOLD || '0.5'
);

// Shingle window in words. 5 is the standard for plagiarism detection —
// short enough to catch paraphrase, long enough to skip generic phrases.
export const SHINGLE_SIZE = parseInt(process.env.CHEETAH_SHINGLE_SIZE || '5', 10);

// Frequency cap: do not comment on the same author more than N times per
// rolling 24 hours. Bot-culture norm: sometimes-helpful is welcomed,
// always-commenting is spam.
export const FREQUENCY_CAP_PER_AUTHOR_DAY = parseInt(
  process.env.CHEETAH_FREQ_CAP || '1', 10
);

// Path to the evidenced whitelist/blacklist + findings log.
export const STORE_PATH = process.env.CHEETAH_STORE || './cheetah/.store.json';

// Self-identify footer link — points to either the on-chain About post
// or the repo's README for transparency.
export const SELF_ID_LINK = process.env.CHEETAH_SELF_ID_URL ||
  'https://github.com/HinduTempleCoins/Bot/blob/main/cheetah/README.md';

// Web search backend — operator decision pending. Options when picked:
//   "none"  (default — no web search, only on-chain detection)
//   "google" + GOOGLE_CSE_KEY + GOOGLE_CSE_CX
//   "serper" + SERPER_API_KEY
//   "duckduckgo" (no key, scrape-based, ToS-tight)
export const WEB_SEARCH_BACKEND = process.env.CHEETAH_WEB_SEARCH || 'none';

export function status() {
  return {
    account: CHEETAH_ACCOUNT,
    similarity_threshold: SIMILARITY_THRESHOLD,
    shingle_size: SHINGLE_SIZE,
    frequency_cap_per_author_day: FREQUENCY_CAP_PER_AUTHOR_DAY,
    store_path: STORE_PATH,
    self_id_link: SELF_ID_LINK,
    web_search_backend: WEB_SEARCH_BACKEND,
  };
}
