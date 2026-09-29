// classic-films.mjs — big old PUBLIC-DOMAIN classics that SoapBox Stream plays free (operator 2026-09-29).
//
// Every entry was checked LIVE on the Internet Archive (item exists, is a movie, has a complete playable video, is
// not a trailer / clip / colorized recut / rip) and has a DOCUMENTED public-domain reason:
//   - 'published ≤1930'      → public domain in the US by age (95-year term);
//   - 'copyright not renewed' / 'listed PD' → listed in Wikipedia's "List of films in the public domain in the United
//     States" (checked 2026-09-29), with no caveat about still-copyrighted music, songs or script.
// Excluded on purpose (their PD status is disputed or partial):
//   The Scarlet Pimpernel (1934) — a UK film; the 1996 URAA restored US copyright for foreign works still protected
//     at home, and no PD documentation exists. Charade, McLintock!, The Last Time I Saw Paris (music still under
//     copyright), Jack and the Beanstalk 1952 (songs), My Man Godfrey (script, Stewart v. Abend), The Man with the
//     Golden Arm (based on a copyrighted novel), It's a Wonderful Life (story/music).
// Silent films may carry a later musical track on some uploads; the film itself is PD by age.
//
// The ids are registered as cleared with archive-video's licence check at import, so /watch plays them.

import * as archiveVideo from './archive-video.mjs';

const N = 'copyright not renewed (Wikipedia: List of films in the public domain in the United States)';
const L = 'listed as public domain in the US (Wikipedia: List of films in the public domain in the United States)';
const A = 'published ≤1930 — public domain in the US by age';

export const GENRES = [
  { id: 'comedy', name: 'Comedy' }, { id: 'drama', name: 'Drama' }, { id: 'romance', name: 'Romance' },
  { id: 'noir', name: 'Film noir & crime' }, { id: 'adventure', name: 'Adventure & swashbucklers' },
  { id: 'western', name: 'Westerns' }, { id: 'musical', name: 'Musicals' }, { id: 'animation', name: 'Animation & family' },
  { id: 'silent', name: 'Silent classics' },
];

