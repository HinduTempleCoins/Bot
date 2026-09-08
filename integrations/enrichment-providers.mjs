// enrichment-providers — find a person's other accounts, free-first, bring-your-own-key where limited.
//
// Same shape as genai-providers.mjs, for the same reasons: FREE-FIRST so it always resolves without
// an account, NEVER hardcode a key, and every provider declares its own rate limit honestly.
//
// ⭐ THE BYOK RULE. Where a provider is rate-limited, the user supplies THEIR OWN key and gets THEIR
// OWN quota. That is not a monetisation dodge -- it is the only design that works. A shared key means
// one heavy user exhausts everyone, and the failure looks like the product is broken rather than like
// a quota being hit. GitHub is the clearest case: 60 requests/hour unauthenticated, 5,000/hour with
// any personal token the user already has.
//
// WHAT WAS MEASURED, 2026-09-08 -- these numbers are why the ordering is what it is:
//   Bluesky      OPEN. bio search AND the full follow graph, no auth. Best free source there is.
//   Mastodon     OPEN. /api/v2/search across any instance.
//   Lemmy        OPEN.
//   GitHub       60/hr keyless -> 5,000/hr with a token. The canonical BYOK case.
//   YouTube      page scrape works keyless; the Data API v3 needs a key and gives clean JSON.
//   Reddit       403 to any script without OAuth. Free app, but a key is mandatory.
//   X / Twitter  $100/month minimum. Listed so nobody wastes an afternoon discovering it.
//
// EVIDENCE TIERS, because a handle matching is not an identity. A bio naming the person's own other
// account is conclusive; a matching username is the weakest signal there is and is labelled so.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => String(v == null ? '' : v);
const env = (k, d = '') => str(process.env[k] || d);

// ---------------------------------------------------------------------------
// 1. THE REGISTRY
// ---------------------------------------------------------------------------

export const PROVIDERS = Object.freeze({
  bluesky: {
    id: 'bluesky', label: 'Bluesky (AT Protocol)',
    keyless: true, keyEnv: null,
    limit: 'generous, undocumented',
    can: ['search-bio', 'follow-graph', 'profile'],
    note: 'The strongest free source: full-text bio search AND an open follow graph. Both are what '
        + 'the Feinberg/Comey method needs — you do not search for the person, you search what they '
        + 'said about themselves and then walk the graph.',
  },
  mastodon: {
    id: 'mastodon', label: 'Mastodon (any instance)',
    keyless: true, keyEnv: null,
    limit: '300 requests / 5 min per instance',
    can: ['search-bio', 'profile'],
    note: 'Instance-scoped, so results differ per instance. Federated search is not global search.',
  },
  lemmy: {
    id: 'lemmy', label: 'Lemmy',
    keyless: true, keyEnv: null,
    limit: 'per-instance, generous',
    can: ['search-bio', 'profile', 'create-community'],
  },
  website: {
    id: 'website', label: "The person's own site",
    keyless: true, keyEnv: null,
    limit: 'politeness only',
    can: ['declared-links'],
    note: '⭐ CONCLUSIVE tier. A link on their own site was published by them — no matching required, '
        + 'which is the whole point when someone deliberately does not reuse a crypto handle.',
  },
  linktree: {
    id: 'linktree', label: 'Link aggregators (Linktree, Beacons, bio.link…)',
    keyless: true, keyEnv: null,
    limit: 'politeness only',
    can: ['declared-links'],
    note: '⭐ Highest yield per request in the whole registry — one fetch returns every social a '
        + 'person has, because that is literally what the page is for.',
  },
  youtube_scrape: {
    id: 'youtube_scrape', label: 'YouTube /about page',
    keyless: true, keyEnv: null,
    limit: 'politeness only; blocks aggressive clients',
    can: ['declared-links', 'subscribers', 'country'],
    note: 'The about page carries subscriber count, country, and self-declared links to every other '
        + 'platform. Requires gzip handling — without it the response decodes to nothing and looks '
        + 'like an empty page.',
  },
  youtube_api: {
    id: 'youtube_api', label: 'YouTube Data API v3',
    keyless: false, keyEnv: 'YOUTUBE_API_KEY',
    limit: '10,000 quota units/day',
    can: ['profile', 'subscribers', 'search'],
    getKeyAt: 'https://console.cloud.google.com/apis/credentials',
    note: 'Cleaner than scraping and survives layout changes. BYOK: the free quota is per-project, so '
        + 'a user with their own key never competes with anyone else for it.',
  },
  github: {
    id: 'github', label: 'GitHub',
    keyless: true, keyEnv: 'GITHUB_TOKEN',
    limit: '60/hr keyless → 5,000/hr with any token',
    can: ['profile', 'declared-links'],
    getKeyAt: 'https://github.com/settings/tokens',
    note: '⭐ The canonical BYOK case — an 83x improvement from a token the user already has, and no '
        + 'scope is needed beyond public read.',
  },
  reddit: {
    id: 'reddit', label: 'Reddit',
    keyless: false, keyEnv: 'REDDIT_CLIENT_ID',
    limit: '100/min with OAuth; 403 without',
    can: ['profile', 'search-bio'],
    getKeyAt: 'https://reddit.com/prefs/apps',
    note: 'Blocks unauthenticated scripts outright. The app is free but not optional.',
  },
  twitter: {
    id: 'twitter', label: 'X / Twitter',
    keyless: false, keyEnv: 'TWITTER_BEARER_TOKEN',
    limit: 'paid tiers only',
    cost: '$100/month minimum for write access',
    can: ['profile', 'search-bio'],
    getKeyAt: 'https://developer.x.com/en/portal/dashboard',
    note: '⚠️ Listed so nobody spends an afternoon discovering the price. Measured on this dataset: '
        + 'only ~351 of 25,375 holders were confirmable there. Worst reach-per-dollar available.',
  },
});

