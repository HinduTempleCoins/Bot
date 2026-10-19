// build-page.mjs — generate the Herb and Chemical Atlas wiki page from the datasets beside it.
//
// The operator asked for "Everything I said, on One Page, and it can Link out to the Other Pages…
// like the Page Wikipedia has with all the Plants that have DMT… it is all their Pages for all those
// Plants, but on 1 Page with less Info". So this is an INDEX: one condensed line per thing, grouped,
// every entry linking out to the article that carries the detail.
//
// The page is generated rather than hand-typed so the numbers on it stay the ones in the datasets —
// PubChem identity, the similarity clustering, the oils table — and regenerate when those change.
//
//   node knowledge/herb-atlas/build-page.mjs > site/wiki/articles/Herb_and_Chemical_Atlas.wiki

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (f) => (existsSync(join(HERE, f)) ? JSON.parse(readFileSync(join(HERE, f), 'utf8')) : null);

const pubchem = load('pubchem.json') || [];
const shulgin = load('shulgin.json');
const sim = load('similarity_groups.json');
const oils = load('oils_butters.json');
const plants = load('plants.json');
const chem = load('chemicals.json');
const inter = load('interactions.json');

const byQuery = new Map(pubchem.map((p) => [p._query, p]));
const chemBy = new Map((chem?.compounds || chem || []).map?.((c) => [c.id || c.name, c]) || []);

/** One condensed index line. */
const line = (label, bits, link) => {
  const head = link ? `[[${link}|${label}]]` : `'''${label}'''`;
  return `* ${head}${bits.filter(Boolean).length ? ' — ' + bits.filter(Boolean).join('; ') : ''}`;
};

const out = [];
const w = (s = '') => out.push(s);

// ── opening ──────────────────────────────────────────────────────────────────────────────────────
w(`The '''Herb and Chemical Atlas''' is the one-page index to everything in this library about plants, the chemicals in them, what those chemicals do to each other inside a person, and what people make out of them — cooking first, then lotions and balms, then diffusers and candles. Every entry here is a short line. The detail lives on the page each line links to.`);
w();
w(`It exists because the same plant turns up in four different conversations — a kitchen spice, a scent, a dye, and a drug interaction — and nowhere were those four facts on one line next to each other. Cooking is the centre of this page because cooking is where almost everyone meets these plants first.`);
w();

// ── the two charts ───────────────────────────────────────────────────────────────────────────────
w(`== The charts ==`);
w(`Two diagrams carry the structural part of this page. Both are drawn from the data files beside this article rather than copied from anywhere, so they are the same on every load and correct in print.`);
w();
w(`[[Figure:allylbenzene-map|The allylbenzene series, each ring position colour-coded. Two molecules can be compared by eye: what is at position 4 decides the class, position 2 and 5 are said to shift the character.]]`);
w();
w(`The colour key is the one from the chart the operator has used since 2018, published on Herbpedia: position 1 black (the side chain), 2 brown, 3 red, 4 green, 5 blue, 6 purple. '''What each position is said to do is a community claim''', from the 69Ron material, and is not a verified structure–activity result. It is on the chart because it is how this family has been read for twenty years, not because it has been demonstrated.`);
w();
w(`[[Figure:plant-constituents|What is in each plant: the major constituents of each essential oil, as a share of the whole. Bars are the midpoint of the published range.]]`);
w();
w(`Read that chart with one thing in mind: '''it is the composition of the oil, not of the plant.''' Piperine is 5–9% of black pepper but almost none of its distilled oil; curcumin is the colour and the pharmacology of turmeric and is not volatile at all; the grapefruit furanocoumarins that cause the famous drug interaction are in the juice, not the peel oil. A plant and its essential oil are not interchangeable, and most bad advice in this subject comes from treating them as if they were.`);
w();

// ── Shulgin ──────────────────────────────────────────────────────────────────────────────────────
if (shulgin) {
  w(`== Shulgin's ten essential oils ==`);
  w(`Shulgin noticed that ten common essential oils carry the ring substitution patterns of ten known amphetamines, and that adding ammonia across the side chain would, on paper, turn each oil into its partner. His own words are "in theory" and "in principle", and that qualifier is the whole point: '''no human in vivo conversion of an allylbenzene into an amphetamine has ever been demonstrated.''' Every pair below is hypothetical.`);
  w();
  w(`'''What is actually documented is different.''' ${shulgin.what_is_actually_documented}`);
  w();
  w(`The pairs, each one hypothetical:`);
  for (const p of shulgin.pairs) {
    w(`* '''${p.pattern}''' — ${p.oil}${p.oil_aka ? ` (${p.oil_aka.join(', ')})` : ''} → ${p.amphetamine}, ${p.amphetamine_full}${p.oil_note ? `. ${p.oil_note}` : ''}`);
  }
  w();
  w(`See [[Shulgin Ten Essential Oils]], [[Shulgin Ten Essential Amphetamines and Metabolic Chemistry]] and [[Oilahuasca]].`);
  w();
}

