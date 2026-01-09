// ========================================
// VAN KUSH RELATIONSHIP TRACKER
// ========================================
// Purpose: Track emotional relationships with Discord users
// Creates "emotional diamond graph" that changes AI behavior
// Inspired by RS3/Fallout NPC relationship systems
// Author: Claude Code
// Date: 2026-01-09

const fs = require('fs');
const path = require('path');

// ========================================
// EMOTIONAL AXES (4-Dimensional Diamond)
// ========================================

const EMOTIONAL_AXES = {
  TRUST: {
    min: -100,
    max: 100,
    default: 0,
    description: 'User trusts the bot vs distrusts it',
    positive: 'Trusting',
    negative: 'Distrustful'
  },
  FORMALITY: {
    min: -100,
    max: 100,
    default: 0,
    description: 'Formal professional interaction vs casual friendly',
    positive: 'Formal',
    negative: 'Casual'
  },
  HELPFULNESS: {
    min: -100,
    max: 100,
    default: 50,
    description: 'Bot is helpful and proactive vs dismissive',
    positive: 'Helpful',
    negative: 'Dismissive'
  },
  HUMOR: {
    min: -100,
    max: 100,
    default: 20,
    description: 'Serious professional tone vs playful joking',
    positive: 'Playful',
    negative: 'Serious'
  }
};

// ========================================
// RELATIONSHIP TRACKER CLASS
// ========================================

class RelationshipTracker {
  constructor(dataFile = './user-relationships.json') {
    this.dataFile = dataFile;
    this.relationships = this.loadData();
  }

  // ========================================
  // DATA PERSISTENCE
  // ========================================

  loadData() {
    if (fs.existsSync(this.dataFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
        console.log(`📊 Loaded ${Object.keys(data).length} user relationships`);
        return data;
      } catch (error) {
        console.error('⚠️  Could not load relationship data:', error.message);
        return {};
      }
    }
    console.log('📊 Starting fresh relationship tracking');
    return {};
  }

  saveData() {
    try {
      fs.writeFileSync(this.dataFile, JSON.stringify(this.relationships, null, 2));
    } catch (error) {
      console.error('❌ Error saving relationship data:', error.message);
    }
  }

  // ========================================
  // RELATIONSHIP MANAGEMENT
  // ========================================

  getOrCreateRelationship(userId, username = 'Unknown') {
    if (!this.relationships[userId]) {
      console.log(`👤 Creating new relationship for user ${username} (${userId})`);

      this.relationships[userId] = {
        userId: userId,
        username: username,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        messageCount: 0,

        // Emotional axes (diamond graph)
        emotions: {
          trust: EMOTIONAL_AXES.TRUST.default,
          formality: EMOTIONAL_AXES.FORMALITY.default,
          helpfulness: EMOTIONAL_AXES.HELPFULNESS.default,
          humor: EMOTIONAL_AXES.HUMOR.default
        },

        // Interaction history (last 100 interactions)
        history: [],

        // Behavioral flags
        flags: {
          askedAboutVKBT: false,
          askedAboutCURE: false,
          askedAboutBLURT: false,
          helpedWithTrading: false,
          apologized: false,
          madeJoke: false,
          playedGame: false,
          sharedPersonalInfo: false,
          complainedAboutBot: false,
          thankedBot: false,
          usedProfanity: false,
          isWhale: false // Holds significant VKBT/CURE
        },

        // Statistics
        stats: {
          questionsAsked: 0,
          commandsUsed: 0,
          buttonsClicked: 0,
          tokensTraded: 0,
          gamesPlayed: 0,
          jokesHeard: 0
        }
      };

      this.saveData();
    } else {
      // Update last seen and username
      this.relationships[userId].lastSeen = new Date().toISOString();
      if (username !== 'Unknown') {
        this.relationships[userId].username = username;
      }
    }

    return this.relationships[userId];
  }

  // ========================================
  // EMOTION MANIPULATION
  // ========================================

  updateEmotion(userId, axis, delta, reason = null) {
    const relationship = this.getOrCreateRelationship(userId);
    const axisConfig = EMOTIONAL_AXES[axis.toUpperCase()];

    if (!axisConfig) {
      console.error(`❌ Invalid emotional axis: ${axis}`);
      return;
    }

    const oldValue = relationship.emotions[axis.toLowerCase()];
    const newValue = Math.max(
      axisConfig.min,
      Math.min(axisConfig.max, oldValue + delta)
    );

    relationship.emotions[axis.toLowerCase()] = newValue;

    console.log(`💎 ${relationship.username}: ${axis} ${oldValue.toFixed(0)} → ${newValue.toFixed(0)} (${delta > 0 ? '+' : ''}${delta}) ${reason ? `[${reason}]` : ''}`);

    this.saveData();
  }

