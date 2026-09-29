// speeches.mjs — famous speeches, addresses, debates, trials and moon broadcasts SoapBox Stream plays free
// (operator 2026-09-29: "update it with famous speeches and debates and things also").
//
// Every entry was checked LIVE on the Internet Archive (item exists, not dark, has a playable video file) and has a
// DOCUMENTED public-domain basis, all from three sources:
//   FEDFLIX — the FedFlix / usgovfilms collection of US government films ("This collection is public domain";
//             National Archives items carry licenseurl creativecommons.org/licenses/publicdomain, FDR Library items
//             carry CC0). Films made by federal agencies (USIA, Army Signal Corps, Air Force, NASA) are US government
//             works, which are not subject to copyright (17 U.S.C. § 105).
//   NEWSREEL — Universal Newsreel: "Universal City Studios gifted Universal Newsreel to the American people, put the
//             newsreels into the public domain, and gave film materials to the National Archives in 1976" (IA
//             collection universal_newsreels).
//   NASA    — NASA-produced film and video (NASA collections on the Internet Archive): US government work.
// `transcript` is an official government page with the text (the words of a US official's speech are a government
// work too); omitted where no official page could be verified. SoapBox's transcript work (Pentecaust) reads it.
//
// Not played, on purpose (see LEADS / EXCLUDED): network-produced debates and broadcasts (1960 Kennedy–Nixon,
// Nixon's 1974 resignation) are network copyright; Martin Luther King Jr.'s "I Have a Dream" is copyrighted by the
// King estate; recordings without a documented federal / PD source (community uploads of the Eisenhower farewell
// address, Reagan at the Brandenburg Gate, FDR's Pearl Harbor address) are listed as leads, not streamed.

import * as archiveVideo from './archive-video.mjs';

const FEDFLIX = 'US government film — FedFlix collection ("This collection is public domain"); 17 U.S.C. § 105';
const NARA = 'National Archives film, marked public domain (US government work, 17 U.S.C. § 105)';
const FDRLIB = 'FDR Presidential Library film, released CC0 (public domain)';
const NEWSREEL = 'Universal Newsreel — put into the public domain by Universal City Studios (1976)';
const NASA = 'NASA film — US government work, 17 U.S.C. § 105';

export const KINDS = [
  { id: 'inaugural', name: 'Inaugurations' },
  { id: 'address', name: 'Addresses to the nation' },
  { id: 'speech', name: 'Speeches' },
  { id: 'debate', name: 'Debates' },
  { id: 'trial', name: 'Trials & tribunals' },
  { id: 'moon', name: 'The Moon' },
  { id: 'film', name: 'Documentaries' },
];

