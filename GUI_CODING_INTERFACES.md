# GUI Coding Interfaces Setup Guide

**Goal**: Set up Claude Code-like interfaces (GUI, conversational, file editing) using free AI models

**What You Want**:
- ❌ NOT terminal commands like `gchat` or `dcode`
- ✅ GUI interfaces like Claude Code where you chat and AI edits files
- ✅ Works remotely (from phone, anywhere)
- ✅ Uses Gemini API or DeepSeek Coder (free/unlimited)

**Best Solutions**:
1. **Continue.dev** - Works EXACTLY like Claude Code (in VS Code)
2. **Open WebUI** - ChatGPT-like web interface for DeepSeek
3. **Code-Server** - VS Code in your browser (access from anywhere)
4. **Aider** - Chat interface that directly edits your files

---

## Part 1: Continue.dev (BEST - Exact Claude Code Clone)

**This is what you want!** Works EXACTLY like Claude Code but uses Gemini/DeepSeek.

### What is Continue.dev?

- VS Code extension (official app, not terminal)
- Sidebar chat interface (like Claude Code)
- AI can read/edit your files
- Supports **any model**: Gemini, DeepSeek, GPT, Claude
- **Completely free** if using Gemini API or local DeepSeek

### Step 1: Install VS Code (if needed)

**Windows**:
1. Go to: https://code.visualstudio.com/
2. Download and install
3. Open VS Code

**On Oracle Cloud Server** (for remote access):
```bash
# We'll use Code-Server (VS Code in browser) - see Part 3
```

### Step 2: Install Continue Extension

**In VS Code**:
1. Click **Extensions** icon (left sidebar) or press `Ctrl+Shift+X`
2. Search: **"Continue"**
3. Find **"Continue - Codestral, Claude, and more"**
4. Click **"Install"**
5. Wait for installation
6. Click **"Reload"** if prompted

**You'll see a new Continue icon in left sidebar!** 🎉

### Step 3: Configure for Gemini API (Free)

1. Click the **Continue icon** in sidebar
2. Click **gear icon** ⚙️ (settings) at bottom
3. Opens `config.json` file
4. **Replace entire content** with this:

```json
{
  "models": [
    {
      "title": "Gemini 2.5 Flash",
      "provider": "gemini",
      "model": "gemini-2.5-flash-lite",
      "apiKey": "YOUR_GEMINI_API_KEY_HERE"
    }
  ],
  "tabAutocompleteModel": {
    "title": "DeepSeek Coder",
    "provider": "ollama",
    "model": "deepseek-coder-v2:16b"
  },
  "embeddingsProvider": {
    "provider": "ollama",
    "model": "nomic-embed-text"
  },
  "customCommands": [
    {
      "name": "test",
      "prompt": "Write unit tests for this code",
      "description": "Generate unit tests"
    },
    {
      "name": "comment",
      "prompt": "Add detailed comments explaining this code",
      "description": "Add comments"
    },
    {
      "name": "fix",
      "prompt": "Find and fix any bugs in this code",
      "description": "Debug code"
    }
  ],
  "contextProviders": [
    {
      "name": "code",
      "params": {}
    },
    {
      "name": "docs",
      "params": {}
    },
    {
      "name": "diff",
      "params": {}
    },
    {
      "name": "terminal",
      "params": {}
    },
    {
      "name": "problems",
      "params": {}
    },
    {
      "name": "folder",
      "params": {}
    },
    {
      "name": "codebase",
      "params": {}
    }
  ],
  "slashCommands": [
    {
      "name": "edit",
      "description": "Edit selected code"
    },
    {
      "name": "comment",
      "description": "Add comments"
    },
    {
      "name": "share",
      "description": "Export conversation"
    },
    {
      "name": "cmd",
      "description": "Generate shell command"
    },
    {
      "name": "commit",
      "description": "Generate commit message"
    }
  ]
}
```

**Save**: `Ctrl+S`

**Replace** `YOUR_GEMINI_API_KEY_HERE` with your actual Gemini API key.

### Step 4: Use Continue (Like Claude Code!)

**Open your Bot folder**:
1. File → Open Folder
2. Navigate to `~/Bot` (or wherever your code is)
3. Click "Select Folder"

**Chat with AI**:
1. Click **Continue icon** in left sidebar
2. Type in chat box: **"Explain what index.js does"**
3. AI reads the file and explains!

