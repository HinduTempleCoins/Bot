// server.mjs — Language.SoapBox.Community / the Hathor Language Center. A working
// language-learning surface in the SoapBox house style (mirrors site/insurance/server.mjs).
// It fronts the pure curriculum + SRS engine in integrations/language/lessons.mjs and a keyless
// MyMemory translate box (the same approach as pentecaust/translate.js).
//
//   PORT=8201 BASE_URL=https://language.soapbox.community node site/language/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                      course directory
//   /course/:id            a course: its lessons + a link into practice
//   /lesson/:course/:n     a lesson: flashcards (prompt → reveal answer), vocab, phrases, grammar
//   /practice/:course      a scored quiz — type the answer, we score + schedule the review (SRS)
//   /api/practice/:course  (POST) score one answer JSON { key, given } → { correct, item, ... }
//   /api/translate?q=&to=  keyless MyMemory translate (injectable fetch, soft-fail)
//   /health                liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   Real lessons, real scoring, real spaced repetition — no placeholders. esc() on every
//   interpolated value. Soft-fail: every route renders even when a backend returns nothing.
//   The translate call is keyless + injectable and never throws out of the handler.
//   Ecosystem tie-in: a completed lesson / review streak is a natural PLAY / Move reward trigger —
//   the engine exposes recordReview(); wiring the faucet is a deferred surface concern, noted only.

import { createServer } from 'node:http';

import * as lessons from '../../integrations/language/lessons.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8201);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SITE_NAME = 'Hathor Language Center';

export const esc = lessons.esc;

// ── keyless MyMemory translate (same approach as pentecaust/translate.js) ──────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

/**
 * Translate `q` into `to` (ISO code) via keyless MyMemory. GET langpair=from|to.
 * Soft-fail: returns the ORIGINAL text on any error, and never throws. Injectable fetch.
 */
export async function translateText({ q, from = 'en', to } = {}) {
  const text = typeof q === 'string' ? q : '';
  if (!text.trim() || !to || from === to) return text;
  try {
    const langpair = `${from || 'en'}|${to}`;
    const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
    const r = await _fetch(u);
    if (!r || !r.ok) return text;
    const j = await r.json();
    const t = j && j.responseData && j.responseData.translatedText;
    return (typeof t === 'string' && t.trim()) ? t : text;
  } catch { return text; }
}

