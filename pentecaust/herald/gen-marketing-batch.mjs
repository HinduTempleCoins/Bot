// gen-marketing-batch.mjs — build a pool of native Herald ad creatives for @shilpa-shastra test marketing.
//
// NATIVE ONLY. Heroes are drawn on our own CPU-SD worker (no external gen API); the ad itself is composed by
// our own ad-templates.mjs engine. The output is web-sized JPEGs plus an ad-manifest.json that shilpa-marketing.mjs
// reads and posts in batches.
//
//   # 1) generate the hero pool on the worker's box (slow, one-time):
//   CPU_SD_URL=http://127.0.0.1:8510 CPU_SD_TOKEN=… node gen-marketing-batch.mjs heroes --out=/tmp/mktg-heroes [--only=a,b]
//   # 2) render creatives + manifest from those heroes (fast, anywhere with sharp):
//   node gen-marketing-batch.mjs render --heroes=/tmp/mktg-heroes --out=/tmp/mktg-img \
//        --manifest=/tmp/ad-manifest.json --base=https://hathor.soapbox.community/remakes/img/mktg --n=180
//
// House style: ESM, soft-fail, CLI guarded. The render step is deterministic (seeded rotation), so re-running
// with a higher --n tops the pool up.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { renderTemplate, THEME_IDS, PRODUCTS, CTAS, BRAND_NEG } from './ad-templates.mjs';

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };

// ── hero pool — VanKushFamily aesthetic (temple angels, VR-Hathor-Mehit) + creator-economy lifestyle ──
export const HERO_SPEC = {
  temple_angel_statue: 'a classical greco-roman white marble statue of a winged angel in a flowing draped robe, glowing golden halo, ionic columns, vaporwave neon cyan and magenta, retro striped sun, neon palm trees, starry sky, synthwave, highly detailed',
  vaporwave_temple_wide: 'an ancient temple of angels at dusk, rows of greek marble columns and winged marble statues, vaporwave cyan magenta and purple neon, palm trees, retro striped sun, neon grid floor, clouds, cinematic, highly detailed',
  hathor_mehit: 'a divine goddess with branching ibex antler horns and a glowing cyan VR visor over her eyes, feathered angel wings, flower crown, white draped greek gown with gold greek-key meander, lilac and pastel pink and violet palette, mandala halo, clouds and stars, ethereal digital art, highly detailed',
  hathor_angel: 'a serene angelic goddess with ribbed ibex horns and a glowing cyan VR visor, wide feathered wings spread, lilac skin, flower crown, gold jewelry, pastel violet and magenta light, radiant mandala halo, dreamy vaporwave, highly detailed',
  angel_egypt_syncretic: 'a syncretic temple of angels, a white marble winged angel statue beside egyptian columns and hieroglyphs and a gold sun disk, teal gold and magenta neon, divine atmosphere, vaporwave, highly detailed',
  biblical_gold: 'a radiant heavenly host of angels in golden divine light, baroque glory, shafts of light through clouds, gold and warm white, reverent, highly detailed',
  angels_reentry_earth: 'winged angels descending from the heavens toward the earth through glowing clouds and streaks of light, cinematic epic sky, gold and cyan, awe, highly detailed',
  vaporwave_city: 'a retro vaporwave city skyline at sunset, neon grid, palm trees, pink and teal gradient sky, chrome and gold, synthwave, highly detailed',
  fantasy_portal: 'a glowing magical portal in a fantasy temple, swirling cyan and magenta energy, marble arches, neon, cinematic, highly detailed',
  earn_coins: 'a cascade of glowing gold coins and crystal crypto tokens, abundance and wealth, soft vaporwave light, cyan and gold, highly detailed',
  blogger_cafe: 'editorial lifestyle photo, a confident happy young woman blogging on a laptop in a sunlit cafe, modern streetwear, warm film grade, shallow depth of field, natural light',
  creator_desk: 'editorial photo, a cheerful young woman content creator at a cozy desk with a camera and ring light, plants and fairy lights, warm studio glow',
  kpop_creator: 'editorial fashion photo, a stylish young woman in a pastel outfit with pastel hair taking a selfie, vibrant clean studio lighting, cheerful',
  friends_group: 'editorial photo, a diverse group of happy young adult friends laughing together outdoors, casual modern clothes, golden hour sunlight',
  dj_techno: 'editorial photo, a young woman techno dj at the decks wearing headphones, neon club lighting, magenta and cyan vaporwave glow',
};

// ── async job client for the CPU-SD worker (submit → poll; never holds a request open for minutes) ──
async function genOne(prompt, { base, token, steps = 8, guidance = 2 }) {
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const sub = await fetch(`${base}/jobs`, { method: 'POST', headers, body: JSON.stringify({ prompt, negativePrompt: BRAND_NEG, steps, guidance, size: 512 }) });
  const sj = await sub.json().catch(() => ({}));
  if (!sj || !sj.id) {
    // fall back to the synchronous endpoint if the worker has no job queue
    const r = await fetch(`${base}/generate`, { method: 'POST', headers, body: JSON.stringify({ prompt, negativePrompt: BRAND_NEG, steps, guidance, size: 512 }) }).catch(() => null);
    const d = r && r.ok ? await r.json().catch(() => null) : null;
    return d && d.ok && d.base64 ? Buffer.from(d.base64, 'base64') : null;
  }
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await fetch(`${base}/jobs/${sj.id}`, { headers }).then((r) => r.json()).catch(() => null);
    if (st && (st.status === 'done' || st.status === 'error')) {
      const res = st.result || {};
      return res.ok && res.base64 ? Buffer.from(res.base64, 'base64') : null;
    }
  }
  return null;
}