**Edit files**:
1. Open `index.js` in editor
2. Select some code
3. In Continue chat: **"Refactor this function to be more readable"**
4. AI suggests changes with **Accept/Reject buttons**!

**Commands (just like Claude Code)**:
```
/edit Add error handling to this function
/comment Add JSDoc comments to this code
/fix Debug why this function isn't working
/cmd Write a bash command to list all .js files
/commit Generate a commit message for staged changes
```

**Keyboard shortcuts**:
- `Ctrl+L` - Focus chat input
- `Ctrl+I` - Quick edit (inline)
- `Ctrl+Shift+R` - Refactor selection

**This is EXACTLY like Claude Code, but free!** 🎉

---

## Part 2: Open WebUI (ChatGPT-Style Interface)

**Web interface that looks like ChatGPT but uses your local DeepSeek Coder**

### What is Open WebUI?

- Beautiful web interface (like ChatGPT)
- Works with Ollama (your DeepSeek model)
- Access from any device (computer, phone, tablet)
- Completely private (runs on your server)
- Supports file uploads, image generation, voice

### Step 1: Install with Docker (on Oracle Cloud)

```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP

# Make sure Ollama is running
sudo systemctl status ollama

# Install Open WebUI
docker run -d -p 3000:8080 \
  --add-host=host.docker.internal:host-gateway \
  -v open-webui:/app/backend/data \
  --name open-webui \
  --restart always \
  ghcr.io/open-webui/open-webui:main
```

**Wait 1-2 minutes for container to start.**

### Step 2: Open Firewall Port

```bash
sudo ufw allow 3000/tcp
```

### Step 3: Access Open WebUI

**From your computer**:
1. Open browser
2. Go to: `http://YOUR_ORACLE_IP:3000`
3. You'll see a **signup page**
4. Create account (stored locally on your server):
   - Email: `you@example.com` (fake is fine)
   - Username: `vankush`
   - Password: (your choice)
5. Click **"Sign Up"**

**You're in!** 🎉

### Step 4: Connect to DeepSeek Model

1. Click **"Select a model"** dropdown (top)
2. You should see **"deepseek-coder-v2:16b"**
3. Select it
4. Start chatting!

**Example conversation**:
```
You: Write a Python function to check if a number is prime

AI: [Generates code]

You: Now add unit tests for it

AI: [Generates tests]

You: Save this to prime.py
```

**Features**:
- **Upload files**: Click 📎 to attach code files for analysis
- **Code formatting**: All code is syntax highlighted
- **Copy button**: Easy copy of code blocks
- **Regenerate**: Don't like response? Regenerate!
- **Edit messages**: Edit your past messages to refine
- **Multiple chats**: Create different chats for different projects

### Step 5: Access from Phone

**Same URL**: `http://YOUR_ORACLE_IP:3000`

**Works on**:
- iPhone Safari
- Android Chrome
- Any mobile browser

**Add to home screen**:
1. Open in mobile browser
2. Tap "Share" → "Add to Home Screen"
3. Now it looks like a native app!

---

## Part 3: Code-Server (VS Code in Browser)

**Full VS Code running in your browser - access from anywhere including phone!**

### What is Code-Server?

- Real VS Code, in your browser
- Works with Continue.dev extension
- Access from any device
- Persistent (files saved on server)
- Perfect for coding from phone

### Step 1: Install Code-Server (on Oracle Cloud)

```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP

# Install code-server
curl -fsSL https://code-server.dev/install.sh | sh

# Start code-server
code-server --bind-addr 0.0.0.0:8080 --auth password
```

**It will show**:
```
[2026-01-08T20:00:00.000Z] info  HTTP server listening on http://0.0.0.0:8080
[2026-01-08T20:00:00.000Z] info    - Authentication is enabled
[2026-01-08T20:00:00.000Z] info      - Using password from ~/.config/code-server/config.yaml
```

### Step 2: Get Password

```bash
cat ~/.config/code-server/config.yaml
```

**You'll see**:
```yaml
bind-addr: 127.0.0.1:8080
auth: password
password: a1b2c3d4e5f6g7h8
cert: false
```

**Copy the password!**

### Step 3: Open Firewall

```bash
sudo ufw allow 8080/tcp
```

### Step 4: Access Code-Server

**From any device**:
1. Open browser
2. Go to: `http://YOUR_ORACLE_IP:8080`
3. Enter the password from step 2
4. **You're in VS Code!** 🎉

### Step 5: Install Continue Extension