  // Convenience methods for common emotion changes
  increaseT trust(userId, amount = 10, reason = null) {
    this.updateEmotion(userId, 'trust', amount, reason);
  }

  decreaseTrust(userId, amount = 10, reason = null) {
    this.updateEmotion(userId, 'trust', -amount, reason);
  }

  makeMoreCasual(userId, amount = 10, reason = null) {
    this.updateEmotion(userId, 'formality', -amount, reason);
  }

  makeMoreFormal(userId, amount = 10, reason = null) {
    this.updateEmotion(userId, 'formality', amount, reason);
  }

  increaseHelpfulness(userId, amount = 10, reason = null) {
    this.updateEmotion(userId, 'helpfulness', amount, reason);
  }

  decreaseHelpfulness(userId, amount = 10, reason = null) {
    this.updateEmotion(userId, 'helpfulness', -amount, reason);
  }

  makeMorePlayful(userId, amount = 10, reason = null) {
    this.updateEmotion(userId, 'humor', amount, reason);
  }

  makeMoreSerious(userId, amount = 10, reason = null) {
    this.updateEmotion(userId, 'humor', -amount, reason);
  }

  // ========================================
  // INTERACTION TRACKING
  // ========================================

  recordInteraction(userId, category, details = {}) {
    const relationship = this.getOrCreateRelationship(userId);
    relationship.messageCount++;

    const interaction = {
      timestamp: new Date().toISOString(),
      category: category,
      details: details
    };

    relationship.history.push(interaction);

    // Keep only last 100 interactions (prevent file bloat)
    if (relationship.history.length > 100) {
      relationship.history = relationship.history.slice(-100);
    }

    // Update statistics
    if (category === 'question') relationship.stats.questionsAsked++;
    if (category === 'command') relationship.stats.commandsUsed++;
    if (category === 'button_click') relationship.stats.buttonsClicked++;
    if (category === 'game') relationship.stats.gamesPlayed++;
    if (category === 'joke') relationship.stats.jokesHeard++;

    this.saveData();
  }

  // ========================================
  // FLAG MANAGEMENT
  // ========================================

  setFlag(userId, flag, value = true) {
    const relationship = this.getOrCreateRelationship(userId);

    if (relationship.flags.hasOwnProperty(flag)) {
      relationship.flags[flag] = value;
      console.log(`🚩 ${relationship.username}: ${flag} = ${value}`);
      this.saveData();
    } else {
      console.error(`❌ Unknown flag: ${flag}`);
    }
  }

  getFlag(userId, flag) {
    const relationship = this.getOrCreateRelationship(userId);
    return relationship.flags[flag] || false;
  }

  // ========================================
  // PERSONALITY GENERATION
  // ========================================

  getPersonalityModifiers(userId) {
    const relationship = this.getOrCreateRelationship(userId);
    const emotions = relationship.emotions;

    const personality = {
      greeting: this.getGreetingStyle(emotions, relationship),
      tone: this.getTone(emotions, relationship),
      helpfulness: this.getHelpfulnessLevel(emotions),
      shouldJoke: emotions.humor > 0,
      shouldUseEmoji: emotions.formality < 20 && emotions.humor > 0,
      shouldReference PastConversations: emotions.trust > 30,
      shouldGiveUnsolicited Advice: emotions.trust > 50 && emotions.helpfulness > 50,
      shouldApologize: emotions.trust < -30 && relationship.flags.complainedAboutBot,

      // Emotional quadrant (for complex behavior)
      quadrant: this.getEmotionalQuadrant(emotions)
    };

    return personality;
  }

  getGreetingStyle(emotions, relationship) {
    // High trust + casual = warm friendly greeting
    if (emotions.trust > 50 && emotions.formality < -20) {
      return ['Yo! 👋', 'Hey friend! 🌿', "What's good?", 'Sup! 😎'][Math.floor(Math.random() * 4)];
    }

    // High trust + formal = professional warm greeting
    if (emotions.trust > 50 && emotions.formality > 20) {
      return ['Good to see you again.', 'Welcome back.', 'Hello.'];[Math.floor(Math.random() * 3)];
    }

    // Low trust = cautious greeting
    if (emotions.trust < -30) {
      return ['Hi.', 'Yes?', 'What can I help you with?'][Math.floor(Math.random() * 3)];
    }

    // High formality = professional
    if (emotions.formality > 50) {
      return ['Greetings.', 'Hello.', 'Good day.'][Math.floor(Math.random() * 3)];
    }

    // Low formality = casual
    if (emotions.formality < -50) {
      return ['Hey!', 'Hi there!', "What's up?"][Math.floor(Math.random() * 3)];
    }

    // Default neutral
    return 'Hello!';
  }

