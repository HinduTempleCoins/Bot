// horror-map.mjs — the full text and shelves of the operator's two horror papers, as data for SoapBox Stream:
//   "A Map of Horror" (the argument, the thread, the borders, every genre shelf with its titles, national cinemas,
//   where to watch, the eight-genre proposal) and "Girl Has to Kill Everyone" (every wing, table and lead).
// horror-taxonomy.mjs keeps the 8-genre model + survival-wing categories + public-domain stock; this module is the
// complete catalogue those pages link into. Pure data + tiny helpers. Titles are reference entries (where-to-watch
// leads), never streams.
//
// Operator notes carried here (2026-09-29):
//   - the core of "Girl Has to Kill Everyone" is the trafficking / captivity side (a whole operation to get through).
//     One girl vs one attacker, and home / work invasion, FIT the genre but are not primary, and are much slower
//     to watch.
//   - The Liability (2012) and Taken (2008) are almost on-genre, but they are not a girl killing everyone.

const T = (s) => s.split(' · ').map((x) => {
  const m = /^(.*?)\s*\(([^)]*)\)\s*(.*)$/.exec(x.trim());
  return m ? { t: m[1].trim(), y: m[2].trim(), note: m[3].trim() } : { t: x.trim(), y: '', note: '' };
});

export const ARGUMENT = [
  'Horror and thriller are collapsing into one marketing category, and the collapse is backwards. It is treated as horror being absorbed into thriller — horror as the intense end of a thriller spectrum, thriller as the respectable parent. That gets the sizes wrong.',
  'Consider what "thriller" is being asked to hold. Nerve (2016) is a thriller: teenagers take dares from an app, and one of them rides a motorcycle blindfolded at speed through city traffic. Zodiac is a thriller. Rear Window is a thriller. Fight Club is a thriller. These four films share almost nothing — not a tone, not a fear, not an audience, not a decade. Thriller is doing so little work that it can cover a dare app and a 70s serial-killer investigation with the same word.',
  'Now consider what horror is being asked to fit inside that. This map holds 48 categories, and each of the following could stand alone as a top-level genre by any standard we apply to comedy or western or musical: supernatural horror (its own cosmology, its own rules, its own century of tradition); slasher (a body count, archetypes, set-piece kills, a final girl — more internal grammar than the entire thriller category); body horror (Cronenberg to Ducournau — the fear is anatomical, not situational); cosmic horror (a philosophical position with a film form attached); survival and captivity horror (mechanical, not emotional — where Girl Has to Kill Everyone lives); folk horror (the land, the village, the old practice, with its own national traditions in at least six countries); creature and kaiju (from Jaws to Shin Godzilla — scale is the entire subject); exploitation and grindhouse (a production mode, a distribution history, and an aesthetic, not just a violence level).',
  'Each of those has more defined internal rules than "thriller" does. Each has its own canon, its own national schools, its own decade-cycles, its own audience that will not cross over. A person who loves Lake Mungo may have no use for The Devil\'s Rejects, and neither of them is confused about what they are watching.',
  'The vastness is the point. Horror is not a genre that got intense. It is a family of genres that never got separated, and the thriller merger is making that worse — flattening a family into a mood.',
];

export const THREAD = [
  'I don\'t watch a lot of horror movies maybe like I used to, but when I do watch movies that\'s what I usually pick. I\'m not against comedy movies — the three movies we watched almost every day as kids were Fear and Loathing in Las Vegas, Blow, and Dazed and Confused, so not exactly the scariest movies. But we would always show new people Hostel and things. I write this thread because I want to discuss good and then sometimes obscure horror movies if anyone knows of any, and because some people say "I don\'t like horror movies" and may not understand all that exists. And maybe a lot of people don\'t.',
  'When I was in like 1st grade and my sister was in kindergarten, we were hiding behind the couch watching Candyman, and that was maybe the first scary movie we saw. My sister was scared to be near a mirror alone for at least a week. After that, my mom took me to the movies to see rated R movies, and by 3rd grade there are kids asking me to describe movies to them because they\'d never be allowed to see them.',
  'By middle school we are at Blockbuster once a day getting two movies because we are members. I\'ve seen BAD movies. Low, low budget movies. Example: S.I.C.K.: Serial Insane Clown Killer. Costumes: K Mart.',
];

export const USUAL_SETUP = {
  intro: 'Most people know the cabin movie. But it could be:',
  places: 'A house in the suburbs or on a mountain · a road trip passing through the backwoods · a wrong turn · a motel · a gas station · a phone booth · a vacation · a plane ride · an archaeological expedition · a boat ride · a camping trip · a police station · a museum · a webcam in a bedroom · a department store · Christmas · New Year\'s · Valentine\'s Day · a leprechaun · a hospital · a cemetery.',
  body: 'It could be anything really, but it starts off casual, showing the characters kind of having fun even. Often it\'s college kids or teenagers, a reuniting group of friends, or a group that volunteered for a clinical trial — some casual group that can get to know each other, and it gets to where they\'re all comfortable as something builds up and gets to a boil. But usually there was some kind of warning. Saw is a different model, where that\'s not how everyone meets. But the "fun casual build-up" is the cliché horror intro. Then it happens, whatever it is.',
  lines: ['People were living in the woods waiting for nightfall.', 'They stalked your social media account here.'],
};

