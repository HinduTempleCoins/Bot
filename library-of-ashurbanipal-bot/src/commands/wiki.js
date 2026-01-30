/**
 * /wiki command - Search and interact with MediaWiki
 */

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('wiki')
  .setDescription('Search the Library of Ashurbanipal wiki')
  .addStringOption(option =>
    option.setName('search')
      .setDescription('Search term')
      .setRequired(true)
  );

export async function execute(interaction, { wikiClient }) {
  const searchTerm = interaction.options.getString('search');

  await interaction.deferReply();

  try {
    const results = await wikiClient.search(searchTerm, 5);

    if (results.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFFCC00)
          .setTitle('No Wiki Results')
          .setDescription(`No articles found for "${searchTerm}".\n\nThis topic may not have a wiki article yet. Use \`/ask\` to query the knowledge base instead.`)
          .setFooter({ text: 'Library of Ashurbanipal Wiki' })
        ]
      });
    }

    const embed = new EmbedBuilder()
      .setColor(0x8B4513)
      .setTitle(`📖 Wiki Search: "${searchTerm}"`)
      .setDescription(`Found ${results.length} article${results.length > 1 ? 's' : ''}`)
      .setFooter({ text: 'Library of Ashurbanipal Wiki' });

    for (const result of results) {
      // Clean up the snippet (remove HTML tags)
      const snippet = result.snippet
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .slice(0, 200);

      embed.addFields({
        name: result.title,
        value: `${snippet}...\n[Read Article](${wikiClient.getArticleUrl(result.title)})`,
        inline: false
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('[/wiki] Error:', error);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Wiki Error')
        .setDescription('Could not connect to the wiki. Please try again later.')
        .setFooter({ text: 'Library of Ashurbanipal' })
      ]
    });
  }
}
