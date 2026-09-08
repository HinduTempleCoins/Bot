// community-radar — find the real groups in a city, and the people who run them.
//
// The operator's ask: the Telegram "nearby groups" idea, generalised. Start with Dallas — inside our
// niches and outside them — then repeat in "urban capitals for different languages on different
// continents." The point is not a list of cities; it is a list of ORGANISERS, because a group has
// one person who decides whether it hears about you and a thousand who do not.
//
// WHAT ACTUALLY ANSWERS A SCRIPT, probed 2026-09-08:
//   Meetup       200, ~232KB, embeds __NEXT_DATA__ and real group slugs      -> USABLE
//   Discord      invite API resolves server name + live member counts        -> USABLE (proven: 40+ servers)
//   Telegram     t.me/<name> distinguishes real from missing                 -> USABLE
//   Eventbrite   405 to a plain GET                                          -> needs their API key
//   Reddit       403 to any unauthenticated JSON                             -> needs OAuth
//   disboard / discord.me  403                                              -> Cloudflare
// So this module reads the three that work and says plainly that the other three need credentials,
// rather than pretending a partial sweep is a complete one.
//
// ⚠️ WHAT THIS IS NOT. It finds groups and their PUBLISHED organiser contacts. It does not scrape
// members, and there is no bulk-DM path here by design — this project has three Hive accounts on a
// spam blacklist from exactly that behaviour. A group is approached through its organiser, once, or
// not at all.
//
// House rules: ESM, injectable fetch, soft-fail-never-throw, no keys.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => String(v == null ? '' : v);
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

// ---------------------------------------------------------------------------
// 1. THE CITIES
//
// "Urban capitals for different languages on different continents." Each entry carries the Meetup
// location slug (their own format, `country--region--City`), so the sweep is one lookup per city.
// ---------------------------------------------------------------------------

export const CITIES = Object.freeze([
  // North America — home first
  { id: 'dallas', name: 'Dallas', country: 'US', continent: 'North America', lang: 'en',
    meetup: 'us--tx--Dallas', home: true },
  { id: 'nyc', name: 'New York', country: 'US', continent: 'North America', lang: 'en',
    meetup: 'us--ny--New_York' },
  { id: 'mexico-city', name: 'Mexico City', country: 'MX', continent: 'North America', lang: 'es',
    meetup: 'mx--Mexico_City' },
  { id: 'montreal', name: 'Montreal', country: 'CA', continent: 'North America', lang: 'fr',
    meetup: 'ca--qc--Montreal' },
  // South America
  { id: 'sao-paulo', name: 'São Paulo', country: 'BR', continent: 'South America', lang: 'pt',
    meetup: 'br--S%C3%A3o_Paulo' },
  { id: 'buenos-aires', name: 'Buenos Aires', country: 'AR', continent: 'South America', lang: 'es',
    meetup: 'ar--Buenos_Aires' },
  // Europe
  { id: 'london', name: 'London', country: 'GB', continent: 'Europe', lang: 'en',
    meetup: 'gb--London' },
  { id: 'berlin', name: 'Berlin', country: 'DE', continent: 'Europe', lang: 'de',
    meetup: 'de--Berlin' },
  { id: 'madrid', name: 'Madrid', country: 'ES', continent: 'Europe', lang: 'es',
    meetup: 'es--Madrid' },
  { id: 'paris', name: 'Paris', country: 'FR', continent: 'Europe', lang: 'fr',
    meetup: 'fr--Paris' },
  { id: 'warsaw', name: 'Warsaw', country: 'PL', continent: 'Europe', lang: 'pl',
    meetup: 'pl--Warsaw' },
  // Africa
  { id: 'lagos', name: 'Lagos', country: 'NG', continent: 'Africa', lang: 'en',
    meetup: 'ng--Lagos' },
  { id: 'nairobi', name: 'Nairobi', country: 'KE', continent: 'Africa', lang: 'sw',
    meetup: 'ke--Nairobi' },
  { id: 'cairo', name: 'Cairo', country: 'EG', continent: 'Africa', lang: 'ar',
    meetup: 'eg--Cairo' },
  { id: 'accra', name: 'Accra', country: 'GH', continent: 'Africa', lang: 'en',
    meetup: 'gh--Accra' },
  // Asia
  { id: 'mumbai', name: 'Mumbai', country: 'IN', continent: 'Asia', lang: 'hi',
    meetup: 'in--Mumbai' },
  { id: 'manila', name: 'Manila', country: 'PH', continent: 'Asia', lang: 'tl',
    meetup: 'ph--Manila' },
  { id: 'jakarta', name: 'Jakarta', country: 'ID', continent: 'Asia', lang: 'id',
    meetup: 'id--Jakarta' },
  { id: 'seoul', name: 'Seoul', country: 'KR', continent: 'Asia', lang: 'ko',
    meetup: 'kr--Seoul' },
  { id: 'istanbul', name: 'Istanbul', country: 'TR', continent: 'Asia', lang: 'tr',
    meetup: 'tr--Istanbul' },
  // Oceania
  { id: 'sydney', name: 'Sydney', country: 'AU', continent: 'Oceania', lang: 'en',
    meetup: 'au--Sydney' },
]);

