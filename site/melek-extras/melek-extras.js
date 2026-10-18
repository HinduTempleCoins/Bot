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
    ['video', 'Video (Bifrost)', 'Upload a video to Bifrost, MELEK\u2019s video platform, then link it in your post.', 'https://hathor.soapbox.community/pentecaust/bifrost/upload'],
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
  // ── 4. profile "Message" button → the Pentecaust page that handles sign-in ─────────────────────────
  // For logged-in viewers the condenser links /dm?me=…&with=…, which answers a raw 401 JSON unless the
  // visitor already has a Pentecaust session. /?dm=<account> works for everyone and signs them in there.
  function fixMessageLinks() {
    var links = d.querySelectorAll('a[href^="https://pentecaust.com/dm?"]');
    for (var i = 0; i < links.length; i++) {
      var m = links[i].href.match(/[?&]with=([^&]+)/);
      if (m) links[i].href = 'https://pentecaust.com/?dm=' + m[1];
    }
  }
  // ── 5. profile "Invite to Pact" button, beside Message ───────────────────────────────────────────
  function addInviteButton() {
    // every Message link on the page: the desktop button block and the phone one (show-for-small-only)
    var msgs = d.querySelectorAll('a[href^="https://pentecaust.com/?dm="]');
    for (var i = 0; i < msgs.length; i++) {
      var msg = msgs[i];
      if (msg.parentNode.querySelector('.melek-invite')) continue;
      var acct = (msg.href.match(/[?&]dm=([^&]+)/) || [])[1];
      if (!acct) continue;
      var a = el('a', { href: 'https://pact.pentecaust.com/?invite=' + acct, target: '_blank', rel: 'noopener',
        class: (msg.className || '') + ' melek-invite', title: 'Invite them to one of your Pact groups or channels',
        style: 'margin-left:8px' }, 'Invite to Pact');
      msg.parentNode.insertBefore(a, msg.nextSibling);
    }
  }

  // ── 5a. heading anchors in posts: "## Hathor, 24/7: Like PIZZA Bot" → id hathor-247-like-pizza-bot, so
  // links can point at a section (the Members page links straight to Hathor's commands) ─────────────
  var anchorScrolled = '';
  function addHeadingAnchors() {
    var hs = d.querySelectorAll('.PostFull__body h1, .PostFull__body h2, .PostFull__body h3, .MarkdownViewer h1, .MarkdownViewer h2, .MarkdownViewer h3');
    for (var i = 0; i < hs.length; i++) {
      if (hs[i].id) continue;
      var slug = (hs[i].textContent || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
      if (slug && !d.getElementById(slug)) hs[i].id = slug;
    }
    var h = decodeURIComponent((w.location.hash || '').slice(1));
    if (h && anchorScrolled !== w.location.href) {
      var t = d.getElementById(h);
      if (t) { anchorScrolled = w.location.href; t.scrollIntoView({ block: 'start' }); w.scrollBy(0, -80); }
    }
  }

  // ── 5b. profile fixes ───────────────────────────────────────────────────────────────────────────
  // Rewards → Curation / Author rewards pointed at /portal/wallet.html/@x/…-rewards, which the app can't
  // route (404). Those pages live on wallet.melek.salon.
  function fixRewardsLinks() {
    var links = d.querySelectorAll('a[href*="/portal/wallet.html/@"]');
    for (var i = 0; i < links.length; i++) {
      var m = links[i].getAttribute('href').match(/\/portal\/wallet\.html\/(@[a-z0-9.-]+)\/(curation-rewards|author-rewards)/i);
      if (m) links[i].href = 'https://wallet.melek.salon/' + m[1] + '/' + m[2];
    }
  }
  // ── 5c. profile pictures ────────────────────────────────────────────────────────────────────────
  // Every account has a picture (its own, or an identicon from /u/<name>/avatar). The profile header only
  // drew one when json_metadata held a profile_image (Userpic hideIfDefault), so pictures saved with the
  // posting key (posting_json_metadata) and identicons never showed there: draw it when the app did not.
  function profileAccount() {
    var m = w.location.pathname.match(/^\/@([a-z0-9.-]{2,16})(?:\/|$)/i);
    return m ? m[1].toLowerCase() : '';
  }
  function savedUser() {   // the condenser's saved login: hex of "user\t…" — only the name is read
    try {
      var hex = store('autopost2') || '';
      if (!/^[0-9a-f]+$/i.test(hex)) return '';
      var s = '';
      for (var i = 0; i < hex.length && s.indexOf('\t') < 0; i += 2) s += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      return s.split('\t')[0];
    } catch (e) { return ''; }
  }
  var PROFILE_EDITOR = '/account/profile.html?account=';
  function addProfilePicture() {
    var acct = profileAccount();
    var h1 = acct && d.querySelector('.UserProfile__banner h1');
    if (h1 && !h1.querySelector('.Userpic')) {
      var pic = el('div', { class: 'Userpic melek-userpic', role: 'img', 'aria-label': '@' + acct });
      pic.style.backgroundImage = 'url(/u/' + acct + '/avatar/large)';
      h1.insertBefore(pic, h1.firstChild);
    }
    if (h1 && acct === savedUser() && !d.querySelector('.melek-change-pic')) {
      var a = el('a', { href: PROFILE_EDITOR + acct, class: 'melek-change-pic',
        style: 'display:inline-block;font-size:13px;margin:0 0 6px;color:inherit;text-decoration:underline' }, 'Change profile picture');
      h1.parentNode.insertBefore(a, h1.nextSibling);
    }
    // Settings: "To update your public profile, visit wallet.melek.salon" pointed at a wallet page with no
    // profile editor. Point it at the profile-picture editor.
    var links = d.querySelectorAll('.Settings a[href*="/settings"]');
    for (var i = 0; i < links.length; i++) {
      var m = links[i].getAttribute('href').match(/\/@([a-z0-9.-]+)\/settings/i);
      if (m && /wallet/i.test(links[i].textContent || '')) {
        links[i].href = PROFILE_EDITOR + m[1].toLowerCase();
        links[i].textContent = 'your profile picture page';
      }
    }
  }

  // Follow while signed out: the app's old login pop-up crashes (login moved to /login.html), so the click
  // did nothing. Signed out, Follow now goes to Log in and comes back to this profile.
  function signedOut() { return !!d.querySelector('header a[href="/login.html"]'); }
  d.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('label.button, button, a') : null;
    if (!t || !signedOut()) return;
    if (!/^(un)?follow$/i.test((t.textContent || '').trim())) return;
    e.preventDefault(); e.stopPropagation();
    w.location.href = '/login.html?return=' + encodeURIComponent(w.location.pathname);
  }, true);

  // ── 6. the tab bar: All Posts · Groups · Admin Updates · Witness Updates ─────────────────────────
  // Hot / Trending / New are not tabs: they are the sort row INSIDE All Posts (the Steemit/Hive/Blurt feed,
  // kept as is). The header's own Hot/Trending/New links are hidden and replaced by the four tabs; on an
  // All Posts page the sort row appears above the feed.
  var TABS = [   // All Posts far left (easy to reach), then the hierarchy
    { id: 'all', label: 'All Posts', href: '/trending' },
    { id: 'admin', label: 'Admin Updates', href: '/' },   // the home page
    { id: 'witness', label: 'Witness Updates', href: '/witness-updates' },
    { id: 'ranked', label: 'Members', href: '/members' },
    { id: 'groups', label: 'Groups', href: 'https://pact.pentecaust.com/#groups' },
    { id: 'move', label: 'MELEK Move', href: 'https://move.melek.salon/' },
  ];
  var SORTS = [['hot', 'Hot'], ['trending', 'Trending'], ['created', 'New']];
  function feedRoute() {   // /hot, /trending/<tag>, /created … → { sort, tag }
    var m = w.location.pathname.match(/^\/(hot|trending|created|promoted|payout|muted)(?:\/([a-z0-9-]+))?\/?$/i);
    return m ? { sort: m[1].toLowerCase(), tag: m[2] || '' } : null;
  }
  function addTabs() {
    var links = d.querySelectorAll('header a, .Header a'), news = null;
    for (var i = 0; i < links.length; i++) if ((links[i].textContent || '').trim() === 'New') { news = links[i]; break; }
    var old = d.querySelector('.melek-groups-tab'); if (old) (old.parentNode.tagName === 'LI' ? old.parentNode : old).remove();
    if (news && !d.querySelector('.melek-tabs')) {
      var host = news.parentNode.tagName === 'LI' ? news.parentNode.parentNode : news.parentNode;   // the Hot/Trending/New list
      var bar = el('nav', { class: 'melek-tabs', 'aria-label': 'Sections',
        style: 'display:flex;gap:22px;align-items:center;justify-content:center;font-size:1.05em;white-space:nowrap;flex-wrap:nowrap' });
      TABS.forEach(function (t) {
        bar.appendChild(el('a', { href: t.href, 'data-tab': t.id, style: 'color:inherit;text-decoration:none;padding:20px 0 17px;border-bottom:3px solid transparent;white-space:nowrap' }, t.label));
      });
      host.style.display = 'none';
      host.parentNode.insertBefore(bar, host);
    }
    // phones: the condenser hides the header's middle on small screens, so the tabs also get their own
    // scrollable row under the header, shown only below 640px
    var header = d.querySelector('header');
    if (header && !d.querySelector('.melek-tabs-m')) {
      d.head.appendChild(el('style', {}, '.melek-tabs-m{display:none}@media (max-width:639px){.melek-tabs-m{display:flex}}'));
      var m = el('nav', { class: 'melek-tabs melek-tabs-m', 'aria-label': 'Sections',
        style: 'gap:14px;overflow-x:auto;white-space:nowrap;padding:0 12px;background:#fff;border-bottom:1px solid #e5e7eb;font:14px system-ui,sans-serif' });
      TABS.forEach(function (t) {
        m.appendChild(el('a', { href: t.href, 'data-tab': t.id, style: 'color:#1a1d24;text-decoration:none;padding:10px 0 8px;border-bottom:3px solid transparent;white-space:nowrap' }, t.label));
      });
      header.parentNode.insertBefore(m, header.nextSibling);
    }
    // the condenser's header is fixed, so the row sits in flow under it: shift it into the strip the header covers
    var mbar = d.querySelector('.melek-tabs-m');
    if (mbar && header) {
      var fixed = /fixed|sticky|absolute/.test(w.getComputedStyle(header).position);
      mbar.style.position = 'relative'; mbar.style.zIndex = '5';
      mbar.style.top = fixed ? header.offsetHeight + 'px' : '0';
    }
    var on = feedRoute() ? 'all' : '';
    var tabs = d.querySelectorAll('.melek-tabs a');
    for (var j = 0; j < tabs.length; j++) {
      var active = tabs[j].getAttribute('data-tab') === on;
      tabs[j].style.borderBottomColor = active ? '#f5a623' : 'transparent';
      tabs[j].style.fontWeight = active ? '700' : '';
      if (active) tabs[j].setAttribute('aria-current', 'page'); else tabs[j].removeAttribute('aria-current');
    }
    addSortRow();
  }
  function addSortRow() {
    var r = feedRoute(), row = d.querySelector('.melek-sorts');
    if (!r) { if (row) row.remove(); return; }
    var feed = d.querySelector('.PostsIndex__left, .PostsList, #posts_list, main');
    if (!feed) return;
    if (!row) {
      row = el('div', { class: 'melek-sorts', role: 'tablist', 'aria-label': 'Sort all posts',
        style: 'display:flex;gap:8px;margin:0 0 12px;font:14px system-ui,sans-serif' });
      feed.parentNode.insertBefore(row, feed);
    }
    var want = SORTS.map(function (s) { return s[0] + ':' + (r.tag || ''); }).join('|') + '#' + r.sort;
    if (row.getAttribute('data-k') === want) return;
    row.setAttribute('data-k', want); row.textContent = '';
    SORTS.forEach(function (s) {
      var cur = s[0] === r.sort;
      row.appendChild(el('a', { href: '/' + s[0] + (r.tag ? '/' + r.tag : ''), role: 'tab', 'aria-selected': cur ? 'true' : 'false',
        style: 'padding:5px 14px;border-radius:999px;text-decoration:none;border:1px solid ' + (cur ? '#1a1d24;background:#1a1d24;color:#fff' : '#ccc;color:inherit') }, s[1]));
    });
  }


  // ── 8. required Category on the post editor ─────────────────────────────────────────────────────
  // Every post picks one category, forum/Reddit-style. The choice becomes the post's FIRST tag, which the
  // chain stores as its category; free tags follow it. Post is blocked until a category is chosen.
  var CATEGORIES = [
    ['melek', 'MELEK & Witnesses'], ['photography', 'Photos'], ['nature', 'Nature & Plants'], ['art', 'Art & Design'],
    ['crypto', 'Crypto & Web3'], ['ai', 'AI & Tech'], ['history', 'History & Mysticism'], ['life', 'Life & Blogs'],
    ['music', 'Music & Video'], ['games', 'Games'], ['food', 'Food & Cooking'], ['travel', 'Travel & Places'],
    ['writing', 'Writing'], ['introduceyourself', 'Introductions'], ['nsfw', 'NSFW (adults only)'],
  ];
  var CAT_SLUGS = CATEGORIES.map(function (c) { return c[0]; });
  function setReactValue(input, v) {
    var setter = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function tagsOf(input) { return (input.value || '').trim().split(/[\s,]+/).filter(Boolean); }
  function addCategoryPicker() {
    if (!/\/submit(\.html)?\/?$/.test(w.location.pathname)) return;
    var tags = d.querySelector('.SubmitPost input[name="category"], .ReplyEditor input[name="category"]');
    if (!tags || d.getElementById('melek-category')) return;
    var wrap = el('div', { id: 'melek-category-wrap', style: 'margin:8px 0 6px;font:14px system-ui,sans-serif' });
    var label = el('label', { for: 'melek-category', style: 'display:block;font-weight:700;margin-bottom:4px' }, 'Category (required)');
    var sel = el('select', { id: 'melek-category', required: '', style: 'width:100%;max-width:420px;padding:6px' });
    sel.appendChild(el('option', { value: '' }, 'Choose a category…'));
    CATEGORIES.forEach(function (c) { sel.appendChild(el('option', { value: c[0] }, c[1])); });
    var note = el('div', { id: 'melek-category-note', role: 'status', style: 'font-size:12px;color:#666;margin-top:4px' },
      'Your category becomes your first tag. Add up to four more tags below.');
    var first = tagsOf(tags)[0];
    if (first && CAT_SLUGS.indexOf(first) >= 0) sel.value = first;
    sel.onchange = function () {
      var rest = tagsOf(tags).filter(function (t) { return CAT_SLUGS.indexOf(t) < 0; });
      setReactValue(tags, [sel.value].concat(rest).filter(Boolean).slice(0, 5).join(' '));
      note.style.color = '#666';
      note.textContent = sel.value === 'nsfw' ? 'NSFW posts show behind a warning that people click to reveal, and anyone can hide them in Settings.' : 'Your category becomes your first tag. Add up to four more tags below.';
    };
    wrap.appendChild(label); wrap.appendChild(sel); wrap.appendChild(note);
    tags.parentNode.insertBefore(wrap, tags);
  }
  // block Post until a category is chosen (capture phase, before the app's own handler)
  function categoryGuard(e) {
    if (!/\/submit(\.html)?\/?$/.test(w.location.pathname)) return;
    var t = e.target && e.target.closest ? e.target.closest('button[type="submit"], form') : null;
    if (!t) return;
    if (e.type === 'click' && !/^post$/i.test((t.textContent || '').trim())) return;
    var sel = d.getElementById('melek-category'), tags = d.querySelector('.SubmitPost input[name="category"]');
    if (!sel || !tags) return;
    var first = tagsOf(tags)[0];
    if (sel.value && first === sel.value) return;
    if (!sel.value && first && CAT_SLUGS.indexOf(first) >= 0) { sel.value = first; return; }
    e.preventDefault(); e.stopPropagation();
    if (sel.value) sel.onchange();
    var note = d.getElementById('melek-category-note');
    if (note) { note.style.color = '#b42318'; note.textContent = sel.value ? 'Category added as your first tag. Press Post again.' : 'Choose a category before posting.'; }
    sel.focus();
  }
  d.addEventListener('click', categoryGuard, true);
  d.addEventListener('submit', categoryGuard, true);

  function routeChanged() {
    if (homeIsAdminUpdates()) return;
    addTabs();
    var col = d.getElementById('melek-tools');
    if (col && !/\/submit(\.html)?\/?$/.test(w.location.pathname)) col.remove();
    addReportButton();
    addCreationTools();
    addCategoryPicker();
    fixMessageLinks();
    addInviteButton();
    fixRewardsLinks();
    addProfilePicture();
    addHeadingAnchors();
  }

  // ── 7. the home page IS Admin Updates ─────────────────────────────────────────────────────────────
  // The web server serves the Admin Updates page at "/". When the condenser itself lands on "/" (the logo
  // link inside the app), reload so the server answers. A loop guard falls back to /admin if "/" ever
  // comes back as the condenser.
  function homeIsAdminUpdates() {
    if (w.location.pathname !== '/') return false;
    var k = 'melek-home-reload', last = Number(store(k) || 0), now = Date.now();
    if (now - last < 5000) { w.location.replace('/admin'); return true; }
    store(k, String(now));
    w.location.replace('/');
    return true;
  }

  function start() {
    if (homeIsAdminUpdates()) return;
    cookieNotice();
    routeChanged();
    // the condenser is a single-page app: re-check when the page content changes (navigation)
    var t = null;
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(routeChanged, 150); })
      .observe(d.body, { childList: true, subtree: true });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})();
