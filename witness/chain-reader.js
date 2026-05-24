/**
 * chain-reader.js — fetch the user-activity shape the tutorial detector
 * expects, from a single Graphene account_history call.
 *
 * The detector (tutorial/detector.js) is pure and takes a structured
 * object. This module is the impure half that talks to the chain.
 *
 *   const activity = await readUserActivity(adapter, 'somebody');
 *   const completions = detectCompletedStages(activity);
 *
 * One call returns up to `limit` recent operations; clients call
 * repeatedly with older `from` indices to walk history if needed. For
 * tutorial detection on new users, the recent window is enough — a
 * tutorial-eligible user has done few enough things that 1000 ops
 * covers everything.
 */

import { Hathor } from './hathor.js';

const DEFAULT_LIMIT = 1000;

/**
 * Read recent account history for `account` and shape it into the
 * structure tutorial/detector.js expects.
 *
 * @param {Hathor|object} hathorOrAdapter a Hathor instance or its underlying adapter
 * @param {string} account the account whose activity to read
 * @param {{ limit?: number }} opts
 */
export async function readUserActivity(hathorOrAdapter, account, { limit = DEFAULT_LIMIT } = {}) {
  const adapter = hathorOrAdapter instanceof Hathor ? hathorOrAdapter.connect() : hathorOrAdapter;
  const client = adapter.client;

  const [history, [accountRecord]] = await Promise.all([
    client.call('condenser_api', 'get_account_history', [account, -1, limit]),
    client.database.getAccounts([account]),
  ]);

  const posts = [];
  const comments = [];
  const votes_received_partial = []; // populated from votes the user cast — votes RECEIVED need a different read
  const transfers_to_vesting = [];

  for (const [, entry] of history ?? []) {
    const [opName, opVal] = entry.op;
    const timestamp = entry.timestamp;
    switch (opName) {
      case 'comment': {
        const item = {
          author: opVal.author,
          permlink: opVal.permlink,
          parent_author: opVal.parent_author,
          parent_permlink: opVal.parent_permlink,
          title: opVal.title,
          body: opVal.body,
          json_metadata: opVal.json_metadata,
          created: timestamp,
        };
        if (opVal.parent_author) comments.push(item);
        else posts.push(item);
        break;
      }
      case 'transfer_to_vesting': {
        if (opVal.from === account || opVal.to === account) {
          transfers_to_vesting.push({
            from: opVal.from,
            to: opVal.to,
            amount: opVal.amount,
            timestamp,
          });
        }
        break;
      }
      // Other ops carried in history are ignored here; the detector
      // doesn't use them.
    }
  }

  const witness_votes = (accountRecord?.witness_votes ?? []).map((w) => ({
    witness: w,
    approve: true,
  }));

  // votes_received: pull active votes on each of the user's posts.
  // For tutorials we only need to know "did anyone other than hathor
  // vote on anything of yours?" — so a sampled probe across the user's
  // recent posts is enough.
  const votes_received = await collectVotesReceived(client, posts);

  return {
    posts,
    comments,
    votes_received,
    transfers_to_vesting,
    witness_votes,
  };
}

async function collectVotesReceived(client, posts) {
  if (!posts.length) return [];
  const sample = posts.slice(0, 10); // recent 10 posts is plenty for tutorial purposes
  const lists = await Promise.all(
    sample.map((p) =>
      client.database
        .call('get_active_votes', [p.author, p.permlink])
        .catch(() => []),
    ),
  );
  return lists.flat();
}
