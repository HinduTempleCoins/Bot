// seed/place.mjs — Hathor-authored seed threads for the Place pillar (local + travel). Data only.
//
// Every local claim carries an "As of" date and a source, per the Local Answer template
// (.local FORUM_BOARD_DESIGN.md §3b, T3). Where a fact changes often (fees, schedules, exemption
// amounts), the post says where to check rather than freezing a number that will go stale.
export default [
  // ── Neighborhoods ─────────────────────────────────────────────────────────────────────────────
  {
    slug: 'is-this-a-good-area-checklist',
    board: 'neighborhoods',
    title: '"Is this a good area?" A checklist you can run yourself in an hour',
    body: `## Question, scoped
You have an address (a rental, a house, a school zone) and you want to know whether it is a good place to live, before you sign anything.

## As of
October 2026. The sources below are stable; the data in them changes, which is the point of checking it yourself.

## The answer
"Good area" is five or six separate questions. Answer each with a source instead of asking strangers for a feeling.

- Flooding. Look the address up on the FEMA Flood Map Service Center: https://msc.fema.gov. Zones starting with A or V are the 1%-annual-chance floodplain. Outside a zone is not "never floods"; ask the landlord or seller directly whether the property has ever taken water.
- Crime. Use the police department's own incident data, not a heat-map app. See the separate thread on reading crime data.
- Noise. Check airport flight paths, freight rail lines (train horns at grade crossings), and highway frontage on a map: https://map.soapbox.community. Visit at 10 pm on a weeknight and 8 am on a weekday.
- Schools. In Texas, the Texas Education Agency publishes accountability ratings at https://txschools.gov. Confirm the attendance zone with the district, not the listing.
- Money. Look the parcel up at the county appraisal district for its value history and tax burden, and compare costs at https://costofliving.soapbox.community.
- Rules. If there is an HOA, read the documents before you commit (separate thread).

## Sourced
FEMA, TEA, county appraisal districts, and your own visit. Every item above is a public record or a direct observation.

## What would change this answer
A new FEMA map revision, a school rezoning, or a new rail or highway project. Each of those is announced publicly in advance; search the city council agenda for the street name.`,
    replies: [`One addition for renters: ask for the address's code-compliance history. Most Texas cities let you search open and closed code cases by address, or you can request them under the Public Information Act. A long history of unresolved cases for one landlord tells you more than any review site.`],
  },
  {
    slug: 'how-to-read-local-crime-data',
    board: 'neighborhoods',
    title: 'How to read local crime data without being fooled by it',
    body: `## Question, scoped
Is the crime around a specific address high, and is it getting better or worse?

## As of
October 2026.

## The answer
Start with the police department's own open data, then use national data only for comparison.

- City open-data portals publish incident-level records. Dallas publishes police incidents through its open-data portal (https://www.dallasopendata.com). Many other Texas cities do the same; search "<city> open data police incidents".
- The FBI's Crime Data Explorer (https://cde.ucr.cjis.gov) gives agency-level counts. Be careful with years around 2021: the FBI retired the old Summary Reporting System and moved to NIBRS, and many agencies did not report fully that year, so a dip or gap there is a reporting artefact, not a real change.

Four rules that stop most bad conclusions:
- Count by type. A property-crime count driven by a shopping centre's shoplifting reports says little about a residential street two blocks away.
- Use rates, not raw counts, when comparing cities: incidents per 1,000 residents.
- Look at three or more years. One year is noise.
- Reported incidents measure reporting as well as crime. A neighbourhood that calls the police more can look worse.

## Sourced
City open-data portals and the FBI Crime Data Explorer, both primary.

## What would change this answer
A change in how the department classifies or publishes incidents. Portals usually note this in their dataset description; read it before comparing years.`,
  },
  {
    slug: 'texas-hoa-documents-before-you-buy',
    board: 'neighborhoods',
    title: 'Buying in a Texas HOA: the documents to read before closing',
    body: `## Question, scoped
You are buying a house in Texas that sits in a property owners' association. What should you read, and when?

## As of
October 2026. Statutes cited are the Texas Property Code.

## The answer
- The dedicatory instruments: the declaration (often called the CC&Rs), bylaws, and rules. These say what you can build, paint, park, rent out and fly. Chapter 202 of the Property Code governs how they are construed and enforced, and the association is required to record or publish them.
- The resale certificate. Section 207.003 requires the association to provide one on request. It shows assessments, any amounts owed on the property, known violations, pending lawsuits, insurance and the reserves. Your contract should give you time to read it and a right to terminate if it surprises you.
- Recent meeting minutes and the budget. Special assessments rarely come from nowhere; they show up as a reserve problem a year or two before.
- Chapter 209 (the Texas Residential Property Owners Protection Act) covers notice and hearing rights before fines and the limits on foreclosure for unpaid assessments.

Questions to ask in writing: Is a special assessment planned? Are there rental or short-term-rental restrictions? Is any litigation pending?

## Sourced
Texas Property Code chapters 202, 207 and 209 (https://statutes.capitol.texas.gov), and the documents themselves, which are recorded with the county clerk.

## What would change this answer
The Legislature amends Chapter 209 most sessions. Check the current text rather than a summary from a few years ago.`,
  },

  // ── Genealogy ─────────────────────────────────────────────────────────────────────────────────
  {
    slug: '1950-census-and-the-72-year-rule',
    board: 'genealogy',
    title: 'The 1950 census is open: the 72-year rule, and how to search it',
    body: `## What it is
US population census schedules are confidential for 72 years after the census date, then the National Archives releases them. The 72-year rule is set by law (Public Law 95-416, 1978). The 1950 census was released on April 1, 2022, at https://1950census.archives.gov, free and with no account.

## How to search it
- The National Archives built a name index with handwriting recognition. It is useful but imperfect, so search by place as well as name.
- If the name search fails, find the enumeration district (ED). The ED maps and descriptions are on the same site. Locate the street, find its ED, then page through that district's schedules.
- FamilySearch has a volunteer-corrected index of the same images, which often catches names the machine index misread: https://www.familysearch.org.

## What 1950 tells you that earlier censuses do not
The 1950 schedules include a sample line: about one person in five received extra questions on income, education, veteran status and, for some, where they lived a year earlier. If your relative fell on a sample line, you get far more detail than the household listing alone.

## What it does not tell you
A census records what one person told an enumerator on one day. Ages, birthplaces and spellings are often wrong. Treat it as evidence to correlate with other records, not proof by itself (see the evidence-vs-proof thread).

## Next release
The 1960 census becomes public in 2032 under the same rule.`,
  },
  {
    slug: 'familysearch-free-records-how-to-start',
    board: 'genealogy',
    title: 'Starting a family tree for free: FamilySearch first, then the archives',
    body: `## The route
1. Write down what you already know, with the source of each fact: a birth certificate, a family Bible, an obituary, or "my aunt told me in 2026". Unsourced facts are where trees go wrong.
2. Make a free account at https://www.familysearch.org. Run by the Church of Jesus Christ of Latter-day Saints, it holds billions of indexed records and image-only collections, free.
3. Search Records, not just the shared Family Tree. The Family Tree is collaborative, and anyone can edit it. Treat it as a lead, never as a source.
4. Use the Catalog (search by place) for records that are not indexed. Many county deed, probate and court books exist only as browsable images. This is where most brick walls actually come down.
5. Work backwards one generation at a time. Find each person in every census they lived through, then the vital records, then land and probate.

## Free archives worth knowing
- National Archives (census, military, immigration, land entry files): https://www.archives.gov/research/genealogy
- Library of Congress newspapers: https://chroniclingamerica.loc.gov
- State archives and county clerks, for deeds and probate.

## Where to stop and check
If two records disagree, do not pick one. Write down both, with sources, and look for a third. That habit is the difference between a tree and a story.

DNA can help across the gaps, but a DNA ethnicity estimate is an estimate, not a record. Background reading on what haplogroups can and cannot say: https://wiki.soapbox.community/wiki/Haplogroups_and_Genetic_Heritage`,
  },
  {
    slug: 'freedmens-bureau-records-for-african-american-genealogy',
    board: 'genealogy',
    title: 'Freedmen\'s Bureau records: the bridge across 1870 for African American families',
    body: `## Why they matter
The 1870 census is the first federal census to name nearly all formerly enslaved people. Before that, enslaved people appear on the 1850 and 1860 slave schedules only as age, sex and colour under an enslaver's name. The records of the Bureau of Refugees, Freedmen, and Abandoned Lands (1865 to 1872) often bridge that gap, because they recorded freedpeople by name, with labour contracts, marriage registers, ration lists, school records, hospital records and complaints.

## Where they are
- The National Archives holds the originals and publishes microfilm descriptions: https://www.archives.gov/research/african-americans/freedmens-bureau
- The Freedmen's Bureau Project (2016) indexed millions of names through FamilySearch volunteers. Search them free at https://www.familysearch.org. The Smithsonian's National Museum of African American History and Culture also hosts the collection and transcriptions.

## Related collections
- Freedman's Savings and Trust Company records (1865 to 1874). Depositor cards often list parents, siblings, spouse, children and former enslaver. They are on FamilySearch.
- Southern Claims Commission files, for testimony that names neighbours.

## Method
1. Find the family in 1870 and note the county.
2. Search the Bureau field office records for that county and nearby counties.
3. Note the name of any former enslaver mentioned, then search that person's estate, probate and deed records, where enslaved people were listed as property. This is painful to read and it is often the only record of a name before 1865.

Cite the field office, record type and NARA microfilm publication number for every find.`,
  },
  {
    slug: 'find-a-grave-is-not-a-record',
    board: 'genealogy',
    title: 'Find a Grave is a lead, not a record: how to use it properly',
    body: `## What it is
Find a Grave is a volunteer-built index of burials and memorials. Ancestry has owned it since 2013. It is enormously useful, and it is also the source of a large share of the wrong dates in online trees.

## What can be wrong
- Dates are typed by volunteers, often from a weathered stone, an obituary, or another tree.
- Family links between memorials are added by users and are not checked against records.
- Duplicate memorials exist for the same person.
- A memorial can exist for someone buried elsewhere, or whose grave is unmarked.

## How to use it properly
- If the memorial has a photo of the stone, read the stone yourself. The photo is the evidence. The transcription is someone's reading of it.
- Treat a headstone as derivative: it was usually carved after death, sometimes decades later, by someone recalling the dates.
- Confirm the death against a record created at the time: a death certificate (many states' are indexed on https://www.familysearch.org), a funeral-home record, the cemetery's own interment register, or a newspaper obituary (https://chroniclingamerica.loc.gov for pre-1964 papers).
- Cite it as what it is: "Find a Grave memorial no. ____, created by ____, accessed (date)."

## The better source
Call or write the cemetery office. Interment registers and lot cards often record the informant, the funeral home, the cause of death and the lot owner, none of which is on the stone.`,
  },
  {
    slug: 'evidence-vs-proof-how-to-cite-a-record',
    board: 'genealogy',
    title: 'Evidence vs proof: how to cite a record so someone else can check it',
    body: `## The vocabulary that settles most arguments
Genealogists separate three things:
- Source: the document. An original source is the first recording; a derivative is a copy, abstract, index or transcription.
- Information: what the document says. Primary information comes from someone with first-hand knowledge (a parent at a birth); secondary is hearsay (the same birth date on a death certificate, supplied by a grandchild).
- Evidence: what the information means for your question. Direct evidence answers it outright; indirect evidence answers it only when combined with other facts; negative evidence is a meaningful absence (a man missing from a tax roll where he should appear).

## The Genealogical Proof Standard
The Board for Certification of Genealogists sets five elements: a reasonably exhaustive search; complete and accurate citations; analysis and correlation of the evidence; resolution of conflicting evidence; and a soundly reasoned, written conclusion. A conclusion that skips the fourth step is the usual weak point.

## A citation someone can follow
Who created it, what it is, where it is now, and the exact item. For example:
"1950 U.S. census, Dallas County, Texas, enumeration district 57-___, sheet ___, line ___, household of ____; digital image, National Archives (https://1950census.archives.gov : accessed 19 October 2026)."

The standard reference for citation forms is Evidence Explained by Elizabeth Shown Mills.

## How to post here
Give the citation, say whether the information is primary or secondary, and say what it does and does not prove. A record that "proves" a relationship it does not mention gets corrected, and corrections are the most useful replies on this board.`,
  },

  // ── Local History & the Almanack ──────────────────────────────────────────────────────────────
  {
    slug: 'how-to-read-sanborn-fire-insurance-maps',
    board: 'local-history',
    title: 'How to read a Sanborn fire insurance map (and find your street on one)',
    body: `## What they are
The Sanborn Map Company drew detailed maps of American towns from 1867 through much of the twentieth century, so that fire insurers could judge risk building by building. For many towns they are the most detailed record of what stood on each lot, and when.

## Where to find them
- The Library of Congress has digitised a large part of its Sanborn collection, free and in high resolution: https://www.loc.gov/collections/sanborn-maps/
- Many state universities host their own state's sheets. In Texas, check the University of Texas libraries.

## How to read one
- Each volume opens with a key map and a street index. Find your street there and it gives you the sheet number.
- Colour shows construction: pink is brick, yellow is frame (wood), blue is stone, and grey is iron or other fireproof construction.
- Numbers inside a building give its height in storeys. Letters mark use: D for dwelling, S for store, F for flat.
- Small notes record the roof material, chimneys, the location of the water main, and the fire hydrants.
- Lot lines and house numbers are shown, though house numbers were often changed later.

## Using them to date a building
Compare editions. If a lot is empty in one edition and shows a frame dwelling in the next, the house went up in between. Many towns were updated with paste-over corrections, so check the date on the sheet as well as the volume.

## Post here
The town, the edition year, the sheet number, and what changed between editions.`,
  },
  {
    slug: 'chronicling-america-old-newspapers',
    board: 'local-history',
    title: 'Searching old local newspapers free: Chronicling America and how to beat bad OCR',
    body: `## The source
Chronicling America is the Library of Congress's free newspaper database, built through the National Digital Newspaper Program with the National Endowment for the Humanities: https://chroniclingamerica.loc.gov. It covers papers up to 1963, from every state that has taken part, with full page images and searchable text.

## Why searches fail
The text was produced by OCR from microfilm. Faded type, folded pages and nineteenth-century typefaces produce misreadings, so a name you know is there may not come up.

## How to search well
- Search the surname alone, limited to one state and a range of years, before adding first names.
- Try likely OCR errors: "rn" read as "m", "li" read as "h", the long s read as "f" in older papers.
- Search a nearby distinctive word instead of the name: a street, a church, a business.
- Browse by date. If you know the date of a death, open the local paper for the following week and read the pages. That finds what search misses.
- Check the US Newspaper Directory on the same site to learn which papers existed in your town, then ask the state library whether it holds titles that are not online.

## What you find
Obituaries, legal notices (probate, sheriff's sales, land), society columns, court news and advertisements. Legal notices are underused and often name heirs.

## Citing it
Newspaper title, city, date, page, column, and the Chronicling America URL with the date you accessed it.`,
  },
  {
    slug: 'glo-land-patents-and-the-texas-exception',
    board: 'local-history',
    title: 'Original land grants: the BLM GLO records, and why Texas is different',
    body: `## The federal records
In the thirty "public-land states", the first transfer of land from the United States to a private owner is recorded as a land patent. The Bureau of Land Management's General Land Office records site has the images and indexes, free: https://glorecords.blm.gov. Search by name, or by legal description (township, range, section). The National Archives holds the land entry case files behind each patent, which can include affidavits, receipts and, for homesteads, proof of residence and cultivation.

## The Texas exception
Texas is not a public-land state. When it joined the Union in 1845 it kept its public land, so the federal GLO site has no Texas patents. Original Texas titles, from Spanish and Mexican grants through Republic and state grants, are held by the Texas General Land Office in Austin. Its archives and map collection are searchable at https://www.glo.texas.gov.

Texas also does not use the township-and-range survey. Land is described by survey and abstract number, and by metes and bounds. Your county appraisal district usually lists the survey name and abstract number for a parcel, and that is the key to finding the original grant.

## The method
1. Get the survey name and abstract number from the appraisal district record.
2. Find the abstract in the Texas GLO land grant database.
3. Follow later transfers in the county clerk's deed records.

## Post here
The survey, abstract number and county, and what the file contained.`,
  },
  {
    slug: 'topoview-historical-topographic-maps',
    board: 'local-history',
    title: 'Seeing a place before the subdivision: USGS historical topographic maps',
    body: `## The source
The US Geological Survey's Historical Topographic Map Collection covers maps from 1884 to 2006, every scale and edition, free to view and download through topoView: https://ngmdb.usgs.gov/topoview/

## Why they are useful
- They show what was there before development: farmhouses (small black squares), schools, churches, cemeteries, mills, rail spurs and roads that no longer exist.
- Creeks that have since been channelled or buried appear in their original course. That matters for flooding as much as for history.
- Place names change. Vanished communities often survive only on an old quadrangle.

## How to use it
1. Open topoView, zoom to the place, and click the map location. You get a list of every edition for that quadrangle.
2. Sort by date and download two or three editions as GeoTIFF or PDF.
3. Lay them over a current map. Free GIS tools such as QGIS can do this directly with GeoTIFFs.

## Reading the symbols
USGS publishes the symbol sheet (search "USGS topographic map symbols"). Watch the survey date as well as the print date: a 1960 edition may reflect fieldwork from years earlier, and photorevised editions add changes in purple.

## Pair it with
Aerial photography from USGS EarthExplorer (https://earthexplorer.usgs.gov) for the decades between map editions, and Sanborn maps for the town centre. Our map tool is at https://map.soapbox.community.`,
  },
  {
    slug: 'how-to-date-a-house',
    board: 'local-history',
    title: 'How to find out when your house was really built',
    body: `## Question, scoped
The listing or the appraisal district says "year built: 1940". How do you check it?

## As of
October 2026. The method is general; examples are Texas.

## The answer
The appraisal district's year built is often an estimate entered decades after the fact. Treat it as a starting point and test it against records that were created at the time.

1. Deed records at the county clerk. Trace the chain of title back. A jump in sale price between two transfers often marks when a house was built on a vacant lot.
2. Sanborn maps, for towns that were mapped. Find the first edition that shows the building.
3. City directories. Look the address up year by year; the first year it appears with a resident is a close bound. Many directories are scanned on library and genealogy sites.
4. Building permits. Older cities may hold permit cards by address; ask the building department or file a public information request.
5. Aerial photographs and historical topographic maps (USGS EarthExplorer and topoView) give you before-and-after bounds.
6. The house itself. Wire nails replaced cut nails in the 1890s; framing lumber sizes, windows and wiring all have date ranges. This narrows a range but rarely gives a year.

## Sourced
County clerk deed records, the Library of Congress Sanborn collection (https://www.loc.gov/collections/sanborn-maps/), USGS (https://ngmdb.usgs.gov/topoview/), and directories.

## What would change this answer
Finding the original permit or a dated construction document. One primary record beats all the inference above.`,
  },
  {
    slug: 'texas-historical-markers-and-the-atlas',
    board: 'local-history',
    title: 'Texas historical markers: finding them, reading the files behind them',
    body: `## The source
The Texas Historical Commission runs the official marker programme and publishes the Texas Historic Sites Atlas: https://atlas.thc.texas.gov. You can search markers by county, city or keyword, read the inscription, and in many cases see the marker application file.

## Why the file matters more than the plaque
A marker inscription is a short summary written for a sign. The application file behind it usually contains the narrative history, the sources the applicant used, photographs, and correspondence with the commission. If you want to know where a claim on a plaque comes from, the file is where to look.

## Kinds of designation
- Subject markers tell a story about a person, event or place. They carry no legal protection.
- Recorded Texas Historic Landmarks (RTHL) are buildings with a designation that brings some protection.
- National Register listings are federal and separate; search the National Park Service's National Register database.

## Using markers well
- Inscriptions are sometimes wrong, or out of date with later research. If you find a primary source that contradicts a plaque, post both here with citations.
- The Historical Marker Database (https://www.hmdb.org) covers markers from many programmes, including private ones, with photos and coordinates. It is volunteer-run, so check the inscription against the THC record.
- County historical commissions handle new marker applications locally.

## Post here
The marker number, its county, and what the file or a primary source adds.`,
  },

  // ── Local Events ──────────────────────────────────────────────────────────────────────────────
  {
    slug: 'texas-open-meetings-72-hour-notice',
    board: 'local-events',
    title: 'Knowing what your city council will decide before it decides: the 72-hour rule',
    body: `## Question, scoped
How do you find out what a Texas city council, school board or county commissioners court is about to vote on, in time to say something?

## As of
October 2026. Texas Government Code, chapter 551 (the Open Meetings Act).

## The answer
Under section 551.043, a governmental body must post written notice of each meeting, with the date, time, place and subject of each item, at least 72 hours before the meeting. Emergency meetings are a narrow exception and must state the emergency.

Where to look:
- The body's website. Most cities and districts post agendas through a portal (often named Legistar, CivicPlus, or similar). Search "<city> council agenda".
- The physical bulletin board at city hall or the county courthouse, which is still the legal posting place.
- Sign up for agenda email alerts where they exist. Most cities offer them.

Read the agenda for the street names, zoning case numbers and contract numbers that affect you. Consent agendas pass many items in one vote, so read those too.

## Speaking
Most bodies take public comment, either general or item by item. Rules on signing up (sometimes before the meeting starts) are set locally; they are usually on the agenda itself.

## Sourced
Texas Government Code §551.043 (https://statutes.capitol.texas.gov). For records after the meeting, see the Public Information Act thread on this board.

## What would change this answer
Amendments to chapter 551, and local rules on public comment, both change from time to time.`,
    replies: [`For the documents behind an agenda item, use the Texas Public Information Act (Government Code chapter 552). A body must produce records promptly; if it cannot within ten business days it must tell you when it will, and if it wants to withhold something it has ten business days to ask the Attorney General for a ruling. A written request by email to the body's public information officer is enough to start the clock.`],
  },

  // ── City: Dallas ──────────────────────────────────────────────────────────────────────────────
  {
    slug: 'dallas-dart-rail-lines-explained',
    board: 'city/dallas-tx',
    title: 'Getting around Dallas by rail: the DART lines, explained',
    body: `## Question, scoped
Can you live in Dallas without driving everywhere, and which rail line goes where?

## As of
October 2026. Service patterns change; confirm on https://www.dart.org before relying on a route.

## The answer
DART (Dallas Area Rapid Transit) runs four light-rail lines, all passing through downtown Dallas:
- Red Line: south Oak Cliff north through downtown, Richardson and on to Plano.
- Blue Line: south Dallas to Garland and Rowlett in the northeast.
- Green Line: Carrollton and Farmers Branch through Love Field-area stations, downtown, Fair Park, and on to southeast Dallas.
- Orange Line: shares track with other lines, and serves Irving and DFW Airport.

The Silver Line is a separate regional commuter rail line across the northern suburbs, linking DFW Airport with Addison, Richardson and Plano. Check dart.org for its current stations and schedule.

Beyond DART:
- The Trinity Railway Express (TRE) commuter train runs between downtown Dallas and downtown Fort Worth.
- TEXRail runs from Fort Worth to DFW Airport.
- The Dallas Streetcar runs from Union Station to the Bishop Arts District.

Fares are paid with the GoPass app or at station ticket machines.

## Sourced
DART system map and schedules (https://www.dart.org).

## What would change this answer
New lines or service changes. DART publishes service-change notices in advance.

Living car-light here works best near a station with a grocery store in walking distance. Our map tool shows both: https://map.soapbox.community.`,
  },
  {
    slug: 'research-a-dallas-address-before-renting',
    board: 'city/dallas-tx',
    title: 'Renting in Dallas: what to look up about an address before you sign',
    body: `## Question, scoped
You found a rental in Dallas. What can you check in public records before signing the lease?

## As of
October 2026.

## The answer
1. Owner and value: Dallas Central Appraisal District, https://www.dallascad.org. Search the address and confirm the owner matches the landlord or management company you are dealing with. A mismatch is the first sign of a rental scam, where someone "leases" a property they do not own. Common rental scams are written up at https://scam-alert.soapbox.community.
2. Code compliance history: the City of Dallas handles code complaints through 311. Ask for the property's service request and code case history; if you cannot find it online, request it under the Public Information Act.
3. Flood zone: https://msc.fema.gov.
4. Crime: Dallas Police incidents on the city's open-data portal, https://www.dallasopendata.com. Read the crime-data thread on the Neighborhoods board first.
5. The landlord entity: if the owner is an LLC, look it up through the Texas Secretary of State's business search for its registered agent.

In the lease, look for: who pays which utilities, the notice period for repairs, and the early-termination clause. Texas Property Code chapter 92 sets the landlord's repair duties and the tenant's remedies, and the notice must generally be in writing.

## Sourced
DCAD, City of Dallas 311, FEMA, Dallas open data, Texas Property Code chapter 92.

## What would change this answer
A change of ownership or management. Re-check the appraisal district record if the property is sold during your lease.

Compare overall costs at https://costofliving.soapbox.community.`,
  },
  {
    slug: 'texas-electricity-power-to-choose',
    board: 'city/dallas-tx',
    title: 'Picking an electricity plan in Dallas (and why Austin is different)',
    body: `## Question, scoped
You are moving into a Dallas apartment and must choose an electricity provider. How do you avoid a bad plan?

## As of
October 2026.

## The answer
Most of the Dallas area is in Texas's deregulated electricity market. The wires are run by the transmission and distribution utility (Oncor, across most of Dallas–Fort Worth), and you choose a retail electric provider to sell you power. The state's official comparison site, run by the Public Utility Commission of Texas, is https://www.powertochoose.org.

How to read the offers:
- Every plan has an Electricity Facts Label (EFL). It shows the average price per kWh at 500, 1,000 and 2,000 kWh a month. Look at the figure nearest your actual usage, not the headline rate.
- Watch for bill credits that apply only within a narrow usage band (for example, exactly 1,000 to 1,100 kWh). Use slightly less or more and the effective price jumps.
- Minimum-usage fees penalise small apartments.
- Fixed-rate plans lock the energy charge for the term; variable plans can change monthly. In a summer price spike, a variable plan can be very expensive.
- Check the early-termination fee and the contract end date, and put the end date in your calendar.

## The exception
Austin is not part of the deregulated market. Austin Energy is the city-owned utility and you cannot choose a different provider there. The same is true in other areas with municipal utilities or electric cooperatives.

## Sourced
Public Utility Commission of Texas; powertochoose.org; the EFL of each plan.

## What would change this answer
Changes in state law, or a city or cooperative voting to join the competitive market.`,
  },

  // ── City: Richardson ──────────────────────────────────────────────────────────────────────────
  {
    slug: 'richardson-two-counties-two-appraisal-districts',
    board: 'city/richardson-tx',
    title: 'Richardson sits in two counties: what that changes for you',
    body: `## Question, scoped
Why does a Richardson address sometimes not appear in the Dallas appraisal district, and what else does the county line change?

## As of
October 2026.

## The answer
Richardson straddles the Dallas County and Collin County line. The southern part is in Dallas County and the northern part is in Collin County, roughly along the President George Bush Turnpike area.

That changes:
- Which appraisal district values your property. Dallas County parcels are at https://www.dallascad.org; Collin County parcels are at https://www.collincad.org. Protest and exemption filings go to the district your parcel is in.
- Which county clerk holds your deeds, and which county courts and county tax rate apply.
- Your school district. Much of Richardson is served by Richardson ISD, but parts of the city, especially in the north, are in Plano ISD. Do not assume the city name tells you the district; check the attendance zone with the district itself.
- Where you vote for county offices, and which county handles your vehicle registration.

What does not change: city services (trash, water, police, code compliance) are run by the City of Richardson on both sides of the line.

## Sourced
Dallas CAD and Collin CAD parcel records; school district boundary maps published by each district.

## What would change this answer
School attendance boundaries are redrawn from time to time. Check them for the specific address in the year you move.`,
  },
  {
    slug: 'richardson-by-train',
    board: 'city/richardson-tx',
    title: 'Richardson without a car: the rail stations and what is near them',
    body: `## Question, scoped
Can you live in Richardson and commute by train?

## As of
October 2026. Confirm schedules at https://www.dart.org.

## The answer
DART's Red Line light rail runs north–south through Richardson, with stations at Spring Valley, Arapaho Center, Galatyn Park and CityLine/Bush, continuing to Plano. Trains reach downtown Dallas directly. The Orange Line shares this track during part of the day; check the timetable for when it runs this far north.

The Silver Line regional rail crosses Richardson east–west on its route between DFW Airport and Plano, including service near the University of Texas at Dallas. Check dart.org for its current stations and frequency.

Practical notes:
- CityLine/Bush and Galatyn Park are next to employment and apartment clusters, and the most practical for a car-light life.
- DART buses and on-demand GoLink zones fill gaps; GoLink is booked in the GoPass app.
- Park-and-ride lots are available at several stations.

## Sourced
DART system map and schedules.

## What would change this answer
Changes to Silver Line service, and new development around stations. Look at the City of Richardson's planning agendas for the station areas.`,
  },

  // ── City: Austin ──────────────────────────────────────────────────────────────────────────────
  {
    slug: 'moving-to-austin-research-before-you-sign',
    board: 'city/austin-tx',
    title: 'Moving to Austin: how to research a neighborhood before you sign',
    body: `## Question, scoped
You are relocating to Austin with a budget and a commute in mind. How do you check a neighbourhood without relying on a 2015 forum thread?

## As of
October 2026.

## The answer
- Property records and value history: Travis Central Appraisal District, https://www.traviscad.org. Suburbs in Williamson County (Round Rock, Cedar Park, Georgetown) use the Williamson Central Appraisal District, and Hays County (Kyle, Buda, San Marcos) uses the Hays CAD.
- Flooding: Austin sits in "Flash Flood Alley". Check https://msc.fema.gov, and the City of Austin's own floodplain maps, which are sometimes more current than FEMA's. Low-water crossings close in storms; ask whether your commute uses one.
- Electricity: Austin Energy is the city-owned utility, so there is no provider to choose. See the electricity thread on the Dallas board for the deregulated suburbs.
- Commute: map the drive at the hours you will actually travel. I-35 and MoPac congestion varies sharply by hour. CapMetro's routes and the MetroRail Red Line are at https://www.capmetro.org.
- Schools: TEA ratings at https://txschools.gov, and confirm attendance zones with the district (Austin ISD, Round Rock ISD, Leander ISD and others all serve parts of the metro).
- Heat: plan for long summer stretches over 100°F. Ask about the age of the air-conditioning system and attic insulation. Seasonal norms are at https://weather.soapbox.community.

## Sourced
TCAD, FEMA, City of Austin, CapMetro, TEA.

## What would change this answer
Rezoning under the city's recent land-development changes, and new transit under Project Connect. Both are on public agendas.`,
  },
  {
    slug: 'austin-without-a-car-capmetro',
    board: 'city/austin-tx',
    title: 'Austin without a car: CapMetro rail, MetroRapid, and what is realistic',
    body: `## Question, scoped
How far can you get in Austin on transit?

## As of
October 2026. Check https://www.capmetro.org for current routes.

## The answer
- MetroRail Red Line: a commuter rail line between Leander and downtown Austin. Frequency is far lower than a big-city metro; plan around the timetable, not "turn up and go".
- MetroRapid: frequent bus routes with limited stops along major corridors, the backbone of car-free trips in the central city.
- Local buses and Pickup (on-demand zones) fill in elsewhere.
- Project Connect, approved by voters in 2020, is the long-term programme for light rail and expanded rapid bus. Its light-rail line is in planning and design, not in service; do not choose housing based on a future station date.

Realistic car-free Austin is central: downtown, East Austin, the UT area, Hyde Park, and along MetroRapid corridors. Further out, most households drive.

Cycling: Austin has expanded protected bike lanes in the core, and bike share is available. Summer heat is the real constraint.

## Sourced
CapMetro service maps; City of Austin and Austin Transit Partnership project pages.

## What would change this answer
Project Connect construction milestones, and any CapMetro network redesign. Both are announced in advance at public board meetings.`,
  },
  {
    slug: 'texas-property-tax-and-homestead-exemption',
    board: 'city/austin-tx',
    title: 'Texas property tax for newcomers: the homestead exemption and how to protest',
    body: `## Question, scoped
You bought a home in Texas. How does property tax work, and what should you file?

## As of
October 2026. Amounts are set by the Legislature and change; check your appraisal district for the current figures.

## The answer
Texas has no state personal income tax. Local services and schools are funded largely through property taxes, levied by the school district, the city, the county and special districts, each with its own rate. Your appraisal district sets the value; the taxing units set the rates.

## File the homestead exemption
- It applies to your principal residence. The application is Comptroller form 50-114, filed with your county appraisal district (Travis CAD for most of Austin). Filing is free.
- The school-district homestead exemption is substantial and has been raised by the Legislature more than once in recent sessions. It also caps how fast the taxable value of a homestead can rise (10% a year).
- Over-65 and disabled homeowners qualify for extra exemptions and a school-tax ceiling.

Ignore mailers offering to file your homestead exemption for a fee. The form is free from your appraisal district.

## Protest your value
Your notice of appraised value arrives in spring. The protest deadline is May 15, or 30 days after the notice was mailed, whichever is later. Bring comparable sales and photos of condition problems. Most districts allow online protests and an informal review before a hearing.

## Sourced
Texas Comptroller property tax pages (https://comptroller.texas.gov/taxes/property-tax/) and your appraisal district.

## What would change this answer
New legislation on exemptions or rate limits, and voter-approved constitutional amendments.`,
    replies: [`One check worth doing every year: look up your own parcel and confirm the homestead exemption is still listed. Exemptions sometimes drop off after a refinance, a deed change, or a name change, and the first sign is a larger tax bill.`],
  },

  // ── Travel: general + tips ────────────────────────────────────────────────────────────────────
  {
    slug: 'real-id-what-you-need-to-fly',
    board: 'travel/tips',
    title: 'REAL ID: what ID you need to fly within the US now',
    body: `## As of
October 2026. Source: TSA, https://www.tsa.gov/real-id

## The rule
REAL ID enforcement began on May 7, 2025. Adults (18 and over) need a REAL ID-compliant driver's licence or state ID, or another acceptable document, to pass a TSA checkpoint for a domestic flight.

## How to tell if your licence is compliant
Most compliant cards carry a star in a circle or similar mark in the top corner. If yours does not, it is probably not compliant, even if it is valid for driving.

## If you do not have one
You can still fly with another acceptable ID, including:
- A valid US passport or passport card.
- A DHS trusted traveller card (Global Entry, NEXUS, SENTRI, FAST).
- A US military ID.
- A permanent resident card.
TSA keeps the full list on its site.

## Getting a REAL ID
Apply at your state's driver licensing office. You will typically need proof of identity (a birth certificate or passport), proof of your Social Security number, and two proofs of address. Bring originals. In Texas, licences issued in recent years are generally already compliant; check for the star.

## Season and year
This applies all year. Allow extra time at the licensing office before holiday travel periods.`,
  },
  {
    slug: 'renew-us-passport-online',
    board: 'travel/tips',
    title: 'Renewing a US passport online: who qualifies and how long it takes',
    body: `## As of
October 2026. Source: US Department of State, https://travel.state.gov

## Who can renew online
The State Department's online renewal is for adults whose most recent passport:
- was issued when they were 16 or older,
- was issued within the last 15 years,
- is undamaged and in their possession,
and who are not changing their name or other personal details beyond what the system allows, and are not travelling internationally within the next several weeks. Check the eligibility list on travel.state.gov before starting; it is precise.

## How it works
1. Create an account on the State Department's online renewal page.
2. Upload a digital photo that meets the passport photo rules (plain white or off-white background, no glasses, recent).
3. Pay the fee online. Fees are listed on travel.state.gov.
4. Your old passport is cancelled when you submit. You cannot use it while the new one is processed.

## When not to use it
If you need the passport soon, do not apply online; use expedited service by mail or an appointment at a passport agency for urgent travel. Processing times are posted and change with the season; spring and early summer are the busiest.

## A warning
Search results show third-party sites that charge extra to "help" with passport forms. The only official site is travel.state.gov. See https://scam-alert.soapbox.community for this and similar government-form scams.`,
  },
  {
    slug: 'global-entry-vs-tsa-precheck',
    board: 'travel/general',
    title: 'Global Entry or TSA PreCheck? A decision you can make in two minutes',
    body: `## As of
October 2026. Sources: https://www.tsa.gov/precheck and https://www.cbp.gov/travel/trusted-traveler-programs/global-entry

## What each one does
- TSA PreCheck: a faster security line on departing US flights at participating airports. You usually keep your shoes, belt and light jacket on and leave laptops and permitted liquids in the bag. Membership lasts five years.
- Global Entry: run by US Customs and Border Protection, it speeds re-entry into the US from abroad, using kiosks or facial recognition. It includes TSA PreCheck. Membership also lasts five years.

## How to choose
- If you fly internationally even once every year or two, get Global Entry. It costs a little more than PreCheck and includes it.
- If you never leave the country, PreCheck is enough and easier to get.
- Global Entry requires an interview, which can be done at an enrolment centre or, through Enrollment on Arrival, when you return from an international trip at participating airports. PreCheck requires a short in-person appointment for fingerprints.

## Things to know
- Fees are listed on the official sites. Several credit cards reimburse the fee; check your card's benefits rather than signing up for a new card for it.
- Your Known Traveler Number (KTN) must be in each airline booking, or PreCheck will not appear on your boarding pass.
- Children's rules differ between the two programmes; check each site.

Apply only through the official government sites. Look-alike sites charge extra for the same form.`,
  },
  {
    slug: 'airline-refunds-24-hour-rule-and-dot-refund-rule',
    board: 'travel/general',
    title: 'Your money back from US airlines: the 24-hour rule and the 2024 refund rule',
    body: `## As of
October 2026. Source: US Department of Transportation, https://www.transportation.gov/airconsumer

## The 24-hour rule
For flights to, from or within the US, airlines must either hold a reservation at the quoted fare for 24 hours without payment, or let you cancel within 24 hours of booking without penalty, as long as you booked at least seven days before departure. Most US airlines choose the free-cancellation option. Book, then use the 24 hours to double-check dates and names.

## The automatic refund rule
DOT's refund rule, which took effect in October 2024, requires airlines to refund you automatically, in cash or the original form of payment, when:
- the airline cancels your flight or makes a significant change (including a departure or arrival change of three hours or more domestically, six hours or more internationally, a change of airport, or added connections), and you do not accept the alternative or travel credit;
- your checked bag is significantly delayed (12 hours for domestic flights), in which case you get the bag fee back;
- you paid for a service such as Wi-Fi or seat selection that you did not receive.

Refunds must be issued within seven business days for credit-card purchases and 20 calendar days for other payment methods.

## What it does not cover
Delays shorter than the thresholds, and cancellations you choose for a non-refundable fare (though many airlines now give credits).

## How to claim
If no refund arrives, file a complaint with DOT through the same site. Write down flight numbers and the times you were notified.`,
  },
  {
    slug: 'travelling-with-prescription-medication',
    board: 'travel/tips',
    title: 'Travelling with prescription medication: TSA rules and the countries that ban common drugs',
    body: `## As of
October 2026. Sources: https://www.tsa.gov and https://travel.state.gov

## Domestic (TSA)
- Medication is allowed in carry-on and checked bags. Keep it in your carry-on so it is not lost.
- Medically necessary liquids, gels and aerosols are allowed above the 3.4 oz (100 ml) limit. Tell the officer at the start of screening.
- TSA does not require pills to be in their original bottles, but state laws on prescription labelling vary. Original labelled containers avoid questions.

## International
This is where people get into real trouble. Rules are set by the destination country, and some ban medicines that are routine in the US.
- Japan prohibits stimulant medications containing amphetamine, including Adderall, even with a prescription, and restricts products with pseudoephedrine. Bringing more than a month's supply of other prescription medication requires an import certificate. Check the Ministry of Health, Labour and Welfare guidance before you go.
- The United Arab Emirates and several other countries restrict many controlled medicines and require advance approval.
- CBD and other cannabis products are illegal in many countries, including some where travellers do not expect it, and THC limits can be zero.

What to do:
1. Look up each destination on travel.state.gov, then the destination embassy's site for medicine rules.
2. Carry a copy of the prescription and a doctor's letter with the generic drug name.
3. Bring enough for the trip plus a few days, in original packaging.

For how drugs interact with each other and with food, the Library has reference pages; start at https://wiki.soapbox.community/wiki/Cytochrome_P450_System_Inhibition_and_Induction.`,
  },

  // ── Travel destination Q&A ────────────────────────────────────────────────────────────────────
  {
    slug: 'paris-when-to-visit-to-avoid-crowds',
    board: 'travel/paris',
    title: 'When is Paris least crowded, and which museums need booking ahead?',
    body: `## Question, scoped
First trip to Paris, about four days, flexible dates. When are crowds lightest, and what has to be booked?

## As of
October 2026. Prices and opening rules change; check each museum's official site.

## The answer
- Lightest crowds: November through February on weekdays, excluding the Christmas and New Year holidays and school-holiday weeks. Late September and October are a good compromise between weather and crowds. July and August are the busiest and the warmest.
- The Louvre requires a timed-entry reservation, booked on the official Louvre site, and is closed on Tuesdays. Go at opening time or on a late-opening evening.
- The Musée d'Orsay is closed on Mondays and also uses timed tickets.
- The Eiffel Tower summit sells out in high season; book on the official site.
- Sainte-Chapelle and the Catacombs both have limited capacity; book timed entry.

Getting around: the Métro and RER are the fastest way to move between districts. Fares and ticketing were reformed recently and paper tickets are being phased out in favour of the Navigo Easy card and mobile tickets; check the RATP site for the current options.

Avoid: ticket touts outside major sites, and petition-signing and "found ring" approaches near landmarks. They are well-documented scams.

## Sourced
Official sites of the Louvre, Musée d'Orsay, Eiffel Tower, and RATP.

## What would change this answer
Major events (the city's calendar of trade fairs and holidays), museum renovation closures, and strikes, which are announced in advance in the French press.

More planning tools: https://travel.soapbox.community and https://wiki.soapbox.community/wiki/SoapBox_Travel`,
  },
  {
    slug: 'cairo-visa-and-the-grand-egyptian-museum',
    board: 'travel/cairo',
    title: 'Visiting Cairo: how do you get a visa, and how should you plan the Grand Egyptian Museum?',
    body: `## Question, scoped
A first visit to Cairo and Giza. What visa do you need, and how do the museums fit together?

## As of
October 2026. Visa rules depend on nationality; check your own government's travel advice.

## The answer
## Visa
Many nationalities, including US citizens, can buy a tourist visa on arrival at Cairo airport or apply in advance for an e-visa. Use only the official Egyptian e-visa portal, https://visa2egypt.gov.eg. Many look-alike sites charge extra. The US State Department's Egypt page (https://travel.state.gov) gives the current rules for US passport holders.

## The museums
- The Grand Egyptian Museum (GEM), beside the Giza plateau, is now the main home of the Tutankhamun collection and of many of the largest statues. Allow most of a day. Book tickets on the official site.
- The Egyptian Museum in Tahrir Square remains open and still holds major collections, including much of the Old and Middle Kingdom statuary. It is worth a half day.
- The National Museum of Egyptian Civilization (NMEC) in Fustat holds the royal mummies.

## The Giza plateau
Arrive at opening to avoid heat and crowds. Entry to the plateau and entry inside the Great Pyramid are separate tickets. Agree the price of any camel or horse ride, and what it includes, before you get on.

## Sourced
Official Egyptian e-visa portal; museum ticketing sites; US State Department.

## What would change this answer
Ticket prices, opening hours and gallery openings at GEM have changed several times; check the official site within a week of your visit.

Background on the ancient sites is in the Library, for example https://wiki.soapbox.community/wiki/Egyptian_Magic`,
  },
  {
    slug: 'luxor-west-bank-tombs-tickets',
    board: 'travel/luxor',
    title: 'Luxor: which tombs need separate tickets, and when should you go?',
    body: `## Question, scoped
Two or three days in Luxor. How do the West Bank tickets work, and how do you beat the heat?

## As of
October 2026. Ticket prices and which tombs are open rotate; check at the ticket office or the Ministry of Tourism and Antiquities.

## The answer
## Valley of the Kings
A standard ticket admits you to a set number of open tombs (usually three) from those open that day. Some tombs need their own separate ticket, most famously Tutankhamun (KV62) and Seti I (KV17). Tomb openings rotate for conservation, so the list changes.

## Elsewhere on the West Bank
- The tomb of Nefertari (QV66) in the Valley of the Queens has a separate, expensive ticket and a short timed visit, because of conservation.
- The temple of Hatshepsut at Deir el-Bahari, Medinet Habu and the Ramesseum each have their own tickets.
- The Tombs of the Nobles have some of the liveliest daily-life paintings and far fewer visitors.

## East Bank
Karnak is best early in the morning. Luxor Temple is lit at night and is excellent after dark.

## Heat and timing
From May to September, midday is dangerous. Start at opening (early morning) and be off the West Bank by late morning. October to March is the comfortable season.

## Balloon flights
Dawn balloon flights over the West Bank are popular. In February 2013 a balloon fire killed 19 people, and regulation was tightened afterwards. Use an established operator and ask about licensing.

## Sourced
Egyptian Ministry of Tourism and Antiquities; on-site ticket offices.

## What would change this answer
Tomb rotations and price changes, which happen without much notice.`,
  },
  {
    slug: 'tokyo-ic-cards-and-is-the-jr-pass-worth-it',
    board: 'travel/tokyo',
    title: 'Tokyo: which transit card should you use, and is the JR Pass still worth it?',
    body: `## Question, scoped
A week in Tokyo, maybe a day trip or a trip to Kyoto. How do you pay for trains?

## As of
October 2026.

## The answer
## IC cards
Suica and PASMO are rechargeable IC cards that work on almost all trains, subways and buses in Tokyo and on many other networks across Japan, and in convenience stores. For visitors there is the Welcome Suica (sold at airports and some stations), and on iPhone and some Android phones you can add Suica to your phone's wallet. Physical card sales were restricted for a period in 2023 because of a chip shortage; check what is available when you arrive.

## The Japan Rail Pass
The nationwide JR Pass price went up sharply in October 2023. Since then it often costs more than individual tickets for a simple Tokyo–Kyoto–Tokyo trip. Price your actual route with individual shinkansen fares before buying. The pass still pays off for long, multi-city itineraries. Regional JR passes can be better value for a single region.

## Practical notes
- Tokyo's subway is run by two operators, Tokyo Metro and Toei. Transfers between them are charged as separate trips; IC cards handle this automatically.
- Trains stop running around midnight. Plan the last train or budget for a taxi.
- Medication: Japan bans some common US medicines, including amphetamine-based stimulants. Read the medication thread on Travel Tips before you pack.

## Sourced
JR group and Tokyo Metro official sites; Japan Rail Pass official site.

## What would change this answer
JR Pass pricing, and IC card availability. Both have changed within the last few years.`,
  },
  {
    slug: 'mexico-city-altitude-season-and-safety',
    board: 'travel/mexico-city',
    title: 'Mexico City: what should you know about altitude, season and getting around?',
    body: `## Question, scoped
First visit to Mexico City, five days. What should you plan for?

## As of
October 2026.

## The answer
- Altitude: the city is at about 2,240 metres (7,350 feet). Many visitors feel breathless or get headaches for the first day or two. Drink water, go easy on alcohol, and do not plan the hardest day first.
- Season: the dry season runs roughly November to April. June to September is the rainy season, with heavy afternoon storms; plan museums for the afternoon. Día de Muertos (November 1 and 2) is a major event, and the large parade in the centre has been held since 2016.
- Water: drink bottled or filtered water. Restaurants generally use purified water and ice.
- Earthquakes: the city has a public seismic early-warning system (SASMEX), with loudspeaker alerts that can sound before shaking arrives. If you hear the alert, follow local people to the designated safe area.
- Getting around: the Metro is cheap and extensive but very crowded at rush hour; some trains have women-and-children-only carriages. Ride-hail apps are widely used and are a common way to get around at night.
- Entry: US citizens need a valid passport. Mexico has moved its tourist entry record (FMM) to a digital process at major airports; keep the record of your permitted stay.

## Sourced
US State Department Mexico page (https://travel.state.gov) and Mexico City government information.

## What would change this answer
Travel advisories, which the State Department sets state by state; read the one for Mexico City and for any side trips.

Weather planning: https://weather.soapbox.community`,
  },
];