// Part Two — the borders
export const BORDERS = [
  { id: 'thriller', title: 'Thriller — light horror all around', note: 'The mechanism is dread and pressure rather than monstrosity. Psychological thriller is the useful subgenre name here.',
    titles: T('Nerve (2016) · 13 Sins (2014) · Saw (2004) · Phone Booth (2002) · Lila & Eve (2015) · Fight Club (1999) · Disturbia (2007) · Day 13 (2020) · Triangle (2009) · Rear Window (1954) · The Vanishing (1988) · Prisoners (2013) · Nightcrawler (2014) · Gone Girl (2014) · Berberian Sound Studio (2012) · Coherence (2013) · The Invitation (2015) · Unsane (2018) · The Gift (2015)') },
  { id: 'scifi-ship', title: 'Sci-fi horror: ship and station', note: 'Sci-fi horror is not a sub-branch, it is an overlap zone, and it is enormous.',
    titles: T('Alien (1979) · Aliens (1986) · Event Horizon (1997) · Life (2017) · Sunshine (2007) · Pandorum (2009) · Sputnik (2020) · Underwater (2020) · Ash (2025)') },
  { id: 'scifi-experiment', title: 'Sci-fi horror: experiment gone wrong', titles: T('The Fly (1986) · Hollow Man (2000) · Splice (2009) · Altered States (1980) · From Beyond (1986) · Re-Animator (1985) · The Lazarus Effect (2015) · Possessor (2020)') },
  { id: 'scifi-invasion', title: 'Sci-fi horror: invasion and replacement', titles: T('Invasion of the Body Snatchers (1956) · Invasion of the Body Snatchers (1978) · The Thing (1982) · They Live (1988) · Under the Skin (2013) · Annihilation (2018) · No One Will Save You (2023) · Nope (2022)') },
  { id: 'scifi-cryptid', title: 'Sci-fi horror: cryptid and creature science', note: 'The Area 51 shelf you could watch for a year.',
    titles: T('The Descent (2005) · Prophecy (1979) · Willow Creek (2013) · Exists (2014) · The Host (2006) · Tremors (1990) · Love and Monsters (2020)') },
  { id: 'crime-noir', title: 'Crime and noir', note: 'Sometimes the horror is just people.',
    titles: T('Memories of Murder (2003) · Zodiac (2007) · Angel Heart (1987) · Blood Simple (1984) · I Saw the Devil (2010) · Sinister (2012) · Hard Candy (2005)') },
];

