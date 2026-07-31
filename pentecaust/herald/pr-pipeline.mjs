// pentecaust/herald/pr-pipeline.mjs — the Herald PRESS-RELEASE pipeline (outreach brief, Component 6):
// one release/month → the same story rendered for each PR site's house format, ready to paste. Submission
// stays MANUAL (each platform has its own form + rules); this module produces the text + a submit checklist.
//
// Pure templates by default (works with NO LLM); an LLM may be injected to tighten prose but every format
// has a deterministic fallback, so it is soft-fail-never-throw and fully offline-testable. No secrets: the
// standing boilerplate is composed from env with safe placeholder defaults.
//
//   import { FORMATS, renderRelease, renderAll, boilerplate, checklist, __setLLM } from './pr-pipeline.mjs'

export function env(k, d) { const v = process.env[k]; return v == null || v === '' ? d : v; }

let _llm = null;
export function __setLLM(fn) { _llm = typeof fn === 'function' ? fn : null; }
// (LLM is reserved for future prose tightening; templates are the guaranteed path.)

// The PR distributors we format for. Each has different length/link/boilerplate norms (encoded below).
export const FORMATS = ['prlog', 'openpr', '1888pressrelease'];

const clean = (s) => String(s == null ? '' : s).trim();
const paras = (body) => clean(body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

// ── standing boilerplate — from env, never hardcoded secrets (EIN is public 501(c)(3) record). ──────────
export function boilerplate() {
  const org = env('HERALD_ORG_NAME', 'Van Kush Family Research Institute / The Shaivite Temple');
  const ein = env('HERALD_ORG_EIN', '');
  const loc = env('HERALD_ORG_LOCATION', '');
  const s1 = env('HERALD_SITE_1', 'https://melek.salon');
  const s2 = env('HERALD_SITE_2', 'https://soapbox.community');
  const papers = env('HERALD_PAPERS', 'Two peer-reviewed papers published January 2026.');
  const bits = [`About ${org}.`, papers];
  if (ein) bits.push(`EIN ${ein}.`);
  if (loc) bits.push(loc + '.');
  bits.push(`${s1} · ${s2}`);
  return bits.join(' ');
}

function quoteBlock(quotes, max) {
  const list = Array.isArray(quotes) ? quotes.filter((q) => q && clean(q.text)) : [];
  return list.slice(0, max).map((q) => `"${clean(q.text)}"${q.who ? ` — ${clean(q.who)}` : ''}`).join('\n\n');
}

// ── render one format ──────────────────────────────────────────────────────────────────────────────────
// Unknown format → soft-fail { ok:false }. Never throws.
export function renderRelease(format, release = {}, opts = {}) {
  const fmt = clean(format);
  if (!FORMATS.includes(fmt)) return { ok: false, reason: 'unknown format' };

  const headline = clean(release.headline) || 'MELEK announcement';
  const subhead = clean(release.subhead);
  const dateline = clean(release.dateline);
  const body = paras(release.body);
  const contact = clean(release.contact);
  const bp = boilerplate();

  let text;
  if (fmt === 'openpr') {
    // openPR: short — headline, dateline, first ~2 paragraphs, one quote, boilerplate.
    const q = quoteBlock(release.quotes, 1);
    text = [headline, dateline, body.slice(0, 2).join('\n\n'), q, bp]
      .filter(Boolean).join('\n\n');
  } else if (fmt === '1888pressrelease') {
    // 1888PressRelease: formal + full — headline, subhead, full body, all quotes, ### end marker, boilerplate.
    const q = quoteBlock(release.quotes, 5);
    text = [headline, subhead, dateline, body.join('\n\n'), q, '###', bp]
      .filter(Boolean).join('\n\n');
  } else {
    // prlog: standard — headline, dateline, full body, up to 2 quotes, contact, boilerplate.
    const q = quoteBlock(release.quotes, 2);
    text = [headline, dateline, body.join('\n\n'), q, contact && `Contact: ${contact}`, bp]
      .filter(Boolean).join('\n\n');
  }
  return { ok: true, format: fmt, text };
}

export function renderAll(release = {}, opts = {}) {
  const out = {};
  for (const f of FORMATS) { const r = renderRelease(f, release, opts); out[f] = r.ok ? r.text : ''; }
  return out;
}

// ── manual-submission checklist (submission stays manual per each platform's rules). ────────────────────
export function checklist(release = {}) {
  const headline = clean(release.headline) || '(headline)';
  return [
    `Confirm headline: "${headline}"`,
    'Paste into PRLog — set category + tags, add the canonical link, submit.',
    'Paste into openPR — trim to their length cap, one link, submit.',
    'Paste into 1888PressRelease — add subhead, keep the ### marker, submit.',
    'Record each live release URL in the outreach DB once approved.',
  ];
}