async function cmdHeroes() {
  const out = arg('out', '/tmp/mktg-heroes'); mkdirSync(out, { recursive: true });
  const base = String(process.env.CPU_SD_URL || 'http://127.0.0.1:8510').replace(/\/$/, '');
  const token = process.env.CPU_SD_TOKEN || '';
  const only = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const names = only.length ? only.filter((n) => HERO_SPEC[n]) : Object.keys(HERO_SPEC);
  let ok = 0;
  for (const n of names) {
    const dst = join(out, `${n}.png`);
    if (existsSync(dst) && !process.argv.includes('--force')) { console.log('skip (exists)', n); ok++; continue; }
    const t0 = Date.now();
    const buf = await genOne(HERO_SPEC[n], { base, token });
    if (buf) { writeFileSync(dst, buf); ok++; console.log('hero', n, `${Math.round((Date.now() - t0) / 1000)}s`, buf.length, 'bytes'); }
    else console.log('FAIL hero', n);
  }
  console.log(`heroes: ${ok}/${names.length} -> ${out}`);
}

const FMT_ROT = ['ig-square', 'ig-portrait', 'story-reel', 'pinterest-pin', 'fb-link', 'x-post', 'yt-thumb',
  'fb-cover', 'li-banner', 'business-card', 'postcard-4x6', 'disp-medrect', 'disp-leaderboard', 'disp-halfpage',
  'web-hero', 'blog-featured', 'qr-card', 'podcast-cover'];

async function cmdRender() {
  const heroDir = arg('heroes', '/tmp/mktg-heroes');
  const out = arg('out', '/tmp/mktg-img'); mkdirSync(out, { recursive: true });
  const manifestPath = arg('manifest', '/tmp/ad-manifest.json');
  const urlBase = String(arg('base', 'https://hathor.soapbox.community/remakes/img/mktg')).replace(/\/$/, '');
  const N = +(arg('n', '180'));
  const sharp = (await import('sharp')).default;

  const heroes = {};
  if (existsSync(heroDir)) for (const fn of readdirSync(heroDir).filter((x) => x.endsWith('.png'))) heroes[fn.replace('.png', '')] = `data:image/png;base64,${readFileSync(join(heroDir, fn)).toString('base64')}`;
  const heroKeys = Object.keys(heroes);
  if (!heroKeys.length) { console.log('no heroes in', heroDir, '— run the `heroes` step first'); process.exit(1); }
  const resolveHero = (name, idx) => heroes[name] || heroes[heroKeys.find((k) => k.startsWith(name) || k.includes(name) || name.includes(k))] || heroes[heroKeys[idx % heroKeys.length]];

  const coverable = (fmt) => !['disp-medrect', 'disp-leaderboard', 'disp-halfpage', 'business-card', 'li-banner', 'fb-cover', 'qr-card'].includes(fmt);
  const creatives = [];
  let i = 0, done = 0, fail = 0;
  while (done < N) {
    const prod = PRODUCTS[i % PRODUCTS.length];
    const fmt = FMT_ROT[(i * 2 + (i % PRODUCTS.length)) % FMT_ROT.length];
    const theme = THEME_IDS[(i + prod.id.length) % THEME_IDS.length];
    const slogan = prod.slogans[i % prod.slogans.length];
    const hero = resolveHero(prod.heroes[i % prod.heroes.length], i);
    const layout = (i % 2 === 0 && coverable(fmt)) ? 'cover' : 'standard';
    const opts = layout === 'cover'
      ? { layout: 'cover', slogan, eyebrow: prod.kicker, sub: prod.surface, heroDataUri: hero }
      : { slogan, cta: CTAS[i % CTAS.length], heroDataUri: hero, surfaces: [prod.surface, 'melek.salon', 'hathor.live'], eyebrow: prod.kicker };
    const id = `s${String(done).padStart(3, '0')}-${prod.id}-${fmt}-${theme}`;
    try {
      const png = await renderTemplate(fmt, theme, opts);
      const jpg = await sharp(png).resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, progressive: true }).toBuffer();
      const file = `${id}.jpg`;
      writeFileSync(join(out, file), jpg);
      creatives.push({ id, product: prod.id, format: fmt, theme, layout, slogan, surface: prod.surface, url: `${urlBase}/${file}` });
      done++; if (done % 20 === 0) console.log(' ', done);
    } catch (e) { fail++; if (fail < 8) console.log('FAIL', fmt, theme, e && e.message); }
    i++;
    if (i > N * 4) break;
  }
  mkdirSync(join(manifestPath, '..'), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ built: Date.now(), base: urlBase, creatives }, null, 1));
  console.log(`rendered ${done}, failed ${fail} -> ${out}\nmanifest (${creatives.length}) -> ${manifestPath}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const cmd = process.argv[2];
  if (cmd === 'heroes') await cmdHeroes();
  else if (cmd === 'render') await cmdRender();
  else console.log('usage: gen-marketing-batch.mjs heroes --out=DIR  |  render --heroes=DIR --out=DIR --manifest=F --base=URL --n=N');
}
