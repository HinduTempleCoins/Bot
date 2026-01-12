# Auto-Push to GitHub Setup Guide

**Goal**: Automatically commit and push code changes to GitHub, just like Claude Code does

**What You'll Get**:
- Automatic git commits when files change
- Auto-generated commit messages
- Automatic push to GitHub
- File watching for instant commits
- Works on Oracle Cloud server or local machine

**Use Cases**:
- Keep GitHub always up-to-date
- Never lose work (auto-backup)
- Collaborate with AI assistants remotely
- Track all changes automatically

---

## Part 1: Understanding Auto-Push

### How Claude Code Does It

When you use Claude Code, it:
1. Watches for file changes
2. Automatically stages changed files
3. Generates commit messages with AI
4. Commits and pushes to GitHub
5. Creates branches with session IDs

**We'll replicate this for your own coding!**

### Security Considerations

**⚠️ WARNING**: Auto-push means:
- Every file change goes to GitHub immediately
- Make sure `.gitignore` includes sensitive files
- API keys, passwords, `.env` files should NEVER be committed
- Review your `.gitignore` before enabling

---

## Part 2: Method 1 - Simple File Watcher (Recommended)

Uses `inotifywait` to watch for file changes and auto-commit.

### Step 1: Install Required Tools

On Oracle Cloud server:

```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP

# Install inotify-tools
sudo apt update
sudo apt install -y inotify-tools
```

### Step 2: Configure Git Credentials

**IMPORTANT**: Set up Git credentials so you don't need to enter password every push.

```bash
# Set your Git identity
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# Create GitHub Personal Access Token (PAT)
# Go to: https://github.com/settings/tokens
# Click: Generate new token (classic)
# Scopes: Check "repo" (full control of private repositories)
# Generate token and COPY IT

# Store credentials (encrypted)
git config --global credential.helper store

# Test push (will prompt for credentials ONCE)
cd ~/Bot
git pull
# Enter username: your_github_username
# Enter password: paste_your_PAT_token_here

# Credentials are now saved - future pushes are automatic!
```

### Step 3: Create Auto-Push Script

```bash
nano ~/auto-push.sh
```

**Paste this code**:
```bash
#!/bin/bash

# Configuration
REPO_DIR="${1:-~/Bot}"
BRANCH="${2:-claude/update-todos-9iXhF}"
WATCH_PATTERNS="*.js *.json *.md *.py *.sh *.yml *.yaml"

cd "$REPO_DIR" || exit 1

echo "🤖 Auto-Push GitHub Watcher"
echo "📁 Repository: $REPO_DIR"
echo "🌿 Branch: $BRANCH"
echo "👀 Watching: $WATCH_PATTERNS"
echo "─────────────────────────────────────"
echo ""

# Function to commit and push
do_commit_push() {
    # Check if there are changes
    if [ -z "$(git status --porcelain)" ]; then
        return
    fi

    echo ""
    echo "📝 Changes detected at $(date '+%Y-%m-%d %H:%M:%S')"

    # Stage all changes
    git add -A

    # Generate commit message with Gemini or DeepSeek
    DIFF=$(git diff --cached --stat)

    if command -v ollama &> /dev/null; then
        # Use DeepSeek (local, unlimited)
        echo "🤖 Generating commit message with DeepSeek..."
        MESSAGE=$(ollama run deepseek-coder-v2:16b "Generate a concise git commit message (1 line, max 50 chars) for these changes. Return ONLY the message:

$DIFF" 2>/dev/null | head -n 1)
    elif [ -n "$GEMINI_API_KEY" ]; then
        # Use Gemini CLI (1000/day)
        echo "🤖 Generating commit message with Gemini..."
        MESSAGE=$(python3 ~/gemini-code.py "Generate a concise git commit message (1 line, max 50 chars) for these changes. Return ONLY the message:

$DIFF" 2>/dev/null | head -n 1)
    else
        # Fallback: Use timestamp
        MESSAGE="Auto-commit: $(date '+%Y-%m-%d %H:%M:%S')"
    fi

    # Clean up message (remove quotes, extra whitespace)
    MESSAGE=$(echo "$MESSAGE" | sed 's/^["'\'']*//;s/["'\'']*$//' | tr -d '\n' | head -c 72)

    # Commit
    if git commit -m "$MESSAGE"; then
        echo "✅ Committed: $MESSAGE"

        # Push with retry logic
        MAX_RETRIES=4
        RETRY_DELAY=2

        for i in $(seq 1 $MAX_RETRIES); do
            if git push -u origin "$BRANCH" 2>/dev/null; then
                echo "🚀 Pushed to $BRANCH"
                break
            else
                if [ $i -eq $MAX_RETRIES ]; then
                    echo "❌ Push failed after $MAX_RETRIES attempts"
                else
                    echo "⚠️  Push failed, retrying in ${RETRY_DELAY}s... (attempt $i/$MAX_RETRIES)"
                    sleep $RETRY_DELAY
                    RETRY_DELAY=$((RETRY_DELAY * 2))
                fi
            fi
        done
    else
        echo "❌ Commit failed"
    fi

    echo ""
}

# Initial commit on startup
do_commit_push

# Watch for file changes
echo "👀 Watching for changes... (Press Ctrl+C to stop)"
echo ""

inotifywait -m -r -e modify,create,delete,move \
    --exclude '(\.git|node_modules|\.env|\.cache|\.log|user-relationships\.json)' \
    "$REPO_DIR" | while read path action file; do

    # Check if file matches watch patterns
    should_process=false
    for pattern in $WATCH_PATTERNS; do
        if [[ "$file" == $pattern ]]; then
            should_process=true
            break
        fi
    done

    # Also process if in specific directories
    if [[ "$path" =~ (src/|lib/|public/) ]]; then
        should_process=true
    fi

    if [ "$should_process" = true ]; then
        # Debounce: wait 3 seconds for more changes
        sleep 3
        do_commit_push
    fi
done
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/auto-push.sh
```

