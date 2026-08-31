// integrations/soapbox/join-cta.mjs — the ONE shared "Join MELEK" call-to-action.
//
// Herald's job is to turn our content traffic into users. Until now the ~90 SEO/content surfaces funneled
// nowhere — no shared signup CTA, no attribution. This is that missing shared include: a single honest CTA
// every content vertical can drop above its footer to send readers to our own sign-up funnels, with UTM
// attribution baked in so the growth funnel can tell WHICH surface converted.
//
// Honest + non-spammy: one calm banner, our own sites only, no dark patterns. esc() on every value.
// House style: pure, offline, soft-fail-never-throw, self-styled (no external CSS dependency).
//
//   import { joinCta } from '../../integrations/soapbox/join-cta.mjs'
//   layoutHtml = `...${joinCta({ source: 'hemp' })}<footer>...</footer>`

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Canonical sign-up URL (the value the tools suite already standardized on). Overridable by env for staging.
export const SIGNUP_URL = (typeof process !== 'undefined' && process.env && process.env.SIGNUP_URL) || 'https://wallet.melek.salon/signup';
export const KULA_URL = 'https://alpha.kula.money';
export const POOL_URL = 'https://pool.soapbox.community';

// Append UTM attribution so the funnel can attribute a signup back to the surface + campaign that drove it.
// source = the vertical (e.g. 'hemp', 'soapbox-data'); medium = 'content'; campaign = 'join-melek'.
export function withUtm(url, { source, medium = 'content', campaign = 'join-melek' } = {}) {
  const src = String(source || 'soapbox').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'soapbox';
  try {
    const u = new URL(url);
    u.searchParams.set('utm_source', src);
    u.searchParams.set('utm_medium', medium);
    u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch {
    const sep = String(url).includes('?') ? '&' : '?';
    return `${url}${sep}utm_source=${encodeURIComponent(src)}&utm_medium=${encodeURIComponent(medium)}&utm_campaign=${encodeURIComponent(campaign)}`;
  }
}

/**
 * joinCta({ source, medium, compact }) — the shared banner HTML (escaped, self-styled). Never throws.
 *   source  : the surface name for attribution (e.g. 'hemp', 'soapbox-data'). Required-ish; defaults 'soapbox'.
 *   compact : true → a single-line link row (for dense pages); false (default) → the full banner.
 */
export function joinCta({ source = 'soapbox', medium = 'content', compact = false } = {}) {
  try {
    const signup = esc(withUtm(SIGNUP_URL, { source, medium }));
    const kula = esc(withUtm(KULA_URL, { source, medium }));
    const pool = esc(withUtm(POOL_URL, { source, medium }));
    const style = '<style>'
      + '.join-cta{max-width:960px;margin:26px auto 0;padding:16px 18px;border:1px solid #26324a;border-radius:12px;'
      + 'background:linear-gradient(180deg,#101725,#0c111b);text-align:center;font:14px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif}'
      + '.join-cta .jc-h{font-weight:800;font-size:17px;color:#e9eef5;margin:0 0 4px}'
      + '.join-cta .jc-p{color:#8896a6;margin:0 0 12px;font-size:13px}'
      + '.join-cta a.jc-btn{display:inline-block;background:#1d9bf0;color:#04121f;font-weight:700;text-decoration:none;'
      + 'padding:9px 16px;border-radius:8px;margin:3px}'
      + '.join-cta a.jc-alt{display:inline-block;color:#9fc7ff;text-decoration:none;padding:9px 12px;margin:3px;font-size:13px}'
      + '.join-cta.compact{padding:10px 14px;text-align:left;font-size:13px}'
      + '</style>';
    if (compact) {
      return `${style}<div class="join-cta compact">Your voice is worth something — `
        + `<a class="jc-btn" href="${signup}" rel="noopener">Join MELEK free</a> `
        + `<a class="jc-alt" href="${kula}" rel="noopener">KulaSwap</a> `
        + `<a class="jc-alt" href="${pool}" rel="noopener">Mine PRANA</a></div>`;
    }
    return `${style}<div class="join-cta" role="complementary" aria-label="Join MELEK">`
      + `<p class="jc-h">Your voice is worth something on MELEK</p>`
      + `<p class="jc-p">A no-fee social blockchain that pays you for the posts, comments and votes you already make. Free account — no card, no crypto to start.</p>`
      + `<a class="jc-btn" href="${signup}" rel="noopener">Claim your free account</a>`
      + `<a class="jc-alt" href="${kula}" rel="noopener">Trade on KulaSwap →</a>`
      + `<a class="jc-alt" href="${pool}" rel="noopener">Mine PRANA →</a>`
      + `</div>`;
  } catch { return ''; }
}

// ── CLI (guarded) — print the banner for a given source ─────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('join-cta.mjs')) {
  // eslint-disable-next-line no-console
  console.log(joinCta({ source: process.argv[2] || 'soapbox' }));
}
