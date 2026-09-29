// media-sources.mjs — open-licence media for Hathor's video pipeline and the Video Studio.
// One search over public-domain / CC0 / CC-BY sources; every hit carries its licence and an attribution line.
//
//   import { search, sources } from './integrations/media-sources.mjs'
//   await search('Meroe pyramids', { type: 'image', licence: 'cc-by', limit: 20 })
//     → [{ url, thumb, title, creator, licence, licenceUrl, attribution, source, page, width, height }]
//
// licence filter (inclusive, strictest first): 'pd' (public domain / PDM) ⊂ 'cc0' (pd + CC0) ⊂ 'cc-by' (+ CC BY, BY-SA).
// NC/ND licences are never returned (they would block commercial use / remixing in videos).
// Keyless: Openverse, Wikimedia Commons, Met, Cleveland, Art Institute of Chicago, Library of Congress, Internet
// Archive. Need a free key (skipped when absent): Europeana (EUROPEANA_API_KEY), Smithsonian (SMITHSONIAN_API_KEY,
// api.data.gov), Freesound (FREESOUND_API_KEY). Injectable fetch, soft-fail per source (a dead source → no hits).

const UA = 'SoapBoxMedia/1.0 (https://hathor.soapbox.community; open-licence media search)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const RANK = { pd: 0, cc0: 1, 'cc-by': 2, 'cc-by-sa': 2 };
const allowed = (lic, want) => lic in RANK && RANK[lic] <= (want === 'pd' ? 0 : want === 'cc0' ? 1 : 2);
const strip = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function getJson(url, opts = {}, ms = 15000) {
  try {
    const r = await Promise.race([
      _fetch(url, { ...opts, headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
    ]);
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Map a licence string/URL to one of pd | cc0 | cc-by | cc-by-sa | null (anything else, incl. NC/ND). */
export function normLicence(x) {
  const s = String(x || '').toLowerCase();
  if (!s) return null;
  if (/(-nc|\bnc\b|noncommercial|-nd|\bnd\b|noderiv)/.test(s)) return null;
  if (/publicdomain\/zero|\bcc0\b|cc-zero/.test(s)) return 'cc0';
  if (/publicdomain\/mark|\bpdm\b|public ?domain|^pd$|no known restrictions/.test(s)) return 'pd';
  if (/by-sa|by_sa|\bbysa\b/.test(s)) return 'cc-by-sa';
  if (/licenses\/by\/|\bcc[- ]?by\b|^by$/.test(s)) return 'cc-by';
  return null;
}

export function attributionLine(h) {
  const lic = { pd: 'Public domain', cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-sa': 'CC BY-SA' }[h.licence] || h.licence;
  return [h.title && `"${h.title}"`, h.creator && `by ${h.creator}`, `${lic}${h.licenceVersion ? ` ${h.licenceVersion}` : ''}`, `via ${h.source}`].filter(Boolean).join(', ');
}
const hit = (o) => ({ ...o, attribution: attributionLine(o) });

// ── sources ─────────────────────────────────────────────────────────────────────────────────────
const openverse = {
  name: 'Openverse', types: ['image', 'audio'], needsKey: null, licence: 'CC / PD (per item)',
  async search(q, { type, limit }) {
    const kind = type === 'audio' ? 'audio' : 'images';
    const j = await getJson(`https://api.openverse.org/v1/${kind}/?q=${encodeURIComponent(q)}&license=cc0,pdm,by,by-sa&page_size=${Math.min(limit, 50)}`);
    return (j && j.results || []).map((r) => hit({
      url: r.url, thumb: r.thumbnail || '', title: strip(r.title), creator: strip(r.creator), licence: normLicence(r.license === 'pdm' ? 'pdm' : r.license === 'cc0' ? 'cc0' : r.license),
      licenceVersion: r.license_version || '', licenceUrl: r.license_url || '', source: `Openverse (${r.source || r.provider || 'web'})`, page: r.foreign_landing_url || '',
      width: r.width || 0, height: r.height || 0, duration: r.duration || 0, type: type === 'audio' ? 'audio' : 'image',
    }));
  },
};

const commons = {
  name: 'Wikimedia Commons', types: ['image', 'audio', 'video'], needsKey: null, licence: 'PD / CC0 / CC BY / BY-SA (per file)',
  async search(q, { type, limit }) {
    const ft = type === 'audio' ? ' filetype:audio' : type === 'video' ? ' filetype:video' : ' filetype:bitmap';
    const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q + ft)}&gsrlimit=${Math.min(limit, 50)}&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1280&format=json&origin=*`);
    const pages = j && j.query && j.query.pages ? Object.values(j.query.pages) : [];
    return pages.map((p) => {
      const ii = (p.imageinfo || [])[0] || {}; const m = ii.extmetadata || {};
      const v = (k) => (m[k] && m[k].value) || '';
      return hit({
        url: ii.url, thumb: ii.thumburl || '', title: strip(v('ObjectName') || p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')),
        creator: strip(v('Artist')).slice(0, 120), licence: normLicence(v('LicenseShortName') || v('LicenseUrl')), licenceUrl: v('LicenseUrl'),
        source: 'Wikimedia Commons', page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
        width: ii.width || 0, height: ii.height || 0, type: /^audio/.test(ii.mime || '') ? 'audio' : /^video/.test(ii.mime || '') ? 'video' : 'image',
      });
    });
  },
};

const met = {
  name: 'The Met Open Access', types: ['image'], needsKey: null, licence: 'CC0 (public-domain works)',
  async search(q, { limit }) {
    const s = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(q)}`);
    const ids = (s && s.objectIDs || []).slice(0, Math.min(limit, 12));
    const objs = await Promise.all(ids.map((id) => getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`)));
    return objs.filter((o) => o && o.isPublicDomain && o.primaryImage).map((o) => hit({
      url: o.primaryImage, thumb: o.primaryImageSmall || '', title: strip(o.title), creator: strip(o.artistDisplayName || o.culture || ''),
      licence: 'cc0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', source: 'The Metropolitan Museum of Art', page: o.objectURL, date: o.objectDate || '', type: 'image',
    }));
  },
};

const cleveland = {
  name: 'Cleveland Museum of Art Open Access', types: ['image'], needsKey: null, licence: 'CC0',
  async search(q, { limit }) {
    const j = await getJson(`https://openaccess-api.clevelandart.org/api/artworks/?q=${encodeURIComponent(q)}&has_image=1&cc0=1&limit=${Math.min(limit, 50)}`);
    return (j && j.data || []).filter((r) => r.share_license_status === 'CC0' && r.images && r.images.web).map((r) => hit({
      url: (r.images.print || r.images.web).url, thumb: r.images.web.url, title: strip(r.title), creator: strip(((r.creators || [])[0] || {}).description || r.culture || ''),
      licence: 'cc0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', source: 'Cleveland Museum of Art', page: r.url || '', date: r.creation_date || '', type: 'image',
    }));
  },
};

const aic = {
  name: 'Art Institute of Chicago', types: ['image'], needsKey: null, licence: 'CC0 (public-domain works)',
  async search(q, { limit }) {
    const j = await getJson(`https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&limit=${Math.min(limit, 50)}&fields=id,title,artist_title,image_id,is_public_domain,date_display`);
    return (j && j.data || []).filter((r) => r.is_public_domain && r.image_id).map((r) => hit({
      url: `https://www.artic.edu/iiif/2/${r.image_id}/full/1686,/0/default.jpg`, thumb: `https://www.artic.edu/iiif/2/${r.image_id}/full/400,/0/default.jpg`,
      title: strip(r.title), creator: strip(r.artist_title || ''), licence: 'cc0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      source: 'Art Institute of Chicago', page: `https://www.artic.edu/artworks/${r.id}`, date: r.date_display || '', type: 'image',
    }));
  },
};

const loc = {
  name: 'Library of Congress', types: ['image'], needsKey: null, licence: "only items whose record says 'No known restrictions on publication'",
  async search(q, { limit }) {
    const j = await getJson(`https://www.loc.gov/photos/?q=${encodeURIComponent(q)}&fo=json&c=${Math.min(limit, 12)}&at=results`);
    const rows = (j && j.results || []).filter((r) => !r.access_restricted).slice(0, Math.min(limit, 12));
    // the rights advisory lives on each item record, not on the search result
    const items = await Promise.all(rows.map((r) => getJson(`${String(r.id || r.url || '').replace(/^http:/, 'https:').replace(/\/?$/, '/')}?fo=json&at=item`)));
    return rows.map((r, i) => {
      const it = (items[i] && items[i].item) || {};
      if (!/no known restrictions/i.test(String(it.rights_advisory || ''))) return null;
      const imgs = [].concat(r.image_url || []); const big = imgs[imgs.length - 1] || '';
      return hit({ url: big.replace(/#.*$/, ''), thumb: (imgs[0] || '').replace(/#.*$/, ''), title: strip(r.title), creator: strip([].concat(r.contributor || [])[0] || ''),
        licence: 'pd', licenceUrl: 'https://www.loc.gov/legal/', source: 'Library of Congress', page: String(r.id || r.url || ''), date: r.date || '', type: 'image' });
    }).filter(Boolean);
  },
};

const archiveAudio = {
  name: 'Internet Archive (public-domain audio)', types: ['audio'], needsKey: null, licence: 'items with a PD/CC0 licenseurl only',
  async search(q, { limit }) {
    const j = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(${q}) AND mediatype:audio AND (licenseurl:*publicdomain* OR licenseurl:*zero*)`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=${Math.min(limit, 50)}&output=json`);
    return (j && j.response && j.response.docs || []).map((d) => hit({
      url: `https://archive.org/download/${d.identifier}`, thumb: '', title: strip(Array.isArray(d.title) ? d.title[0] : d.title), creator: strip([].concat(d.creator || [])[0] || ''),
      licence: normLicence(d.licenseurl), licenceUrl: d.licenseurl || '', source: 'Internet Archive', page: `https://archive.org/details/${d.identifier}`, type: 'audio',
    }));
  },
};

const europeana = {
  name: 'Europeana', types: ['image', 'video', 'audio'], needsKey: 'EUROPEANA_API_KEY', licence: 'PD / CC0 / CC BY / BY-SA (per item; reusability=open)',
  async search(q, { type, limit }) {
    const key = process.env.EUROPEANA_API_KEY; if (!key) return [];
    const t = { image: 'IMAGE', video: 'VIDEO', audio: 'SOUND' }[type] || 'IMAGE';
    const j = await getJson(`https://api.europeana.eu/record/v2/search.json?wskey=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&reusability=open&media=true&qf=TYPE:${t}&rows=${Math.min(limit, 50)}`);
    return (j && j.items || []).map((r) => hit({
      url: [].concat(r.edmIsShownBy || [])[0] || '', thumb: [].concat(r.edmPreview || [])[0] || '', title: strip([].concat(r.title || [])[0]), creator: strip([].concat(r.dcCreator || [])[0] || ''),
      licence: normLicence([].concat(r.rights || [])[0]), licenceUrl: [].concat(r.rights || [])[0] || '', source: `Europeana (${strip([].concat(r.dataProvider || [])[0] || '')})`, page: r.guid || '', type,
    }));
  },
};

const smithsonian = {
  name: 'Smithsonian Open Access', types: ['image'], needsKey: 'SMITHSONIAN_API_KEY', licence: 'CC0',
  async search(q, { limit }) {
    const key = process.env.SMITHSONIAN_API_KEY; if (!key) return [];
    const j = await getJson(`https://api.si.edu/openaccess/api/v1.0/search?q=${encodeURIComponent(`${q} AND online_media_type:Images`)}&rows=${Math.min(limit, 50)}&api_key=${encodeURIComponent(key)}`);
    return (j && j.response && j.response.rows || []).map((r) => {
      const media = (((r.content || {}).descriptiveNonRepeating || {}).online_media || {}).media || [];
      const m = media.find((x) => x.usage && /cc0/i.test(x.usage.access || '')) || null;
      return m ? hit({ url: m.content, thumb: m.thumbnail || '', title: strip(r.title), creator: '', licence: 'cc0', licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
        source: 'Smithsonian Institution', page: ((r.content || {}).descriptiveNonRepeating || {}).record_link || '', type: 'image' }) : null;
    }).filter(Boolean);
  },
};

const freesound = {
  name: 'Freesound', types: ['audio'], needsKey: 'FREESOUND_API_KEY', licence: 'CC0 / CC BY (per sound)',
  async search(q, { limit }) {
    const key = process.env.FREESOUND_API_KEY; if (!key) return [];
    const j = await getJson(`https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&filter=${encodeURIComponent('license:("Creative Commons 0" OR "Attribution")')}&fields=id,name,username,license,previews,url,duration&page_size=${Math.min(limit, 50)}&token=${encodeURIComponent(key)}`);
    return (j && j.results || []).map((r) => hit({
      url: (r.previews || {})['preview-hq-mp3'] || '', thumb: '', title: strip(r.name), creator: strip(r.username), licence: normLicence(r.license), licenceUrl: r.license || '',
      source: 'Freesound', page: r.url || '', duration: r.duration || 0, type: 'audio',
    }));
  },
};

export const SOURCES = [openverse, commons, met, cleveland, aic, loc, archiveAudio, europeana, smithsonian, freesound];

/** What's available (for tools.json / the product's settings page): name, types, needsKey, configured. */
export function sources() {
  return SOURCES.map((s) => ({ name: s.name, types: s.types, needsKey: s.needsKey, configured: !s.needsKey || !!process.env[s.needsKey], licence: s.licence }));
}

/** Search every configured source for the type; keep only hits within the licence ceiling; dedupe by url. */
export async function search(q, { type = 'image', licence = 'cc-by', limit = 20, only = null } = {}) {
  const want = ['pd', 'cc0', 'cc-by'].includes(licence) ? licence : 'cc-by';
  const srcs = SOURCES.filter((s) => s.types.includes(type) && (!only || only.includes(s.name)) && (!s.needsKey || process.env[s.needsKey]));
  const per = Math.max(3, Math.ceil(limit / Math.max(1, srcs.length)) + 2);
  const lists = await Promise.all(srcs.map((s) => s.search(q, { type, limit: per }).catch(() => [])));
  const seen = new Set(); const out = [];
  for (let i = 0; out.length < limit && lists.some((l) => l.length > i); i += 1) { // round-robin across sources
    for (const l of lists) {
      const h = l[i];
      if (!h || !h.url || !allowed(h.licence, want) || seen.has(h.url)) continue;
      seen.add(h.url); out.push(h);
      if (out.length >= limit) break;
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('media-sources.mjs')) {
  const [, , q = 'pyramids', type = 'image', licence = 'cc-by'] = process.argv;
  const hits = await search(q, { type, licence, limit: 12 });
  for (const h of hits) console.log(`${h.licence.padEnd(8)} ${h.source.slice(0, 34).padEnd(34)} ${h.title.slice(0, 50)}\n         ${h.url}`);
  console.log(`\n${hits.length} hits · sources: ${sources().map((s) => `${s.name}${s.configured ? '' : ' (needs ' + s.needsKey + ')'}`).join(', ')}`);
}
