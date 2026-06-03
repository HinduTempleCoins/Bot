// content-posture.mjs — the v3 §0/§9/§13 THREE-POSTURE content engine. The legal keystone.
//
// SoapBox surfaces three kinds of stuff: things we made / can freely redistribute, things someone
// ELSE owns that we want to show on the page, and things we can only describe and point at. This
// module is the single deterministic answer to "which posture applies, and may it go on the chain?"
// It GENERALIZES the Library's three-bucket model (integrations/soapbox/library-buckets.mjs, queue
// #84) from books to ANY asset (a YouTube embed, a Google Places listing, a Yelp review, a CC photo,
// a gov dataset, our own corpus), and adds the MELEK immutable-tier rule + the §512 moderation flow.
//
// THREE POSTURES (the generalization of HOST_FULL / METADATA_ONLY / USER_NFT):
//   'host'       PD / CC (non-NC for our commercial use) / gov-works / user-original. We hold the
//                bytes and serve them. The only posture that MAY be chained (see canChain).
//   'window'     copyrighted-or-ToS-restricted THIRD-PARTY content we display IN PLACE via the
//                owner's own surface — a YouTube iframe, a Google Places card, a Yelp widget. We do
//                NOT store the bytes; we open a window onto the rightsholder's hosting. Embed only.
//   'aggregate'  we can't embed or store — so we hold metadata + a link out (the JustWatch model:
//                "here's the title, the rating, and where to watch it"). The SAFE DEFAULT.
//
// THE SINGLE TEST (documented, applied everywhere):
//   "Is the source I'm embedding/storing itself licensed (or open)?"
//     yes, openly                    → host
//     no, but the owner offers an embed/ToS-bounded surface → window
//     no, and no embed surface       → aggregate
//   Unknown anything → most restrictive (aggregate). Safe defaults everywhere.
//
//   import { postureFor, canChainAsset, licenseTag, routeTier, makeModeration } from './integrations/content-posture.mjs'
//   node integrations/content-posture.mjs   # offline demo
//
// This module is PURE classification + a pure moderation STATE MACHINE. No network, no I/O.

import { classify as classifyLibraryWork, BUCKETS } from './soapbox/library-buckets.mjs';

// ── posture vocabulary ─────────────────────────────────────────────────────────────────────────────
export const POSTURES = Object.freeze({
  HOST: 'host',
  WINDOW: 'window',
  AGGREGATE: 'aggregate',
});

// ── normalized license tags ──────────────────────────────────────────────────────────────────────
// The canonical license vocabulary this engine reasons over. Everything an asset declares is
// normalized to one of these by licenseTag().
export const LICENSE_TAGS = Object.freeze({
  PD: 'PD',                       // public domain (any route)
  CC0: 'CC0',                     // CC0 / public-domain dedication — PD-equivalent
  CC_BY: 'CC-BY',                 // attribution
  CC_BY_SA: 'CC-BY-SA',           // attribution-sharealike
  CC_BY_ND: 'CC-BY-ND',           // attribution-noderivs (still redistributable verbatim)
  CC_NC: 'CC-NC',                 // ANY NonCommercial CC variant → unusable for our commercial use
  GOV_WORKS: 'gov-works',         // US-gov / OGL / public-sector works (PD-like for us)
  USER_ORIGINAL: 'user-original', // the requesting user's own work / rights
  OPEN_OTHER: 'open-other',       // permissive software-style / GFDL / other clearly-open license
  TOS_RESTRICTED: 'ToS-restricted', // third-party, embed-only by terms (YouTube, Places, Yelp)
  COPYRIGHTED: 'copyrighted',     // someone else's, all-rights-reserved
  UNKNOWN: 'unknown',             // nothing declared → resolves to the safe default downstream
});

// License tags that mean "we hold redistribution rights and may serve the bytes ourselves".
const HOSTABLE_TAGS = new Set([
  LICENSE_TAGS.PD,
  LICENSE_TAGS.CC0,
  LICENSE_TAGS.CC_BY,
  LICENSE_TAGS.CC_BY_SA,
  LICENSE_TAGS.CC_BY_ND,
  LICENSE_TAGS.GOV_WORKS,
  LICENSE_TAGS.USER_ORIGINAL,
  LICENSE_TAGS.OPEN_OTHER,
]);

