/* idle-kit.js — the shared, vendored-locally retention kit for Idle-Time Games.
 *
 * Pure client-side, ZERO dependencies, ZERO network. Every idle game in this surface (Cinder Foundry,
 * Kindling, Tap Temple, Star Harvest, Deep Delve, Ledger Legends…) is mostly *content + theme* over this
 * one engine. It implements the reusable idle mechanics from .local/IDLE_GAME_LIBRARY.md Part A:
 *
 *   • format(n)            — big-number formatter (K / M / B / T / Qa… then scientific).
 *   • cost(base,n,r)       — exponential cost curve  base · r^n  (r≈1.15).
 *   • save/load            — try/catch-guarded localStorage (soft-fail: never throws).
 *   • awaySeconds(...)     — offline accrual elapsed, clamped to a generous cap.
 *   • streakUpdate(...)    — daily-login streak counter (local-midnight day diff, loss-aversion).
 *   • prestigeGain(...)    — prestige/ascension reward from lifetime earnings.
 *   • checkAchievements()  — milestone checklist; returns newly-unlocked badges.
 *   • mount(el,cfg)        — a full generator-based idle game (click → buy → idle → prestige) incl. the
 *                            "while you were away — collect X" screen + streak + achievements + prestige.
 *
 * Everything is defensive: a missing element, blocked storage, or a private window degrades to a still-
 * playable game, never an exception. No `</`+`script>` sequence appears here, so the file inlines safely.
 */
