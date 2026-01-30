/**
 * Ready event - Fired when bot is connected and ready
 */

import { ActivityType } from 'discord.js';

export const name = 'ready';
export const once = true;

export async function execute(client, { knowledgeLoader, wikiClient }) {
  console.log(`[Ready] Logged in as ${client.user.tag}`);

  // Set bot presence
  client.user.setPresence({
    activities: [{
      name: 'the Library of Ashurbanipal',
      type: ActivityType.Watching
    }],
    status: 'online'
  });

  // Load knowledge base
  console.log('[Ready] Loading knowledge base...');
  await knowledgeLoader.loadAll();
  console.log(`[Ready] Knowledge base loaded: ${knowledgeLoader.documents.size} documents`);

  // Test wiki connection
  try {
    const stats = await wikiClient.getStatistics();
    console.log(`[Ready] Wiki connected: ${stats.sitename} (${stats.articles} articles)`);
  } catch (error) {
    console.warn('[Ready] Wiki connection failed:', error.message);
  }

  // Try to login to wiki for editing
  if (process.env.WIKI_BOT_USERNAME && process.env.WIKI_BOT_PASSWORD) {
    const loggedIn = await wikiClient.login();
    if (loggedIn) {
      console.log('[Ready] Wiki bot logged in - editing enabled');
    }
  }

  console.log('[Ready] Library of Ashurbanipal is ready!');
}
