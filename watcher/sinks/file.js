/**
 * watcher/sinks/file.js — append-only JSONL sink.
 *
 * Always enabled. Writes one JSON object per line to the configured path.
 * Useful as the floor: even when Telegram is misconfigured or email DNS
 * fails, alerts still land somewhere `tail -f`-able.
 *
 * The file is opened+appended+closed per write — slower than a long-lived
 * fd, but trivial to reason about and never holds the file open across
 * process restarts.
 *
 * Schema per line:
 *   { ts, severity, kind, account, block, trxId, historyIndex,
 *     subject, body, opData }
 *
 * `opData` is the raw on-chain op data and contains no key material;
 * everything here is already public on the chain by the time it's logged.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const name = 'file';

export function enabled(config) {
  return Boolean(config?.sinks?.file?.path);
}

export async function send(event, alert, config) {
  const path = config.sinks.file.path;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    severity: event.severity,
    kind: event.kind,
    account: event.account,
    block: event.block,
    trxId: event.trxId,
    historyIndex: event.historyIndex,
    subject: alert.subject,
    body: alert.body,
    opData: event.opData,
  });
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line + '\n', 'utf8');
    return { ok: true, info: { path } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
