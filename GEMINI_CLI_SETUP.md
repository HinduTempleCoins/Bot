# Google Gemini CLI Setup Guide

**Goal**: Set up FREE AI coding assistant using Google's Gemini models

**What You'll Get**:
- Free AI coding (1,000 requests/day with gemini-2.5-flash-lite)
- Works in terminal (SSH sessions, local machine)
- Can run on Oracle Cloud server
- Perfect for quick coding tasks that don't need Claude

**Cost**: **$0/month** (free tier: 1,000 requests/day)

---

## Part 1: Get Gemini API Key (Done!)

You already have one: Your new Gemini API key from earlier.

**If you need another one**:
1. Go to: https://aistudio.google.com/app/apikey
2. Click **"Create API Key"**
3. Choose **"Create API key in new project"**
4. **COPY THE KEY** (you only see it once!)
5. **NEVER SHARE IT PUBLICLY**

---

## Part 2: Install Gemini CLI on Oracle Cloud

### Step 1: Connect to Oracle Server

```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP
```

### Step 2: Install Python Gemini SDK

```bash
# Install Google Generative AI SDK
pip3 install google-generativeai
```

### Step 3: Set API Key as Environment Variable

**Add to your shell profile** (so it's always available):

```bash
nano ~/.bashrc
```

**Add this line to the END of the file**:
```bash
export GEMINI_API_KEY="your_gemini_api_key_here"
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Reload shell**:
```bash
source ~/.bashrc
```

**Verify it's set**:
```bash
echo $GEMINI_API_KEY
```

Should print your API key.

---

## Part 3: Create Gemini CLI Helper Scripts

### Script 1: Simple Chat Interface

Create a simple chat script:

```bash
nano ~/gemini-chat.py
```

**Paste this code**:
```python
#!/usr/bin/env python3
import google.generativeai as genai
import os
import sys

# Configure API
api_key = os.environ.get('GEMINI_API_KEY')
if not api_key:
    print("❌ Error: GEMINI_API_KEY not set!")
    print("Run: export GEMINI_API_KEY='your_key_here'")
    sys.exit(1)

genai.configure(api_key=api_key)

# Use gemini-2.5-flash-lite (1,000 req/day free)
model = genai.GenerativeModel('gemini-2.5-flash-lite')

def chat():
    print("🤖 Gemini CLI Chat (gemini-2.5-flash-lite)")
    print("💡 Type 'exit' to quit")
    print("💡 Type 'clear' to start new conversation")
    print("─" * 50)

    conversation = model.start_chat(history=[])

    while True:
        try:
            user_input = input("\n👤 You: ").strip()

            if user_input.lower() == 'exit':
                print("👋 Goodbye!")
                break

            if user_input.lower() == 'clear':
                conversation = model.start_chat(history=[])
                print("🗑️  Conversation cleared!")
                continue

            if not user_input:
                continue

            print("\n🤖 Gemini: ", end="", flush=True)
            response = conversation.send_message(user_input)
            print(response.text)

        except KeyboardInterrupt:
            print("\n\n👋 Goodbye!")
            break
        except Exception as e:
            print(f"\n❌ Error: {e}")

if __name__ == "__main__":
    chat()
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/gemini-chat.py
```

**Test it**:
```bash
python3 ~/gemini-chat.py
```

You should see:
```
🤖 Gemini CLI Chat (gemini-2.5-flash-lite)
💡 Type 'exit' to quit
💡 Type 'clear' to start new conversation
──────────────────────────────────────────────────

👤 You:
```

Try asking: **"Write a Python function to check if a number is prime"**

---

### Script 2: One-Shot Code Generation

For quick code generation without chat:

```bash
nano ~/gemini-code.py
```

**Paste this code**:
```python
#!/usr/bin/env python3
import google.generativeai as genai
import os
import sys

# Configure API
api_key = os.environ.get('GEMINI_API_KEY')
if not api_key:
    print("❌ Error: GEMINI_API_KEY not set!")
    sys.exit(1)

genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-2.5-flash-lite')

def generate(prompt):
    try:
        response = model.generate_content(prompt)
        print(response.text)
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: gemini-code.py 'your prompt here'")
        print("Example: gemini-code.py 'write a bash script to backup files'")
        sys.exit(1)

    prompt = " ".join(sys.argv[1:])
    generate(prompt)
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/gemini-code.py
```

**Test it**:
```bash
python3 ~/gemini-code.py "Write a bash script to count files in a directory"
```

---

### Script 3: File Analysis/Editing

For analyzing existing code files:

```bash
nano ~/gemini-file.py
```

**Paste this code**:
```python
#!/usr/bin/env python3
import google.generativeai as genai
import os
import sys

# Configure API
api_key = os.environ.get('GEMINI_API_KEY')
if not api_key:
    print("❌ Error: GEMINI_API_KEY not set!")
    sys.exit(1)

genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-2.5-flash-lite')

def analyze_file(filepath, question):
    try:
        with open(filepath, 'r') as f:
            content = f.read()

        prompt = f"""Here is the content of {filepath}:

```
{content}
```

{question}"""

        response = model.generate_content(prompt)
        print(response.text)

    except FileNotFoundError:
        print(f"❌ Error: File '{filepath}' not found!", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: gemini-file.py <file> 'question about the file'")
        print("Example: gemini-file.py index.js 'explain what this code does'")
        sys.exit(1)

    filepath = sys.argv[1]
    question = " ".join(sys.argv[2:])
    analyze_file(filepath, question)
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/gemini-file.py
```

**Test it**:
```bash
python3 ~/gemini-file.py ~/Bot/index.js "Summarize what this Discord bot does"
```

---

## Part 4: Create Shell Aliases for Easy Access

Make commands easier to type:

```bash
nano ~/.bashrc
```

**Add these lines to the END**:
```bash
# Gemini CLI aliases
alias gemini-chat="python3 ~/gemini-chat.py"
alias gemini-code="python3 ~/gemini-code.py"
alias gemini-file="python3 ~/gemini-file.py"
alias gchat="python3 ~/gemini-chat.py"
alias gcode="python3 ~/gemini-code.py"
alias gfile="python3 ~/gemini-file.py"
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Reload shell**:
```bash
source ~/.bashrc
```

**Now you can use short commands**:
```bash
gchat                          # Start interactive chat
gcode "write a python script"  # Quick code generation
gfile index.js "explain this"  # Analyze a file
```

---

## Part 5: Advanced - Gemini as Git Commit Helper

Auto-generate commit messages:

```bash
nano ~/gemini-commit.sh
```

**Paste this code**:
```bash
#!/bin/bash

# Get git diff
DIFF=$(git diff --cached)

if [ -z "$DIFF" ]; then
    echo "❌ No staged changes to commit!"
    echo "Run: git add <files>"
    exit 1
fi

echo "🤖 Generating commit message with Gemini..."

# Generate commit message
MESSAGE=$(python3 ~/gemini-code.py "Generate a concise git commit message (1 line, 50 chars max) for these changes. Return ONLY the commit message, no explanation:

\`\`\`
$DIFF
\`\`\`" | head -n 1)

echo ""
echo "📝 Suggested commit message:"
echo "   $MESSAGE"
echo ""
read -p "Use this message? (y/n): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    git commit -m "$MESSAGE"
    echo "✅ Committed!"
else
    echo "❌ Commit cancelled"
    echo "Run: git commit -m 'your message'"
fi
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/gemini-commit.sh
```

**Add alias**:
```bash
echo "alias gcommit='~/gemini-commit.sh'" >> ~/.bashrc
source ~/.bashrc
```

**Usage**:
```bash
git add myfile.js
gcommit  # Auto-generates commit message!
```

---

## Part 6: Usage Examples

### Example 1: Debug Code

```bash
gchat

👤 You: I have this Python code that's not working:
def factorial(n):
    return n * factorial(n-1)

What's wrong?

🤖 Gemini: The issue is that there's no base case to stop the recursion...
```

### Example 2: Quick Script Generation

```bash
gcode "Write a bash script that monitors CPU usage and sends alert if over 80%"
```

Output:
```bash
#!/bin/bash
while true; do
    CPU=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}')
    ...
done
```

### Example 3: Analyze Existing Code

```bash
gfile ~/Bot/index.js "What Discord commands does this bot support?"
```

### Example 4: Code Review

```bash
gfile mycode.py "Review this code for security vulnerabilities and suggest improvements"
```

---

## Part 7: Token Usage Optimization

### Check Your Usage

Go to: https://aistudio.google.com/app/apikey

Click on your key → **"View usage"**

You'll see:
- Requests today: X / 1,000
- Resets at: 12:00 AM PST

### Tips to Save Tokens

1. **Use `gemini-2.5-flash-lite`** (not gemini-pro or gemini-1.5-pro)
2. **Be specific in prompts** (shorter responses = fewer tokens)
3. **Use one-shot commands** (`gcode`) instead of chat when possible
4. **Clear chat history** when switching topics (`clear` command)
5. **Save responses** to files to avoid re-generating

### If You Hit the Limit

**Option A**: Wait for reset (midnight PST)

**Option B**: Use local LLM (see DEEPSEEK_CODER_SETUP.md)

**Option C**: Create multiple Google accounts (NOT RECOMMENDED - against TOS)

---

## Part 8: Integration with Your Workflow

### Combine with Git Workflow

```bash
# Make changes
nano myfile.js

# Stage changes
git add myfile.js

# Auto-generate commit message
gcommit

# Push
git push
```

### Integrate with PM2 Logs

```bash
# View bot errors
pm2 logs vankush-bot --err --lines 50 > error.log

# Ask Gemini to debug
gfile error.log "What's causing these errors and how do I fix them?"
```

### Quick Documentation Generation

```bash
gfile mycode.py "Generate a README.md file explaining what this code does" > README.md
```

---

## Part 9: Comparison - Claude vs Gemini

| Feature | Claude (Sonnet) | Gemini 2.5 Flash Lite |
|---------|----------------|----------------------|
| **Cost** | $20/month | FREE |
| **Daily Limit** | ~200K tokens | 1,000 requests |
| **Code Quality** | Excellent | Good |
| **Reasoning** | Best-in-class | Good |
| **Context Window** | 200K tokens | 1M tokens |
| **Speed** | Fast | Very fast |
| **Multimodal** | Yes (images) | Yes (images, video) |

**Recommendation**:
- **Complex tasks**: Use Claude (like planning entire systems)
- **Quick coding**: Use Gemini CLI (like fixing bugs, writing functions)
- **Research**: Use Gemini (larger context window)
- **Production**: Use Claude (better reasoning)

---

## Troubleshooting

### Error: "GEMINI_API_KEY not set"

```bash
# Check if set
echo $GEMINI_API_KEY

# If empty, add to .bashrc
nano ~/.bashrc
# Add: export GEMINI_API_KEY="your_key_here"

# Reload
source ~/.bashrc
```

### Error: "Module not found: google.generativeai"

```bash
pip3 install google-generativeai
```

### Error: "API key is invalid"

- Check key at: https://aistudio.google.com/app/apikey
- Make sure it's not the leaked one
- Create new key if needed

### Error: "Rate limit exceeded"

You've hit the 1,000 requests/day limit.

**Solutions**:
1. Wait until midnight PST
2. Use local LLM (see DEEPSEEK_CODER_SETUP.md)
3. Be more selective about what you ask

---

## Next Steps

Now that you have Gemini CLI:

1. ✅ Oracle Cloud server running
2. ✅ Gemini CLI installed
3. ⏳ Install DeepSeek Coder local LLM (DEEPSEEK_CODER_SETUP.md)
4. ⏳ Configure auto-push to GitHub (AUTO_PUSH_GITHUB.md)
5. ⏳ Set up remote coding (REMOTE_CODING_SETUP.md)

**Your workflow**:
- **Quick questions**: `gchat`
- **Code generation**: `gcode "write a function..."`
- **File analysis**: `gfile myfile.js "explain this"`
- **Git commits**: `gcommit`
- **Complex planning**: Use Claude Code (when not over budget)
- **Unlimited coding**: Use DeepSeek Coder (coming next)

---

## Cost Breakdown

**Gemini CLI**:
- API Key: **$0/month** ✅
- 1,000 requests/day: **$0/month** ✅
- Unlimited tokens per request: **$0/month** ✅

**Total Cost**: **$0/month** 🎉

Compare to Claude Pro: $20/month

**You now have**:
- Oracle Cloud: $0/month (24GB RAM server)
- Gemini CLI: $0/month (1,000 req/day)
- **Total: $0/month** 🎉

Next: Add DeepSeek Coder for **unlimited** local coding!
