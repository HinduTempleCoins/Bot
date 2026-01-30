/**
 * /article command - Fetch and display a wiki article
 */

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('article')
  .setDescription('Get a wiki article summary')
  .addStringOption(option =>
    option.setName('title')
      .setDescription('Article title')
      .setRequired(true)
  );

export async function execute(interaction, { wikiClient, geminiClient }) {
  const title = interaction.options.getString('title');

  await interaction.deferReply();

  try {
    // Try to get the article
    const article = await wikiClient.getArticle(title);

    if (!article) {
      // Article doesn't exist - suggest creating it
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFFCC00)
          .setTitle(`Article Not Found: "${title}"`)
          .setDescription('This article doesn\'t exist yet.\n\nWould you like to create it from the knowledge base? Use `/synthesize` to generate an article.')
          .setFooter({ text: 'Library of Ashurbanipal Wiki' })
        ]
      });
    }

    // Get summary (first ~1000 chars of content, cleaned up)
    let summary = article.content;

    // Remove wiki markup for display
    summary = summary
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[link|text]] -> text
      .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[link]] -> link
      .replace(/'''([^']+)'''/g, '**$1**') // bold
      .replace(/''([^']+)''/g, '*$1*') // italic
      .replace(/==+\s*([^=]+)\s*==+/g, '\n**$1**\n') // headers
      .replace(/<ref[^>]*>.*?<\/ref>/gs, '') // remove refs
      .replace(/<[^>]+>/g, '') // remove other HTML
      .replace(/\{\{[^}]+\}\}/g, '') // remove templates
      .slice(0, 1500);

    const embed = new EmbedBuilder()
      .setColor(0x8B4513)
      .setTitle(`📜 ${article.title}`)
      .setDescription(summary + (article.content.length > 1500 ? '...' : ''))
      .setURL(wikiClient.getArticleUrl(article.title))
      .addFields(
        { name: 'Length', value: `${article.length} bytes`, inline: true },
        { name: 'Last Updated', value: new Date(article.timestamp).toLocaleDateString(), inline: true }
      )
      .setFooter({ text: 'Library of Ashurbanipal Wiki' });

    // Add a button to view full article
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('Read Full Article')
          .setStyle(ButtonStyle.Link)
          .setURL(wikiClient.getArticleUrl(article.title))
      );

    await interaction.editReply({ embeds: [embed], components: [row] });

  } catch (error) {
    console.error('[/article] Error:', error);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Error')
        .setDescription('Could not fetch the article. Please try again.')
        .setFooter({ text: 'Library of Ashurbanipal' })
      ]
    });
  }
}
