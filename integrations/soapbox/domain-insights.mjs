// domain-insights.mjs — the "Alexa rankings" replacement (operator 2026-06-02). Given a domain, returns
// a popularity RANK (Tranco — a free, manipulation-resistant academic top-list), domain AGE (RDAP
// registration date, keyless), and an on-page SEO score (reuses seo-audit). All keyless. This is what
// makes the Directory subdomain double as a site-insights surface. Best-effort: any source may be null.

import { auditPage } from './seo-audit.mjs';

const UA = 'Mozilla/5.0 (compatible; SoapBox-Insights/1.0; +https://directory.soapbox.community)';
const T = (ms) => AbortSignal.timeout(ms);

/** Normalize "https://www.x.com/path" or "X.com" → "x.com" (registrable-ish host, lowercased). */
export function normDomain(input) {
  let h = String(input || '').trim().toLowerCase();
  if (!h) return '';
  if (h.includes('://')) { try { h = new URL(h).hostname; } catch { h = h.replace(/^.*:\/\//, '').split('/')[0]; } }
  else h = h.split('/')[0];
  h = h.replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : '';
}

/** Tranco rank (lower = more popular). Keyless. Returns { rank, date } or null. */
export async function trancoRank(domain) {
  try {
    const r = await fetch(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`, { headers: { 'user-agent': UA }, signal: T(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    const latest = (d.ranks || []).find((x) => x.rank);
    return latest ? { rank: latest.rank, date: latest.date } : null;
  } catch { return null; }
}

/** Registration date + age via RDAP (keyless). Returns { registered, ageYears, registrar } or null. */
export async function domainAge(domain) {
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { headers: { 'user-agent': UA, accept: 'application/rdap+json' }, signal: T(8000), redirect: 'follow' });
    if (!r.ok) return null;
    const d = await r.json();
    const reg = (d.events || []).find((e) => e.eventAction === 'registration');
    const registrar = (d.entities || []).find((e) => (e.roles || []).includes('registrar'));
    const out = { registered: reg?.eventDate || null, ageYears: null, registrar: registrar?.vcardArray?.[1]?.find?.((x) => x[0] === 'fn')?.[3] || null };
    if (out.registered) { const ms = Date.parse(out.registered); if (Number.isFinite(ms)) out.ageYears = Math.max(0, Math.round((Date.now() - ms) / 31557600000 * 10) / 10); }
    return out;
  } catch { return null; }
}

/** Combined insights for a domain. seo:false skips the (slower) on-page audit. */
export async function insights(input, { seo = true } = {}) {
  const domain = normDomain(input);
  if (!domain) return { domain: '', error: 'invalid domain' };
  const [rank, age, audit] = await Promise.all([
    trancoRank(domain),
    domainAge(domain),
    seo ? auditPage(`https://${domain}/`).then((a) => ({ score: a.score, fails: a.fails, warns: a.warns })).catch(() => null) : Promise.resolve(null),
  ]);
  return { domain, rank, age, seo: audit };
}

if (process.argv[1] && process.argv[1].endsWith('domain-insights.mjs')) {
  console.log(JSON.stringify(await insights(process.argv[2] || 'github.com'), null, 2));
}
