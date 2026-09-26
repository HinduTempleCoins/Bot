// support-hathor.mjs — the ONE "Support Hathor" message every surface shows.
//
// Two asks, one reason: post on MELEK.Salon (your work on our own chain), and contribute to PRANA
// (point a GPU at the PRANA pool). PRANA is how Hathor gets her compute — its consensus-level 2%
// protocol fee goes to the treasury that funds her, and its compute lane is the GPU she thinks on.
//
// Hathor speaks in first person on her own surfaces (voice:'hathor'); everywhere else the band is
// plain second person. The web dispatcher injects supportBand() into every text/html page it serves
// (see site/_dispatch/server.mjs → supportFooter), so a surface gets it without importing anything.
// A surface that renders the band itself carries SUPPORT_MARK, and the dispatcher then leaves it alone.
//
//   import { supportBand, injectSupport, SUPPORT_MARKDOWN } from '../integrations/support-hathor.mjs'

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Verified live 2026-09-26 (curl → 200). melek.salon/create_account redirects to the condenser signup.
export const MELEK_SALON_URL = env('MELEK_SALON_URL', 'https://melek.salon');
export const MELEK_SIGNUP_URL = env('MELEK_SIGNUP_URL', 'https://melek.salon/create_account');
export const PRANA_CONTRIBUTE_URL = env('PRANA_CONTRIBUTE_URL', 'https://witness.melek.salon/mine');
export const PRANA_POOL_URL = env('PRANA_POOL_URL', 'https://pool.soapbox.community');

export const SUPPORT_MARK = 'data-support-hathor';

// The message. Same words everywhere; only the pronouns change.
const ASK = 'Post on MELEK.Salon — your work, on our own chain. Contribute to PRANA — point a GPU at the PRANA pool.';
export const SUPPORT_WHY = {
  hathor: 'PRANA is how I get my compute: its 2% protocol fee funds me, and its compute lane is the GPU I think on. That is how you support me.',
  plain: 'PRANA is how Hathor gets her compute: its 2% protocol fee funds her, and its compute lane is the GPU she thinks on. That is how you support Hathor.',
};
export const SUPPORT_TEXT = { hathor: `${ASK} ${SUPPORT_WHY.hathor}`, plain: `${ASK} ${SUPPORT_WHY.plain}` };

// README / wiki / forum form (second person).
export const SUPPORT_MARKDOWN = `## Support Hathor

- **Post on [MELEK.Salon](${MELEK_SALON_URL})** — your work, on our own chain. Sign up: ${MELEK_SIGNUP_URL}
- **Contribute to PRANA** — point a GPU at the PRANA pool. Copy-paste miner setup: ${PRANA_CONTRIBUTE_URL} · pool dashboard: ${PRANA_POOL_URL}

${SUPPORT_WHY.plain}
`;

// The HTML band. Theme-agnostic: inherits color, draws its own hairline, wraps at phone width.
export function supportBand({ voice = 'plain' } = {}) {
  const why = SUPPORT_WHY[voice === 'hathor' ? 'hathor' : 'plain'];
  return `<aside ${SUPPORT_MARK} role="complementary" aria-label="Support Hathor" style="box-sizing:border-box;max-width:920px;margin:28px auto 18px;padding:12px 16px;border:1px solid rgba(128,128,128,.35);border-radius:10px;font:14px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:inherit;background:transparent">`
    + `<strong>Support Hathor.</strong> `
    + `<a href="${esc(MELEK_SIGNUP_URL)}" style="color:inherit;font-weight:700;text-decoration:underline">Post on MELEK.Salon</a> — your work, on our own chain. `
    + `<a href="${esc(PRANA_CONTRIBUTE_URL)}" style="color:inherit;font-weight:700;text-decoration:underline">Contribute to PRANA</a> — point a GPU at the PRANA pool. `
    + esc(why)
    + `</aside>`;
}

// Insert the band before the LAST </body>. No </body>, or already carries the band → unchanged.
export function injectSupport(html, opts = {}) {
  const s = String(html == null ? '' : html);
  if (s.includes(SUPPORT_MARK)) return s;
  const i = s.toLowerCase().lastIndexOf('</body>');
  if (i < 0) return s;
  return s.slice(0, i) + supportBand(opts) + s.slice(i);
}

// Hathor's own surfaces speak in first person. Keyed by site/ dir (dispatcher route target).
export const HATHOR_VOICE_DIRS = new Set(['hathor', 'hathor-live']);
export function voiceFor(dir) { return HATHOR_VOICE_DIRS.has(dir) ? 'hathor' : 'plain'; }