export const PD_CLASSICS = Object.freeze([
  // comedy
  { id: 'his_girl_friday', title: 'His Girl Friday', year: 1940, genre: 'comedy', why: N },
  { id: 'NothingSacred', title: 'Nothing Sacred', year: 1937, genre: 'comedy', why: N },
  { id: 'Topper_Returns_41', title: 'Topper Returns', year: 1941, genre: 'comedy', why: N },
  { id: 'AfricaScreams', title: 'Africa Screams', year: 1949, genre: 'comedy', why: N },
  { id: 'road-to-bali', title: 'Road to Bali', year: 1952, genre: 'comedy', why: N },
  { id: 'beat-the-devil-1953_202406', title: 'Beat the Devil', year: 1953, genre: 'comedy', why: N },
  // drama
  { id: 'AStarIsBorn', title: 'A Star Is Born', year: 1937, genre: 'drama', why: N },
  { id: 'meet_john_doe', title: 'Meet John Doe', year: 1941, genre: 'drama', why: N },
  { id: 'humanbondage', title: 'Of Human Bondage', year: 1934, genre: 'drama', why: N },
  { id: 'Our_Town', title: 'Our Town', year: 1940, genre: 'drama', why: L },
  { id: 'TheSoutherner', title: 'The Southerner', year: 1945, genre: 'drama', why: L },
  { id: 'SaltOfTheEarth_735', title: 'Salt of the Earth', year: 1954, genre: 'drama', why: N },
  { id: 'rain1932', title: 'Rain', year: 1932, genre: 'drama', why: N },
  { id: 'abraham_lincoln', title: 'Abraham Lincoln', year: 1930, genre: 'drama', why: A },
  // romance
  { id: 'penny_serenade', title: 'Penny Serenade', year: 1941, genre: 'romance', why: N },
  { id: 'made_for_each_other_film', title: 'Made for Each Other', year: 1939, genre: 'romance', why: L },
  // noir & crime
  { id: 'TheStranger_0', title: 'The Stranger', year: 1946, genre: 'noir', why: N },
  { id: 'Detour', title: 'Detour', year: 1945, genre: 'noir', why: N },
  { id: 'd.-o.-a.-1950', title: 'D.O.A.', year: 1949, genre: 'noir', why: N },
  { id: 'kansascityconfidencial', title: 'Kansas City Confidential', year: 1952, genre: 'noir', why: N },
  { id: 'suddenly', title: 'Suddenly', year: 1954, genre: 'noir', why: N },
  { id: 'ScarletStreet', title: 'Scarlet Street', year: 1945, genre: 'noir', why: L },
  { id: 'Hitch_Hiker', title: 'The Hitch-Hiker', year: 1953, genre: 'noir', why: L },
  { id: 'Quicksand_clear', title: 'Quicksand', year: 1950, genre: 'noir', why: L },
  { id: 'TheChase_', title: 'The Chase', year: 1946, genre: 'noir', why: `${L}; an independent film left without an owner` },
  // adventure
  { id: 'CaptainKidd_', title: 'Captain Kidd', year: 1945, genre: 'adventure', why: L },
  { id: 'FairbanksRobinHood1922', title: 'Robin Hood', year: 1922, genre: 'adventure', why: A },
  { id: 'vidzo', title: 'The Mark of Zorro', year: 1920, genre: 'adventure', why: A },
  { id: 'vidtb', title: 'The Thief of Bagdad', year: 1924, genre: 'adventure', why: A },
  { id: 'lost_world', title: 'The Lost World', year: 1925, genre: 'adventure', why: A },
  // westerns
  { id: 'angel_and_the_badman', title: 'Angel and the Badman', year: 1947, genre: 'western', why: N },
  { id: 'the-outlaw-1943-western-old-movie', title: 'The Outlaw', year: 1943, genre: 'western', why: N },
  { id: 'TheGreatTrainRobbery_555', title: 'The Great Train Robbery', year: 1903, genre: 'western', why: A },
  // musicals
  { id: 'royal_wedding', title: 'Royal Wedding', year: 1951, genre: 'musical', why: N },
  // animation & family
  { id: 'gullivers_travels1939', title: "Gulliver's Travels", year: 1939, genre: 'animation', why: N },
  { id: 'TheLittlePrincess1939', title: 'The Little Princess', year: 1939, genre: 'animation', why: N },
  // silent classics
  { id: 'metropolis-1927-english-titles', title: 'Metropolis', year: 1927, genre: 'silent', why: A },
  { id: 'The_General_Buster_Keaton', title: 'The General', year: 1926, genre: 'silent', why: A },
  { id: 'MyMovie_20190318', title: 'Sherlock Jr.', year: 1924, genre: 'silent', why: A },
  { id: 'steamboat_bill_ipod', title: 'Steamboat Bill, Jr.', year: 1928, genre: 'silent', why: A },
  { id: 'silent-safety-last', title: 'Safety Last!', year: 1923, genre: 'silent', why: A },
  { id: 'the-gold-rush-film-1925', title: 'The Gold Rush', year: 1925, genre: 'silent', why: `${A} (the original 1925 cut, silent)` },
  { id: 'BattleshipPotemkin', title: 'Battleship Potemkin', year: 1925, genre: 'silent', why: A },
  { id: 'sunrise_1927', title: 'Sunrise: A Song of Two Humans', year: 1927, genre: 'silent', why: A },
  { id: 'passion-of-joan-of-arc-rendered', title: 'The Passion of Joan of Arc', year: 1928, genre: 'silent', why: A },
  { id: 'ATripToTheMoonGeorgeMelies', title: 'A Trip to the Moon', year: 1902, genre: 'silent', why: A },
]);

export const EXCLUDED = Object.freeze([
  { title: 'The Scarlet Pimpernel', year: 1934, why: 'UK film; US copyright restored by the URAA (1996); no public-domain documentation' },
  { title: 'Charade', year: 1963, why: 'music still under copyright' },
  { title: 'McLintock!', year: 1963, why: 'music score still under copyright' },
  { title: 'The Last Time I Saw Paris', year: 1954, why: 'music score still under copyright' },
  { title: 'Jack and the Beanstalk', year: 1952, why: 'songs still under copyright' },
  { title: 'My Man Godfrey', year: 1936, why: 'script still under copyright (Stewart v. Abend)' },
  { title: 'The Man with the Golden Arm', year: 1955, why: 'based on a copyrighted novel' },
]);

archiveVideo.registerClearedIds(PD_CLASSICS.map((f) => f.id));

export const classicsByGenre = () => GENRES.map((g) => ({ ...g, films: PD_CLASSICS.filter((f) => f.genre === g.id) })).filter((g) => g.films.length);

/** a stream tile for a classic — same shape as horror-taxonomy's toTile; plays through IA's official player */
export function classicTile(f) {
  if (!f || !f.id) return null;
  const id = String(f.id);
  return {
    id, title: f.title, kind: 'film', year: String(f.year), creator: (GENRES.find((g) => g.id === f.genre) || {}).name || '',
    thumb: `https://archive.org/services/img/${id}`,
    streamUrl: `https://archive.org/embed/${id}`, embedUrl: `https://archive.org/embed/${id}`,
    license: 'Public domain (curated by SoapBox Stream)', licenseToken: 'public-domain',
    source: 'Internet Archive', attribution: `Internet Archive — ${id}`, posture: 'window',
    details: `https://archive.org/details/${id}`, href: `https://archive.org/details/${id}`,
  };
}
