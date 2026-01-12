# DeepSeek Coder Local LLM Setup Guide

**Goal**: Run a FREE local AI coding assistant with UNLIMITED usage

**What You'll Get**:
- Unlimited coding assistance (no API limits!)
- Runs on your Oracle Cloud server (24GB RAM)
- Works offline (no internet needed after download)
- Fast code generation
- Privacy (your code never leaves your server)

**Best Models**:
- **DeepSeek-Coder-V2-Lite-Instruct** (16B params) - Best for 24GB RAM
- **Qwen2.5-Coder-7B-Instruct** - Faster, still excellent
- **CodeLlama-13B-Instruct** - Good alternative

**Cost**: **$0/month** (one-time download ~10GB)

---

## Part 1: Understanding Local LLMs

### What is a Local LLM?

Instead of sending requests to OpenAI/Google servers:
- Model runs **on your server**
- No API keys needed
- No rate limits
- No internet required (after initial download)
- 100% private

### Why DeepSeek Coder?

**Benchmarks** (HumanEval coding test):
- DeepSeek-Coder-V2-Lite: **81.1%** ✅
- GPT-3.5-Turbo: 76.2%
- Gemini-1.5-Flash: 74.3%
- Code Llama 13B: 50.0%

**DeepSeek is better than GPT-3.5 for coding!**

### Hardware Requirements

**Minimum** (for 7B model):
- 8GB RAM
- 4 CPU cores
- 10GB disk space

**Recommended** (for 16B model):
- 24GB RAM ✅ (Your Oracle Cloud server!)
- 6+ CPU cores
- 20GB disk space

**You have the perfect setup!**

---

## Part 2: Install Ollama (LLM Runtime)

Ollama is like Docker for AI models - makes running LLMs super easy.

### Step 1: Connect to Oracle Server

```bash
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP
```

### Step 2: Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

This installs:
- Ollama runtime
- GPU acceleration (if available)
- Model management
- HTTP API server

### Step 3: Verify Installation

```bash
ollama --version
```

Should show: `ollama version is X.Y.Z`

### Step 4: Start Ollama Service

```bash
# Start Ollama server
sudo systemctl start ollama

# Enable auto-start on boot
sudo systemctl enable ollama

# Check status
sudo systemctl status ollama
```

Should show: `Active: active (running)`

---

## Part 3: Download DeepSeek Coder Model

### Option A: DeepSeek-Coder-V2-Lite (Recommended)

**Best for your 24GB RAM server**

```bash
ollama pull deepseek-coder-v2:16b
```

**Download size**: ~10GB
**RAM usage**: ~16GB during inference
**Speed**: ~20 tokens/second
**Quality**: Excellent ✅

This will take 10-30 minutes depending on your internet speed.

### Option B: Qwen2.5-Coder (Faster Alternative)

If you want something faster:

```bash
ollama pull qwen2.5-coder:7b
```

**Download size**: ~4.7GB
**RAM usage**: ~8GB during inference
**Speed**: ~40 tokens/second
**Quality**: Very good ✅

### Option C: CodeLlama (Popular Choice)

Meta's coding model:

```bash
ollama pull codellama:13b-instruct
```

**Download size**: ~7.4GB
**RAM usage**: ~13GB during inference
**Speed**: ~25 tokens/second
**Quality**: Good ✅

---

## Part 4: Test Your Local LLM

### Quick Test

```bash
ollama run deepseek-coder-v2:16b "Write a Python function to check if a number is prime"
```

You should see output like:
```python
def is_prime(n):
    if n <= 1:
        return False
    if n <= 3:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True
```

**If this works, you're done with the basic setup! 🎉**

---

## Part 5: Create CLI Interface Scripts

### Script 1: Interactive Chat

```bash
nano ~/deepseek-chat.sh
```

**Paste this code**:
```bash
#!/bin/bash

MODEL="${1:-deepseek-coder-v2:16b}"

echo "🤖 DeepSeek Coder Chat ($MODEL)"
echo "💡 Type your coding questions below"
echo "💡 Press Ctrl+C to exit"
echo "─────────────────────────────────────"
echo ""

ollama run "$MODEL"
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/deepseek-chat.sh
```

**Usage**:
```bash
~/deepseek-chat.sh
```

### Script 2: One-Shot Code Generation

```bash
nano ~/deepseek-code.sh
```

**Paste this code**:
```bash
#!/bin/bash

if [ $# -eq 0 ]; then
    echo "Usage: deepseek-code.sh 'your prompt here'"
    echo "Example: deepseek-code.sh 'write a bash script to monitor CPU'"
    exit 1
fi

MODEL="deepseek-coder-v2:16b"
PROMPT="$*"

echo "🤖 Generating code with DeepSeek Coder..."
echo ""

ollama run "$MODEL" "$PROMPT"
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/deepseek-code.sh
```

**Usage**:
```bash
~/deepseek-code.sh "Write a Python function to parse JSON files"
```

### Script 3: File Analysis

```bash
nano ~/deepseek-file.sh
```