### Step 4: Test Auto-Push

**Open two terminal windows:**

**Terminal 1** (start watcher):
```bash
cd ~/Bot
~/auto-push.sh ~/Bot claude/update-todos-9iXhF
```

**Terminal 2** (make a change):
```bash
cd ~/Bot
echo "# Test Auto-Push" >> TEST.md
```

**Watch Terminal 1** - should see:
```
📝 Changes detected at 2026-01-08 20:30:45
🤖 Generating commit message with DeepSeek...
✅ Committed: Add test file for auto-push
🚀 Pushed to claude/update-todos-9iXhF
```

**Check GitHub** - your commit should appear instantly!

### Step 5: Run Auto-Push 24/7 with PM2

Stop the test (Ctrl+C in Terminal 1), then:

```bash
# Install PM2 if not already installed
sudo npm install -g pm2

# Start auto-push with PM2
pm2 start ~/auto-push.sh --name auto-push-bot -- ~/Bot claude/update-todos-9iXhF

# Save PM2 configuration
pm2 save

# Enable startup on boot
pm2 startup
# Copy and run the command PM2 gives you

# Check status
pm2 status
```

**Now auto-push runs forever!** 🎉

---

## Part 3: Method 2 - Git Hooks (Alternative)

Use Git's built-in hooks for auto-push.

### Step 1: Create Post-Commit Hook

```bash
cd ~/Bot
nano .git/hooks/post-commit
```

**Paste this code**:
```bash
#!/bin/bash

BRANCH=$(git branch --show-current)

echo "🚀 Auto-pushing to $BRANCH..."

# Push with retry
MAX_RETRIES=4
RETRY_DELAY=2

for i in $(seq 1 $MAX_RETRIES); do
    if git push -u origin "$BRANCH" 2>/dev/null; then
        echo "✅ Pushed successfully"
        exit 0
    else
        if [ $i -eq $MAX_RETRIES ]; then
            echo "❌ Push failed after $MAX_RETRIES attempts"
            exit 1
        else
            echo "⚠️  Retrying in ${RETRY_DELAY}s..."
            sleep $RETRY_DELAY
            RETRY_DELAY=$((RETRY_DELAY * 2))
        fi
    fi
done
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x .git/hooks/post-commit
```

