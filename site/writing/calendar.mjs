// calendar.mjs — the other national months, kept as DATA.
//
// WHY THIS EXISTS. The whole claim on this surface is that November is a NATIONAL MONTH — a civic
// observance, not a charity's product — and that a national month does not belong to whoever was
// hosting the scoreboard. That is an assertion until you show the category. So: here is the category.
//
// The detail that settles it is in the first entry. National Poetry Month was deliberately modelled
// on Black History Month and Women's History Month — the Academy of American Poets convened
// publishers, librarians, booksellers and teachers in 1995 to build one. Nobody thinks the Academy
// OWNS April. That is exactly the relationship a non-profit has to a month.
//
// Every entry below was checked by name, individually. The four writing groups that were briefly
// and wrongly graded "unverified" on this surface got that way from one broad search, and this file
// is not going to repeat it.

export const CALENDAR = [
  { name: 'National Poetry Month', when: 'April', since: 1996, by: 'Academy of American Poets',
    what: 'The big one, and the template. Convened in 1995 by the Academy with publishers, booksellers, librarians and teachers, and deliberately modelled on Black History Month and Women\'s History Month. Now the largest literary celebration in the world — and nobody imagines the Academy owns April.' },
  { name: 'NaPoWriMo', when: 'April', since: 2003, by: 'Maureen Thorson',
    what: 'National Poetry Writing Month. A poem a day for thirty days, started by one poet daring herself and inviting anyone who wanted to come along. It grew inside National Poetry Month without being run by it — which is the whole point: a month can hold more than one thing.' },
  { name: 'National Day on Writing', when: 'October 20', since: 2009, by: 'National Council of Teachers of English',
    what: 'A single day rather than a month, established to draw attention to the sheer variety of writing people actually do — and to get writers of every kind to notice they have a craft.' },
  { name: 'Inktober', when: 'October', since: 2009, by: 'Jake Parker',
    what: 'One ink drawing a day for thirty-one days. Started by one illustrator to improve his own inking and became a global habit. Proof that these things do not need an institution at all — they need a date and a rule.' },
  { name: 'NaNoGenMo', when: 'November', since: 2013, by: 'Darius Kazemi',
    what: 'National Novel GENERATION Month, started on a whim: spend November writing code that writes a 50,000-word novel, then publish the code and the novel. It runs on a GitHub repo. No organisation, no sign-up, no servers holding anyone\'s work — and it has outlived the charity it was parodying.' },
];

/** The argument the calendar is making. */
export const CIVIC = 'None of these is a company and none of them is property. A national month is a date plus a dare, kept by whoever turns up — and the ones that have lasted longest are the ones with the least organisation behind them. NaNoGenMo has run every November since 2013 out of a GitHub repository, with nothing that can go bankrupt.';
