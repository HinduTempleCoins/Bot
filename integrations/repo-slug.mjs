// repo-slug.mjs — GitHub/GitLab/Bitbucket repo-slug parser + normalizer. PURE.
// No network, no secrets, no IO; pure string parsing; soft-fail (garbage -> null /
// filtered out); never throws. Backs the recurring "pull existing repo" /
// repository-inventory itinerary items where a canonical {owner,name,host} is needed.
//
// Accepts:
//   - 'owner/name'                              (bare slug; default host github.com)
//   - 'https://github.com/owner/name'           (+ optional '.git', query, fragment)
//   - 'http://gitlab.com/owner/name.git'
//   - 'git@github.com:owner/name.git'           (scp-like ssh remote)
//   - 'ssh://git@bitbucket.org/owner/name.git'
//   - leading/trailing whitespace anywhere
//
//   import { parseRepo, toUrl, toSsh, dedupeRepos } from './repo-slug.mjs'
//   node integrations/repo-slug.mjs owner/name https://github.com/foo/bar.git

// --- HTML escape (strict; available for any render path) -------------------

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Known forge hosts. Bare 'owner/name' input defaults to the first (github.com).
export const KNOWN_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'];
const DEFAULT_HOST = KNOWN_HOSTS[0];

// A path segment (owner or name) must be non-empty and free of separators we
// already consumed. We keep this permissive but reject obvious garbage.
const SEGMENT = /^[A-Za-z0-9._-]+$/;

function cleanName(name) {
  // strip a single trailing '.git' (case-insensitive) and any stray trailing slash
  return String(name).replace(/\.git$/i, '').replace(/\/+$/, '');
}

function normHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^www\./, '');
  return h || DEFAULT_HOST;
}

function validSeg(s) {
  return typeof s === 'string' && s.length > 0 && SEGMENT.test(s) && s !== '.' && s !== '..';
}

// parseRepo(input) -> {owner, name, host} | null
export function parseRepo(input) {
  try {
    if (input == null) return null;
    let s = String(input).trim();
    if (!s) return null;
    // drop query/fragment early (applies to URL forms)
    s = s.split('#')[0].split('?')[0].trim();
    if (!s) return null;

    let host = DEFAULT_HOST;
    let owner;
    let name;

    if (/^git@/i.test(s)) {
      // scp-like: git@host:owner/name(.git)
      const m = s.match(/^git@([^:]+):(.+)$/i);
      if (!m) return null;
      host = normHost(m[1]);
      const parts = m[2].replace(/^\/+/, '').split('/');
      if (parts.length < 2) return null;
      owner = parts[0];
      name = cleanName(parts[1]);
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      // any scheme://  (https, http, ssh, git)
      let rest = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
      // strip userinfo (e.g. git@) from authority
      const slash = rest.indexOf('/');
      if (slash < 0) return null;
      let authority = rest.slice(0, slash);
      const path = rest.slice(slash + 1);
      if (authority.includes('@')) authority = authority.split('@').pop();
      // drop any port
      host = normHost(authority.split(':')[0]);
      const parts = path.replace(/^\/+/, '').split('/');
      if (parts.length < 2) return null;
      owner = parts[0];
      name = cleanName(parts[1]);
    } else if (s.includes('://')) {
      // malformed scheme
      return null;
    } else {
      // bare 'owner/name' (tolerate a leading host-ish prefix like github.com/owner/name)
      let parts = s.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
      if (parts.length >= 3 && parts[0].includes('.')) {
        host = normHost(parts[0]);
        parts = parts.slice(1);
      }
      if (parts.length < 2) return null;
      owner = parts[0];
      name = cleanName(parts[1]);
    }

    owner = String(owner || '').trim();
    name = String(name || '').trim();
    if (!validSeg(owner) || !validSeg(name)) return null;

    return { owner, name, host };
  } catch {
    return null;
  }
}

// toUrl(slug, {host?}) -> canonical https URL | null
// slug may be a string (re-parsed) or an already-parsed {owner,name,host}.
export function toUrl(slug, opts = {}) {
  try {
    const r = typeof slug === 'string' ? parseRepo(slug) : slug;
    if (!r || !validSeg(r.owner) || !validSeg(r.name)) return null;
    const host = normHost(opts.host || r.host);
    return `https://${host}/${r.owner}/${r.name}`;
  } catch {
    return null;
  }
}

// toSsh(slug) -> scp-like ssh remote | null
export function toSsh(slug) {
  try {
    const r = typeof slug === 'string' ? parseRepo(slug) : slug;
    if (!r || !validSeg(r.owner) || !validSeg(r.name)) return null;
    const host = normHost(r.host);
    return `git@${host}:${r.owner}/${r.name}.git`;
  } catch {
    return null;
  }
}

// canonical dedupe key: host + lowercased owner/name
export function repoKey(slug) {
  const r = typeof slug === 'string' ? parseRepo(slug) : slug;
  if (!r || !validSeg(r.owner) || !validSeg(r.name)) return null;
  return `${normHost(r.host)}/${r.owner.toLowerCase()}/${r.name.toLowerCase()}`;
}

// dedupeRepos(list) -> unique parsed {owner,name,host}, first-seen wins,
// garbage entries filtered out. Accepts strings and/or parsed objects.
export function dedupeRepos(list) {
  try {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const r = typeof item === 'string' ? parseRepo(item) : (item && parseRepo(`${item.host || DEFAULT_HOST}/${item.owner}/${item.name}`));
      if (!r) continue;
      const key = repoKey(r);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

// --- CLI (guarded) ---------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('repo-slug.mjs')) {
  const args = process.argv.slice(2);
  for (const a of args) {
    const r = parseRepo(a);
    if (r) {
      console.log(`${a}  ->  ${r.owner}/${r.name}  (${r.host})  ${toUrl(r)}`);
    } else {
      console.log(`${a}  ->  (unparseable)`);
    }
  }
}
