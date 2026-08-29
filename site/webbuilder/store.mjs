// store.mjs — file-backed, MULTI-TENANT persistence for the SoapBox Web Builder.
//
// WHY THIS EXISTS
//   The builder used to hold every published/saved site in a process-local Map — so a restart wiped
//   every customer site, and there was no per-account scoping (any caller saw the one global bag of
//   sites). This module replaces that with a small JSON-file store, following the same shape the
//   Herald/integrations modules use (a DATA_FILE seam, whole-file load/save, an injectable fs so the
//   test suite stays fully offline):
//
//       WEBBUILDER_DATA env → else <cwd>/data/webbuilder.json   (the dir is .gitignored)
//
//   Sites are keyed by `${account}/${siteId}` so account A can never read account B's site. Published
//   sites additionally carry a globally-unique `slug` (the REN label) indexed for the public `/p/<slug>`
//   render path — a REN name is global by nature, so the last publisher of a slug wins (unchanged from
//   the old Map.set semantics).
//
// DISCIPLINE
//   • SOFT-FAIL NEVER THROWS — a missing/corrupt file, an fs error, junk keys: all swallowed, surfaced as
//     safe empties. The builder must never 500 because the store hiccuped.
//   • ZERO secrets. The store holds only public site content (doc/template/domain-status). No keys, no
//     PII — same custody boundary as the rest of the builder.
//   • Persistence is whole-file JSON (small N of sites); every mutation writes through synchronously so a
//     restart reads back exactly what was there. Reads are served from the in-memory cache (no disk on the
//     render path → the "zero request-time network" / offline invariant is preserved).

import fsReal from 'node:fs';
import { join, dirname } from 'node:path';

// ── the DATA_FILE seam (Herald pattern) ──────────────────────────────────────────────────────────────
// A function so the env var is read at store-construction time, not at import time.
export const DATA_FILE = () => process.env.WEBBUILDER_DATA || join(process.cwd(), 'data', 'webbuilder.json');

// Normalise an id/account segment: lowercase, trimmed, no slashes (so a key can never span segments).
function normSeg(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 120);
}
const keyOf = (account, siteId) => `${normSeg(account)}/${normSeg(siteId)}`;

// ── the store factory ─────────────────────────────────────────────────────────────────────────────────
// createSiteStore({ fs, dataFile }) → an instance bound to one file. Default fs is real node:fs; tests
// inject an in-memory fs. `dataFile` may be a string or a () => string (defaults to the DATA_FILE seam).
export function createSiteStore({ fs = fsReal, dataFile = DATA_FILE } = {}) {
  const file = typeof dataFile === 'function' ? dataFile() : String(dataFile || DATA_FILE());
  const sites = new Map();      // `${account}/${siteId}` -> record
  const slugIndex = new Map();  // slug -> key   (published sites only; global)

  function persist() {
    try {
      const payload = { v: 1, sites: [...sites.values()] };
      const dir = dirname(file);
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* dir may exist / fs may lack mkdir */ }
      fs.writeFileSync(file, JSON.stringify(payload, null, 2));
      return true;
    } catch { return false; }
  }

  function indexSlug(rec) {
    if (rec && rec.published && rec.slug) slugIndex.set(String(rec.slug).toLowerCase(), keyOf(rec.account, rec.siteId));
  }

  function loadFromDisk() {
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return; } // no file yet → empty store, no write
    let data;
    try { data = JSON.parse(raw || '{}'); } catch { return; }      // corrupt → stay empty, don't clobber
    const arr = data && Array.isArray(data.sites) ? data.sites : [];
    for (const rec of arr) {
      if (!rec || typeof rec !== 'object') continue;
      const account = normSeg(rec.account), siteId = normSeg(rec.siteId);
      if (!account || !siteId) continue;
      const clean = { ...rec, account, siteId };
      sites.set(keyOf(account, siteId), clean);
      indexSlug(clean);
    }
  }
  loadFromDisk();

  return {
    __file: file,

    // Upsert a site: merge `patch` onto any existing record at ${account}/${siteId}, then persist.
    // Returns the stored record (never throws). account/siteId are stamped onto the record.
    put(account, siteId, patch = {}) {
      try {
        const a = normSeg(account), id = normSeg(siteId);
        if (!a || !id) return null;
        const k = keyOf(a, id);
        const prev = sites.get(k) || {};
        const rec = { ...prev, ...patch, account: a, siteId: id, updatedAt: Date.now() };
        sites.set(k, rec);
        indexSlug(rec);
        persist();
        return rec;
      } catch { return null; }
    },

    // Read one site scoped to its owner. Returns null across a tenant boundary (A can't read B).
    get(account, siteId) {
      try { return sites.get(keyOf(account, siteId)) || null; } catch { return null; }
    },

    // Every site an account owns (for a "my sites" dashboard). Newest-updated first.
    list(account) {
      try {
        const a = normSeg(account);
        return [...sites.values()].filter((r) => r.account === a).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
      } catch { return []; }
    },

    // Public render path: a published site by its global slug (REN label), regardless of owner.
    bySlug(slug) {
      try {
        const k = slugIndex.get(String(slug || '').toLowerCase());
        const rec = k ? sites.get(k) : null;
        return rec && rec.published ? rec : null;
      } catch { return null; }
    },

    // Every published record (for sitemap / directory iteration).
    published() {
      try { return [...sites.values()].filter((r) => r && r.published); } catch { return []; }
    },

    // Clear the in-memory store (used by __reset in tests). Does NOT touch disk unless `wipe` is set.
    reset(wipe = false) {
      sites.clear();
      slugIndex.clear();
      if (wipe) persist();
    },
  };
}
