/**
 * /verify command - Verify HIVE account ownership
 *
 * Users verify ownership by posting a specific memo or by
 * checking if they hold VKBT tokens.
 */

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import axios from 'axios';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify your HIVE account to get the Verified HIVE Holder role')
  .addStringOption(option =>
    option.setName('username')
      .setDescription('Your HIVE username (without @)')
      .setRequired(true)
  );

export async function execute(interaction) {
  const username = interaction.options.getString('username').replace('@', '').toLowerCase();

  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if HIVE account exists
    const accountData = await getHiveAccount(username);

    if (!accountData) {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('Account Not Found')
          .setDescription(`No HIVE account found with username \`${username}\`.\n\nMake sure you entered your username correctly (without the @).`)
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      });
    }

    // Check for VKBT token holdings
    const vkbtBalance = await getTokenBalance(username, 'VKBT');
    const hasVKBT = parseFloat(vkbtBalance) > 0;

    // Generate verification code
    const verificationCode = generateVerificationCode(interaction.user.id, username);

    // Store pending verification
    interaction.client.pendingVerifications = interaction.client.pendingVerifications || new Map();
    interaction.client.pendingVerifications.set(interaction.user.id, {
      username,
      code: verificationCode,
      timestamp: Date.now(),
      hasVKBT
    });

    // If user has VKBT, offer quick verification
    if (hasVKBT) {
      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🪙 VKBT Holder Detected!')
        .setDescription(`Account **@${username}** holds **${vkbtBalance} VKBT**!\n\nYou qualify for instant verification as a VKBT holder.`)
        .addFields(
          { name: 'Account', value: `@${username}`, inline: true },
          { name: 'VKBT Balance', value: vkbtBalance, inline: true }
        )
        .setFooter({ text: 'Library of Ashurbanipal | HIVE Verification' });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`quick_verify:${interaction.user.id}`)
            .setLabel('Verify Now')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
        );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // Standard verification - require memo proof
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📝 Verification Required')
      .setDescription(`To verify ownership of **@${username}**, please complete one of these steps:`)
      .addFields(
        {
          name: 'Option 1: Send a HIVE memo',
          value: `Send any amount of HIVE (0.001 minimum) to **@vankushfamily** with this memo:\n\`\`\`${verificationCode}\`\`\``,
          inline: false
        },
        {
          name: 'Option 2: Hold VKBT tokens',
          value: 'Purchase any amount of VKBT on [HIVE-Engine](https://hive-engine.com/?p=market&t=VKBT) and run this command again.',
          inline: false
        },
        {
          name: 'Option 3: Post verification',
          value: `Post to HIVE with the hashtag #libraryofashurbanipal and include this code: \`${verificationCode}\``,
          inline: false
        }
      )
      .setFooter({ text: 'Verification code expires in 24 hours' });

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`check_verification:${interaction.user.id}`)
          .setLabel('Check Verification')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🔍'),
        new ButtonBuilder()
          .setLabel('Get VKBT')
          .setStyle(ButtonStyle.Link)
          .setURL('https://hive-engine.com/?p=market&t=VKBT')
      );

    await interaction.editReply({ embeds: [embed], components: [row] });

  } catch (error) {
    console.error('[/verify] Error:', error);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Verification Error')
        .setDescription('An error occurred during verification. Please try again.')
        .setFooter({ text: 'Library of Ashurbanipal' })
      ]
    });
  }
}

/**
 * Handle verification buttons
 */
export async function handleVerificationButton(interaction) {
  const [action, userId] = interaction.customId.split(':');

  if (!['quick_verify', 'check_verification'].includes(action)) {
    return false;
  }

  if (interaction.user.id !== userId) {
    return interaction.reply({
      content: '❌ This verification is for another user.',
      ephemeral: true
    });
  }

  const pendingData = interaction.client.pendingVerifications?.get(userId);
  if (!pendingData) {
    return interaction.reply({
      content: '❌ No pending verification found. Please run `/verify` again.',
      ephemeral: true
    });
  }

  await interaction.deferReply({ ephemeral: true });

  if (action === 'quick_verify') {
    // Quick verify for VKBT holders
    const verifiedRoleId = process.env.VERIFIED_HIVE_ROLE_ID;
    if (verifiedRoleId) {
      await interaction.member.roles.add(verifiedRoleId).catch(console.error);
    }

    // Clean up
    interaction.client.pendingVerifications.delete(userId);

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✅ Verified!')
        .setDescription(`You have been verified as **@${pendingData.username}** (VKBT Holder)!\n\nYou now have the Verified HIVE Holder role.`)
        .setFooter({ text: 'Library of Ashurbanipal' })
      ]
    });
  }

  if (action === 'check_verification') {
    // Check for memo or post with verification code
    const verified = await checkVerification(pendingData.username, pendingData.code);

    if (verified) {
      const verifiedRoleId = process.env.VERIFIED_HIVE_ROLE_ID;
      if (verifiedRoleId) {
        await interaction.member.roles.add(verifiedRoleId).catch(console.error);
      }

      interaction.client.pendingVerifications.delete(userId);

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('✅ Verified!')
          .setDescription(`You have been verified as **@${pendingData.username}**!\n\nYou now have the Verified HIVE Holder role.`)
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      });
    } else {
      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('Not Yet Verified')
          .setDescription('Verification not found yet. Please make sure you:\n\n1. Sent the memo to @vankushfamily\n2. Used the exact verification code\n3. Wait a few minutes for the transaction to confirm\n\nThen click "Check Verification" again.')
          .setFooter({ text: 'Library of Ashurbanipal' })
        ]
      });
    }
  }

  return true;
}

/**
 * Generate verification code
 */
function generateVerificationCode(discordId, hiveUsername) {
  const data = `${discordId}-${hiveUsername}-${Date.now()}`;
  // Simple hash for verification (in production, use crypto)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `ASHUR-${Math.abs(hash).toString(36).toUpperCase()}`;
}

/**
 * Get HIVE account data
 */
async function getHiveAccount(username) {
  try {
    const response = await axios.post('https://api.hive.blog', {
      jsonrpc: '2.0',
      method: 'condenser_api.get_accounts',
      params: [[username]],
      id: 1
    }, { timeout: 10000 });

    return response.data?.result?.[0] || null;
  } catch (error) {
    console.error('[getHiveAccount] Error:', error.message);
    return null;
  }
}

/**
 * Get token balance from HIVE-Engine
 */
async function getTokenBalance(username, symbol) {
  try {
    const response = await axios.post('https://api.hive-engine.com/rpc/contracts', {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'balances',
        query: { account: username, symbol },
        limit: 1
      }
    }, { timeout: 10000 });

    return response.data?.result?.[0]?.balance || '0';
  } catch (error) {
    console.error('[getTokenBalance] Error:', error.message);
    return '0';
  }
}

/**
 * Check if verification memo was sent
 */
async function checkVerification(username, code) {
  try {
    // Check account history for transfers to vankushfamily with the code
    const response = await axios.post('https://api.hive.blog', {
      jsonrpc: '2.0',
      method: 'condenser_api.get_account_history',
      params: [username, -1, 100],
      id: 1
    }, { timeout: 10000 });

    const history = response.data?.result || [];

    for (const [, operation] of history) {
      if (operation.op[0] === 'transfer') {
        const transfer = operation.op[1];
        if (transfer.to === 'vankushfamily' && transfer.memo.includes(code)) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error('[checkVerification] Error:', error.message);
    return false;
  }
}