// Part Three — the genres (g = the standalone genre it resolves into under The Proposal)
export const SHELVES = [
  { id: 'home-invasion', title: 'Home Invasion', g: 'survival', note: 'Not because it\'s the best — because there are lots of these.',
    titles: T('Intruders / Shut In (2015) · Funny Games (1997) · Funny Games (2007) · Panic Room (2002) · The Woman in Cabin 10 (2025) · The Purge (2013) · The Strangers (2008) · Them / Ils (2006) · Inside / À l\'intérieur (2007) · Hush (2016) · You\'re Next (2011) · Don\'t Breathe (2016) · Better Watch Out (2016) · Kidnapped / Secuestrados (2010) · When a Stranger Calls (1979) · Wait Until Dark (1967) · Barbarian (2022)') },
  { id: 'backwoods', title: 'Backwoods / Wrong Turn / Motel / Hostage / Escape', g: 'survival', note: 'Also where the whole Girl Has to Kill Everyone section lives.',
    titles: T('The Hills Have Eyes (1977) · The Hills Have Eyes (2006) · Wrong Turn (2003) · King of the Hill / El Rey de la Montaña (2007) · Eden Lake (2008) · Deliverance (1972) · The Texas Chain Saw Massacre (1974) · Wolf Creek (2005) · Vacancy (2007) · Killing Ground (2016) · Calibre (2018) · Preservation (2014) · Southern Comfort (1981) · Bone Tomahawk (2015) · The Ritual (2017)') },
  { id: 'serial-killer', title: 'Serial Killer / Monster', g: 'slasher',
    titles: T('IT (1990) · IT (2017) · A Nightmare on Elm Street (1984) · Friday the 13th (1980) · Candyman (1992) · Halloween (1978) · Wolf Creek (2005) · I Know What You Did Last Summer (1997) · The Eyes of My Mother (2016) · Henry: Portrait of a Serial Killer (1986) · Maniac (1980) · Maniac (2012) · Peeping Tom (1960) · M (1931) · The Silence of the Lambs (1991) · Creep (2014) · The Poughkeepsie Tapes (2007) · Terrifier (2016)') },
  { id: 'haunting', title: 'Haunting', g: 'supernatural',
    titles: T('The Shining (1980) · The Changeling (1980) · The Innocents (1961) · The Haunting (1963) · Lake Mungo (2008) · Session 9 (2001) · The Orphanage (2007) · Kwaidan (1964) · Kuroneko (1968) · Ju-On (2002) · Ringu (1998) · Dark Water (2002) · A Tale of Two Sisters (2003) · The Others (2001) · Skinamarink (2022) · A Ghost Story (2017)') },
  { id: 'ancient-magic', title: 'Ancient Magic', g: 'supernatural',
    titles: T('Pet Sematary (1989) · Thinner (1996) · Sleepwalkers (1992) · The Wicker Man (1973) · Midsommar (2019) · A Dark Song (2016) · The Golem (2018) · Talk to Me (2022) · Viy (1967) · Lokis (1970) · The Mummy (1932) · Drag Me to Hell (2009) · Jeepers Creepers (2001)') },
  { id: 'witchcraft', title: 'Witchcraft', g: 'supernatural',
    titles: T('Häxan (1922) · The Witch (2015) · Suspiria (1977) · Suspiria (2018) · Black Sunday (1960) · The Love Witch (2016) · Hagazussa (2017) · November (2017) · The Blair Witch Project (1999) · Ouija (2014) · The Blackcoat\'s Daughter (2015) · Season of the Witch (1972) · The Craft (1996)') },
  { id: 'folk-horror', title: 'Folk Horror', g: 'supernatural', note: 'Distinct from witchcraft: the land and the village are the threat.',
    titles: T('The Wicker Man (1973) · Kill List (2011) · Apostle (2018) · The Wailing (2016) · Gaia (2021) · Lamb (2021) · In the Earth (2021) · Blood on Satan\'s Claw (1971) · Witchfinder General (1968) · The Dark and the Wicked (2020) · Men (2022) · Impetigore (2019)') },
  { id: 'possession', title: 'Possession / Exorcism', g: 'supernatural',
    titles: T('The Exorcist (1973) · The Exorcism of Emily Rose (2005) · Deliver Us From Evil (2014) · The Devil\'s Backbone (2001) · Hereditary (2018) · The Taking of Deborah Logan (2014) · Talk to Me (2022) · The Last Exorcism (2010) · Possession (1981) · The Devils (1971) · Veronica (2017) · The Medium (2021)') },
  { id: 'cosmic-lovecraftian', title: 'Cosmic / Lovecraftian', g: 'cosmic', note: 'Where Black Mountain Side sits.',
    titles: T('In the Mouth of Madness (1994) · Color Out of Space (2019) · Annihilation (2018) · The Void (2016) · Event Horizon (1997) · The Empty Man (2020) · The Endless (2017) · Black Mountain Side (2014) · The Lighthouse (2019) · Banshee Chapter (2013) · The Beyond (1981) · Prince of Darkness (1987)') },
  { id: 'body-horror', title: 'Body Horror', g: 'body',
    titles: T('The Fly (1986) · The Thing (1982) · Videodrome (1983) · Society (1989) · Tetsuo: The Iron Man (1989) · Possessor (2020) · Titane (2021) · In My Skin (2002) · American Mary (2012) · Raw (2016) · The Substance (2024) · Slither (2006) · Dead Ringers (1988) · Contracted (2013)') },
  { id: 'zombie', title: 'Post-Apocalyptic / Zombie', g: 'cosmic',
    titles: T('28 Days Later (2002) · Pontypool (2008) · The Girl with All the Gifts (2016) · Train to Busan (2016) · The Sadness (2021) · [REC] (2007) · The Battery (2012) · Cargo (2017) · Night of the Living Dead (1968) · Dawn of the Dead (1978) · Dawn of the Dead (2004) · The Road (2009) · It Comes at Night (2017) · Bird Box (2018) · A Quiet Place (2018)') },
  { id: 'creature', title: 'Creature Feature', g: 'monster',
    titles: T('Tremors (1990) · The Descent (2005) · Crawl (2019) · The Host (2006) · The Shallows (2016) · Grabbers (2012) · Jaws (1975) · The Mist (2007) · Splinter (2008) · Bone Tomahawk (2015) · Willow Creek (2013) · Burning Bright (2010)') },
  { id: 'torture', title: 'Torture / Extremity', g: 'body',
    titles: T('Hostel (2005) · Saw (2004) · Martyrs (2008) · Frontier(s) (2007) · High Tension (2003) · The Human Centipede (2009) · A Serbian Film (2010) · Irreversible (2002) · Audition (1999) · Ichi the Killer (2001) · Captivity (2007) · The Girl Next Door (2007)') },
  { id: 'cult', title: 'Cult / Compound', g: 'psychological',
    titles: T('Martha Marcy May Marlene (2011) · The Sacrament (2013) · Red State (2011) · Faults (2014) · The Endless (2017) · Midsommar (2019) · The Invitation (2015) · Kill List (2011) · Apostle (2018) · Sound of My Voice (2011)') },
  { id: 'found-footage', title: 'Found Footage', g: 'psychological',
    titles: T('[REC] (2007) · Noroi: The Curse (2005) · Lake Mungo (2008) · The Poughkeepsie Tapes (2007) · Creep (2014) · Host (2020) · Man Finds Tape (2025) · The Blair Witch Project (1999) · Gonjiam: Haunted Asylum (2018) · Grave Encounters (2011) · Cannibal Holocaust (1980) · Trollhunter (2010) · Deadstream (2022)') },
  { id: 'screen-life', title: 'Webcam / Screen Life', g: 'psychological', note: 'Usually haunting, but now its own genre.',
    titles: T('Unfriended (2014) · Host (2020) · Cam (2018) · Searching (2018) · Megan Is Missing (2011) · The Den (2013) · Open Windows (2014) · Deadstream (2022) · Dashcam (2021)') },
  { id: 'techno-ai', title: 'Techno / AI', g: 'cosmic',
    titles: T('Kimi (2022) · M3GAN (2022) · Demon Seed (1977) · Ex Machina (2014) · Upgrade (2018) · Come True (2020) · The Artifice Girl (2022) · Afraid (2024)') },
  { id: 'killer-object', title: 'Killer Object / Doll', g: 'monster',
    titles: T('Child\'s Play (1988) · Annabelle (2014) · Puppet Master (1989) · Christine (1983) · In Fabric (2018) · Rubber (2010) · Magic (1978) · Dead Silence (2007) · The Boy (2016) · Tourist Trap (1979)') },
  { id: 'killer-kid', title: 'Killer Kid', g: 'psychological',
    titles: T('The Omen (1976) · The Bad Seed (1956) · Orphan (2009) · Goodnight Mommy (2014) · The Prodigy (2019) · Come Play (2020) · Village of the Damned (1960) · Who Can Kill a Child? (1976) · The Children (2008) · Brightburn (2019)') },
  { id: 'cannibal-family', title: 'Rural / Cannibal Family', g: 'exploitation', note: 'Related to backwoods but distinct: the family is a dynasty.',
    titles: T('The Texas Chain Saw Massacre (1974) · The Hills Have Eyes (1977) · We Are What We Are (2013) · Bone Tomahawk (2015) · Frontier(s) (2007) · The Farm (2018) · Motel Hell (1980) · Parents (1989) · Raw (2016) · Eat (2014)') },
  { id: 'medical', title: 'Medical / Institutional', g: 'body',
    titles: T('Session 9 (2001) · Gonjiam: Haunted Asylum (2018) · Grave Encounters (2011) · The Ward (2010) · Unsane (2018) · Await Further Instructions (2018) · Shutter Island (2010) · The Jacket (2005) · Nurse 3D (2013) · Visiting Hours (1982) · Bedlam (1946)') },
  { id: 'murder-mystery', title: 'Murder Mystery', g: 'slasher',
    titles: T('Mindhunters (2004) · Memories of Murder (2003) · Zodiac (2007) · The Autopsy of Jane Doe (2016) · Identity (2003) · Blood Simple (1984) · Angel Heart (1987) · I Saw the Devil (2010) · Se7en (1995) · The Girl with the Dragon Tattoo (2011) · Cure (1997)') },
  { id: 'cabin', title: 'Cabin / Camping / Hiking', g: 'survival',
    titles: T('Cabin Fever (2002) · The Evil Dead (1981) · The Cabin in the Woods (2012) · Willow Creek (2013) · The Blair Witch Project (1999) · Backcountry (2014) · Killing Ground (2016) · Wendigo (2001) · Ravenous (1999) · The Ritual (2017) · Black Rock (2012) · Rituals (1977)') },
  { id: 'holiday', title: 'Holiday', g: 'slasher',
    titles: T('Black Christmas (1974) · Silent Night, Deadly Night (1984) · Krampus (2015) · Better Watch Out (2016) · Terrifier (2016) · My Bloody Valentine (1981) · Thanksgiving (2023) · Valentine (2001) · Trick \'r Treat (2007) · New Year\'s Evil (1980) · Leprechaun (1993) · April Fool\'s Day (1986)') },
  { id: 'revenge', title: 'Revenge', g: 'survival',
    titles: T('I Spit on Your Grave (1978) · I Spit on Your Grave (2010) · Oldboy (2003) · I Saw the Devil (2010) · Revenge (2017) · The Nightingale (2018) · Promising Young Woman (2020) · Ms .45 (1981) · Thriller: A Cruel Picture (1973) · Lady Vengeance (2005) · Blue Ruin (2013) · The Last House on the Left (1972) · The Last House on the Left (2009)') },
  { id: 'slow-burn', title: 'Slow Burn / Atmosphere', g: 'psychological',
    titles: T('The Witch (2015) · It Follows (2014) · The Babadook (2014) · Under the Skin (2013) · Skinamarink (2022) · Lake Mungo (2008) · The Lighthouse (2019) · Saint Maud (2019) · We\'re All Going to the World\'s Fair (2021) · Resolution (2012)') },
  { id: 'anthology', title: 'Anthology as a Form', g: 'psychological',
    titles: T('Creepshow (1982) · Trick \'r Treat (2007) · V/H/S (2012) · Southbound (2015) · The ABCs of Death (2012) · Kwaidan (1964) · Tales from the Hood (1995) · Black Sabbath (1963) · Dead of Night (1945) · Three... Extremes (2004) · Body Bags (1993)') },
  { id: 'religious-drift', title: 'The Religious Seam: religious films that drift into horror', g: 'supernatural',
    titles: T('Stigmata (1999) · The Rapture (1991) · The Last Temptation of Christ (1988) · The Seventh Sign (1988) · Saint Maud (2019) · First Reformed (2017) · Silence (2016) · Agnes (2021) · The Reckoning (2003) · Breaking the Waves (1996)') },
  { id: 'religious-theology', title: 'The Religious Seam: horror films that are functionally theology', g: 'supernatural',
    titles: T('The Exorcist (1973) · Frailty (2001) · The Prophecy (1995) · Jacob\'s Ladder (1990) · The Devils (1971) · Martyrs (2008) · The Sacrament (2013) · Red State (2011)') },
  { id: 'catholic-detective', title: 'The Religious Seam: the Catholic detective pocket', g: 'supernatural',
    titles: T('The Exorcist III (1990) · Fallen (1998) · The Order (2003) · Prince of Darkness (1987) · Deliver Us From Evil (2014) · Sinister (2012) · The Seventh Day (2021) · Angel Heart (1987)') },
  { id: 'grindhouse', title: 'Grindhouse / Exploitation Crossover', g: 'exploitation', note: 'Where The Devil\'s Rejects lives — crime film violence at horror intensity, usually shot like a 70s print. Named strands: hixploitation (Two Thousand Maniacs!), nunsploitation (Killer Nun, The Devils, Alucarda), nazisploitation (Shock Waves), the cannibal boom (Cannibal Holocaust, Cannibal Ferox), women-in-prison, clownsploitation (S.I.C.K., Terrifier, Clownhouse), Ozploitation (Wolf Creek, Razorback, Patrick), blaxploitation horror (Blacula, Ganja & Hess, Sugar Hill, Tales from the Hood).',
    titles: T('The Devil\'s Rejects (2005) · House of 1000 Corpses (2003) · 3 From Hell (2019) · Planet Terror (2007) · Death Proof (2007) · Hobo with a Shotgun (2011) · Bone Tomahawk (2015) · Green Room (2015) · Dead Man\'s Shoes (2004) · Mandy (2018) · Terrifier 2 (2022) · I Saw the Devil (2010)') },
  { id: 'slasher', title: 'Slasher (proper)', g: 'slasher', note: 'Distinct from serial-killer horror: body count, archetypes, set-piece kills.',
    titles: T('Halloween (1978) · Friday the 13th (1980) · A Nightmare on Elm Street (1984) · Black Christmas (1974) · Scream (1996) · Sleepaway Camp (1983) · The Burning (1981) · My Bloody Valentine (1981) · Happy Death Day (2017) · X (2022) · In a Violent Nature (2024) · Slumber Party Massacre (1982) · Valentine (2001) · Tourist Trap (1979)') },
  { id: 'giallo', title: 'Giallo', g: 'slasher', note: 'Italian murder mystery with black gloves, a straight razor, and a killer revealed at the climax. The slasher\'s direct ancestor.',
    titles: T('Blood and Black Lace (1964) · The Bird with the Crystal Plumage (1970) · Deep Red (1975) · Torso (1973) · The Case of the Scorpion\'s Tail (1971) · Don\'t Torture a Duckling (1972) · Your Vice Is a Locked Room (1972) · Tenebrae (1982) · The Strange Vice of Mrs Wardh (1971) · Amer (2009) · Berberian Sound Studio (2012)') },
  { id: 'gothic', title: 'Gothic / Period', g: 'supernatural',
    titles: T('Frankenstein (1931) · Bride of Frankenstein (1935) · Dracula (1931) · Dracula (1958) · The Uninvited (1944) · The Spiral Staircase (1946) · The Curse of Frankenstein (1957) · Black Sunday (1960) · The Masque of the Red Death (1964) · Crimson Peak (2015) · The Woman in Black (2012) · Pan\'s Labyrinth (2006) · The Others (2001) · Nosferatu (1922) · Nosferatu (1979) · Nosferatu (2024) · Sleepy Hollow (1999)') },
  { id: 'classic-monster', title: 'Silent and Classic Monster', g: 'monster',
    titles: T('The Cabinet of Dr. Caligari (1920) · Nosferatu (1922) · Häxan (1922) · The Phantom of the Opera (1925) · The Man Who Laughs (1928) · Vampyr (1932) · The Wolf Man (1941) · Cat People (1942) · I Walked with a Zombie (1943) · Creature from the Black Lagoon (1954) · The Invisible Man (1933)') },
  { id: 'vampire', title: 'Vampire', g: 'monster',
    titles: T('Nosferatu (1922) · Dracula (1931) · Dracula (1958) · Martin (1977) · Near Dark (1987) · The Lost Boys (1987) · Let the Right One In (2008) · Thirst (2009) · A Girl Walks Home Alone at Night (2014) · Only Lovers Left Alive (2013) · What We Do in the Shadows (2014) · 30 Days of Night (2007) · Cronos (1993) · Ganja & Hess (1973)') },
  { id: 'werewolf', title: 'Werewolf and Transformation', g: 'body',
    titles: T('The Wolf Man (1941) · An American Werewolf in London (1981) · The Howling (1981) · Dog Soldiers (2002) · Ginger Snaps (2000) · Late Phases (2014) · Wolfen (1981) · Wer (2013) · When Animals Dream (2014) · The Company of Wolves (1984)') },
  { id: 'kaiju', title: 'Kaiju and Giant Monster', g: 'cosmic',
    titles: T('Godzilla (1954) · The Host (2006) · Cloverfield (2008) · Shin Godzilla (2016) · Colossal (2016) · The Mist (2007) · Troll (2022) · Them! (1954) · King Kong (1933)') },
  { id: 'natural', title: 'Natural Horror / Animal Attack', g: 'survival', note: 'Sometimes called eco-horror. Nothing supernatural, nothing human.',
    titles: T('Jaws (1975) · The Birds (1963) · Cujo (1983) · Long Weekend (1978) · Open Water (2003) · Backcountry (2014) · The Grey (2011) · Crawl (2019) · Frozen (2010) · Black Water (2007) · Razorback (1984) · Phase IV (1974) · Day of the Animals (1977)') },
  { id: 'comedy', title: 'Comedy Horror', g: 'monster',
    titles: T('Evil Dead II (1987) · Shaun of the Dead (2004) · Tucker & Dale vs. Evil (2010) · Return of the Living Dead (1985) · Re-Animator (1985) · Braindead / Dead Alive (1992) · Gremlins (1984) · Young Frankenstein (1974) · What We Do in the Shadows (2014) · The Final Girls (2015) · Ready or Not (2019) · Freaky (2020) · Deathgasm (2015)') },
  { id: 'gateway', title: 'Gateway Horror', g: 'monster', note: 'Made for kids, and the reason a lot of people are in the genre at all.',
    titles: T('Poltergeist (1982) · Gremlins (1984) · The Monster Squad (1987) · Hocus Pocus (1993) · Coraline (2009) · ParaNorman (2012) · Monster House (2006) · The Witches (1990) · Goosebumps (2015) · Return to Oz (1985) · The Dark Crystal (1982) · Watership Down (1978)') },
  { id: 'western', title: 'Horror Western', g: 'survival',
    titles: T('Bone Tomahawk (2015) · Ravenous (1999) · Near Dark (1987) · The Burrowers (2008) · Dead Birds (2004) · The Wind (2018) · Brimstone (2016) · Antlers (2021)') },
  { id: 'musical-animated', title: 'Horror Musical and Animated', g: 'psychological',
    titles: T('The Rocky Horror Picture Show (1975) · Sweeney Todd (2007) · Little Shop of Horrors (1986) · Repo! The Genetic Opera (2008) · Anna and the Apocalypse (2018) · Perfect Blue (1997) · Vampire Hunter D: Bloodlust (2000) · Belladonna of Sadness (1973) · Mad God (2021) · Fear(s) of the Dark (2007)') },
  { id: 'hagsploitation', title: 'Hagsploitation / Grande Dame', g: 'psychological', note: 'An aging star, a decaying house, and psychological cruelty.',
    titles: T('What Ever Happened to Baby Jane? (1962) · Hush... Hush, Sweet Charlotte (1964) · Strait-Jacket (1964) · Die! Die! My Darling! (1965) · The Anniversary (1968) · Whoever Slew Auntie Roo? (1972) · Relic (2020) · The Taking of Deborah Logan (2014)') },
  { id: 'bad-movie', title: 'Bad Movie Shelf', g: 'exploitation', note: 'Its own legitimate category. Low budget, K Mart costumes, watched anyway.',
    titles: T('S.I.C.K.: Serial Insane Clown Killer (2003) · Troll 2 (1990) · Birdemic (2010) · Manos: The Hands of Fate (1966) · Plan 9 from Outer Space (1959) · Zombie Lake (1981) · Things (1989) · Sledgehammer (1983) · Blood Freak (1972)') },
];

