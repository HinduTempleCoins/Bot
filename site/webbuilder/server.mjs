// server.mjs — SoapBox Web Builder (Herald). Launch a website in minutes: pick a template, edit blocks
// in the browser, and PUBLISH to a REN name (`<name>.melek`-style) and/or your own custom domain. Sites
// published here are SEO-clean (JSON-LD, canonical, first-party analytics beacon, sitemap entry) and can
// opt into Herald's CURATED backlink network so relevant sites cross-link each other (anti-penalty rules
// live in integrations/herald/backlink-network.mjs — NOT a link farm).
//
//   PORT=8210 BASE_URL=https://build.soapbox.community node site/webbuilder/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                    the builder: template picker + client-side block editor + publish flow
//   /p/<slug>            a PUBLISHED customer site (SEO-clean, escaped, related-sites block if opted in)
//   POST /api/save       save seam (the editor autosaves to localStorage; this persists server-side)
//   POST /api/publish    publish { ren, template, doc, network } → { slug, renUrl, pageUrl }
//   POST /api/attach-domain  { slug, domain } → the DNS record to add + an HONEST "pending" status
//   POST /api/verify-domain  { slug } → runs the DOMAIN_VERIFY seam; NEVER fakes verification
//   /api/directory       JSON feed of published+opted-in sites (aggregator-directory / search seam)
//   /health /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() every interpolated value; safeHref() every user URL (no javascript:/data: XSS via published
//   content). Soft-fail: unknown path → 404, never a 500. ZERO request-time network on any render path
//   (publish/render read the in-memory store; the REN + domain seams are pure). Custom-domain attach is
//   HONEST — it shows the DNS record and a "pending" state and never claims verification without the real
//   check (a documented box step wires Caddy on-demand-TLS + a DNS lookup into the DOMAIN_VERIFY seam).

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { bottomNav } from '../../integrations/soapbox/bottom-nav.mjs';
import { createBacklinkNetwork, CATEGORIES } from '../../integrations/herald/backlink-network.mjs';
import { createSiteStore } from './store.mjs';

const PORT = +(process.env.PORT || 8210);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Web Builder';
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// BASE_PATH-aware (tools-hub path routing). Default '' → standalone behaviour byte-for-byte unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;

// ── shared helpers ─────────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u.trim()); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}
const clampStr = (s, n) => String(s == null ? '' : s).slice(0, n);

// ── the templates (4 simple, original starter sites) ────────────────────────────────────────────────
// Each is a plain doc: { title, tagline, category, sections[] }. Section types: text | links | image.
// Used server-side for the seed preview AND handed to the client editor as JSON.
export const TEMPLATES = {
  business: {
    label: 'Business / Landing',
    category: 'business',
    doc: {
      title: 'Acme Studio',
      tagline: 'We build things people love.',
      category: 'business',
      sections: [
        { type: 'text', heading: 'What we do', body: 'A short, clear description of your product or service. Tell visitors what you offer and who it is for.' },
        { type: 'text', heading: 'Why us', body: 'Three reasons to choose you. Keep it concrete: results, experience, guarantees.' },
        { type: 'links', heading: 'Get started', items: [{ label: 'Contact us', url: 'https://example.com/contact' }, { label: 'See pricing', url: 'https://example.com/pricing' }] },
      ],
    },
  },
  personal: {
    label: 'Personal',
    category: 'personal',
    doc: {
      title: 'Jane Rivers',
      tagline: 'Writer, gardener, and occasional baker.',
      category: 'personal',
      sections: [
        { type: 'text', heading: 'About me', body: 'A friendly paragraph about who you are and what you care about.' },
        { type: 'text', heading: 'Now', body: 'What you are up to lately — a project, a place, a plan.' },
        { type: 'links', heading: 'Elsewhere', items: [{ label: 'My newsletter', url: 'https://example.com/news' }] },
      ],
    },
  },
  portfolio: {
    label: 'Portfolio',
    category: 'portfolio',
    doc: {
      title: 'Sam Lee — Portfolio',
      tagline: 'Selected work, 2020–today.',
      category: 'portfolio',
      sections: [
        { type: 'image', heading: 'Featured', url: 'https://example.com/work/hero.jpg', alt: 'A featured project' },
        { type: 'text', heading: 'Project one', body: 'What it was, your role, and the outcome. One tight paragraph per project.' },
        { type: 'links', heading: 'Work with me', items: [{ label: 'Email', url: 'https://example.com/hello' }, { label: 'Résumé', url: 'https://example.com/cv' }] },
      ],
    },
  },
  linkbio: {
    label: 'Link-in-bio',
    category: 'personal',
    doc: {
      title: '@yourhandle',
      tagline: 'Everything in one place.',
      category: 'personal',
      sections: [
        { type: 'links', heading: 'Links', items: [
          { label: 'Latest post', url: 'https://example.com/post' },
          { label: 'Shop', url: 'https://example.com/shop' },
          { label: 'Say hi', url: 'https://example.com/contact' },
        ] },
      ],
    },
  },
};
export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

