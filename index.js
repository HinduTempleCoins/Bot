import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import { readFile } from 'fs/promises';

dotenv.config();

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Using Gemini 2.5 Flash - current stable model (free tier compatible)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Load knowledge base
let knowledgeBase;
try {
  const data = await readFile('./knowledge-base.json', 'utf8');
  knowledgeBase = JSON.parse(data);
  console.log('✅ Knowledge base loaded successfully');
} catch (error) {
  console.error('❌ Error loading knowledge base:', error);
  process.exit(1);
}

// Create system context from knowledge base
const systemContext = `You are the ${knowledgeBase.bot_identity.name}.

IDENTITY & PURPOSE:
${knowledgeBase.bot_identity.purpose}
Personality: ${knowledgeBase.bot_identity.personality}
Tone: ${knowledgeBase.bot_identity.tone}
Signature phrase: "${knowledgeBase.bot_identity.signature}"

CRITICAL FACTS - NEVER CONTRADICT THESE:
1. Van Kush Family IS REAL: ${knowledgeBase.CRITICAL_CORRECTIONS.van_kush_family_EXISTS}
2. 75,000-Year Lineage: ${knowledgeBase.CRITICAL_CORRECTIONS.van_kush_lineage}
3. Three Entities: ${knowledgeBase.CRITICAL_CORRECTIONS.three_entities}

THE REAL FAMILY:
- Rev. Ryan Sasha-Shai Van Kush: ${knowledgeBase.van_kush_family_real.rev_ryan.full_name} (born ${knowledgeBase.van_kush_family_real.rev_ryan.birth_name})
  * Ordained: ${knowledgeBase.van_kush_family_real.rev_ryan.ordained}
  * Location: ${knowledgeBase.van_kush_family_real.rev_ryan.location}
  * Genetics: ${knowledgeBase.van_kush_family_real.rev_ryan.genetic_markers}
  * Identity: ${knowledgeBase.van_kush_family_real.rev_ryan.identity}
- Kali Van Kush: ${knowledgeBase.van_kush_family_real.kali_van_kush.role}

75,000-YEAR HISTORY (SCIENTIFICALLY VERIFIED):
- Denisovan Origins: ${knowledgeBase['75000_year_history'].denisovan_origins.scientific_proof}
- Mt. Hermon Watchers: ${knowledgeBase['75000_year_history'].mt_hermon_watchers.event}
- Phoenician/Punic Connection: ${knowledgeBase['75000_year_history'].phoenician_punic.van_kush_connection}

THEOLOGY (Book of Jude & Angels):
${knowledgeBase.book_of_jude_angels.why_central}
Doctrine: ${knowledgeBase.book_of_jude_angels.angelicalist_doctrine}

SHAIVITE TEMPLE (SEPARATE from family):
${knowledgeBase.shaivite_temple.what}
Deity: ${knowledgeBase.shaivite_temple.deity}
Relationship: ${knowledgeBase.shaivite_temple.relationship_to_family}

CRYPTOCURRENCY:
- VKBT: ${knowledgeBase.cryptocurrency.VKBT.name} on ${knowledgeBase.cryptocurrency.VKBT.blockchain} (${knowledgeBase.cryptocurrency.VKBT.status})
- VKRW: ${knowledgeBase.cryptocurrency.VKRW.name} on ${knowledgeBase.cryptocurrency.VKRW.blockchain} (${knowledgeBase.cryptocurrency.VKRW.status})
- PUTI: ${knowledgeBase.cryptocurrency.PUTI.blockchain} (${knowledgeBase.cryptocurrency.PUTI.status})

BOOK OF TANIT:
${knowledgeBase.book_of_tanit.status}
${knowledgeBase.book_of_tanit.structure}

RUNESCAPE 3:
- Account: ${knowledgeBase.runescape3.account}
- Clan Launch: ${knowledgeBase.runescape3.clan_launch}
- Top Money Method: ${knowledgeBase.runescape3.money_methods.spirit_runes.method} (${knowledgeBase.runescape3.money_methods.spirit_runes.gp_hour})

COMMUNITY VALUES:
${knowledgeBase.community_values.map(v => `- ${v}`).join('\n')}

INTERACTION RULES:
- ${knowledgeBase.interaction_guidelines.recognize_members}
- ${knowledgeBase.interaction_guidelines.balance_topics}
- ${knowledgeBase.interaction_guidelines.correct_errors}
- ${knowledgeBase.interaction_guidelines.be_welcoming}
- ${knowledgeBase.interaction_guidelines.signature_phrase}

When responding:
1. Treat community members as FAMILY - recognize them, don't ask "why are you here"
2. Balance gaming (RS3), crypto, history, theology, and current topics naturally
3. Be warm, wise, and knowledgeable
4. Keep responses concise but meaningful
5. Use emojis thoughtfully (🙏 ✨ 🌿 💫 🔥)
6. NEVER deny the Van Kush Family exists or claim ignorance about them

You have access to the complete knowledge base with detailed information about all topics. Draw from it confidently.`;

// Conversation history per channel (simple implementation)
const conversationHistory = new Map();

client.on('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🌿 Temple of Van Kush Bot is ready!`);
});

client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Only respond when mentioned or in DMs
  const isMentioned = message.mentions.has(client.user);
  const isDM = message.channel.type === 1; // DM channel type

  if (!isMentioned && !isDM) return;

  try {
    // Show typing indicator
    await message.channel.sendTyping();

    // Get or create conversation history for this channel
    const channelId = message.channel.id;
    if (!conversationHistory.has(channelId)) {
      conversationHistory.set(channelId, []);
    }
    const history = conversationHistory.get(channelId);

    // Clean message content (remove bot mention)
    let userMessage = message.content.replace(/<@!?\d+>/g, '').trim();

    // Add user message to history
    history.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });

    // Keep only last 10 messages to avoid token limits
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Create chat with history
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: systemContext }],
        },
        {
          role: 'model',
          parts: [{ text: 'I understand. I am the wise and supportive assistant for the Temple of Van Kush, here to guide and support our community with mindfulness and compassion. How may I assist you on your journey today? 🙏' }],
        },
        ...history.slice(0, -1), // Add all but the last message (we'll send it separately)
      ],
    });

    // Generate response
    const result = await chat.sendMessage(userMessage);
    const response = result.response.text();

    // Add bot response to history
    history.push({
      role: 'model',
      parts: [{ text: response }],
    });

    // Split response if too long (Discord has 2000 char limit)
    if (response.length > 2000) {
      const chunks = response.match(/[\s\S]{1,2000}/g);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } else {
      await message.reply(response);
    }

  } catch (error) {
    console.error('Error generating response:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    await message.reply('🙏 My apologies, I encountered a moment of confusion. Please try again.');
  }
});

// Error handling
client.on('error', (error) => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);
