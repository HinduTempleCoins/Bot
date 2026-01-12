# Simple Setup for Non-Programmers

**You don't need to know programming, terminal, Python, Node.js, or Docker!**

This guide shows you how to install GUI software (like installing Microsoft Word or Chrome) that works like Claude Code.

**What you'll do**:
1. Download and install VS Code (like installing any app)
2. Click to install Continue extension
3. Paste your Gemini API key
4. **Done!** Chat with AI that edits your files

**Time**: 10 minutes
**Technical knowledge needed**: None (just clicking and pasting)

---

## Step 1: Download VS Code (2 minutes)

**VS Code** is Microsoft's free code editor. It looks like a fancy text editor.

### For Windows:

1. Go to: **https://code.visualstudio.com/**
2. Click the big blue **"Download for Windows"** button
3. Wait for download (file: `VSCodeSetup.exe`)
4. **Double-click** the downloaded file
5. Click **"Next"** → **"Next"** → **"Install"**
6. Wait 1 minute for installation
7. Click **"Finish"**

**VS Code opens!** 🎉

### For Mac:

1. Go to: **https://code.visualstudio.com/**
2. Click **"Download for Mac"**
3. Wait for download (file: `VSCode-darwin.zip`)
4. **Double-click** the ZIP file (it extracts)
5. **Drag** "Visual Studio Code" to your **Applications** folder
6. Open **Applications** folder
7. **Double-click** "Visual Studio Code"

**VS Code opens!** 🎉

---

## Step 2: Install Continue Extension (3 minutes)

**Continue** is like having Claude Code inside VS Code.

### In VS Code:

1. Look at the **left sidebar** (vertical icons)
2. Click the **Extensions** icon (looks like 4 squares)
   - OR press `Ctrl+Shift+X` (Windows) or `Cmd+Shift+X` (Mac)
3. You'll see a search box that says **"Search Extensions in Marketplace"**
4. Type: **continue**
5. You'll see **"Continue - Codestral, Claude, and more"** at the top
6. Click the blue **"Install"** button
7. Wait 10 seconds
8. You'll see a new icon in the left sidebar (Continue logo)

**Continue is installed!** 🎉

---

## Step 3: Get Gemini API Key (5 minutes)

**You already have one!** But if you need a new one:

1. Go to: **https://aistudio.google.com/app/apikey**
2. Sign in with your Google account
3. Click **"Create API Key"** button
4. Click **"Create API key in new project"**
5. You'll see a long string like: `AIzaSyB4dfej4AOISo5ebfr31QWUkY4zUJinbXk`
6. Click the **"Copy"** button

**Keep this window open!** You'll paste this key in the next step.

---

## Step 4: Configure Continue with Gemini (2 minutes)

### In VS Code:

1. Click the **Continue icon** in the left sidebar (the new icon that appeared)
2. You'll see a Continue chat panel open
3. At the bottom of the Continue panel, click the **gear icon** ⚙️
4. A file called `config.json` opens
5. **Select all the text** (`Ctrl+A` or `Cmd+A`)
6. **Delete it all**
7. **Copy and paste** this (replace with your key below):

```json
{
  "models": [
    {
      "title": "Gemini 2.5 Flash",
      "provider": "gemini",
      "model": "gemini-2.5-flash-lite",
      "apiKey": "PASTE_YOUR_GEMINI_KEY_HERE"
    }
  ]
}
```

8. **Replace** `PASTE_YOUR_GEMINI_KEY_HERE` with your actual key
9. **Save**: Press `Ctrl+S` (Windows) or `Cmd+S` (Mac)
10. **Close the config file**: Click the X on that tab

**You're done!** 🎉

---

## Step 5: Test It! (1 minute)

### Open Your Bot Folder:

1. In VS Code, click **"File"** menu (top left)
2. Click **"Open Folder..."**
3. Navigate to where your Bot code is (probably in your Downloads or Documents)
4. Click **"Select Folder"**

### Chat with AI:

1. Click the **Continue icon** in left sidebar (if panel not already open)
2. At the bottom, you'll see a text box that says **"Ask Continue anything"**
3. Type: **"Explain what index.js does"**
4. Press **Enter**

**AI will read the file and explain it!** Just like Claude Code! 🎉

---

## How to Use Continue (Like Claude Code)

### To Ask Questions:

In the Continue chat box, type:
```
What does this Discord bot do?

How do I add a new command?

Explain the emotional relationship tracking system
```

### To Edit Code:

1. **Open a file** (like `index.js`) in VS Code
2. **Select some code** (click and drag)
3. **Type in Continue chat**:
```
Refactor this function to be more readable

Add error handling to this code

Add comments explaining what this does
```

4. AI will suggest changes
5. Click **"Accept"** to apply the changes!

### To Write New Code:

Just ask in Continue chat:
```
Add a new /settings command to the Discord bot that shows user preferences

Create a function to calculate fibonacci numbers

Write a test for the emotional tracking system
```

---

## Examples

### Example 1: Understanding Code

**You type**:
```
What Discord commands does the bot support?
```

**AI responds**:
```
The bot supports these commands:
- /cryptology - Opens dialogue menu
- /price - Check token prices
- /generate - Create AI images
- /help - Show help menu
...
```

### Example 2: Editing Code

1. Open `index.js`
2. Select a function (click and drag to highlight it)
3. Type in Continue:
```
Add error handling to this function
```

4. AI shows suggested changes with **Accept/Reject** buttons
5. Click **"Accept"**
6. Code is updated!

### Example 3: Adding New Feature

**You type**:
```
Add a new command called /status that shows if the bot is online and how many servers it's in
```

**AI writes the code and shows you where to add it!**

---

## Keyboard Shortcuts

- `Ctrl+L` (Windows) or `Cmd+L` (Mac): Focus the Continue chat
- `Ctrl+I` (Windows) or `Cmd+I` (Mac): Quick inline edit
- `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac): Refactor

---

## Cost

**VS Code**: FREE ✅
**Continue Extension**: FREE ✅
**Gemini API**: FREE ✅ (1,000 requests per day)

**Total**: $0/month! 🎉

---

## Common Questions

### Q: Do I need to install Python/Node.js/Docker?

**A: NO!** Just VS Code and Continue extension. That's it.

### Q: Do I need Oracle Cloud?

**A: NO!** Just use VS Code on your computer. Oracle Cloud is optional (for advanced users).

### Q: Is this really like Claude Code?

**A: YES!** It works the exact same way:
- Chat interface
- AI reads your files
- AI can edit your code
- Accept/Reject changes

The ONLY difference: You use VS Code instead of Claude's app.

### Q: What if I hit the 1,000 requests/day limit?

**Options**:
1. Wait until midnight PST (limit resets)
2. Create another Google account with new API key (not recommended)
3. Ask for help setting up local LLM (requires more tech knowledge)

---

## Troubleshooting

### Issue: "API key is invalid"

**Fix**:
1. Go back to https://aistudio.google.com/app/apikey
2. Delete the old key
3. Create new key
4. Copy it
5. Paste it in Continue config (Step 4 above)

### Issue: Continue panel is empty/not working

**Fix**:
1. Close VS Code completely
2. Re-open VS Code
3. Click Continue icon again

### Issue: AI is giving wrong answers

**Fix**:
1. Be more specific in your questions
2. Tell AI which files to look at:
```
Look at index.js and tell me what the bot does
```

### Issue: Can't find my Bot folder

**Fix**:
1. Open File Explorer (Windows) or Finder (Mac)
2. Search for "index.js"
3. Note the folder location
4. In VS Code: File → Open Folder → Navigate there

---

## What's Next?

### Once You're Comfortable:

If you want to also code from your **phone**, you can:
1. Hire someone on Fiverr ($10-20) to set up Code-Server on Oracle Cloud
2. Then you'll have VS Code in your browser (accessible from phone)

**But for now, just use VS Code on your computer!**

### Learning More:

- VS Code Tutorial: https://code.visualstudio.com/docs/getstarted/introvideos
- Continue Documentation: https://docs.continue.dev/

---

## Summary

**What you installed**:
1. ✅ VS Code (Microsoft's free code editor)
2. ✅ Continue extension (AI assistant)
3. ✅ Configured with free Gemini API

**What you can do now**:
- ✅ Chat with AI about your code
- ✅ Ask AI to edit your files
- ✅ Get code explanations
- ✅ Add new features by asking
- ✅ Works EXACTLY like Claude Code

**What you DON'T need**:
- ❌ Terminal / command line
- ❌ Python / Node.js / Docker installation
- ❌ Oracle Cloud account
- ❌ Programming knowledge

**Cost**: **$0/month** 🎉

---

## You're All Set!

**You now have a Claude Code-like interface for FREE!**

Just open VS Code, click Continue icon, and start chatting!

**Example first message**:
```
Help me understand how the Discord bot works
```

Happy coding! 🚀
