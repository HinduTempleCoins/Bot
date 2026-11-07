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
import { surfacePage, compliancePage, surfaceNames, SURFACES, CARD_CONTROLS, INTAKE }
  from './surfaces.mjs';
import { ACKS, appendApplication } from './applications-store.mjs';
import { isProducer, claim as claimProducer, handleFor } from './producers-store.mjs';
import { slotFor, commit as commitMedia, listMedia, viewUrlFor, SURFACES as MEDIA_SURFACES }
  from './media-store.mjs';
import { satisfies, subjectFor, attest, setCookies, clickCanSatisfy }
  from './gate-web.mjs';
import { checkSelfie, readRawBody, MAX_BYTES } from './verify-web.mjs';
import { faceAgeProvider } from '../../integrations/agegate/face-age.mjs';
import { record as recordCheck, mintToken } from '../../integrations/agegate/model.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8161);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://yonishrine.com').replace(/\/+$/, '');
const ARTICLES_DIR = process.env.YONI_ARTICLES_DIR || path.join(__dir, 'articles');
// Secure cookies always, except when explicitly checking the box over plain http.
const SECURE_COOKIES = process.env.YONI_INSECURE_COOKIES !== '1';

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
input,textarea{width:100%;max-width:100%;box-sizing:border-box;padding:8px;background:#0e0a10;color:var(--ink);border:1px solid var(--line);border-radius:5px;font:inherit}
button{font:inherit;padding:10px 16px;border-radius:6px;border:1px solid var(--acc);background:var(--acc);color:#140f16;font-weight:bold;cursor:pointer}
ul.acks{list-style:none;padding:0}ul.acks li{margin:10px 0}ul.acks input{width:auto}
label{display:block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
.grid figure{margin:0}
.grid img,.grid video{width:100%;height:auto;border-radius:6px;border:1px solid var(--line);display:block}
.grid figcaption{font-size:14px;color:var(--ink);padding-top:6px}
select{width:100%;padding:8px;background:#0e0a10;color:var(--ink);border:1px solid var(--line);border-radius:5px;font:inherit}
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
<header><a href="/">YoniShrine</a><span><a href="/archive">Eidola</a> &middot;
<a href="/surfaces">Surfaces</a> &middot; <a href="/upload">Publish</a></span></header>
<main>${body}</main></body></html>`;

function hubPage() {
  const arts = listArticles();
  const cards = [
    ['/archive', 'Eidola', `${arts.length} articles on law, rights and sources — open, no check`],
    ['/surfaces', 'Surfaces', 'every surface here and the level it requires'],
    ['/gallery', 'Gallery', 'stills — needs a check'],
    ['/video', 'Video', 'moving image — needs a check'],
    ['/live', 'Live', 'cams — needs a check'],
    ['/upload', 'Publish', 'what publishing here requires'],
    ['/apply', 'Apply', 'apply to produce'],
    ['/compliance', 'Compliance', 'what this property has to run'],
  ].map(([href, title, blurb]) => `<li><a href="${esc(href)}">${esc(title)}</a>
    <div class=mut>${esc(blurb)}</div></li>`).join('');
  return shell('YoniShrine', `
<h1>YoniShrine</h1>
<p class=mut>An archive and a set of surfaces. Each surface declares the level of age assurance it
requires, and nothing is gated uniformly &mdash; the reading room is open, the media is not.</p>
<ul class=idx>${cards}</ul>`, 'An archive and a set of surfaces, each gated at the level it actually requires.');
}

function archivePage() {
  const arts = listArticles();
  const rows = arts.map((a) => `<li><a href="/a/${esc(a.slug)}">${esc(a.title)}</a>
    <div class=mut>${(a.bytes / 1024).toFixed(0)} KB</div></li>`).join('');
  return shell('Eidola — YoniShrine', `
<h1>Eidola</h1>
<p class=mut>&epsilon;&#7988;&delta;&omega;&lambda;&omicron;&nu; &mdash; an image, a likeness, a double.
Democritus and Epicurus used the word for their theory of sight: a thing sheds thin films of itself, the
way a snake sheds a skin, and those travel to the eye. So the Greek word for a picture is also the word
for the phantom that looks like you, and it already carried the idea that making an image means something
leaves the subject and arrives in the viewer. People have believed that about photography ever since.</p>
<p class=mut>These pages are the law and the sources: editorial and anatomical material, served without a
gate because it does not meet the "lascivious exhibition" element that triggers record-keeping and does
not on its own trigger the state age-verification statutes. The other surfaces declare their own level.</p>
<ul class=idx>${rows || '<li class=mut>No articles yet.</li>'}</ul>
<div class=card><b>Not legal advice.</b> <span class=mut>These pages describe statutes and decided cases.
They do not substitute for a lawyer admitted in the relevant jurisdiction.</span></div>
<p class=mut><a href="/">&larr; YoniShrine</a></p>`,
    'Eidola: the law, the rights and the sources, open to read.');
}

function articlePage(slug) {
  const src = readArticle(slug);
  if (src == null) return null;
  let html = '';
  try { html = renderWiki(src).html; } catch { html = '<p>Could not render this page.</p>'; }
  const title = titleize(slug);
  return shell(`${title} — YoniShrine`, `<h1>${esc(title)}</h1>${html}
<p class=mut><a href="/archive">← Eidola</a></p>`, title);
}

function surfacesPage() {
  const order = [...Object.entries(SURFACE_POLICY)].sort((a, b) => rank(a[1].level) - rank(b[1].level));
  const built = new Set([...surfaceNames(), 'upload']);
  const rows = order.map(([name, pol]) => `<tr>
    <td><b>${built.has(name) ? `<a href="/${esc(name)}">${esc(name)}</a>` : esc(name)}</b></td>
    <td><code>${esc(pol.level)}</code></td><td class=mut>${esc(pol.reason)}</td></tr>`).join('');
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
<p class=mut><a href="/upload">the upload door &rarr;</a> &middot; <a href="/archive">&larr; Eidola</a></p>`,
    'What each surface on this property requires, and why.');
}

function uploadPage(subject) {
  const pol = policyFor('upload');
  const state = gateCheck(subject, 'upload');
  const idCleared = !!(state && state.allowed);
  const amProducer = isProducer(subject);
  // Two independent conditions, reported separately: being on the producer list is not an age check,
  // and holding an id record does not make someone a producer here.
  const who = amProducer ? handleFor(subject) : null;
  const badge = amProducer
    ? `<b>Cleared to publish${who ? ` as ${esc(who)}` : ''}.</b> <span class=mut>On the producer list.</span>`
    : '<b>Closed.</b> <span class=mut>This property takes no third-party uploads. You can <a href="/apply">apply to produce</a>.</span>';
  const form = amProducer ? uploadForm() : '';
  return shell('Upload — YoniShrine', `
<h1>Publishing here</h1>
<div class=card>${badge}</div>
<div class=card><b>Intake is ${esc(INTAKE.mode)}.</b> <span class=mut>Decided
${esc(INTAKE.decidedOn)}. The only person who may publish is ${esc(INTAKE.whoMayPublish)}. There is no
submission route for anyone else, and that is a compliance position rather than a launch phase.</span></div>

${form}
<h2>What operator-only intake buys</h2>
<ul>
<li>&sect; 2257 records are the operator&rsquo;s own and bounded &mdash; there is no per-uploader duty
with no counterparty to certify.</li>
<li>&sect; 9.4.1&rsquo;s written agreement with every content provider is satisfied by a provider set
of one.</li>
<li>No pre-publication review of strangers&rsquo; submissions and no continuous moderation queue.</li>
<li>Provenance is documented for everything, so the non-consensual-imagery exposure that makes Google
demote a whole site does not arise.</li>
</ul>
<p class=mut>${esc(pol.reason)}. Note that this door still sits at <code>${esc(pol.level)}</code>:
the producer is identified too, and &sect; 2257(b) still requires a government ID examined for every
performer before production.</p>

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

<h2>And what the card networks require</h2>
<p class=mut>Mastercard Rules &sect; 9.4.1, keyed to merchant category code 5967 rather than to how
explicit the material is:</p>
<ul>${CARD_CONTROLS.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>

<h2>Before anything can be accepted</h2>
<ul>
<li>A named custodian of records, with title and business address, and the § 2257(e) statement on every
page carrying covered material.</li>
<li>An <code>id</code>-level check on the publisher, and a separate one before any payout.</li>
<li>A government photo ID examined for every performer before production, with the record held by the
custodian.</li>
</ul>
<div class=card><b>Still needed before anything is published.</b> <span class=mut>The custodian of
records named with a title and business address, the § 2257(e) statement on every page carrying covered
material, and the MCC 5967 registration completed by the acquirer before the first transaction.</span></div>
<p class=mut><a href="/surfaces">&larr; all surfaces</a> &middot; <a href="/archive">Eidola</a></p>`,
    'What publishing here requires: § 2257, the custodian of records, and the two files.');
}

function applyPage({ error = '', done = false, values = {} } = {}) {
  const pol = policyFor('apply');
  if (done) {
    return shell('Application received — YoniShrine', `
<h1>Application received</h1>
<div class=card><b>Logged.</b> <span class=mut>Nothing is published and no rights are granted by this.
The operator reads the log and approves out of band; if you are approved you will be contacted at the
address you gave.</span></div>
<p class=mut><a href="/archive">Eidola</a> &middot; <a href="/compliance">what this property has to run</a></p>`,
      'Application received.');
  }
  const v = (k) => esc(values[k] || '');
  const acks = Object.entries(ACKS).map(([k, label]) => `<li><label>
    <input type=checkbox name="${esc(k)}" value=on> ${esc(label)}</label></li>`).join('');
  return shell('Apply — YoniShrine', `
<h1>Apply to produce</h1>
<p class=mut>Intake is ${esc(INTAKE.mode)}: nobody uploads anything to this property. This form is an
application to become a producer. It grants no publishing rights, and submitting it does not put
anything on the site. The gate level for applying is <code>${esc(pol.level)}</code>.</p>
${error ? `<div class=card><b>Not submitted.</b> <span class=mut>${esc(error)}</span></div>` : ''}
<form method=post action="/apply">
<p><label>Contact &mdash; an address or handle that reaches you<br>
<input name=contact value="${v('contact')}" required></label></p>
<p><label>Name or working name <span class=mut>(optional)</span><br>
<input name=name value="${v('name')}"></label></p>
<p><label>What you would produce<br>
<textarea name=what rows=4 required>${v('what')}</textarea></label></p>
<p><label>Where you are <span class=mut>(optional &mdash; jurisdiction matters for the paperwork)</span><br>
<input name=where value="${v('where')}"></label></p>
<p><label>Links to existing work <span class=mut>(optional)</span><br>
<input name=links value="${v('links')}"></label></p>
<p><label>Anything else <span class=mut>(optional)</span><br>
<textarea name=notes rows=3>${v('notes')}</textarea></label></p>
<ul class=acks>${acks}</ul>
<p><button type=submit>Submit application</button></p>
</form>
<div class=card><b>Do not attach identity documents.</b> <span class=mut>No date of birth, no ID
number, no photograph of a document. This form refuses them. The &sect; 2257 examination happens later,
in person, against the person, by the custodian of records &mdash; not through a web form and not into
a log file.</span></div>
<p class=mut><a href="/upload">what publishing here requires</a> &middot;
<a href="/compliance">what this property has to run</a> &middot; <a href="/archive">Eidola</a></p>`,
    'Apply to produce. An application only — it grants no publishing rights.');
}

function attestPage(surface, next) {
  const pol = policyFor(surface);
  return shell('Confirm your age — YoniShrine', `
<h1>Before you go in</h1>
<p>This surface asks for <code>${esc(pol.level)}</code>: a statement that you are 18 or over.</p>
<form method=post action="/gate/attest">
<input type=hidden name=next value="${esc(next)}">
<p><label><input type=checkbox name=attested value=on required> I am 18 years of age or over.</label></p>
<p><button type=submit>Continue</button></p>
</form>
<p class=mut>This is a declaration, not a verification. It is not sufficient under the state
age-verification statutes and it is never the top of this scale &mdash; which is why the surfaces that
need a real check ask for one instead. Nothing is stored about you beyond an opaque random id and the
result; no date of birth, no document, no name.</p>
<p class=mut><a href="/">&larr; YoniShrine</a></p>`, 'Confirm you are 18 or over.');
}

function noProviderPage(surface) {
  const pol = policyFor(surface);
  return shell('Not available — YoniShrine', `
<h1>Not available yet</h1>
<p>This surface needs <code>${esc(pol.level)}</code> &mdash; ${esc(pol.reason)}.</p>
<p class=mut>That is a commercially reasonable check or a government ID matched to a live selfie, and
this property has not contracted a provider for either. A checkbox cannot stand in for it, so the
surface stays closed rather than opening on something weaker than the statute requires.</p>
<p class=mut><a href="/surfaces">what each surface requires</a> &middot;
<a href="/compliance">what this property has to run</a> &middot; <a href="/archive">Eidola</a></p>`,
    `This surface needs ${pol.level}, and no provider is contracted.`);
}

/** Only an internal path, so `next` can never become an open redirect. */
export function safeNext(v) {
  const s = String(v == null ? '' : v);
  if (!s.startsWith('/') || s.startsWith('//')) return '/';
  if (/[\r\n]/.test(s) || s.includes('\\')) return '/';
  return s.slice(0, 200);
}

function uploadForm() {
  const opts = Object.entries(MEDIA_SURFACES)
    .map(([k, v]) => `<option value="${esc(k)}">${esc(k)} &mdash; ${esc(v.kinds.join(', '))}, up to ${Math.round(v.maxBytes / 1024 / 1024)}MB</option>`).join('');
  return `
<h2>Publish something</h2>
<p class=mut>The file goes from your browser straight to storage &mdash; it does not pass through this
server. Nothing appears on a surface until the commit step finishes.</p>
<p><label>Surface<br><select id=usurf>${opts}</select></label></p>
<p><label>File<br><input type=file id=ufile></label></p>
<p><label>Caption <span class=mut>(optional)</span><br><input id=ucap></label></p>
<p><button id=ugo type=button>Upload and publish</button></p>
<p class=mut id=ustat></p>
<script>
(function(){
  var f=document.getElementById('ufile'), b=document.getElementById('ugo'),
      s=document.getElementById('ustat'), sel=document.getElementById('usurf'), cap=document.getElementById('ucap');
  b.addEventListener('click', async function(){
    var file=f.files && f.files[0];
    if(!file){ s.textContent='Choose a file first.'; return; }
    b.disabled=true; s.textContent='Asking for a slot\u2026';
    try{
      var r=await fetch('/upload/slot',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({surface:sel.value,filename:file.name,bytes:file.size})});
      var j=await r.json();
      if(!j.ok){ s.textContent=j.reason||'No slot.'; b.disabled=false; return; }
      s.textContent='Uploading\u2026';
      var put=await fetch(j.putUrl,{method:'PUT',body:file});
      if(!put.ok){ s.textContent='Storage refused the upload ('+put.status+').'; b.disabled=false; return; }
      s.textContent='Publishing\u2026';
      var c=await fetch('/upload/commit',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({key:j.key,surface:sel.value,caption:cap.value,bytes:file.size})});
      var cj=await c.json();
      s.textContent = cj.ok ? 'Published to /'+sel.value+'.' : (cj.reason||'Commit failed.');
    }catch(e){ s.textContent='Upload failed.'; }
    b.disabled=false;
  });
})();
</script>`;
}

function claimPage({ ok, handle = '', reason = '' }) {
  return shell(ok ? 'Claimed — YoniShrine' : 'Not claimed — YoniShrine', ok
    ? `<h1>You are a producer here</h1>
<div class=card><b>Bound as ${esc(handle)}.</b> <span class=mut>This browser can now publish. The code is
spent &mdash; ask the operator for another to add a second device.</span></div>
<p class=mut><a href="/upload">the upload door</a> &middot; <a href="/archive">Eidola</a></p>`
    : `<h1>That code did not work</h1>
<div class=card><span class=mut>${esc(reason)}</span></div>
<p class=mut><a href="/apply">apply to produce</a> &middot; <a href="/archive">Eidola</a></p>`,
    ok ? 'Producer claim accepted.' : 'Producer claim refused.');
}

function verifyPage(next, { error = '' } = {}) {
  return shell('Age check — YoniShrine', `
<h1>Age check</h1>
<p>This surface needs <code>verified</code> — a commercially reasonable check rather than a declaration.
We run ours ourselves: a photograph of your face, estimated on our own machine, against a threshold set
above eighteen by a margin.</p>
${error ? `<div class=card><b>Not cleared.</b> <span class=mut>${esc(error)}</span></div>` : ''}
<div class=card><b>The photograph is not kept.</b> <span class=mut>It exists on our disk for the seconds
the estimator needs it, under a random name, and is deleted whether the check passes, fails or crashes.
No image, no face and no estimated age is written to your record &mdash; the record says only that a check
of this kind passed, and when it expires.</span></div>
<p><label>A photograph of your face<br>
<input type=file id=sel accept="image/jpeg,image/png,image/webp"></label></p>
<p><button id=go type=button>Run the check</button></p>
<p class=mut id=stat></p>
<p class=mut>One person in the frame, facing the camera. If the estimate lands under the threshold the
check cannot clear you &mdash; that is the margin doing its job, not a judgement about you, and a stronger
method is the route in.</p>
<p class=mut><a href="/surfaces">what each surface requires</a> &middot;
<a href="/compliance">what this property has to run</a> &middot; <a href="/archive">Eidola</a></p>
<script>
(function(){
  var f=document.getElementById('sel'), b=document.getElementById('go'), s=document.getElementById('stat');
  b.addEventListener('click', function(){
    var file=f.files && f.files[0];
    if(!file){ s.textContent='Choose a photograph first.'; return; }
    if(file.size > ${MAX_BYTES}){ s.textContent='That file is too large.'; return; }
    b.disabled=true; s.textContent='Checking\u2026';
    fetch('/gate/verify?next='+encodeURIComponent(${JSON.stringify(next)}), {
      method:'POST', headers:{'content-type': file.type || 'application/octet-stream'}, body:file
    }).then(function(r){ return r.json(); }).then(function(j){
      if(j && j.ok){ s.textContent='Cleared. Taking you through\u2026'; location.href=j.next || '/'; }
      else { b.disabled=false; s.textContent=(j && j.reason) || 'The check did not clear.'; }
    }).catch(function(){ b.disabled=false; s.textContent='The check could not be run.'; });
  });
})();
</script>`, 'Our own age check: a selfie, estimated on our own machine, and never kept.');
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { chunks.length = 0; req.destroy(); return resolve(''); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

export async function handler(req, res) {
  let url;
  try { url = new URL(req.url || '/', 'http://x'); } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }); return res.end('bad url');
  }
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const who = subjectFor(req);
  const cookies = setCookies({ subject: who.subject, minted: who.minted, secure: SECURE_COOKIES });
  const html = (code, body, extra = []) => {
    const h = { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' };
    const all = [...cookies, ...extra];
    if (all.length) h['set-cookie'] = all;
    res.writeHead(code, h);
    res.end(body);
  };
  /** Stop here unless this request satisfies the surface. Returns true when it handled the response. */
  const gated = (surface) => {
    const st = satisfies(req, surface);
    if (st.ok) return false;
    if (clickCanSatisfy(surface)) { html(200, attestPage(surface, p)); return true; }
    // `verified` is now something we can actually do, so offer the check rather than a closed door.
    if (st.need === 'verified') { html(200, verifyPage(p)); return true; }
    html(200, noProviderPage(surface));
    return true;
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

  if (p === '/') return html(200, hubPage());

  if (p === '/archive') return html(200, archivePage());

  if (p === '/surfaces') return html(200, surfacesPage());

  // /upload is NOT behind its own id gate, on purpose: the page is the statement of what publishing
  // here requires, and walling it means no prospective producer can ever read it. The submission is
  // what is closed — the badge says so, and producerAllowed() enforces it. Information open, door shut.
  if (p === '/upload') return html(200, uploadPage(who.subject));

  if (p === '/compliance') return html(200, compliancePage({ shell }));

  if (p === '/upload/claim') {
    const r = claimProducer(url.searchParams.get('code') || '', who.subject);
    return html(200, claimPage({ ok: !!r.ok, handle: r.handle || '', reason: r.reason || '' }));
  }

  if (p === '/upload/slot' || p === '/upload/commit') {
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': cookies });
      res.end(JSON.stringify(body));
    };
    if (String(req.method || 'GET').toUpperCase() !== 'POST') return json(405, { ok: false, reason: 'POST only' });
    if (!isProducer(who.subject)) return json(403, { ok: false, reason: 'not on the producer list' });
    const handle = handleFor(who.subject) || 'operator';
    let body = {};
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { return json(400, { ok: false, reason: 'bad json' }); }
    if (p === '/upload/slot') {
      return json(200, slotFor({ handle, surface: body.surface, filename: body.filename, bytes: body.bytes }));
    }
    return json(200, commitMedia({ key: body.key, handle, surface: body.surface, caption: body.caption, bytes: body.bytes }));
  }

  if (p === '/gate/verify') {
    const next = safeNext(url.searchParams.get('next'));
    if (String(req.method || 'GET').toUpperCase() !== 'POST') return html(200, verifyPage(next));
    const json = (code, body, extra = []) => {
      const h = { 'content-type': 'application/json; charset=utf-8' };
      const all = [...cookies, ...extra];
      if (all.length) h['set-cookie'] = all;
      res.writeHead(code, h); res.end(JSON.stringify(body));
    };
    const buf = await readRawBody(req, MAX_BYTES);
    if (buf === null) return json(413, { ok: false, reason: 'that image is too large' });
    const verdict = await checkSelfie(buf, { provider: faceAgeProvider });
    if (!verdict || !verdict.ok) {
      return json(200, { ok: false, reason: (verdict && verdict.reason) || 'the check did not clear' });
    }
    // checkSelfie already ran the provider; this only files the RESULT under the subject. It carries a
    // provider reference and nothing else — no age, no image, no face.
    const filed = recordCheck(who.subject, 'verified', {
      provider: faceAgeProvider.id, providerRef: verdict.providerRef || 'face-age',
    });
    if (!filed || !filed.ok) return json(200, { ok: false, reason: filed && filed.reason ? filed.reason : 'could not file the result' });
    const secret = String(process.env.YONI_GATE_SECRET || '').trim();
    if (!secret) return json(200, { ok: false, reason: 'no signing secret configured' });
    const minted = mintToken(who.subject, 'verified', secret, { audience: 'yonishrine' });
    if (!minted || !minted.ok) return json(200, { ok: false, reason: 'could not issue the token' });
    const maxAgeSec = Math.max(1, Math.floor(((minted.expiresAt || Date.now()) - Date.now()) / 1000));
    return json(200, { ok: true, next }, setCookies({ token: minted.token, maxAgeSec, secure: SECURE_COOKIES }));
  }

  if (p === '/gate/attest') {
    if (String(req.method || 'GET').toUpperCase() !== 'POST') { res.writeHead(405, { allow: 'POST' }); return res.end('POST only'); }
    const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const next = safeNext(form.next);
    if (!form.attested) return html(200, attestPage('apply', next));
    const out = await attest(who.subject);
    if (!out.ok) return html(200, noProviderPage('apply'));
    const extra = setCookies({ token: out.token, maxAgeSec: out.maxAgeSec, secure: SECURE_COOKIES });
    res.writeHead(303, { location: next, 'set-cookie': [...cookies, ...extra] });
    return res.end('');
  }

  if (p === '/apply') {
    if (gated('apply')) return undefined;
    if (String(req.method || 'GET').toUpperCase() !== 'POST') return html(200, applyPage());
    const raw = await readBody(req);
    const form = Object.fromEntries(new URLSearchParams(raw));
    const out = appendApplication(form);
    if (!out.ok) return html(200, applyPage({ error: out.reason, values: form }));
    return html(200, applyPage({ done: true }));
  }

  if (surfaceNames().includes(p.slice(1))) {
    const name = p.slice(1);
    if (gated(name)) return undefined;
    const items = MEDIA_SURFACES[name]
      ? listMedia({ surface: name }).map((it) => ({ ...it, url: viewUrlFor(it.key) })).filter((it) => it.url)
      : null;
    const page = surfacePage(name, { shell, subject: who.subject, items });
    if (page) return html(200, page);
  }

  if (p.startsWith('/a/')) {
    const page = articlePage(p.slice(3));
    return page ? html(200, page) : html(404, shell('Not found — YoniShrine', '<h1>Not found</h1><p class=mut><a href="/">← YoniShrine</a></p>'));
  }

  return html(404, shell('Not found — YoniShrine', '<h1>Not found</h1><p class=mut><a href="/">← YoniShrine</a></p>'));
}

export { policyFor, reveal, previewMode };

if (process.argv[1] && process.argv[1].endsWith('site/yoni/server.mjs')) {
  createServer(handler).listen(PORT, HOST, () =>
    console.log(`YoniShrine on ${BASE_URL} (bound ${HOST}:${PORT}, ${listArticles().length} articles)`));
}
