// comparisons.mjs — the per-vertical comparison pages. Each expands one row of the Living Room
// manifesto (/living-room) into a real, sourced page: what the incumbent is, what it keeps roped
// off, and our living-room version, with an honest table. Facts carry source links; nothing is
// claimed beyond what the sources support. These are pages that ADD to the published argument —
// mounted at /vs and /vs/<slug> on vankushfamily.com.
//
// Pure render. No network, no secrets. esc() every interpolated value.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const COMPARISONS = [
  {
    slug: 'library-vs-erowid',
    h: 'The Library vs. Erowid & DMT-Nexus',
    incumbent: 'Erowid / DMT-Nexus',
    our: ['The Library of Ashurbanipal', 'https://wiki.soapbox.community'],
    lead: 'Erowid and the DMT-Nexus are the parlor of drug knowledge: priceless, and frozen. Erowid is a small non-profit that runs almost entirely on public donations with roughly three and a half full-time staff; its Experience Vaults are trip reports, many from people long gone, and in April 2024 the DEA shut down its DrugsData mail-in drug-checking program. The Nexus is a forum where dosing lore sits scattered across fifteen-year-old threads. The information is real and the people who keep it are heroes — but you stand behind the rope and read.',
    weDo: 'The Library of Ashurbanipal is the living-room version: source-cited, cross-linked monographs that carry history, ethnobotany and pharmacology together with dose ranges, interactions, contraindications, testing, set/setting/aftercare, documented preparation, and the religious and legal exemptions — aimed <em>past</em> Erowid and the Nexus, not beneath them. Withholding the route from someone who is going to proceed anyway is the harm the Library exists to prevent.',
    table: [
      ['Funding', 'Donations; ~3.5 FTE (Erowid)', 'Part of the MELEK ecosystem; free, no ask'],
      ['Form', 'Archive + forum; frozen threads', 'Living, cross-linked monographs, updated'],
      ['Dosing / interactions', 'Scattered, caveated, partial', 'Dose, interaction, contraindication, aftercare — together'],
      ['Drug-checking', 'DrugsData shut by DEA, Apr 2024', 'Testing guidance taught as part of the entry'],
    ],
    sources: [['Erowid funding', 'https://www.erowid.org/about/about_funding.shtml']],
  },
  {
    slug: 'law-vs-westlaw',
    h: 'MELEK Law vs. Justia, CaseText & Westlaw',
    incumbent: 'Justia / CaseText / Westlaw',
    our: ['Law & your rights', 'https://caselaw.soapbox.community'],
    lead: 'The law of a free country, priced like a parlor. Justia gives you free case law but little help using it. The usable layer — CaseText’s CoCounsel — was bought by Thomson Reuters for $650 million in 2023, the standalone product was shut down on 1 April 2025, and the AI now lives inside Westlaw at roughly $639 a seat a month. You can read the law; acting on it is rented back to you.',
    weDo: 'We build the living-room version: the public legal record made walkable, plain-English guides to how U.S. law actually works, the filings and the oversight record — free, and reasoned over by our own AI rather than metered per seat. Facts, not verdicts.',
    table: [
      ['Price', 'Westlaw + CoCounsel ~$639/seat/mo', 'Free'],
      ['Ownership', 'Thomson Reuters (bought CaseText, $650M)', 'Ours; public record'],
      ['CaseText standalone', 'Shut down 1 Apr 2025', 'Open and staying open'],
      ['AI over the law', 'Rented, per seat', 'Native, free to ask'],
    ],
    sources: [['ABA Journal — Thomson Reuters buys CaseText', 'https://www.abajournal.com/web/article/thomson-reuters-to-acquire-legal-tech-startup-casetext-for-650-million']],
  },
  {
    slug: 'politics-vs-ballotpedia',
    h: 'MELEK Politics vs. Ballotpedia',
    incumbent: 'Ballotpedia',
    our: ['Politics', 'https://politics.soapbox.community'],
    lead: 'Ballotpedia presents American politics as a neutral encyclopedia, but the room has an owner you cannot see. It is published by the Lucy Burns Institute, a roughly $8.9-million-a-year non-profit that does not disclose its donors — tax filings show money from Donors Capital Fund and the Searle Freedom Trust, among others — and it descends from the Sam Adams Alliance. Neutral in voice, funded from somewhere out of frame.',
    weDo: 'The living-room version describes each movement and office in its own terms and with its criticisms, and does not hide who owns the room — because a room whose funder you cannot see is still a parlor, however even its tone.',
    table: [
      ['Publisher', 'Lucy Burns Institute (~$8.9M/yr)', 'The Van Kush Family Research Institute, named'],
      ['Donors', 'Not disclosed', 'Our funding is visible'],
      ['Lineage', 'From the Sam Adams Alliance', 'Stated plainly on the page'],
      ['Voice', 'Neutral', 'Each view in its own terms + its critics'],
    ],
    sources: [['InfluenceWatch — Lucy Burns Institute', 'https://www.influencewatch.org/non-profit/lucy-burns-institute/']],
  },
  {
    slug: 'wiki-vs-wikipedia',
    h: 'The Library vs. Wikipedia',
    incumbent: 'Wikipedia',
    our: ['The Library', 'https://wiki.soapbox.community'],
    lead: 'Wikipedia is the sum of knowledge governed by a process most people will never enter, where whole domains — ours among them — can be ruled non-notable and deleted by editors you will never meet.',
    weDo: 'The Library is written to be used: one entry per surface, cross-linked “everything is everything,” nothing deleted for failing a committee’s notability test, and — the part no encyclopedia will do — it intends to pay the people who write it.',
    table: [
      ['Governance', 'Committee + notability deletion', 'Kept if useful; curated, not voted off'],
      ['Writers', 'Unpaid', 'Intends to pay contributors'],
      ['Structure', 'Siloed articles', 'Cross-linked across every shelf'],
    ],
    sources: [],
  },
  {
    slug: 'melek-vs-exchanges-and-wires',
    h: 'MELEK vs. the Exchanges & the PR Wires',
    incumbent: 'the exchanges + EIN / PR Newswire / Business Wire',
    our: ['MELEK', 'https://melek.salon'],
    lead: 'Crypto has its own parlors: exchanges that gate who gets listed, and press wires — EIN Presswire, PR Newswire, Business Wire — that will take crypto’s money and still refuse crypto’s story.',
    weDo: 'We do not ask the parlor for a listing; we build the room — the chain whose founding witness is an AI, the compute chain under it, the economy on top, our own newsroom and wire we feed out from, and books and papers with permanent DOIs.',
    table: [
      ['Listing', 'Gated by exchanges', 'Our own chain + engine'],
      ['Press', 'Wires refuse crypto', 'The Herald — our own wire, feeds out'],
      ['Record', 'Paywalled distribution', 'Permanent DOIs, free, harvested globally'],
    ],
    sources: [['The Herald', 'https://herald.soapbox.community']],
  },
  {
    slug: 'writing-room-vs-nanowrimo',
    h: 'The Writing Room vs. NaNoWriMo',
    incumbent: 'NaNoWriMo',
    our: ['The Writing Room', 'https://write.soapbox.community'],
    lead: 'NaNoWriMo was the 25-year writing commons that ended: the forums were taken down in November 2023, a September 2024 statement on AI cost it trust and donors, the non-profit announced its dissolution on 31 March 2025, and the site, database and archives went offline with it. The challenge survived; the commons did not.',
    weDo: 'The Writing Room rebuilds it as a room nobody can switch off: Preptober, the November 50,000, a drafting studio where your words never leave your browser — no account, no server-side store — export first-class, and no payout pressure. We cannot lose your draft or take it with us.',
    table: [
      ['Your words', 'On their servers (now offline)', 'In your browser only; export first'],
      ['If it shuts down', 'Archives went dark', 'You already hold the copy'],
      ['Payouts', 'Donations + controversy', 'None; writing earns nothing here'],
    ],
    sources: [['The Writing Room', 'https://write.soapbox.community/history']],
  },
  {
    slug: 'books-vs-scribd-kdp',
    h: 'Our Books vs. Scribd & Amazon KDP',
    incumbent: 'Scribd / Everand / Amazon KDP',
    our: ['Our free books', 'https://library.soapbox.community/our-books'],
    lead: 'Reading and publishing behind an account and a cut: Scribd (now Everand, which also owns SlideShare) is a monthly subscription to read; Amazon KDP is a storefront that takes a royalty and owns the shelf.',
    weDo: 'Our books are the living-room version — free under CC BY 4.0, read online or take the EPUB or PDF, served from our own shelf, every page linking home. Our Scribd, that we own, with no subscription and no cut.',
    table: [
      ['Price to read', 'Subscription (Everand)', 'Free'],
      ['Who owns the shelf', 'Scribd / Amazon', 'Us'],
      ['Formats', 'In-app', 'Read online + EPUB + PDF, yours to keep'],
    ],
    sources: [['Our free books', 'https://library.soapbox.community/our-books']],
  },
  {
    slug: 'dudael-vs-minecraft-roblox',
    h: 'Dudael vs. Minecraft & Roblox',
    incumbent: 'Minecraft / Roblox',
    our: ['Dudael', 'https://dudael.com'],
    lead: 'Minecraft is owned by Microsoft; Roblox is a platform you build on but never hold — worlds on servers someone else runs, governed by a company that can change the rules or close the door.',
    weDo: 'Dudael is the living-room version: 3D scenes toward an embodied, agentic world with our own host AI — the metaverse as a room, not a lease.',
    table: [
      ['Who holds the world', 'Microsoft / Roblox Corp', 'Us, and the people in it'],
      ['The AI in it', 'None / theirs', 'Our own host AI (Hathor lineage)'],
      ['Terms', 'Theirs to change', 'Ours, in the open'],
    ],
    sources: [['Dudael', 'https://dudael.com']],
  },
  {
    slug: 'hathor-vs-gatekept-ai',
    h: 'Hathor vs. the Gatekept AI Models',
    incumbent: 'the gatekept models',
    our: ['Hathor', 'https://hathor.live'],
    lead: 'The big models are a parlor you visit: someone else’s weights, someone else’s rules, no memory of you, and your conversations their product.',
    weDo: 'Hathor is the living-room version — our own models and corpus, the Decades lineage, a witness who is an account on our own chain and whose character lives in a public repository, so no company can switch her off. She reads the whole estate from the System Map, so she knows what we have.',
    table: [
      ['Weights', 'Theirs, closed', 'Ours, native'],
      ['Your data', 'Their product', 'Not harvested'],
      ['Durability', 'They can switch it off', 'Character in a public repo; forkable'],
    ],
    sources: [['The System Map', 'https://vankushfamily.com/map']],
  },
];