export const NATIONAL = [
  { id: 'j-horror', title: 'J-horror', titles: T('Ringu (1998) · Ju-On (2002) · Audition (1999) · Pulse / Kairo (2001) · Noroi (2005) · Cure (1997) · Onibaba (1964)') },
  { id: 'k-horror', title: 'K-horror', titles: T('A Tale of Two Sisters (2003) · The Wailing (2016) · Train to Busan (2016) · Thirst (2009) · I Saw the Devil (2010) · Bedevilled (2010)') },
  { id: 'new-french-extremity', title: 'New French Extremity', titles: T('Martyrs (2008) · Inside (2007) · Frontier(s) (2007) · High Tension (2003) · Irreversible (2002) · Trouble Every Day (2001) · In My Skin (2002) · Calvaire (2004) · Sheitan (2006)') },
  { id: 'spanish-latin', title: 'Spanish and Latin American', titles: T('The Orphanage (2007) · [REC] (2007) · The Devil\'s Backbone (2001) · Tigers Are Not Afraid (2017) · We Are What We Are (2010) · Alucarda (1977) · Terrified (2017) · When Evil Lurks (2023)') },
  { id: 'italian', title: 'Italian', titles: T('Suspiria (1977) · Deep Red (1975) · Zombi 2 (1979) · The Beyond (1981) · Cannibal Holocaust (1980) · Black Sunday (1960) · Demons (1985)') },
  { id: 'southeast-asian', title: 'Southeast Asian', titles: T('The Medium (2021) · Shutter (2004) · Impetigore (2019) · Satan\'s Slaves (2017) · Pee Mak (2013)') },
  { id: 'nollywood-african', title: 'Nollywood and African', titles: T('Living in Bondage (1992) · Nneka the Pretty Serpent (1994) · Saloum (2021) · Good Madam (2021) · Gaia (2021)') },
  { id: 'ozploitation', title: 'Ozploitation', titles: T('Wolf Creek (2005) · Razorback (1984) · Patrick (1978) · Lake Mungo (2008) · The Babadook (2014) · Talk to Me (2022) · Killing Ground (2016)') },
  { id: 'nordic', title: 'Nordic', titles: T('Let the Right One In (2008) · Thelma (2017) · Lamb (2021) · Border (2018) · Trollhunter (2010) · Hatching (2022)') },
];

