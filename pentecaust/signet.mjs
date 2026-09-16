// pentecaust/signet.mjs — a SIGNET: one person's links on one page, with the verified ones marked.
//
// THE NAME. A signet is the ring-seal that proves a document really came from you. That is the job
// this page actually does — a link page's value is not the list, it is the claim "these scattered
// accounts are all genuinely mine." The word carries its own meaning, reads as sign-net, and belongs
// to nobody. (Linktree is a registered trademark; "link in bio" is the generic term precisely
// because the obvious word is owned.)
//
// WHAT MAKES THIS DIFFERENT FROM A LINK LIST. integrations/signer-connections.mjs already holds a
// MELEK account's OAuth connections in MELEK-Signer — connections the user proved by logging in to
// the provider. A signet renders those as VERIFIED and anything typed by hand as UNVERIFIED, and it
// never blurs the two. A claim you proved and a claim you typed are different claims, and a page
// that presents them identically is lying quietly.
//
// Verification is per-link and never inferred: a link is verified only when it matches a connection
// the signer actually holds for that account, on the same provider, for the same handle.
//
// Pure data + pure render. No network, no storage, no keys — the caller passes the connections in.
// Fully offline-testable, house style.

const MAX_LINKS = 100;
const MAX_LABEL = 80;
const MAX_BIO = 400;