**Paste this code**:
```bash
#!/bin/bash

if [ $# -lt 2 ]; then
    echo "Usage: deepseek-file.sh <file> 'question'"
    echo "Example: deepseek-file.sh index.js 'explain what this does'"
    exit 1
fi

FILE="$1"
shift
QUESTION="$*"

if [ ! -f "$FILE" ]; then
    echo "❌ Error: File '$FILE' not found!"
    exit 1
fi

MODEL="deepseek-coder-v2:16b"
CONTENT=$(cat "$FILE")

PROMPT="Here is the content of $FILE:

\`\`\`
$CONTENT
\`\`\`

$QUESTION"

echo "🤖 Analyzing $FILE with DeepSeek Coder..."
echo ""

ollama run "$MODEL" "$PROMPT"
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/deepseek-file.sh
```

**Usage**:
```bash
~/deepseek-file.sh ~/Bot/index.js "What Discord commands does this bot support?"
```

---

## Part 6: Create Shell Aliases

```bash
nano ~/.bashrc
```

**Add these lines to the END**:
```bash
# DeepSeek Coder aliases
alias deepseek="~/deepseek-chat.sh"
alias dcode="~/deepseek-code.sh"
alias dfile="~/deepseek-file.sh"
alias ds="~/deepseek-chat.sh"
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Reload**:
```bash
source ~/.bashrc
```

**Now you can use short commands**:
```bash
ds                              # Interactive chat
dcode "write a python script"   # Quick code generation
dfile index.js "explain this"   # Analyze file
```

---

## Part 7: Advanced - HTTP API Access

Ollama runs an HTTP API on port 11434. You can call it from any programming language!

### Test API

```bash
curl http://localhost:11434/api/generate -d '{
  "model": "deepseek-coder-v2:16b",
  "prompt": "Write a function to calculate fibonacci numbers",
  "stream": false
}'
```

### Python API Client

```bash
pip3 install ollama
```

Create a Python script:

```python
import ollama

response = ollama.chat(model='deepseek-coder-v2:16b', messages=[
  {
    'role': 'user',
    'content': 'Write a Python function to check if a string is a palindrome',
  },
])
print(response['message']['content'])
```

### Node.js API Client

```bash
npm install ollama
```

```javascript
import ollama from 'ollama'

const response = await ollama.chat({
  model: 'deepseek-coder-v2:16b',
  messages: [{ role: 'user', content: 'Write a function to sort an array' }],
})
console.log(response.message.content)
```

---

## Part 8: Git Commit Message Generator

```bash
nano ~/deepseek-commit.sh
```

**Paste this code**:
```bash
#!/bin/bash

# Check for staged changes
DIFF=$(git diff --cached)

if [ -z "$DIFF" ]; then
    echo "❌ No staged changes to commit!"
    echo "Run: git add <files>"
    exit 1
fi

MODEL="deepseek-coder-v2:16b"

echo "🤖 Generating commit message with DeepSeek Coder..."

# Generate commit message
PROMPT="Generate a concise git commit message (1 line, 50 chars max) for these changes. Return ONLY the commit message, no explanation:

\`\`\`
$DIFF
\`\`\`"

MESSAGE=$(ollama run "$MODEL" "$PROMPT" | head -n 1)

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
fi
```

**Save**: `Ctrl+O`, `Enter`, `Ctrl+X`

**Make executable**:
```bash
chmod +x ~/deepseek-commit.sh
```

**Add alias**:
```bash
echo "alias dcommit='~/deepseek-commit.sh'" >> ~/.bashrc
source ~/.bashrc
```

**Usage**:
```bash
git add myfile.js
dcommit  # Auto-generate commit message!
```

---

## Part 9: Performance Optimization

### Check RAM Usage

```bash
# Before running model
free -h

# While model is running (in another terminal)
ssh -i ~/.ssh/oracle_ssh_key ubuntu@YOUR_ORACLE_IP
htop
```

### Tune Model Parameters

**Reduce RAM usage** (if needed):

```bash
# Use 4-bit quantization (uses less RAM, slightly lower quality)
ollama pull deepseek-coder-v2:16b-q4_0
```

**Increase speed**:

```bash
# Use smaller model
ollama pull qwen2.5-coder:7b
```

### Run Multiple Models

You can have multiple models installed:

```bash
ollama pull deepseek-coder-v2:16b    # Best quality
ollama pull qwen2.5-coder:7b         # Fast
ollama pull codellama:13b-instruct   # Alternative

# List installed models
ollama list
```

Switch between them:
```bash
~/deepseek-chat.sh qwen2.5-coder:7b
```

---

## Part 10: Comparison - All Your AI Options

| Feature | Claude | Gemini CLI | DeepSeek (Local) |
|---------|--------|-----------|------------------|
| **Cost** | $20/month | FREE | FREE |
| **Daily Limit** | ~200K tokens | 1,000 req | **UNLIMITED** ✅ |
| **Speed** | Fast | Very fast | Fast |
| **Code Quality** | Excellent | Good | Very good |
| **Internet Required** | Yes | Yes | **No** ✅ |
| **Privacy** | Low | Low | **High** ✅ |
| **Setup** | Easy | Easy | Medium |
| **Context Window** | 200K | 1M | 128K |

