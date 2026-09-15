// pentecaust/pages/server.mjs — PAGES: a presence, as distinct from a Group's membership.
//
// ⭐ THE FACEBOOK DISTINCTION, AND IT IS A REAL ONE.
//   A PAGE is a presence   — broadcast, one-to-many, nobody "joins" it.
//   A GROUP is a membership — many-to-many, roles, a roster, a chat.
// Both primitives already existed here and neither was reachable: site/webbuilder/store.mjs is a
// multi-tenant page store keyed `${account}/${siteId}` that no identity was ever wired to, and
// pentecaust/groups/model.mjs sat unrouted for three weeks. This is the Page half.
//
// ⚠️ TENANCY IS THE WHOLE SECURITY PROPERTY. The store scopes every read to its owner and returns
// null across a tenant boundary — but only if it is HANDED the right owner. So the account always
// comes from the session, never from the path or the body. A page editor that takes an owner
// parameter is a page editor that edits other people's pages.
//
// House style: ESM, soft-fail-never-throw, handler(req,res,deps), injected whoami + store.

import { createSiteStore } from '../../site/webbuilder/store.mjs';

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const unauth = (res) => json(res, 401, { ok: false, reason: 'sign in first' });
const clamp = (s, n) => String(s == null ? '' : s).slice(0, n);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

function readBody(req, max = 262144) {
  if (req && req.body !== undefined && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    try {
      let d = ''; let over = false;
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

let _singleton = null;
const shared = () => (_singleton || (_singleton = createSiteStore({})));

/** handler(req,res,{ whoami, store }) */
export async function handler(req, res, deps = {}) {
  const who = typeof deps.whoami === 'function' ? deps.whoami : () => null;
  const store = deps.store || shared();
  try {
    const method = ((req && req.method) || 'GET').toUpperCase();
    const path = (String((req && req.url) || '/').split('?')[0] || '/').replace(/\/+$/, '') || '/';
    const segs = path.split('/').filter(Boolean);

    // PUBLIC: a published page by its global slug. Presence is the point — it must be readable by
    // somebody who is not signed in, or it is not a page.
    if (method === 'GET' && segs[0] === 'p' && segs[1] && segs.length === 2) {
      const rec = store.bySlug(segs[1]);
      return rec ? json(res, 200, { ok: true, page: rec })
        : json(res, 404, { ok: false, reason: 'no such page' });
    }

    const me = who(req);
    if (!me) return unauth(res);

    // MINE: scoped to the session, always.
    if (method === 'GET' && path === '/pages') return json(res, 200, { ok: true, account: me, pages: store.list(me) });
    if (method === 'GET' && segs[0] === 'pages' && segs[1]) {
      const rec = store.get(me, segs[1]);
      return rec ? json(res, 200, { ok: true, page: rec }) : json(res, 404, { ok: false, reason: 'no such page' });
    }

    if (method !== 'POST') return json(res, 404, { ok: false, reason: 'not-found' });
    const b = await readBody(req);
    if (b == null) return json(res, 400, { ok: false, reason: 'bad-body' });

    if (path === '/pages') {
      const id = slugify(b.id || b.title) || `page-${Date.now()}`;
      const slug = slugify(b.slug || b.title || id);
      // ⚠️ A published slug is GLOBAL. Refuse a collision rather than silently repointing somebody
      // else's public URL at this account's page — the store would happily overwrite the index.
      if (b.published && slug) {
        const taken = store.bySlug(slug);
        if (taken && taken.account !== me) return json(res, 409, { ok: false, reason: 'that slug is taken' });
      }
      const rec = store.put(me, id, {
        title: clamp(b.title, 120), slug, body: clamp(b.body, 200000),
        published: b.published === true, kind: clamp(b.kind, 24) || 'page',
        group: clamp(b.group, 64) || null,      // a Page may front a Group; a Group never owns a Page
      });
      return rec ? json(res, 200, { ok: true, page: rec }) : json(res, 400, { ok: false, reason: 'could not save' });
    }

    if (segs[0] === 'pages' && segs[1] && segs[2] === 'publish') {
      const rec = store.get(me, segs[1]);
      if (!rec) return json(res, 404, { ok: false, reason: 'no such page' });
      const slug = slugify(b.slug || rec.slug || rec.title || segs[1]);
      const taken = store.bySlug(slug);
      if (taken && taken.account !== me) return json(res, 409, { ok: false, reason: 'that slug is taken' });
      const out = store.put(me, segs[1], { slug, published: b.published !== false });
      return json(res, 200, { ok: true, page: out });
    }

    return json(res, 404, { ok: false, reason: 'not-found' });
  } catch { return json(res, 500, { ok: false, reason: 'error' }); }
}

export default { handler };
