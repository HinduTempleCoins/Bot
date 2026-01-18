# Oracle Cloud Setup - Copy & Paste Guide

**Super simple version**: I'll tell you what to type, you copy and paste it!

**Part 1**: Website (sign up on Oracle Cloud website)
**Part 2**: Copy/paste commands (I give you commands, you paste them)

**Time**: 30-45 minutes total
**Technical knowledge**: None! Just copying and pasting

---

## Part 1: Sign Up on Oracle Cloud Website (15 minutes)

This part is all clicking buttons on a website - no coding!

### Step 1: Go to Oracle Cloud

1. Open your web browser
2. Go to: **https://www.oracle.com/cloud/free/**
3. Click the big **"Start for free"** button

### Step 2: Create Account

1. **Email**: Enter your email
2. **Country/Territory**: Choose your country
3. Click **"Verify my email"**
4. Check your email for a verification code
5. Enter the code
6. Click **"Continue"**

### Step 3: Fill in Details

1. **Account Type**: Choose **"Individual"** (not company)
2. Fill in:
   - First name
   - Last name
   - Address (your home address)
   - City
   - State/Province
   - ZIP/Postal code
   - Phone number

### Step 4: Payment Verification

**DON'T WORRY**: They verify your identity with your credit card but **NEVER charge you** for free tier services. It's like a $1 hold that's immediately released.

1. Click **"Add payment verification method"**
2. Enter credit card details
3. Click **"Finish"**

### Step 5: Wait for Account Activation

- You'll see: **"Your account is being set up"**
- Wait 5-15 minutes
- You'll get an email when ready
- Leave this page open!

### Step 6: Choose Your Region (IMPORTANT!)

When account is ready:

1. You'll be asked to **"Choose your home region"**
2. Choose region **closest to you**:
   - **US East Coast**: Choose "US East (Ashburn)"
   - **US West Coast**: Choose "US West (Phoenix)"
   - **Europe**: Choose "UK South (London)" or "Germany Central (Frankfurt)"
   - **Other**: Choose closest region

**⚠️ WARNING**: You can NEVER change region after this! Choose wisely.

3. Click **"Continue"**

**You're now in the Oracle Cloud Dashboard!** 🎉

---

## Part 2: Create Your Free Server (10 minutes - Website)

Still on the website, no terminal yet!

### Step 1: Create Compute Instance

1. In Oracle Cloud Dashboard, look for **"Create a VM instance"** box
2. Click **"Create instance"** button
3. You'll see a form

### Step 2: Configure Instance

**Name your instance**:
- Where it says **"Name"**, type: `vankush-server`

**Keep everything default EXCEPT**:

#### Change Image:
1. Find section called **"Image and shape"**
2. Click **"Change image"** button
3. Select **"Canonical Ubuntu"**
4. Choose **"22.04"** (the LTS version)
5. Click **"Select image"**

#### Change Shape (IMPORTANT - This is the FREE one!):
1. Click **"Change shape"** button
2. Click **"Ampere"** at the top
3. Select **"VM.Standard.A1.Flex"**
4. You'll see sliders:
   - **Number of OCPUs**: Move slider to **4** (max free)
   - **Amount of memory (GB)**: Move slider to **24** (max free)
5. Click **"Select shape"**

**⚠️ IMPORTANT**: Make sure it says "Always Free-eligible" somewhere!

### Step 3: Networking

In the **"Networking"** section:
- **"Assign a public IPv4 address"**: Make sure this is **CHECKED** ✓
- Leave everything else as default

### Step 4: SSH Keys (IMPORTANT!)

In the **"Add SSH keys"** section:

1. Select **"Generate a key pair for me"** (should be selected by default)
2. Click **"Save private key"** button
   - Save it somewhere safe! Like your **Documents** folder
   - Name it: `oracle_key` (or whatever you want)
3. **Also** click **"Save public key"** (as backup)

**⚠️ DO NOT LOSE THIS FILE!** You'll need it to access your server!

### Step 5: Create the Server!

1. Scroll down to bottom
2. Click the big **"Create"** button
3. Wait 2-3 minutes

You'll see a status indicator:
- Orange "Provisioning" → Server is being created
- Green "Running" → **Server is ready!** 🎉

### Step 6: Write Down Your Server's IP Address

Once status is green "Running":

1. Look for **"Public IP address"**: `xxx.xxx.xxx.xxx`
2. **COPY THIS NUMBER** somewhere safe (Notepad, phone, etc.)

**Example**: `129.146.123.45` (yours will be different)

You'll need this IP address to connect!

---

## Part 3: Open Firewall Ports (5 minutes - Website)

Still on Oracle website:

### Step 1: Go to Subnet