**Your Workflow**:
1. **Complex planning**: Claude Code (when budget allows)
2. **Quick questions**: Gemini CLI (1,000/day free)
3. **Unlimited coding**: DeepSeek Local (no limits!) ✅
4. **Sensitive code**: DeepSeek Local (never leaves your server) ✅

---

## Part 11: Usage Examples

### Example 1: Debug Complex Code

```bash
ds

>>> I have this code that's causing a memory leak:
>>>
>>> [paste your code]
>>>
>>> How do I fix it?
```

### Example 2: Generate Boilerplate

```bash
dcode "Create a complete Express.js REST API with JWT authentication"
```

### Example 3: Refactor Code

```bash
dfile messy_code.js "Refactor this code to be more maintainable and add comments"
```

### Example 4: Learn New Concepts

```bash
ds

>>> Explain how async/await works in JavaScript with examples
```

### Example 5: Code Review

```bash
dfile mycode.py "Review this code for bugs, security issues, and suggest improvements"
```

---

## Part 12: Integration with Your Workflow

### Auto-Push to GitHub

Combine with auto-commit:

```bash
# Make changes
nano myfile.js

# Stage
git add myfile.js

# Auto-generate commit message
dcommit

# Push
git push
```

### Integrate with PM2 Debugging

```bash
# Get error logs
pm2 logs vankush-bot --err --lines 100 > errors.txt

# Ask DeepSeek to debug
dfile errors.txt "What's causing these errors and how do I fix them?"
```

### Generate Documentation

```bash
dfile index.js "Generate comprehensive documentation for this code" > DOCUMENTATION.md
```

---

## Troubleshooting

### Error: "Failed to load model"

```bash
# Check if model exists
ollama list

# If not listed, download it
ollama pull deepseek-coder-v2:16b
```

### Error: "Connection refused"

```bash
# Check if Ollama is running
sudo systemctl status ollama

# If not running, start it
sudo systemctl start ollama
```

### Model is Slow

**Solutions**:
1. Use smaller model: `ollama pull qwen2.5-coder:7b`
2. Check RAM usage: `free -h` (should have free RAM)
3. Close other applications: `pm2 stop all`
4. Reduce context: Keep prompts under 2000 tokens

### Out of Disk Space

```bash
# Check disk usage
df -h

# Remove unused models
ollama list
ollama rm model-name

# Clear Docker cache if needed
docker system prune -a
```

---

## Part 13: Update Models

New versions are released regularly:

```bash
# Update specific model
ollama pull deepseek-coder-v2:16b

# Update all models
for model in $(ollama list | awk 'NR>1 {print $1}'); do
    echo "Updating $model..."
    ollama pull "$model"
done
```

---

## Next Steps

You now have THREE AI coding options:

1. ✅ **Claude Code** ($20/month) - Complex tasks
2. ✅ **Gemini CLI** (FREE, 1,000/day) - Quick questions
3. ✅ **DeepSeek Local** (FREE, unlimited) - Everything else! ✅

**Your complete FREE infrastructure**:
- ✅ Oracle Cloud: 24GB RAM server ($0/month)
- ✅ Gemini CLI: 1,000 requests/day ($0/month)
- ✅ DeepSeek Coder: Unlimited usage ($0/month)
- **Total: $0/month forever!** 🎉

**Next guides**:
1. **AUTO_PUSH_GITHUB.md** - Configure automatic git commits
2. **REMOTE_CODING_SETUP.md** - Code from Slack, Telegram, SMS
3. **FIVERR_GIG_SETUP.md** - Set up gigs to earn money for Claude Pro

---

## Performance Tips

### Make Responses Faster

1. **Use smaller models**: `qwen2.5-coder:7b` is 2x faster
2. **Keep prompts short**: Don't paste entire files if not needed
3. **Use one-shot commands**: `dcode` is faster than `ds` chat
4. **Pre-load model**: Run `ollama run deepseek-coder-v2:16b ""` on boot

### Maximize Quality

1. **Use larger model**: `deepseek-coder-v2:16b`
2. **Give context**: Include relevant code snippets
3. **Be specific**: "Add error handling to line 42" vs "improve code"
4. **Iterate**: Ask follow-up questions to refine

### Save Money on Claude

- **Before asking Claude**: Try DeepSeek first!
- **If DeepSeek answers well**: You saved $0.30
- **If DeepSeek fails**: Then ask Claude

**Estimated savings**: $15-20/month if used properly

---

## Cost Breakdown

**DeepSeek Coder Local LLM**:
- Initial download: One-time (10GB)
- Electricity: ~$0.50/month (Oracle Cloud is free)
- API costs: **$0** (runs locally)
- Usage limits: **None** (unlimited)

**Total Cost**: **~$0.50/month** 🎉

Compare to:
- Claude Pro: $20/month
- GPT-4: $60+/month for heavy usage
- Copilot: $10/month

**You're saving $20-70/month!** 💰
