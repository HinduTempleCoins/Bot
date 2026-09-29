// transcripts-pages.mjs — SoapBox Stream surface for Pentecaust transcripts (pentecaust/transcripts/store.mjs):
//   GET  /transcripts/<src>/<id>.vtt        best English subtitle track (human beats AI), text/vtt
//   GET  /watch/<src>/<id>/transcript       readable transcript with timestamps, provenance badge, correction form
//   POST /api/transcripts/suggest           a reader's correction → the item's edits queue (no login; the browser's
//                                            random key is stored only as a salted hash; per-IP rate limit)
//   trackTag(src,id) / transcriptLink(src,id) for the /watch player.
// Pure builders + small handlers; esc() everything.

import { createHash } from 'node:crypto';
import { getMeta, bestTrack, readTrack, appendEdit, listEdits, HUMAN } from '../../pentecaust/transcripts/store.mjs';
import { parseVtt, fmt } from '../../pentecaust/transcripts/vtt.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SALT = () => process.env.TRANSCRIPT_VOTER_SALT || 'pentecaust-transcripts-v1';
const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
export const TEXT_MAX = 1000;

const LABEL = {
  'human-edited': 'Checked and corrected by people',
  official: 'Official transcript',
  'human-found': 'Human-made subtitles',
  'ai-edited': 'AI-made — please help correct',
  'ai-whisper': 'AI-made — please help correct',
};

export function best(src, id) {
  const m = getMeta(src, id);
  return m ? { meta: m, vtt: bestTrack(m), txt: bestTrack(m, { format: 'txt' }) } : null;
}

export function trackTag(src, id) {
  const b = best(src, id);
  if (!b || !b.vtt) return '';
  const label = HUMAN.has(b.vtt.provenance) ? 'English' : 'English (AI-made)';
  return `<track kind=subtitles srclang=en label="${esc(label)}" src="/transcripts/${esc(src)}/${esc(id)}.vtt" default>`;
}

export function transcriptLink(src, id) {
  const b = best(src, id);
  if (!b || (!b.vtt && !b.txt)) return '';
  const t = b.vtt || b.txt;
  return `<a class=btn href="/watch/${esc(src)}/${esc(id)}/transcript">📝 Transcript <span style="font-weight:400;opacity:.75">· ${esc(LABEL[t.provenance] || t.provenance)}</span></a>`;
}

export function serveVtt(res, src, id) {
  const b = best(src, id);
  const body = b && b.vtt ? readTrack(src, id, b.vtt) : null;
  if (!body) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('no subtitles'); }
  res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' });
  return res.end(body);
}

export function transcriptBody(src, id, title = '') {
  const b = best(src, id);
  if (!b || (!b.vtt && !b.txt)) return null;
  const t = b.vtt || b.txt;
  const body = readTrack(src, id, t) || '';
  const ai = !HUMAN.has(t.provenance);
  const cues = t.format === 'vtt' ? parseVtt(body) : [];
  const lines = cues.length
    ? cues.map((c, i) => `<p class=tx id="c${i + 1}"><a class=tt href="/watch/${esc(src)}/${esc(id)}#t=${Math.floor(c.start)}">${esc(fmt(c.start).slice(0, 8))}</a> <span class=cn>#${i + 1}</span> ${esc(c.text).replace(/\n/g, ' ')}</p>`).join('')
    : `<div class=tx style="white-space:pre-wrap">${esc(body)}</div>`;
  const pending = listEdits(src, id).length;
  const other = b.meta.tracks.filter((x) => x !== t).map((x) => `${esc(x.lang)} · ${esc(LABEL[x.provenance] || x.provenance)}`).join(' &nbsp;|&nbsp; ');
  return `<style>.tx{margin:4px 0;line-height:1.55}.tt{font-family:monospace;font-size:12px;margin-right:6px}.cn{color:var(--mut);font-size:11px;margin-right:4px}
.prov{display:inline-block;border-radius:10px;padding:2px 9px;font-size:12px;font-weight:700;border:1px solid ${ai ? '#e0a11b' : '#3fb950'};color:${ai ? '#e0a11b' : '#3fb950'}}</style>
<p><a class=btn href="/watch/${esc(src)}/${esc(id)}">← Back to the film</a></p>
<h1 style="font-size:20px">Transcript: ${esc(title || b.meta.title || id)}</h1>
<p><span class=prov>${esc(LABEL[t.provenance] || t.provenance)}</span> <span style="color:var(--mut);font-size:13px">${esc(t.model || '')}${t.source ? ` · <a href="${esc(t.source)}" target=_blank rel="noopener noreferrer">source</a>` : ''}${pending ? ` · ${pending} correction${pending === 1 ? '' : 's'} waiting for review` : ''}</span></p>
${ai ? '<p style="color:var(--mut);font-size:13px">A machine made this from the film\'s audio. Names, old slang and songs are where it slips. If you spot a mistake, send the line number and the right words below — every correction makes the next transcript better.</p>' : ''}
${other ? `<p style="color:var(--mut);font-size:12px">Other tracks: ${other}</p>` : ''}
<form id=sug class=licbox style="margin:12px 0"><b>Suggest a correction</b><br>
<label style="font-size:13px">Line # <input name=cue inputmode=numeric size=5 maxlength=6></label>
<textarea name=text maxlength=${TEXT_MAX} rows=2 style="width:100%;margin-top:6px" placeholder="The correct words (or what is missing)"></textarea>
<button class=btn type=submit>Send</button> <span id=sugmsg style="font-size:13px;color:var(--mut)"></span></form>
${lines}
<script>(function(){var K='pc-tx-voter',k;try{k=localStorage.getItem(K);if(!k){var a=new Uint8Array(16);crypto.getRandomValues(a);k=Array.from(a,function(b){return('0'+b.toString(16)).slice(-2)}).join('');localStorage.setItem(K,k);}}catch(e){k='anon-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);}
var f=document.getElementById('sug'),m=document.getElementById('sugmsg');f.addEventListener('submit',function(e){e.preventDefault();
var p=new URLSearchParams({src:${JSON.stringify(src)},id:${JSON.stringify(id)},cue:f.cue.value,text:f.text.value,voter:k});
fetch('/api/transcripts/suggest',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:p.toString()}).then(function(r){return r.json()}).then(function(j){
m.textContent=j.ok?'Thank you — sent for review.':(j.error==='rate-limited'?'Slow down a little.':'Could not send.');if(j.ok)f.text.value='';}).catch(function(){m.textContent='Could not send.';});});})();</script>`;
}