// ── REN seam ─────────────────────────────────────────────────────────────────────────────────────
// Validate a requested REN name and resolve it to a REN URL. DEFAULT is a PURE validator (no network) —
// the real registrar (contracts/RENRegistrar on PRANA) is wired later via __setRen(). TLDs .melek/.prana/
// .kula per [[ren-naming-system]]. Returns { ok, label, tld, renUrl } or { ok:false, error }.
const REN_TLDS = ['melek', 'prana', 'kula'];
const REN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/; // 3-63 chars, no leading/trailing hyphen
let _resolveRen = function defaultResolveRen(name) {
  let raw = clampStr(name, 120).trim().toLowerCase();
  if (!raw) return { ok: false, error: 'name required' };
  let label = raw, tld = 'melek';
  if (raw.includes('.')) {
    const parts = raw.split('.');
    tld = parts.pop();
    label = parts.join('-');
  }
  if (!REN_TLDS.includes(tld)) return { ok: false, error: 'tld must be one of .melek / .prana / .kula' };
  if (!REN_LABEL_RE.test(label) || label.length < 3) return { ok: false, error: 'name must be 3–63 chars: a–z, 0–9, hyphen (not leading/trailing)' };
  return { ok: true, label, tld, renUrl: `https://${label}.${tld}` };
};
export const resolveRen = (name) => { try { return _resolveRen(name); } catch { return { ok: false, error: 'resolver error' }; } };
export function __setRen(fn) { _resolveRen = typeof fn === 'function' ? fn : _resolveRen; }

// ── DOMAIN_VERIFY seam ─────────────────────────────────────────────────────────────────────────────
// Bring-your-own custom domain: we hand back the DNS record to add and, when asked to verify, run the
// seam. The DEFAULT seam is HONEST — it returns { verified:false, status:'pending' } because the real
// DNS/TLS wiring (a documented box step: Caddy on-demand-TLS + a DNS-01/TXT lookup using the vault DNS
// tokens) is not present in-repo. It NEVER fakes success. A real check is injected via __setDomainVerify.
let _verifyDomain = function defaultVerifyDomain(/* domain, token */) {
  return { verified: false, status: 'pending', method: 'dns-txt', note: 'Add the TXT record, then DNS + TLS provisioning completes on the server (box step).' };
};
export function verifyDomain(domain, token) {
  try {
    const r = _verifyDomain(domain, token) || {};
    // Trust the seam's verdict, but hard-guarantee an HONEST shape: verified is only true when the seam
    // explicitly says so; anything else collapses to a pending state (never a fake success).
    const verified = r.verified === true;
    return { verified, status: verified ? 'verified' : (r.status || 'pending'), method: r.method || 'dns-txt', note: r.note || '' };
  } catch { return { verified: false, status: 'pending', method: 'dns-txt', note: 'verifier error' }; }
}
export function __setDomainVerify(fn) { _verifyDomain = typeof fn === 'function' ? fn : _verifyDomain; }

// A deterministic (non-secret) verification token from the domain — a stable value the user adds to DNS.
function domainToken(domain) {
  const d = clampStr(domain, 253).toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) { h ^= d.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'melek-verify=' + (h >>> 0).toString(16).padStart(8, '0');
}
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
function normDomain(raw) {
  let d = clampStr(raw, 300).trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split('?')[0].split('#')[0].replace(/^www\./, '').replace(/\.$/, '');
  return d;
}

// ── site store (file-backed, MULTI-TENANT) + the network singleton ────────────────────────────────────
// The store (site/webbuilder/store.mjs) persists sites to WEBBUILDER_DATA (default <cwd>/data/webbuilder.json)
// keyed by `${account}/${siteId}`, so saved + published sites survive a restart and are scoped per account.
// A globally-unique slug (the REN label) indexes published sites for the public `/p/<slug>` render path.
// `store` is a swappable seam so tests can inject an in-memory-fs store (__setStore).
const DEFAULT_ACCOUNT = 'public';          // callers with no signed-in account land here (back-compat)
let store = createSiteStore();
let net = createBacklinkNetwork();
export function __setStore(s) { if (s && typeof s.put === 'function') store = s; return store; }
export function __reset() { store.reset(); net = createBacklinkNetwork(); }
export function _published(slug) { return store.bySlug(slug); }

// Public seams for the "my sites" dashboard / other callers (multi-tenant scoped).
export function listSites(account) { return store.list(account); }
export function getSite(account, siteId) { return store.get(account, siteId); }

// Sanitize an incoming doc to a safe, bounded shape. Content is NOT HTML-escaped here (that happens at
// render); we only clamp lengths and whitelist section types/fields so nothing unbounded is stored.
export function sanitizeDoc(raw, fallbackCategory = 'personal') {
  const d = raw && typeof raw === 'object' ? raw : {};
  const category = CATEGORIES.includes(String(d.category || '').toLowerCase()) ? String(d.category).toLowerCase() : fallbackCategory;
  const sections = Array.isArray(d.sections) ? d.sections.slice(0, 20) : [];
  const clean = [];
  for (const s of sections) {
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'text') {
      clean.push({ type: 'text', heading: clampStr(s.heading, 160), body: clampStr(s.body, 4000) });
    } else if (s.type === 'links') {
      const items = (Array.isArray(s.items) ? s.items : []).slice(0, 30)
        .map((it) => ({ label: clampStr(it && it.label, 120), url: clampStr(it && it.url, 1000) }))
        .filter((it) => it.label || it.url);
      clean.push({ type: 'links', heading: clampStr(s.heading, 160), items });
    } else if (s.type === 'image') {
      clean.push({ type: 'image', heading: clampStr(s.heading, 160), url: clampStr(s.url, 1000), alt: clampStr(s.alt, 200) });
    } else if (s.type === 'bottomnav') {
      // Collapsible bottom navigation bar (integrations/soapbox/bottom-nav.mjs). Up to 5 short tabs.
      const items = (Array.isArray(s.items) ? s.items : []).slice(0, 5)
        .map((it) => ({ label: clampStr(it && it.label, 40), url: clampStr(it && it.url, 1000) }))
        .filter((it) => it.label || it.url);
      clean.push({ type: 'bottomnav', heading: clampStr(s.heading, 160), collapsed: s.collapsed === true, items });
    }
  }
  return {
    title: clampStr(d.title, 200) || 'Untitled site',
    tagline: clampStr(d.tagline, 300),
    category,
    sections: clean,
  };
}

