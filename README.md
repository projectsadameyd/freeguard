#free-Guard🛡️
### AI-Powered Discord Moderation Bot
**Individually made by Adam Eyd**

---

## Overview

free-Guard is an enterprise-grade AI moderation bot for Discord that moderates **text, images, and voice chat** in real time. Text is analysed by `google/gemma-4-31b-it:free` via OpenrouterAI, images are screened by a Hugging Face NSFW-detection model, and voice channels are transcribed on the fly with Whisper and run through the same moderation pipeline. Every violation is deleted, strikes are logged, and all stored user data is encrypted with **AES-256-GCM**.

---

## Features

- 🤖 **AI text moderation** via OpenrouterAI (`google/gemma-4-31b-it:free`), backed by a regex hard-block list for instant, zero-latency catches
- 🖼️ **Image moderation** — attachments are screened by Hugging Face's `Falconsai/nsfw_image_detection` model (free tier, no card required); anything ≥70% NSFW confidence is removed
- 🎙️ **Voice channel moderation** — the bot auto-joins monitored voice channels, records speech per-user (Opus → PCM → WAV), transcribes it with `openai/whisper-large-v3` via Hugging Face, and runs the transcript through the same AI moderation engine; violations trigger a voice disconnect or ban
- ⚡ **Instant removal** of violating messages (no delay)
- 🔐 **AES-256-GCM encryption** for all stored data (keys derived via PBKDF2 / 310,000 iterations / SHA-512)
- 🎯 **3-strike system** — DM warnings on strikes 1 & 2, automatic 24h ban on strike 3, with scheduled auto-unban and strike reset
- 📖 **Encrypted personal logbooks** — viewable by admins only, decrypted on demand
- 🔏 **HMAC-hashed file names** — Discord user IDs never appear on disk
- 💬 **Channel bypass** — text/voice channels starting with `unfiltered` (and voice channels starting with `gaming`) skip moderation entirely
- 🔄 **Auto-restart keepalive** with an HTTP ping server (UptimeRobot compatible)

---

## Setup on Replit

### 1. Upload the project
Upload and unzip this folder into your Replit project (the `.replit` file already targets the `nodejs-20` module and Cloud Run deployment).

### 2. Install dependencies
```bash
npm install
```

### 3. Set environment variables
In Replit, go to **Secrets** (lock icon) and add:

| Key | Value |
|-----|-------|
| `DISCORD_TOKEN` | Your Discord bot token |
| `OPENROUTER_API_KEY` | Your OpenRouter API key |
| `HUGGINGFACE_TOKEN` | Your Hugging Face access token (Read role — free) |
| `ENCRYPTION_SECRET` | A long random string (48+ chars) |
| `HASH_SECRET` | A different long random string (48+ chars) |

Generate secure secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Locally, copy `.env.example` to `.env` and fill in the same values instead.

### 4. Discord bot setup
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create a new application → Bot
3. Enable these **Privileged Gateway Intents**:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
4. Copy the token into your Secrets/`.env`
5. Invite the bot with these permissions:
   - Manage Messages
   - Kick Members
   - Ban Members
   - Send Messages
   - Read Message History
   - Connect / Speak (for voice moderation)

**Invite URL scopes:** `bot` + `applications.commands`
**Required permissions integer:** `1099780079686`

### 5. Run
```bash
node index.js         # bot only
node keepalive.js     # bot + auto-restart + HTTP ping server (recommended for Replit)
```

### 6. Keep alive with UptimeRobot (optional but recommended)
- Create a free account at [uptimerobot.com](https://uptimerobot.com)
- Add an HTTP monitor pointing at your Replit URL (port 3000, externally exposed on 80)
- Set the interval to 5 minutes

---

## Slash Commands

### Admin commands (Moderate Members permission required)
| Command | Description |
|---------|-------------|
| `/guard-log @user` | View a user's full encrypted strike log |
| `/guard-strikes @user` | View a user's current strike count |
| `/guard-clear @user` | Clear all strikes for a user |
| `/guard-status` | View bot status and system info |
| `/guard-unban @user` | Manually unban a user before the 24h window expires (requires Ban Members) |

### User commands
| Command | Description |
|---------|-------------|
| `/my-strikes` | Check your own strike count |
| `/my-log` | View your personal moderation history (last 5 violations) |

---

## What gets moderated

Violations are removed instantly (text) or trigger a disconnect/ban (voice). The AI and hard-block filter catch:

- 🚫 Racist and ethnic slurs (including obfuscated/leetspeak variants)
- 🚫 Violent threats (direct and implied)
- 🚫 Sexual threats and harassment
- 🚫 Sexual content (explicit and suggestive, text and image)
- 🚫 Profanity and swear words
- 🚫 Self-harm or suicide encouragement
- 🚫 Doxxing and personal information sharing
- 🚫 Extremist or radicalisation content
- 🚫 Circumvented spellings (f*ck, n1gga, etc.)

**Exception:** channels whose names start with `unfiltered` skip all text/image moderation; voice channels starting with `unfiltered` or `gaming` are never auto-joined.

---

## How voice moderation works

1. When a non-bot member joins a monitored voice channel, the bot joins (muted, not deafened) and starts listening.
2. Per-user audio is captured when Discord reports someone speaking, buffered as Opus packets, and stops after ~1.2s of silence (5s cooldown between captures per user).
3. Opus packets are decoded to PCM with `opusscript`, wrapped into a WAV container, and sent to `openai/whisper-large-v3` on Hugging Face for transcription.
4. The transcript is run through the same moderation engine used for text messages.
5. A violation triggers a voice disconnect + strike (or an immediate 24h ban for sexual content / violent threats), each with a DM notification.
6. The bot automatically leaves a voice channel 15 seconds after it becomes empty of human members.

---

## Encryption details

| Feature | Implementation |
|---------|----------------|
| Algorithm | AES-256-GCM (authenticated) |
| Key derivation | PBKDF2 / SHA-512 / 310,000 iterations |
| IV | 128-bit random per record |
| Auth tag | 128-bit (prevents tampering) |
| Salt | 256-bit random per record |
| File naming | HMAC-SHA256 hashed user IDs |
| Log lines | Each line individually encrypted |

All `.enc` files in `data/` are opaque binary blobs — unreadable without the `ENCRYPTION_SECRET` and `HASH_SECRET`.

---

## Admin log reader (server-side only)
```bash
node readlog.js             # Today's log
node readlog.js 2025-01-15  # Specific date
```

---

## File structure
```
freeguard/
├── index.js              # Main bot — commands, message/voice event handling
├── keepalive.js          # Auto-restart + HTTP ping server
├── readlog.js             # Admin log decryption utility
├── package.json
├── .env.example           # Copy to .env and fill in
├── .replit                # Replit run/deploy config
└── src/
    ├── moderator.js       # AI text/image moderation engine + hard-block patterns
    ├── voiceModerator.js   # Voice capture, transcription, and enforcement
    ├── strikeManager.js    # Strike system + encrypted per-user storage
    ├── encryption.js       # AES-256-GCM engine + HMAC user-ID hashing
    └── logger.js           # Encrypted daily log writer
```

`data/` and `logs/` are created automatically at runtime and are git-ignored, along with `.env` and any `*.enc` files.

---

## License
Built and owned by **Adam Eyd**.
