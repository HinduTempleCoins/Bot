// site/yoni/server.mjs — YoniShrine: the adult-facing reference surface.
//
// ⭐ WHY THIS IS A SEPARATE SERVER AND NOT A SECOND INSTANCE OF site/wiki.
// The wiki server always includes site/wiki/seed-articles in its article search path, so pointing a
// second copy at a different ARTICLES_DIR would still serve the entire public Library of Ashurbanipal
// on this host. The two shelves must not bleed into each other: this one has its own article
// directory, its own index, and an age gate the public Library does not have. It reuses the public
// wiki's RENDERER and nothing else.
//
// ⭐ THE GATE IS PER SURFACE, NOT PER SITE.
// integrations/agegate decides what each surface needs. The reference articles here are editorial
// and anatomical — they fail the "lascivious exhibition" element and do not trigger the state
// age-verification statutes on their own — so they are served at level `none`. Galleries, video and
// live, when they exist, declare higher levels and pay for a real check at their own door. Gating
// everything uniformly is how the verification bill becomes the largest line item.
//
// ⭐ TWO STORES, AND THEY MUST NOT BE CONFUSED.
// The age gate keeps a RESULT and never a document (integrations/agegate assertNoPII). § 2257 goes the
// other way: a producer must examine a government ID and KEEP the record at the business premises for
// inspection. Those are not the same store and they are not in tension once that is said out loud —
// the gate answers "is this viewer old enough", the § 2257 file answers "prove this performer was 18",
// it is held by a named custodian of records, and it never becomes the gate's problem or the web
// tier's problem. The upload door below is where a publisher is told which of the two they are in.
//
// House style: ESM, esc() all interpolation, handler(req,res) exported for tests, CLI guarded.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { renderWiki, slugify, titleize } from '../wiki/render.mjs';
import { policyFor, check as gateCheck, reveal, previewMode, SURFACE_POLICY, LEVELS, rank }
  from '../../integrations/agegate/model.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8161);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://yonishrine.com').replace(/\/+$/, '');
const ARTICLES_DIR = process.env.YONI_ARTICLES_DIR || path.join(__dir, 'articles');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Articles live in one directory and nowhere else — see the note above. */
export function listArticles(dir = ARTICLES_DIR) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.wiki')).sort(); } catch { return []; }
  return files.map((f) => {
    const slug = f.replace(/\.wiki$/, '');
    let bytes = 0;
    try { bytes = fs.statSync(path.join(dir, f)).size; } catch { /* ignore */ }
    return { slug, title: titleize(slug), file: path.join(dir, f), bytes };
  });
}

export function readArticle(slug, dir = ARTICLES_DIR) {
  const safe = String(slug || '').replace(/[^A-Za-z0-9_.-]/g, '');
  if (!safe || safe.includes('..')) return null;
  try { return fs.readFileSync(path.join(dir, `${safe}.wiki`), 'utf8'); } catch { return null; }
}

const STYLE = `<style>
:root{--bg:#120d14;--panel:#1b141d;--line:#312436;--ink:#ece6ef;--mut:#a294ab;--acc:#d4a5c8}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 Georgia,'Iowan Old Style',serif}
header{border-bottom:1px solid var(--line);padding:14px 20px;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
header a{color:var(--acc);text-decoration:none;font-weight:bold}
header span{color:var(--mut);font-size:14px}
main{max-width:860px;margin:0 auto;padding:22px 20px 60px}
h1{font-size:30px;line-height:1.25;margin:.2em 0 .5em}
h2{font-size:22px;border-bottom:1px solid var(--line);padding-bottom:4px;margin-top:1.6em}
h3{font-size:18px;margin-top:1.3em}
a{color:var(--acc)}
table{border-collapse:collapse;margin:1em 0;width:100%;font-size:15px}
th,td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
th{background:#241a27}
code,pre{background:#0f0b11;border:1px solid var(--line);border-radius:6px;padding:2px 6px;font-family:ui-monospace,Menlo,monospace;font-size:13px}
pre{padding:10px;overflow:auto}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.mut{color:var(--mut)}
ul.idx{list-style:none;padding:0}
ul.idx li{border-bottom:1px solid var(--line);padding:10px 0}
ul.idx a{font-size:18px}
</style>`;

