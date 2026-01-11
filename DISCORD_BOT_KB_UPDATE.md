# Discord Bot - Knowledge Base Integration

## Current Problem
The Cryptology system has hardcoded dialogue trees in `index.js` around line 648.

## Solution
Replace hardcoded data with live knowledge base queries.

---

## Step 1: Install node-fetch

```bash
cd /home/user/Bot
npm install node-fetch@2
```

## Step 2: Update index.js

### A. Add KB integration at top of file (after other imports)

Find this line (around line 17):
```javascript
import NodeCache from 'node-cache';
```

Add after it:
```javascript
import { cryptologyKB } from './cryptology-kb-integration.js';
```

### B. Replace hardcoded cryptologyDialogues

Find this section (around line 648):
```javascript
const cryptologyDialogues = {
  triggers: {
    nephilim: ['nephilim', 'giants', 'watchers', 'book of enoch'],
    // ... etc
  },
  trees: {
    // ... hardcoded dialogue data
  }
};
```

Replace the ENTIRE `cryptologyDialogues` object with:

```javascript
// ========================================
// CRYPT-OLOGY: KNOWLEDGE BASE BACKED
// ========================================
// Dynamically query knowledge base instead of hardcoded data

const cryptologyDialogues = {
  // Keep triggers for keyword detection
  triggers: {
    nephilim: ['nephilim', 'giants', 'watchers', 'book of enoch'],
    phoenicians: ['phoenician', 'carthage', 'punic', 'phaikian'],
    angels: ['angel', 'archangel', 'seraphim', 'cherubim'],
    egypt: ['hathor', 'egypt', 'osiris', 'isis', 'ra'],
    denisovans: ['denisovan', 'denisova', 'ancient human', 'human origins'],
    greece: ['zeus', 'athena', 'olympus', 'greek god', 'apollo'],
    bible: ['bible', 'genesis', 'scripture', 'biblical'],
    vankush: ['van kush', 'vkbt', 'cure', 'family'],
    defi: ['defi', 'swap', 'liquidity', 'amm', 'dex'],
    hive: ['hive', 'steem', 'blurt', 'scot'],
    karma: ['karma', 'merit', 'dao', 'governance']
  },

  // Trees will be built dynamically from KB
  trees: {},

  // KB query method
  async queryTopic(topic) {
    try {
      const result = await cryptologyKB.getDialogueContent(topic);
      return result;
    } catch (error) {
      console.error('❌ KB query failed:', error.message);
      return null;
    }
  },

  // Get topics from KB
  async getAvailableTopics() {
    try {
      const topics = await cryptologyKB.getMainMenuTopics();
      return topics;
    } catch (error) {
      console.error('❌ Failed to get topics from KB:', error.message);
      return [];
    }
  }
};
```

### C. Update createDialogueButtons function

Find this function (around line 805):
```javascript
function createDialogueButtons(dialogueKey) {
  const dialogue = cryptologyDialogues.trees[dialogueKey];
  if (!dialogue) return null;
  // ... rest
}
```

Replace with:
```javascript
async function createDialogueButtons(dialogueKey) {
  // Query KB for this topic
  const kbData = await cryptologyDialogues.queryTopic(dialogueKey);

  if (!kbData) {
    return {
      intro: "I don't have information on that topic yet. Try asking about VKBT, CURE, or trading strategy!",
      rows: []
    };
  }

  const rows = [];
  let currentRow = new ActionRowBuilder();

  // Create buttons from KB suggestions
  if (kbData.suggestions && kbData.suggestions.length > 0) {
    for (let i = 0; i < Math.min(kbData.suggestions.length, 4); i++) {
      const suggestion = kbData.suggestions[i];

      currentRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`crypt_kb_${i}_${Date.now()}`)
          .setLabel(suggestion.substring(0, 30))
          .setStyle(ButtonStyle.Primary)
      );

      // Max 5 buttons per row
      if (currentRow.components.length === 5 || i === kbData.suggestions.length - 1) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }
    }
  }

  // Add back button
  if (currentRow.components.length < 5) {
    currentRow.addComponents(
      new ButtonBuilder()
        .setCustomId('crypt_back')
        .setLabel('⬅️ Back')
        .setStyle(ButtonStyle.Danger)
    );
    rows.push(currentRow);
  }

  return {
    intro: kbData.content,
    title: kbData.title,
    rows: rows
  };
}
```

