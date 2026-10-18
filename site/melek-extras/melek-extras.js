// melek-extras.js — served at https://melek.salon/melek-extras.js and loaded by the condenser's page shell.
// Two small, framework-free additions to the live condenser:
//   1. Cookie notice. melek.salon sets a sign-in session cookie and loads Google Analytics. Accept keeps
//      analytics on; Decline turns analytics storage off (gtag consent) and remembers the choice.
//   2. "Report" button on every post page. It files a report with POST /api/report (the moderation store
//      in signup/server.mjs), which emails the operator. A report goes to a human; it removes nothing.
// No keys, no account access. Choices are kept in localStorage only.
(function () {
  'use strict';
  var d = document, w = window;
  var CONSENT_KEY = 'melek-cookie-consent';
  var KINDS = [['spam', 'Spam'], ['abuse', 'Abuse / harassment'], ['scam', 'Scam / fraud'],
    ['impersonation', 'Impersonation'], ['illegal', 'Illegal content'], ['other', 'Other']];

  function store(k, v) { try { if (v === undefined) return w.localStorage.getItem(k); w.localStorage.setItem(k, v); } catch (e) { return null; } return null; }
  function el(tag, attrs, text) {
    var n = d.createElement(tag);
    for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text) n.textContent = text;
    return n;
  }
  function denyAnalytics() { try { if (typeof w.gtag === 'function') w.gtag('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied' }); } catch (e) { /* soft */ } }

  // ── 1. cookie notice ────────────────────────────────────────────────────────────────────────────
  function cookieNotice() {
    var choice = store(CONSENT_KEY);
    if (choice === 'declined') { denyAnalytics(); return; }
    if (choice === 'accepted') return;
    var bar = el('div', { role: 'region', 'aria-label': 'Cookie notice',
      style: 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#1a1a1a;color:#fff;padding:12px 16px;' +
        'font:14px/1.4 system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center' });
    var msg = el('span', { style: 'max-width:720px' },
      'MELEK uses a cookie to keep you signed in, and Google Analytics to count visits. Your keys never leave your browser.');
    var ok = el('button', { type: 'button', style: 'background:#f5a623;color:#111;border:0;border-radius:4px;padding:6px 14px;font-weight:600;cursor:pointer' }, 'Accept');
    var no = el('button', { type: 'button', style: 'background:transparent;color:#fff;border:1px solid #888;border-radius:4px;padding:6px 14px;cursor:pointer' }, 'Decline analytics');
    ok.onclick = function () { store(CONSENT_KEY, 'accepted'); bar.remove(); };
    no.onclick = function () { store(CONSENT_KEY, 'declined'); denyAnalytics(); bar.remove(); };
    bar.appendChild(msg); bar.appendChild(ok); bar.appendChild(no);
    d.body.appendChild(bar);
  }

  // ── 2. report button on post pages ────────────────────────────────────────────────────────────────
  function postTarget() {
    var m = w.location.pathname.match(/\/(@[a-z0-9.-]{3,16})\/([a-z0-9-]+)\/?$/i);
    return m ? m[1].toLowerCase() + '/' + m[2] : '';
  }
  function reporter() {
    try { var u = JSON.parse(store('autopost2') || 'null'); return (u && u.username) || ''; } catch (e) { return ''; }
  }
  function openForm(target, anchor) {
    if (d.getElementById('melek-report-form')) return;
    var f = el('form', { id: 'melek-report-form', style: 'margin:10px 0;padding:12px;border:1px solid #ccc;border-radius:6px;max-width:460px;font:14px system-ui,sans-serif' });
    f.appendChild(el('div', { style: 'font-weight:600;margin-bottom:6px' }, 'Report this post'));
    f.appendChild(el('div', { style: 'font-size:12px;color:#666;margin-bottom:8px' },
      'A report goes to a person for review. It does not remove anything by itself.'));
    var sel = el('select', { name: 'kind', style: 'width:100%;margin-bottom:8px;padding:4px' });
    KINDS.forEach(function (k) { sel.appendChild(el('option', { value: k[0] }, k[1])); });
    var why = el('textarea', { name: 'reason', rows: '3', maxlength: '1000', placeholder: 'What is wrong with it? (optional)', style: 'width:100%;margin-bottom:8px;padding:4px' });
    var send = el('button', { type: 'submit', class: 'button' }, 'Send report');
    var cancel = el('button', { type: 'button', class: 'button hollow', style: 'margin-left:8px' }, 'Cancel');
    var out = el('div', { role: 'status', style: 'margin-top:8px;font-size:13px' });
    cancel.onclick = function () { f.remove(); };
    f.onsubmit = function (e) {
      e.preventDefault();
      send.disabled = true; out.textContent = 'Sending…';
      fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: target, kind: sel.value, reason: why.value, reporter: reporter() }) })
        .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
        .then(function (j) {
          if (j && j.ok) { out.textContent = 'Thank you. Your report was sent for review.'; setTimeout(function () { f.remove(); }, 2500); }
          else { send.disabled = false; out.textContent = j && j.reason === 'rate-limited' ? 'Too many reports right now. Please try again later.' : 'Could not send the report. Please try again.'; }
        })
        .catch(function () { send.disabled = false; out.textContent = 'Could not send the report. Please try again.'; });
    };
    f.appendChild(sel); f.appendChild(why); f.appendChild(send); f.appendChild(cancel); f.appendChild(out);
    anchor.parentNode.insertBefore(f, anchor.nextSibling);
  }
  function addReportButton() {
    var target = postTarget();
    if (!target) return;
    var footer = d.querySelector('.PostFull__footer');
    if (!footer || footer.querySelector('.melek-report')) return;
    var btn = el('a', { href: '#', class: 'melek-report', role: 'button', title: 'Report this post for review',
      style: 'margin-left:12px;font-size:13px;color:#888;cursor:pointer;white-space:nowrap' }, '⚑ Report');
    btn.onclick = function (e) { e.preventDefault(); openForm(target, footer); };
    footer.appendChild(btn);
  }

  // ── 3. creation tools beside the post editor ──────────────────────────────────────────────────────
  // A column of collapsible tabs. Nothing loads until a tab is opened (the iframe gets its src then),
  // tabs open independently, and an opened tool stays loaded when collapsed so work isn't lost.
  var TOOLS = [
    ['novel', 'Novel Writing', 'Draft chapters, track your word count, export your book.', 'https://pentecaust.com/metatron'],
    ['image', 'Image Generation', 'Make pictures for your post with Hathor’s studio.', 'https://hathor.soapbox.community/'],
    ['music', 'Music', 'Write songs and build beats with Hathor Sandalphon.', 'https://pentecaust.com/sandalphon'],
  ];
  function addCreationTools() {
    if (!/\/submit(\.html)?\/?$/.test(w.location.pathname)) return;
    var editor = d.querySelector('.SubmitPost');
    if (!editor || d.getElementById('melek-tools')) return;
    var wide = w.innerWidth >= 1100;
    var col = el('aside', { id: 'melek-tools', 'aria-label': 'Creation tools',
      style: wide ? 'position:absolute;top:90px;right:16px;width:420px;max-height:calc(100vh - 110px);overflow:auto;font:14px system-ui,sans-serif'
        : 'margin:16px;font:14px system-ui,sans-serif' });
    col.appendChild(el('div', { style: 'font-weight:700;margin:0 0 8px' }, 'Create with Hathor'));
    TOOLS.forEach(function (t) {
      var box = el('section', { style: 'border:1px solid #ddd;border-radius:8px;margin-bottom:8px;overflow:hidden;background:#fff' });
      var head = el('button', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'melek-tool-' + t[0],
        style: 'display:block;width:100%;text-align:left;padding:10px 12px;background:#f7f7f7;border:0;cursor:pointer;font:600 14px system-ui,sans-serif' },
        '▸ ' + t[1]);
      var body = el('div', { id: 'melek-tool-' + t[0], hidden: '' });
      body.appendChild(el('div', { style: 'padding:6px 12px;font-size:12px;color:#666' }, t[2] + ' '));
      var open = el('a', { href: t[3], target: '_blank', rel: 'noopener', style: 'font-size:12px;margin-left:12px' }, 'Open full screen ↗');
      body.firstChild.appendChild(open);
      var frame = null;
      head.onclick = function () {
        var show = body.hasAttribute('hidden');
        if (show) {
          if (!frame) {
            frame = el('iframe', { title: t[1], src: t[3], loading: 'lazy',
              allow: 'clipboard-write; microphone; autoplay',
              style: 'display:block;width:100%;height:' + (wide ? '640px' : '560px') + ';border:0' });
            body.appendChild(frame);
          }
          body.removeAttribute('hidden');
        } else body.setAttribute('hidden', '');
        head.setAttribute('aria-expanded', show ? 'true' : 'false');
        head.textContent = (show ? '▾ ' : '▸ ') + t[1];
      };
      box.appendChild(head); box.appendChild(body); col.appendChild(box);
    });
    if (wide) {
      editor.style.marginRight = '452px';
      d.body.appendChild(col);
    } else editor.parentNode.insertBefore(col, editor.nextSibling);
  }
  function routeChanged() {
    var col = d.getElementById('melek-tools');
    if (col && !/\/submit(\.html)?\/?$/.test(w.location.pathname)) col.remove();
    addReportButton();
    addCreationTools();
  }

  function start() {
    cookieNotice();
    routeChanged();
    // the condenser is a single-page app: re-check when the page content changes (navigation)
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(routeChanged, 150); })
      .observe(d.body, { childList: true, subtree: true });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})();