// License tags eligible for the immutable chain tier. STRICTLY narrower than HOSTABLE: the chain is
// permanent with NO takedown — so only PD / CC0 / gov-works / user-original (rights we never have to
// retract). CC-BY / CC-BY-SA / CC-BY-ND are host-able but NOT chain-able: attribution/share-alike
// obligations + the (small) chance a "CC" claim was wrong make permanent immutable exposure unwise.
const CHAINABLE_TAGS = new Set([
  LICENSE_TAGS.PD,
  LICENSE_TAGS.CC0,
  LICENSE_TAGS.GOV_WORKS,
  LICENSE_TAGS.USER_ORIGINAL,
]);

// Third-party surfaces that offer an owner-hosted embed / ToS-bounded window (posture: 'window').
const EMBED_SOURCES = new Set([
  'youtube', 'youtu.be', 'vimeo', 'dailymotion', 'twitch',
  'google places', 'google-places', 'places', 'gmaps', 'google maps', 'google-maps',
  'yelp', 'tripadvisor', 'foursquare',
  'twitter', 'x', 'instagram', 'tiktok', 'facebook', 'spotify', 'soundcloud',
  'imdb', 'justwatch-embed',
]);

// ── normalization helpers ─────────────────────────────────────────────────────────────────────────
function norm(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}
function truthy(v) {
  if (v === true) return true;
  const s = norm(v);
  return s === 'true' || s === 'yes' || s === '1';
}

// Canonicalize a license string to a comparable token: "CC BY-SA 4.0 International" → "cc-by-sa".
function canonLicense(license) {
  let s = norm(license);
  if (!s) return '';
  s = s.replace(/\s+/g, '-').replace(/_/g, '-');
  // strip a trailing version: a decimal like "4.0"/"2.5", or a hyphen-separated integer like
  // "cc-by-4". NOT a bare trailing digit fused to a token ("cc0" must stay "cc0").
  s = s.replace(/-\d+(\.\d+)?$/, '').replace(/\.\d+$/, '').replace(/-?(int(ernational)?|deed)$/, '');
  s = s.replace(/-+$/, '').replace(/^-+/, '');
  return s;
}

const PD_RIGHTS = /\b(public[\s_-]?domain|no known copyright|pd[\s_-]?us|no rights reserved)\b/i;
const GOV_RIGHTS = /\b(gov(ernment)?[\s_-]?works?|u\.?s\.?[\s_-]?government|public[\s_-]?sector|crown copyright|ogl|open government licen[cs]e)\b/i;
const IN_COPYRIGHT_RIGHTS = /\b(in[\s_-]?copyright|all rights reserved|copyrighted|©|\(c\)\s*\d{4}|protected by copyright)\b/i;

// ── licenseTag ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Normalize whatever an asset declares into one canonical LICENSE_TAG. PURE. Safe-default: anything
 * we can't positively pin lands on 'unknown' (which downstream routes to the most restrictive
 * posture). NC-bearing CC variants are flagged 'CC-NC' = unusable-for-us, NOT host-able.
 *
 * Resolution order (most specific / most restrictive-claim first):
 *   1. explicit user-original ownership
 *   2. NonCommercial CC variant      → CC-NC (flag: unusable for our commercial use)
 *   3. specific CC family (by/sa/nd) / CC0
 *   4. PD (license token OR rights text OR year heuristic)
 *   5. gov-works
 *   6. other clearly-open licenses
 *   7. explicit in-copyright assertion → copyrighted
 *   8. third-party embed source       → ToS-restricted
 *   9. nothing                        → unknown
 *
 * @returns {string} one of LICENSE_TAGS values
 */