### D. Update /cryptology command handler

Find this code (around line 1063):
```javascript
if (command === 'cryptology' || command === 'crypt' || command === 'explore') {
  const topic = args[1]?.toLowerCase();

  if (topic && cryptologyDialogues.trees[topic]) {
    // ... old code
  }
}
```

Replace with:
```javascript
if (command === 'cryptology' || command === 'crypt' || command === 'explore') {
  const topic = args[1]?.toLowerCase();

  if (topic) {
    // Query KB for this topic
    await message.channel.sendTyping();
    const buttonData = await createDialogueButtons(topic);

    if (buttonData.rows.length > 0) {
      await message.reply({
        content: `🔮 **Crypt-ology: ${buttonData.title || topic}**\n\n${buttonData.intro}`,
        components: buttonData.rows
      });
    } else {
      await message.reply(buttonData.intro);
    }
  } else {
    // Show main menu from KB categories
    const topics = await cryptologyDialogues.getAvailableTopics();

    const topicList = topics
      .map(t => `• **${t.label.toLowerCase()}** - ${t.count} documents`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle('🔮 Crypt-ology: Knowledge Base Explorer')
      .setDescription('Explore topics from the knowledge base. All content comes from imported Claude discussions and documentation!')
      .addFields(
        { name: '📖 Available Topics', value: topicList || 'Import Claude discussions to see topics!' },
        { name: '🎮 How to Use', value: 'Type `/cryptology [topic]` to explore\nExample: `/cryptology vkbt`\n\nOr just mention keywords in conversation!' }
      )
      .setFooter({ text: 'Powered by live knowledge base queries' });

    await message.reply({ embeds: [embed] });
  }
  return;
}
```

---

## Step 3: Update package.json

Make sure you have ES modules enabled. In `package.json`, add/verify:
```json
{
  "type": "module",
  "dependencies": {
    "node-fetch": "^2.7.0"
  }
}
```

---

## Step 4: Deploy Updated Bot

### Test Locally First:
```bash
# Make sure KB API is running
curl localhost:8765/stats

# Test bot locally
npm start
```

### Deploy to Railway:
```bash
git add -A
git commit -m "ADD: Knowledge base integration for Cryptology system

- Replace hardcoded dialogues with live KB queries
- Dynamic topic discovery from KB categories
- Pulls content from imported Claude discussions
- No more hardcoded data!"

git push origin claude/plan-itinerary-knowledge-base-Etb9c
```

Railway will auto-deploy.

---

## Step 5: Test in Discord

After deployment:

1. Import some Claude discussions:
```bash
python3 claude-discussion-scraper.py --dir claude_exports
```

2. Try in Discord:
```
/cryptology vkbt
/cryptology trading
/cryptology [topic from your Claude discussion]
```

The bot will now query the knowledge base and show real content!

---

## Benefits

✅ **No hardcoded data** - Everything from KB
✅ **Auto-updating** - Import new discussions, bot knows immediately
✅ **Dynamic topics** - Bot shows what's actually in KB
✅ **Claude discussions** - Bot can answer from your Claude chats
✅ **Scalable** - Add 1000 discussions, bot handles it

---

## Troubleshooting

**"I don't have information on that topic"**
- Check KB has content: `curl localhost:8765/stats`
- Import discussions: `python3 claude-discussion-scraper.py --dir claude_exports`
- Restart KB API

**"KB query failed"**
- Check KB API running: `curl localhost:8765/stats`
- Check Railway environment variable `KB_API_URL` is set
- Default is `http://localhost:8765`

**"No topics showing"**
- Import content first
- Check: `python3 knowledge-base.py --search "test"`
- Verify datasets/ has .jsonl files
