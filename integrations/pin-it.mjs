// integrations/pin-it.mjs — 📌 SAVE THIS: the one-click way any MELEK surface sends a picture to the
// Pinboard, the way Pinterest's hover button works.
//
// Drop PIN_IT_JS into a page and every picture on it gets a small Save button on hover (and a visible
// one on touch screens). Clicking it opens the Pinboard's saver with the picture, the page it was on,
// and the title already filled in — so the pin keeps a link home and the author's name, which is the
// rule the Pinboard enforces anyway (a saved pin without its source is refused).
//
// For one picture in a template, use pinItButton() instead and you get a plain link, no script at all.
//
// PURE: builds strings. No network, no storage, no account data.
//
//   import { pinItButton, pinItHref, PIN_IT_JS, PIN_IT_CSS } from './pin-it.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const PINBOARD = () => String(env('PINBOARD_SITE', 'https://pin.melek.salon')).replace(/\/$/, '');

const ok = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };

/** the Pinboard saver link for one picture — '' if the picture address is not usable */
export function pinItHref({ url, source = '', title = '', as = '', board = '' } = {}) {
  if (!ok(url)) return '';
  const q = new URLSearchParams({ url: String(url) });
  if (ok(source)) q.set('source', String(source));
  if (title) q.set('title', String(title).slice(0, 200));
  if (as) q.set('as', String(as).slice(0, 40));
  if (board) q.set('board', String(board).slice(0, 60));
  return `${PINBOARD()}/save?${q.toString()}`;
}

/** a ready-made button for one picture */
export function pinItButton(opts = {}, { label = '📌 Save' } = {}) {
  const href = pinItHref(opts);
  return href ? `<a class=pin-it href="${esc(href)}" target=_blank rel="noopener noreferrer" title="Save this picture to the MELEK Pinboard">${esc(label)}</a>` : '';
}

export const PIN_IT_CSS = `<style>
.pin-it{display:inline-block;font:600 12px/1 system-ui,sans-serif;color:#fff;background:rgba(17,17,17,.78);
 border:0;border-radius:999px;padding:6px 11px;text-decoration:none;cursor:pointer}
.pin-it:hover{background:#b3261e}
.pin-it-wrap{position:relative;display:inline-block;max-width:100%}
.pin-it-wrap>.pin-it{position:absolute;top:10px;left:10px;opacity:0;transition:opacity .12s}
.pin-it-wrap:hover>.pin-it,.pin-it-wrap:focus-within>.pin-it{opacity:1}
@media (hover:none){.pin-it-wrap>.pin-it{opacity:.9}}
</style>`;

/**
 * Attach a Save button to every picture on the page.
 * Skips tiny images (icons, spacers, tracking pixels) and anything marked data-no-pin.
 */
export const PIN_IT_JS = `<script>
(function(){
var PIN=${JSON.stringify('')}+(window.MELEK_PINBOARD||'https://pin.melek.salon');
var MIN=160;                       // ignore icons, avatars and tracking pixels
function who(){try{return localStorage.getItem('melek_me')||''}catch(e){return ''}}
function href(src){
 var q='url='+encodeURIComponent(src)+'&source='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title||'');
 var me=who(); if(me)q+='&as='+encodeURIComponent(me);
 return PIN+'/save?'+q;
}
function wrap(img){
 if(img.dataset.pinned||img.hasAttribute('data-no-pin'))return;
 if((img.naturalWidth||img.width||0)<MIN||(img.naturalHeight||img.height||0)<MIN)return;
 if(!/^https?:/.test(img.currentSrc||img.src))return;
 img.dataset.pinned='1';
 var a=document.createElement('a');
 a.className='pin-it';a.textContent='📌 Save';a.target='_blank';a.rel='noopener noreferrer';
 a.title='Save this picture to the MELEK Pinboard';
 a.href=href(img.currentSrc||img.src);
 var p=img.parentNode;
 if(p&&p.classList&&p.classList.contains('pin-it-wrap')){p.appendChild(a);return}
 var w=document.createElement('span');w.className='pin-it-wrap';
 p.insertBefore(w,img);w.appendChild(img);w.appendChild(a);
}
function scan(){[].forEach.call(document.images,function(i){if(i.complete)wrap(i);else i.addEventListener('load',function(){wrap(i)},{once:true})})}
if(document.readyState!=='loading')scan();else document.addEventListener('DOMContentLoaded',scan);
if(window.MutationObserver)new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});
})();
</script>`;

/** everything a page needs in one call */
export const pinItAll = () => `${PIN_IT_CSS}${PIN_IT_JS}`;