export function licenseTag(record = {}) {
  if (!record || typeof record !== 'object') return LICENSE_TAGS.UNKNOWN;

  const lic = canonLicense(record.license);
  const rights = String(record.rights || '');
  const source = norm(record.source);

  // 1. our own corpus / MELEK Library originals, OR the requesting user's own work — in both cases
  //    WE/THEY carry the rights (rights we never have to retract), so both tag as 'user-original'
  //    (the chain-able "we own this" class).
  if (truthy(record.userOriginal) || truthy(record.userOwned) || truthy(record.isOwn) ||
      truthy(record.ownCorpus) || truthy(record.isCorpus) ||
      ['user', 'self', 'uploader', 'mine', 'melek', 'soapbox', 'corpus', 'operator'].includes(norm(record.owner)) ||
      ['corpus', 'melek', 'soapbox'].includes(norm(record.source))) {
    return LICENSE_TAGS.USER_ORIGINAL;
  }

  // 2. ANY NonCommercial CC variant is unusable for our (commercial) use — flag distinctly so callers
  //    never mistake it for host-able. Catch -nc anywhere in the canonical token.
  if (/(^|-)nc(-|$)/.test(lic) || /\bnon[\s_-]?commercial\b/i.test(rights)) {
    return LICENSE_TAGS.CC_NC;
  }

  // 3. specific CC families (non-NC).
  if (lic === 'cc0' || lic === 'cc-pdm') return LICENSE_TAGS.CC0;
  if (lic === 'cc-by-sa') return LICENSE_TAGS.CC_BY_SA;
  if (lic === 'cc-by-nd') return LICENSE_TAGS.CC_BY_ND;
  if (lic === 'cc-by') return LICENSE_TAGS.CC_BY;

  // 4. public domain — license token, explicit rights text, or the year heuristic (only when nothing
  //    asserts in-copyright).
  if (['pd', 'public-domain', 'publicdomain'].includes(lic) || PD_RIGHTS.test(rights)) {
    return LICENSE_TAGS.PD;
  }
  const year = Number(record.year);
  const PD_YEAR_CUTOFF = new Date().getUTCFullYear() - 96;
  if (Number.isFinite(year) && year > 0 && year <= PD_YEAR_CUTOFF && !IN_COPYRIGHT_RIGHTS.test(rights)) {
    return LICENSE_TAGS.PD;
  }

  // 5. government / public-sector works.
  if (lic === 'ogl' || GOV_RIGHTS.test(rights) ||
      (source && /\bgov\b/.test(source)) || norm(record.owner) === 'gov') {
    return LICENSE_TAGS.GOV_WORKS;
  }

  // 6. other clearly-open licenses (permissive software-style / GFDL).
  if (['mit', 'apache', 'apache-2.0', 'gpl', 'gpl-2.0', 'gpl-3.0', 'lgpl', 'mpl', 'mpl-2.0',
       'bsd', 'unlicense', 'wtfpl', 'gfdl'].includes(lic)) {
    return LICENSE_TAGS.OPEN_OTHER;
  }

  // 7. explicit "all rights reserved" / © — someone else's, copyrighted.
  if (IN_COPYRIGHT_RIGHTS.test(rights)) return LICENSE_TAGS.COPYRIGHTED;

  // 8. a third-party embed surface (YouTube/Places/Yelp…) → embed-by-ToS, restricted.
  if (truthy(record.embeddable) || (source && EMBED_SOURCES.has(source))) {
    return LICENSE_TAGS.TOS_RESTRICTED;
  }

  // 9. nothing declared → safe default sentinel.
  return LICENSE_TAGS.UNKNOWN;
}

// ── postureFor ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Decide the content posture for an asset. PURE — no network, no I/O.
 *   postureFor(asset) → { posture, reason, canChain, licenseTag }
 *
 * - 'host'      asset is openly licensed / ours / the user's → we serve the bytes. canChain iff the
 *               tag is in CHAINABLE_TAGS (PD/CC0/gov-works/user-original).
 * - 'window'    third-party copyrighted-or-ToS asset with an owner-hosted embed surface → iframe only.
 * - 'aggregate' everything else, incl. unknown → metadata + link-out. SAFE DEFAULT.
 *
 * The single test ("is the source itself licensed/open?") is applied via licenseTag().
 *
 * @param {object} asset { license?, rights?, source?, year?, owner?, embeddable?, kind?, url?, ... }
 * @returns {{ posture:string, reason:string, canChain:boolean, licenseTag:string }}
 */
