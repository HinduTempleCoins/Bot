/**
 * Deploy slash commands to Discord
 *
 * Run this script once to register commands:
 * node src/deploy-commands.js
 */

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate environment
if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_APPLICATION_ID) {
  console.error('Missing DISCORD_TOKEN or DISCORD_APPLICATION_ID in environment');
  process.exit(1);
}

const commands = [];

// Load command definitions
const commandsPath = join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'));

for (const file of commandFiles) {
  const command = await import(join(commandsPath, file));
  if (command.data) {
    commands.push(command.data.toJSON());
    console.log(`Loaded: /${command.data.name}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`\nDeploying ${commands.length} commands...`);

    // Deploy globally (takes up to an hour to propagate)
    // For faster testing, use guild-specific deployment below

    if (process.env.DISCORD_GUILD_ID) {
      // Guild-specific deployment (instant)
      const data = await rest.put(
        Routes.applicationGuildCommands(
          process.env.DISCORD_APPLICATION_ID,
          process.env.DISCORD_GUILD_ID
        ),
        { body: commands }
      );
      console.log(`\n✅ Deployed ${data.length} commands to guild ${process.env.DISCORD_GUILD_ID}`);
    } else {
      // Global deployment
      const data = await rest.put(
        Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID),
        { body: commands }
      );
      console.log(`\n✅ Deployed ${data.length} commands globally`);
      console.log('Note: Global commands may take up to an hour to appear.');
    }

  } catch (error) {
    console.error('Deployment error:', error);
    process.exit(1);
  }
})();