export const SPEECHES = Object.freeze([
  // inaugurations
  { id: '1933-03-05_Extra_Special_Roosevelt_Inaugurated', title: 'Roosevelt inaugurated: "The only thing we have to fear…"', speaker: 'Franklin D. Roosevelt', year: 1933, kind: 'inaugural', why: NEWSREEL, transcript: 'https://www.archives.gov/education/lessons/fdr-inaugural' },
  { id: 'gov.fdr.297', title: "Roosevelt's fourth inaugural (home movie, silent)", speaker: 'Franklin D. Roosevelt', year: 1945, kind: 'inaugural', why: FDRLIB },
  { id: '111-adc-10177', title: 'Inauguration of President Harry S. Truman', speaker: 'Harry S. Truman', year: 1949, kind: 'inaugural', why: `${FEDFLIX}; Army Signal Corps (RG 111)`, transcript: 'https://www.trumanlibrary.gov/library/public-papers/19/inaugural-address' },
  { id: 'gov.archives.arc.37025.r1', title: 'Eisenhower inauguration (reel 1 of 11)', speaker: 'Dwight D. Eisenhower', year: 1953, kind: 'inaugural', why: NARA, transcript: 'https://www.eisenhowerlibrary.gov/sites/default/files/file/1953_inaugural_address.pdf' },
  { id: '342-usaf-29297-r14', title: 'Presidential inauguration of John F. Kennedy', speaker: 'John F. Kennedy', year: 1961, kind: 'inaugural', why: `${FEDFLIX}; US Air Force (RG 342)`, transcript: 'https://www.archives.gov/milestone-documents/president-john-f-kennedys-inaugural-address' },
  { id: '1961-01-23_Inauguration', title: 'Kennedy sworn in: "Ask not what your country can do for you"', speaker: 'John F. Kennedy', year: 1961, kind: 'inaugural', why: NEWSREEL, transcript: 'https://www.archives.gov/milestone-documents/president-john-f-kennedys-inaugural-address' },
  { id: 'gov.archives.arc.29713x', title: 'Inauguration of President Lyndon B. Johnson', speaker: 'Lyndon B. Johnson', year: 1965, kind: 'inaugural', why: `${NARA}; US Information Agency`, transcript: 'https://www.lbjlibrary.org/object/text/presidents-inaugural-address-01-20-1965' },
  { id: '1965-01-25_Inauguration_Highlights', title: 'Johnson inauguration highlights', speaker: 'Lyndon B. Johnson', year: 1965, kind: 'inaugural', why: NEWSREEL, transcript: 'https://www.lbjlibrary.org/object/text/presidents-inaugural-address-01-20-1965' },
  // addresses to the nation
  { id: 'gov.fdr.283', title: 'State of the Union, January 6, 1942', speaker: 'Franklin D. Roosevelt', year: 1942, kind: 'address', why: FDRLIB },
  { id: '111-adc-9865', title: 'Truman announces the atomic bomb', speaker: 'Harry S. Truman', year: 1945, kind: 'address', why: `${FEDFLIX}; Army Signal Corps (RG 111), catalog.archives.gov/id/23630`, transcript: 'https://www.trumanlibrary.gov/library/public-papers/93/statement-president-announcing-use-bomb-hiroshima' },
  { id: 'gov.archives.arc.51510', title: 'Kennedy address on Cuba (the missile crisis)', speaker: 'John F. Kennedy', year: 1962, kind: 'address', why: `${NARA}; US Information Agency` },
  { id: 'gov.archives.arc.48156', title: 'Nixon speaks from the White House on Watergate', speaker: 'Richard Nixon', year: 1973, kind: 'address', why: `${NARA}; US Information Agency` },
  { id: 'gov.archives.arc.48638', title: 'Nixon defends his office on the Watergate charges', speaker: 'Richard Nixon', year: 1973, kind: 'address', why: `${NARA}; US Information Agency` },
  // speeches
  { id: 'gov.fdr.266', title: '"I hate war": the Chautauqua address', speaker: 'Franklin D. Roosevelt', year: 1936, kind: 'speech', why: FDRLIB },
  { id: '1937-10-06_US_Faces_War_Says_Roosevelt', title: '"U.S. faces war": the quarantine speech', speaker: 'Franklin D. Roosevelt', year: 1937, kind: 'speech', why: NEWSREEL },
  { id: '1939-09-20_Roosevelt_Urges_Congress', title: 'Roosevelt urges Congress to revise neutrality', speaker: 'Franklin D. Roosevelt', year: 1939, kind: 'speech', why: NEWSREEL },
  { id: '1940-12-31_Roosevelt_Warns_Of_Danger_If_Nazis_Win_War', title: '"The arsenal of democracy"', speaker: 'Franklin D. Roosevelt', year: 1940, kind: 'speech', why: NEWSREEL },
  { id: '1943-08-26_Roosevelt_Warns_Axis', title: 'Roosevelt warns the Axis', speaker: 'Franklin D. Roosevelt', year: 1943, kind: 'speech', why: NEWSREEL },
  { id: 'gov.fdr.309', title: 'Eleanor Roosevelt on human rights', speaker: 'Eleanor Roosevelt', year: 1948, kind: 'speech', why: FDRLIB },
  { id: '1961-03-13_Peace_Corps', title: 'Kennedy outlines the Peace Corps', speaker: 'John F. Kennedy', year: 1961, kind: 'speech', why: NEWSREEL },
  { id: '1962-09-13_Kennedy_Tour', title: '"We choose to go to the Moon": Kennedy at Rice', speaker: 'John F. Kennedy', year: 1962, kind: 'speech', why: NEWSREEL, transcript: 'https://er.jsc.nasa.gov/seh/ricetalk.htm' },
  // debates
  { id: '1960-05-27_un_spy_debate', title: 'The U.N. spy debate: Lodge shows the bugged eagle', speaker: 'Henry Cabot Lodge Jr.', year: 1960, kind: 'debate', why: NEWSREEL },
  { id: '1960-07-25_rb-47_debate', title: 'The RB-47 debate at the U.N.', speaker: 'Henry Cabot Lodge Jr.', year: 1960, kind: 'debate', why: NEWSREEL },
  { id: '1957-06-03_British_H-Bomb', title: 'The atom test-ban debate', speaker: '', year: 1957, kind: 'debate', why: NEWSREEL },
  // trials
  { id: '1945-11-29_Nuremberg_War_Crimes_Trials_Open', title: 'The Nuremberg war crimes trials open', speaker: '', year: 1945, kind: 'trial', why: NEWSREEL },
  { id: 'gov.archives.arc.35957.b', title: 'Nuremberg (the US Army documentary of the trial)', speaker: '', year: 1950, kind: 'trial', why: `${NARA}; US Army (Stuart Schulberg)` },
  // the Moon
  { id: 'gov.archives.arc.45017', title: 'The Eagle Has Landed: The Flight of Apollo 11', speaker: '', year: 1969, kind: 'moon', why: NARA, transcript: 'https://www.nasa.gov/history/alsj/a11/a11.html' },
  { id: 'gov.archives.arc.7500', title: 'Apollo 11: One Giant Leap for Mankind', speaker: '', year: 1969, kind: 'moon', why: NARA, transcript: 'https://www.nasa.gov/history/alsj/a11/a11.html' },
  { id: 'PartiallyRestoredVideoEventsFromTheApollo11Mission', title: 'Apollo 11: the restored Moon-walk video', speaker: 'Neil Armstrong', year: 1969, kind: 'moon', why: NASA, transcript: 'https://www.nasa.gov/history/alsj/a11/a11.html' },
  // documentaries
  { id: 'gov.fdr.44', title: 'Why We Fight: Prelude to War', speaker: 'Frank Capra (US War Department)', year: 1942, kind: 'film', why: `${FDRLIB}; US War Department film` },
  { id: 'gov.archives.arc.2569682', title: 'The Big Picture: The Douglas MacArthur Story', speaker: 'US Army', year: 1964, kind: 'film', why: `${NARA}; US Army` },
]);

