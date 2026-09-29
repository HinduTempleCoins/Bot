// narco-cinema.mjs — narco cinema on SoapBox Stream (operator 2026-09-29: "look for like Narco movies, that are not super
// copyrighted… like maybe we could do El Coyote and things"). Research: .local/research/NARCO_CINEMA_2026-10.md (sourced, seen
// 2026-09-29).
//
// RIGHTS. Mexican narcocine is copyrighted (Mexico: life + 100 years), so NARCO_TITLES are where-to-watch LEADS — each links to
// SoapBox Films and to the free service that carries it (Tubi, The Roku Channel, ViX), never played here. Community uploads of
// these films on the Internet Archive are NOT played. What plays is NARCO_PD: US-government anti-drug / DEA films (17 U.S.C.
// § 105), Prelinger Archives films (documented public domain), and films published 1930 or earlier — each verified live on the
// Internet Archive, registered with archive-video's licence check and listed in free-film-registry.
import * as archiveVideo from './archive-video.mjs';

export const SHELVES = [
  { id: 'origins', name: 'Where it began: the corrido films', blurb: 'In the late 1970s Mexican studios turned Los Tigres del Norte corridos about smugglers into films — Contrabando y traición (1977), La banda del carro rojo (1978) — and a genre was born.' },
  { id: 'almada', name: 'The Almada brothers', blurb: 'Mario and Fernando Almada, the faces of the genre: hundreds of border and narco films, many shot straight to video ("videohome") from the 1980s on.' },
  { id: 'reynoso', name: 'Capos and videohomes: Jorge Reynoso, Valentín Trujillo and the vehicle films', blurb: 'If the Almadas were the upright justiceros, Jorge Reynoso was the capo. The videohome boom produced La camioneta gris, La suburban dorada and El Chrysler 300.' },
  { id: 'coyote', name: 'El Coyote', blurb: 'Every film called El Coyote: the smuggler Vicente Fernández played in 1980, the 1950s westerns, La India María, and the new border thriller of October 2026.' },
  { id: 'world', name: 'The world\'s narco films', blurb: 'From Scarface and Traffic to Sicario, Miss Bala, El infierno and Birds of Passage — and the documentaries.' },
];