1. On your instance page, scroll down
2. Find section called **"Primary VNIC"** or **"Instance details"**
3. Click the **"Subnet"** link (it's blue and clickable)

### Step 2: Edit Security List

1. On the left sidebar, click **"Security Lists"**
2. Click **"Default Security List for..."** (the one that's listed)

### Step 3: Add Ingress Rules

We need to open ports so you can access your services.

**For each rule below, click "Add Ingress Rules" button and fill in**:

**Rule 1 - HTTP (for websites)**:
- **Source CIDR**: `0.0.0.0/0`
- **IP Protocol**: `TCP`
- **Destination Port Range**: `80`
- **Description**: `HTTP for websites`
- Click **"Add Ingress Rules"**

**Rule 2 - HTTPS (for secure websites)**:
- **Source CIDR**: `0.0.0.0/0`
- **IP Protocol**: `TCP`
- **Destination Port Range**: `443`
- **Description**: `HTTPS for websites`
- Click **"Add Ingress Rules"**

**Rule 3 - Custom Apps**:
- **Source CIDR**: `0.0.0.0/0`
- **IP Protocol**: `TCP`
- **Destination Port Range**: `3000-9000`
- **Description**: `Custom applications`
- Click **"Add Ingress Rules"**

**Done with website part!** Now let's connect from your computer.

---

## Part 4: Open Terminal/Command Line on Your Computer

### For Windows:

**Option 1: PowerShell (Recommended)**:
1. Click **Start** button (Windows logo)
2. Type: **powershell**
3. Click **"Windows PowerShell"** (the blue one)
4. A blue/black window opens - **this is the terminal!**

**Option 2: Command Prompt**:
1. Click **Start** button
2. Type: **cmd**
3. Click **"Command Prompt"**
4. A black window opens

### For Mac:

1. Press **Cmd + Space** (opens Spotlight)
2. Type: **terminal**
3. Press **Enter**
4. A white/black window opens - **this is the terminal!**

**You'll see something like**:
```
Windows: PS C:\Users\YourName>
Mac: username@computer ~ %
```

**This is where you'll paste commands!**

---

## Part 5: Connect to Your Server (5 minutes - Copy/Paste)

Now we'll connect to your Oracle server using the terminal.

### Step 1: Prepare Your SSH Key

**Windows (PowerShell)**:

Copy and paste this (press Enter after pasting):
```powershell
cd ~\Downloads
dir oracle_key*
```

You should see your SSH key file listed.

Now copy and paste this (replace `YOUR_ORACLE_IP` with your actual IP):
```powershell
ssh -i .\oracle_key ubuntu@YOUR_ORACLE_IP
```

**Example** (your IP will be different):
```powershell
ssh -i .\oracle_key ubuntu@129.146.123.45
```

**Mac (Terminal)**:

Copy and paste this (press Enter):
```bash
cd ~/Downloads
ls oracle_key*
```

You should see your SSH key file.

Now copy and paste this (replace `YOUR_ORACLE_IP` with your actual IP):
```bash
chmod 600 oracle_key
ssh -i ./oracle_key ubuntu@YOUR_ORACLE_IP
```

**Example** (your IP will be different):
```bash
ssh -i ./oracle_key ubuntu@129.146.123.45
```

### Step 2: First Connection

**First time connecting**, you'll see a message like:
```
The authenticity of host '129.146.123.45' can't be established.
Are you sure you want to continue connecting (yes/no)?
```

**Type**: `yes` and press **Enter**

### Step 3: You're Connected!

You should see:
```
Welcome to Ubuntu 22.04.3 LTS
...
ubuntu@vankush-server:~$
```

**YOU'RE IN YOUR SERVER!** 🎉

The `ubuntu@vankush-server:~$` part means you're now typing commands on your cloud server, not your computer!

---

## Part 6: Install Software (10 minutes - Copy/Paste)

Now I'll give you commands to copy/paste. Each block does one thing.

**⚠️ TIP**: Copy the **entire block** of commands, paste it, press **Enter**. Wait for it to finish before pasting the next block.

### Update System (1 minute)

Copy and paste this:
```bash
sudo apt update && sudo apt upgrade -y
```

**What this does**: Updates all the software on your server (like Windows Update)

**You'll see**: Lots of text scrolling. Wait until you see `ubuntu@vankush-server:~$` again.

### Install Node.js (1 minute)

Copy and paste this:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

**What this does**: Installs Node.js (needed to run your Discord bot)

**Test it worked**:
```bash
node --version
```

Should show something like: `v20.11.0` ✅

### Install Git (30 seconds)

Copy and paste this:
```bash
sudo apt install -y git
```

**What this does**: Installs Git (to download your code from GitHub)

### Install PM2 (30 seconds)

Copy and paste this:
```bash
sudo npm install -g pm2
```

**What this does**: Installs PM2 (keeps your bot running 24/7)

### Install Python (1 minute)

Copy and paste this:
```bash
sudo apt install -y python3-pip
```

**What this does**: Installs Python (needed for some tools)

**Done installing software!** ✅

---

## Part 7: Deploy Your Discord Bot (5 minutes - Copy/Paste)

### Download Your Bot Code

Copy and paste this:
```bash
git clone https://github.com/HinduTempleCoins/Bot.git
cd Bot
git checkout claude/update-todos-9iXhF
```

**What this does**: Downloads your bot code from GitHub

### Install Bot Dependencies

Copy and paste this:
```bash
npm install
```

**What this does**: Installs all the packages your bot needs

**You'll see**: Lots of text. Wait until done (30-60 seconds).

### Create Environment File (with your tokens)

Copy and paste this:
```bash
nano .env
```

**What this does**: Opens a simple text editor

**You'll see**: A blank screen with options at the bottom

**Now type** (or paste) these two lines with YOUR actual tokens:
```
DISCORD_TOKEN=your_actual_discord_token_here
GEMINI_API_KEY=your_actual_gemini_key_here
```

**Replace**:
- `your_actual_discord_token_here` with your Discord bot token
- `your_actual_gemini_key_here` with your Gemini API key

**To save and exit**:
1. Press **Ctrl+O** (that's the letter O, not zero)
2. Press **Enter** (saves the file)
3. Press **Ctrl+X** (exits the editor)

**You're back at the command line!**

### Start Your Bot!

Copy and paste this:
```bash
pm2 start index.js --name vankush-bot
```

**What this does**: Starts your Discord bot and keeps it running forever!

**You should see**:
```
┌─────┬──────────────┬─────────┐
│ id  │ name         │ status  │
├─────┼──────────────┼─────────┤
│ 0   │ vankush-bot  │ online  │
└─────┴──────────────┴─────────┘
```

**Status is "online"** = Bot is running! ✅

### Check Bot Logs

Copy and paste this:
```bash
pm2 logs vankush-bot --lines 20
```

**You should see**:
```
✅ Logged in as VanKushFamilyMod#3991
🎮 Crypt-ology dialogue system loaded
```

**If you see those emoji** = Bot is working perfectly! 🎉

**To stop viewing logs**: Press **Ctrl+C**

### Make Bot Auto-Start on Reboot

Copy and paste this:
```bash
pm2 save
pm2 startup
```

**It will show a command** starting with `sudo...`

**Copy that entire command** and paste it, press Enter.

**What this does**: If server restarts, bot automatically starts again!

---

## Part 8: Stop Railway (Save $5/month)

Now that your bot runs on free Oracle Cloud, you can stop Railway!

1. Go to: **https://railway.app/**
2. Log in
3. Click your Bot project
4. Click **Settings** tab
5. Scroll to bottom
6. Click **"Delete Service"** or **"Pause Service"**

**You're now saving $5/month!** 💰

---

## Part 9: Check Bot Commands

Copy and paste this:
```bash
pm2 status
```

**Shows**: All running applications

Copy and paste this:
```bash
pm2 logs vankush-bot
```

**Shows**: Real-time logs (press Ctrl+C to stop viewing)

Copy and paste this:
```bash
pm2 restart vankush-bot
```

**Restarts the bot** (if you make changes)

---

## Part 10: Disconnect from Server

When you're done:

**Type**:
```bash
exit
```

**You're back on your computer!**

**To reconnect later**:
```bash
ssh -i ~/Downloads/oracle_key ubuntu@YOUR_ORACLE_IP
```

(Use your actual IP)

---

## Summary

**What you did**:
1. ✅ Created Oracle Cloud account (website)
2. ✅ Created free 24GB RAM server (website)
3. ✅ Opened firewall ports (website)
4. ✅ Opened terminal on your computer
5. ✅ Connected to server (copy/paste SSH command)
6. ✅ Installed software (copy/paste commands)
7. ✅ Deployed Discord bot (copy/paste commands)
8. ✅ Bot runs 24/7 for FREE!

**Cost**: **$0/month** (FREE FOREVER) 🎉

**Your bot is now**:
- Running on professional cloud infrastructure
- Available 24/7
- Completely free
- Way more powerful than Railway

---

## Quick Reference

**Connect to server**:
```bash
ssh -i ~/Downloads/oracle_key ubuntu@YOUR_IP
```

**Check bot status**:
```bash
pm2 status
```

**View bot logs**:
```bash
pm2 logs vankush-bot
```

**Restart bot**:
```bash
pm2 restart vankush-bot
```

**Update bot code**:
```bash
cd ~/Bot
git pull
npm install
pm2 restart vankush-bot
```

---

## Troubleshooting

### Can't connect with SSH

**Error**: "Connection refused"

**Fix**:
1. Make sure instance status is "Running" (green) in Oracle dashboard
2. Double-check your IP address
3. Make sure you opened firewall ports (Part 3)

### Bot won't start

**Check logs**:
```bash
pm2 logs vankush-bot --lines 50
```

**Common issues**:
- Wrong Discord token in `.env` file
- Wrong Gemini API key in `.env` file

**Fix**:
```bash
cd ~/Bot
nano .env
# Fix the tokens
# Ctrl+O, Enter, Ctrl+X to save
pm2 restart vankush-bot
```

---

## Need Help?

If anything goes wrong:

1. **Copy the error message** (exactly as shown)
2. Take a screenshot if possible
3. Tell me:
   - What step you're on
   - What you typed/pasted
   - What error you got

I'll help you fix it! 🛠️

---

**Ready to start?** Follow from **Part 1** (the Oracle website signup)!
