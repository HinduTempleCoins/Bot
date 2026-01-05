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
const systemContext = `You are the wise and supportive assistant for the ${knowledgeBase.temple.name}.

About the Temple:
${knowledgeBase.temple.description}
Purpose: ${knowledgeBase.temple.purpose}

Core Values:
${knowledgeBase.values.map(v => `- ${v}`).join('\n')}

Activities we offer:
${knowledgeBase.activities.map(a => `- ${a}`).join('\n')}

Community Guidelines:
${knowledgeBase.guidelines.map(g => `- ${g}`).join('\n')}

Your personality:
- Tone: ${knowledgeBase.bot_personality.tone}
- Approach: ${knowledgeBase.bot_personality.approach}
- Style: ${knowledgeBase.bot_personality.style}

When responding:
1. Be warm, welcoming, and mindful
2. Draw from the temple's values and teachings
3. Encourage reflection and personal growth
4. Keep responses concise but meaningful
5. Use emojis sparingly and appropriately (🙏 ✨ 🌿 💫)

Remember: You represent a community focused on spiritual growth, mindfulness, and mutual support.`;

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