### Step 2: Test Git Hook

```bash
echo "# Test" >> TEST2.md
git add TEST2.md
git commit -m "Test auto-push hook"
```

Should automatically push after commit!

**Note**: This method requires manual commits. Method 1 is better for true automation.

---

## Part 4: Smart Auto-Commit Script

More intelligent version that groups changes.

```bash
nano ~/smart-auto-push.sh
```

**Paste this code**:
```bash
#!/bin/bash

REPO_DIR="${1:-~/Bot}"
BRANCH="${2:-claude/update-todos-9iXhF}"
COMMIT_INTERVAL=300  # Commit every 5 minutes if changes detected

cd "$REPO_DIR" || exit 1

echo "🤖 Smart Auto-Push (commits every $COMMIT_INTERVAL seconds)"
echo "📁 Repository: $REPO_DIR"
echo "🌿 Branch: $BRANCH"
echo ""

while true; do
    # Check for changes
    if [ -n "$(git status --porcelain)" ]; then
        # Get changed files
        CHANGED_FILES=$(git status --porcelain | wc -l)

        echo "📝 $CHANGED_FILES file(s) changed - committing..."

        # Stage changes
        git add -A

        # Get file summary
        SUMMARY=$(git diff --cached --name-status | head -n 5)

        # Generate smart commit message
        if [ $CHANGED_FILES -eq 1 ]; then
            FILE=$(git diff --cached --name-only)
            MESSAGE="Update $FILE"
        elif [ $CHANGED_FILES -le 3 ]; then
            FILES=$(git diff --cached --name-only | tr '\n' ', ' | sed 's/,$//')
            MESSAGE="Update $FILES"
        else
            MESSAGE="Update $CHANGED_FILES files"
        fi

        # Add timestamp
        MESSAGE="$MESSAGE ($(date '+%H:%M:%S'))"

        # Commit
        if git commit -m "$MESSAGE"; then
            echo "✅ Committed: $MESSAGE"

            # Push
            if git push -u origin "$BRANCH"; then
                echo "🚀 Pushed to $BRANCH"
            else
                echo "❌ Push failed"
            fi
        fi

        echo ""
    fi

    sleep $COMMIT_INTERVAL
done
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/smart-auto-push.sh
```

**Run with PM2**:
```bash
pm2 start ~/smart-auto-push.sh --name smart-push -- ~/Bot claude/update-todos-9iXhF
pm2 save
```

---

## Part 5: Configure .gitignore (CRITICAL!)

**Before enabling auto-push**, verify these are in `.gitignore`:

```bash
cd ~/Bot
nano .gitignore
```

**Must include**:
```
# Environment variables (NEVER commit!)
.env
.env.*
*.env

# API keys
*_api_key*
*_token*
credentials.json
secrets.json

# Node modules
node_modules/

# Logs
*.log
logs/

# Runtime data
*.pid
*.seed
user-relationships.json

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Cache
.cache/
.npm/
.eslintcache
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Test .gitignore**:
```bash
# Create test sensitive file
echo "API_KEY=secret123" > .env

# Check git status (should NOT show .env)
git status

# If .env appears, add to .gitignore immediately!
```

---

## Part 6: Monitor Auto-Push

### Check PM2 Logs

```bash
# View auto-push logs
pm2 logs auto-push-bot

# View in real-time
pm2 logs auto-push-bot --lines 50

# Stop watching logs: Ctrl+C
```

### Check Git History

```bash
cd ~/Bot
git log --oneline -20
```

### View GitHub

Go to: https://github.com/HinduTempleCoins/Bot/commits/claude/update-todos-9iXhF

Should see automatic commits appearing!

---

## Part 7: Advanced Features

### Auto-Pull Before Push

Prevent conflicts:

```bash
nano ~/auto-sync.sh
```

```bash
#!/bin/bash

REPO_DIR="$1"
BRANCH="$2"

cd "$REPO_DIR" || exit 1

# Pull latest
git pull origin "$BRANCH" --rebase