export const PROPOSAL = [
  { genre: 'Supernatural', around: 'A cosmology — something exists beyond the material and it wants something', absorbs: 'Haunting, Possession, Witchcraft, Ancient Magic, Folk Horror, Gothic' },
  { genre: 'Slasher', around: 'A body count and a set of archetypes', absorbs: 'Slasher, Giallo, Holiday, Serial Killer' },
  { genre: 'Survival', around: 'Mechanics — can she get out, and what does it cost', absorbs: 'Captivity, Siege, Backwoods, Home Invasion, Natural Horror, Girl Has to Kill Everyone' },
  { genre: 'Body', around: 'The anatomy is the site of the fear', absorbs: 'Body Horror, Splatter, Werewolf and Transformation, Medical' },
  { genre: 'Cosmic', around: 'Comprehension itself is the injury', absorbs: 'Lovecraftian, Sci-Fi Horror, Apocalyptic, Kaiju' },
  { genre: 'Monster', around: 'A creature with rules, history, and fandom', absorbs: 'Vampire, Werewolf, Creature Feature, Classic Monster, Killer Object' },
  { genre: 'Exploitation', around: 'A production mode and a distribution history', absorbs: 'Grindhouse, Cannibal, Nunsploitation, Ozploitation, Blaxploitation horror, the Bad Movie shelf' },
  { genre: 'Psychological', around: 'The unreliable interior', absorbs: 'Slow Burn, Cult, Killer Kid, Hagsploitation, Found Footage, Screen Life' },
];
export const PROPOSAL_CODA = 'Thriller, under this scheme, stops being horror\'s parent and becomes what it actually is: a tone available to any of the eight, the same way suspense is available to a western. Nerve keeps its motorcycle. It just stops being filed next to Martyrs.';