// ── house-style shell (same dark theme as Insurance/Coupons/Hemp) ──────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{position:fixed;top:6px;left:6px;z-index:20;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);background:#d2992222;border:1px solid var(--gold);border-radius:6px;padding:2px 7px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:18px 0 10px} h3{font-size:15px;margin:14px 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  .flag{font-size:22px;margin-right:6px}
  table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
  th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--mut);font-weight:600;font-size:13px}
  .ex{color:var(--mut);font-size:13px;font-style:italic}
  .grammar li{margin:4px 0;color:var(--fg)}
  input.q,input.a{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px}
  input.q{flex:1 1 220px;min-width:160px;max-width:420px} input.a{width:100%}
  input:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  .flash{background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:26px 22px;margin:14px 0;text-align:center}
  .flash .prompt{font-size:22px;font-weight:700} .flash .answer{font-size:24px;color:var(--gold);font-weight:800;margin-top:10px;display:none}
  .flash.revealed .answer{display:block} .flash .ex{margin-top:8px}
  .kbd{font-family:ui-monospace,monospace;font-size:12px;border:1px solid var(--line2);border-radius:5px;padding:1px 6px;color:var(--mut)}
  .pill{display:inline-block;font-size:12px;color:var(--mut);border:1px solid var(--line2);border-radius:999px;padding:2px 9px;margin:2px 4px 2px 0}
  .ok{color:var(--up)} .no{color:var(--down)}
  .result{margin-top:10px;font-weight:600;min-height:22px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Hathor Language Center.</b> Real lessons, spaced-repetition review (SM-2), and a keyless translate box.
  Part of the MELEK / SoapBox ecosystem — completing lessons is designed to earn PLAY / Move rewards
  (faucet wiring pending). Translations are machine-generated and best-effort; verify anything important.
  <div style="margin-top:8px"><a href="/">Courses</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Learn Spanish, Kurdish (Kurmanji), and French with real lessons, flashcards, spaced-repetition review, and a free translate box. The Hathor Language Center on SoapBox.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/api/translate?q={search_term_string}&to=es` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<div class=alpha>Alpha</div>
<header class=topbar><a class=brand href="/">🗣️ Hathor <span>language center</span></a>
  <div class=topbar-r><a href="/">Courses</a>${lessons.listCourses().map((id) => `<a href="/course/${esc(id)}">${esc(lessons.getCourse(id).flag)} ${esc(lessons.getCourse(id).label.split(' ')[0])}</a>`).join('')}<a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── translate widget (client posts to /api/translate; graceful if JS off) ──────────────────────────
function translateBox() {
  const opts = lessons.listCourses().map((id) => {
    const c = lessons.getCourse(id);
    return `<option value="${esc(id)}">${esc(c.label)}</option>`;
  }).join('');
  return `<div class=card><h2>Quick translate</h2>
    <p class=muted style="font-size:14px">Keyless, free, best-effort (MyMemory). Type English, pick a language.</p>
    <div class=row>
      <input class=q id=tq placeholder="Type something in English…" aria-label="Text to translate">
      <select id=tto aria-label="Target language" style="background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 12px;font-size:15px">${opts}</select>
      <button type=button onclick="doTranslate()">Translate</button>
    </div>
    <div class=result id=tout></div>
    <script>
      async function doTranslate(){
        var q=document.getElementById('tq').value, to=document.getElementById('tto').value, out=document.getElementById('tout');
        out.textContent='…';
        try{
          var r=await fetch('/api/translate?q='+encodeURIComponent(q)+'&to='+encodeURIComponent(to));
          var j=await r.json();
          out.textContent = j && j.translated ? j.translated : '(no translation)';
        }catch(e){ out.textContent='(translate unavailable)'; }
      }
    </script>
  </div>`;
}

// ── home / course directory ────────────────────────────────────────────────────────────────────────
export function homePage() {
  const cards = lessons.listCourses().map((id) => {
    const c = lessons.getCourse(id);
    return `<a class=sec href="/course/${esc(id)}"><div class=t><span class=flag>${esc(c.flag)}</span>${esc(c.label)} <span class=muted style="font-weight:400">· ${esc(c.native)}</span></div><div class=d>${esc(c.blurb)}</div></a>`;
  }).join('');
  const body = `<h1>Hathor Language Center <span class=muted style="font-size:14px">· learn a language honestly</span></h1>
    <p class=muted>Real lessons, flashcards, and a review system that shows you a word again right before you'd forget it (spaced repetition). Pick a course:</p>
    <div class=grid style="margin-top:8px">${cards}</div>
    ${translateBox()}
    <div class=card><h2>How the review works</h2>
      <p class=muted style="font-size:14px">Each answer you type is scored (accents and small typos forgiven) and fed into an
      <b>SM-2</b> spaced-repetition schedule — the same algorithm behind Anki. Get it right and the card comes back in days,
      then weeks; miss it and it returns almost immediately. Your streak is designed to earn <b>PLAY / Move</b> rewards in the
      wider MELEK ecosystem.</p></div>`;
  return page(`${SITE_NAME} — learn Spanish, Kurdish & French`, body, { canonical: `${BASE_URL}/` });
}

export function coursePage(id) {
  const c = lessons.getCourse(id);
  if (!c) return null;
  const rows = c.lessons.map((l) => {
    const deck = (l.vocab || []).length + (l.phrases || []).length;
    return `<tr><td><a href="/lesson/${esc(c.id)}/${esc(l.n)}"><b>Lesson ${esc(l.n)}</b> — ${esc(l.title)}</a><div class=muted style="font-size:13px">${esc(l.focus)}</div></td><td class=muted>${esc(deck)} cards</td></tr>`;
  }).join('');
  const deck = lessons.deckFor(c.id);
  const body = `<p><a href="/">← Courses</a></p>
    <h1><span class=flag>${esc(c.flag)}</span>${esc(c.label)} <span class=muted style="font-size:15px">· ${esc(c.native)}</span></h1>
    <p class=muted>${esc(c.blurb)}</p>
    <div class=row style="margin:10px 0"><a class=sec style="flex:0 0 auto;padding:10px 16px" href="/practice/${esc(c.id)}">▶ Practice all ${esc(deck.length)} cards</a></div>
    <table><thead><tr><th>Lesson</th><th>Cards</th></tr></thead><tbody>${rows}</tbody></table>`;
  return page(`${c.label} — ${SITE_NAME}`, body, {
    canonical: `${BASE_URL}/course/${c.id}`,
    description: `Learn ${c.label} (${c.native}) with ${c.lessons.length} lessons of real vocab, phrases, and grammar, plus spaced-repetition practice.`,
  });
}

export function lessonPage(courseId, n) {
  const c = lessons.getCourse(courseId);
  const l = lessons.getLesson(courseId, n);
  if (!c || !l) return null;

  const flashcards = (l.vocab || []).map((v) => `
    <div class=flash onclick="this.classList.toggle('revealed')">
      <div class=prompt>${esc(v.translation)}</div>
      <div class=answer>${esc(v.word)}</div>
      ${v.example ? `<div class=ex>${esc(v.example)}</div>` : ''}
      <div class=muted style="font-size:12px;margin-top:8px">tap to ${'{reveal}'}</div>
    </div>`).join('').replaceAll('{reveal}', 'reveal / hide');

  const phraseRows = (l.phrases || []).map((p) => `<tr><td><b>${esc(p.phrase)}</b></td><td class=muted>${esc(p.translation)}</td></tr>`).join('');
  const grammar = (l.grammar || []).map((g) => `<li>${esc(g)}</li>`).join('');

  const prevN = l.n - 1, nextN = l.n + 1;
  const hasPrev = !!lessons.getLesson(courseId, prevN);
  const hasNext = !!lessons.getLesson(courseId, nextN);
  const nav = `<div class=row style="margin-top:16px">
    ${hasPrev ? `<a class=sec style="flex:0 0 auto;padding:9px 14px" href="/lesson/${esc(c.id)}/${esc(prevN)}">← Lesson ${esc(prevN)}</a>` : ''}
    <a class=sec style="flex:0 0 auto;padding:9px 14px" href="/practice/${esc(c.id)}">▶ Practice</a>
    ${hasNext ? `<a class=sec style="flex:0 0 auto;padding:9px 14px" href="/lesson/${esc(c.id)}/${esc(nextN)}">Lesson ${esc(nextN)} →</a>` : ''}
  </div>`;

  const body = `<p><a href="/course/${esc(c.id)}">← ${esc(c.label)}</a></p>
    <h1>Lesson ${esc(l.n)}: ${esc(l.title)}</h1>
    <p class=muted>${esc(l.focus)}</p>
    <h2>Flashcards</h2>
    <p class=muted style="font-size:13px">Read the English, guess the ${esc(c.label.split(' ')[0])}, then tap to check.</p>
    ${flashcards || '<p class=muted>No cards.</p>'}
    ${phraseRows ? `<h2>Phrases</h2><table><tbody>${phraseRows}</tbody></table>` : ''}
    ${grammar ? `<h2>Grammar notes</h2><ul class=grammar>${grammar}</ul>` : ''}
    ${nav}`;
  return page(`${c.label} · Lesson ${l.n}: ${l.title} — ${SITE_NAME}`, body, {
    canonical: `${BASE_URL}/lesson/${c.id}/${l.n}`,
    description: `${c.label} Lesson ${l.n}: ${l.title}. ${l.focus}`,
  });
}

// ── practice / quiz (client-scored via /api/practice; SRS scheduled server-side) ────────────────────
export function practicePage(courseId) {
  const c = lessons.getCourse(courseId);
  if (!c) return null;
  const deck = lessons.deckFor(c.id);
  // Ship the deck to the client as JSON (prompts + keys). Answers are checked on the server so the
  // scoring + SRS logic stays authoritative; the prompt/key list is not the answer key.
  const clientDeck = deck.map((d) => ({ key: d.key, prompt: d.prompt, kind: d.kind }));
  const json = JSON.stringify(clientDeck).replace(/</g, '\\u003c');

  const body = `<p><a href="/course/${esc(c.id)}">← ${esc(c.label)}</a></p>
    <h1>Practice — ${esc(c.label)}</h1>
    <p class=muted>Type the ${esc(c.label.split(' ')[0])} for each prompt. Accents and small typos are forgiven. Each answer schedules your next review.</p>
    <div class=card>
      <div class=muted id=pcount></div>
      <div class=prompt id=pprompt style="font-size:22px;font-weight:700;margin:10px 0"></div>
      <form onsubmit="return submitAnswer(event)"><div class=row>
        <input class=a id=pa autocomplete=off autocapitalize=off spellcheck=false aria-label="Your answer">
        <button type=submit>Check</button>
      </div></form>
      <div class=result id=presult></div>
      <div class=row style="margin-top:12px"><button type=button onclick="nextCard()">Next →</button>
        <span class=muted id=pscore></span></div>
    </div>
    <div class=card><b>Session:</b> <span id=psummary class=muted>not started</span></div>
    <script>
      var DECK=${json}, learner=(function(){try{var k='melek_lang_learner';var v=localStorage.getItem(k);if(!v){v='anon-'+Math.random().toString(36).slice(2,9);localStorage.setItem(k,v);}return v;}catch(e){return 'anon';}})();
      var i=0, right=0, done=0;
      function show(){var c=DECK[i]||{};document.getElementById('pcount').textContent='Card '+(i+1)+' of '+DECK.length;document.getElementById('pprompt').textContent=c.prompt||'—';document.getElementById('pa').value='';document.getElementById('presult').textContent='';document.getElementById('pa').focus();}
      function nextCard(){i=(i+1)%DECK.length;show();}
      async function submitAnswer(e){e.preventDefault();var c=DECK[i]||{};var given=document.getElementById('pa').value;var out=document.getElementById('presult');
        try{
          var r=await fetch('/api/practice/'+encodeURIComponent(${JSON.stringify(c.id)}),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:c.key,given:given,learner:learner})});
          var j=await r.json();
          done++; if(j.correct) right++;
          out.innerHTML = j.correct ? '<span class=ok>✓ Correct — '+esc(j.answer)+'</span>' : '<span class=no>✗ '+esc(j.answer)+'</span>';
          document.getElementById('pscore').textContent='next review in '+(j.item?j.item.interval:0)+' day(s)';
          document.getElementById('psummary').textContent=done+' answered · '+right+' correct';
          setTimeout(nextCard, 900);
        }catch(err){ out.textContent='(could not score — try again)'; }
        return false;
      }
      function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch];});}
      show();
    </script>`;
  return page(`Practice ${c.label} — ${SITE_NAME}`, body, {
    canonical: `${BASE_URL}/practice/${c.id}`, robots: 'noindex,follow',
    description: `Spaced-repetition practice for ${c.label}. Type answers; the SM-2 scheduler plans your reviews.`,
  });
}

/**
 * Score one practice answer and record the review (drives SRS + progress). PURE-ish: the store is
 * the module's injectable store. Returns a plain object for JSON. Soft-fail: unknown card → not correct.
 */
export function scorePractice({ courseId, key, given, learner, now = Date.now() } = {}) {
  const deck = lessons.deckFor(courseId);
  const card = deck.find((d) => d.key === key);
  if (!card) return { correct: false, score: 0, answer: '', item: lessons.freshItem(now) };
  const s = lessons.scoreAnswer(given, card.answer);
  const grade = s.correct ? (s.close ? 4 : 5) : 2; // close match still recalled; a miss lapses
  const item = lessons.recordReview({ learner: learner || 'anon', courseId, key, grade, now });
  return { correct: s.correct, score: s.score, close: !!s.close, answer: card.answer, example: card.example || '', item };
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    try {
      req.on('data', (c) => { data += c; if (data.length > 1e6) data = data.slice(0, 1e6); });
      req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
}

export const SITEMAP_PATHS = [
  '/',
  ...lessons.listCourses().map((id) => `/course/${id}`),
  ...lessons.listCourses().flatMap((id) => lessons.getCourse(id).lessons.map((l) => `/lesson/${id}/${l.n}`)),
];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'Language-learning surface: real lessons (Spanish, Kurdish/Kurmanji, French), flashcards, SM-2 spaced-repetition practice, and a keyless MyMemory translate box. Part of the MELEK/SoapBox ecosystem.',
        links: lessons.listCourses().map((id) => ({ label: lessons.getCourse(id).label, path: `/course/${id}` })),
      }));
    }

    if (path === '/api/translate') {
      const q = url.searchParams.get('q') || '';
      const to = url.searchParams.get('to') || '';
      const from = url.searchParams.get('from') || 'en';
      const translated = await translateText({ q, from, to });
      return sendJson(res, { q, from, to, translated });
    }

    if (path.startsWith('/api/practice/')) {
      if (req.method !== 'POST') return sendJson(res, { error: 'POST only' }, 405);
      const courseId = decodeURIComponent(path.slice('/api/practice/'.length));
      const body = await readBody(req);
      const out = scorePractice({ courseId, key: body.key, given: body.given, learner: body.learner });
      return sendJson(res, out);
    }

    if (path === '/') return sendHtml(res, homePage());

    if (path.startsWith('/course/')) {
      const html = coursePage(decodeURIComponent(path.slice('/course/'.length)));
      if (!html) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, html);
    }

    if (path.startsWith('/lesson/')) {
      const parts = path.slice('/lesson/'.length).split('/');
      const html = lessonPage(decodeURIComponent(parts[0] || ''), parts[1] || '');
      if (!html) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, html);
    }

    if (path.startsWith('/practice/')) {
      const html = practicePage(decodeURIComponent(path.slice('/practice/'.length)));
      if (!html) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, html);
    }

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/language\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
