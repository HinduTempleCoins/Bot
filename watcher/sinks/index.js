/**
 * watcher/sinks/index.js — sink registry + dispatcher.
 *
 * Each sink is a module exporting:
 *   name:    string
 *   enabled: (config) => boolean
 *   send:    (event, alert, config, { fetchImpl? }) => Promise<{ ok, info?, error? }>
 *
 * The dispatcher fans each event out to all enabled sinks in parallel,
 * collects per-sink results, and returns a summary. No sink throws — a
 * sink failure does not break sibling sinks.
 *
 * The file sink is the only always-on sink. If no network sink is
 * configured, alerts still land in the JSONL log.
 */

import * as fileSink from './file.js';
import * as telegramSink from './telegram.js';
import * as emailSink from './email.js';

export const ALL_SINKS = [fileSink, telegramSink, emailSink];

export function enabledSinks(config, pool = ALL_SINKS) {
  return pool.filter((s) => s.enabled(config));
}

/**
 * Send one alert to every enabled sink. Returns array of per-sink results.
 *
 * @param {object} event              the detected event
 * @param {{subject:string, body:string}} alert  the rendered alert
 * @param {object} config             watcher config
 * @param {object} [opts]
 * @param {Array} [opts.pool]         override sink pool (for tests)
 * @param {Function} [opts.fetchImpl] override fetch (for tests)
 */
export async function dispatch(event, alert, config, { pool, fetchImpl } = {}) {
  const sinks = enabledSinks(config, pool || ALL_SINKS);
  const results = await Promise.all(
    sinks.map(async (s) => {
      try {
        const r = await s.send(event, alert, config, { fetchImpl });
        return { sink: s.name, ...r };
      } catch (err) {
        // Defensive — sink contract says "never throw" but enforce it here.
        return { sink: s.name, ok: false, error: err.message };
      }
    }),
  );
  return results;
}