export const MAP_WHERE_TO_WATCH = {
  text: 'Free movies are all over the place. Type "horror movie" into YouTube and pick one. Tubi has a real library, not just filler — the confirmed 2000s-and-newer stock as of Sep 2026 includes:',
  titles: T('Martyrs · I Spit on Your Grave (2010) · Deja Vu · The Last House on the Left (2009) · High Tension · Hush · Alone · Black Rock · Raze · Even Lambs Have Teeth · Bound to Vengeance · Would You Rather · Caged · Carnage Park · Battle Royale · Hunt Her Kill Her · While She Was Out · American Mary · Revenge · Ravage · Avenged · Final Girl · Train to Busan · Memories of Murder · Skinamarink · Gonjiam · Carrie · Hereditary'),
  caveat: 'Tubi rotates monthly. Check before you commit.',
};

// ── "Girl Has to Kill Everyone" ────────────────────────────────────────────────────────────────────
export const GIRL = {
  primary: { t: 'Martyrs', y: '2008', note: 'dir. Pascal Laugier (and the 2016 American remake)' },
  heart: 'The heart of the genre is trafficking and captivity: she has to get through a whole operation — the handlers, the buyers, the guards, the ring — and "everyone" is plural on purpose. One girl against one attacker, and home or work invasion, fit the genre, but they are not primary to it, and they are much slower to watch.',
  tests: ['If she stops killing, does she die? → the Martyrs wing.', 'Is the film watching her be the monster, with or without a snapping point? → the Eyes of My Mother wing.', 'Neither → adjacent, or pass.'],
  wings: [
    { id: 'captivity-escape', title: 'Captivity & Escape', rank: 'core',
      intro: 'She is taken, caged, or locked in; the only door out is through every captor. Ordered by closeness to Martyrs — the top entries share its brutality and its bleakness, the lower ones trade some of that for stylization.',
      titles: [
        { t: 'Martyrs', y: '2016', note: 'The American remake of the primary title: the same captivity, the same way out' },
        { t: 'Caged / Captifs', y: '2010', note: 'Held by organ traffickers; kills the surgeon, the handlers, and the dogs on the way out' },
        { t: 'Even Lambs Have Teeth', y: '2015', note: 'Two women escape holding cells in a town the captor family owns' },
        { t: 'Bound to Vengeance', y: '2015', note: 'Escaped captive forces her abductor to lead her through the whole trafficking ring' },
        { t: 'Raze', y: '2013', note: 'Abducted into a bunker; 50 women forced to fight to the death, snipers on their loved ones' },
        { t: 'Carnage Park', y: '2016', note: 'Dumped in a sniper\'s electric-fenced desert compound' },
        { t: 'The Furies', y: '2019', note: 'Wakes in a box in the woods; kill-or-be-killed game with masked assassins' },
        { t: 'Thriller: A Cruel Picture', y: '1973', note: 'Trafficked and mute; trains in secret, then executes every handler' },
        { t: 'Black Rock', y: '2012', note: 'Three women hunted on a remote island; the only way off is through the hunters' },
        { t: 'Would You Rather', y: '2013', note: 'Deadly parlor game in a mansion; leaving alive means no one else does' },
        { t: 'Fresh', y: '2022', note: 'Locked basement; freedom means killing everyone upstairs' },
        { t: 'The Princess', y: '2022', note: 'Locked in a tower; fights down through a castle of soldiers' },
      ] },
    { id: 'siege', title: 'Siege', rank: 'fits',
      intro: 'She is cornered in one location and the killers come to her. Home and work invasion fit the genre, but are not primary to it and are slower to watch. Ordered by closeness to Martyrs.',
      titles: [
        { t: 'Hunt Her, Kill Her', y: '2023', note: 'Night-shift janitor alone in a factory vs. masked intruders' },
        { t: 'While She Was Out', y: '2008', note: 'Christmas Eve; four attackers, one toolbox, no survivors' },
        { t: 'Intruders / Shut In', y: '2015', note: 'Agoraphobic woman can\'t chase the burglars out — so she locks them in with her' },
        { t: 'You\'re Next', y: '2011', note: 'Family estate ambushed by masked killers; survivalist upbringing kicks in' },
        { t: 'Everly', y: '2014', note: 'Four-year captive in an apartment fends off waves of assassins' },
        { t: 'Till Death', y: '2021', note: 'Handcuffed to her dead husband as hired killers arrive' },
        { t: 'Becky / The Wrath of Becky', y: '2020, 2023', note: '13-year-old vs. escaped convicts at a lake house' },
        { t: 'The Owners', y: '2020', note: 'Trapped inside a house with a sadistic older couple' },
        { t: 'Wait Until Dark', y: '1967', note: 'Blind woman kills the lights and fights three invaders on her terms — the grandmother of the genre' },
        { t: 'Kimi', y: '2022', note: 'Agoraphobic tech worker who can\'t leave her apartment; the men come for her and the apartment becomes the weapon' },
        { t: 'Run Hide Fight', y: '2020', note: 'Trapped in a school under attack; hunts the shooters one by one' },
      ] },
    { id: 'backwoods-hunted', title: 'Backwoods & Hunted', rank: 'core',
      intro: 'Rural isolation; she is hunted like an animal and has to hunt back to get out alive. Ordered by closeness to Martyrs. The one-girl-one-attacker setups here fit, but are slower and not the heart of the genre.',
      titles: [
        { t: 'I Spit on Your Grave / Deja Vu', y: '2010, 2019', note: 'Cornered at a remote cabin; engineers traps to eliminate every attacker' },
        { t: 'Eden Lake', y: '2008', note: 'Hunted through the woods by a teen gang; pure ugly desperation' },
        { t: 'The Last House on the Left', y: '2009', note: 'The gang shelters in the victim\'s family home; the family executes them all' },
        { t: 'Ravage', y: '2019', note: 'Photographer witnesses a crime, gets taken; survivalist skills, one by one' },
        { t: 'Avenged', y: '2015', note: 'Mute woman taken by a backwoods gang; supernatural twist on the same mechanics' },
        { t: 'Final Girl', y: '2015', note: 'Boys who hunt women for sport pick the one trained for exactly this' },
      ] },
    { id: 'urban-stylized', title: 'Urban & Stylized Necessity', rank: 'core',
      intro: 'Same no-exit logic, city streets or heightened action styling.',
      titles: [
        { t: 'Ms .45', y: '1981', note: 'Attacked twice in one day in NYC; the .45 becomes her only functional option' },
        { t: 'Freeway', y: '1996', note: 'Teen trapped with a serial killer; shoots her way through a corrupt landscape' },
        { t: 'We Will Not Die Tonight', y: '2018', note: 'Manila stuntwoman crosses a crime boss; fights her way to safety' },
      ] },
  ],
  monster: {
    primary: { t: 'The Eyes of My Mother', y: '2016', note: 'dir. Nicolas Pesce' },
    intro: 'She is the monster. Sometimes there is a snapping point and sometimes there never was one — the films sit together either way, because what the movie is watching is her, not her escape.',
    snapping: [
      { t: 'Carrie', y: '1976, 2013', note: 'Bullied telekinetic; the prom doors close and the pressure gives' },
      { t: 'Pearl', y: '2022', note: 'Trapped farm life and a dead dream; the axe comes after the audition' },
      { t: 'Bedevilled', y: '2010', note: 'Island drudge abused by everyone until the scythe comes out' },
      { t: 'American Mary', y: '2012', note: 'Med student assaulted; the scalpel turns outward' },
      { t: 'Thelma', y: '2017', note: 'Repression lifts and the power comes up with it' },
      { t: 'Ginger Snaps', y: '2000', note: 'Adolescence as the trigger; the change arrives monthly' },
      { t: 'Ms .45', y: '1981', note: 'Also in the core — mute garment worker turns the city into a range' },
    ],
    without: [
      { t: 'Audition', y: '1999', note: 'The quiet woman was always the horror; the date was the hunt' },
      { t: 'May', y: '2002', note: 'Builds the friend she wants out of the people who disappoint her' },
      { t: 'Excision', y: '2012', note: 'Surgical fantasies that were never a phase' },
      { t: 'The Love Witch', y: '2016', note: 'Enchants men to death and feels no conflict about it' },
      { t: 'Raw', y: '2016', note: 'Discovers what she already was, and doesn\'t turn back' },
      { t: 'Trouble Every Day', y: '2001', note: 'Appetite as condition, not choice' },
      { t: 'In My Skin', y: '2002', note: 'Turns the compulsion inward and keeps going' },
    ],
  },
  adjacent: [
    { t: 'Revenge', y: '2017', note: 'Retribution, not escape — she hunts them after surviving' },
    { t: 'Peppermint', y: '2018', note: 'Years-later vigilante revenge' },
    { t: 'Kill Bill: Vol. 1', y: '2003', note: 'Revenge list, stylized to the ceiling' },
    { t: 'Kill List / Inside / Frontier(s) / A Dark Song', y: '2011, 2007, 2007, 2016', note: 'Martyrs tone-and-dread cousins — atmosphere, not mechanics' },
  ],
  near: [
    { t: 'The Liability', y: '2012', note: 'Almost on genre: the trafficking premise is there, but it is not the girl killing everyone' },
    { t: 'Taken', y: '2008', note: 'Almost on genre: a trafficking ring, but the film is about her father doing the killing, not her' },
  ],
  whereToWatch: {
    asOf: 'Sep 2026. Tubi rotates monthly — treat as leads, not guarantees.',
    seen: 'Martyrs, I Spit on Your Grave (2010) + Deja Vu, Even Lambs Have Teeth, Ms .45, Freeway, Final Girl, Revenge, Ravage, Raze',
    cycles: 'Caged, Bound to Vengeance, Would You Rather, Black Rock, While She Was Out, Hunt Her Kill Her, Avenged, Carnage Park',
    elsewhere: 'The Furies (Shudder), Fresh / The Princess / Run Hide Fight (Hulu), Till Death / You\'re Next / Becky (Netflix/Prime), Wait Until Dark (rental)',
  },
  findMore: {
    loglines: [
      { wing: 'Martyrs wing', phrases: ['she must fight her way out', 'must kill them all', 'make it through the night alive', 'forced to fight to the death', 'her only chance of survival'] },
      { wing: 'Monster wing', phrases: ['she was always', 'her true nature', 'a quiet young woman who', 'her appetite', 'unsettlingly calm'] },
      { wing: 'Monster wing, snapping point', phrases: ['pushed past her limit', 'finally breaks', 'something inside her gives'] },
    ],
    databases: [
      'IMDb keywords: female-protagonist + held-captive, fight-for-survival, kidnapped-woman, female-fighter',
      'bestsimilar.com tags: trapped, held captive, game of death, characters-killed-one-by-one',
      'Letterboxd "good for her" lists — then apply the genre test to sort revenge out',
      'Tubi\'s own categories: the Revenge category, plus the "you may also like" rows off Raze and I Spit on Your Grave',
    ],
    people: 'Pascal Laugier, Coralie Fargeat, Nicolas Pesce, Claire Denis, Julia Ducournau, Brian De Palma (monster wing), Zoë Bell (fight-out wing)',
  },
};

export const shelfById = (id) => SHELVES.find((s) => s.id === id) || BORDERS.find((s) => s.id === id) || NATIONAL.find((s) => s.id === id) || null;
export const countTitles = () => [...SHELVES, ...BORDERS, ...NATIONAL].reduce((n, s) => n + s.titles.length, 0);
