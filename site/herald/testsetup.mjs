// Test-only side effect: point the Herald lead store at a throwaway temp file BEFORE server.mjs is
// evaluated, so the disk-backed lead CRM singleton never writes into the repo's data/ during `node --test`.
// Imported FIRST by server.test.mjs (ESM evaluates imports depth-first in source order).
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.HERALD_LEADS_DATA = join(tmpdir(), `herald-leads-test-${process.pid}-${Date.now()}.json`);
