/**
 * /topics command - List available knowledge domains
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { KNOWLEDGE_HIERARCHY, KNOWLEDGE_BRIDGES } from '../utils/knowledgeLoader.js';

export const data = new SlashCommandBuilder()
  .setName('topics')
  .setDescription('List available knowledge topics and their connections');

export async function execute(interaction, { knowledgeLoader }) {
  const embed = new EmbedBuilder()
    .setColor(0x8B4513)
    .setTitle('📚 Knowledge Base Topics')
    .setDescription('The Library of Ashurbanipal knowledge flows from **core concepts** (Oilahuasca, Space Paste) outward to related topics.\n\n*Use `/ask [topic]` to query any topic.*')
    .setFooter({ text: 'Library of Ashurbanipal | Van Kush Family Research Institute' });

  // Root topics
  embed.addFields({
    name: '🌟 ROOT (Core Knowledge)',
    value: KNOWLEDGE_HIERARCHY.root.map(t => {
      const bridges = KNOWLEDGE_BRIDGES[t]?.keywords?.slice(0, 4).join(', ') || '';
      return `**${t}** - ${bridges}`;
    }).join('\n'),
    inline: false
  });

  // Primary branches
  embed.addFields({
    name: '🔱 PRIMARY BRANCHES',
    value: KNOWLEDGE_HIERARCHY.primary.map(t => {
      const bridges = KNOWLEDGE_BRIDGES[t]?.keywords?.slice(0, 3).join(', ') || '';
      return `**${t}** - ${bridges}`;
    }).join('\n'),
    inline: false
  });

  // Secondary branches
  embed.addFields({
    name: '🌿 SECONDARY',
    value: KNOWLEDGE_HIERARCHY.secondary.map(t => `\`${t}\``).join(' • '),
    inline: true
  });

  // Extended
  embed.addFields({
    name: '📖 EXTENDED',
    value: KNOWLEDGE_HIERARCHY.extended.map(t => `\`${t}\``).join(' • '),
    inline: true
  });

  // Show document counts if knowledge loader is available
  if (knowledgeLoader && knowledgeLoader.loaded) {
    const totalDocs = knowledgeLoader.documents.size;
    const domains = knowledgeLoader.domainDocuments.size;
    embed.addFields({
      name: '📊 Statistics',
      value: `**${totalDocs}** documents across **${domains}** domains`,
      inline: false
    });
  }

  // Add connection examples
  embed.addFields({
    name: '🔗 How Topics Connect',
    value: [
      '• **Oilahuasca** → Shulgin\'s "Ten Essential Oils" → PIHKAL compounds',
      '• **Headcones** → Kyphi incense → same allylbenzenes as Oilahuasca',
      '• **Phoenician wax** → transdermal delivery → consciousness transmission',
      '• **Temple economics** → modern cryptocurrency (VKBT)'
    ].join('\n'),
    inline: false
  });

  await interaction.reply({ embeds: [embed] });
}