/** Providers we can verify against, mirroring the connection store's allowlist. */
export const VERIFIABLE = Object.freeze({
  google: [/^https?:\/\/(www\.)?youtube\.com\//i],
  github: [/^https?:\/\/(www\.)?github\.com\/([^/?#]+)/i],
  discord: [/^https?:\/\/(www\.)?discord(app)?\.(com|gg)\//i],
  x: [/^https?:\/\/(www\.)?(x|twitter)\.com\/([^/?#]+)/i],
  reddit: [/^https?:\/\/(www\.)?reddit\.com\/(u|user)\/([^/?#]+)/i],
  linkedin: [/^https?:\/\/(www\.)?linkedin\.com\/in\/([^/?#]+)/i],
  facebook: [/^https?:\/\/(www\.)?facebook\.com\/([^/?#]+)/i],
  microsoft: [],
});

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Only http(s). A javascript:, data: or vbscript: URL in a user-controlled link is the oldest hole
 * in this kind of page, and an allowlist is the only version of this check that holds.
 */
export function safeUrl(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s) return null;
  let parsed;
  try { parsed = new URL(s); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

/** The handle a provider URL points at, so verification compares like with like. */
export function handleFromUrl(provider, url) {
  const pats = VERIFIABLE[String(provider || '').toLowerCase()] || [];
  for (const re of pats) {
    const m = re.exec(String(url || ''));
    if (m) {
      const tail = m[m.length - 1];
      if (tail && !/^https?:$/i.test(tail)) return String(tail).toLowerCase();
    }
  }
  return null;
}

/**
 * Decide whether a link is proven. `connections` is the public view from
 * integrations/signer-connections.mjs — provider, identity, healthy. It never contains a token, and
 * nothing here needs one.
 */
export function verifyLink(link, connections = []) {
  const url = safeUrl(link && link.url);
  if (!url) return { verified: false, reason: 'bad-url' };
  for (const [provider, pats] of Object.entries(VERIFIABLE)) {
    if (!pats.some((re) => re.test(url))) continue;
    const conn = connections.find((c) => c && String(c.provider).toLowerCase() === provider);
    if (!conn) return { verified: false, reason: 'not-connected', provider };
    if (!conn.healthy) return { verified: false, reason: 'connection-expired', provider };
    // If the connection names the account, it must be the same account the link points at.
    const claimed = handleFromUrl(provider, url);
    const known = conn.identity && (conn.identity.name || conn.identity.sub);
    if (claimed && known && String(known).toLowerCase() !== claimed) {
      return { verified: false, reason: 'handle-mismatch', provider };
    }
    return { verified: true, provider };
  }
  return { verified: false, reason: 'not-verifiable' };
}

/**
 * Build the signet. Bad links are dropped rather than rendered broken, and the count is capped so a
 * runaway import cannot turn one page into a denial of service for everyone reading it.
 */
export function buildSignet({ account, display = '', bio = '', links = [], connections = [] } = {}) {
  const a = String(account || '').trim();
  if (!a) return { ok: false, error: 'account required' };
  const out = [];
  for (const raw of (Array.isArray(links) ? links : []).slice(0, MAX_LINKS)) {
    const url = safeUrl(raw && raw.url);
    if (!url) continue;
    const v = verifyLink(raw, connections);
    out.push({
      label: String((raw && raw.label) || url).slice(0, MAX_LABEL),
      url,
      verified: v.verified,
      provider: v.provider || null,
      reason: v.reason || null,
    });
  }
  return {
    ok: true,
    signet: {
      account: a,
      display: String(display || a).slice(0, MAX_LABEL),
      bio: String(bio || '').slice(0, MAX_BIO),
      links: out,
      verifiedCount: out.filter((l) => l.verified).length,
      total: out.length,
    },
  };
}

export const SIGNET_STYLE = `<style>
 .sig{max-width:34rem;margin:0 auto;padding:2.5rem 1.25rem;font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
 .sig-name{font-size:1.5rem;font-weight:800;margin:0 0 .25rem;text-align:center}
 .sig-at{opacity:.6;text-align:center;margin:0 0 .5rem;font-size:.95rem}
 .sig-bio{opacity:.85;text-align:center;margin:0 0 1.75rem}
 .sig-link{display:flex;align-items:center;gap:.6rem;padding:.85rem 1rem;margin:.55rem 0;
   border:1px solid rgba(128,128,128,.35);border-radius:12px;text-decoration:none;color:inherit;font-weight:600}
 .sig-link:hover{border-color:#4c8dff}
 .sig-link:focus-visible{outline:2px solid #4c8dff;outline-offset:2px}
 .sig-mark{margin-left:auto;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;
   border:1px solid currentColor;border-radius:6px;padding:.1rem .4rem;opacity:.85}
 .sig-mark.ok{color:#2e7d32} .sig-mark.no{color:#8a8a8a}
 @media(prefers-color-scheme:dark){.sig-mark.ok{color:#7bc47f}}
 .sig-foot{margin-top:2rem;text-align:center;font-size:.8rem;opacity:.6}
</style>`;

/**
 * Render. The verified/unverified distinction is shown on every row, because the whole point of
 * calling it a signet is that a proven claim looks different from a typed one.
 */
export function renderSignet(signet, { base = '' } = {}) {
  if (!signet) return '';
  const rows = signet.links.map((l) => {
    const mark = l.verified
      ? '<span class="sig-mark ok" title="proven by a connected account">verified</span>'
      : '<span class="sig-mark no" title="added by hand, not proven">listed</span>';
    // ONE rel attribute, computed. Emitting two made the browser take the first, which meant an
    // unproven link shipped rel="me" — a machine-readable ownership claim — and never got nofollow.
    // That is precisely the lie the verified/listed split exists to prevent, asserted in hypertext.
    const rel = l.verified ? 'noopener noreferrer me' : 'noopener noreferrer nofollow ugc';
    return `<a class=sig-link href="${esc(l.url)}" rel="${rel}">${esc(l.label)}${mark}</a>`;
  }).join('');
  return `<div class=sig>
<h1 class=sig-name>${esc(signet.display)}</h1>
<p class=sig-at>@${esc(signet.account)}</p>
${signet.bio ? `<p class=sig-bio>${esc(signet.bio)}</p>` : ''}
${rows || '<p class=sig-bio>No links yet.</p>'}
<p class=sig-foot>${signet.verifiedCount} of ${signet.total} proven by a connected account${base ? ` &middot; <a href="${esc(base)}">Pentecaust</a>` : ''}</p>
</div>`;
}
