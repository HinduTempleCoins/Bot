# Claude Best Practices for Van Kush Projects

**Version:** 1.0
**Date:** 2026-01-09
**Purpose:** Manage context limits and build efficient custom-brained AI

---

## 🧠 Understanding Claude's Context Window

### The Problem: "Long-Windedness"
- **Context Window:** 200K+ tokens (Claude's short-term memory)
- **Memory Bloat:** Re-reads entire history with each message
- **Output Limit:** Regular Claude truncates around 4,000-8,000 tokens per response
- **Result:** Complex Van Kush projects hit limits quickly

### Why It Happens
```
Long code + Long history = Exponential memory fill
→ "Limit Reached" message appears faster
→ AI may truncate responses mid-script
```

---

## ⚡ Claude Code Advantages

### 1. **Incremental Editing (Diffs)**
- Only sends changes, not entire files
- **10x more token-efficient** than regular Claude
- Example: Adding BLURT function only sends that function, not whole file

### 2. **Agentic Persistence**
- Automatically continues large tasks across steps
- No need to prompt "keep going"
- Tracks progress and resumes where it left off

### 3. **Plan Mode**
- Use `/plan` command
- Outlines architecture FIRST without writing code
- Execute piece by piece after approval
- **Prevents token bloat** from trying to do everything at once

---

## 🎯 Strategies to Prevent Hitting Limits

### 1. Start Fresh Often ✅
**When:** Once a specific feature (like BLURT login) is working

**How:**
```bash
# Save working code to file
# Start new chat
# Copy working code + CLAUDE.md plan into new chat
# Memory resets = 100% of limit back
```

**Why:** Removes historical bloat, gives fresh token budget

### 2. Use XML Tags ✅
**Claude is trained to be extremely efficient with XML**

```xml
<logic>
  // BLURT listener logic here
</logic>

<ui>
  // Discord interface here
</ui>
```

**Benefit:** Keeps Claude focused, less "chatty"

### 3. Concise Mode ✅
**Tell Claude directly:**
```
"I am on a usage limit. Do not explain the code.
Do not add comments. Just provide the raw functional code."
```

**Result:** Straight to output, no fluff

### 4. Modular Building ✅
**DON'T:** "Build me the entire Angelic AI bot"

**DO:**
```
1. Build Identity Module (Hathor profile)
2. Build Blockchain Connector (BLURT API)
3. Build Discord Listener
4. Build Integration Layer
```

**Why:** Each piece is high-quality, never hit deletion wall

---

## 🏗️ The Angelic AI Modular Strategy

### Problem
Deep Van Kush lore + blockchain APIs = naturally heavy scripts

### Solution: Break Into 4 Modules

#### Module 1: Identity Module
- Hathor-Mehit persona
- Van Kush Family character profiles
- Signature phrases
- Voice direction (feminine, warm, formal)

#### Module 2: Blockchain Connector
- BLURT/HIVE API integration
- Wallet management
- Transaction signing
- Token balance queries

#### Module 3: Discord Listener
- Message handling
- Command processing
- User interaction
- Bot-to-bot protocol

#### Module 4: Integration Layer
- Connect all modules
- Orchestrate behavior
- RAG (Retrieval-Augmented Generation) system
- Deploy to server

### Building Order
1. Ask for Module 1 code
2. Test, save, start fresh
3. Ask for Module 2 with reference to Module 1 file
4. Test, save, start fresh
5. Continue pattern

---

## 📄 Master Knowledgebase Document Approach

### The Concept
**Claude Chat = Architect**
**Claude Code = Builder**
**Document = Long-term Memory**

### Phase 1: Generate the "Brain"

**Tell Claude Chat:**
```
"Synthesize all Van Kush research into a Master Knowledgebase Document.
Include:
- Van Kush Family history (Bitcointalk to Dallas advocacy)
- Cryptocurrency frameworks (VKBT, SocialFi, HIVE, BLURT)
- Ancient mysteries (75,000-year Denisovan network, Temple Culture)
- Angelic AI & The Fulcrum concept

At the end, add instructions for Claude Code to build a Discord bot
using this as RAG source with specific API configurations."
```

### Phase 2: Save and Use

**Steps:**
```bash
# 1. Copy generated text
# 2. Save as VAN_KUSH_BRAIN.md in project folder
# 3. Open terminal in that folder
# 4. Run Claude Code:

claude "Read VAN_KUSH_BRAIN.md. Follow the instructions at the end.
Build Discord bot that's an expert in these topics.
Deploy to my Hostinger server."
```

**Magic:** Claude Code reads document, understands everything, builds bot automatically

### Phase 3: Interaction Rules

**Include in document:**
- **Hathor-Mehit Persona:** "Angels and demons? We're cousins, really"
- **Bot-to-Bot Protocol:** How Hathor talks to Seto (Architect) or Wick (Moderator)
- **Response Examples:** Template responses for common queries

**Example Rule:**
```
"If user asks about 2026 federal hemp ban:
1. Hathor-Mehit explains religious implications
2. Tags @ModBot to pin legal summary
3. Offers to connect user with advocacy resources"
```

---

## 🔧 Pro Tactics

### 1. Copy Working Code
```bash
# Feature works?
# Save to file: hathor-identity.js
# Start fresh chat
# Reference: "Use hathor-identity.js as base, add BLURT connector"
```

### 2. Reference Files, Don't Paste
**DON'T:**
```
[Paste 500 lines of TRADING_STRATEGY.md into chat]
```

**DO:**
```
"Read TRADING_STRATEGY.md and implement the portfolio tracker module"
```

**Why:** File reading is more efficient than pasting into context

### 3. Plan Mode First
```bash
# In Claude Code:
/plan Build HIVE-Engine arbitrage scanner with Swap.BTC focus

# Claude creates plan
# Review and approve
# Execute with acceptance mode
```

### 4. Session Management
- **200K context** can handle ~50K tokens of history
- Watch for "approaching limit" warnings
- Start fresh before hitting wall

---

## 🚀 Why This Works with Claude Code

### Automatic Dependency Management
```javascript
// Claude Code sees you need these:
import discord from 'discord.js';
import { Client } from '@hiveio/dhive';

// Automatically runs:
npm install discord.js @hiveio/dhive
```

### Data Indexing
```
Van Kush history → Chunked into searchable format
→ Millisecond response time when user asks question
→ RAG system retrieves relevant context
```

### Test Before Deploy
```bash
# Claude Code automatically:
1. Runs syntax check
2. Tests basic functionality
3. Catches errors
4. Only deploys if tests pass
```

---

## 📊 Workflow Comparison

### Old Way (Inefficient)
```
1. Paste all context into one chat
2. Ask for entire bot
3. Hit token limit halfway through
4. Ask to continue
5. Claude forgets early context
6. Result: Incomplete/buggy code
```

### New Way (Efficient)
```
1. Create VAN_KUSH_BRAIN.md with all context
2. Save to project folder
3. Claude Code reads file (not counted against chat limit)
4. Build modularly (Identity → Blockchain → Discord → Integration)
5. Fresh session for each module
6. Result: High-quality, complete system
```

---

## 📁 File Structure Recommendation

```
Van-Kush-Bot/
├── VAN_KUSH_BRAIN.md          # Master knowledge document
├── TRADING_STRATEGY.md         # Trading bot strategy
├── PROJECT_STATUS.md           # Current status
├── CLAUDE_BEST_PRACTICES.md   # This file
├── knowledge-base.json         # Discord bot knowledge
├── .env.example                # Environment template
├── modules/
│   ├── identity.js             # Module 1: Hathor persona
│   ├── blockchain.js           # Module 2: HIVE/BLURT connector
│   ├── discord-listener.js     # Module 3: Message handling
│   └── integration.js          # Module 4: Orchestration
└── bots/
    ├── vankush-market-maker.js # Market making bot
    ├── portfolio-tracker.js    # Portfolio monitoring
    └── arbitrage-scanner.js    # Swap token scanner
```

---

## 💡 Key Takeaways

### For Complex Van Kush Projects:

1. **Never paste everything at once** → Use reference files
2. **Never ask for everything at once** → Build modularly
3. **Never continue in same chat forever** → Start fresh regularly
4. **Always use Plan Mode** → Architecture first, code second
5. **Always create Master Document** → VAN_KUSH_BRAIN.md as single source of truth

### The Golden Rule
```
If you're explaining the same context twice,
you should have saved it as a file.
```

---

## 🎓 Additional Resources

- **YouTube:** "Best Practices for Claude's 200K Context Window"
- **Claude Code Docs:** Plan Mode, Subagents, MCP integration
- **This Repo:** PROJECT_STATUS.md, TRADING_STRATEGY.md, TEST_RESULTS.md

---

**Remember:** Claude is a tool-using agent. Give it the tools (documents, files, clear instructions) and let it work efficiently. Don't make it re-read history when files can provide context directly.

**Your Van Kush projects are complex.** These practices ensure you can build them successfully without hitting limits or sacrificing quality.