export const ORDER = Object.freeze([
  'linktree', 'website', 'youtube_scrape', 'bluesky', 'mastodon',
  'github', 'lemmy', 'youtube_api', 'reddit', 'twitter',
]);

// ---------------------------------------------------------------------------
// 2. KEYS — the user's own, then ours, then keyless
// ---------------------------------------------------------------------------

/**
 * Resolve a provider's key. `userKeys` is the caller's own bag — checked FIRST, so a user's key
 * always beats a shared one and their quota is theirs alone.
 */
export function keyFor(providerId, userKeys = {}) {
  const p = PROVIDERS[str(providerId)];
  if (!p) return { ok: false, reason: 'unknown provider' };
  const own = str(userKeys[p.id] || userKeys[p.keyEnv]);
  if (own) return { ok: true, source: 'user', key: own };
  const shared = p.keyEnv ? env(p.keyEnv) : '';
  if (shared) return { ok: true, source: 'shared', key: shared };
  if (p.keyless) return { ok: true, source: 'keyless', key: '' };
  return {
    ok: false, source: 'none', key: '',
    reason: `${p.label} needs a key (${p.keyEnv}). Free to create: ${p.getKeyAt || 'see provider docs'}`,
  };
}

/** Which providers can run right now, in free-first order. Never throws, never hides a reason. */
export function available(userKeys = {}, wanted = null) {
  const out = [];
  for (const id of ORDER) {
    const p = PROVIDERS[id];
    if (wanted && !p.can.includes(wanted)) continue;
    const k = keyFor(id, userKeys);
    out.push({
      id, label: p.label, capability: p.can, limit: p.limit,
      usable: k.ok, keySource: k.source || 'keyless',
      cost: p.cost || 'free',
      blocked: k.ok ? '' : k.reason,
      getKeyAt: p.getKeyAt || '',
    });
  }
  return out;
}

/** A plain readout for a settings page: what works now, what a key would unlock. */
export function status(userKeys = {}) {
  const all = available(userKeys);
  const usable = all.filter((p) => p.usable);
  return {
    usableNow: usable.length,
    total: all.length,
    keyless: usable.filter((p) => p.keySource === 'keyless').length,
    withUserKey: usable.filter((p) => p.keySource === 'user').length,
    blocked: all.filter((p) => !p.usable).map((p) => ({ id: p.id, why: p.blocked, getKeyAt: p.getKeyAt })),
    note: 'Free-first: enrichment always runs on the keyless providers. A key raises YOUR limits '
        + 'only — it is never pooled, so one heavy user cannot exhaust another.',
  };
}

