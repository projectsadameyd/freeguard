# free-Guard Dashboard — Setup Guide

> Author: **Adam Eyd** · Works with any public hosting setup (VPS, Raspberry Pi
> behind CGNAT, etc.). This guide covers the recommended **Raspberry Pi +
> Tailscale Funnel** path used in production.

---

## 1. Install the project

On a fresh VM or Pi:

```bash
git clone https://github.com/adameyd/free-guard.git && cd free-guard
./install/install-dashboard.sh        # npm install + systemd unit 'freeguard'
```

Or manually:

```bash
npm install
mkdir -p data logs
```

## 2. Environment

```bash
cp .env.example .env
```

Minimum values (generate secrets with the command in the README):

```ini
DISCORD_TOKEN=...
OPENROUTER_API_KEY=...
HUGGINGFACE_TOKEN=...
ENCRYPTION_SECRET=...
HASH_SECRET=...
DASHBOARD_PORT=3002
ENABLE_DASHBOARD=true
```

> ⚠️ `DASHBOARD_PORT` defaults to **3002**. Use 3001 only if you are certain it
> is free on your host — many other Node services already bind 3001.

## 3. Discord OAuth application (for the dashboard)

The login is **Discord OAuth2** — separate from the bot token.

1. [Discord Developer Portal](https://discord.com/developers/applications)
   → **New Application** → **OAuth2 → General**.
2. Copy **Client ID** and **Client Secret**.
3. Add a **Redirect**:
   `<YOUR_PUBLIC_URL>/api/auth/callback`.
4. Default scopes needed: `identify`, `guilds`.
5. Add the values to `.env`:

```ini
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DASHBOARD_BASE_URL=https://<your-magic-dns>.ts.net
ALLOWED_GUILD_IDS=            # or comma-separated guild ids to lock down
```

### Exposing publicly — Raspberry Pi (CGNAT) via Tailscale Funnel

```bash
tailscale up
tailscale funnel --bg 3002
```

`--bg` makes the funnel persistent. Confirm with `tailscale funnel status`.

Your public URL is `https://<tailnet-machine-dns>.ts.net` — exactly what goes
in `DASHBOARD_BASE_URL`.

### Alternative — Cloudflare Tunnel

```bash
cloudflared tunnel create freeguard
cloudflared tunnel route dns freeguard fg.yourdomain.com
# config.yml: tunnel: freeguard, service: http://localhost:3002
sudo systemctl enable --now cloudflared
```

## 4. OAuth redirect (critical)

The token `<your-machine>.ts.net` in your config must **exactly match**
the redirect you registered in the Discord OAuth app, including the trailing
`/api/auth/callback`.

## 5. Troubleshooting

| Symptom | Fix |
|---------|-----|
| Dashboard shows nothing / loops to login | Compare `DASHBOARD_BASE_URL` with the registered redirect; hard-refresh (**Ctrl+Shift+R**) |
| `403` on guild stats (mixed 403/500) | Ensure your Discord account is a **moderator/admin** in the guild and `ALLOWED_GUILD_IDS` includes it |
| Discord `opcode 8 rate limited` on members | Members now load via cache first, REST fallback second — just wait a few seconds |
| Funnel dies after reboot | Use `tailscale funnel --bg` or the `tailscale-funnel.service` unit |