export function postureFor(asset = {}) {
  if (!asset || typeof asset !== 'object') {
    return {
      posture: POSTURES.AGGREGATE,
      reason: 'no asset metadata; safe default — metadata + link-out only',
      canChain: false,
      licenseTag: LICENSE_TAGS.UNKNOWN,
    };
  }

  const tag = licenseTag(asset);

  // HOST: we hold redistribution rights.
  if (HOSTABLE_TAGS.has(tag)) {
    const canChain = canChainTag(tag);
    return {
      posture: POSTURES.HOST,
      reason: `openly licensed (${tag}); we may host the bytes` +
        (canChain ? ' and chain them (immutable-tier eligible)' : ' but NOT chain them (no-takedown rule)'),
      canChain,
      licenseTag: tag,
    };
  }

  // WINDOW: third-party, embed-only (ToS-restricted), or copyrighted but the owner offers an embed.
  const source = norm(asset.source);
  const hasEmbedSurface = tag === LICENSE_TAGS.TOS_RESTRICTED ||
    truthy(asset.embeddable) || (source && EMBED_SOURCES.has(source));
  if (hasEmbedSurface) {
    return {
      posture: POSTURES.WINDOW,
      reason: `third-party ${tag} content with an owner-hosted embed surface; display in-place, never store`,
      canChain: false, // never — we don't hold these bytes and they're not ours to make permanent
      licenseTag: tag === LICENSE_TAGS.UNKNOWN ? LICENSE_TAGS.TOS_RESTRICTED : tag,
    };
  }

  // AGGREGATE: copyrighted with no embed surface, or unknown. Metadata + link-out (JustWatch model).
  const reason = tag === LICENSE_TAGS.CC_NC
    ? 'NonCommercial CC — unusable for our commercial use; metadata + link-out only'
    : tag === LICENSE_TAGS.COPYRIGHTED
      ? 'copyrighted, no embed surface; metadata + link-out only (JustWatch model)'
      : 'no clearing signal; safe default — metadata + link-out only';
  return { posture: POSTURES.AGGREGATE, reason, canChain: false, licenseTag: tag };
}

function canChainTag(tag) {
  return CHAINABLE_TAGS.has(tag);
}

// ── canChainAsset ─────────────────────────────────────────────────────────────────────────────────
/**
 * The MELEK immutable-tier gate. True ONLY for posture:'host' AND a chain-able license tag
 * (PD / CC0 / gov-works / user-original). The chain has no takedown — permanent exposure — so we
 * NEVER put copyrighted (or even attribution-encumbered CC-BY*) media on it. Safe default: false.
 * Pure.
 */
export function canChainAsset(asset = {}) {
  const p = postureFor(asset);
  return p.posture === POSTURES.HOST && p.canChain === true;
}

// ── routeTier ─────────────────────────────────────────────────────────────────────────────────────
/**
 * §9 storage-tier routing for MELEK. PURE. Maps an asset to where its bytes (if any) should live:
 *   'chain'          immutable on-chain — PD/CC0/gov/user-original, posture:'host'. Permanent.
 *   'ipfs-mutable'   host-able but NOT chain-safe (CC-BY / CC-BY-SA / CC-BY-ND / other-open) — we
 *                    serve the bytes off a MUTABLE, takedown-capable store (IPFS pin we can unpin).
 *   'frontend-embed' window + aggregate postures — no bytes stored; the front end renders an embed
 *                    (window) or a metadata card + link (aggregate).
 *
 * @returns {'chain'|'ipfs-mutable'|'frontend-embed'}
 */
export function routeTier(asset = {}) {
  const p = postureFor(asset);
  if (p.posture === POSTURES.HOST) {
    return p.canChain ? 'chain' : 'ipfs-mutable';
  }
  // window + aggregate: nothing of ours to store.
  return 'frontend-embed';
}

// ── moderation: FLAG, don't takedown (with the §512 hosted-surface path) ────────────────────────────
// A pure state machine for handling a complaint about a record. The DEFAULT response is to FLAG /
// LABEL — never silently delete — preserving the record + adding a visible notice. Only on a
// well-formed DMCA §512(c) notice for content on a HOSTED surface (posture:'host', our bytes) do we
// move to a DISABLED state (access cut, record retained). A §512(g) counter-notice from the uploader
// then opens a put-back window, after which access is restored absent a court action.
//
// States:
//   'live'              normal, visible.
//   'flagged'           a complaint/label is attached; content STAYS visible (the default posture).
//   'disabled'          §512(c)-disabled: access cut on a hosted surface, record retained.
//   'counter-noticed'   uploader filed a §512(g) counter-notice; put-back window running.
//   'restored'          put-back window elapsed (no court action) → access restored.
//   'removed'           terminal: court order / repeat-infringer / illegal content. Only here is the
//                       record actually taken down.
export const MODERATION_STATES = Object.freeze({
  LIVE: 'live',
  FLAGGED: 'flagged',
  DISABLED: 'disabled',
  COUNTER_NOTICED: 'counter-noticed',
  RESTORED: 'restored',
  REMOVED: 'removed',
});

// Which surfaces can be §512(c)-disabled: only ones where WE host the bytes.
function isHostedSurface(record) {
  if (!record || typeof record !== 'object') return false;
  if (record.posture) return record.posture === POSTURES.HOST;
  // fall back to classifying the record itself
  return postureFor(record).posture === POSTURES.HOST;
}