/** Famous items we point to but do not play (no documented public-domain copy). */
export const LEADS = Object.freeze([
  { title: 'The Kennedy–Nixon debates', year: 1960, why: 'network-produced broadcasts (copyright CBS/NBC/ABC)', where: 'JFK Presidential Library and C-SPAN', href: 'https://www.jfklibrary.org/learn/about-jfk/jfk-in-history/kennedy-nixon-debates' },
  { title: "Eisenhower's farewell address (the military-industrial complex)", year: 1961, why: 'no copy with a documented federal source on the Internet Archive yet', where: 'Eisenhower Presidential Library; text at the National Archives', href: 'https://www.archives.gov/milestone-documents/president-dwight-d-eisenhowers-farewell-address' },
  { title: "Roosevelt's Pearl Harbor address (\"a date which will live in infamy\")", year: 1941, why: 'uploads found have no documented public-domain source', where: 'FDR Presidential Library; National Archives', href: 'https://catalog.archives.gov/' },
  { title: "Nixon's resignation address", year: 1974, why: 'network broadcast footage', where: 'Nixon Presidential Library', href: 'https://www.nixonlibrary.gov/' },
  { title: 'Reagan at the Brandenburg Gate ("Tear down this wall")', year: 1987, why: 'no White House Communications Agency copy found on the Internet Archive', where: 'Reagan Presidential Library', href: 'https://www.reaganlibrary.gov/' },
  { title: 'The Army–McCarthy hearings', year: 1954, why: 'network kinescopes; no documented public-domain copy found', where: 'Library of Congress / C-SPAN', href: 'https://www.loc.gov/' },
]);

export const EXCLUDED = Object.freeze([
  { title: 'Martin Luther King Jr., "I Have a Dream"', year: 1963, why: 'copyrighted by the King estate (Estate of Martin Luther King, Jr. v. CBS)' },
]);

archiveVideo.registerClearedIds(SPEECHES.map((s) => s.id));

export const speechesByKind = () => KINDS.map((k) => ({ ...k, items: SPEECHES.filter((s) => s.kind === k.id).sort((a, b) => a.year - b.year) })).filter((k) => k.items.length);
export const speechById = (id) => SPEECHES.find((s) => s.id === String(id)) || null;

/** a stream tile — same shape as classic-films' classicTile; plays through IA's official player */
export function speechTile(s) {
  if (!s || !s.id) return null;
  const id = String(s.id);
  return {
    id, title: s.title, kind: 'film', year: String(s.year), creator: s.speaker || (KINDS.find((k) => k.id === s.kind) || {}).name || '',
    thumb: `https://archive.org/services/img/${id}`,
    streamUrl: `https://archive.org/embed/${id}`, embedUrl: `https://archive.org/embed/${id}`,
    license: 'Public domain (curated by SoapBox Stream)', licenseToken: 'public-domain',
    source: 'Internet Archive', attribution: `Internet Archive — ${id}`, posture: 'window',
    details: `https://archive.org/details/${id}`, href: `https://archive.org/details/${id}`,
    transcript: s.transcript || '',
  };
}
