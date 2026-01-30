/**
 * /synthesize command - Generate a wiki article from knowledge base
 *
 * This is the core wiki-building command. It:
 * 1. Gathers context from multiple knowledge base sources
 * 2. Uses Gemini to synthesize a coherent wiki article
 * 3. Optionally publishes directly to the wiki (if authorized)
 */

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('synthesize')
  .setDescription('Generate a wiki article from the knowledge base')
  .addStringOption(option =>
    option.setName('topic')
      .setDescription('Topic for the article')
      .setRequired(true)
  )
  .addBooleanOption(option =>
    option.setName('publish')
      .setDescription('Publish directly to wiki (requires Editor role)')
      .setRequired(false)
  );

export async function execute(interaction, { knowledgeLoader, geminiClient, wikiClient }) {
  const topic = interaction.options.getString('topic');
  const shouldPublish = interaction.options.getBoolean('publish') || false;

  // Check for Editor role if publishing
  if (shouldPublish) {
    const editorRoleId = process.env.EDITOR_ROLE_ID;
    if (editorRoleId && !interaction.member.roles.cache.has(editorRoleId)) {
      return interaction.reply({
        content: '❌ You need the **Editor** role to publish directly to the wiki. Article will be generated for preview only.',
        ephemeral: true
      });
    }
  }

  await interaction.deferReply();

  try {
    // Get topic context from knowledge base
    const context = knowledgeLoader.getTopicContext(topic, 3);

    // Also get foundational context (Oilahuasca, Headcones, Shulgin)
    const foundational = knowledgeLoader.getFoundationalContext();

    // Merge contexts
    const fullContext = {
      ...context,
      ...foundational
    };

    if (context.primary.length === 0) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFFCC00)
          .setTitle('Insufficient Knowledge')
          .setDescription(`Not enough information found about "${topic}" in the knowledge base to synthesize an article.\n\nTry a more specific topic or check what's available with \`/topics\`.`)
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      });
    }

    // Check if article already exists
    const existingArticle = await wikiClient.getArticle(topic);

    // Synthesize the article
    const articleContent = await geminiClient.synthesizeArticle(
      topic,
      fullContext,
      existingArticle?.content
    );

    // Create preview embed
    const previewEmbed = new EmbedBuilder()
      .setColor(0x8B4513)
      .setTitle(`📝 Synthesized Article: ${topic}`)
      .setDescription(articleContent.slice(0, 4000))
      .addFields(
        {
          name: '📚 Sources Used',
          value: [...new Set(context.primary.map(p => p.domain))].map(d => `\`${d}\``).join(' • ') || 'Multiple',
          inline: true
        },
        {
          name: 'Status',
          value: existingArticle ? '📄 Update to existing article' : '✨ New article',
          inline: true
        }
      )
      .setFooter({ text: 'Library of Ashurbanipal | Review before publishing' });

    // If content is too long for embed, note it
    if (articleContent.length > 4000) {
      previewEmbed.addFields({
        name: '⚠️ Note',
        value: `Article is ${articleContent.length} characters. Only first 4000 shown in preview.`,
        inline: false
      });
    }

    // Create action buttons
    const row = new ActionRowBuilder();

    if (shouldPublish && wikiClient.loggedIn) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`publish_article:${topic}`)
          .setLabel('Publish to Wiki')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📤'),
        new ButtonBuilder()
          .setCustomId(`regenerate_article:${topic}`)
          .setLabel('Regenerate')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔄')
      );
    } else {
      row.addComponents(
        new ButtonBuilder()
          .setLabel('Copy Article Content')
          .setCustomId(`copy_article:${topic}`)
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋'),
        new ButtonBuilder()
          .setLabel('View on Wiki')
          .setStyle(ButtonStyle.Link)
          .setURL(wikiClient.getArticleUrl(topic))
          .setDisabled(!existingArticle)
      );
    }

    // Store the article content for potential publishing
    interaction.client.pendingArticles = interaction.client.pendingArticles || new Map();
    interaction.client.pendingArticles.set(`${interaction.user.id}:${topic}`, {
      content: articleContent,
      topic,
      timestamp: Date.now()
    });

    await interaction.editReply({ embeds: [previewEmbed], components: [row] });

  } catch (error) {
    console.error('[/synthesize] Error:', error);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Synthesis Error')
        .setDescription('An error occurred while synthesizing the article. Please try again.')
        .setFooter({ text: 'Library of Ashurbanipal' })
      ]
    });
  }
}