/**
 * Apply a moderation complaint/event to a record's current state. PURE — returns the NEXT state +
 * the label/flag structure + an explanation, never mutates input, never throws.
 *
 * @param {object} record    the content record (carries .posture or enough to classify it).
 * @param {object} complaint { type, reason?, claimant?, valid? }
 *        type: 'complaint' | 'label' | 'dmca-512c' | 'counter-512g' | 'putback-window-elapsed' |
 *              'court-order' | 'repeat-infringer' | 'illegal'
 * @param {string} [state]   current state (default 'live').
 * @returns {{ state, action, label, explanation, hostedSurface }}
 */
export function moderate(record = {}, complaint = {}, state = MODERATION_STATES.LIVE) {
  const cur = Object.values(MODERATION_STATES).includes(state) ? state : MODERATION_STATES.LIVE;
  const type = norm(complaint && complaint.type);
  const hosted = isHostedSurface(record);

  const label = (text, severity) => ({
    kind: 'label',
    text,
    severity,
    reason: (complaint && complaint.reason) || null,
    claimant: (complaint && complaint.claimant) || null,
    at: 'pending', // caller stamps a real timestamp; pure here
  });

  // Terminal escalations apply from ANY state.
  if (type === 'court-order' || type === 'repeat-infringer' || type === 'illegal') {
    return {
      state: MODERATION_STATES.REMOVED,
      action: 'remove',
      label: label(`removed: ${type}`, 'terminal'),
      explanation: `terminal removal (${type}); the only path that actually takes the record down`,
      hostedSurface: hosted,
    };
  }

  switch (type) {
    case 'complaint':
    case 'label':
      // The DEFAULT posture: FLAG, don't takedown. Content stays visible.
      return {
        state: MODERATION_STATES.FLAGGED,
        action: 'flag',
        label: label('flagged — under review; content remains visible', 'notice'),
        explanation: 'flag/label only; FLAG-don\'t-takedown default keeps the record visible',
        hostedSurface: hosted,
      };

    case 'dmca-512c': {
      // §512(c): a well-formed notice on a HOSTED surface disables access (record retained). On a
      // non-hosted surface (window/aggregate) we don't host the bytes — there is nothing to disable,
      // so we FLAG instead and tell the complainant to notice the actual host.
      const wellFormed = complaint.valid !== false; // default to well-formed unless told otherwise
      if (!hosted) {
        return {
          state: MODERATION_STATES.FLAGGED,
          action: 'flag',
          label: label('§512(c) received but we do not host this content (embed/link-out); notice the host', 'notice'),
          explanation: '§512(c) on a non-hosted (window/aggregate) surface — nothing to disable; flag + redirect to host',
          hostedSurface: false,
        };
      }
      if (!wellFormed) {
        return {
          state: MODERATION_STATES.FLAGGED,
          action: 'flag',
          label: label('§512(c) notice incomplete; not actionable as filed', 'notice'),
          explanation: 'malformed §512(c) notice — flag only, do not disable',
          hostedSurface: true,
        };
      }
      return {
        state: MODERATION_STATES.DISABLED,
        action: 'disable-access',
        label: label('access disabled pending DMCA §512(c) resolution', 'restriction'),
        explanation: '§512(c) on a hosted surface: disable access, retain the record',
        hostedSurface: true,
      };
    }

    case 'counter-512g':
      // §512(g) counter-notice only makes sense once disabled.
      if (cur !== MODERATION_STATES.DISABLED) {
        return {
          state: cur,
          action: 'noop',
          label: null,
          explanation: '§512(g) counter-notice ignored unless content is currently §512(c)-disabled',
          hostedSurface: hosted,
        };
      }
      return {
        state: MODERATION_STATES.COUNTER_NOTICED,
        action: 'open-putback-window',
        label: label('§512(g) counter-notice filed; put-back window open (10–14 business days)', 'restriction'),
        explanation: '§512(g): uploader counter-noticed; access stays disabled through the put-back window',
        hostedSurface: hosted,
      };

    case 'putback-window-elapsed':
      // Window elapses with no court action → put the content back.
      if (cur !== MODERATION_STATES.COUNTER_NOTICED) {
        return {
          state: cur,
          action: 'noop',
          label: null,
          explanation: 'put-back only applies after a §512(g) counter-notice opened the window',
          hostedSurface: hosted,
        };
      }
      return {
        state: MODERATION_STATES.RESTORED,
        action: 'restore-access',
        label: label('access restored — §512(g) put-back window elapsed without court action', 'notice'),
        explanation: '§512(g): no court action within the window → access restored',
        hostedSurface: hosted,
      };

    default:
      // Unknown event → safe no-op, keep current state, do nothing destructive.
      return {
        state: cur,
        action: 'noop',
        label: null,
        explanation: `unrecognized complaint type ${JSON.stringify(type)}; no state change (safe default)`,
        hostedSurface: hosted,
      };
  }
}

