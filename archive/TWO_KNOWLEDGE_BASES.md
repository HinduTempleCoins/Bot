# Two Knowledge Bases: Claude Code vs Discord Bot

**Important distinction between context persistence and bot knowledge**

---

## 🎯 Two Different Purposes

### 1. **Claude Code Context** (for future Claude Code sessions)

**Purpose**: Save tokens by storing our conversation history

**Example**:
- Current session: "We built a trading bot with capital manager"
- Future session: Claude Code reads context, already knows about the bot
- **Saves**: 50,000+ tokens of re-explanation

**What to import**:
- ✅ Claude Code conversations (this session)
- ✅ Technical decisions we made
- ✅ Architecture discussions
- ✅ Implementation details
- ✅ Timeline and project status

**Goes into**: `datasets/claude_code_context.jsonl`

---

### 2. **Discord Bot Knowledge** (for Discord bot to answer users)

**Purpose**: Let Discord bot answer questions about Van Kush Family

**Example**:
- User in Discord: "What is VKBT?"
- Bot queries knowledge base
- Bot replies: "VKBT is a cryptocurrency token..."

**What to import**:
- ✅ Your regular Claude Chat discussions about VKBT/CURE
- ✅ Van Kush Family history and lore
- ✅ Token strategy and plans
- ✅ Public information users should know
- ❌ NOT technical implementation details
- ❌ NOT sensitive conversations

**Goes into**: `datasets/discord_bot_knowledge.jsonl`

---

## 📚 How to Import Each

### For Claude Code Context (this conversation):

```bash
# 1. Copy THIS conversation from Claude Code
# 2. Save to file
cat > jan10-claude-code-session.txt
# Paste conversation
# Ctrl+D

# 3. Curate it (sanitizes keys, auto-categorizes)
python3 curate-knowledge.py \
  --file "jan10-claude-code-session.txt" \
  --title "Trading Bot + Knowledge Base Build - Jan 10 2026" \
  --preview

# Goes to: datasets/claude_code_context.jsonl
```

**When to use**: After each significant Claude Code session

**Benefit**: Next Claude Code session starts with full context, saves tokens

---

### For Discord Bot Knowledge (regular Claude Chat):

```bash
# 1. Export your Claude CHAT discussion (not Claude Code)
#    Topic: "What is Van Kush Family and VKBT?"
# 2. Save to file
cat > vkbt-explanation.txt
# Paste from Claude Chat
# Ctrl+D

# 3. Curate it for Discord bot
python3 curate-knowledge.py \
  --file "vkbt-explanation.txt" \
  --title "VKBT Token Explanation" \
  --for-discord \
  --preview

# Goes to: datasets/discord_bot_knowledge.jsonl
```

**When to use**: After discussing Van Kush topics in regular Claude Chat

**Benefit**: Discord bot can answer user questions without hardcoded responses

---

## 🔍 What Gets Saved Where

| Content Type | Claude Code Context | Discord Bot Knowledge |
|--------------|--------------------|-----------------------|
| Trading bot implementation | ✅ Yes | ❌ No (too technical) |
| Capital manager logic | ✅ Yes | ❌ No (implementation detail) |
| VKBT token explanation | ❌ No (not relevant) | ✅ Yes (users ask this) |
| Van Kush Family history | Maybe | ✅ Yes |
| Timeline (Jan-Feb-March) | ✅ Yes | ✅ Yes (simplified) |
| API keys/credentials | ❌ NEVER | ❌ NEVER |
| Architecture decisions | ✅ Yes | ❌ No |
| Token strategy (public) | ❌ No | ✅ Yes |
| Technical problems solved | ✅ Yes | ❌ No |

---

## 🛠️ Curation Tool Features

### Auto-Sanitization:
- Removes HIVE keys (5Jxxx...)
- Removes API keys
- Removes sensitive credentials

### Auto-Categorization:
- Detects if about VKBT/CURE → `token-strategy`
- Detects if about Discord → `discord-bot`
- Detects if about trading → `trading-bot`
- Detects if about timeline → `project-planning`

### Preview Before Save:
```bash
python3 curate-knowledge.py \
  --file "conversation.txt" \
  --title "My Discussion" \
  --preview  # Shows preview, asks for confirmation
```

---

## 📖 Example Workflows

### Workflow 1: End of Claude Code Session

**Goal**: Save context for next session

```bash
# 1. Export current Claude Code conversation
#    (Copy all text from this session)

# 2. Save and curate
cat > todays-work.txt
# Paste
# Ctrl+D

python3 curate-knowledge.py \
  --file "todays-work.txt" \
  --title "$(date +%Y-%m-%d) - Trading Bot Development" \
  --category "trading-bot"

# 3. Verify
python3 knowledge-base.py --search "capital manager"
```

