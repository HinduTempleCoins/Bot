// melek-wallet-extras.js — served at https://melek.salon/melek-wallet-extras.js and loaded by the wallet's page
// shell (wallet.melek.salon). Framework-free.
//
// No dollar values. MELEK, PRANA and the rest have no USD or BTC market yet, so a "$" figure would misstate
// what they are worth. The wallet computes dollar estimates from the witnesses' internal price feed; this
// removes them:
//   • the "Estimated Account Value … $166.50 (1 MELEK = $0.00082792)" row is hidden
//   • "Estimated curation rewards last week: 387.832 BP · $0.32" keeps the token amount and drops the "$"
// Token amounts (MELEK, MP, MBD) are left exactly as the chain reports them.
(function () {
  'use strict';
  var d = document, w = window;
  var DOLLARS = /\s*·?\s*\$\s?[\d,]*\.?\d*/g;

  function scrub() {
    // 1. hide whole "Estimated Account Value" rows
    var rows = d.querySelectorAll('.UserWallet__balance');
    for (var i = 0; i < rows.length; i++) {
      if (/Estimated Account Value/i.test(rows[i].textContent || '')) rows[i].style.display = 'none';
    }
    // 2. strip any remaining "$…" figure from text, but leave a lone "$" span's neighbours intact
    var walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    var hits = [];
    while (walker.nextNode()) if ((walker.currentNode.nodeValue || '').indexOf('$') >= 0) hits.push(walker.currentNode);
    hits.forEach(function (n) {
      var el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE)$/.test(el.tagName)) return;
      if (el.closest && el.closest('.UserWallet__balance, .UserReward__row, .Tooltip, .PostSummary__footer, .Voting')) {
        if (/^\s*\$\s*$/.test(n.nodeValue)) {
          // "$" in its own span: drop it, the number after it, and the " · " before it
          var next = el.nextSibling || (el.parentNode && el.parentNode.nextSibling);
          el.textContent = '';
          if (next && next.nodeType === 3) next.nodeValue = next.nodeValue.replace(/^[\d,]*\.?\d*/, '');
          var prev = el.previousSibling;
          if (prev && prev.nodeType === 3) prev.nodeValue = prev.nodeValue.replace(/\s*·\s*$/, '');
        } else {
          n.nodeValue = n.nodeValue.replace(DOLLARS, '');
        }
      }
    });
    // 3. a rewards line no longer ends in a dangling " · " where the dollar figure was
    var sums = d.querySelectorAll('.UserWallet__rewards-summary, .UserReward__row');
    for (var k = 0; k < sums.length; k++) {
      var tw = d.createTreeWalker(sums[k], NodeFilter.SHOW_TEXT), last = null;
      while (tw.nextNode()) if ((tw.currentNode.nodeValue || '').trim()) last = tw.currentNode;
      if (last && /·\s*$/.test(last.nodeValue)) last.nodeValue = last.nodeValue.replace(/\s*·\s*$/, '');
    }
  }

  // The profile header's Message button showed "missing translation: en.g.send_a_pm", and its picture came
  // from Blurt's image proxy (a blank silhouette for MELEK accounts). Label it, and use MELEK's own picture.
  function fixHeader() {
    var btns = d.querySelectorAll('a.button[href^="https://pentecaust.com/?dm="]');
    for (var i = 0; i < btns.length; i++) {
      if (/missing translation/i.test(btns[i].textContent || '')) btns[i].textContent = 'Message';
    }
    var pics = d.querySelectorAll('.Userpic[style*="imgp.blurt.blog/profileimage/"]');
    for (var j = 0; j < pics.length; j++) {
      var m = pics[j].style.backgroundImage.match(/profileimage\/([a-z0-9.-]+)\//i);
      if (m) pics[j].style.backgroundImage = 'url("https://melek.salon/u/' + m[1].toLowerCase() + '/avatar/small")';
    }
  }

  // The wallet is a Blurt fork, and its labels still say BP / Blurt Power. On MELEK it is MELEK Power (MP).
  var BLURT_WORDS = [[/\bBlurt Power\b/g, 'MELEK Power'], [/\bBLURT POWER\b/g, 'MELEK POWER'], [/(\d|\s)BP\b/g, '$1MP']];
  function relabel() {
    var walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var n = walker.currentNode, v = n.nodeValue || '';
      if (!/BP|Blurt Power|BLURT POWER/.test(v)) continue;
      var el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE|TEXTAREA|INPUT|CODE|PRE)$/.test(el.tagName)) continue;
      var out = v;
      BLURT_WORDS.forEach(function (r) { out = out.replace(r[0], r[1]); });
      if (out !== v) n.nodeValue = out;
    }
  }

  // ── Automation tab: beside Balances / Delegations. The wallet's security policy allows no outside frames,
  // so each tool is a card that opens it, signed in through MELEK-Signer with this account filled in.
  var WIKI = 'https://wiki.soapbox.community/wiki/';
  var SIGNER = 'https://signer.melek.salon';
  function el(tag, attrs, text) {
    var e = d.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function q(page, what) {
    return el('a', { href: WIKI + page, target: '_blank', rel: 'noopener', title: 'Help: ' + what, 'aria-label': 'Help: ' + what,
      style: 'display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#eab308;color:#171f24;font:700 12px/1 system-ui,sans-serif;text-decoration:none;margin-left:6px;vertical-align:middle' }, '?');
  }
  function walletAccount() { var m = w.location.pathname.match(/^\/@([a-z0-9.-]+)/); return m ? m[1] : ''; }
  function rpc(method, params) {
    return fetch('https://melek.salon/rpc', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }) })
      .then(function (r) { return r.json(); }).then(function (j) { return j && j.result; }).catch(function () { return null; });
  }
  var TOOLS = [
    { id: 'connect', title: 'Connect everything: MELEK-Signer + PRANA wallet', help: ['Signing_In_to_Post_on_MELEK', 'MELEK-Signer'],
      text: 'Sign in once with MELEK-Signer to use every MELEK tool without typing your keys again. Anything with tokens (MELEK-Engine, KulaSwap, the KULA fund) also uses your PRANA wallet, which MELEK-Signer keeps connected to this account.',
      open: function (a) { return SIGNER + '/login?account=' + encodeURIComponent(a); }, label: 'Sign in with MELEK-Signer' },
    { id: 'autovote', title: 'Simple vote automation', help: ['Curation_Trails_and_Auto-Voting', 'vote automation'],
      text: 'Vote automatically for the authors you choose, at the strength and timing you set. Your votes are cast through MELEK-Signer; nobody holds your keys.',
      open: function () { return 'https://auto.melek.salon/'; }, label: 'Open Auto-Vote' },
    { id: 'autoclaim', title: 'Auto-claim rewards', help: ['Post_Rewards_on_MELEK#claiming', 'claiming rewards'],
      text: 'Rewards from posts and votes wait until they are claimed, and only count toward your MELEK Power once they are. Sign in to Auto-Vote and allow auto-claim on the MELEK-Signer screen; your rewards are then claimed for you every six hours.',
      open: function () { return 'https://auto.melek.salon/melek-signer/login'; }, label: 'Turn on auto-claim' },
    { id: 'trails', title: 'Curation trails', help: ['Curation_Trails_and_Auto-Voting', 'curation trails'],
      text: 'Follow another curator: when they vote, you vote too, at your own strength. Set it up in Auto-Vote under trails.',
      open: function () { return 'https://auto.melek.salon/#trail'; }, label: 'Set up a trail' },
    { id: 'kula', title: 'KULA Community Fund', help: ['KULA_Community_Fund', 'the KULA fund'],
      text: 'A community fund: delegate MELEK Power or deposit MELEK into @kula. The pooled power curates for members, who are paid back mostly in KULA-program tokens and airdrops, plus a small MELEK reward.',
      open: function () { return 'https://melek.salon/kula'; }, label: 'Open the fund', status: kulaStatus },
    { id: 'tokens', title: 'Tokens and trading', help: ['MELEK-Engine', 'MELEK-Engine'],
      text: 'MELEK-Engine tokens, mining APIS, and trading on KulaSwap, the DEX on PRANA. Trading bots for automating your account are being tested on KulaSwap now.',
      open: function () { return 'https://engine.melek.salon/'; }, label: 'Open MELEK-Engine' },
  ];
  function kulaStatus(a, out) {
    rpc('condenser_api.get_vesting_delegations', [a, '', 100]).then(function (rows) {
      var mine = (rows || []).filter(function (r) { return r.delegatee === 'kula'; })[0];
      out.textContent = mine ? ('@' + a + ' delegates ' + mine.vesting_shares + ' to @kula.') : ('@' + a + ' is not delegating to @kula yet.');
    });
  }
  function automationPanel(a) {
    var box = el('div', { id: 'melek-automation', class: 'row', style: 'display:block;margin:12px 0' });
    var col = el('div', { class: 'column small-12' });
    var h = el('h4', { style: 'margin:0 0 4px' }, 'Automation');
    h.appendChild(q('Curation_Trails_and_Auto-Voting', 'automating your account'));
    col.appendChild(h);
    col.appendChild(el('p', { style: 'opacity:.8;margin:0 0 10px' }, 'Tools that act for @' + a + ' while you are away. Each one signs through MELEK-Signer, so your keys stay yours.'));
    TOOLS.forEach(function (t) {
      var c = el('div', { style: 'border:1px solid rgba(127,127,127,.35);border-radius:10px;padding:12px 14px;margin:0 0 10px' });
      var th = el('strong', { style: 'font-size:16px' }, t.title); c.appendChild(th); c.appendChild(q(t.help[0], t.help[1]));
      c.appendChild(el('p', { style: 'margin:6px 0' }, t.text));
      if (t.status) { var st = el('p', { style: 'margin:0 0 6px;opacity:.8;font-size:13px' }, 'Checking…'); c.appendChild(st); t.status(a, st); }
      c.appendChild(el('a', { href: t.open(a), target: '_blank', rel: 'noopener', class: 'button hollow', style: 'margin:0' }, t.label));
      col.appendChild(c);
    });
    var more = el('p', { style: 'margin:6px 0 0;font-size:14px' });
    [['MELEK data', 'https://data.soapbox.community/'], ['Akasha wallet', 'https://akasha.soapbox.community/'], ['KulaSwap', 'https://kula.money/'], ['Witness School', 'https://witness.melek.salon/']]
      .forEach(function (l, i) { if (i) more.appendChild(d.createTextNode(' · ')); more.appendChild(el('a', { href: l[1], target: '_blank', rel: 'noopener' }, l[0])); });
    col.appendChild(more);
    box.appendChild(col);
    return box;
  }
  function showAutomation(on) {
    var menu = d.querySelector('.WalletSubMenu'); if (!menu) return;
    var row = menu.closest('.row'); if (!row) return;
    var sib = row.nextElementSibling;
    for (; sib; sib = sib.nextElementSibling) if (sib.id !== 'melek-automation') sib.style.display = on ? 'none' : '';
    var panel = d.getElementById('melek-automation');
    if (on && !panel) row.parentNode.insertBefore(automationPanel(walletAccount()), row.nextSibling);
    if (!on && panel) panel.remove();
    var tab = d.getElementById('melek-automation-tab');
    if (tab) tab.classList.toggle('active', !!on);
  }
  // Unclaimed rewards: author and curation rewards wait in a "to be claimed" balance until the owner redeems
  // them, and until then they add nothing to MELEK Power (so the account's votes stay weightless). Say so,
  // on the wallet, with the amount read from the chain.
  var claimChecked = '';
  function addUnclaimedNotice() {
    var a = walletAccount(), menu = d.querySelector('.WalletSubMenu');
    if (!a || !menu || claimChecked === a || d.getElementById('melek-unclaimed')) return;
    claimChecked = a;
    rpc('condenser_api.get_accounts', [[a]]).then(function (rows) {
      var acct = rows && rows[0]; if (!acct || d.getElementById('melek-unclaimed')) return;
      var mp = parseFloat(String(acct.reward_vesting_steem || '0').split(' ')[0]) || 0;
      var liq = parseFloat(String(acct.reward_steem_balance || '0').split(' ')[0]) || 0;
      if (mp <= 0 && liq <= 0) return;
      var row = menu.closest('.row'); if (!row) return;
      var box = el('div', { id: 'melek-unclaimed', class: 'row', style: 'display:block;margin:10px 0' });
      var col = el('div', { class: 'column small-12', style: 'border:2px solid #eab308;border-radius:10px;padding:12px 14px' });
      var h = el('strong', { style: 'font-size:16px' }, '@' + a + ' has rewards waiting to be claimed: ' + mp.toFixed(3) + ' MELEK Power' + (liq > 0 ? ' and ' + liq.toFixed(3) + ' MELEK' : ''));
      col.appendChild(h); col.appendChild(q('Post_Rewards_on_MELEK#claiming', 'claiming rewards'));
      col.appendChild(el('p', { style: 'margin:6px 0 0' }, 'Rewards from posts and votes wait here until they are claimed, and until then they add nothing to MELEK Power, so votes count for very little. If this is your account, sign in and choose Redeem Rewards on the Balances tab; it adds everything to your MELEK Power at once. Auto-claim in the Automation tab can do it for you every day.'));
      box.appendChild(col);
      row.parentNode.insertBefore(box, row);
    });
  }

  function addAutomationTab() {
    if (!d.getElementById('melek-automation-css')) {   // the wallet adds an external-link icon to new-tab links
      var css = el('style', { id: 'melek-automation-css' });
      css.textContent = '#melek-automation a svg,#melek-automation a .Icon,#melek-automation a::after,#melek-unclaimed a svg,#melek-unclaimed a .Icon,#melek-unclaimed a::after{display:none!important;content:none!important}';
      d.head.appendChild(css);
    }
    var menu = d.querySelector('.WalletSubMenu');
    if (!menu || d.getElementById('melek-automation-tab') || !walletAccount()) return;
    var li = el('li', { id: 'melek-automation-tab' });
    var a = el('a', { href: '#automation' }, 'Automation');
    a.addEventListener('click', function (e) { e.preventDefault(); w.history.replaceState(null, '', '#automation'); showAutomation(true); });
    li.appendChild(a); menu.appendChild(li);
    var others = menu.querySelectorAll('a:not([href="#automation"])');
    for (var i = 0; i < others.length; i++) others[i].addEventListener('click', function () { showAutomation(false); });
    if (w.location.hash === '#automation') showAutomation(true);
  }

  // ── Pageviews: the wallet's CSP allows no inline script and no outside connect-src, but any image. So the
  // first-party, cookieless pageview goes as the collector's 1x1 GIF (path + referrer only; DNT honoured),
  // once per page, including the wallet's in-app navigations.
  var lastPv = '';
  function pageview() {
    try {
      if (navigator.doNotTrack == '1' || w.doNotTrack == '1' || navigator.msDoNotTrack == '1') return;
      var p = w.location.pathname;
      if (p === lastPv) return;
      var r = lastPv ? '' : (d.referrer || '');
      lastPv = p;
      new Image(1, 1).src = 'https://analytics.soapbox.community/px.gif?p=' + encodeURIComponent(p) + '&r=' + encodeURIComponent(r);
    } catch (e) { /* never break the wallet */ }
  }

  function start() {
    pageview();
    fixHeader();
    scrub();
    relabel();
    addAutomationTab();
    addUnclaimedNotice();
    var t = null;   // the wallet is a single-page app: re-run when its content changes
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { pageview(); scrub(); fixHeader(); relabel(); addAutomationTab(); addUnclaimedNotice(); }, 150); })
      .observe(d.body, { childList: true, subtree: true, characterData: true });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})();