export const city = (id) => CITIES.find((c) => c.id === str(id)) || null;
export const byContinent = (c) => CITIES.filter((x) => x.continent === str(c));
export const byLanguage = (l) => CITIES.filter((x) => x.lang === str(l));

// ---------------------------------------------------------------------------
// 2. THE NICHES
//
// "In and out of our niches" -- so both. The out-of-niche terms exist because a records-request tool
// and a free credential map are useful to people who have never heard of a blockchain, and those
// rooms are far larger and far less hostile than the crypto ones.
// ---------------------------------------------------------------------------

export const NICHES = Object.freeze({
  inNiche: ['blockchain', 'crypto', 'web3', 'bitcoin', 'ethereum', 'defi', 'dao'],
  adjacent: ['startup', 'entrepreneur', 'developer', 'open source', 'ai', 'tech'],
  outOfNiche: [
    'harm reduction', 'recovery', 'reentry', 'legal aid', 'tenants rights',
    'civil rights', 'journalism', 'public records', 'adult education', 'literacy',
    'religion', 'spirituality', 'interfaith', 'meditation', 'herbalism',
    'veterans', 'homeless outreach', 'mutual aid', 'food bank', 'library',
  ],
});

// ---------------------------------------------------------------------------
// 3. READERS
// ---------------------------------------------------------------------------

async function get(url, timeout = 15000) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    const r = await _fetch(url, { headers: UA, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, status: r.status, body: '' };
    return { ok: true, status: r.status, body: await r.text() };
  } catch { return { ok: false, status: 0, body: '' }; }
}

const NOT_A_GROUP = ['find', 'about', 'help', 'blog', 'members', 'login', 'home', 'pro', 'topics'];

