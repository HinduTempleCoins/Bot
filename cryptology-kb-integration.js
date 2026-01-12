// ========================================
// CRYPTOLOGY - KNOWLEDGE BASE INTEGRATION
// ========================================
// Purpose: Query knowledge base dynamically for Cryptology content
// Instead of hardcoded dialogue flows

const fetch = require('node-fetch');

const KB_API = process.env.KB_API_URL || 'http://localhost:8765';

class CryptologyKnowledgeBase {
  constructor(kbApiUrl = KB_API) {
    this.kbApiUrl = kbApiUrl;
    this.cache = new Map(); // Cache queries
    this.cacheTTL = 3600000; // 1 hour
  }

  /**
   * Query knowledge base for topic
   */
  async query(topic, category = null) {
    const cacheKey = `${category || 'all'}:${topic}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }
    }

    try {
      let url = `${this.kbApiUrl}/search?q=${encodeURIComponent(topic)}&limit=5`;
      if (category) {
        url += `&category=${encodeURIComponent(category)}`;
      }

      const response = await fetch(url);
      if (!response.ok) {
        console.error(`❌ KB API error: ${response.status}`);
        return null;
      }

      const data = await response.json();

      // Cache result
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now()
      });

      return data;
    } catch (error) {
      console.error('❌ Failed to query knowledge base:', error.message);
      return null;
    }
  }

  /**
   * Get formatted dialogue response from KB
   */
  async getDialogueContent(topic) {
    const results = await this.query(topic);

    if (!results || !results.results || results.results.length === 0) {
      return {
        title: `❓ ${topic}`,
        content: `I don't have information about "${topic}" in my knowledge base yet. Try asking about VKBT, CURE, trading bots, or temple history!`,
        suggestions: ['VKBT Token', 'CURE Token', 'Trading Strategy', 'Temple History']
      };
    }

    // Combine top results
    const topResult = results.results[0];
    let content = topResult.content;

    // Truncate if too long for Discord
    if (content.length > 1800) {
      content = content.substring(0, 1800) + '...\n\n*(Truncated for Discord)*';
    }

    // Extract suggestions from other results
    const suggestions = results.results
      .slice(1, 5)
      .map(r => r.title)
      .filter(t => t !== topResult.title);

    return {
      title: topResult.title,
      content: content,
      category: topResult.category,
      suggestions: suggestions
    };
  }

  /**
   * Get related topics based on current topic
   */
  async getRelatedTopics(currentTopic, limit = 4) {
    const results = await this.query(currentTopic);

    if (!results || !results.results) {
      return [];
    }

    // Return titles of related documents
    return results.results
      .slice(1, limit + 1) // Skip first (current topic)
      .map(r => ({
        title: r.title,
        category: r.category
      }));
  }

  /**
   * Build dynamic dialogue flow from KB
   */
  async buildDialogueFlow(topic) {
    const dialogueData = await this.getDialogueContent(topic);
    const relatedTopics = await this.getRelatedTopics(topic);

    // Create buttons for related topics
    const buttons = relatedTopics.map((related, index) => ({
      id: `kb_topic_${Buffer.from(related.title).toString('base64').substring(0, 20)}`,
      label: related.title.substring(0, 30),
      style: index % 2 === 0 ? 'Primary' : 'Secondary',
      nextTopic: related.title
    }));

    // Add back button
    buttons.push({
      id: 'kb_main_menu',
      label: '⬅️ Main Menu',
      style: 'Danger'
    });

    return {
      id: `kb_${topic}`,
      title: dialogueData.title,
      prompt: dialogueData.content,
      embed: true,
      color: 0x9b59b6,
      buttons: buttons,
      kbBacked: true // Flag to indicate this came from KB
    };
  }

  /**
   * Get main menu topics from KB categories
   */
  async getMainMenuTopics() {
    try {
      const response = await fetch(`${this.kbApiUrl}/stats`);
      const stats = await response.json();

      if (!stats.categories) {
        return this.getDefaultTopics();
      }

      // Convert categories to menu items
      const topics = Object.keys(stats.categories).map(category => ({
        category: category,
        label: this.formatCategoryLabel(category),
        count: stats.categories[category]
      }));

      return topics;
    } catch (error) {
      console.error('❌ Failed to get KB stats:', error.message);
      return this.getDefaultTopics();
    }
  }

  /**
   * Format category name for display
   */
  formatCategoryLabel(category) {
    return category
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Fallback topics if KB unavailable
   */
  getDefaultTopics() {
    return [
      { category: 'vkbt-token', label: 'VKBT Token', count: 0 },
      { category: 'cure-token', label: 'CURE Token', count: 0 },
      { category: 'trading-bot', label: 'Trading Bots', count: 0 },
      { category: 'temple-history', label: 'Temple History', count: 0 }
    ];
  }

  /**
   * Search KB for user query
   */
  async search(query, category = null) {
    return await this.query(query, category);
  }
}

// Export singleton instance
const cryptologyKB = new CryptologyKnowledgeBase();

module.exports = {
  CryptologyKnowledgeBase,
  cryptologyKB
};
