/**
 * Library of Ashurbanipal - Wiki Knowledge Bot
 *
 * Named for the ancient Nineveh library where fire baked and preserved
 * the clay tablets, this bot preserves and synthesizes knowledge from
 * the Van Kush Family Research Institute.
 *
 * Knowledge Flow:
 * OILAHUASCA/SPACE PASTE → HEADCONES/PHOENICIAN → ALL OTHER TOPICS
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Import utilities
import KnowledgeLoader from './utils/knowledgeLoader.js';
import GeminiClient from './utils/geminiClient.js';
import WikiClient from './utils/wikiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate environment
const requiredEnv = ['DISCORD_TOKEN', 'GEMINI_API_KEY'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction
  ]
});

// Initialize services
const knowledgeBasePath = process.env.KNOWLEDGE_BASE_PATH ||
  join(__dirname, '..', '..', 'knowledge');

const knowledgeLoader = new KnowledgeLoader(knowledgeBasePath);
const geminiClient = new GeminiClient(process.env.GEMINI_API_KEY);
const wikiClient = new WikiClient(
  process.env.WIKI_URL || 'http://5.252.53.79/wiki',
  process.env.WIKI_BOT_USERNAME,
  process.env.WIKI_BOT_PASSWORD
);

// Create context object to pass to handlers
const context = {
  knowledgeLoader,
  geminiClient,
  wikiClient,
  commands: new Collection()
};

// Load commands
console.log('[Startup] Loading commands...');
const commandsPath = join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(join(commandsPath, file));
  if (command.data && command.execute) {
    context.commands.set(command.data.name, command);
    console.log(`[Startup] Loaded command: /${command.data.name}`);
  }
}

// Load events
console.log('[Startup] Loading events...');
const eventsPath = join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(f => f.endsWith('.js'));

for (const file of eventFiles) {
  const event = await import(join(eventsPath, file));
  if (event.name && event.execute) {
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args, context));
    } else {
      client.on(event.name, (...args) => event.execute(...args, context));
    }
    console.log(`[Startup] Loaded event: ${event.name}`);
  }
}

// Error handling
client.on('error', error => {
  console.error('[Discord] Client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('[Process] Unhandled rejection:', error);
});

process.on('SIGINT', () => {
  console.log('[Shutdown] Received SIGINT, shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Shutdown] Received SIGTERM, shutting down...');
  client.destroy();
  process.exit(0);
});

// Login
console.log('[Startup] Connecting to Discord...');
client.login(process.env.DISCORD_TOKEN);
