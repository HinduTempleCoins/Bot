/**
 * /ask command - RAG search knowledgebase + AI response
 *
 * This is the primary knowledge query command. It:
 * 1. Searches the knowledge base for relevant documents
 * 2. Uses Gemini to synthesize an answer
 * 3. Shows connections between topics
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask a question about the knowledge base')
  .addStringOption(option =>
    option.setName('question')
      .setDescription('Your question')
      .setRequired(true)
  )
  .addBooleanOption(option =>
    option.setName('detailed')
      .setDescription('Get a more detailed response')
      .setRequired(false)
  );

export async function execute(interaction, { knowledgeLoader, geminiClient }) {
  const question = interaction.options.getString('question');
  const detailed = interaction.options.getBoolean('detailed') || false;

  await interaction.deferReply();

  try {
    // Search knowledge base
    const context = knowledgeLoader.getTopicContext(question, 2);

    if (context.primary.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFFCC00)
          .setTitle('No Results Found')
          .setDescription(`I couldn't find information about "${question}" in the knowledge base. Try different keywords or check the wiki directly.`)
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      });
    }

    // Generate response
    const response = detailed
      ? await geminiClient.answerQuestion(question, context)
      : await geminiClient.generateBriefResponse(question, context);

    // Build response embed
    const embed = new EmbedBuilder()
      .setColor(0x8B4513) // Saddle brown - papyrus color
      .setTitle(`📜 ${question}`)
      .setDescription(response.slice(0, 4000))
      .setFooter({ text: 'Library of Ashurbanipal | Synthesized from knowledge base' });

    // Add source domains
    const domains = [...new Set(context.primary.map(p => p.domain))];
    if (domains.length > 0) {
      embed.addFields({
        name: '📚 Sources',
        value: domains.map(d => `\`${d}\``).join(' • '),
        inline: true
      });
    }

    // Add related topics
    if (context.related.length > 0) {
      const relatedDomains = [...new Set(context.related.map(r => r.domain))].slice(0, 5);
      embed.addFields({
        name: '🔗 Related Topics',
        value: relatedDomains.map(d => `\`${d}\``).join(' • '),
        inline: true
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('[/ask] Error:', error);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Error')
        .setDescription('An error occurred while processing your question. Please try again.')
        .setFooter({ text: 'Library of Ashurbanipal' })
      ]
    });
  }
}
