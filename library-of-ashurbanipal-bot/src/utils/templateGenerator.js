/**
 * Template-based Article Generator (No API required)
 *
 * Generates wiki articles directly from knowledge base content
 * when external AI APIs are unavailable.
 */

class TemplateGenerator {
  constructor() {
    this.templates = {
      default: this.defaultTemplate,
      oilahuasca: this.oilahuascaTemplate,
      compound: this.compoundTemplate,
      history: this.historyTemplate
    };
  }

  /**
   * Generate article from knowledge base content without AI
   */
  synthesizeArticle(topic, context) {
    const template = this.selectTemplate(topic);
    return template.call(this, topic, context);
  }

  selectTemplate(topic) {
    const topicLower = topic.toLowerCase();
    if (topicLower.includes('oilahuasca') || topicLower.includes('space paste')) {
      return this.oilahuascaTemplate;
    }
    if (topicLower.includes('pihkal') || topicLower.includes('tihkal') || topicLower.includes('compound')) {
      return this.compoundTemplate;
    }
    return this.defaultTemplate;
  }

  defaultTemplate(topic, context) {
    let article = `= ${topic} =\n\n`;

    // Introduction from primary sources
    if (context.primary && context.primary.length > 0) {
      article += `'''${topic}''' is a subject documented in the Van Kush Family Research Institute archives.\n\n`;

      article += `== Overview ==\n`;
      const firstExcerpt = context.primary[0]?.excerpt || '';
      article += this.cleanExcerpt(firstExcerpt, 500) + '\n\n';
    }

    // Main content from all sources
    if (context.primary && context.primary.length > 1) {
      article += `== Research Findings ==\n`;
      for (let i = 1; i < Math.min(context.primary.length, 4); i++) {
        const source = context.primary[i];
        article += `=== From ${source.domain} ===\n`;
        article += this.cleanExcerpt(source.excerpt, 400) + '\n\n';
      }
    }

    // Related topics
    if (context.related && context.related.length > 0) {
      article += `== Related Topics ==\n`;
      for (const rel of context.related.slice(0, 3)) {
        article += `* [[${rel.domain}]] - ${rel.connection}\n`;
      }
      article += '\n';
    }

    // Connections to core topics
    article += `== Connections to Core Research ==\n`;
    article += `This topic relates to the broader Van Kush Family Research Institute framework through:\n`;
    article += `* [[Oilahuasca]] - Essential oil psychedelic research\n`;
    article += `* [[Egyptian Wax Headcones]] - Ancient consciousness technology\n`;
    article += `* [[Shulgin Ten Essential Oils]] - PIHKAL/TIHKAL connections\n\n`;

    // References
    article += `== References ==\n`;
    if (context.primary) {
      for (const source of context.primary) {
        article += `* ${source.id} (${source.domain})\n`;
      }
    }

    article += `\n[[Category:Van Kush Research]]\n`;

    return article;
  }

  oilahuascaTemplate(topic, context) {
    let article = `= ${topic} =\n\n`;

    article += `'''${topic}''' represents core research from the Van Kush Family Research Institute into essential oil-based psychedelic experiences.\n\n`;

    article += `== Theory ==\n`;
    if (context.primary && context.primary.length > 0) {
      article += this.cleanExcerpt(context.primary[0]?.excerpt, 600) + '\n\n';
    }

    article += `== Connection to Shulgin Research ==\n`;
    article += `Alexander Shulgin's research on essential oils, documented in PIHKAL, identified key allylbenzene compounds:\n`;
    article += `* '''Myristicin''' (nutmeg) → metabolizes to [[MMDA]]\n`;
    article += `* '''Elemicin''' (nutmeg) → metabolizes to [[TMA]]\n`;
    article += `* '''Safrole''' (sassafras) → precursor to [[MDA]]\n\n`;

    article += `== Practical Applications ==\n`;
    if (context.primary && context.primary.length > 1) {
      article += this.cleanExcerpt(context.primary[1]?.excerpt, 500) + '\n\n';
    }

    article += `== See Also ==\n`;
    article += `* [[Space Paste]]\n`;
    article += `* [[Egyptian Wax Headcones]]\n`;
    article += `* [[Kyphi]]\n`;
    article += `* [[PIHKAL Compounds]]\n\n`;

    article += `== References ==\n`;
    if (context.primary) {
      for (const source of context.primary.slice(0, 5)) {
        article += `* ${source.id}<ref>${source.domain}/${source.id}</ref>\n`;
      }
    }

    article += `\n[[Category:Oilahuasca Research]]\n[[Category:Van Kush Research]]\n`;

    return article;
  }

  compoundTemplate(topic, context) {
    let article = `= ${topic} =\n\n`;

    article += `'''${topic}''' is documented in the Shulgin archives of the Van Kush Family Research Institute.\n\n`;

    article += `== Overview ==\n`;
    if (context.primary && context.primary.length > 0) {
      article += this.cleanExcerpt(context.primary[0]?.excerpt, 600) + '\n\n';
    }

    article += `== Structure-Activity Relationships ==\n`;
    if (context.primary && context.primary.length > 1) {
      article += this.cleanExcerpt(context.primary[1]?.excerpt, 400) + '\n\n';
    }

    article += `== Connection to Oilahuasca ==\n`;
    article += `These compounds relate to the [[Oilahuasca]] research through the allylbenzene metabolism pathway.\n\n`;

    article += `== See Also ==\n`;
    article += `* [[Oilahuasca]]\n`;
    article += `* [[Shulgin Ten Essential Oils]]\n`;
    article += `* [[CYP450 Enzyme System]]\n\n`;

    article += `== References ==\n`;
    if (context.primary) {
      for (const source of context.primary.slice(0, 5)) {
        article += `* ${source.id}<ref>${source.domain}/${source.id}</ref>\n`;
      }
    }

    article += `\n[[Category:PIHKAL]]\n[[Category:Shulgin Research]]\n`;

    return article;
  }

  historyTemplate(topic, context) {
    let article = `= ${topic} =\n\n`;
    article += `'''${topic}''' is part of the historical research documented by the Van Kush Family Research Institute.\n\n`;

    if (context.primary && context.primary.length > 0) {
      article += `== Historical Background ==\n`;
      article += this.cleanExcerpt(context.primary[0]?.excerpt, 800) + '\n\n';
    }

    article += `== See Also ==\n`;
    article += `* [[Van Kush Family Research Institute]]\n`;
    article += `* [[Phoenician Consciousness Technology]]\n\n`;

    article += `\n[[Category:History]]\n[[Category:Van Kush Research]]\n`;

    return article;
  }

  cleanExcerpt(text, maxLength = 500) {
    if (!text) return '';

    // Remove JSON-like formatting
    let cleaned = text
      .replace(/[{}"]/g, '')
      .replace(/\\n/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned.length > maxLength) {
      cleaned = cleaned.slice(0, maxLength);
      const lastPeriod = cleaned.lastIndexOf('.');
      if (lastPeriod > maxLength * 0.7) {
        cleaned = cleaned.slice(0, lastPeriod + 1);
      } else {
        cleaned += '...';
      }
    }

    return cleaned;
  }
}

export default TemplateGenerator;