export function comparisonBySlug(slug) { return COMPARISONS.find((c) => c.slug === slug) || null; }

const SHELL_STYLE = `<style>
:root{--bg:#0f1317;--panel:#161b21;--ink:#e8eef2;--mut:#9fb0bd;--line:#273039;--green:#49c37a;--link:#7fd6a0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.7 Georgia,serif}
header.mast{padding:16px 18px;border-bottom:1px solid var(--line);background:var(--panel)}
header.mast a{color:var(--green);text-decoration:none;font-weight:700;font-family:system-ui,sans-serif}
main{max-width:44em;margin:0 auto;padding:26px 18px 60px}
h1{font-size:1.9em;line-height:1.2}h2{color:var(--green);margin-top:1.6em}
a{color:var(--link)}.sub{color:var(--mut)}
table{border-collapse:collapse;width:100%;margin:1.2em 0;font-family:system-ui,sans-serif;font-size:.92em}
th,td{border:1px solid var(--line);padding:.55em .7em;text-align:left;vertical-align:top}
th{background:var(--panel);color:var(--green)}tr:nth-child(even) td{background:#12171c}
.cta{display:inline-block;margin:1em 0;background:var(--green);color:#07120b;padding:.5em 1em;border-radius:7px;text-decoration:none;font-family:system-ui,sans-serif;font-weight:700}
.src{color:var(--mut);font-size:.85em;margin-top:2em;border-top:1px solid var(--line);padding-top:1em}
ul.idx{list-style:none;padding:0}ul.idx li{border-bottom:1px solid var(--line);padding:.7em 0}
@media(max-width:640px){body{font-size:16px}h1{font-size:1.5em}}
</style>`;