// ---------------------------------------------------------------------------
// 3. EVIDENCE — a matching username is not an identity
// ---------------------------------------------------------------------------

export const TIERS = Object.freeze({
  conclusive: { rank: 0, meaning: 'the person published this link themselves, or named the account in their own bio' },
  strong: { rank: 1, meaning: 'the bio names our ecosystem AND the handle corresponds' },
  ecosystem: { rank: 2, meaning: 'in the community, but not provably this individual' },
  weak: { rank: 3, meaning: '⚠️ username matches only — measured: this is wrong most of the time' },
});

// ⚠️ ABSENCE OF A CRYPTO MENTION IS NOT EVIDENCE OF ANYTHING.
//
// A crypto term in a bio RAISES confidence when present. Its absence lowers nothing, because most
// people never mention it: they keep a crypto handle and a real-name account deliberately separate,
// which is the exact behaviour this module exists to see through. Measured here: 6 of 700 enriched
// YouTube channels mention crypto — and that is what a normal population looks like, not a signal
// that the other 694 are impostors.
//
// So identity is established by the SELF-PUBLISHED LINK CHAIN — their site, their Linktree, their
// about page — never by whether they talk about the ecosystem in public.
export const CRYPTO_MENTION_IS_A_BONUS_NOT_A_TEST = true;

/**
 * Grade one candidate.
 *
 * Two measured facts shape this, and they pull in opposite directions:
 *   * Of 60 YouTube handles matching a holder name, only ~17% had a corresponding display name and
 *     19 belonged to unrelated people -- so `weak` is usually a DIFFERENT human, not a weaker match.
 *   * But only 6 of 700 enriched channels mention crypto at all, so a missing ecosystem mention
 *     says nothing. It cannot lower a grade; it can only fail to raise one.
 *
 * Hence: evidence comes from what the person LINKED, and the ecosystem test is additive only.
 */
export function gradeEvidence({ holder = '', handle = '', bio = '', declaredBy = '' } = {}) {
  const h = str(holder).toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = str(bio).toLowerCase();
  const hd = str(handle).toLowerCase().replace(/[^a-z0-9]/g, '');
  const eco = /\b(hive|peakd|ecency|blurt|steemit|steem|hive-engine|splinterlands|leofinance)\b/i;

  // An empty holder and an empty handle both normalise to '' and would compare EQUAL below, so an
  // entirely empty input would grade as a match. Guard first -- a blank row silently scoring as
  // evidence is how a contact list fills with nothing.
  if (!h) return { tier: null, why: 'no holder supplied' };

  if (declaredBy) return { tier: 'conclusive', why: `published by the holder on ${declaredBy}` };
  if (h.length >= 4 && b.replace(/[^a-z0-9]/g, '').includes(h)) {
    return { tier: 'conclusive', why: 'the bio names their own account' };
  }
  if (eco.test(bio) && hd === h) return { tier: 'strong', why: 'ecosystem bio and matching handle' };
  if (eco.test(bio)) return { tier: 'ecosystem', why: 'ecosystem bio, different handle' };
  if (hd && hd === h) return { tier: 'weak', why: 'handle match only — usually a different person' };
  return { tier: null, why: 'no evidence' };
}

/** Keep only what is safe to act on. Default drops `weak`, because it is wrong more often than right. */
export function filterByEvidence(rows = [], minTier = 'ecosystem') {
  const max = TIERS[minTier] ? TIERS[minTier].rank : 2;
  return rows.filter((r) => r && r.tier && TIERS[r.tier] && TIERS[r.tier].rank <= max);
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  return send(200, {
    ok: true, service: 'enrichment-providers',
    providers: available({}),
    tiers: TIERS,
    policy: 'Free-first. Bring your own key where a provider is rate-limited — your key raises your '
          + 'limits only and is never pooled. Every match carries an evidence tier; a matching '
          + 'username alone is graded `weak` because it is usually a different person.',
  });
}