**In Code-Server (browser)**:
1. Click **Extensions** icon (left sidebar)
2. Search: **"Continue"**
3. Install **"Continue - Codestral, Claude, and more"**
4. Configure like in Part 1 (Gemini API or DeepSeek)

**Now you have Claude Code-like interface in your browser!**

### Step 6: Run 24/7 with PM2

Stop code-server (`Ctrl+C`), then:

```bash
# Create startup script
cat > ~/start-code-server.sh << 'EOF'
#!/bin/bash
code-server --bind-addr 0.0.0.0:8080 --auth password
EOF

chmod +x ~/start-code-server.sh

# Start with PM2
pm2 start ~/start-code-server.sh --name code-server

pm2 save
```

**Now code-server runs forever!**

### Step 7: Access from Phone

**Same URL**: `http://YOUR_ORACLE_IP:8080`

**On mobile**:
- Landscape mode works best
- External keyboard via Bluetooth (optional but nice)
- Use Continue extension same as desktop

---

## Part 4: Aider (Terminal-Based but Simple)

**AI pair programmer with simple chat that edits files**

### What is Aider?

- Chat interface that DIRECTLY edits your files
- Understands your whole codebase
- Very good at making targeted changes
- Can run in browser via Jupyter

### Step 1: Install Aider

```bash
pip3 install aider-chat
```

### Step 2: Configure for DeepSeek

```bash
# Create config file
mkdir -p ~/.aider
cat > ~/.aider/config.yml << 'EOF'
model: ollama/deepseek-coder-v2:16b
ollama-api-base: http://localhost:11434
editor-model: ollama/deepseek-coder-v2:16b
auto-commits: true
dirty-commits: true
EOF
```

### Step 3: Use Aider

```bash
cd ~/Bot
aider index.js
```

**Chat interface opens**:
```
Aider v0.x.x
Model: ollama/deepseek-coder-v2:16b
Git repo: /home/ubuntu/Bot
Added index.js to the chat

>
```

**Try commands**:
```
> Add error handling to the messageCreate event handler

Aider: I'll add try-catch blocks to handle errors...
[Shows diff of changes]
Apply this change? (y)es/(n)o/(d)on't know: y

✓ Applied changes to index.js
✓ Committed: Add error handling to messageCreate
```

**Other commands**:
```
> /add knowledge-base.json       # Add another file to chat
> /drop index.js                 # Remove file from chat
> /help                          # Show all commands
> /undo                          # Undo last change
> /diff                          # Show uncommitted changes
> /commit "your message"         # Commit changes
```

**More natural requests**:
```
> Refactor the emotional relationship tracking to use a class instead of Map

> Add JSDoc comments to all exported functions

> Create a new command handler for /settings

> Find and fix the bug causing the bot to crash when users send images
```

Aider directly edits your files and shows you diffs!

### Step 4: Aider with Jupyter (Browser Interface)

**Make Aider accessible via browser**:

```bash
# Install Jupyter
pip3 install jupyter jupyterlab

# Start Jupyter
jupyter lab --ip=0.0.0.0 --port=8888 --no-browser --allow-root
```

**Open in browser**: `http://YOUR_ORACLE_IP:8888`

**In Jupyter**:
1. New → Terminal
2. Run: `aider index.js`
3. Now you have Aider in browser!

---

## Part 5: Comparison Matrix

| Interface | Like Claude Code? | Free? | Works on Phone? | Edits Files? | Ease of Use |
|-----------|------------------|-------|-----------------|--------------|-------------|
| **Continue.dev** | ✅ EXACT | ✅ Yes | ✅ (via Code-Server) | ✅ Yes | ⭐⭐⭐⭐⭐ |
| **Open WebUI** | Similar | ✅ Yes | ✅ Yes | ❌ No (copy/paste) | ⭐⭐⭐⭐ |
| **Code-Server** | ✅ EXACT | ✅ Yes | ✅ Yes | ✅ Yes | ⭐⭐⭐⭐⭐ |
| **Aider** | Different | ✅ Yes | ❌ Terminal only | ✅ Yes | ⭐⭐⭐ |

**Recommendations**:

**Best Overall**: **Continue.dev + Code-Server**
- Continue.dev in desktop VS Code (when at computer)
- Code-Server in browser (when remote/phone)
- EXACTLY like Claude Code
- Uses free Gemini API or DeepSeek

**Best for Quick Chats**: **Open WebUI**
- ChatGPT-style interface
- Perfect for asking questions
- Great on mobile
- Doesn't edit files directly (but easy copy/paste)