(function (root) {
  'use strict';

  // ── big-number formatting ──────────────────────────────────────────────────────────────────────────
  var SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  function format(n) {
    n = Number(n) || 0;
    var neg = n < 0; if (neg) n = -n;
    var out;
    if (n < 1000) { out = (n < 10 && n % 1 !== 0) ? n.toFixed(1) : String(Math.floor(n)); }
    else {
      var i = 0;
      while (n >= 1000 && i < SUFFIX.length - 1) { n /= 1000; i++; }
      if (n >= 1000) { out = n.toExponential(2); }               // past the named suffixes → scientific
      else { out = (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0)) + SUFFIX[i]; }
    }
    return neg ? '-' + out : out;
  }

  // ── exponential cost curve:  base · r^count  (the core compulsion loop) ──────────────────────────────
  function cost(base, count, ratio) {
    ratio = ratio || 1.15;
    return Math.ceil((Number(base) || 0) * Math.pow(ratio, Math.max(0, count | 0)));
  }

  // ── guarded persistence — soft-fail, never throw (private windows / blocked storage return safely) ────
  function save(key, obj) {
    try { localStorage.setItem(key, JSON.stringify(obj)); return true; } catch (e) { return false; }
  }
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback == null ? null : fallback;
      var v = JSON.parse(raw);
      return (v && typeof v === 'object') ? v : (fallback == null ? null : fallback);
    } catch (e) { return fallback == null ? null : fallback; }
  }

  function now() { return Date.now(); }

  // ── offline / away accrual — elapsed seconds since lastTs, clamped to a generous cap (hours) ──────────
  function awaySeconds(lastTs, capHours) {
    lastTs = Number(lastTs) || Date.now();
    var cap = (Number(capHours) || 8) * 3600;
    var elapsed = (Date.now() - lastTs) / 1000;
    if (!(elapsed > 0)) elapsed = 0;
    var capped = Math.min(cap, elapsed);
    return { seconds: capped, wasCapped: elapsed > cap, rawSeconds: elapsed };
  }

  // local-midnight day stamp (YYYY-MM-DD in the player's own timezone) ──────────────────────────────────
  function dayStamp(ts) {
    var d = ts ? new Date(ts) : new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function daysBetween(a, b) { // whole calendar days between two day-stamps
    var pa = String(a || '').split('-').map(Number), pb = String(b || '').split('-').map(Number);
    if (pa.length !== 3 || pb.length !== 3) return 999;
    var ua = Date.UTC(pa[0], pa[1] - 1, pa[2]), ub = Date.UTC(pb[0], pb[1] - 1, pb[2]);
    return Math.round((ub - ua) / 86400000);
  }

  // ── daily-login streak — mutates {streak,lastDay}; returns {streak,isNewDay,broke} ───────────────────
  // The stickiest cheap mechanic (Part A3): consecutive days grow it; a skipped day resets to 1.
  function streakUpdate(state) {
    state = state || {};
    var today = dayStamp();
    var prev = state.lastDay || null;
    var result = { streak: state.streak || 0, isNewDay: false, broke: false };
    if (prev === today) { result.streak = state.streak || 1; return result; }   // already counted today
    var gap = prev ? daysBetween(prev, today) : 1;
    if (!prev || gap <= 0) { result.streak = state.streak || 1; }
    else if (gap === 1) { result.streak = (state.streak || 0) + 1; }             // consecutive → grow
    else { result.streak = 1; result.broke = (state.streak || 0) > 1; }          // missed a day → reset
    result.isNewDay = true;
    state.streak = result.streak; state.lastDay = today;
    return result;
  }
  function streakMult(days) { return 1 + Math.min(0.5, (Math.max(0, days) - 1) * 0.05); } // +5%/day, cap +50%

  // ── prestige / ascension — permanent meta-currency from lifetime earnings (Part A1/A4) ───────────────
  function prestigeGain(lifetimeEarned, threshold) {
    threshold = threshold || 1e6;
    if ((Number(lifetimeEarned) || 0) < threshold) return 0;
    return Math.floor(Math.sqrt(lifetimeEarned / threshold));
  }

  // ── achievements / milestones — evaluate a checklist; return the newly-unlocked ones ─────────────────
  // defs: [{id,name,emoji,desc,test(state)->bool}]. store: an object map id->true kept in the save blob.
  function checkAchievements(defs, state, store) {
    var freshly = [];
    if (!defs || !defs.length) return freshly;
    store = store || {};
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      if (store[d.id]) continue;
      var ok = false;
      try { ok = !!d.test(state); } catch (e) { ok = false; }
      if (ok) { store[d.id] = true; freshly.push(d); }
    }
    return freshly;
  }

  // ── small DOM helper (kit-local; the games' own pages esc() all server-side text) ────────────────────
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── mount(): a complete generator-idle game from a config object ──────────────────────────────────────
  // Themes (Kindling, Tap Temple, Star Harvest, Deep Delve) are this engine + content. Cinder Foundry and
  // Ledger Legends drive the helpers above directly for their bespoke shells.
  //
  // cfg = {
  //   key, resource:{name,emoji}, click:{label,power,verb}|null,
  //   generators:[{id,name,emoji,rate,base,desc}], capHours,
  //   prestige:{name,emoji,unit,at,mult(pts),blurb}|null,
  //   achievements:[{id,name,emoji,desc,test}], streak:true|false,
  //   meter:{label, value(state)->n, fmt(n)->str}|null,   // an extra derived stat (e.g. Depth)
  //   log:{ line(state,dt)->str|null }|null               // optional scrolling flavor log
  // }
  function mount(rootEl, cfg) {
    if (!rootEl || !cfg) return null;
    var GENS = cfg.generators || [];
    var CAP = cfg.capHours || 8;
    var PRESTIGE = cfg.prestige || null;

    var fresh = { res: 0, lifetime: 0, owned: {}, prestige: 0, ach: {}, streak: 0, lastDay: null, ts: Date.now() };
    GENS.forEach(function (g) { fresh.owned[g.id] = 0; });
    var s = load(cfg.key, null) || fresh;
    // normalize (defensive against partial/old saves)
    s.res = Number(s.res) || 0; s.lifetime = Number(s.lifetime) || 0;
    s.prestige = Number(s.prestige) || 0; s.streak = Number(s.streak) || 0;
    s.owned = s.owned && typeof s.owned === 'object' ? s.owned : {};
    s.ach = s.ach && typeof s.ach === 'object' ? s.ach : {};
    GENS.forEach(function (g) { s.owned[g.id] = Number(s.owned[g.id]) || 0; });
    if (s.ts == null) s.ts = Date.now();

    function pmult() { return PRESTIGE ? (PRESTIGE.mult ? PRESTIGE.mult(s.prestige) : 1 + s.prestige * 0.1) : 1; }
    function smult() { return cfg.streak ? streakMult(s.streak) : 1; }
    function rate() {
      var r = 0; GENS.forEach(function (g) { r += g.rate * (s.owned[g.id] || 0); });
      return r * pmult() * smult();
    }
    function gcost(g) { return cost(g.base, s.owned[g.id] || 0); }
    function gain(amount) { s.res += amount; s.lifetime += amount; }

    // ── build the shell ────────────────────────────────────────────────────────────────────────────────
    rootEl.innerHTML = '';
    var away = el('div', 'away'); away.style.display = 'none'; rootEl.appendChild(away);

    var wrap = el('div', 'foundry');
    var left = el('div', 'anvil');
    var rname = (cfg.resource && cfg.resource.name) || 'Resource';
    var remo = (cfg.resource && cfg.resource.emoji) || '✦';
    left.appendChild(el('div', 'count', '0')); var countEl = left.lastChild; countEl.id = '';
    var rateEl = el('div', 'rate', '0.0 / sec'); left.appendChild(rateEl);
    var metaEl = el('div', 'hint', ''); left.appendChild(metaEl);
    var clickBtn = null;
    if (cfg.click) {
      clickBtn = el('button', 'strike', remo); clickBtn.title = cfg.click.label || 'Tap';
      left.appendChild(clickBtn);
      left.appendChild(el('div', 'hint', 'Tap for <b>' + esc(String(cfg.click.power || 1)) + '</b> ' + esc(rname) + '.'));
    }
    var streakEl = null, meterEl = null;
    if (cfg.streak) { streakEl = el('div', 'hint', ''); left.appendChild(streakEl); }
    if (cfg.meter) { meterEl = el('div', 'hint', ''); left.appendChild(meterEl); }
    wrap.appendChild(left);

    var shop = el('div', 'shop'); wrap.appendChild(shop);
    rootEl.appendChild(wrap);

    var logBox = null;
    if (cfg.log) { logBox = el('div', 'idlelog'); rootEl.appendChild(logBox); }

    // prestige control
    var prestigeWrap = null, prestigeBtn = null, prestigeInfo = null;
    if (PRESTIGE) {
      prestigeWrap = el('div', 'prestige');
      prestigeInfo = el('div', 'hint', '');
      prestigeBtn = el('button', 'btn', '');
      prestigeBtn.addEventListener('click', doPrestige);
      prestigeWrap.appendChild(prestigeInfo); prestigeWrap.appendChild(prestigeBtn);
      rootEl.appendChild(prestigeWrap);
    }

    // achievements strip
    var achWrap = null;
    if (cfg.achievements && cfg.achievements.length) {
      achWrap = el('div', 'achs'); rootEl.appendChild(achWrap);
    }

    // ── shop render ──────────────────────────────────────────────────────────────────────────────────
    function renderShop() {
      shop.innerHTML = '';
      GENS.forEach(function (g) {
        var c = gcost(g), can = s.res >= c;
        var b = el('button', 'up');
        b.disabled = !can;
        b.innerHTML = '<span class=ue>' + esc(g.emoji || '⚙') + '</span>'
          + '<span><span class=un>' + esc(g.name) + ' <small class=muted>x' + (s.owned[g.id] || 0) + '</small></span>'
          + '<span class=ud>' + esc(g.desc || ('+' + g.rate + '/sec each')) + '</span></span>'
          + '<span class=uc><b>' + format(c) + '</b><small>' + esc(rname) + '</small></span>';
        b.addEventListener('click', function () {
          var cc = gcost(g);
          if (s.res >= cc) { s.res -= cc; s.owned[g.id] = (s.owned[g.id] || 0) + 1; draw(); persist(); }
        });
        shop.appendChild(b);
      });
    }

    function renderAch() {
      if (!achWrap) return;
      achWrap.innerHTML = '<div class=achs-h>Milestones</div>';
      cfg.achievements.forEach(function (a) {
        var got = !!s.ach[a.id];
        var chip = el('span', 'ach' + (got ? ' got' : ''),
          esc(a.emoji || '★') + ' ' + esc(a.name));
        chip.title = (got ? '' : 'Locked — ') + esc(a.desc || a.name);
        achWrap.appendChild(chip);
      });
    }

    function renderPrestige() {
      if (!PRESTIGE) return;
      var pending = prestigeGain(s.lifetime, PRESTIGE.at);
      prestigeInfo.innerHTML = esc(PRESTIGE.emoji || '💎') + ' <b>' + format(s.prestige) + '</b> '
        + esc(PRESTIGE.unit || 'prestige') + ' — global ×' + pmult().toFixed(2)
        + (PRESTIGE.blurb ? '<br><small class=muted>' + esc(PRESTIGE.blurb) + '</small>' : '');
      prestigeBtn.textContent = pending > 0
        ? ('Ascend for +' + format(pending) + ' ' + (PRESTIGE.unit || 'prestige'))
        : ('Reach ' + format(PRESTIGE.at) + ' lifetime to ascend');
      prestigeBtn.disabled = pending <= 0;
    }

    function doPrestige() {
      var pending = prestigeGain(s.lifetime, PRESTIGE.at);
      if (pending <= 0) return;
      var ok = false;
      try {
        ok = window.confirm('Ascend now? Your ' + rname + ' and buildings reset, but you gain +'
          + format(pending) + ' ' + (PRESTIGE.unit || 'prestige') + ' — a permanent global multiplier.');
      } catch (e) { ok = true; }
      if (!ok) return;
      s.prestige += pending; s.res = 0; s.lifetime = 0;
      GENS.forEach(function (g) { s.owned[g.id] = 0; });
      draw(); persist();
    }

    function pushLog(line) {
      if (!logBox || !line) return;
      var row = el('div', 'idlelog-line', esc(line));
      logBox.insertBefore(row, logBox.firstChild);
      while (logBox.children.length > 12) logBox.removeChild(logBox.lastChild);
    }

    // ── draw ─────────────────────────────────────────────────────────────────────────────────────────
    function draw() {
      countEl.textContent = format(s.res);
      countEl.setAttribute('title', rname);
      rateEl.textContent = format(rate()) + ' / sec';
      metaEl.innerHTML = '<b>' + format(s.res) + '</b> ' + esc(rname) + ' · lifetime <b>' + format(s.lifetime) + '</b>';
      if (streakEl) streakEl.innerHTML = '🔥 Daily streak: <b>' + format(s.streak) + '</b> day'
        + (s.streak === 1 ? '' : 's') + ' <small class=muted>(×' + smult().toFixed(2) + ' yield)</small>';
      if (meterEl && cfg.meter) {
        var mv = 0; try { mv = cfg.meter.value(s); } catch (e) { mv = 0; }
        meterEl.innerHTML = esc(cfg.meter.label) + ': <b>' + (cfg.meter.fmt ? cfg.meter.fmt(mv) : format(mv)) + '</b>';
      }
      renderShop(); renderAch(); renderPrestige();
    }

    function persist() { s.ts = Date.now(); save(cfg.key, s); }

    // ── daily streak on load ─────────────────────────────────────────────────────────────────────────
    if (cfg.streak) { var st = streakUpdate(s); if (st.isNewDay) pushLog('Daily streak: ' + s.streak + ' day' + (s.streak === 1 ? '' : 's') + '.'); }

    // ── offline / away accrual on load ───────────────────────────────────────────────────────────────
    var a = awaySeconds(s.ts, CAP);
    var earned = rate() * a.seconds;
    if (earned >= 1) {
      gain(earned);
      var mins = Math.floor(a.rawSeconds / 60), hh = Math.floor(mins / 60), mm = mins % 60;
      var dur = hh > 0 ? (hh + 'h ' + mm + 'm') : (mm + 'm');
      away.style.display = 'block';
      away.innerHTML = '👋 While you were away (' + esc(dur) + (a.wasCapped ? ', capped at ' + CAP + 'h' : '')
        + '), your ' + esc(rname) + ' grew by <b>' + format(earned) + '</b>. Welcome back!';
    }

    // ── achievements evaluated each tick (cheap) ─────────────────────────────────────────────────────
    function evalAch() {
      var fresh2 = checkAchievements(cfg.achievements || [], s, s.ach);
      fresh2.forEach(function (d) { pushLog('Milestone unlocked: ' + d.name + '.'); });
    }

    // ── input ────────────────────────────────────────────────────────────────────────────────────────
    if (clickBtn) clickBtn.addEventListener('click', function () {
      gain((cfg.click.power || 1) * pmult() * smult()); draw();
    });

    // ── tick loop ────────────────────────────────────────────────────────────────────────────────────
    var last = Date.now(), logAccum = 0;
    var timer = setInterval(function () {
      var t = Date.now(), dt = (t - last) / 1000; last = t;
      gain(rate() * dt);
      countEl.textContent = format(s.res);
      metaEl.innerHTML = '<b>' + format(s.res) + '</b> ' + esc(rname) + ' · lifetime <b>' + format(s.lifetime) + '</b>';
      if (meterEl && cfg.meter) {
        var mv = 0; try { mv = cfg.meter.value(s); } catch (e) { mv = 0; }
        meterEl.innerHTML = esc(cfg.meter.label) + ': <b>' + (cfg.meter.fmt ? cfg.meter.fmt(mv) : format(mv)) + '</b>';
      }
      // refresh affordability cheaply
      var kids = shop.children, i = 0;
      GENS.forEach(function (g) { var e2 = kids[i++]; if (e2) e2.disabled = s.res < gcost(g); });
      evalAch();
      // optional flavor log
      if (cfg.log && cfg.log.line) {
        logAccum += dt;
        if (logAccum >= 4) { logAccum = 0; var ln = null; try { ln = cfg.log.line(s, dt); } catch (e) {} if (ln) pushLog(ln); }
      }
    }, 100);

    var saver = setInterval(persist, 5000);
    document.addEventListener('visibilitychange', function () { if (document.hidden) persist(); });
    window.addEventListener('pagehide', persist);

    evalAch(); draw();
    return {
      state: s, draw: draw, save: persist,
      stop: function () { clearInterval(timer); clearInterval(saver); }
    };
  }

  root.IdleKit = {
    format: format, cost: cost, save: save, load: load, now: now,
    awaySeconds: awaySeconds, dayStamp: dayStamp, daysBetween: daysBetween,
    streakUpdate: streakUpdate, streakMult: streakMult,
    prestigeGain: prestigeGain, checkAchievements: checkAchievements,
    mount: mount
  };
})(typeof window !== 'undefined' ? window : this);
