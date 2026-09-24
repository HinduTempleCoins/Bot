// bigquery.mjs — BigQuery public-data lane (operator: "use it to add to libraries + feed the prompt/
// upload part"). Two uses only: (1) LIBRARY ENRICHMENT — query public datasets for metadata/labels at
// scale; (2) PROMPT/UPLOAD SUGGESTIONS — trending subjects + label vocabulary for the end-user prompt box.
//
// STAGED, one credential from live (like fal-compute): needs a GCP project (the FREE sandbox needs NO
// billing). Config from env, never the repo: GCP_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS (service-
// account JSON path) OR GCP_SA_JSON. configured()=false and every call soft-fails { ok:false } until set.
// The @google-cloud/bigquery client is imported DYNAMICALLY so it's not a hard dependency.
//
//   import { configured, query, trendingSubjects, labelVocabulary } from './bigquery.mjs'

const env = (k) => (process.env[k] && process.env[k] !== '' ? process.env[k] : null);
export function configured() { return !!(env('GCP_PROJECT_ID') && (env('GOOGLE_APPLICATION_CREDENTIALS') || env('GCP_SA_JSON'))); }

let _client = null;
async function client() {
  if (_client) return _client;
  if (!configured()) return null;
  try {
    const { BigQuery } = await import('@google-cloud/bigquery');
    const opts = { projectId: env('GCP_PROJECT_ID') };
    if (env('GCP_SA_JSON')) opts.credentials = JSON.parse(env('GCP_SA_JSON'));
    _client = new BigQuery(opts);
    return _client;
  } catch { return null; }
}

// Run a bounded SQL query (always LIMIT + maxBytesBilled to stay in the free tier). Soft-fails.
export async function query(sql, { maxRows = 100, maxGiB = 1 } = {}) {
  const bq = await client();
  if (!bq) return { ok: false, reason: 'not-configured' };
  try {
    const [rows] = await bq.query({ query: sql, maximumBytesBilled: String(Math.floor(maxGiB * 1024 ** 3)), maxResults: maxRows });
    return { ok: true, rows };
  } catch (e) { return { ok: false, error: String(e && e.message).slice(0, 200) }; }
}

// PROMPT SUGGESTIONS — top rising Google Trends terms (steer what users make / autocomplete).
export async function trendingSubjects(limit = 25) {
  return query(
    `SELECT term, MAX(rank) AS rank FROM \`bigquery-public-data.google_trends.top_rising_terms\`
     WHERE refresh_date = (SELECT MAX(refresh_date) FROM \`bigquery-public-data.google_trends.top_rising_terms\`)
     GROUP BY term ORDER BY rank ASC LIMIT ${+limit}`, { maxRows: +limit });
}

// LIBRARY ENRICHMENT / prompt vocabulary — Open Images label taxonomy (valid, real-world subject terms).
export async function labelVocabulary(like = '', limit = 50) {
  const w = like ? `WHERE LOWER(label_display_name) LIKE '%${String(like).toLowerCase().replace(/[^a-z0-9 ]/g, '')}%'` : '';
  return query(
    `SELECT DISTINCT label_display_name FROM \`bigquery-public-data.open_images.dict\` ${w} LIMIT ${+limit}`, { maxRows: +limit });
}