/** Pull group slugs out of a rendered Meetup page. */
export function parseMeetupSlugs(html) {
  const slugs = new Set();
  for (const m of str(html).matchAll(/meetup\.com\/([a-zA-Z0-9-]{4,60})\//g)) {
    if (!NOT_A_GROUP.includes(m[1].toLowerCase())) slugs.add(m[1]);
  }
  return [...slugs];
}

export const meetupUrl = (c, query) =>
  `https://www.meetup.com/find/?location=${c.meetup}&source=GROUPS`
  + (query ? `&keywords=${encodeURIComponent(query)}` : '');

/**
 * Meetup groups for a city.
 *
 * ⚠️ A KEYWORD SEARCH NEEDS A REAL BROWSER. Plain fetch works for the unfiltered browse page, which
 * Meetup renders server-side, but every `keywords=` search is rendered client-side — a raw fetch
 * gets an empty shell and returns zero. Measured: "recovery" returned 0 by fetch and 16 by a
 * headless browser; "blockchain" returned 2 by fetch and 17 by browser, and only the browser found
 * `Dallas-Blockchain-Hyperledger-Meetup`.
 *
 * Returning 0 there would read as "there are no recovery groups in Dallas," which is false and is
 * the worst kind of wrong output — confidently empty. So a keyword search without a `render`
 * function REFUSES rather than returning a misleading zero.
 *
 * @param {{ render?: (url:string) => Promise<string> }} opts pass a headless-browser fetcher
 */
export async function meetupGroups(cityId, { query = '', render = null } = {}) {
  const c = city(cityId);
  if (!c) return { ok: false, reason: 'unknown city', groups: [] };
  const url = meetupUrl(c, query);

  if (query && !render) {
    return {
      ok: false, needsRender: true, city: c.id, query, url, groups: [],
      reason: 'keyword search is client-rendered — a plain fetch returns an empty shell. Pass a '
            + '`render` function (headless browser) or use the unfiltered browse instead of '
            + 'reporting a false zero.',
    };
  }

  const html = render ? await render(url).catch(() => '') : (await get(url)).body;
  if (!html) return { ok: false, reason: 'no content returned', city: c.id, query, groups: [] };
  return {
    ok: true, city: c.id, query, rendered: !!render,
    groups: parseMeetupSlugs(html).map((s) => ({ slug: s, url: `https://www.meetup.com/${s}/` })),
  };
}

/** Resolve a Discord invite to a real server with a live member count. */
export async function discordInvite(code) {
  const r = await get(`https://discord.com/api/v10/invites/${encodeURIComponent(str(code))}?with_counts=true`);
  if (!r.ok) return null;
  try {
    const d = JSON.parse(r.body);
    if (!d.guild) return null;
    return {
      code: str(code), server: d.guild.name,
      members: d.approximate_member_count, online: d.approximate_presence_count,
      description: str(d.guild.description).slice(0, 160),
      url: `https://discord.gg/${code}`,
    };
  } catch { return null; }
}

/** Telegram returns a page for everything; only a real handle carries the profile markup. */
export async function telegramExists(handle) {
  const r = await get(`https://t.me/${encodeURIComponent(str(handle))}`);
  if (!r.ok) return false;
  return /tgme_page_title|If you have Telegram/i.test(r.body);
}

// ---------------------------------------------------------------------------
// 4. WHAT NEEDS CREDENTIALS
//
// Named honestly so nobody assumes a sweep was complete when three of six sources were shut.
// ---------------------------------------------------------------------------

export const BLOCKED_SOURCES = Object.freeze([
  { source: 'Eventbrite', status: 405, needs: 'an Eventbrite API private token (free to create)',
    value: 'ticketed local events and their organisers — the best organiser-contact source of the six' },
  { source: 'Reddit', status: 403, needs: 'a Reddit OAuth app (free, script-type)',
    value: 'city subreddits and their moderators' },
  { source: 'disboard.org / discord.me', status: 403, needs: 'a browser session; Cloudflare-protected',
    value: 'discovering Discord invites by city/topic tag — we can VERIFY an invite but not DISCOVER one' },
  { source: 'Facebook Groups', status: null, needs: 'Meta app review for Groups API',
    value: 'the largest local groups anywhere; effectively closed to automation' },
]);

// ---------------------------------------------------------------------------
// 5. THE SWEEP
// ---------------------------------------------------------------------------

/** One city, across chosen niche buckets. Returns groups plus an explicit gaps list. */
export async function sweepCity(cityId, { buckets = ['inNiche', 'outOfNiche'], limitPerQuery = 40, render = null } = {}) {
  const c = city(cityId);
  if (!c) return { ok: false, reason: 'unknown city' };
  if (!render) {
    return {
      ok: false, city: c, groups: [], needsRender: true,
      reason: 'a keyword sweep requires a headless-browser `render` function — see meetupGroups(). '
            + 'Without it every query returns an empty shell and the sweep would report zero groups '
            + 'in a city full of them.',
    };
  }
  const found = new Map();
  const queries = [];
  for (const b of buckets) for (const q of (NICHES[b] || [])) queries.push({ bucket: b, q });

  for (const { bucket, q } of queries) {
    const r = await meetupGroups(cityId, { query: q, render });
    if (!r.ok) continue;
    for (const g of r.groups.slice(0, limitPerQuery)) {
      const prev = found.get(g.slug);
      if (prev) { if (!prev.matched.includes(q)) prev.matched.push(q); continue; }
      found.set(g.slug, { ...g, bucket, matched: [q], source: 'meetup' });
    }
  }
  return {
    ok: true,
    city: c,
    groups: [...found.values()],
    queriesRun: queries.length,
    gaps: BLOCKED_SOURCES.map((b) => `${b.source}: ${b.needs}`),
    note: 'Groups only. Organiser contact requires opening each group page, and outreach goes to '
        + 'the organiser once — never to the membership.',
  };
}

/** A plan across many cities, ordered so home comes first. */
export function sweepPlan({ cities = CITIES, buckets = ['inNiche', 'outOfNiche'] } = {}) {
  const ordered = [...cities].sort((a, b) => (b.home ? 1 : 0) - (a.home ? 1 : 0));
  const perCity = buckets.reduce((n, b) => n + (NICHES[b] || []).length, 0);
  return {
    cities: ordered.map((c) => ({ id: c.id, name: c.name, lang: c.lang, continent: c.continent })),
    queriesPerCity: perCity,
    totalRequests: ordered.length * perCity,
    languages: [...new Set(ordered.map((c) => c.lang))],
    continents: [...new Set(ordered.map((c) => c.continent))],
    note: 'Sequential and slow on purpose — a burst of requests is how a scraper gets blocked, and '
        + 'we only need this list once.',
  };
}

export function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  if (url.pathname.endsWith('/cities')) return send(200, { ok: true, cities: CITIES });
  if (url.pathname.endsWith('/niches')) return send(200, { ok: true, niches: NICHES });
  if (url.pathname.endsWith('/gaps')) return send(200, { ok: true, blocked: BLOCKED_SOURCES });
  return send(200, {
    ok: true, service: 'community-radar',
    cities: CITIES.length,
    continents: [...new Set(CITIES.map((c) => c.continent))],
    languages: [...new Set(CITIES.map((c) => c.lang))],
    policy: 'Finds groups and published organiser contacts. Never scrapes members. Outreach is to '
          + 'one organiser, once.',
  });
}
