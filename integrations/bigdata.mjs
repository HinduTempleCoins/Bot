// bigdata.mjs — keyless big-data query lane. Primary tool: DuckDB (free, open-source, NO account, CPU) —
// queries remote Parquet/CSV/JSON over HTTPS with SQL (Hugging Face datasets, Open Images, Common Crawl
// indexes, any open URL). The no-Google alternative to BigQuery. Soft-fails if DuckDB is absent.
//
// Other KEYLESS big-data / query tools (no account) we can also hit directly via fetch, cataloged for use:
export const KEYLESS_TOOLS = [
  { id: 'duckdb', what: 'SQL over remote Parquet/CSV/JSON', access: 'this module (CPU, free, no account)' },
  { id: 'wikidata-sparql', what: 'structured world knowledge', access: 'GET https://query.wikidata.org/sparql?query=…&format=json (keyless)' },
  { id: 'openverse', what: '700M+ CC/CC0 media search', access: 'https://api.openverse.org/v1 (keyless anon tier)' },
  { id: 'clickhouse-play', what: 'huge public datasets, SQL', access: 'https://play.clickhouse.com (public, no account)' },
  { id: 'commoncrawl-cdx', what: 'web index lookups', access: 'http://index.commoncrawl.org (keyless CDX)' },
  { id: 'hf-datasets', what: '100k+ datasets as parquet', access: 'hf://… parquet URLs → query with DuckDB (token optional)' },
  { id: 'socrata', what: 'gov open data (data.gov etc.)', access: 'SODA API, keyless read tier' },
];
// Google's FREE things that need NO GCP account (use these instead of BigQuery where possible):
export const GOOGLE_FREE_NO_GCP = [
  { id: 'open-images-csv', what: 'label taxonomy + image metadata', access: 'CSVs on storage.googleapis.com → query with DuckDB' },
  { id: 'google-books', what: 'book metadata/search', access: 'https://www.googleapis.com/books/v1 (keyless read)' },
  { id: 'google-trends', what: 'trending subjects', access: 'pytrends (unofficial, keyless)' },
];

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const run = promisify(execFile);
const PY = process.env.BIGDATA_PY || 'python3';
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'bigdata', 'query.py');

// Run a bounded SQL query over remote/open data. Soft-fails { ok:false }.
export async function query(sql) {
  try { const { stdout } = await run(PY, [SCRIPT, sql], { timeout: 90000, maxBuffer: 1 << 27 }); return JSON.parse(stdout.trim().split('\n').pop()); }
  catch (e) { return { ok: false, error: String(e && e.message).slice(0, 160) }; }
}
