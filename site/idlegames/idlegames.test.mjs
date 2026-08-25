// idlegames.test.mjs — OFFLINE tests for Idle-Time Games (drives `handler` with a mock req/res; no port
// bound, no network). Mirrors the assertion style of site/diagram/diagram.test.mjs. Verifies: the hub
// renders the game directory with ZERO up-front crypto pitch; each game path 200s with its canvas/UI;
// /health is ok JSON; robots/sitemap/sitemap-index/llms serve; a hostile <script> in an echoed share
// param is escaped; unknown path is a 404 (never a 500); the handler never throws on garbage; and the
// server module does no request-time network.

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, hubPage, esc, safeHref, GAMES, GAME_SLUGS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'idlegames.test', ...headers } }, res);
  return res;
}

test('hub 200 renders the game directory, "coffee break" framing', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /coffee break/i);
  // every game is listed as a card linking to its own path
  for (const g of GAMES) {
    assert.ok(res.body.includes(`href="/${g.slug}"`), `hub missing card link for ${g.slug}`);
    assert.ok(res.body.includes(esc(g.name)), `hub missing name ${g.name}`);
  }
});

test('the hub carries NO up-front crypto pitch', async () => {
  const body = (await get('/')).body;
  // the hub is pure play — none of these words appear anywhere on it
  // "no sign-up" is legitimate reassurance, not a pitch — the ban is the crypto/earn/account language.
  assert.ok(!/\b(crypto|token|blockchain|wallet|coins?|MELEK|earn|account)\b/i.test(body),
    'hub must not pitch crypto/earn/accounts up front');
});

test('at least four playable games are catalogued (idle clicker, snake, merge, minesweeper)', () => {
  assert.ok(GAME_SLUGS.includes('idle'));
  assert.ok(GAME_SLUGS.includes('snake'));
  assert.ok(GAME_SLUGS.includes('merge'));
  assert.ok(GAME_SLUGS.includes('mines'));
  assert.ok(GAMES.length >= 3);
});

test('idle clicker page 200s with its anvil + accrues-while-away framing', async () => {
  const res = await get('/idle');
  assert.equal(res.code, 200);
  assert.match(res.body, /Cinder Foundry/);
  assert.match(res.body, /id=strike/);            // the click target
  assert.match(res.body, /id=shop/);              // the upgrade shop
  assert.match(res.body, /while you were away|even while/i); // idle/offline-accrual is the genre
});

test('snake page 200s with a canvas playfield + score/best', async () => {
  const res = await get('/snake');
  assert.equal(res.code, 200);
  assert.match(res.body, /Glow Worm/);
  assert.match(res.body, /<canvas id=cv/);
  assert.match(res.body, /id=score/);
  assert.match(res.body, /id=best/);
  assert.match(res.body, /WASD/);
});

test('merge page 200s with a 4x4 board; merge logic is inline', async () => {
  const res = await get('/merge');
  assert.equal(res.code, 200);
  assert.match(res.body, /Nova Merge/);
  assert.match(res.body, /class=board id=board/);
  assert.match(res.body, /function collapse/);    // the merge routine is implemented in-page
  assert.match(res.body, /2048/);                 // the target tile named
});

test('minesweeper-style page 200s with a field + reveal/flag copy', async () => {
  const res = await get('/mines');
  assert.equal(res.code, 200);
  assert.match(res.body, /Signal Sweeper/);
  assert.match(res.body, /id=field/);
  assert.match(res.body, /flag/i);
  assert.match(res.body, /best/i);
});

