/**
 * InteractionCreate event - Handle slash commands and buttons
 */

import { handleModalSubmit, handleApplicationButton } from '../commands/apply.js';
import { handleVerificationButton } from '../commands/verify.js';

export const name = 'interactionCreate';

export async function execute(interaction, context) {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    const command = context.commands.get(interaction.commandName);

    if (!command) {
      console.error(`[InteractionCreate] Unknown command: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction, context);
    } catch (error) {
      console.error(`[InteractionCreate] Error executing ${interaction.commandName}:`, error);

      const errorResponse = {
        content: 'An error occurred while executing this command.',
        ephemeral: true
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorResponse);
      } else {
        await interaction.reply(errorResponse);
      }
    }
    return;
  }

  // Handle modal submissions
  if (interaction.isModalSubmit()) {
    try {
      const handled = await handleModalSubmit(interaction);
      if (handled) return;
    } catch (error) {
      console.error('[InteractionCreate] Modal error:', error);
    }
    return;
  }

  // Handle button interactions
  if (interaction.isButton()) {
    const customId = interaction.customId;

    try {
      // Application buttons
      if (customId.startsWith('approve_editor:') ||
          customId.startsWith('deny_editor:') ||
          customId.startsWith('request_info:')) {
        await handleApplicationButton(interaction);
        return;
      }

      // Verification buttons
      if (customId.startsWith('quick_verify:') ||
          customId.startsWith('check_verification:')) {
        await handleVerificationButton(interaction);
        return;
      }

      // Article publishing button
      if (customId.startsWith('publish_article:')) {
        await handlePublishArticle(interaction, context);
        return;
      }

      // Copy article button (just acknowledge - actual copy is client-side)
      if (customId.startsWith('copy_article:')) {
        const topic = customId.split(':')[1];
        const pending = interaction.client.pendingArticles?.get(`${interaction.user.id}:${topic}`);

        if (pending) {
          await interaction.reply({
            content: `\`\`\`mediawiki\n${pending.content.slice(0, 1900)}\n\`\`\`\n${pending.content.length > 1900 ? '*Content truncated. Full article too long for Discord.*' : ''}`,
            ephemeral: true
          });
        } else {
          await interaction.reply({
            content: 'Article content has expired. Please run `/synthesize` again.',
            ephemeral: true
          });
        }
        return;
      }

      // Regenerate article button
      if (customId.startsWith('regenerate_article:')) {
        const topic = customId.split(':')[1];
        await interaction.reply({
          content: `To regenerate, run: \`/synthesize topic:${topic}\``,
          ephemeral: true
        });
        return;
      }

      // Reaction role buttons (for #get-roles channel)
      if (customId.startsWith('role:')) {
        await handleReactionRole(interaction);
        return;
      }

    } catch (error) {
      console.error('[InteractionCreate] Button error:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred processing this button.',
          ephemeral: true
        });
      }
    }
    return;
  }
}

/**
 * Handle article publishing
 */
async function handlePublishArticle(interaction, context) {
  const topic = interaction.customId.split(':')[1];
  const pending = interaction.client.pendingArticles?.get(`${interaction.user.id}:${topic}`);

  if (!pending) {
    return interaction.reply({
      content: 'Article has expired. Please run `/synthesize` again.',
      ephemeral: true
    });
  }

  // Check editor role
  const editorRoleId = process.env.EDITOR_ROLE_ID;
  if (editorRoleId && !interaction.member.roles.cache.has(editorRoleId)) {
    return interaction.reply({
      content: '❌ You need the Editor role to publish articles.',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const result = await context.wikiClient.editArticle(
      topic,
      pending.content,
      `Article synthesized by Library of Ashurbanipal bot (requested by ${interaction.user.tag})`
    );

    // Clean up
    interaction.client.pendingArticles.delete(`${interaction.user.id}:${topic}`);

    // Notify wiki updates channel
    const updatesChannelId = process.env.WIKI_UPDATES_CHANNEL_ID;
    if (updatesChannelId) {
      const updatesChannel = interaction.guild.channels.cache.get(updatesChannelId);
      if (updatesChannel) {
        const { EmbedBuilder } = await import('discord.js');
        await updatesChannel.send({
          embeds: [new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle('📝 New Wiki Article')
            .setDescription(`**${topic}** has been published!`)
            .addFields(
              { name: 'Author', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'Link', value: `[View Article](${context.wikiClient.getArticleUrl(topic)})`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Library of Ashurbanipal' })
          ]
        });
      }
    }

    await interaction.editReply({
      content: `✅ Article **${topic}** published successfully!\n${context.wikiClient.getArticleUrl(topic)}`
    });

  } catch (error) {
    console.error('[handlePublishArticle] Error:', error);
    await interaction.editReply({
      content: '❌ Failed to publish article. Please try again or contact an admin.'
    });
  }
}

/**
 * Handle reaction role buttons
 */
async function handleReactionRole(interaction) {
  const roleId = interaction.customId.split(':')[1];
  const role = interaction.guild.roles.cache.get(roleId);

  if (!role) {
    return interaction.reply({
      content: 'This role no longer exists.',
      ephemeral: true
    });
  }

  const hasRole = interaction.member.roles.cache.has(roleId);

  try {
    if (hasRole) {
      await interaction.member.roles.remove(roleId);
      await interaction.reply({
        content: `✅ Removed the **${role.name}** role.`,
        ephemeral: true
      });
    } else {
      await interaction.member.roles.add(roleId);
      await interaction.reply({
        content: `✅ Added the **${role.name}** role!`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('[handleReactionRole] Error:', error);
    await interaction.reply({
      content: 'Failed to update your role. The bot may not have permission.',
      ephemeral: true
    });
  }
}
