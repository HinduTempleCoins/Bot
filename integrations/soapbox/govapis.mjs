// govapis.mjs — a COMPREHENSIVE catalog + keyless live readers for US government APIs/SDKs. Feeds the
// SoapBox Resource Center and powers the "better than the government" pages: the public data agencies
// publish, MELEK simply makes legible and fast.
//
// This is the BROAD expansion + live-reader layer that sits ALONGSIDE govtech-catalog.mjs (which maps
// the gov-TECH landscape: incumbents, standards, contracting, identity rails). This module is squarely
// the data-API surface — 50+ named endpoints across the executive agencies plus the Socrata/CKAN
// state-portal patterns — and a handful of KEYLESS live readers that soft-fail and never throw.
//
// Follows the macro.mjs discipline: ESM, a `__setFetch` hook for tests, every network path soft-fails
// (returns [] / null, never throws), and the CLI is guarded by process.argv[1].
//
// Each catalog entry:
//   { agency, name, baseUrl, keyless, keyViaDataGov, domain, gives, pageIdea }
//     keyless        : true  → callable with no signup/key at all.
//     keyViaDataGov  : true  → works with the single free api.data.gov key (DEMO_KEY for light use).
//                      An entry can be keyless AND keyViaDataGov (DEMO_KEY now, real key lifts limits).
//                      Neither flag set → its own registration/key is required (e.g. Census, BLS, FRED).
//     domain         : functional bucket (see DOMAINS) for the Resource-Center grouping.
//     gives          : plain-English description of the data it returns.
//     pageIdea       : the "better than the government" page this entry could power.
//
//   import { GOV_APIS, byDomain, keylessApis, federalRegister, usaspending,
//            treasuryFiscal, fema, usgsQuakes } from './govapis.mjs'

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0; +https://data.soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export const DOMAINS = [
  'Open Data & Discovery',
  'Law & Regulation',
  'Spending & Procurement',
  'Economy & Finance',
  'Markets & Corporate',
  'Demographics',
  'Science & Space',
  'Weather & Earth',
  'Energy & Environment',
  'Agriculture & Food',
  'Health & Medicine',
  'Safety & Recalls',
  'Transportation',
  'Jobs & Labor',
  'Civic & Elections',
  'State & Local',
];

