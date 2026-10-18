// melek-wallet-extras.js — served at https://melek.salon/melek-wallet-extras.js and loaded by the wallet's page
// shell (wallet.melek.salon). Framework-free.
//
// No dollar values. MELEK, PRANA and the rest have no USD or BTC market yet, so a "$" figure would misstate
// what they are worth. The wallet computes dollar estimates from the witnesses' internal price feed; this
// removes them:
//   • the "Estimated Account Value … $166.50 (1 MELEK = $0.00082792)" row is hidden
//   • "Estimated curation rewards last week: 387.832 BP · $0.32" keeps the token amount and drops the "$"
// Token amounts (MELEK, BP, MBD) are left exactly as the chain reports them.
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

  function start() {
    scrub();
    var t = null;   // the wallet is a single-page app: re-run when its content changes
    new MutationObserver(function () { clearTimeout(t); t = setTimeout(scrub, 150); })
      .observe(d.body, { childList: true, subtree: true, characterData: true });
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})();
