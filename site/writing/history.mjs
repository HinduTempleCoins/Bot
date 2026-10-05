// history.mjs — what actually happened to NaNoWriMo, kept as DATA so the web page, Hathor's post and
// the tests all read the same facts from one place.
//
// THE RULE HERE IS THE LIBRARY'S RULE: every claim carries a grade.
//   'established' — reported by multiple outlets / the organisation itself
//   'contested'   — widely repeated but the detail is disputed or the causation is not supported
//   'unverified'  — circulated in summaries we were handed, but we could not confirm it exists
// An unverified organisation is NOT listed as though it exists. Three entries in the briefing we were
// given turned out to be unconfirmable and are recorded below as exactly that, rather than deleted —
// so the next person does not "rediscover" them and put them back.

export const TIMELINE = [
  { when: '1999', grade: 'established',
    what: 'Chris Baty starts NaNoWriMo with 21 friends in the San Francisco Bay Area. It becomes a non-profit and, at its peak, draws hundreds of thousands of writers a year to the same deal: 50,000 words, 30 days, start November 1.' },
  { when: 'May 2023', grade: 'established',
    what: 'Users raise a child-safety complaint about a long-time volunteer moderator on the Young Writers Program forums, alleging that minors were being directed off-platform to adult content. Reports describe the organisation as slow to acknowledge or act.' },
  { when: 'November 2023', grade: 'established',
    what: 'The forums are taken down entirely rather than moderated. The moderator is eventually removed — but for unrelated code-of-conduct violations, not the grooming allegation itself. That distinction matters and is usually dropped in retellings.' },
  { when: '2023–2024', grade: 'contested',
    what: 'Executive director Grant Faulkner departs and Kilby Blades becomes interim executive director. Faulkner is often said to have resigned *over* the moderation scandal; the public record shows the departure but not that causation. We record the sequence, not the motive.' },
  { when: 'Early 2024', grade: 'contested',
    what: 'A new contract for Municipal Leaders — the unpaid volunteers who ran local write-ins — is widely reported to have demanded non-disparagement and liability terms that volunteers found unacceptable, prompting resignations. The resignations are well attested; the exact contract terms circulate mostly second-hand.' },
  { when: 'September 2024', grade: 'established',
    what: 'NaNoWriMo publishes a statement describing blanket opposition to generative AI in writing as "classist and ableist." The backlash is immediate: board members Maureen Johnson and Daniel José Older resign, sponsors and authors cut ties. The organisation later walks the wording back. This is the moment most people remember.' },
  { when: 'March 31, 2025', grade: 'established',
    what: 'Interim executive director Kilby Blades announces the non-profit is dissolving. The stated cause is financial: a deficit in four of the previous six years, a 2020 COVID relief loan, and a six-year decline in participation. The organisation explicitly framed it as a long trend rather than a single scandal — the controversies accelerated the loss of donors and trust, they were not the sole cause.' },
  { when: 'After', grade: 'established',
    what: 'The site, the database and the historical archives go offline. Twenty-five years of writers\' records — word counts, forum history, regions, buddy lists — are simply gone. No organisation has revived the name.' },
];

/** Where the 50,000-word challenge actually went. Only entries we could confirm. */
export const SUCCESSORS = [
  { name: 'Novel November (NovNov)', by: 'ProWritingAid', kind: 'commercial',
    what: 'The most prominent organised successor, launched 2025 by a former NaNoWriMo partner. Same 50,000 words, same November, workshops and word-count syncing.' },
  { name: 'Reedsy Novel Sprint', by: 'Reedsy', kind: 'commercial',
    what: 'November 1–30 inside Reedsy Studio. 50,000+ words, cash prizes ($5,000 / $2,500 / $1,000), an agent call and Studio Premium for finishers.' },
  { name: 'NovelEmber', by: 'World Anvil', kind: 'commercial',
    what: 'Created 2024, aimed at fantasy, sci-fi and worldbuilders — worldbuilding articles can count alongside prose.' },
  { name: 'NovelDoctober', by: 'community', kind: 'grassroots',
    what: 'Expanded in 2025 into a community-run November sprint with no central organisation and no fees — a loose federation of Discord servers and hashtags running the same 50k in 30 days.' },
  { name: '4thewords', by: 'independent', kind: 'game',
    what: 'An RPG where your word count is the combat mechanic — you defeat monsters by writing. It absorbed a large share of displaced NaNoWriMo users.' },
  { name: 'Authorlytica', by: 'independent', kind: 'tracker',
    what: 'A year-round tracker: streaks, pace projection, 50,000-word goals in any month, with a free tier.' },
  { name: 'Local Discords and regional groups', by: 'former Municipal Leaders', kind: 'grassroots',
    what: 'Many of the volunteers who ran local write-ins simply kept running them, independently, without the brand.' },
];

/** Claims we were handed that we could NOT confirm. Kept visible on purpose. */
export const UNVERIFIED = [
  'Pathfinders Writing Collective (#PaWriCo)',
  'Order of the Written Word (O2W)',
  "AutoCrit's \"Novel 90\"",
  '"NaNo 2.0" as an organisation distinct from Novel November',
];

/** The lesson we actually built against. */
export const LESSONS = [
  ['The archive was the real loss.', 'Not the brand — the records. Twenty-five years of word counts and forum history vanished because they lived on one organisation\'s servers, under one organisation\'s budget. A writing tool should not be able to take your work with it when it dies.'],
  ['Centralised moderation failed the people it was for.', 'Reports went to one inbox and sat there. The volunteers closest to the harm had the least power to act.'],
  ['The AI fight was handled as PR, not as a position.', 'A sweeping claim, a backlash, a walk-back. Writers were never offered a way to simply say what they used.'],
  ['Unpaid volunteers carried it and were the first to be squeezed.', 'The local organisers were the product and were handed liability.'],
  ['Money, not drama, closed it.', 'Four deficit years out of six. The scandals cost trust and donors, but the arithmetic is what ended it.'],
];