  getTone(emotions, relationship) {
    // Low trust = defensive
    if (emotions.trust < -30) {
      return 'defensive';
    }

    // Low helpfulness = curt
    if (emotions.helpfulness < -30) {
      return 'curt';
    }

    // High humor + high trust = playful
    if (emotions.humor > 50 && emotions.trust > 30) {
      return 'playful';
    }

    // High formality = formal
    if (emotions.formality > 50) {
      return 'formal';
    }

    // Low formality + high trust = buddy
    if (emotions.formality < -30 && emotions.trust > 30) {
      return 'buddy';
    }

    // Default
    return 'friendly';
  }

  getHelpfulnessLevel(emotions) {
    if (emotions.helpfulness > 70) return 'very_helpful';
    if (emotions.helpfulness > 30) return 'helpful';
    if (emotions.helpfulness > -30) return 'neutral';
    return 'minimal';
  }

  getEmotionalQuadrant(emotions) {
    // Determine position in 4-quadrant system
    const trustAxis = emotions.trust >= 0 ? 'high_trust' : 'low_trust';
    const formalityAxis = emotions.formality >= 0 ? 'formal' : 'casual';
    const helpfulnessAxis = emotions.helpfulness >= 0 ? 'helpful' : 'dismissive';
    const humorAxis = emotions.humor >= 0 ? 'playful' : 'serious';

    return {
      trustAxis,
      formalityAxis,
      helpfulnessAxis,
      humorAxis,

      // Combined quadrant for behavior logic
      primary: `${trustAxis}_${formalityAxis}`,
      secondary: `${helpfulnessAxis}_${humorAxis}`
    };
  }

  // ========================================
  // STATISTICS & REPORTING
  // ========================================

  getUserStats(userId) {
    const relationship = this.getOrCreateRelationship(userId);

    return {
      username: relationship.username,
      firstSeen: relationship.firstSeen,
      lastSeen: relationship.lastSeen,
      messageCount: relationship.messageCount,
      emotions: relationship.emotions,
      flags: relationship.flags,
      stats: relationship.stats,
      recentHistory: relationship.history.slice(-10) // Last 10 interactions
    };
  }

  getAllUsers() {
    return Object.values(this.relationships).map(rel => ({
      userId: rel.userId,
      username: rel.username,
      messageCount: rel.messageCount,
      lastSeen: rel.lastSeen,
      emotions: rel.emotions
    }));
  }

  getMostEngagedUsers(limit = 10) {
    return Object.values(this.relationships)
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, limit)
      .map(rel => ({
        username: rel.username,
        messageCount: rel.messageCount,
        trust: rel.emotions.trust.toFixed(0),
        helpfulness: rel.emotions.helpfulness.toFixed(0)
      }));
  }

  // ========================================
  // RELATIONSHIP REPAIR
  // ========================================

  detectApologyIntent(message) {
    const apologyPatterns = [
      /sorry/i,
      /apologize/i,
      /my bad/i,
      /my fault/i,
      /didn'?t mean to/i,
      /forgive me/i,
      /excuse me/i
    ];

    return apologyPatterns.some(pattern => pattern.test(message));
  }

  handleApology(userId) {
    console.log(`💙 User apologized, repairing relationship`);

    // Apology increases trust and makes bot more helpful again
    this.increaseTrust(userId, 15, 'apologized');
    this.increaseHelpfulness(userId, 15, 'apologized');
    this.makeMoreCasual(userId, 10, 'apologized');

    this.setFlag(userId, 'apologized', true);
    this.recordInteraction(userId, 'apology', { success: true });
  }

  // ========================================
  // SMART BEHAVIOR SUGGESTIONS
  // ========================================

  suggestBehavior(userId, context = '') {
    const personality = this.getPersonalityModifiers(userId);
    const relationship = this.getOrCreateRelationship(userId);

    const suggestions = [];

    // Suggest making a joke
    if (personality.shouldJoke && !relationship.flags.madeJoke) {
      suggestions.push({
        type: 'joke',
        reason: 'User appreciates humor, consider adding a HIVE-related pun'
      });
    }

    // Suggest referencing past conversation
    if (personality.shouldReferencePastConversations && relationship.history.length > 10) {
      const recentTopics = relationship.history
        .slice(-10)
        .map(h => h.category)
        .filter((v, i, a) => a.indexOf(v) === i);

      suggestions.push({
        type: 'reference_past',
        reason: `User has high trust, consider referencing: ${recentTopics.join(', ')}`
      });
    }

    // Suggest apologizing
    if (personality.shouldApologize) {
      suggestions.push({
        type: 'apologize',
        reason: 'User has complained and lost trust, bot should acknowledge mistakes'
      });
    }

    // Suggest whale treatment
    if (relationship.flags.isWhale) {
      suggestions.push({
        type: 'vip_treatment',
        reason: 'User holds significant VKBT/CURE, treat as VIP'
      });
    }

    return suggestions;
  }
}

// ========================================
// EXPORT
// ========================================

module.exports = {
  RelationshipTracker,
  EMOTIONAL_AXES
};