const shell = (title, body, desc = '') => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=rating content="adult">
<meta name=robots content="noindex,nofollow">
${STYLE}</head><body>
<header><a href="/">YoniShrine</a><span>reference shelf</span></header>
<main>${body}</main></body></html>`;

function indexPage() {
  const arts = listArticles();
  const rows = arts.map((a) => `<li><a href="/a/${esc(a.slug)}">${esc(a.title)}</a>
    <div class=mut>${(a.bytes / 1024).toFixed(0)} KB</div></li>`).join('');
  return shell('YoniShrine — reference', `
<h1>Reference shelf</h1>
<p class=mut>Source material and legal reference. These pages are editorial and anatomical: they are
served without an age gate because they do not meet the "lascivious exhibition" element that triggers
record-keeping, and they do not on their own trigger the state age-verification statutes. Other
surfaces on this property declare their own level.</p>
<ul class=idx>${rows || '<li class=mut>No articles yet.</li>'}</ul>
<p class=mut><a href="/surfaces">surfaces and what each requires &rarr;</a> &middot;
<a href="/upload">publishing here &rarr;</a></p>
<div class=card><b>Not legal advice.</b> <span class=mut>These pages describe statutes and decided
cases. They do not substitute for a lawyer admitted in the relevant jurisdiction.</span></div>`,
    'Reference shelf: law, rights and source material.');
}

function articlePage(slug) {
  const src = readArticle(slug);
  if (src == null) return null;
  let html = '';
  try { html = renderWiki(src).html; } catch { html = '<p>Could not render this page.</p>'; }
  const title = titleize(slug);
  return shell(`${title} — YoniShrine`, `<h1>${esc(title)}</h1>${html}
<p class=mut><a href="/">← back to the shelf</a></p>`, title);
}

function surfacesPage() {
  const order = [...Object.entries(SURFACE_POLICY)].sort((a, b) => rank(a[1].level) - rank(b[1].level));
  const rows = order.map(([name, pol]) => `<tr>
    <td><b>${esc(name)}</b></td><td><code>${esc(pol.level)}</code></td><td class=mut>${esc(pol.reason)}</td></tr>`).join('');
  return shell('Surfaces — YoniShrine', `
<h1>Surfaces and what each one requires</h1>
<p class=mut>Every surface on this property declares its own level. Nothing is gated uniformly: a
commercial check is charged per visitor, so sending every reader through one is how verification
becomes the largest operating cost of the property. The levels are ordered
${LEVELS.map((l) => `<code>${esc(l)}</code>`).join(' &rarr; ')}, and <code>attested</code> is never the
top of the scale because a self-declaration is not sufficient under the state statutes.</p>
<table><tr><th>Surface</th><th>Level</th><th>Why</th></tr>${rows}</table>
<div class=card><b>The last two are not about viewers.</b> <span class=mut><code>upload</code> and
<code>payout</code> sit at <code>id</code> because they identify the person <i>publishing</i> or being
<i>paid</i>. That is the 18 U.S.C. § 2257 side and the tax side, not the age-gate side.</span></div>
<p class=mut><a href="/upload">the upload door &rarr;</a> &middot; <a href="/">&larr; back to the shelf</a></p>`,
    'What each surface on this property requires, and why.');
}

function uploadPage(subject) {
  const pol = policyFor('upload');
  const state = gateCheck(subject, 'upload');
  const cleared = !!(state && state.allowed);
  const badge = cleared
    ? '<b>Cleared.</b> <span class=mut>This subject holds a current <code>id</code> record.</span>'
    : `<b>Not cleared.</b> <span class=mut>This door needs <code>${esc(pol.level)}</code>. Nothing can be submitted until that check is done.</span>`;
  return shell('Upload — YoniShrine', `
<h1>Publishing here</h1>
<div class=card>${badge}</div>
<p class=mut>${esc(pol.reason)}.</p>