const hits = new Map();
export function __resetTranscriptRate() { hits.clear(); }
const RATE = () => +(process.env.TRANSCRIPT_RATE_PER_HOUR || 60);
function rateOk(ip) {
  const now = Date.now(); const arr = (hits.get(ip) || []).filter((t) => t > now - 3600e3);
  if (arr.length >= RATE()) { hits.set(ip, arr); return false; }
  arr.push(now); hits.set(ip, arr); return true;
}

/** params: URLSearchParams → { code, body } */
export function suggest(params, ip) {
  const src = String(params.get('src') || ''); const id = String(params.get('id') || '');
  const voter = String(params.get('voter') || '');
  const text = String(params.get('text') || '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
  const cue = parseInt(String(params.get('cue') || ''), 10);
  const b = best(src, id);
  if (!b || (!b.vtt && !b.txt)) return { code: 404, body: { ok: false, error: 'no transcript' } };
  if (!KEY_RE.test(voter)) return { code: 400, body: { ok: false, error: 'bad voter' } };
  if (text.length < 2) return { code: 400, body: { ok: false, error: 'empty' } };
  if (!rateOk(ip)) return { code: 429, body: { ok: false, error: 'rate-limited' } };
  const t = b.vtt || b.txt;
  const ok = appendEdit(src, id, { ts: new Date().toISOString(), track: t.file, cue: Number.isFinite(cue) && cue > 0 ? cue : null, text, voter: createHash('sha256').update(`${SALT()}:${voter}`).digest('hex').slice(0, 24), status: 'pending' });
  return ok ? { code: 200, body: { ok: true } } : { code: 500, body: { ok: false, error: 'store unavailable' } };
}

function readForm(req) {
  return new Promise((resolve) => {
    let d = ''; let big = false;
    req.on('data', (c) => { d += c; if (d.length > 8192) { big = true; d = d.slice(0, 8192); } });
    req.on('end', () => { try { resolve(big ? new URLSearchParams() : new URLSearchParams(d)); } catch { resolve(new URLSearchParams()); } });
    req.on('error', () => resolve(new URLSearchParams()));
  });
}

/** Route handler; → true when it answered. */
export async function transcriptsRoute(req, res, path, { shell, send, clientIp }) {
  let m = /^\/transcripts\/([a-z]{2,12})\/([A-Za-z0-9._-]{1,200})\.vtt$/.exec(path);
  if (m) { serveVtt(res, m[1], m[2]); return true; }
  m = /^\/watch\/([a-z]{2,12})\/([A-Za-z0-9._-]{1,200})\/transcript$/.exec(path);
  if (m) {
    const body = transcriptBody(m[1], m[2]);
    if (!body) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('no transcript yet'); return true; }
    send(res, shell(`Transcript · ${getMeta(m[1], m[2]).title || m[2]}`, body, { canonical: `/watch/${m[1]}/${m[2]}/transcript`, description: `Transcript of ${getMeta(m[1], m[2]).title || m[2]} with timestamps — help correct it.` }));
    return true;
  }
  if (path === '/api/transcripts/suggest') {
    if ((req.method || 'GET').toUpperCase() !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return true; }
    const r = suggest(await readForm(req), clientIp(req));
    res.writeHead(r.code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(r.body));
    return true;
  }
  return false;
}