export const GOV_APIS = [
  // ── OPEN DATA & DISCOVERY: the front doors and shared gateway ──────────────────────────────────
  { agency: 'GSA / data.gov', name: 'Data.gov CKAN catalog', baseUrl: 'https://catalog.data.gov/api/3/', keyless: true, keyViaDataGov: false, domain: 'Open Data & Discovery', gives: '300k+ federal/state/local dataset records + their distribution/API endpoints (CKAN action API).', pageIdea: 'A faster, searchable index of every public dataset, with dead-link pruning.' },
  { agency: 'GSA / data.gov', name: 'api.data.gov gateway', baseUrl: 'https://api.data.gov/', keyless: true, keyViaDataGov: true, domain: 'Open Data & Discovery', gives: 'Shared API key + proxy for dozens of federal APIs (FEC, SAM, Regulations.gov, NREL, FEMA…).', pageIdea: 'One-key explainer: get a single free key, reach every agency behind the gateway.' },
  { agency: 'GSA', name: 'GSA Open Tech API index', baseUrl: 'https://open.gsa.gov/api/', keyless: false, keyViaDataGov: true, domain: 'Open Data & Discovery', gives: 'Directory of GSA-run APIs (SAM, USAspending, Site Scanning, per-diem, Assistance Listings).', pageIdea: 'A clean catalog of what GSA actually exposes, by use-case.' },
  { agency: 'GSA / 18F', name: 'Federal Site Scanning API', baseUrl: 'https://api.gsa.gov/technology/site-scanning/v1/', keyless: false, keyViaDataGov: true, domain: 'Open Data & Discovery', gives: 'Automated scans of every federal .gov website (tech stack, accessibility, https, performance).', pageIdea: 'A "state of the federal web" dashboard ranking agency sites by health.' },

  // ── LAW & REGULATION ──────────────────────────────────────────────────────────────────────────
  { agency: 'NARA / OFR', name: 'Federal Register API', baseUrl: 'https://www.federalregister.gov/api/v1/', keyless: true, keyViaDataGov: false, domain: 'Law & Regulation', gives: 'Daily rules, proposed rules, notices, presidential documents — fully keyless JSON, searchable.', pageIdea: 'A readable, searchable Federal Register with topic alerts and plain-English summaries.' },
  { agency: 'GPO', name: 'GovInfo API', baseUrl: 'https://api.govinfo.gov/', keyless: false, keyViaDataGov: true, domain: 'Law & Regulation', gives: 'Authenticated full text of bills, laws, the US Code, CFR, Congressional Record, court opinions.', pageIdea: 'A fast full-text search over all federal legal documents (better than the GPO site).' },
  { agency: 'GSA', name: 'Regulations.gov API', baseUrl: 'https://api.regulations.gov/v4/', keyless: false, keyViaDataGov: true, domain: 'Law & Regulation', gives: 'Federal dockets, documents, and public comments; supports comment submission.', pageIdea: 'A rulemaking tracker that surfaces open comment periods you can still weigh in on.' },
  { agency: 'Library of Congress', name: 'Congress.gov API', baseUrl: 'https://api.congress.gov/v3/', keyless: false, keyViaDataGov: true, domain: 'Law & Regulation', gives: 'Bills, amendments, members, votes, committees, the Congressional Record (free LoC key).', pageIdea: 'A bill-tracker that follows legislation from intro to law with status alerts.' },
  { agency: 'Library of Congress', name: 'GovTrack data', baseUrl: 'https://www.govtrack.us/api/v2/', keyless: true, keyViaDataGov: false, domain: 'Law & Regulation', gives: 'Open legislative data — votes, bills, members, with computed analyses (keyless legacy API).', pageIdea: 'Voting-record scorecards for every member of Congress.' },
  { agency: 'Courts (CourtListener)', name: 'CourtListener / RECAP API', baseUrl: 'https://www.courtlistener.com/api/rest/v4/', keyless: true, keyViaDataGov: false, domain: 'Law & Regulation', gives: 'Federal/state case law, dockets, oral-argument audio, judges (Free Law Project, keyless reads).', pageIdea: 'A free legal-research search that out-reads paywalled databases.' },

  // ── SPENDING & PROCUREMENT ────────────────────────────────────────────────────────────────────
  { agency: 'Treasury', name: 'USAspending API', baseUrl: 'https://api.usaspending.gov/api/v2/', keyless: true, keyViaDataGov: false, domain: 'Spending & Procurement', gives: 'All federal award spending — contracts/grants/loans by agency, recipient, geography, NAICS.', pageIdea: '"Where your tax dollars go": searchable spending by agency, vendor, and ZIP.' },
  { agency: 'GSA', name: 'SAM.gov Entity Management API', baseUrl: 'https://api.sam.gov/entity-information/v3/', keyless: false, keyViaDataGov: true, domain: 'Spending & Procurement', gives: 'Authoritative registry of entities doing business with the government (keyed to UEI).', pageIdea: 'A vendor look-up that shows who is registered to win federal contracts.' },
  { agency: 'GSA', name: 'SAM.gov Get Opportunities (Public)', baseUrl: 'https://api.sam.gov/opportunities/v2/search', keyless: false, keyViaDataGov: true, domain: 'Spending & Procurement', gives: 'Public federal contract-opportunity (RFP/RFI) feed.', pageIdea: 'A contract-opportunity radar with saved searches and email alerts.' },
  { agency: 'GSA', name: 'GSA Per Diem API', baseUrl: 'https://api.gsa.gov/travel/perdiem/v2/', keyless: false, keyViaDataGov: true, domain: 'Spending & Procurement', gives: 'Federal lodging/meals per-diem rates by city/county/year.', pageIdea: 'A travel-budget calculator using official per-diem rates.' },
  { agency: 'Treasury', name: 'USAspending Subawards / Recipients', baseUrl: 'https://api.usaspending.gov/api/v2/recipient/', keyless: true, keyViaDataGov: false, domain: 'Spending & Procurement', gives: 'Recipient profiles, sub-award drill-down, and award-summary breakdowns.', pageIdea: 'A grant-recipient profile page that follows money down to sub-awards.' },

  // ── ECONOMY & FINANCE ─────────────────────────────────────────────────────────────────────────
  { agency: 'Federal Reserve (St. Louis)', name: 'FRED API', baseUrl: 'https://api.stlouisfed.org/fred/', keyless: false, keyViaDataGov: false, domain: 'Economy & Finance', gives: '800k+ economic time series — GDP, CPI, unemployment, rates, money supply (free FRED key).', pageIdea: 'A clean economic-indicator dashboard that loads faster than FRED.' },
  { agency: 'Bureau of Labor Statistics', name: 'BLS Public Data API', baseUrl: 'https://api.bls.gov/publicAPI/v2/', keyless: true, keyViaDataGov: false, domain: 'Economy & Finance', gives: 'CPI, PPI, employment, wages, productivity (keyless tier; free key lifts daily quota).', pageIdea: 'An inflation tracker with real CPI series by category and region.' },
  { agency: 'Bureau of Economic Analysis', name: 'BEA API', baseUrl: 'https://apps.bea.gov/api/data/', keyless: false, keyViaDataGov: false, domain: 'Economy & Finance', gives: 'GDP, personal income, trade, GDP-by-state/industry, regional accounts (free BEA key).', pageIdea: 'A GDP-by-state map showing which states actually drive the economy.' },
  { agency: 'Treasury', name: 'Treasury Fiscal Data API', baseUrl: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/', keyless: true, keyViaDataGov: false, domain: 'Economy & Finance', gives: 'National debt, daily Treasury statement, interest rates, exchange rates — fully keyless JSON.', pageIdea: 'A live national-debt clock with the daily cash statement behind it.' },
  { agency: 'Treasury (TreasuryDirect)', name: 'TreasuryDirect APIs', baseUrl: 'https://www.treasurydirect.gov/TA_WS/', keyless: true, keyViaDataGov: false, domain: 'Economy & Finance', gives: 'Auction results, securities, average interest rates, debt-to-the-penny (keyless web service).', pageIdea: 'A Treasury-auction calendar + yield explainer for individual buyers.' },
  { agency: 'FDIC', name: 'FDIC BankFind API', baseUrl: 'https://banks.data.fdic.gov/api/', keyless: true, keyViaDataGov: false, domain: 'Economy & Finance', gives: 'Every US bank — financials, branches, failures, call-report data (keyless JSON).', pageIdea: 'A "is my bank healthy?" lookup using official call-report data.' },

  // ── MARKETS & CORPORATE ───────────────────────────────────────────────────────────────────────
  { agency: 'SEC', name: 'SEC EDGAR submissions/facts API', baseUrl: 'https://data.sec.gov/', keyless: true, keyViaDataGov: false, domain: 'Markets & Corporate', gives: 'Company filings, XBRL financial facts, full-text filing index (keyless; requires UA header).', pageIdea: 'A company-financials viewer that reads 10-Ks so you don\'t have to.' },
  { agency: 'SEC', name: 'SEC EDGAR full-text search', baseUrl: 'https://efts.sec.gov/LATEST/search-index?q=', keyless: true, keyViaDataGov: false, domain: 'Markets & Corporate', gives: 'Full-text search across all EDGAR filings since 2001 (keyless JSON).', pageIdea: 'Search every public-company filing by phrase, faster than EDGAR.' },
  { agency: 'CFTC', name: 'CFTC Public Reporting (Socrata)', baseUrl: 'https://publicreporting.cftc.gov/resource/', keyless: true, keyViaDataGov: false, domain: 'Markets & Corporate', gives: 'Commitments of Traders, swaps data, market reports via Socrata SODA (keyless reads).', pageIdea: 'A Commitments-of-Traders dashboard showing positioning by market.' },
  { agency: 'USPTO', name: 'USPTO PatentsView / Open Data', baseUrl: 'https://search.patentsview.org/api/v1/', keyless: false, keyViaDataGov: false, domain: 'Markets & Corporate', gives: 'Patents, inventors, assignees, citations; trademark data via separate USPTO APIs (free key).', pageIdea: 'An innovation map: who patents what, by company and region.' },

  // ── DEMOGRAPHICS ──────────────────────────────────────────────────────────────────────────────
  { agency: 'Census Bureau', name: 'Census Data API', baseUrl: 'https://api.census.gov/data/', keyless: true, keyViaDataGov: false, domain: 'Demographics', gives: 'ACS, decennial, population estimates, business patterns (keyless light use; free key for volume).', pageIdea: 'A place dashboard: any ZIP/county\'s people, income, and housing at a glance.' },
  { agency: 'Census Bureau', name: 'Census Geocoder API', baseUrl: 'https://geocoding.geo.census.gov/geocoder/', keyless: true, keyViaDataGov: false, domain: 'Demographics', gives: 'Address → coordinates + census geographies (tract, block, district) — fully keyless.', pageIdea: 'A free address-to-district tool (find your reps and tract).' },
  { agency: 'Census Bureau', name: 'Census International Data API', baseUrl: 'https://api.census.gov/data/timeseries/idb/', keyless: true, keyViaDataGov: false, domain: 'Demographics', gives: 'International population, fertility, mortality, and projections by country.', pageIdea: 'A world-population explorer with country projections to 2100.' },

  // ── SCIENCE & SPACE ───────────────────────────────────────────────────────────────────────────
  { agency: 'NASA', name: 'NASA Open APIs (APOD, NEO, EPIC…)', baseUrl: 'https://api.nasa.gov/', keyless: true, keyViaDataGov: true, domain: 'Science & Space', gives: 'Astronomy Picture of the Day, near-Earth objects, Mars rover photos, EPIC Earth imagery.', pageIdea: 'A daily-space page with the picture of the day and the week\'s close asteroids.' },
  { agency: 'NASA', name: 'NASA Earthdata / CMR', baseUrl: 'https://cmr.earthdata.nasa.gov/search/', keyless: true, keyViaDataGov: false, domain: 'Science & Space', gives: 'Common Metadata Repository — search NASA Earth-science granules/collections (keyless reads).', pageIdea: 'A satellite-imagery finder for any place and date.' },
  { agency: 'NSF', name: 'NSF Awards API', baseUrl: 'https://www.research.gov/awardapi-service/v1/', keyless: true, keyViaDataGov: false, domain: 'Science & Space', gives: 'National Science Foundation research grants — PIs, institutions, abstracts, amounts (keyless).', pageIdea: 'A research-funding tracker: what science the government is paying for.' },
  { agency: 'Smithsonian', name: 'Smithsonian Open Access API', baseUrl: 'https://api.si.edu/openaccess/api/v1.0/', keyless: false, keyViaDataGov: true, domain: 'Science & Space', gives: '5M+ museum object records and CC0 images across Smithsonian collections.', pageIdea: 'A browsable open-access museum of millions of public-domain objects.' },

  // ── WEATHER & EARTH ───────────────────────────────────────────────────────────────────────────
  { agency: 'NOAA / NWS', name: 'National Weather Service API', baseUrl: 'https://api.weather.gov/', keyless: true, keyViaDataGov: false, domain: 'Weather & Earth', gives: 'Forecasts, observations, active alerts/warnings, radar stations — fully keyless (UA required).', pageIdea: 'A fast, ad-free weather + active-alerts page for any US location.' },
  { agency: 'NOAA', name: 'NCEI Climate Data Online (CDO)', baseUrl: 'https://www.ncei.noaa.gov/cdo-web/api/v2/', keyless: false, keyViaDataGov: false, domain: 'Weather & Earth', gives: 'Historical climate normals, daily/monthly records by station (free NCEI token).', pageIdea: 'A climate-history page: how this date compares to the last century.' },
  { agency: 'NOAA', name: 'NOAA Tides & Currents (CO-OPS)', baseUrl: 'https://api.tidesandcurrents.noaa.gov/api/prod/', keyless: true, keyViaDataGov: false, domain: 'Weather & Earth', gives: 'Tide predictions, water levels, currents, met data at coastal stations (keyless).', pageIdea: 'A tide + coastal-conditions page for boaters and beachgoers.' },
  { agency: 'NOAA / SWPC', name: 'Space Weather Prediction Center', baseUrl: 'https://services.swpc.noaa.gov/', keyless: true, keyViaDataGov: false, domain: 'Weather & Earth', gives: 'Solar activity, geomagnetic storms, aurora forecast, satellite-environment alerts (keyless).', pageIdea: 'An aurora + solar-storm tracker (will the lights be out, or visible?).' },
  { agency: 'USGS', name: 'USGS Earthquake (FDSN) API', baseUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/', keyless: true, keyViaDataGov: false, domain: 'Weather & Earth', gives: 'Real-time + historical earthquakes (magnitude, depth, location) — keyless GeoJSON.', pageIdea: 'A live earthquake map with magnitude and "felt it?" reports.' },
  { agency: 'USGS', name: 'USGS Water Services (NWIS)', baseUrl: 'https://waterservices.usgs.gov/nwis/', keyless: true, keyViaDataGov: false, domain: 'Weather & Earth', gives: 'Streamflow, gauge height, groundwater, water quality at thousands of sites (keyless).', pageIdea: 'A flood/drought page showing your local river\'s level vs. normal.' },
  { agency: 'USGS', name: 'USGS National Map / 3DEP', baseUrl: 'https://tnmaccess.nationalmap.gov/api/v1/', keyless: true, keyViaDataGov: false, domain: 'Weather & Earth', gives: 'Elevation, topo maps, lidar, hydrography, land-cover datasets (keyless product API).', pageIdea: 'An elevation/terrain explorer for any point in the US.' },

  // ── ENERGY & ENVIRONMENT ──────────────────────────────────────────────────────────────────────
  { agency: 'EIA', name: 'EIA Open Data API v2', baseUrl: 'https://api.eia.gov/v2/', keyless: false, keyViaDataGov: false, domain: 'Energy & Environment', gives: 'Energy prices/production/consumption — electricity, gas, oil, renewables (free EIA key).', pageIdea: 'A "what does energy cost?" dashboard by state and fuel type.' },
  { agency: 'DOE / NREL', name: 'NREL Developer APIs', baseUrl: 'https://developer.nrel.gov/api/', keyless: false, keyViaDataGov: true, domain: 'Energy & Environment', gives: 'Solar resource (PVWatts), utility rates, alt-fuel stations, building data.', pageIdea: 'A rooftop-solar estimator using official sun + utility-rate data.' },
  { agency: 'EPA', name: 'EPA AirNow API', baseUrl: 'https://www.airnowapi.org/aq/', keyless: false, keyViaDataGov: false, domain: 'Energy & Environment', gives: 'Real-time air-quality index + forecasts by location (free AirNow key).', pageIdea: 'A clean air-quality page with health guidance for sensitive groups.' },
  { agency: 'EPA', name: 'EPA Envirofacts API', baseUrl: 'https://data.epa.gov/efservice/', keyless: true, keyViaDataGov: false, domain: 'Energy & Environment', gives: 'Regulated facilities, toxic releases (TRI), water/air permits, Superfund sites (keyless REST).', pageIdea: 'A "what\'s polluting near me?" map of regulated facilities by ZIP.' },
  { agency: 'EPA', name: 'EPA UV Index API', baseUrl: 'https://data.epa.gov/efservice/getEnvirofactsUVHOURLY/', keyless: true, keyViaDataGov: false, domain: 'Energy & Environment', gives: 'Hourly UV-index forecast by ZIP/city (keyless).', pageIdea: 'A sun-safety widget with daily UV peaks for your area.' },

  // ── AGRICULTURE & FOOD ────────────────────────────────────────────────────────────────────────
  { agency: 'USDA NASS', name: 'USDA Quick Stats API', baseUrl: 'https://quickstats.nass.usda.gov/api/', keyless: false, keyViaDataGov: false, domain: 'Agriculture & Food', gives: 'Crop/livestock production, prices, yields, census of agriculture (free NASS key).', pageIdea: 'A crop-and-yield dashboard by state and commodity.' },
  { agency: 'USDA FDC', name: 'USDA FoodData Central API', baseUrl: 'https://api.nal.usda.gov/fdc/v1/', keyless: false, keyViaDataGov: true, domain: 'Agriculture & Food', gives: 'Nutrient profiles for hundreds of thousands of foods (branded + standard reference).', pageIdea: 'A nutrition lookup for any food, by brand or generic name.' },
  { agency: 'USDA ERS', name: 'USDA ERS Data APIs', baseUrl: 'https://api.ers.usda.gov/data/', keyless: false, keyViaDataGov: true, domain: 'Agriculture & Food', gives: 'Farm income, food prices/CPI, international trade, ag-productivity series.', pageIdea: 'A "what\'s happening to food prices?" tracker with the drivers behind them.' },
  { agency: 'USDA', name: 'USDA Local Food / Farmers Market', baseUrl: 'https://www.usdalocalfoodportal.com/api/', keyless: false, keyViaDataGov: false, domain: 'Agriculture & Food', gives: 'Farmers markets, CSAs, food hubs, on-farm markets by location (free key).', pageIdea: 'A "find a farmers market near me" map.' },

  // ── HEALTH & MEDICINE ─────────────────────────────────────────────────────────────────────────
  { agency: 'FDA', name: 'openFDA API', baseUrl: 'https://api.fda.gov/', keyless: true, keyViaDataGov: true, domain: 'Health & Medicine', gives: 'Drug labels + adverse events, device + food recalls/enforcement, NDC directory (keyless tier).', pageIdea: 'A drug + device safety lookup: recalls and side-effect reports by product.' },
  { agency: 'CDC', name: 'CDC Open Data (Socrata)', baseUrl: 'https://data.cdc.gov/resource/', keyless: true, keyViaDataGov: false, domain: 'Health & Medicine', gives: 'Mortality, chronic disease, vaccination, surveillance datasets via Socrata SODA (keyless reads).', pageIdea: 'A public-health dashboard of the CDC\'s most-watched indicators.' },
  { agency: 'CDC', name: 'CDC WONDER API', baseUrl: 'https://wonder.cdc.gov/controller/datarequest/', keyless: true, keyViaDataGov: false, domain: 'Health & Medicine', gives: 'Detailed mortality/natality/cancer query system (keyless XML POST).', pageIdea: 'A cause-of-death explorer by demographic and place.' },
  { agency: 'NIH / NLM', name: 'PubMed E-utilities', baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/', keyless: true, keyViaDataGov: false, domain: 'Health & Medicine', gives: 'Search/fetch 35M+ biomedical citations + abstracts (keyless; free key lifts rate).', pageIdea: 'A plain-language medical-literature search over PubMed.' },
  { agency: 'NIH / NLM', name: 'RxNorm API', baseUrl: 'https://rxnav.nlm.nih.gov/REST/', keyless: true, keyViaDataGov: false, domain: 'Health & Medicine', gives: 'Normalized drug names, ingredients, interactions, NDC mappings (keyless REST).', pageIdea: 'A drug-name + interaction checker (generic ↔ brand, ingredient lookup).' },
  { agency: 'NIH', name: 'ClinicalTrials.gov API v2', baseUrl: 'https://clinicaltrials.gov/api/v2/', keyless: true, keyViaDataGov: false, domain: 'Health & Medicine', gives: 'Registry of 450k+ clinical studies — status, conditions, locations, sponsors (keyless JSON).', pageIdea: 'A "find a clinical trial near me" search by condition.' },
  { agency: 'CMS', name: 'CMS Data / Provider APIs', baseUrl: 'https://data.cms.gov/provider-data/api/1/', keyless: true, keyViaDataGov: false, domain: 'Health & Medicine', gives: 'Hospital/nursing-home/physician quality + cost data, Medicare datasets (keyless).', pageIdea: 'A hospital-quality compare page (better than Care Compare).' },
  { agency: 'HHS / NPPES', name: 'NPI Registry API', baseUrl: 'https://npiregistry.cms.hhs.gov/api/', keyless: true, keyViaDataGov: false, domain: 'Health & Medicine', gives: 'Look up any US healthcare provider by NPI, name, specialty, location (keyless).', pageIdea: 'A provider-lookup that verifies a doctor\'s credentials and specialty.' },

  // ── SAFETY & RECALLS ──────────────────────────────────────────────────────────────────────────
  { agency: 'NHTSA', name: 'NHTSA vPIC + Recalls API', baseUrl: 'https://vpic.nhtsa.dot.gov/api/', keyless: true, keyViaDataGov: false, domain: 'Safety & Recalls', gives: 'VIN decode, vehicle specs; companion recalls/complaints/ratings APIs (keyless JSON).', pageIdea: 'A VIN decoder + recall checker: is this car safe?' },
  { agency: 'CPSC', name: 'CPSC Recalls API', baseUrl: 'https://www.saferproducts.gov/RestWebServices/Recall', keyless: true, keyViaDataGov: false, domain: 'Safety & Recalls', gives: 'Consumer-product recalls + incident reports (keyless REST/JSON).', pageIdea: 'A product-recall alert page across toys, appliances, and gear.' },
  { agency: 'FSIS / USDA', name: 'FSIS Recall API', baseUrl: 'https://www.fsis.usda.gov/fsis/api/recall/v/1', keyless: true, keyViaDataGov: false, domain: 'Safety & Recalls', gives: 'Meat/poultry/egg-product recalls and public-health alerts (keyless).', pageIdea: 'A food-recall feed combined with openFDA for full grocery coverage.' },

  // ── TRANSPORTATION ────────────────────────────────────────────────────────────────────────────
  { agency: 'FAA', name: 'FAA Airport Status / NASStatus API', baseUrl: 'https://nasstatus.faa.gov/api/', keyless: true, keyViaDataGov: false, domain: 'Transportation', gives: 'Airport delays, ground stops, ground delays, and reroutes (keyless).', pageIdea: 'A "should I expect delays?" airport-status board.' },
  { agency: 'FAA / ADS-B', name: 'FAA NOTAM / Aircraft Registry', baseUrl: 'https://external-api.faa.gov/notamapi/v1/', keyless: false, keyViaDataGov: false, domain: 'Transportation', gives: 'Notices to Air Missions + aircraft-registration lookups (free FAA key).', pageIdea: 'An aircraft-registration + NOTAM lookup for pilots and spotters.' },
  { agency: 'DOT / BTS', name: 'BTS Transportation Stats', baseUrl: 'https://data.bts.gov/resource/', keyless: true, keyViaDataGov: false, domain: 'Transportation', gives: 'Airline on-time, freight, transit, border-crossing data via Socrata (keyless reads).', pageIdea: 'An airline on-time-performance ranking by route and carrier.' },
  { agency: 'FRA', name: 'FRA Safety Data (Socrata)', baseUrl: 'https://data.transportation.gov/resource/', keyless: true, keyViaDataGov: false, domain: 'Transportation', gives: 'Rail accidents/incidents, crossings, inspections via DOT Socrata (keyless reads).', pageIdea: 'A rail-safety map of grade crossings and incidents near you.' },

  // ── JOBS & LABOR ──────────────────────────────────────────────────────────────────────────────
  { agency: 'OPM / USAJOBS', name: 'USAJOBS Search API', baseUrl: 'https://data.usajobs.gov/api/', keyless: false, keyViaDataGov: false, domain: 'Jobs & Labor', gives: 'Federal job openings — title, agency, grade, location, salary (free USAJOBS key + email).', pageIdea: 'A cleaner federal-jobs board with salary and grade filters.' },
  { agency: 'DOL', name: 'Department of Labor API', baseUrl: 'https://apiprod.dol.gov/v4/', keyless: false, keyViaDataGov: false, domain: 'Jobs & Labor', gives: 'OSHA inspections, wage-and-hour, MSHA, enforcement and statistics datasets (free DOL key).', pageIdea: 'A workplace-safety lookup: OSHA inspection history for any employer.' },
  { agency: 'DOL / ETA', name: 'CareerOneStop API', baseUrl: 'https://api.careeronestop.org/v1/', keyless: false, keyViaDataGov: false, domain: 'Jobs & Labor', gives: 'Occupation profiles, wages, training programs, certifications (free key + token).', pageIdea: 'A career-explorer: pay, outlook, and training for any occupation.' },
  { agency: 'DOL', name: 'O*NET Web Services', baseUrl: 'https://services.onetcenter.org/ws/', keyless: false, keyViaDataGov: false, domain: 'Jobs & Labor', gives: 'Occupational skills, tasks, abilities, job zones for 900+ occupations (free account).', pageIdea: 'A skills-to-jobs matcher built on official occupation data.' },

  // ── CIVIC & ELECTIONS ─────────────────────────────────────────────────────────────────────────
  { agency: 'FEC', name: 'OpenFEC API', baseUrl: 'https://api.open.fec.gov/v1/', keyless: true, keyViaDataGov: true, domain: 'Civic & Elections', gives: 'Campaign finance — candidates, committees, contributions, expenditures (DEMO_KEY keyless).', pageIdea: 'A "who funds this candidate?" money-in-politics tracker.' },
  { agency: 'CFPB', name: 'CFPB Consumer Complaints API', baseUrl: 'https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/', keyless: true, keyViaDataGov: false, domain: 'Civic & Elections', gives: 'Searchable consumer complaints about financial products by company/product/state (keyless).', pageIdea: 'A "complaints about this bank/lender" lookup before you sign up.' },
  { agency: 'CFPB', name: 'CFPB HMDA Mortgage API', baseUrl: 'https://ffiec.cfpb.gov/v2/data-browser-api/', keyless: true, keyViaDataGov: false, domain: 'Civic & Elections', gives: 'Home Mortgage Disclosure Act loan-level data — approvals, rates, demographics (keyless).', pageIdea: 'A mortgage-fairness dashboard: who gets approved, where.' },
  { agency: 'FTC', name: 'FTC do-not-call / API datasets', baseUrl: 'https://api.ftc.gov/v0/', keyless: true, keyViaDataGov: false, domain: 'Civic & Elections', gives: 'Do-Not-Call complaint + robocall data, consumer-sentinel summaries (keyless).', pageIdea: 'A robocall-complaint heatmap by area code.' },
  { agency: 'GAO', name: 'GAO Reports / Bid Protests', baseUrl: 'https://www.gao.gov/api/', keyless: true, keyViaDataGov: false, domain: 'Civic & Elections', gives: 'Government Accountability Office reports, recommendations, bid-protest decisions (keyless feeds).', pageIdea: 'A "what is the government failing at?" tracker of GAO findings.' },

  // ── SAFETY / EMERGENCY (FEMA, CISA) ───────────────────────────────────────────────────────────
  { agency: 'FEMA', name: 'FEMA OpenFEMA API', baseUrl: 'https://www.fema.gov/api/open/', keyless: true, keyViaDataGov: false, domain: 'Safety & Recalls', gives: 'Disaster declarations, public-assistance, flood-insurance (NFIP), housing-assistance (keyless).', pageIdea: 'A disaster-declaration map + flood-risk lookup for your county.' },
  { agency: 'CISA', name: 'CISA KEV + Vuln APIs', baseUrl: 'https://www.cisa.gov/sites/default/files/feeds/', keyless: true, keyViaDataGov: false, domain: 'Safety & Recalls', gives: 'Known Exploited Vulnerabilities catalog + advisories (keyless JSON feeds).', pageIdea: 'A "patch this now" feed of actively-exploited vulnerabilities.' },
  { agency: 'NIST', name: 'NVD CVE API', baseUrl: 'https://services.nvd.nist.gov/rest/json/cves/2.0', keyless: true, keyViaDataGov: false, domain: 'Safety & Recalls', gives: 'National Vulnerability Database — CVEs, CVSS scores, CPE (keyless; free key lifts rate).', pageIdea: 'A searchable CVE database with severity and affected-product filters.' },

  // ── STATE & LOCAL: the portal patterns (not single endpoints) ─────────────────────────────────
  { agency: 'States/Cities (Tyler-Socrata)', name: 'Socrata Open Data API (SODA)', baseUrl: 'https://{domain}/resource/{dataset}.json', keyless: true, keyViaDataGov: false, domain: 'State & Local', gives: 'The query layer under thousands of state/city portals (data.ca.gov, data.ny.gov, data.cityofchicago.org). SoQL over HTTP, keyless reads.', pageIdea: 'A unified search across every state/city Socrata portal at once.' },
  { agency: 'States/Cities (CKAN)', name: 'CKAN Action API', baseUrl: 'https://{portal}/api/3/action/', keyless: true, keyViaDataGov: false, domain: 'State & Local', gives: 'The catalog API behind data.gov and many state/city CKAN portals — dataset + resource search.', pageIdea: 'A cross-portal dataset finder spanning federal + state CKAN catalogs.' },
  { agency: 'States/Cities (ArcGIS)', name: 'Esri ArcGIS REST (open layers)', baseUrl: 'https://services.arcgis.com/', keyless: true, keyViaDataGov: false, domain: 'State & Local', gives: 'Public ArcGIS feature services many agencies publish (parcels, zoning, boundaries) — keyless reads on open layers.', pageIdea: 'A property/zoning lookup pulling each county\'s open GIS layers.' },
  { agency: 'Cities (Open311)', name: 'Open311 GeoReport v2', baseUrl: 'https://{city}/open311/v2/', keyless: true, keyViaDataGov: false, domain: 'State & Local', gives: '311 non-emergency service requests + service lists (potholes, graffiti). Read endpoints keyless.', pageIdea: 'A city-services tracker: report and follow 311 requests in one place.' },

  // ── PARKS & PUBLIC LANDS ──────────────────────────────────────────────────────────────────────
  { agency: 'NPS', name: 'National Park Service API', baseUrl: 'https://developer.nps.gov/api/v1/', keyless: false, keyViaDataGov: true, domain: 'Science & Space', gives: 'Park info, alerts, activities, campgrounds, events, fees, hours (free NPS key via api.data.gov).', pageIdea: 'A trip-planner for every national park with live alerts and conditions.' },
  { agency: 'Recreation.gov', name: 'RIDB Recreation API', baseUrl: 'https://ridb.recreation.gov/api/v1/', keyless: false, keyViaDataGov: false, domain: 'Science & Space', gives: 'Federal recreation facilities, campsites, permits across agencies (free RIDB key).', pageIdea: 'A campsite-availability finder across all federal lands.' },
];

// All entries in a domain.
export function byDomain(domain) {
  return GOV_APIS.filter((e) => e.domain === domain);
}

// Entries callable with NO key at all (keyless true). These are safe to demo/read immediately.
export function keylessApis() {
  return GOV_APIS.filter((e) => e.keyless === true);
}

// Entries that work with the single free api.data.gov key (DEMO_KEY for light use, real key for volume).
export function dataGovKeyApis() {
  return GOV_APIS.filter((e) => e.keyViaDataGov === true);
}

// Entries that need their OWN agency key/registration (neither keyless nor api.data.gov).
export function ownKeyApis() {
  return GOV_APIS.filter((e) => !e.keyless && !e.keyViaDataGov);
}

// Quick counts for the Resource-Center header.
export function summary() {
  const byDom = Object.fromEntries(DOMAINS.map((d) => [d, byDomain(d).length]));
  return {
    total: GOV_APIS.length,
    keyless: keylessApis().length,
    dataGovKey: dataGovKeyApis().length,
    ownKey: ownKeyApis().length,
    byDomain: byDom,
  };
}

// ── KEYLESS LIVE READERS ─────────────────────────────────────────────────────────────────────────
// Each soft-fails (returns [] or null) and never throws. Normalized to a small, stable shape so the
// Resource Center / "better than the government" pages can render without knowing the upstream schema.

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Federal Register — recent documents matching a query. Keyless. Returns [] on any failure. */
export async function federalRegister(q = '') {
  const url = `https://www.federalregister.gov/api/v1/documents.json?per_page=20&order=newest`
    + (q ? `&conditions[term]=${encodeURIComponent(q)}` : '');
  const j = await getJson(url);
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map((d) => ({
    title: d.title || '',
    type: d.type || '',
    agency: (d.agencies && d.agencies[0] && d.agencies[0].name) || '',
    date: d.publication_date || '',
    url: d.html_url || '',
  })).filter((d) => d.title);
}

/** USAspending — top award recipients/spending for a free-text keyword. Keyless POST. Returns [] on failure. */
export async function usaspending(q = '') {
  try {
    const body = {
      filters: { keywords: [String(q || 'technology')], award_type_codes: ['A', 'B', 'C', 'D'] },
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Description'],
      sort: 'Award Amount', order: 'desc', limit: 20, page: 1,
    };
    const r = await _fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j?.results) ? j.results : [];
    return rows.map((a) => ({
      awardId: a['Award ID'] || '',
      recipient: a['Recipient Name'] || '',
      amount: a['Award Amount'] ?? null,
      agency: a['Awarding Agency'] || '',
      description: a['Description'] || '',
    })).filter((a) => a.recipient || a.awardId);
  } catch { return []; }
}

/** Treasury Fiscal Data — most recent rows of a dataset endpoint path. Keyless. Returns [] on failure.
 *  dataset = the fiscal_service path, e.g. 'v2/accounting/od/debt_to_penny'. */
export async function treasuryFiscal(dataset = 'v2/accounting/od/debt_to_penny') {
  const path = String(dataset).replace(/^\/+/, '');
  const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/${path}`
    + `?sort=-record_date&page[size]=20`;
  const j = await getJson(url);
  const rows = Array.isArray(j?.data) ? j.data : [];
  return rows.map((r) => ({
    date: r.record_date || '',
    ...r,
  }));
}

/** FEMA OpenFEMA — recent disaster declarations. Keyless. Returns [] on failure. */
export async function fema() {
  const url = 'https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries'
    + '?$orderby=declarationDate desc&$top=20';
  const j = await getJson(url);
  const rows = Array.isArray(j?.DisasterDeclarationsSummaries) ? j.DisasterDeclarationsSummaries : [];
  return rows.map((d) => ({
    disasterNumber: d.disasterNumber ?? null,
    state: d.state || '',
    type: d.incidentType || '',
    title: d.declarationTitle || '',
    date: d.declarationDate || '',
  })).filter((d) => d.disasterNumber != null);
}

/** USGS — earthquakes in the past day (M2.5+). Keyless GeoJSON. Returns [] on failure. */
export async function usgsQuakes() {
  const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
  const j = await getJson(url);
  const feats = Array.isArray(j?.features) ? j.features : [];
  return feats.map((f) => {
    const p = f.properties || {};
    const c = (f.geometry && f.geometry.coordinates) || [];
    return {
      magnitude: p.mag ?? null,
      place: p.place || '',
      time: p.time != null ? new Date(p.time).toISOString() : '',
      depthKm: c[2] ?? null,
      url: p.url || '',
    };
  }).filter((q) => q.magnitude != null);
}

// CLI:  node integrations/soapbox/govapis.mjs   (prints catalog summary; --live runs the readers)
if (process.argv[1] && process.argv[1].endsWith('govapis.mjs')) {
  const s = summary();
  console.log('\nMELEK govapis catalog');
  console.log('─'.repeat(60));
  console.log(`Total: ${s.total}   keyless: ${s.keyless}   api.data.gov-key: ${s.dataGovKey}   own-key: ${s.ownKey}`);
  console.log('By domain:');
  for (const [d, n] of Object.entries(s.byDomain)) console.log(`  ${d.padEnd(26)} ${n}`);
  console.log('─'.repeat(60));
  if (process.argv.includes('--live')) {
    const fr = await federalRegister('artificial intelligence');
    console.log(`\nFederal Register (AI): ${fr.length} docs`);
    for (const d of fr.slice(0, 3)) console.log(`  ${d.date}  ${d.title}`);
    const qk = await usgsQuakes();
    console.log(`\nUSGS quakes (M2.5+, 24h): ${qk.length}`);
    for (const q of qk.slice(0, 3)) console.log(`  M${q.magnitude}  ${q.place}`);
  }
}