<h2>What the statute requires of a producer</h2>
<p>These are requirements on whoever <b>produces</b> the material, not on the viewer. They come from
18 U.S.C. § 2257, and the subsections are set out in full on
<a href="/a/The_Federal_Age_Floor_for_Filming">The Federal Age Floor for Filming</a>.</p>
<ul>
<li><b>§ 2257(b)</b> — ascertain, by examination of an identification document, each performer&rsquo;s
name and date of birth, and record every other name used: maiden name, alias, stage name. A government
ID, examined <i>before</i> production. That is the statutory text, not an industry custom.</li>
<li><b>§ 2257(c)</b> — the records are kept at the business premises and available for inspection.</li>
<li><b>§ 2257(e)</b> — a statement on every copy saying where the records are; for an organisation, the
name, title and business address of the responsible individual, the <b>custodian of records</b>. For a
website, read that as every page carrying covered material.</li>
<li><b>§ 2257(f)</b> — failing to create or maintain the records, entering false information knowingly,
or transferring covered matter without the statement are each independently unlawful.</li>
<li><b>§ 2257(i)</b> — not more than five years for a first offence; not less than two nor more than ten
thereafter.</li>
<li><b>§ 2257A</b> — simulated conduct, with a certification-based exemption for producers already
keeping ID records in the ordinary course of business.</li>
</ul>

<h2>The two files, which are not the same file</h2>
<table>
<tr><th></th><th>The age gate</th><th>The § 2257 records</th></tr>
<tr><td><b>Answers</b></td><td>Is this viewer old enough?</td><td>Prove this performer was eighteen.</td></tr>
<tr><td><b>Holds</b></td><td>A result: method, provider reference, when, expiry.</td><td>The examined ID, the name, the date of birth, every other name used.</td></tr>
<tr><td><b>Never holds</b></td><td>The document, the document number, the date of birth.</td><td>&mdash;</td></tr>
<tr><td><b>Kept by</b></td><td>This web tier.</td><td>The named custodian of records, at the business premises.</td></tr>
</table>
<p class=mut>The gate refuses to persist anything that looks like identity-document data, and that
refusal is enforced in code rather than promised in a policy. The § 2257 file is the opposite
obligation and it is deliberately not held here.</p>

<h2>Before anything can be accepted</h2>
<ul>
<li>A named custodian of records, with title and business address, and the § 2257(e) statement on every
page carrying covered material.</li>
<li>An <code>id</code>-level check on the publisher, and a separate one before any payout.</li>
<li>A government photo ID examined for every performer before production, with the record held by the
custodian.</li>
</ul>
<div class=card><b>Not open yet.</b> <span class=mut>This door is built and gated. No intake is accepted
until the custodian of records is named and the § 2257(e) statement is in place.</span></div>
<p class=mut><a href="/surfaces">&larr; all surfaces</a> &middot; <a href="/">the shelf</a></p>`,
    'What publishing here requires: § 2257, the custodian of records, and the two files.');
}

export async function handler(req, res) {
  let url;
  try { url = new URL(req.url || '/', 'http://x'); } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('bad url');
  }
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const html = (code, body) => {
    res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' });
    res.end(body);
  };

  if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

  // Deliberately not indexed while the property is being assembled.
  if (p === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('User-agent: *\nDisallow: /\n');
  }

  if (p === '/gate') {
    const surface = url.searchParams.get('surface') || 'wiki';
    const who = url.searchParams.get('subject') || '';
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, surface, policy: policyFor(surface), state: gateCheck(who, surface) }));
  }

  if (p === '/') return html(200, indexPage());

  if (p === '/surfaces') return html(200, surfacesPage());

  if (p === '/upload') return html(200, uploadPage(url.searchParams.get('subject') || ''));

  if (p.startsWith('/a/')) {
    const page = articlePage(p.slice(3));
    return page ? html(200, page) : html(404, shell('Not found — YoniShrine', '<h1>Not found</h1><p class=mut><a href="/">← back to the shelf</a></p>'));
  }

  return html(404, shell('Not found — YoniShrine', '<h1>Not found</h1><p class=mut><a href="/">← back to the shelf</a></p>'));
}

export { policyFor, reveal, previewMode };

if (process.argv[1] && process.argv[1].endsWith('site/yoni/server.mjs')) {
  createServer(handler).listen(PORT, HOST, () =>
    console.log(`YoniShrine on ${BASE_URL} (bound ${HOST}:${PORT}, ${listArticles().length} articles)`));
}