test('every game path is reachable and self-contained (no external <script src>)', async () => {
  for (const slug of GAME_SLUGS) {
    const res = await get('/' + slug);
    assert.equal(res.code, 200, `${slug} should 200`);
    // all game code is inline; no external CDN script tag anywhere
    assert.ok(!/<script\s+src=/i.test(res.body), `${slug} must not load an external script`);
    assert.ok(!/https?:\/\/[^"']*\.js\b/i.test(res.body), `${slug} must not reference a remote .js`);
  }
});

test('the MELEK opt-in is understated + present on a game page (not on the hub)', async () => {
  const game = (await get('/snake')).body;
  assert.match(game, /Save your high score/i);        // the small affordance
  assert.match(game, /free MELEK account/i);           // revealed only inside the panel
  assert.match(game, /just for fun/i);                 // off-chain play is the default framing
  // the account/earn language must NOT bleed onto the hub
  const hub = (await get('/')).body;
  assert.ok(!/MELEK account/i.test(hub), 'account pitch must not appear on the hub');
});

// ── NEW idle-incrementals (idle-kit engine) ──────────────────────────────────────────────────────────
const NEW_IDLE = [
  ['kindling', 'Kindling', /Rekindle|smoulder|first idle/i],
  ['temple', 'Tap Temple', /acolytes|altar|offerings/i],
  ['ledger', 'Ledger Legends', /couriers|quest|renown/i],
  ['orchard', 'Star Harvest', /light-seeds|starlight|harvest/i],
  ['delve', 'Deep Delve', /drills|strata|ore|Depth/i],
];

test('each new idle-incremental has its own hub card + path', async () => {
  const hub = (await get('/')).body;
  for (const [slug, name] of NEW_IDLE) {
    assert.ok(GAME_SLUGS.includes(slug), `catalog missing ${slug}`);
    assert.ok(hub.includes(`href="/${slug}"`), `hub missing card link for ${slug}`);
    assert.ok(hub.includes(esc(name)), `hub missing name ${name}`);
  }
  // leading with idle games: the catalog carries at least six idle titles now
  assert.ok(GAMES.filter((g) => g.idle).length >= 6, 'the suite should lead with idle-incrementals');
});

test('each new idle game page 200s with its themed UI + the idle-kit engine', async () => {
  for (const [slug, name, marker] of NEW_IDLE) {
    const res = await get('/' + slug);
    assert.equal(res.code, 200, `${slug} should 200`);
    assert.match(res.body, new RegExp(esc(name)), `${slug} names itself`);
    assert.match(res.body, marker, `${slug} shows its themed copy`);
    // it drives the shared kit and mounts a game container
    assert.match(res.body, /window\.IdleKit/, `${slug} must use IdleKit`);
    assert.match(res.body, /K\.mount\(|IdleKit\.mount/, `${slug} must mount the idle engine`);
    assert.match(res.body, /id=game|id=shop/, `${slug} must render a game mount point`);
    // retention mechanics present: offline "while you were away" + prestige + streak wording somewhere in the kit
    assert.match(res.body, /while you were away/i, `${slug} must show the offline collect screen`);
    assert.match(res.body, /prestige|Ascend|Rekindle|Bloom|Retire|Collapse|Ascension/i, `${slug} must offer a prestige reset`);
  }
});

test('Cinder Foundry v2 gains exp-cost, prestige, achievements and offline cap (via idle-kit)', async () => {
  const res = await get('/idle');
  assert.equal(res.code, 200);
  assert.match(res.body, /window\.IdleKit/);           // uses the kit
  assert.match(res.body, /K\.cost\(|IdleKit\.cost/);   // exponential cost curve (kit helper)
  assert.match(res.body, /function cost/);             // kit defines the exp-cost helper (inlined)
  assert.match(res.body, /Emberstone/);                // prestige currency
  assert.match(res.body, /id=prestige-btn/);           // ascension control
  assert.match(res.body, /Milestones|id=achs/);        // achievements strip
  assert.match(res.body, /while you were away/i);      // offline collect screen
  assert.match(res.body, /Daily streak/i);             // streak
});

test('idle-kit.js is vendored locally + served from /www (no external dep)', async () => {
  const res = await get('/www/idle-kit.js');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.match(res.body, /IdleKit/);
  assert.match(res.body, /function format/);           // big-number formatter
  assert.match(res.body, /function cost/);             // exp cost helper
  assert.match(res.body, /awaySeconds/);               // offline accrual
  assert.match(res.body, /streakUpdate/);              // daily streak
  assert.match(res.body, /prestigeGain/);              // prestige scaffold
  assert.match(res.body, /checkAchievements/);         // achievements
  // it is self-contained: no remote script/URL, no bundler import
  assert.ok(!/https?:\/\/[^"'\s]*\.js\b/i.test(res.body), 'kit must not reference a remote .js');
  assert.ok(!/\bimport\s|\brequire\s*\(/.test(res.body), 'kit must be a plain vendored IIFE');
});

test('the new idle games carry NO up-front crypto pitch on the hub', async () => {
  const hub = (await get('/')).body;
  assert.ok(!/\b(crypto|token|blockchain|wallet|coins?|MELEK|earn|account)\b/i.test(hub),
    'expanded hub must still not pitch crypto/earn/accounts up front');
});

test('a hostile share param stays escaped on a new idle game page', async () => {
  const res = await get('/delve?by=' + encodeURIComponent('<script>alert(2)</script>') + '&s=42');
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(2)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(res.body, /beat their score of <b>42<\/b>/);
});

test('/health returns {"ok":true}', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  assert.match(robots.body, /User-agent/);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  assert.match(smi.body, /sitemapindex/);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Cinder Foundry|Glow Worm|Nova Merge/);
});

test('SITEMAP_PATHS covers the hub and every game', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  for (const slug of GAME_SLUGS) assert.ok(SITEMAP_PATHS.includes(`/${slug}`));
});

test('a hostile <script> in a share param is escaped (no raw payload)', async () => {
  const res = await get('/snake?by=' + encodeURIComponent('<script>alert(1)</script>') + '&s=99');
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);   // it is escaped instead
  // the score is coerced to digits only and echoed safely
  assert.match(res.body, /beat their score of <b>99<\/b>/);
});

test('a non-numeric share score is dropped (only digits are ever echoed as a score)', async () => {
  const res = await get('/merge?by=Alex&s=' + encodeURIComponent('<img src=x>'));
  assert.equal(res.code, 200);
  assert.ok(!/<img src=x>/.test(res.body), 'raw payload must not appear');
  assert.match(res.body, /Alex challenged you/);
});

test('esc() and safeHref() are sound', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
  assert.equal(safeHref(''), '');
});

test('unknown path → 404, never a 500; the echoed path is escaped', async () => {
  const res = await get('/does/not/exist');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/i);
  const hostile = await get('/' + encodeURIComponent('<script>x</script>'));
  assert.equal(hostile.code, 404);
  assert.ok(!hostile.body.includes('<script>x</script>'), 'the bogus path must be escaped in the 404');
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'idlegames.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('hubPage() is a pure string naming every game', () => {
  const html = hubPage();
  assert.equal(typeof html, 'string');
  for (const g of GAMES) assert.match(html, new RegExp(esc(g.name)));
});

test('the server module does NO request-time network (source has no fetch/http client call)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  // no runtime fetch/axios/https.get etc. in the handler path — pages are static strings
  assert.ok(!/\bfetch\s*\(/.test(src), 'server must not call fetch at request time');
  assert.ok(!/https?\.(get|request)\s*\(/.test(src), 'server must not open an outbound http request');
});