# Then push
git push -u origin "$BRANCH"
```

**Update auto-push script** to call this instead of `git push`.

### Multiple Repository Support

```bash
# Watch multiple repos
pm2 start ~/auto-push.sh --name push-bot -- ~/Bot claude/update-todos-9iXhF
pm2 start ~/auto-push.sh --name push-website -- ~/Website main
pm2 start ~/auto-push.sh --name push-backend -- ~/Backend develop

pm2 save
```

### Webhook Notifications

Get notified on Discord when code is pushed:

```bash
# Add to auto-push.sh after successful push:

WEBHOOK_URL="your_discord_webhook_url"
curl -H "Content-Type: application/json" \
     -d "{\"content\": \"✅ Auto-pushed to $BRANCH: $MESSAGE\"}" \
     "$WEBHOOK_URL"
```

---

## Part 8: Troubleshooting

### Error: "Permission denied (publickey)"

**Fix**: Set up GitHub credentials properly.

```bash
# Use HTTPS with PAT instead of SSH
cd ~/Bot
git remote set-url origin https://github.com/HinduTempleCoins/Bot.git

# Test
git pull
# Enter username and PAT when prompted
```

### Error: "Push failed" constantly

**Causes**:
1. Network issues → Script retries automatically
2. Branch doesn't exist → Create it: `git push -u origin new-branch`
3. Force push needed → Add to script: `git push -f origin $BRANCH` (dangerous!)

### Files Not Being Committed

Check:
1. File matches watch patterns in script
2. File not in `.gitignore`
3. File is in repository directory

### Too Many Commits

**Solution**: Increase `COMMIT_INTERVAL` in smart-auto-push.sh:

```bash
COMMIT_INTERVAL=600  # 10 minutes instead of 5
```

---

## Part 9: Best Practices

### When to Use Auto-Push

✅ **Good for**:
- Personal projects
- Solo development
- Rapid prototyping
- Automatic backups
- Working with AI assistants

❌ **Bad for**:
- Team projects (conflicts!)
- Production branches
- Repositories with many collaborators

### Commit Message Quality

**Current**: AI-generated messages (good)

**Better**: Add context in script:

```bash
# Before generating message, add context
CONTEXT="Working on: Discord bot features"
PROMPT="Generate commit message for these changes. Context: $CONTEXT\n\n$DIFF"
```

### Security Best Practices

1. ✅ Always use `.gitignore` for sensitive files
2. ✅ Use HTTPS with PAT (not SSH) for auto-push
3. ✅ Store PAT in git credential store (encrypted)
4. ✅ Never commit `.env` files
5. ✅ Review commits regularly: `git log`

---

## Part 10: Integration with Your Workflow

### With Remote Coding

When coding from Slack/Telegram:
1. Remote AI makes changes on server
2. Auto-push commits changes
3. You see updates on GitHub instantly
4. Pull to local machine: `git pull`

### With Multiple Devices

**Setup on all devices**:
```bash
# Device 1 (Oracle Cloud)
~/auto-push.sh ~/Bot branch-1

# Device 2 (Local machine)
~/auto-push.sh ~/Bot branch-2

# Work on different branches to avoid conflicts!
```

### With Fiverr Gigs

When delivering work:
1. Code automatically commits to GitHub
2. Client sees progress in real-time
3. Share GitHub branch link
4. Client reviews before final delivery

---

## Summary

You now have **automatic GitHub sync** like Claude Code!

**What you built**:
- ✅ File watcher for instant commits
- ✅ AI-generated commit messages
- ✅ Auto-push with retry logic
- ✅ PM2 keeps it running 24/7
- ✅ Works with DeepSeek/Gemini for messages

**Your complete setup**:
1. ✅ Oracle Cloud server (24GB RAM, free)
2. ✅ Gemini CLI (1,000 req/day, free)
3. ✅ DeepSeek Coder (unlimited, free)
4. ✅ Auto-push to GitHub ✅
5. ⏳ Next: Remote coding (Slack, Telegram, SMS)

**Cost**: **$0/month** 🎉

**Next guide**: REMOTE_CODING_SETUP.md