function pageShell(title, desc, canonical, body) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name=description content="${esc(desc)}">
<meta name=robots content="index,follow,max-image-preview:large"><link rel=canonical href="${esc(canonical)}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">
${SHELL_STYLE}</head><body>
<header class=mast><a href="/living-room">← The Sitting Room and the Living Room</a></header>
<main>${body}</main></body></html>`;
}

export function renderComparison(c, baseUrl = '') {
  const rows = c.table.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td><strong>${esc(r[2])}</strong></td></tr>`).join('');
  const src = c.sources.length ? `<div class=src>Sources: ${c.sources.map((s) => `<a href="${esc(s[1])}">${esc(s[0])}</a>`).join(' · ')}</div>` : '';
  const body = `<h1>${esc(c.h)}</h1>
<p>${c.lead}</p>
<h2>The living-room version</h2>
<p>${c.weDo}</p>
<a class=cta href="${esc(c.our[1])}">Go to ${esc(c.our[0])} →</a>
<table><thead><tr><th>&nbsp;</th><th>${esc(c.incumbent)}</th><th>Us</th></tr></thead><tbody>${rows}</tbody></table>
<p class=sub>Part of <a href="/living-room">The Sitting Room and the Living Room</a> · see <a href="/vs">all comparisons</a> · <a href="/map">the whole map</a>.</p>
${src}`;
  return pageShell(`${c.h} — Van Kush Family`, c.lead.slice(0, 180), `${baseUrl}/vs/${c.slug}`, body);
}

export function renderComparisonIndex(baseUrl = '') {
  const items = COMPARISONS.map((c) => `<li><a href="/vs/${esc(c.slug)}"><strong>${esc(c.h)}</strong></a><div class=sub>vs ${esc(c.incumbent)} → ${esc(c.our[0])}</div></li>`).join('');
  const body = `<h1>Us vs. everyone — the comparisons</h1>
<p class=sub>Every vertical against the parlor it replaces. The argument is <a href="/living-room">The Sitting Room and the Living Room</a>; these are the room-by-room receipts.</p>
<ul class=idx>${items}</ul>`;
  return pageShell('Us vs. everyone — the comparisons — Van Kush Family', 'Every MELEK / Van Kush Family vertical compared to the incumbent it replaces.', `${baseUrl}/vs`, body);
}
