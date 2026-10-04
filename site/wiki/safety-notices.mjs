// site/wiki/safety-notices.mjs — SAFETY BANNERS attached to articles server-side.
//
// Some articles name a plant or practice that can kill someone who misreads the page. The warning has to
// be at the TOP, unmissable, and it has to be there whether or not the article's own text mentions it.
//
// WHY THIS IS NOT AN EDIT TO THE ARTICLE. Wiki article text is not ours to change — that is a standing
// operator rule. So the notice lives here and is prepended at render time, exactly like the figures in
// figures.mjs. The .wiki file on disk is untouched; the reader still gets the warning.
//
// WHAT GOES IN. Only lethal or serious-harm facts, stated plainly and briefly, with the specific reason.
// Not general disclaimers, not legal boilerplate, not hedging — a banner that cries wolf gets skipped,
// and then the one that matters gets skipped too.
//
//   import { noticesForPage, NOTICES, NOTICE_CSS } from './safety-notices.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** level: 'lethal' (red) | 'serious' (amber) */
export const NOTICES = {
  Old_World_vs_New_World_Magic_Herbs: [
    {
      level: 'lethal',
      title: 'Foxglove is not a psychoactive plant. It is a cardiac poison.',
      body: 'Foxglove (Digitalis purpurea) contains cardiac glycosides — digoxin and digitoxin. It has NO psychoactive '
        + 'use at any dose. It stops the heart. The gap between a medical dose and a fatal one is one of the narrowest in '
        + 'all of pharmacology, which is why digoxin is given by prescription with blood-level monitoring. '
        + 'Smoking, brewing, eating or tincturing any part of the plant can kill, and poisonings have occurred from '
        + 'drinking the water from a vase that held the flowers and from mistaking the leaves for comfrey. '
        + 'There is no preparation, dose or combination that makes it safe to self-administer. '
        + 'Datura, henbane and belladonna are dangerous in a different way — they are deliriants with a wide and '
        + 'unpredictable dose range — but foxglove is not in that category at all. Do not treat them as the same risk.',
    },
  ],
};

export const NOTICE_CSS = `
.wiki-safety{border-left:6px solid #b3261e;background:#fdeceb;color:#3a1412;border-radius:10px;padding:14px 16px;margin:0 0 20px}
.wiki-safety.serious{border-left-color:#b9741f;background:#fdf3e4;color:#3a2a12}
.wiki-safety b{display:block;font-size:15px;margin-bottom:6px}
.wiki-safety p{margin:0;font-size:14px;line-height:1.55}
@media (prefers-color-scheme:dark){
  .wiki-safety{background:#2a1413;color:#f3d9d7}
  .wiki-safety.serious{background:#2a2113;color:#f3e6cf}
}
`;

/** the banners for an article slug, already rendered — '' when there are none */
export function noticesForPage(slug) {
  const list = NOTICES[String(slug || '')] || [];
  return list.map((n) => `<aside class="wiki-safety${n.level === 'serious' ? ' serious' : ''}" role="note">`
    + `<b>⚠️ ${esc(n.title)}</b><p>${esc(n.body)}</p></aside>`).join('');
}