// ── compounds by similarity ──────────────────────────────────────────────────────────────────────
if (sim) {
  w(`== The chemicals, grouped by how alike they are ==`);
  w(`The grouping below is computed, not editorial: ${sim.method}. Molecules that sit together here are built the same way, which is usually why they smell alike, are metabolised by the same enzymes, or show up in the same plants.`);
  w();
  const groups = Object.values(sim.groups).filter((g) => g.length > 1);
  for (const g of groups) {
    const members = g.map((q) => {
      const p = byQuery.get(q);
      const c = chemBy.get(q);
      const name = c?.name || q;
      return p ? `${name} (C${p.CID})` : name;
    });
    w(`* ${members.join(' · ')}`);
  }
  const singles = Object.values(sim.groups).filter((g) => g.length === 1).flat();
  if (singles.length) {
    w(`* '''On their own:''' ${singles.join(' · ')}`);
  }
  w();
  w(`Each name is a PubChem compound id (C number), so any of them can be looked up directly. Identity data — formula, weight, log P and the structure itself — was taken from PubChem rather than written from memory; the file is <code>knowledge/herb-atlas/pubchem.json</code>.`);
  w();
}

// ── oils and butters ─────────────────────────────────────────────────────────────────────────────
if (oils?.oils?.length) {
  w(`== Plant oils, butters and waxes ==`);
  w(`${oils.count || oils.oils.length} of them, with the numbers that decide what each one is good for. ${oils.how_to_read || ''}`);
  w();
  const cat = (c) => oils.oils.filter((o) => o.category === c);
  for (const [c, title] of [['oil', 'Oils'], ['butter', 'Butters'], ['wax', 'Waxes'], ['fat', 'Animal fats']]) {
    const list = cat(c);
    if (!list.length) continue;
    w(`=== ${title} ===`);
    for (const o of list) {
      const fa = o.fatty_acids?.values_pct || {};
      const top = Object.entries(fa).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}%`).join(', ');
      const mp = o.melting_point_c?.value;
      const sap = o.saponification?.naoh;
      const bits = [
        o.latin,
        top && `mainly ${top}`,
        mp && `melts ${typeof mp === 'number' ? `${mp} °C` : mp}`,
        sap && `NaOH SAP ${sap}`,
        o.smoke_point_c?.value && `smoke point ${o.smoke_point_c.value} °C`,
        o.best_uses && (Array.isArray(o.best_uses) ? o.best_uses.join(', ') : o.best_uses),
      ];
      w(line(o.name, bits));
    }
    w();
  }
  if (oils.comedogenic_caveat) { w(`''${oils.comedogenic_caveat}''`); w(); }
}

// ── plants ───────────────────────────────────────────────────────────────────────────────────────
if (plants?.plants?.length) {
  w(`== The plants ==`);
  w(`${plants.plants.length} of them. Each line gives what is in it, what it is for in a kitchen, and anything that should stop you — then links out.`);
  w();
  const groups = {};
  for (const p of plants.plants) (groups[p.group || p.category || 'Other'] ||= []).push(p);
  for (const [g, list] of Object.entries(groups)) {
    w(`=== ${g} ===`);
    for (const p of list) {
      const main = (p.constituents?.essential_oil || p.constituents?.volatile || [])
        .slice(0, 3).map((c) => `${c.name}${c.pct ? ` ${c.pct}` : ''}`).join(', ');
      const bits = [
        p.latin && `''${p.latin}''`,
        main && `mainly ${main}`,
        p.culinary?.summary || p.culinary,
        p.dye?.colour && `dyes ${p.dye.colour}`,
        p.cautions?.summary || (Array.isArray(p.cautions) ? p.cautions[0] : p.cautions),
      ];
      w(line(p.common || p.name, bits, p.wiki_link));
    }
    w();
  }
}

// ── what to make ─────────────────────────────────────────────────────────────────────────────────
w(`== Cooking ==`);
w(`Cooking is where the chemistry on this page was worked out long before anyone named it. Four rules carry most of it.`);
w();
w(`* '''Most of what you are after is not water-soluble.''' The aroma compounds in the chart above are oils. That is why a spice blooms in hot fat and not in a watery sauce, why tempering — tadka, the Indian technique of frying whole spices in ghee and pouring it over the dish — extracts more in thirty seconds than an hour of simmering, and why an infused oil tastes of the herb while an infused broth often does not.`);
w(`* '''Heat both makes and destroys flavour.''' Toasting builds new compounds through the Maillard reaction and the breakdown of sugars; it also drives off the volatile ones that were already there. This is the whole reason whole spices go in early and ground spices go in late, and why delicate herbs — basil, coriander leaf, dill — are added off the heat.`);
w(`* '''Spice use tracks climate, and the usual explanation is antimicrobial.''' Billing and Sherman's 1998 survey across thousands of traditional recipes found hotter climates use more spices, and the most-used spices are the most strongly antibacterial. It is a correlation with a plausible mechanism rather than a proven cause, and it is often overstated — but the pattern is real and it is why the preserving traditions and the flavouring traditions are the same traditions.`);
w(`* '''Pairings are not arbitrary.''' Shared aroma compounds explain a good deal of why certain things go together, and also why the rule inverts by cuisine — Western pairings tend to share compounds, East Asian pairings tend not to (Ahn and colleagues, 2011).`);
w();
w(`'''Infused oils, honeys and vinegars carry a real safety rule.''' Fresh plant material in oil, garlic above all, is a botulism risk: oil excludes air, the plant brings the spores and the water, and nothing in the jar stops them. Use dried material, or acidify, keep it refrigerated and use it inside a week. See [[Sauce Food Safety Acidification pH Garlic in Oil and Refrigeration]] and [[Tinctures Glycerites Syrups and Infused Oils and Butters]].`);
w();
w(`More: [[Cooking with Herbs and Spices]] · [[Scratch Cooking and Culinary Ratios]] · [[Cooking Methods]] · [[Preservation Fermentation and Spice]] · [[Traditional Spiced Formulations and Synergistic Blends]]`);
w();

w(`== Lotions, balms and salves ==`);
w(`A balm is anhydrous — oil, butter and wax, no water. A lotion or cream has water in it, and the moment there is water there is something living in it within days.`);
w();
w(`* '''Balm ratio.''' Roughly 1 part wax to 4 parts oil by weight gives a soft salve; 1 to 3 gives a firm stick; 1 to 6 or 8 gives something barely set. Butters sit between: they add body without the brittleness wax gives. Test a spoonful in the freezer for two minutes rather than guessing at the whole batch.`);
w(`* '''Anything with water needs a real preservative.''' Vitamin E is an antioxidant — it slows oils going rancid and does nothing whatever to bacteria or mould. A broad-spectrum preservative at its stated use rate and within its stated pH range is not optional in a water-containing product, and "natural" alternatives marketed as preservatives are mostly not.`);
w(`* '''Essential oils have dermal limits, and they are lower than people expect.''' Around 1% for a leave-on body product is a common working figure — about 6 drops in 30 ml — and lower on the face, lower again for children, with several oils restricted much further. Cinnamon bark, oakmoss and isoeugenol are sensitisers; expressed citrus oils are phototoxic and have bergapten limits for leave-on use. Tisserand and Young is the reference that actually gives per-oil numbers.`);
w(`* '''Infusing the oil.''' Dry plant material only, unless you intend to use it immediately and refrigerate it — the same water rule as the kitchen, for the same reason.`);
w();
w(`More: [[Tinctures Glycerites Syrups and Infused Oils and Butters]] · [[Soap Calculator]]`);
w();

w(`== Diffusers, candles and the air ==`);
w(`* '''Diffusers.''' A few drops in 100 ml of water is a normal strength in an ultrasonic unit, run in short sessions rather than continuously. Intermittent is both more effective and safer: the nose stops registering a constant smell within minutes, so running it all day mostly just raises the dose.`);
w(`* '''Cats are the serious exception.''' Cats lack much of the glucuronidation capacity other mammals use to clear phenols and terpenes, so oils that are unremarkable to a person accumulate in them. Tea tree is the best-documented harm. Birds are more sensitive still, by way of how their lungs work. A diffuser in a shared room is a dose for everyone in it, including the ones who cannot leave.`);
w(`* '''Terpenes react with indoor ozone.''' Limonene and the pinenes in particular react to form formaldehyde and fine secondary aerosol. It is not a reason to avoid them; it is a reason to ventilate rather than to seal a room and run a diffuser into it.`);
w(`* '''Candles.''' Fragrance load is typically 6–10% by weight of wax and is capped by what the wax will actually hold; above that it sweats out or pools. Soy is usually scented around 85 °C so the fragrance binds rather than flashing off. Wick size has to be tested against the actual vessel diameter, and a cured candle — a week or two — throws noticeably better than a fresh one. Essential oils have flash points, which matters for both the pour and the burn.`);
w();

// ── interactions ─────────────────────────────────────────────────────────────────────────────────
w(`== Potentiation and drug interactions ==`);
w(`This is the part of the page that can actually hurt someone. "Potentiation" and "drug interaction" are the same mechanism described by someone who wants the effect and by someone who doesn't — a plant that makes a drug stronger does it by blocking the enzyme that clears it, and the enzyme does not know which outcome was intended.`);
w();
w(`Most of these run through the cytochrome P450 enzymes, which metabolise the majority of drugs. '''Inhibit one and everything it clears rises in the blood; induce one and everything it clears falls''' — including the drug somebody depends on.`);
w();
w(`The ones that put people in hospital:`);
w(`* '''MAOIs with tyramine-rich food''' — aged cheese, cured meat, soy sauce, miso, yeast extract, unpasteurised beer. Monoamine oxidase in the gut and liver normally destroys dietary tyramine; blocked, it reaches the circulation and can cause a hypertensive crisis. This applies to the β-carbolines in ayahuasca and Syrian rue as much as to prescription MAOIs.`);
w(`* '''MAOIs with serotonergic drugs''' — SSRIs, SNRIs, tramadol, triptans, dextromethorphan. Serotonin syndrome. This is the single most dangerous combination in this whole subject, and the overlap between people taking an antidepressant and people interested in harmala alkaloids is not small.`);
w(`* '''Grapefruit with CYP3A4 substrates''' — the furanocoumarins irreversibly disable intestinal CYP3A4, so the enzyme has to be rebuilt. The effect lasts far beyond the glass of juice, and for some drugs the resulting blood level is several times intended.`);
w(`* '''St John's wort''' — the opposite problem. It induces CYP3A4 and P-glycoprotein, dropping the levels of immunosuppressants, antiretrovirals, anticoagulants and hormonal contraceptives, with pregnancies and transplant rejections in the literature.`);
w(`* '''Kava with alcohol or other hepatotoxins''', against the background of the kava hepatotoxicity signal that took it off several markets.`);
w(`* '''Nutmeg in quantity''' is genuinely toxic — prolonged, unpleasant and occasionally hospitalising — and the dose is the kind of amount a recipe would never call for.`);
w();
w(`Quieter but real: piperine from black pepper raises the absorption of many drugs and supplements by inhibiting CYP3A4 and P-glycoprotein, which is exactly why it is added to turmeric products; licorice can drive potassium down; ginkgo and garlic are discussed with anticoagulants; cassia carries enough coumarin to have a tolerable daily intake set for it; and caffeine is cleared by CYP1A2, so CYP1A2 inhibitors leave it in circulation much longer.`);
w();
w(`See [[Enzyme Inhibition Kinetics and Molecular Transporters]] and [[Kava Potentiation]].`);
w();
if (inter?.interactions?.length) {
  w(`=== The documented list ===`);
  w(`${inter.interactions.length} of them, each with its mechanism rather than a yes or no.`);
  w();
  const sev = (s) => String(s || '').toLowerCase();
  const major = inter.interactions.filter((i) => /major|severe|contraindicat/.test(sev(i.significance)));
  const rest = inter.interactions.filter((i) => !major.includes(i));
  if (major.length) {
    w(`'''Major:'''`);
    for (const i of major) w(line(i.agents || i.pair, [i.mechanism, i.direction, i.significance]));
    w();
  }
  w(`'''The rest:'''`);
  for (const i of rest) w(line(i.agents || i.pair, [i.mechanism, i.direction]));
  w();
}

w(`== See also ==`);
for (const t of ['Oilahuasca', 'Allylbenzene Metabolism', 'Shulgin Ten Essential Oils', 'Terpenes', 'Terpene Map',
  'Aroma Wheels Euphoric Odours and the Science of Aromatherapy', 'Cooking with Herbs and Spices', 'Culinary Arts',
  'Dye Chemistry', 'Enzyme Inhibition Kinetics and Molecular Transporters', 'Kava Potentiation', 'Soap Calculator',
  'Tinctures Glycerites Syrups and Infused Oils and Butters', 'Traditional Spiced Formulations and Synergistic Blends']) w(`* [[${t}]]`);
w();
w(`== Sources ==`);
w(`* PubChem (identity, structure, formula, weight, log P) — every compound record on this page`);
w(`* PIHKAL, and <code>knowledge/shulgin-pihkal-tihkal/</code> in this repository`);
w(`* Peele & Oswald, PMID 870079 — what allylbenzenes actually become in vivo`);
w(`* [https://herbpedia.wikidot.com/allylbenzenes Herbpedia, the allylbenzene chart and the 69Ron material] — the colour key, labelled on this page as a community model`);
if (oils?.sources) for (const s of (Array.isArray(oils.sources) ? oils.sources : [oils.sources])) w(`* ${typeof s === 'string' ? s : s.name || JSON.stringify(s)}`);
w();
w(`== Coverage ==`);
w(`One-page index to the plants, the chemicals in them, their enzyme and interaction profiles, their smell, taste, dye and medical profiles, the oils and butters, and what to make with all of it.`);

process.stdout.write(out.join('\n') + '\n');