/**
 * A tiny stateful wrapper around the pure `moderate` state machine, for callers that want to drive a
 * record through events without threading the state themselves. Still no I/O.
 *   const m = makeModeration(record);  m.apply({ type:'dmca-512c' });  m.state // 'disabled'
 */
export function makeModeration(record = {}, initial = MODERATION_STATES.LIVE) {
  let state = Object.values(MODERATION_STATES).includes(initial) ? initial : MODERATION_STATES.LIVE;
  const history = [];
  return {
    get state() { return state; },
    get history() { return history.slice(); },
    apply(complaint) {
      const r = moderate(record, complaint, state);
      state = r.state;
      history.push({ complaint, result: r });
      return r;
    },
  };
}

// flagDontTakedown — the named, headline entry point for the default moderation posture. A thin alias
// over `moderate` that makes the policy explicit at the call site: a plain complaint FLAGS, and a
// hosted-surface §512(c) notice follows the disable→counter→put-back path.
export function flagDontTakedown(record, complaint, state) {
  return moderate(record, complaint, state);
}

// ── interop with the Library three-bucket model ────────────────────────────────────────────────────
/**
 * Map a Library work (books) onto the generalized posture, reusing library-buckets.classify so the
 * two stay consistent. HOST_FULL→host, METADATA_ONLY→aggregate, USER_NFT→host (user-borne rights).
 */
export function postureFromLibraryBucket(work = {}) {
  const { bucket, reason } = classifyLibraryWork(work);
  if (bucket === BUCKETS.HOST_FULL || bucket === BUCKETS.USER_NFT) {
    const p = postureFor(work);
    // a Library HOST_FULL/USER_NFT is host-able; defer chain eligibility to the license tag.
    return { posture: POSTURES.HOST, reason: `library:${bucket} — ${reason}`, canChain: p.canChain, licenseTag: p.licenseTag };
  }
  return { posture: POSTURES.AGGREGATE, reason: `library:${bucket} — ${reason}`, canChain: false, licenseTag: LICENSE_TAGS.COPYRIGHTED };
}

// ── CLI demo (offline) ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('content-posture.mjs')) {
  const assets = [
    { label: 'Our corpus essay', asset: { owner: 'melek', kind: 'text' } },
    { label: 'Gutenberg PD scan', asset: { source: 'gutenberg', year: 1851 } },
    { label: 'CC0 photo', asset: { license: 'CC0 1.0' } },
    { label: 'CC-BY paper', asset: { license: 'CC BY 4.0' } },
    { label: 'CC-BY-NC image', asset: { license: 'CC BY-NC 4.0' } },
    { label: 'Gov dataset', asset: { source: 'data.gov', rights: 'U.S. Government Works' } },
    { label: 'User upload', asset: { userOriginal: true } },
    { label: 'YouTube embed', asset: { source: 'youtube', url: 'https://youtu.be/x' } },
    { label: 'Google Places card', asset: { source: 'google places' } },
    { label: 'Yelp listing', asset: { source: 'yelp' } },
    { label: 'Copyrighted, no embed', asset: { rights: 'All rights reserved' } },
    { label: 'Unknown', asset: { title: 'mystery' } },
  ];
  console.log('POSTURE / TIER:');
  for (const { label, asset } of assets) {
    const p = postureFor(asset);
    console.log(
      `${label.padEnd(24)} → ${p.posture.padEnd(10)} chain=${p.canChain ? 'Y' : 'N'} ` +
      `tier=${routeTier(asset).padEnd(14)} tag=${p.licenseTag.padEnd(14)} (${p.reason})`
    );
  }
  console.log('\nMODERATION (hosted PD asset through §512 flow):');
  const m = makeModeration({ owner: 'melek' });
  for (const c of [{ type: 'complaint' }, { type: 'dmca-512c' }, { type: 'counter-512g' }, { type: 'putback-window-elapsed' }]) {
    const r = m.apply(c);
    console.log(`  ${String(c.type).padEnd(24)} → ${r.state.padEnd(16)} action=${r.action}`);
  }
}
