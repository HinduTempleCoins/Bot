/**
 * /apply command - Editor application process
 */

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('apply')
  .setDescription('Apply to become a wiki editor');

export async function execute(interaction) {
  // Create application modal
  const modal = new ModalBuilder()
    .setCustomId('editor_application')
    .setTitle('Wiki Editor Application');

  // Add input fields
  const experienceInput = new TextInputBuilder()
    .setCustomId('experience')
    .setLabel('Wiki/writing experience')
    .setPlaceholder('Describe any wiki editing, writing, or research experience...')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  const interestsInput = new TextInputBuilder()
    .setCustomId('interests')
    .setLabel('Areas of interest')
    .setPlaceholder('Which topics interest you? (Oilahuasca, Headcones, Shulgin, etc.)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  const hiveInput = new TextInputBuilder()
    .setCustomId('hive_username')
    .setLabel('HIVE username (optional)')
    .setPlaceholder('@yourusername')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(50);

  const contributionInput = new TextInputBuilder()
    .setCustomId('contribution')
    .setLabel('What would you contribute?')
    .setPlaceholder('What topics or articles would you like to work on?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  // Add inputs to action rows
  modal.addComponents(
    new ActionRowBuilder().addComponents(experienceInput),
    new ActionRowBuilder().addComponents(interestsInput),
    new ActionRowBuilder().addComponents(hiveInput),
    new ActionRowBuilder().addComponents(contributionInput)
  );

  await interaction.showModal(modal);
}

/**
 * Handle the application modal submission
 */
export async function handleModalSubmit(interaction) {
  if (interaction.customId !== 'editor_application') return false;

  const experience = interaction.fields.getTextInputValue('experience');
  const interests = interaction.fields.getTextInputValue('interests');
  const hiveUsername = interaction.fields.getTextInputValue('hive_username');
  const contribution = interaction.fields.getTextInputValue('contribution');

  // Create application embed
  const applicationEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📝 New Editor Application')
    .setDescription(`Application from **${interaction.user.tag}**`)
    .addFields(
      { name: '👤 Applicant', value: `<@${interaction.user.id}>`, inline: true },
      { name: '🔗 HIVE Account', value: hiveUsername || 'Not provided', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '📚 Experience', value: experience.slice(0, 1000), inline: false },
      { name: '🎯 Areas of Interest', value: interests.slice(0, 500), inline: false },
      { name: '✍️ Planned Contributions', value: contribution.slice(0, 500), inline: false }
    )
    .setThumbnail(interaction.user.displayAvatarURL())
    .setTimestamp()
    .setFooter({ text: 'Library of Ashurbanipal | Editor Application' });

  // Create approval buttons
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_editor:${interaction.user.id}`)
        .setLabel('Approve')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`deny_editor:${interaction.user.id}`)
        .setLabel('Deny')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌'),
      new ButtonBuilder()
        .setCustomId(`request_info:${interaction.user.id}`)
        .setLabel('Request More Info')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❓')
    );

  // Send to applications channel
  const applicationsChannelId = process.env.EDITOR_APPLICATIONS_CHANNEL_ID;
  if (applicationsChannelId) {
    const applicationsChannel = interaction.guild.channels.cache.get(applicationsChannelId);
    if (applicationsChannel) {
      await applicationsChannel.send({ embeds: [applicationEmbed], components: [row] });
    }
  }

  // Confirm to user
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x57F287)
      .setTitle('Application Submitted!')
      .setDescription('Your editor application has been submitted for review. An admin will review it soon.')
      .setFooter({ text: 'Library of Ashurbanipal' })
    ],
    ephemeral: true
  });

  return true;
}

/**
 * Handle application button interactions
 */
export async function handleApplicationButton(interaction) {
  const [action, applicantId] = interaction.customId.split(':');

  if (!['approve_editor', 'deny_editor', 'request_info'].includes(action)) {
    return false;
  }

  // Check if user has admin role
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (adminRoleId && !interaction.member.roles.cache.has(adminRoleId)) {
    return interaction.reply({
      content: '❌ Only admins can review editor applications.',
      ephemeral: true
    });
  }

  const applicant = await interaction.guild.members.fetch(applicantId).catch(() => null);

  if (action === 'approve_editor') {
    // Add editor role
    const editorRoleId = process.env.EDITOR_ROLE_ID;
    if (editorRoleId && applicant) {
      await applicant.roles.add(editorRoleId).catch(console.error);
    }

    // Update the embed
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0x57F287)
      .addFields({ name: '✅ Status', value: `Approved by ${interaction.user.tag}`, inline: false });

    await interaction.update({ embeds: [embed], components: [] });

    // DM the applicant
    if (applicant) {
      await applicant.send({
        embeds: [new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🎉 Application Approved!')
          .setDescription('Your editor application for the Library of Ashurbanipal wiki has been approved!\n\nYou can now use `/synthesize topic:... publish:true` to publish articles directly to the wiki.')
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      }).catch(() => {});
    }
  } else if (action === 'deny_editor') {
    const embed = EmbedBuilder.from(interaction.message.embeds[0])
      .setColor(0xED4245)
      .addFields({ name: '❌ Status', value: `Denied by ${interaction.user.tag}`, inline: false });

    await interaction.update({ embeds: [embed], components: [] });

    if (applicant) {
      await applicant.send({
        embeds: [new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('Application Update')
          .setDescription('Your editor application was not approved at this time. Feel free to apply again in the future!')
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      }).catch(() => {});
    }
  } else if (action === 'request_info') {
    if (applicant) {
      await applicant.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('More Information Requested')
          .setDescription('The admins would like more information about your editor application. Please respond to this message with additional details.')
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      }).catch(() => {});
    }

    await interaction.reply({
      content: `📨 Requested more information from <@${applicantId}>`,
      ephemeral: true
    });
  }

  return true;
}