**Best for Power Users**: **Aider**
- Directly edits your files
- Great for focused refactoring
- Terminal-based (not GUI)

---

## Part 6: Setup Recommendations

### For Your Use Case

Based on what you said:
> "I am not very used to the Terminal, and... Remote use can't be in the Terminal"

**Your perfect setup**:

1. **Install Continue.dev** in desktop VS Code (5 minutes)
   - Use when at your computer
   - Configure for Gemini API (free 1,000/day)
   - Works EXACTLY like Claude Code

2. **Install Code-Server** on Oracle Cloud (10 minutes)
   - Access via browser from anywhere
   - Install Continue.dev there too
   - Same experience, but from phone/tablet

3. **Install Open WebUI** on Oracle Cloud (5 minutes)
   - Quick chats from phone
   - When you don't need file editing
   - Beautiful ChatGPT-style interface

4. **(Optional) Install Aider** for power tasks
   - When you need focused refactoring
   - Can run via Jupyter in browser

---

## Part 7: Quick Start Instructions

### Option A: Desktop Only (Fastest - 5 min)

1. Download VS Code: https://code.visualstudio.com/
2. Install Continue extension
3. Configure with your Gemini API key
4. **Done!** Use like Claude Code

### Option B: Remote Access (20 min)

1. SSH to Oracle Cloud
2. Run these commands:

```bash
# Install Code-Server
curl -fsSL https://code-server.dev/install.sh | sh

# Install Open WebUI
docker run -d -p 3000:8080 \
  --add-host=host.docker.internal:host-gateway \
  -v open-webui:/app/backend/data \
  --name open-webui \
  --restart always \
  ghcr.io/open-webui/open-webui:main

# Open firewall
sudo ufw allow 8080/tcp
sudo ufw allow 3000/tcp

# Start Code-Server with PM2
cat > ~/start-code-server.sh << 'EOF'
#!/bin/bash
code-server --bind-addr 0.0.0.0:8080 --auth password
EOF
chmod +x ~/start-code-server.sh
pm2 start ~/start-code-server.sh --name code-server
pm2 save

# Get password
cat ~/.config/code-server/config.yaml
```

3. **Open in browser**:
   - Code-Server: `http://YOUR_ORACLE_IP:8080`
   - Open WebUI: `http://YOUR_ORACLE_IP:3000`

4. **Done!** Access from any device

---

## Part 8: Cost Comparison

| Solution | Cost | Usage Limit |
|----------|------|-------------|
| **Claude Code** | $20/month | ~200K tokens/day |
| **Continue.dev + Gemini** | **$0** | 1,000 req/day |
| **Continue.dev + DeepSeek** | **$0** | **Unlimited** ✅ |
| **Open WebUI + DeepSeek** | **$0** | **Unlimited** ✅ |
| **Code-Server** | **$0** | (hosting only) |

**You can have Claude Code functionality for $0/month!** 🎉

---

## Part 9: Example Workflows

### Workflow 1: At Computer

1. Open VS Code
2. Click Continue icon
3. Chat: "Add a new /help command to the Discord bot that shows all available commands"
4. AI writes the code
5. Click "Accept" to apply changes
6. Done!

### Workflow 2: On Phone

1. Open browser on phone
2. Go to: `http://YOUR_ORACLE_IP:8080` (Code-Server)
3. Open Continue extension
4. Same as desktop!

### Workflow 3: Quick Question from Anywhere

1. Open Open WebUI on phone: `http://YOUR_ORACLE_IP:3000`
2. Ask: "How do I add pagination to Discord embeds?"
3. Get answer instantly
4. Copy code to clipboard
5. Paste into Code-Server or VS Code

---

## Summary

**You now have 3 ways to get Claude Code functionality**:

1. ✅ **Continue.dev** - Exact Claude Code clone (FREE)
2. ✅ **Code-Server** - VS Code in browser (remote access)
3. ✅ **Open WebUI** - ChatGPT-style interface (FREE)

**All work with**:
- Gemini API (1,000 req/day free)
- DeepSeek Coder (unlimited free)

**No terminal needed** - all GUI interfaces! 🎉

**Start with**: Install Continue.dev in VS Code (takes 2 minutes)

---

## Need Help?

If you want me to walk you through any of these setups step-by-step, just ask:
- "Help me install Continue.dev"
- "Help me set up Code-Server"
- "Help me configure Open WebUI"

I'll guide you through every click! 🚀
