// watch-safely.mjs — /watch-free-safely: where to watch free films legally, the real risks of unofficial streaming
// sites (without naming or linking any), what to do if you already clicked, and what SoapBox Stream is — everything
// here is free to use, and how we got it. Service availability checked 29 Sep 2026 (.local research report).
// Pure builder; esc() on all interpolation.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const CHECKED = '29 September 2026';

export const LEGAL_FREE = [
  { name: 'Tubi', url: 'https://tubitv.com', how: 'Free with ads, no account needed', note: 'The biggest free film library, including close to 1,000 horror films.' },
  { name: 'Pluto TV', url: 'https://pluto.tv', how: 'Free with ads', note: 'Live channels plus on-demand; its "Halloween Hits" collection runs every October.' },
  { name: 'Plex', url: 'https://watch.plex.tv', how: 'Free with ads', note: 'Free films and live channels alongside its media-server app.' },
  { name: 'The Roku Channel', url: 'https://therokuchannel.roku.com', how: 'Free with ads, on the web too', note: 'Tens of thousands of free titles and dedicated genre channels.' },
  { name: 'Fandango at Home (Free)', url: 'https://athome.fandango.com', how: 'Free with ads section', note: 'A rotating free-with-ads catalogue.' },
  { name: 'Kanopy', url: 'https://www.kanopy.com', how: 'Free with a public library or university card', note: 'Arthouse, world cinema, documentaries; often the only free home of indie titles.' },
  { name: 'Hoopla', url: 'https://www.hoopladigital.com', how: 'Free with a public library card', note: 'Films, TV, music and books from your library.' },
  { name: 'Official studio channels on YouTube', url: 'https://www.youtube.com', how: 'Free with ads', note: 'Full films uploaded by their owners — e.g. Paramount Vault, FilmRise Movies, Popcornflix, Scream Factory TV, Mosfilm, Korean Classic Film. Check the channel is the studio or distributor itself.' },
  { name: 'Internet Archive', url: 'https://archive.org/details/feature_films', how: 'Free, no ads', note: 'Public-domain films and newsreels — check each item\'s rights (anyone can upload).' },
  { name: 'Library of Congress — National Screening Room', url: 'https://www.loc.gov/collections/national-screening-room/', how: 'Free, no ads', note: 'Films from the national collection marked "no known restrictions".' },
];

export const RISKS = [
  ['Malware through ads', 'Unofficial sites pay for hosting with the worst ad networks. Pop-ups, pop-unders and redirects can lead to malicious downloads and scam pages, sometimes without an obvious click.'],
  ['Fake play buttons', 'The page shows several "play" or "download" buttons; most of them are ads. The real player is often hidden behind an overlay that opens another tab when you click it.'],
  ['"Install this to watch"', 'A prompt to update your player, install a codec, add a browser extension or download an app. A website never needs you to install anything to play a video — this is how most infections start.'],
  ['Notification and extension scams', '"Click Allow to prove you are not a robot" turns on browser notifications that then push scam and adult ads to your desktop. Extensions offered by these sites can read everything you do in the browser.'],
  ['Phishing and card traps', 'Fake sign-up or "free trial" forms asking for a card "to verify your age", or login pages copying real services to steal passwords.'],
  ['Hidden crypto-miners', 'Some pages run code that uses your processor to mine cryptocurrency while you watch — the fan spins up, the battery drains.'],
  ['Tracking and data resale', 'Heavy trackers follow you across the web and sell what they collect.'],
  ['Legal risk', 'Streaming or downloading pirated films can bring copyright notices from your internet provider and, in some countries, fines. It also takes money from the people who made the film.'],
  ['Not safe for children', 'The ads on these sites are frequently explicit or gambling-related.'],
];

export const SIGNS = [
  'The film is still in cinemas, or only on a paid service, but this site has it free.',
  'Several play buttons, or a new tab opens every time you click.',
  'You are asked to install, update, allow notifications or disable your ad blocker before it plays.',
  'The address keeps changing, or the site has many near-identical copies.',
  'There is no company name, no contact, no terms — or the "about" page is empty.',
  'File names like "720p", "x264", "DVDRip", "HDCAM" or "torrent" — the marks of ripped copies.',
];

export const IF_CLICKED = [
  'Close the tab. Do not run or open anything that downloaded.',
  'Delete any downloaded file you did not intend to get.',
  'Remove browser extensions you did not install on purpose.',
  'In your browser settings, remove notification permission from sites you do not recognise.',
  'Run your system\'s built-in security scan (e.g. Windows Security, or your phone\'s protection) and update your browser.',
  'If you typed a password or card number anywhere, change the password (and anywhere you reused it) and call your bank.',
];

export function watchSafelyBody() {
  const services = LEGAL_FREE.map((s) => `<li><a href="${esc(s.url)}" target=_blank rel="noopener noreferrer"><b>${esc(s.name)}</b></a> — <i>${esc(s.how)}</i>. ${esc(s.note)}</li>`).join('');
  const risks = RISKS.map(([h, t]) => `<li><b>${esc(h)}.</b> ${esc(t)}</li>`).join('');
  return `<style>.ws p,.ws li{line-height:1.6;max-width:860px}.ws h2{margin-top:26px}.ws .box{border:1px solid var(--bd);border-radius:12px;padding:12px 16px;max-width:860px;background:var(--panel)}</style>
<div class=ws>
<h1>Watch free films — safely</h1>
<p class=lead>There are plenty of free films online that are legal and safe. There are also a great many "free movie" sites that are neither. Here is how to tell them apart, where to go, and what SoapBox Stream is.</p>

<div class=box><h2 style="margin-top:0">What SoapBox Stream is</h2>
<p><b>Everything that plays here is free to use.</b> We only stream films that are in the public domain, openly licensed (Creative Commons), free-to-air, or published free by their owners. That is how we got them: each film on our shelves has a documented reason it is free — published in 1930 or earlier (public domain in the US by age), a US federal government work, a copyright that was never renewed, or an explicit open licence — and a checked, complete copy.</p>
<p>Every title shows its licence and source. Our player refuses anything it cannot verify, and it automatically turns away uploads that look like ripped copies. Copyrighted films are never played here: in <a href="/films">SoapBox Films</a> we show where each one is legally available and let you rate and review it.</p>
<p>We may grow later — licensed catalogues, perhaps a service like Netflix, Hulu or Tubi. Right now, we are doing free things, done properly.</p></div>

<h2>Legal places to watch free (checked ${esc(CHECKED)})</h2>
<ul>${services}</ul>
<p class=lead>Free catalogues rotate every month. For any single film, <a href="/films">SoapBox Films</a> lists the services it is on.</p>

<h2>The risks of unofficial "free movie" sites</h2>
<p>We don't name or link them. You will recognise them by how they behave:</p>
<ul>${risks}</ul>

<h2>Warning signs</h2>
<ul>${SIGNS.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>

<h2>If you already clicked something</h2>
<ol>${IF_CLICKED.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>

<h2>Good habits</h2>
<ul><li>Use the official apps and websites of the services above.</li><li>Keep your browser and system updated.</li><li>A reputable ad and tracker blocker (for example uBlock Origin) cuts off most of the danger — but never disable it because a site asks.</li><li>Never install anything to watch a video.</li></ul>

<p style="margin-top:22px"><a class=btn href="/">Browse free films on SoapBox Stream</a> <a class=btn href="/films">Find where any film is streaming</a></p>
</div>`;
}
