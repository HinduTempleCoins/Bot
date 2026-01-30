/**
 * MessageCreate event - Handle natural language when bot is mentioned
 */

import { EmbedBuilder } from 'discord.js';

export const name = 'messageCreate';

export async function execute(message, { knowledgeLoader, geminiClient, wikiClient }) {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check if bot is mentioned
  const isMentioned = message.mentions.has(message.client.user);

  if (!isMentioned) return;

  // Extract the actual question (remove mention)
  const content = message.content
    .replace(/<@!?\d+>/g, '')
    .trim();

  if (!content) {
    // Just mentioned without question - give intro
    return message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x8B4513)
        .setTitle('📜 Library of Ashurbanipal')
        .setDescription('I am the knowledge keeper for the Van Kush Family Research Institute.\n\n**Ask me about:**\n• Oilahuasca & Space Paste\n• Egyptian Wax Headcones\n• Shulgin\'s PIHKAL/TIHKAL research\n• Phoenician consciousness technology\n• And much more...\n\n*Just mention me with your question, or use `/ask` for detailed responses.*')
        .setFooter({ text: 'Named for the library where fire baked and preserved the clay tablets' })
      ]
    });
  }

  // Start typing indicator
  await message.channel.sendTyping();

  try {
    // Search knowledge base
    const context = knowledgeLoader.getTopicContext(content, 2);

    // If no results, give a helpful response
    if (context.primary.length === 0) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xFFCC00)
          .setTitle('Searching the Archives...')
          .setDescription(`I couldn't find specific information about that in the knowledge base.\n\nTry asking about:\n• Oilahuasca / Space Paste\n• Headcones / Kyphi\n• PIHKAL / TIHKAL\n• Phoenician technology\n\nOr use \`/topics\` to see all available subjects.`)
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      });
    }

    // Generate response
    const response = await geminiClient.generateBriefResponse(content, context);

    // Build response embed
    const embed = new EmbedBuilder()
      .setColor(0x8B4513)
      .setDescription(response.slice(0, 4000))
      .setFooter({
        text: `Sources: ${[...new Set(context.primary.map(p => p.domain))].join(', ')}`
      });

    // If response is asking about wiki, check if article exists
    const wikiKeywords = ['wiki', 'article', 'page', 'read more'];
    const mentionsWiki = wikiKeywords.some(kw => content.toLowerCase().includes(kw));

    if (mentionsWiki) {
      // Try to find related wiki article
      const searchResults = await wikiClient.search(content, 3).catch(() => []);
      if (searchResults.length > 0) {
        embed.addFields({
          name: '📖 Related Wiki Articles',
          value: searchResults.map(r =>
            `[${r.title}](${wikiClient.getArticleUrl(r.title)})`
          ).join('\n'),
          inline: false
        });
      }
    }

    await message.reply({ embeds: [embed] });

  } catch (error) {
    console.error('[messageCreate] Error:', error);
    await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF0000)
        .setDescription('I encountered an error while searching the archives. Please try again.')
        .setFooter({ text: 'Library of Ashurbanipal' })
      ]
    });
  }
}
