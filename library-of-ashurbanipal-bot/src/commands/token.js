/**
 * /token command - SOAP/VKBT token information
 */

import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import axios from 'axios';

export const data = new SlashCommandBuilder()
  .setName('token')
  .setDescription('Get SOAP/VKBT token information');

export async function execute(interaction) {
  await interaction.deferReply();

  try {
    // Fetch token data from HIVE-Engine
    const [soapData, vkbtData] = await Promise.all([
      fetchTokenData('SOAP'),
      fetchTokenData('VKBT')
    ]);

    const embed = new EmbedBuilder()
      .setColor(0x8B4513)
      .setTitle('🪙 Van Kush Family Tokens')
      .setDescription('Community tokens supporting the SoapBox.Community ecosystem')
      .setFooter({ text: 'Library of Ashurbanipal | Data from HIVE-Engine' })
      .setTimestamp();

    // SOAP Token Info
    if (soapData) {
      embed.addFields({
        name: '🧼 SOAP Token (Graphene)',
        value: [
          `**Supply:** ${formatNumber(soapData.circulatingSupply || soapData.supply)}`,
          `**Last Price:** ${soapData.lastPrice || 'N/A'} HIVE`,
          `**24h Volume:** ${formatNumber(soapData.volume24h || 0)} HIVE`,
          `**Market Cap:** ${formatNumber((soapData.lastPrice || 0) * (soapData.circulatingSupply || 0))} HIVE`
        ].join('\n'),
        inline: true
      });
    } else {
      embed.addFields({
        name: '🧼 SOAP Token',
        value: 'Data unavailable',
        inline: true
      });
    }

    // VKBT Token Info
    if (vkbtData) {
      embed.addFields({
        name: '🏛️ VKBT Token (HIVE-Engine)',
        value: [
          `**Supply:** ${formatNumber(vkbtData.circulatingSupply || vkbtData.supply)}`,
          `**Last Price:** ${vkbtData.lastPrice || 'N/A'} HIVE`,
          `**24h Volume:** ${formatNumber(vkbtData.volume24h || 0)} HIVE`,
          `**Precision:** ${vkbtData.precision || 8}`
        ].join('\n'),
        inline: true
      });
    } else {
      embed.addFields({
        name: '🏛️ VKBT Token',
        value: 'Data unavailable',
        inline: true
      });
    }

    // Add context about the tokens
    embed.addFields({
      name: '📖 About',
      value: [
        '**SOAP** - SoapBox.Community governance token',
        '**VKBT** - Van Kush Beauty Token, launched Sept 4, 2021',
        '',
        'Both tokens support the Van Kush Family Research Institute ecosystem,',
        'connecting ancient temple economics to modern blockchain technology.'
      ].join('\n'),
      inline: false
    });

    // Add links
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setLabel('VKBT on HIVE-Engine')
          .setStyle(ButtonStyle.Link)
          .setURL('https://hive-engine.com/?p=market&t=VKBT'),
        new ButtonBuilder()
          .setLabel('HIVE Wallet')
          .setStyle(ButtonStyle.Link)
          .setURL('https://wallet.hive.blog/@vankushfamily'),
        new ButtonBuilder()
          .setLabel('Tribaldex')
          .setStyle(ButtonStyle.Link)
          .setURL('https://tribaldex.com/trade/VKBT')
      );

    await interaction.editReply({ embeds: [embed], components: [row] });

  } catch (error) {
    console.error('[/token] Error:', error);
    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle('Token Data Error')
        .setDescription('Could not fetch token information. Please try again later.')
        .setFooter({ text: 'Library of Ashurbanipal' })
      ]
    });
  }
}

/**
 * Fetch token data from HIVE-Engine API
 */
async function fetchTokenData(symbol) {
  try {
    const response = await axios.post('https://api.hive-engine.com/rpc/contracts', {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'tokens',
        table: 'tokens',
        query: { symbol },
        limit: 1
      }
    }, {
      timeout: 10000
    });

    const token = response.data?.result?.[0];
    if (!token) return null;

    // Get market data
    const marketResponse = await axios.post('https://api.hive-engine.com/rpc/contracts', {
      jsonrpc: '2.0',
      id: 1,
      method: 'find',
      params: {
        contract: 'market',
        table: 'metrics',
        query: { symbol },
        limit: 1
      }
    }, {
      timeout: 10000
    });

    const market = marketResponse.data?.result?.[0] || {};

    return {
      ...token,
      lastPrice: market.lastPrice,
      volume24h: market.volume,
      priceChange: market.priceChangePercent
    };
  } catch (error) {
    console.error(`[fetchTokenData] Error fetching ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Format large numbers
 */
function formatNumber(num) {
  if (!num) return '0';
  const n = parseFloat(num);
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(2) + 'K';
  return n.toFixed(2);
}