export const NARCO_TITLES = Object.freeze([
  {"t": "Contrabando y traición", "y": 1977, "country": "Mexico", "d": "Arturo Martínez", "stars": "Valentín Trujillo, Ana Luisa Peluffo", "shelf": "origins", "note": "Camelia la Texana on screen; not streaming anywhere (Plex/JustWatch, 29 Sep 2026) — DVD only"},
  {"t": "La banda del carro rojo", "y": 1978, "country": "Mexico", "d": "Rubén Galindo", "stars": "Mario Almada, Fernando Almada, Pedro Infante Jr.", "shelf": "origins", "where": [{"service": "The Roku Channel (free with ads)", "url": "https://www.justwatch.com/us/search?q=la%20banda%20del%20carro%20rojo", "seen": "2026-09-29"}], "note": "Los Tigres del Norte corrido adaptation; spawned two sequels"},
  {"t": "El regreso del carro rojo", "y": 1989, "country": "Mexico", "stars": "Mario Almada, Fernando Almada", "shelf": "origins", "note": "Sequel; not streaming (JustWatch)"},
  {"t": "El Coyote y la Bronca", "y": 1980, "country": "Mexico", "d": "Rafael Villaseñor Kuri", "stars": "Vicente Fernández, Blanca Guerra, Gloria Marín", "shelf": "coyote", "note": "Vicente Fernández as 'El Coyote', a border pollero (human smuggler)"},
  {"t": "Lola la trailera", "y": 1983, "country": "Mexico", "d": "Raúl Fernández", "stars": "Rosa Gloria Chagoyán, Rolando Fernández", "shelf": "origins", "note": "Lola the Truck Driver — earned $1M in Mexico and $2.5M in the US on a $150K budget"},
  {"t": "Emboscada", "y": 1990, "country": "Mexico", "stars": "Mario Almada, Fernando Almada, Jorge Reynoso", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/movies/702542/emboscada", "seen": "2026-09-29"}]},
  {"t": "La camioneta gris", "y": 1990, "country": "Mexico", "d": "José Luis Urquieta", "stars": "Mario Almada, Fernando Almada", "shelf": "almada", "note": "The film that launched the vehicle-title subgenre; not streaming (Plex, 29 Sep 2026)"},
  {"t": "Traficantes del vicio", "y": 1990, "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/040ede/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Ranger 2: el narco túnel", "y": 1993, "country": "Mexico", "stars": "Fernando Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/99dfcd/fernando-almada", "seen": "2026-09-29"}]},
  {"t": "Lotería mortal", "y": 1997, "country": "Mexico", "stars": "Fernando Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/99dfcd/fernando-almada", "seen": "2026-09-29"}]},
  {"t": "Juego con la muerte", "y": 1998, "country": "Mexico", "stars": "Fernando Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/99dfcd/fernando-almada", "seen": "2026-09-29"}]},
  {"t": "El último cartucho", "y": 1999, "country": "Mexico", "stars": "Mario Almada, Fernando Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/040ede/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Dos carteles", "y": 2000, "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/040ede/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Asesino de traileros", "y": 2001, "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/040ede/mario-almada", "seen": "2026-09-29"}]},
  {"t": "La bronco amarilla", "y": 2001, "country": "Mexico", "stars": "Mario Almada, Jorge Reynoso", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/040ede/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Se buscan", "y": 2003, "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/040ede/mario-almada", "seen": "2026-09-29"}, {"service": "ViX", "url": "https://vix.com/es-es/cast/mario-almada", "seen": "2026-09-29"}]},
  {"t": "El de la Lincoln negra", "y": 2008, "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/040ede/mario-almada", "seen": "2026-09-29"}]},
  {"t": "La Hummer blanca", "y": 2010, "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/040ede/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Sinaloa, tierra de hombres", "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "ViX", "url": "https://vix.com/es-es/cast/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Ser Capo", "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "ViX", "url": "https://vix.com/es-es/cast/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Del lado de la ley", "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "ViX", "url": "https://vix.com/es-es/cast/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Máxima traición", "country": "Mexico", "stars": "Mario Almada", "shelf": "almada", "where": [{"service": "ViX", "url": "https://vix.com/es-es/cast/mario-almada", "seen": "2026-09-29"}]},
  {"t": "Comando Marino", "y": 1990, "country": "Mexico", "stars": "Jorge Reynoso", "shelf": "reynoso", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/4e0dc6/jorge-reynoso", "seen": "2026-09-29"}]},
  {"t": "Ángeles de la muerte", "y": 1995, "country": "Mexico", "stars": "Jorge Reynoso", "shelf": "reynoso", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/4e0dc6/jorge-reynoso", "seen": "2026-09-29"}]},
  {"t": "La suburban dorada", "y": 1996, "country": "Mexico", "stars": "Jorge Reynoso", "shelf": "reynoso", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/4e0dc6/jorge-reynoso", "seen": "2026-09-29"}]},
  {"t": "La clave 7", "y": 1999, "country": "Mexico", "d": "Jorge Reynoso", "stars": "Jorge Reynoso", "shelf": "reynoso", "note": "A Sinaloa cartel leader wages war on the government (Remezcla)"},
  {"t": "La estampa del escorpión", "y": 2007, "country": "Mexico", "stars": "Jorge Reynoso", "shelf": "reynoso", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/4e0dc6/jorge-reynoso", "seen": "2026-09-29"}]},
  {"t": "Para matar a un asesino", "y": 2007, "country": "Mexico", "stars": "Jorge Reynoso", "shelf": "reynoso", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/4e0dc6/jorge-reynoso", "seen": "2026-09-29"}]},
  {"t": "El Chrysler 300: Chuy y Mauricio", "y": 2008, "country": "Mexico", "d": "Enrique Murillo", "shelf": "reynoso", "note": "Highest-grossing narco videohome of its release; spawned sequels (Remezcla)"},
  {"t": "En peligro de muerte", "y": 1988, "country": "Mexico", "stars": "Valentín Trujillo", "shelf": "reynoso", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/0b70bf/valent%C3%ADn-trujillo", "seen": "2026-09-29"}]},
  {"t": "Los de la 4x4", "y": 1998, "country": "Mexico", "stars": "Valentín Trujillo", "shelf": "reynoso", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/person/0b70bf/valent%C3%ADn-trujillo", "seen": "2026-09-29"}]},
  {"t": "Cazador de narcos", "y": 2003, "country": "Mexico", "shelf": "reynoso", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/movies/594044/cazador-de-narcos", "seen": "2026-09-29"}]},
  {"t": "El Coyote", "y": 1955, "country": "Mexico/Spain", "d": "Joaquín Luis Romero Marchent, Fernando Soler", "stars": "Abel Salazar, Gloria Marín, Manuel Monroy", "shelf": "coyote", "note": "A western, not narco: José Mallorquí's masked hero in 1848 California"},
  {"t": "La justicia del Coyote", "y": 1956, "country": "Mexico/Spain", "d": "Joaquín Luis Romero Marchent", "stars": "Abel Salazar, Gloria Marín", "shelf": "coyote", "note": "Sequel to El Coyote (1955)", "qid": "Q14915750"},
  {"t": "El coyote emplumado", "y": 1983, "country": "Mexico", "d": "María Elena Velasco", "stars": "María Elena Velasco", "shelf": "coyote", "note": "La India María action comedy"},
  {"t": "Coyote", "y": 2007, "country": "USA", "d": "Brian Petersen", "shelf": "coyote", "note": "Two Americans start smuggling migrants into Arizona"},
  {"t": "El Coyote", "y": 2019, "country": "USA", "d": "Jeffrey Nicholson, Michael Saquella", "shelf": "coyote", "note": "The Italian mob descends on the border to take on a cartel"},
  {"t": "Coyote", "y": 2026, "country": "USA/Mexico", "d": "Per Prinz", "stars": "Esai Morales, Mel Gibson, Renata Notni, Cheech Marin, Dean Norris, Teresa Ruiz", "shelf": "coyote", "note": "New, October 2026: an ex-smuggler guides a mother and daughter across the border — trafficking, migration and the drug war"},
  {"t": "Scarface", "y": 1983, "country": "USA", "d": "Brian De Palma", "stars": "Al Pacino, Michelle Pfeiffer", "shelf": "world", "qid": "Q47075"},
  {"t": "Clear and Present Danger", "y": 1994, "country": "USA", "d": "Phillip Noyce", "stars": "Harrison Ford, Willem Dafoe", "shelf": "world", "qid": "Q1392442"},
  {"t": "Traffic", "y": 2000, "country": "USA", "d": "Steven Soderbergh", "stars": "Michael Douglas, Benicio del Toro, Catherine Zeta-Jones", "shelf": "world", "qid": "Q142292"},
  {"t": "La virgen de los sicarios", "y": 2000, "country": "Colombia/France", "d": "Barbet Schroeder", "stars": "Germán Jaramillo, Anderson Ballesteros", "shelf": "world"},
  {"t": "Blow", "y": 2001, "country": "USA", "d": "Ted Demme", "stars": "Johnny Depp, Penélope Cruz", "shelf": "world", "qid": "Q631515"},
  {"t": "Maria Full of Grace", "y": 2004, "country": "Colombia/USA", "d": "Joshua Marston", "stars": "Catalina Sandino Moreno", "shelf": "world", "qid": "Q1324641"},
  {"t": "Rosario Tijeras", "y": 2005, "country": "Colombia/Mexico", "d": "Emilio Maillé", "stars": "Flora Martínez", "shelf": "world", "qid": "Q548128"},
  {"t": "Cocaine Cowboys", "y": 2006, "country": "USA", "d": "Billy Corben", "shelf": "world", "note": "Documentary", "qid": "Q2460440"},
  {"t": "Miami Vice", "y": 2006, "country": "USA", "d": "Michael Mann", "stars": "Colin Farrell, Jamie Foxx, Gong Li", "shelf": "world", "qid": "Q840495"},
  {"t": "No Country for Old Men", "y": 2007, "country": "USA", "d": "Joel and Ethan Coen", "stars": "Josh Brolin, Javier Bardem, Tommy Lee Jones", "shelf": "world", "note": "Drug money on the border", "qid": "Q183081"},
  {"t": "Sin nombre", "y": 2009, "country": "Mexico/USA", "d": "Cary Joji Fukunaga", "stars": "Paulina Gaitán, Edgar Flores", "shelf": "world", "qid": "Q1667482"},
  {"t": "El infierno", "y": 2010, "country": "Mexico", "d": "Luis Estrada", "stars": "Damián Alcázar", "shelf": "world"},
  {"t": "Miss Bala", "y": 2011, "country": "Mexico", "d": "Gerardo Naranjo", "stars": "Stephanie Sigman", "shelf": "world", "qid": "Q3316382"},
  {"t": "Savages", "y": 2012, "country": "USA", "d": "Oliver Stone", "stars": "Blake Lively, Benicio del Toro, Salma Hayek", "shelf": "world", "qid": "Q1143802"},
  {"t": "Heli", "y": 2013, "country": "Mexico", "d": "Amat Escalante", "stars": "Armando Espitia", "shelf": "world", "qid": "Q12155649"},
  {"t": "The Counselor", "y": 2013, "country": "USA", "d": "Ridley Scott", "stars": "Michael Fassbender, Penélope Cruz, Javier Bardem", "shelf": "world", "qid": "Q3061599"},
  {"t": "Narco Cultura", "y": 2013, "country": "USA/Mexico", "d": "Shaul Schwarz", "shelf": "world", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/movies/579607/narco-cultura", "seen": "2026-09-29"}], "note": "Documentary on the narcocorrido scene"},
  {"t": "Escobar: Paradise Lost", "y": 2014, "country": "France/Spain/Belgium/Panama", "d": "Andrea Di Stefano", "stars": "Benicio del Toro, Josh Hutcherson", "shelf": "world"},
  {"t": "Sicario", "y": 2015, "country": "USA", "d": "Denis Villeneuve", "stars": "Emily Blunt, Benicio del Toro, Josh Brolin", "shelf": "world", "qid": "Q17337292"},
  {"t": "Cartel Land", "y": 2015, "country": "USA/Mexico", "d": "Matthew Heineman", "shelf": "world", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/movies/549640/cartel-land", "seen": "2026-09-29"}], "note": "Documentary", "qid": "Q19320938"},
  {"t": "Cartels", "y": 2016, "country": "USA", "shelf": "world", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/movies/620940/cartels", "seen": "2026-09-29"}], "qid": "Q43303157"},
  {"t": "American Made", "y": 2017, "country": "USA", "d": "Doug Liman", "stars": "Tom Cruise", "shelf": "world", "qid": "Q18811617"},
  {"t": "Loving Pablo", "y": 2017, "country": "Spain", "d": "Fernando León de Aranoa", "stars": "Javier Bardem, Penélope Cruz", "shelf": "world", "qid": "Q36951270"},
  {"t": "Cartel 2045", "y": 2017, "country": "Mexico/USA", "shelf": "world", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/movies/468907/cartel-2045", "seen": "2026-09-29"}]},
  {"t": "Sicario: Day of the Soldado", "y": 2018, "country": "USA", "d": "Stefano Sollima", "stars": "Benicio del Toro, Josh Brolin", "shelf": "world", "qid": "Q27921157"},
  {"t": "Birds of Passage (Pájaros de verano)", "y": 2018, "country": "Colombia", "d": "Cristina Gallego, Ciro Guerra", "stars": "Carmiña Martínez, José Acosta", "shelf": "world", "qid": "Q51998716"},
  {"t": "Border Cartel", "y": 2018, "country": "USA", "shelf": "world", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/movies/519263/border-cartel", "seen": "2026-09-29"}]},
  {"t": "Narco Soldiers", "y": 2020, "country": "USA", "shelf": "world", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/movies/592458/narco-soldiers", "seen": "2026-09-29"}]},
  {"t": "The CEO of Sinaloa", "y": 2021, "shelf": "world", "where": [{"service": "Tubi (free with ads)", "url": "https://tubitv.com/category/international_drug_trade_and_wars", "seen": "2026-09-29"}], "note": "Documentary"}
]);

export const NARCO_PD = Object.freeze([
  {"id": "OpiumDes1914", "title": "Opium Destruction, San Francisco", "year": 1914, "desc": "Government agents burn confiscated opium near the unfinished City Hall", "why": "Published 1914 (public domain by age) and marked public domain on the Internet Archive"},
  {"id": "the-pace-that-kills_1928", "title": "The Pace That Kills", "year": 1928, "desc": "Cocaine addiction destroys young lives in the big city — the silent original", "why": "Published 1928: public domain in the US by age (1930 or earlier)"},
  {"id": "DrugAddi1951", "title": "Drug Addiction", "year": 1951, "desc": "Encyclopaedia Britannica Films' 'slippery slope' classic", "why": "Prelinger Archives, marked public domain"},
  {"id": "Terrible1951", "title": "The Terrible Truth", "year": 1951, "desc": "Sid Davis: marijuana as the road to heroin", "why": "Prelinger Archives, marked public domain"},
  {"id": "SubjectN1951", "title": "Subject: Narcotics", "year": 1951, "desc": "Police training film on addiction as a social problem", "why": "Prelinger Archives, marked public domain"},
  {"id": "0785_Narcotics_Pit_of_Despair_06_06_30_08", "title": "Narcotics: Pit of Despair", "year": 1967, "desc": "A boy from a good home falls into heroin", "why": "Prelinger Archives (public domain collection)"},
  {"id": "Narcotic_Addiction", "title": "Narcotic Addiction", "year": 0, "desc": "New York State's film on why people turn to drugs", "why": "Prelinger Archives (public domain collection)"},
  {"id": "rpnarcotictrade", "title": "Narcotic Trade", "year": 0, "desc": "1960s film on the narcotics trade", "why": "Prelinger Archives (public domain collection)"},
  {"id": "DrugAbus1969", "title": "Drug Abuse: The Chemical Tomb", "year": 1969, "desc": "Anti-drug film framing drugs as a brake on social change", "why": "Prelinger Archives, marked public domain"},
  {"id": "drugs_in_our_culture", "title": "Drugs in Our Culture", "year": 1970, "desc": "Why drug use was rising among young Americans", "why": "Prelinger Archives, marked public domain"},
  {"id": "DistantD1972", "title": "Distant Drummer: Flowers of Darkness", "year": 1972, "desc": "The history of opium to heroin, and how organized crime moved it into the US", "why": "Prelinger Archives, marked public domain"},
  {"id": "gov.archives.arc.649331", "title": "Drug Abuse (CIA, 1969)", "year": 1969, "desc": "A CIA film on narcotics traffic and opium poppy harvests", "why": "US government work (Central Intelligence Agency), National Archives, CC0"},
  {"id": "gov.archives.arc.74404", "title": "Marijuana (US Navy, ca. 1967–73)", "year": 0, "desc": "Naval Photographic Center film on marijuana", "why": "US government work (US Navy), National Archives"},
  {"id": "gov.archives.arc.34468", "title": "USARV Drug Abuse Program: Project On Board", "year": 1971, "desc": "The US Army in Vietnam confronts drug use", "why": "US government work (US Army), National Archives, CC0"},
  {"id": "gov.archives.arc.36922", "title": "Investigation of Narcotic and Dangerous Drug Offenses, Part I", "year": 0, "desc": "Military police training", "why": "US government work (Department of Defense), National Archives, CC0"},
  {"id": "gov.archives.arc.36927", "title": "Investigation of Narcotic and Dangerous Drug Offenses, Part II: Developing Drug Cases", "year": 0, "desc": "Military police training", "why": "US government work (Department of Defense), National Archives, CC0"},
  {"id": "gov.archives.arc.37914", "title": "DEA: A Profile", "year": 0, "desc": "Why the Drug Enforcement Administration was created and how it works", "why": "US government work (DEA), National Archives, CC0"},
  {"id": "gov.archives.arc.37989", "title": "Cocaine Production in Bolivia", "year": 1984, "desc": "DEA film from inside Bolivian cocaine production", "why": "US government work (DEA), National Archives, CC0"},
  {"id": "gov.archives.arc.37997", "title": "Cocaine Bust in Colombia", "year": 1984, "desc": "DEA footage of a cocaine seizure in Colombia", "why": "US government work (DEA), National Archives, CC0"},
  {"id": "gov.archives.arc.37912", "title": "Interview of Joseph Gordon Lahey Concerning Undercover Drug Operations", "year": 1985, "desc": "A DEA undercover informant questioned under hypnosis", "why": "US government work (DEA), National Archives, CC0"},
  {"id": "gov.ntis.ava16172vnb1", "title": "Say No to Drugs — It's Your Decision", "year": 1986, "desc": "The DEA's 1986 program for kids", "why": "US government work (DEA), marked public domain"}
]);

export const EXCLUDED = Object.freeze([
  {"title": "Cocaine, Inc (1986, National Archives)", "why": "an NBC News segment (Tom Brokaw) held in DEA records — network copyright"},
  {"title": "Pleasure Drugs: The Great American High (1982)", "why": "an NBC News special held in DEA records — network copyright"},
  {"title": "Drug Availability in Washington", "why": "a TV news clip held in DEA records"},
  {"title": "Drug War in Miami; Colombia Cocaine Seizures: Tranquilandia", "why": "DEA-held footage with no documented producer — could be broadcast news"},
  {"title": "President Reagan's 1982 drug-trafficking program", "why": "no documented federal copy"},
  {"title": "Destroying Narcotics (1928–1937 newsreel extracts)", "why": "commercial newsreels (Paramount, Hearst) up to 1937 — not all public domain"},
  {"title": "La banda del carro rojo and other Mexican narcocine on the Internet Archive", "why": "community uploads of copyrighted Mexican films (protected for life + 100 years in Mexico)"}
]);

archiveVideo.registerClearedIds(NARCO_PD.map((f) => f.id));

export const titlesByShelf = () => SHELVES.map((s) => ({ ...s, items: NARCO_TITLES.filter((t) => t.shelf === s.id).sort((a, b) => (a.y || 9999) - (b.y || 9999)) })).filter((s) => s.items.length);
export const freeNow = () => NARCO_TITLES.filter((t) => (t.where || []).length);
/** SoapBox Films link: the exact film when we matched it, else a title (+ year) search. */
export const filmsHref = (t) => (t.qid ? `/films/${t.qid}` : `/films/search?q=${encodeURIComponent(`${t.t}${t.y ? ` ${t.y}` : ''}`)}`);

/** a stream tile for a public-domain narco / anti-drug film (plays through the IA official player) */
export function narcoTile(f) {
  if (!f || !f.id) return null;
  const id = String(f.id);
  return {
    id, title: f.title, kind: 'film', year: f.year ? String(f.year) : '', creator: f.desc || '',
    thumb: `https://archive.org/services/img/${id}`,
    streamUrl: `https://archive.org/embed/${id}`, embedUrl: `https://archive.org/embed/${id}`,
    license: 'Public domain (curated by SoapBox Stream)', licenseToken: 'public-domain',
    source: 'Internet Archive', attribution: `Internet Archive — ${id}`, posture: 'window',
    details: `https://archive.org/details/${id}`, href: `https://archive.org/details/${id}`,
  };
}