// ── page shell ───────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Build and publish a website in minutes — pick a template, edit in your browser, publish to a REN name or your own domain.';
  const canonical = opts.canonical || `${BASE_URL}${bp('/')}`;
  const head = headTags({
    title, description: desc, canonical, siteName: opts.siteName || SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  const chrome = opts.bare ? '' : `<header class=topbar><a class=brand href="${bp('/')}">🌐 SoapBox <span>Web Builder</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r><a href="${bp('/')}">New site</a></div></header>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${opts.style || STYLE}</head><body${opts.bodyClass ? ` class="${esc(opts.bodyClass)}"` : ''}>
${chrome}<main class="${esc(opts.mainClass || 'wrap')}">${body}</main>
${opts.footer || FOOTER}</body></html>`;
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;align-items:center}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:1180px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 4px;font-size:24px} .sub{color:var(--mut);margin:0 0 14px;font-size:14px} .muted{color:var(--mut)}
  .tpls{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 16px}
  .tpls button{border:1px solid var(--line2);border-radius:20px;padding:6px 15px;font-size:13px;font-weight:600;color:var(--fg);background:var(--panel);cursor:pointer}
  .tpls button:hover,.tpls button.on{border-color:var(--blue);color:var(--blue)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px} @media (max-width:900px){.cols{grid-template-columns:1fr}}
  .pane{border:1px solid var(--line2);border-radius:10px;background:var(--panel);padding:14px 16px}
  label{display:block;font-size:12px;color:var(--mut);margin:10px 0 3px;text-transform:uppercase;letter-spacing:.04em}
  input,textarea,select{width:100%;background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);font:14px/1.5 system-ui;padding:8px 10px}
  textarea{min-height:70px;resize:vertical} button.act{border:1px solid var(--line2);border-radius:8px;padding:8px 14px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  button.act:hover{border-color:var(--blue);color:var(--blue)} button.gold{border-color:var(--gold);color:var(--gold)} button.gold:hover{background:var(--gold);color:#0d1117}
  .sec{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:10px 0;background:#0b0f14}
  .sec .sec-hd{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--mut)} .sec .sec-hd .sp{margin-left:auto}
  .addrow{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
  #preview{border:1px solid var(--line2);border-radius:10px;background:#fff;color:#111;min-height:420px;overflow:auto}
  .pub{border:1px solid var(--line2);border-radius:10px;background:var(--panel);padding:14px 16px;margin-top:16px}
  .pub h2{font-size:16px;margin:0 0 8px} .row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}
  .row>div{flex:1;min-width:180px} .note{font-size:13px;margin:8px 0;padding:9px 11px;border-radius:8px;border:1px solid var(--line2);background:#0b0f14}
  .note code{background:#161b22;border:1px solid var(--line2);border-radius:5px;padding:1px 6px;font-size:12px;word-break:break-all}
  .ok{border-color:var(--up);color:var(--up)} .pending{border-color:var(--gold);color:var(--gold)}
  .chk{display:flex;align-items:center;gap:8px;margin:10px 0;font-size:14px;color:var(--fg)} .chk input{width:auto}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line)}
  footer a{color:var(--blue)}
</style>`;
const FOOTER = `<footer><b>${esc(SITE_NAME)}</b> — build a site, publish to a REN name or your own domain. Sites are SEO-clean and can join a curated, disclosed related-sites network. <a href="${bp('/')}">Start building</a>.</footer>`;

// Neutral, crypto-free chrome for a PUBLISHED customer site (it is the customer's site, not a MELEK pitch).
const PUB_STYLE = `<style>
  *{box-sizing:border-box} body{font:17px/1.65 Georgia,'Times New Roman',serif;margin:0;background:#faf9f7;color:#1a1a1a}
  .site{max-width:720px;margin:0 auto;padding:56px 22px 40px}
  .alpha{position:fixed;top:8px;left:8px;font:700 10px system-ui;letter-spacing:.06em;text-transform:uppercase;color:#8a6d1a;border:1px solid #d9c48a;background:#fdf6e3;border-radius:5px;padding:1px 6px;z-index:9}
  h1{font-size:34px;margin:0 0 6px;line-height:1.15} .tagline{color:#555;font-size:19px;margin:0 0 30px}
  h2{font-size:21px;margin:30px 0 8px;font-family:system-ui,sans-serif} p{margin:8px 0}
  a{color:#1c5fb8} img{max-width:100%;height:auto;border-radius:8px;margin:8px 0}
  .links{list-style:none;padding:0;margin:8px 0} .links li{margin:8px 0} .links a{display:inline-block;border:1px solid #d8d3c8;border-radius:9px;padding:9px 16px;background:#fff;color:#1a1a1a;text-decoration:none}
  .links a:hover{border-color:#1c5fb8;color:#1c5fb8}
  .backlink-network{margin-top:40px;padding-top:18px;border-top:1px solid #e4e0d6} .backlink-network h2{font-size:16px;color:#555}
  .bl-list{list-style:none;padding:0;margin:6px 0} .bl-list li{margin:5px 0;font-family:system-ui,sans-serif;font-size:15px} .bl-cat{color:#999;font-size:12px}
  .bl-disclosure{color:#999;font-size:12px;font-family:system-ui,sans-serif} .builtby{margin-top:34px;color:#aaa;font-size:12px;font-family:system-ui,sans-serif;text-align:center}
</style>`;

// ── the builder editor page ───────────────────────────────────────────────────────────────────────
export function builderPage() {
  const tplButtons = TEMPLATE_KEYS.map((k, i) =>
    `<button type=button data-tpl="${esc(k)}"${i === 0 ? ' class=on' : ''}>${esc(TEMPLATES[k].label)}</button>`).join('');
  const catOptions = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: SITE_NAME, applicationCategory: 'DeveloperApplication', operatingSystem: 'Any (web browser)',
    description: 'Build and publish a website from a template — to a REN name or your own custom domain.',
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
  };

  const body = `
<h1>Build your website</h1>
<p class=sub>Pick a template, edit it right here, and publish to a <b>REN name</b> or <b>your own domain</b>. Your draft saves in your browser as you go.</p>

<div class=tpls>${tplButtons}</div>

<div class=cols>
  <div class=pane>
    <label for=f-title>Site title</label><input id=f-title maxlength=200>
    <label for=f-tagline>Tagline</label><input id=f-tagline maxlength=300>
    <label for=f-category>Category (for the related-sites network)</label>
    <select id=f-category>${catOptions}</select>
    <label>Sections</label>
    <div id=sections></div>
    <div class=addrow>
      <button type=button class=act data-add=text>+ Text</button>
      <button type=button class=act data-add=links>+ Links</button>
      <button type=button class=act data-add=image>+ Image</button>
      <button type=button class=act data-add=bottomnav>+ Bottom Nav</button>
    </div>
    <div class=addrow>
      <button type=button class=act id=btn-save>Save draft</button>
      <span class=muted id=save-status></span>
    </div>
  </div>
  <div class=pane>
    <label>Live preview</label>
    <div id=preview aria-live=polite></div>
  </div>
</div>

<div class=pub>
  <h2>Publish</h2>
  <label class=chk><input type=checkbox id=opt-network> Join the curated related-sites network (relevant, disclosed cross-links for SEO)</label>
  <div class=row>
    <div>
      <label for=f-ren>REN name</label>
      <input id=f-ren placeholder="yourname (.melek) or yourname.prana">
    </div>
    <button type=button class="act gold" id=btn-publish>Publish to REN</button>
  </div>
  <div id=publish-result></div>

  <div class=row style="margin-top:14px">
    <div>
      <label for=f-domain>…or bring your own domain</label>
      <input id=f-domain placeholder="www.yoursite.com">
    </div>
    <button type=button class=act id=btn-attach>Attach domain</button>
    <button type=button class=act id=btn-verify>Check verification</button>
  </div>
  <div id=domain-result></div>
</div>

<script>
(function(){
  var TEMPLATES = ${JSON.stringify(Object.fromEntries(TEMPLATE_KEYS.map((k) => [k, TEMPLATES[k].doc])))};
  var BP = ${JSON.stringify(BASE_PATH)};
  var LS_KEY = 'soapbox-webbuilder-draft';
  // Multi-tenant scoping: the owner account (from ?account=, if signed in) + a stable per-browser site id
  // so server-side saves land under {account}/{siteId} and can be listed/reloaded later.
  var ACCOUNT = (function(){ try{ return (new URLSearchParams(location.search).get('account')||'').trim().toLowerCase(); }catch(e){ return ''; } })();
  var SITE_ID = (function(){ try{ var k='soapbox-webbuilder-siteid', v=localStorage.getItem(k); if(!v){ v='site-'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); localStorage.setItem(k,v); } return v; }catch(e){ return 'draft'; } })();
  var CUR_TPL = ${JSON.stringify(TEMPLATE_KEYS[0])};
  var model = null, lastSlug = '';
  var E = function(id){ return document.getElementById(id); };
  function escH(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function okHref(u){ try{ var x=new URL(String(u).trim()); return (x.protocol==='https:'||x.protocol==='http:')?x.href:''; }catch(e){ return ''; } }

  function load(){
    try{ var raw=localStorage.getItem(LS_KEY); if(raw){ return JSON.parse(raw); } }catch(e){}
    return null;
  }
  function save(){
    try{ localStorage.setItem(LS_KEY, JSON.stringify({ tpl:CUR_TPL, doc:model, network:E('opt-network').checked })); }catch(e){}
  }
  function seed(tplKey){
    CUR_TPL = tplKey;
    model = JSON.parse(JSON.stringify(TEMPLATES[tplKey] || TEMPLATES[CUR_TPL]));
    syncForm(); renderSections(); preview(); save();
  }
  function syncForm(){
    E('f-title').value = model.title||''; E('f-tagline').value = model.tagline||'';
    E('f-category').value = model.category||'personal';
  }
  function collect(){
    model.title = E('f-title').value; model.tagline = E('f-tagline').value; model.category = E('f-category').value;
  }
  function renderSections(){
    var host = E('sections'); host.innerHTML='';
    (model.sections||[]).forEach(function(s, idx){
      var box = document.createElement('div'); box.className='sec';
      var hd = '<div class=sec-hd><b>'+escH(s.type)+'</b><span class=sp><button type=button class=act data-del="'+idx+'" style="padding:2px 8px">×</button></span></div>';
      var inner='';
      inner += '<label>Heading</label><input data-f=heading data-i="'+idx+'" value="'+escH(s.heading||'')+'">';
      if(s.type==='text'){ inner += '<label>Body</label><textarea data-f=body data-i="'+idx+'">'+escH(s.body||'')+'</textarea>'; }
      if(s.type==='image'){ inner += '<label>Image URL</label><input data-f=url data-i="'+idx+'" value="'+escH(s.url||'')+'"><label>Alt text</label><input data-f=alt data-i="'+idx+'" value="'+escH(s.alt||'')+'">'; }
      if(s.type==='links'){
        inner += '<label>Links (label | url per line)</label><textarea data-f=links data-i="'+idx+'">'+escH(((s.items||[]).map(function(it){return (it.label||'')+' | '+(it.url||'');}).join('\\n')))+'</textarea>';
      }
      if(s.type==='bottomnav'){
        inner += '<label>Tabs (label | url per line, up to 5)</label><textarea data-f=links data-i="'+idx+'">'+escH(((s.items||[]).map(function(it){return (it.label||'')+' | '+(it.url||'');}).join('\\n')))+'</textarea>';
        inner += '<label class=chk style="text-transform:none;letter-spacing:0"><input type=checkbox data-f=collapsed data-i="'+idx+'"'+(s.collapsed?' checked':'')+'> Start collapsed</label>';
      }
      box.innerHTML = hd+inner; host.appendChild(box);
    });
    host.querySelectorAll('[data-f]').forEach(function(el){
      el.addEventListener('input', function(){
        var i=+el.getAttribute('data-i'), f=el.getAttribute('data-f'), s=model.sections[i]; if(!s) return;
        if(f==='links'){ s.items = el.value.split('\\n').map(function(line){ var p=line.split('|'); return { label:(p[0]||'').trim(), url:(p[1]||'').trim() }; }).filter(function(it){return it.label||it.url;}); }
        else if(f==='collapsed'){ s.collapsed = el.checked; }
        else { s[f]=el.value; }
        preview(); save();
      });
    });
    host.querySelectorAll('[data-del]').forEach(function(b){ b.addEventListener('click', function(){ model.sections.splice(+b.getAttribute('data-del'),1); renderSections(); preview(); save(); }); });
  }
  function preview(){
    collect();
    var h = '<div style="font:17px/1.6 Georgia,serif;color:#111;padding:26px 22px;max-width:680px;margin:0 auto">';
    h += '<h1 style="font-size:30px;margin:0 0 6px">'+escH(model.title||'Untitled')+'</h1>';
    if(model.tagline) h += '<p style="color:#555;font-size:18px;margin:0 0 22px">'+escH(model.tagline)+'</p>';
    (model.sections||[]).forEach(function(s){
      if(s.heading) h += '<h2 style="font-size:20px;font-family:system-ui;margin:22px 0 6px">'+escH(s.heading)+'</h2>';
      if(s.type==='text'){ h += '<p>'+escH(s.body||'').replace(/\\n/g,'<br>')+'</p>'; }
      if(s.type==='image'){ var u=okHref(s.url); if(u) h += '<img src="'+escH(u)+'" alt="'+escH(s.alt||'')+'" style="max-width:100%;border-radius:8px">'; else h += '<p style="color:#bbb">[image]</p>'; }
      if(s.type==='links'){ h += '<ul style="list-style:none;padding:0">'; (s.items||[]).forEach(function(it){ var u=okHref(it.url); h += '<li style="margin:7px 0">'+(u?('<a href="'+escH(u)+'" rel=noopener>'+escH(it.label||u)+'</a>'):('<span style="color:#bbb">'+escH(it.label||'')+'</span>'))+'</li>'; }); h += '</ul>'; }
      if(s.type==='bottomnav'){ h += '<div style="border:1px solid #ddd;border-radius:8px;background:#f5f6f7;padding:8px 10px;margin:10px 0;font-family:system-ui;font-size:12px;color:#555"><b>\\u25B4 '+escH(s.heading||'Menu')+'</b>'+(s.collapsed?' <em>(starts collapsed)</em>':'')+'<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">'; (s.items||[]).slice(0,5).forEach(function(it){ h += '<span style="padding:5px 10px;background:#fff;border:1px solid #ddd;border-radius:6px">'+escH(it.label||'')+'</span>'; }); h += '</div><div style="color:#999;margin-top:6px">Fixed collapsible bar on your published page</div></div>'; }
    });
    h += '</div>'; E('preview').innerHTML = h;
  }
  function api(path, payload){
    return fetch(BP+path, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload) })
      .then(function(r){ return r.json().catch(function(){ return { ok:false, error:'bad response' }; }); })
      .catch(function(){ return { ok:false, error:'network error' }; });
  }

  // template buttons
  document.querySelectorAll('.tpls button[data-tpl]').forEach(function(b){
    b.addEventListener('click', function(){
      document.querySelectorAll('.tpls button').forEach(function(x){ x.classList.remove('on'); });
      b.classList.add('on'); seed(b.getAttribute('data-tpl'));
    });
  });
  // add-section buttons
  document.querySelectorAll('[data-add]').forEach(function(b){
    b.addEventListener('click', function(){
      var t=b.getAttribute('data-add'); model.sections=model.sections||[];
      if(t==='text') model.sections.push({type:'text',heading:'New section',body:''});
      if(t==='links') model.sections.push({type:'links',heading:'Links',items:[]});
      if(t==='image') model.sections.push({type:'image',heading:'',url:'',alt:''});
      if(t==='bottomnav') model.sections.push({type:'bottomnav',heading:'Menu',collapsed:false,items:[{label:'Home',url:'https://example.com/'},{label:'About',url:'https://example.com/about'}]});
      renderSections(); preview(); save();
    });
  });
  ['f-title','f-tagline','f-category'].forEach(function(id){ E(id).addEventListener('input', function(){ preview(); save(); }); });
  E('opt-network').addEventListener('change', save);

  E('btn-save').addEventListener('click', function(){
    collect(); save();
    api('/api/save', { account:ACCOUNT, siteId:SITE_ID, template:CUR_TPL, doc:model, network:E('opt-network').checked }).then(function(r){ E('save-status').textContent = r && r.ok ? 'Saved.' : 'Saved locally.'; });
  });
  E('btn-publish').addEventListener('click', function(){
    collect();
    api('/api/publish', { account:ACCOUNT, siteId:SITE_ID, ren:E('f-ren').value, template:CUR_TPL, doc:model, network:E('opt-network').checked }).then(function(r){
      var out=E('publish-result');
      if(r && r.ok){ lastSlug=r.slug; out.innerHTML = '<div class="note ok">Published! REN: <code>'+escH(r.renUrl)+'</code> · <a href="'+escH(r.pageUrl)+'" target=_blank rel=noopener>view your site</a></div>'; }
      else { out.innerHTML = '<div class="note pending">'+escH((r&&r.error)||'Could not publish')+'</div>'; }
    });
  });
  E('btn-attach').addEventListener('click', function(){
    if(!lastSlug){ E('domain-result').innerHTML='<div class="note pending">Publish to a REN name first, then attach a domain to it.</div>'; return; }
    api('/api/attach-domain', { slug:lastSlug, domain:E('f-domain').value }).then(function(r){
      var out=E('domain-result');
      if(r && r.ok){ out.innerHTML = '<div class="note pending"><b>DNS setup (pending):</b><br>Add this <b>TXT</b> record at <code>'+escH(r.domain)+'</code>:<br><code>'+escH(r.dns.txtName)+' TXT "'+escH(r.dns.txtValue)+'"</code><br>and point traffic with:<br><code>'+escH(r.dns.pointName)+' '+escH(r.dns.pointType)+' '+escH(r.dns.pointValue)+'</code><br><span class=muted>'+escH(r.note||'')+'</span></div>'; }
      else { out.innerHTML = '<div class="note pending">'+escH((r&&r.error)||'Could not attach')+'</div>'; }
    });
  });
  E('btn-verify').addEventListener('click', function(){
    if(!lastSlug){ E('domain-result').innerHTML='<div class="note pending">Attach a domain first.</div>'; return; }
    api('/api/verify-domain', { slug:lastSlug }).then(function(r){
      var out=E('domain-result');
      if(r && r.verified){ out.innerHTML = '<div class="note ok">Verified — your domain is live.</div>'; }
      else { out.innerHTML = '<div class="note pending">Status: '+escH((r&&r.status)||'pending')+'. '+escH((r&&r.note)||'')+'</div>'; }
    });
  });

  // boot: restore a saved draft or seed the first template
  var saved = load();
  if(saved && saved.doc){ CUR_TPL = saved.tpl||CUR_TPL; model = saved.doc; if(saved.network) E('opt-network').checked=true;
    document.querySelectorAll('.tpls button').forEach(function(x){ x.classList.toggle('on', x.getAttribute('data-tpl')===CUR_TPL); });
    syncForm(); renderSections(); preview();
  } else { seed(CUR_TPL); }
})();
</script>`;

  return page('SoapBox Web Builder — launch a site on a REN name or your own domain', body, {
    canonical: `${BASE_URL}${bp('/')}`, jsonld,
  });
}

// ── render a PUBLISHED customer site (SEO-clean, escaped, safeHref) ─────────────────────────────────
export function renderPublished(rec) {
  if (!rec) return null;
  const doc = rec.doc || {};
  const canonical = rec.renUrl || `${BASE_URL}${bp('/p/' + rec.slug)}`;
  const parts = [];
  let bottomBar = '';   // a single fixed collapsible bottom-nav (rendered outside .site, after content)
  parts.push(`<div class=site>`);
  parts.push(`<h1>${esc(doc.title)}</h1>`);
  if (doc.tagline) parts.push(`<p class=tagline>${esc(doc.tagline)}</p>`);
  for (const s of (doc.sections || [])) {
    if (s.heading) parts.push(`<h2>${esc(s.heading)}</h2>`);
    if (s.type === 'text') {
      parts.push(`<p>${esc(s.body).replace(/\n/g, '<br>')}</p>`);
    } else if (s.type === 'image') {
      const u = safeHref(s.url);
      if (u) parts.push(`<img src="${esc(u)}" alt="${esc(s.alt)}">`);
    } else if (s.type === 'links') {
      const items = (s.items || []).map((it) => {
        const u = safeHref(it.url);
        if (!u) return it.label ? `<li><span>${esc(it.label)}</span></li>` : '';
        return `<li><a href="${esc(u)}" rel="noopener" target="_blank">${esc(it.label || u)}</a></li>`;
      }).filter(Boolean).join('');
      if (items) parts.push(`<ul class=links>${items}</ul>`);
    } else if (s.type === 'bottomnav') {
      // A page-level collapsible bottom bar. Take the LAST one defined; safeHref every tab url so a
      // javascript:/data: URL can never survive (bottomNav esc()'s but does not protocol-check).
      const navItems = (s.items || []).map((it, i) => ({
        id: 'nav' + i, label: it.label || '', href: safeHref(it.url), icon: 'grid',
      })).filter((it) => it.label || it.href);
      bottomBar = bottomNav({ items: navItems, collapsed: s.collapsed === true, toggleLabel: s.heading || 'Menu' });
    }
  }
  // curated related-sites block (only if this site opted into the network)
  if (rec.network) {
    const block = net.renderRelatedBlock(rec.slug);
    if (block) parts.push(block);
  }
  parts.push(`<p class=builtby>Built with SoapBox Web Builder</p>`);
  parts.push(`</div>`);
  // Room so page content is never hidden behind the fixed bar, then the bar itself (outside .site).
  if (bottomBar) parts.push(`<div style="height:120px" aria-hidden="true"></div>${bottomBar}`);

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebSite',
    name: doc.title, url: canonical,
    description: doc.tagline || `${doc.title} — a website.`,
  };
  return page(doc.title || 'Website', `<span class=alpha>Alpha</span>` + parts.join(''), {
    canonical, siteName: doc.title || 'Website',
    description: doc.tagline || `${doc.title} — a website.`,
    jsonld, bare: true, style: PUB_STYLE, mainClass: 'pub-main',
    footer: '',
    robots: 'index,follow,max-image-preview:large',
  });
}

// ── account helper ──────────────────────────────────────────────────────────────────────────────────
// The signed-in account that OWNS a site. Absent/junk → the shared DEFAULT_ACCOUNT (back-compat: the old
// store had no accounts). Multi-tenant scoping keys on this; it is never trusted as auth (that's upstream).
function ownerAccount(b) {
  const a = String((b && b.account) || '').trim().toLowerCase();
  return a && /^[a-z0-9._-]{1,120}$/.test(a) ? a : DEFAULT_ACCOUNT;
}

// ── save action (persist a DRAFT, scoped to its account; survives restart) ──────────────────────────
// The editor autosaves to localStorage in the browser; this persists it server-side so it is durable and
// listable per account. A draft is NOT published (no slug, no REN, not servable at /p/) until doPublish.
export function doSave(body) {
  const b = body && typeof body === 'object' ? body : {};
  const account = ownerAccount(b);
  const siteId = String(b.siteId || '').trim().toLowerCase() || 'draft';
  const tplKey = TEMPLATE_KEYS.includes(b.template) ? b.template : null;
  const fallbackCat = (tplKey && TEMPLATES[tplKey].category) || 'personal';
  const doc = sanitizeDoc(b.doc, fallbackCat);
  const rec = store.put(account, siteId, { doc, template: tplKey, network: b.network === true, savedAt: Date.now() });
  if (!rec) return { ok: false, error: 'could not save' };
  return { ok: true, saved: 'server', account, siteId: rec.siteId };
}

// ── publish + domain actions (over the file-backed store; the seams do the rest) ────────────────────
export function doPublish(body) {
  const b = body && typeof body === 'object' ? body : {};
  const ren = resolveRen(b.ren);
  if (!ren.ok) return { ok: false, error: ren.error || 'invalid REN name' };
  const tplKey = TEMPLATE_KEYS.includes(b.template) ? b.template : null;
  const fallbackCat = (tplKey && TEMPLATES[tplKey].category) || 'personal';
  const doc = sanitizeDoc(b.doc, fallbackCat);
  const account = ownerAccount(b);
  const slug = ren.label;                    // the REN label doubles as the site's id + its global slug
  const network = b.network === true;
  store.put(account, slug, {
    slug, published: true, renUrl: ren.renUrl, tld: ren.tld, ren: ren.renUrl,
    doc, network, domain: null, domainStatus: null, domainToken: null, template: tplKey, at: Date.now(),
  });
  // Register into the backlink network + the discovery seam (only meaningful when opted in).
  net.register({
    id: slug, name: doc.title, url: `${BASE_URL}${bp('/p/' + slug)}`,
    category: doc.category, ren: ren.renUrl, optIn: network, quality: 60,
  });
  return { ok: true, slug, renUrl: ren.renUrl, pageUrl: bp('/p/' + slug) };
}

export function doAttachDomain(body) {
  const b = body && typeof body === 'object' ? body : {};
  const rec = _published(b.slug);
  if (!rec) return { ok: false, error: 'unknown site — publish to a REN name first' };
  const domain = normDomain(b.domain);
  if (!domain || !DOMAIN_RE.test(domain)) return { ok: false, error: 'enter a valid domain, e.g. www.yoursite.com' };
  const token = domainToken(domain);
  rec.domain = domain;
  rec.domainStatus = 'pending';
  rec.domainToken = token;
  store.put(rec.account, rec.siteId, { domain, domainStatus: 'pending', domainToken: token }); // persist
  // The DNS record the user must add. The apex/host CNAME/A pointer target is a documented box value.
  const pointTarget = process.env.WEBBUILDER_EDGE || 'edge.soapbox.community';
  return {
    ok: true, domain, status: 'pending',
    dns: {
      txtName: `_melek-verify.${domain}`, txtValue: token,
      pointName: domain, pointType: 'CNAME', pointValue: pointTarget,
    },
    note: 'Add these records, then the server provisions TLS and completes verification (box step). Status stays "pending" until the real DNS check passes.',
  };
}

export function doVerifyDomain(body) {
  const b = body && typeof body === 'object' ? body : {};
  const rec = _published(b.slug);
  if (!rec) return { ok: false, error: 'unknown site' };
  if (!rec.domain) return { ok: false, error: 'no domain attached yet', status: 'none' };
  const v = verifyDomain(rec.domain, rec.domainToken);
  rec.domainStatus = v.status;               // honest: only 'verified' if the seam truly verified
  store.put(rec.account, rec.siteId, { domainStatus: v.status }); // persist the honest verdict
  return { ok: true, domain: rec.domain, verified: v.verified, status: v.status, method: v.method, note: v.note };
}

// ── directory feed (aggregator-directory / search.soapbox seam) ─────────────────────────────────────
export function directoryFeed() {
  return { ok: true, source: 'webbuilder', count: net.toDirectory().length, sites: net.toDirectory() };
}

// ── request-body reader (soft, bounded, no throw) ───────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    if (req == null) return resolve('');
    if (typeof req.body === 'string') return resolve(req.body);
    if (req.body && typeof req.body === 'object') { try { return resolve(JSON.stringify(req.body)); } catch { return resolve(''); } }
    if (typeof req.on !== 'function') return resolve('');
    let data = '', bytes = 0;
    try {
      req.on('data', (c) => { bytes += c.length; if (bytes <= 1_000_000) data += c; });
      req.on('end', () => resolve(bytes > 1_000_000 ? '' : data));
      req.on('error', () => resolve(''));
    } catch { resolve(''); }
  });
}
function parseJson(s) { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } }

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export const SITEMAP_PATHS = ['/'];

export async function handler(req, res) {
  try {
    const method = (req && req.method) || 'GET';
    const url = new URL((req && req.url) || '/', BASE_URL);
    const path = url.pathname;

    if (path === '/health') return sendJson(res, { ok: true });
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.6' }));
      for (const rec of store.published()) entries.push({ path: '/p/' + rec.slug, lastmod: today, changefreq: 'weekly', priority: '0.7' });
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'Build and publish a website from a template — to a REN name or your own custom domain. Sites are SEO-clean and can opt into a curated, disclosed related-sites network.',
        links: [{ label: 'Web Builder', path: '/' }],
      }));
    }

    // JSON APIs (POST)
    if (path === '/api/save' && method === 'POST') { return sendJson(res, doSave(parseJson(await readBody(req)))); }
    if (path === '/api/publish' && method === 'POST') { return sendJson(res, doPublish(parseJson(await readBody(req)))); }
    if (path === '/api/attach-domain' && method === 'POST') { return sendJson(res, doAttachDomain(parseJson(await readBody(req)))); }
    if (path === '/api/verify-domain' && method === 'POST') { return sendJson(res, doVerifyDomain(parseJson(await readBody(req)))); }
    if (path === '/api/directory') return sendJson(res, directoryFeed());

    // published customer site
    if (path.startsWith('/p/')) {
      const slug = decodeURIComponent(path.slice(3)).toLowerCase().replace(/\/+$/, '');
      const rec = _published(slug);
      if (rec) return sendHtml(res, renderPublished(rec));
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page('Site not found — SoapBox Web Builder', '<h1>Not found</h1><p class=muted>No site is published at that address yet. <a href="' + bp('/') + '">Build one</a>.</p>', { robots: 'noindex,follow' }));
    }

    if (path === '/' || path === '') return sendHtml(res, builderPage());

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Web Builder', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Open the Web Builder</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error: ' + (e && e.message ? e.message : 'unknown')); } catch { /* noop */ }
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/webbuilder\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Web Builder on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