**Next session**: Claude Code reads `claude_code_context.jsonl`, knows what we built

---

### Workflow 2: Regular Claude Chat About Van Kush

**Goal**: Teach Discord bot about Van Kush Family

```bash
# In regular Claude Chat, ask:
# "Explain the Van Kush Family project, VKBT, and CURE tokens"

# 1. Copy Claude's response

# 2. Save and curate for Discord
cat > van-kush-explanation.txt
# Paste Claude's explanation
# Ctrl+D

python3 curate-knowledge.py \
  --file "van-kush-explanation.txt" \
  --title "Van Kush Family Overview" \
  --for-discord \
  --category "van-kush-family"

# 3. Test Discord bot query
python3 knowledge-base.py --datasets-dir datasets --serve &
curl "http://localhost:8765/query?q=what+is+van+kush+family"
```

**Result**: Discord bot can now explain Van Kush Family to users

---

## 🎯 Categories for Each Purpose

### Claude Code Context Categories:
- `trading-bot` - Bot implementation
- `capital-management` - Fund management logic
- `knowledge-base` - This system
- `discord-bot` - Discord bot code
- `project-planning` - Timeline, tasks, status

### Discord Bot Knowledge Categories:
- `van-kush-family` - Project overview
- `vkbt-token` - VKBT explanation
- `cure-token` - CURE explanation
- `token-strategy` - Public strategy info
- `hive-ecosystem` - HIVE blockchain info
- `faq` - Common questions

---

## 🔄 Keeping Both Updated

### Daily (if actively developing):

```bash
# End of day: Save Claude Code session
cat > sessions/$(date +%Y-%m-%d)-work.txt
# Paste day's work
# Ctrl+D

python3 curate-knowledge.py \
  --file "sessions/$(date +%Y-%m-%d)-work.txt" \
  --title "$(date +%Y-%m-%d) - Development Log"
```

### Weekly (for Discord bot):

```bash
# Review what users might ask about
# Create curated Q&A in Claude Chat
# Import those explanations

python3 curate-knowledge.py \
  --file "weekly-updates.txt" \
  --title "Van Kush Updates - Week of $(date +%Y-%m-%d)" \
  --for-discord
```

---

## 🤖 Discord Bot Integration

### Query Claude Code Context:
```javascript
// For debugging/development
const context = await queryKnowledgeBase('capital manager implementation');
// Returns: Technical details of how capital manager works
```

### Query Discord Bot Knowledge:
```javascript
// For user questions
const answer = await queryKnowledgeBase('what is VKBT', {
  category: 'vkbt-token',
  for_discord: true
});
message.reply(answer);
// Returns: User-friendly explanation
```

---

## 📊 Current Status

### Already Created:
- ✅ `datasets/vkbt_cure_knowledge.jsonl` (17 docs, for Discord bot)
- ✅ Curation tool (`curate-knowledge.py`)
- ✅ Security (datasets/ in .gitignore)

### Next Steps:
1. Import THIS conversation → `claude_code_context.jsonl`
2. Create Discord bot knowledge from your regular Claude Chats
3. Connect Discord bot to query `discord_bot_knowledge.jsonl`

---

## 💡 Pro Tips

### For Claude Code Context:
- Import ALL significant sessions
- Include problems encountered and solutions
- Include architecture decisions and why
- Include timeline and status updates
- **Don't worry about length** - more context = better

### For Discord Bot Knowledge:
- Keep explanations user-friendly
- Focus on "what" and "why", not "how"
- Organize as Q&A format when possible
- Test what users actually ask
- **Keep it concise** - users want quick answers

---

## ✅ Summary

**Two separate knowledge bases:**

1. **Claude Code Context**
   - File: `claude_code_context.jsonl`
   - Purpose: Save tokens in future Claude Code sessions
   - Content: Technical implementation, decisions, status
   - Source: THIS conversation and future Claude Code sessions

2. **Discord Bot Knowledge**
   - File: `discord_bot_knowledge.jsonl`
   - Purpose: Answer user questions in Discord
   - Content: Public information, explanations, FAQs
   - Source: Regular Claude Chat discussions

**Import commands:**

```bash
# For Claude Code context
python3 curate-knowledge.py --file "session.txt" --title "Title"

# For Discord bot
python3 curate-knowledge.py --file "chat.txt" --title "Title" --for-discord
```

**Both are protected by .gitignore and stay LOCAL!**

---

**Start building both knowledge bases to maximize efficiency!** 🚀
