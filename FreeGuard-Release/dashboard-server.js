// ============================================================
//  USCCB:free-Guard — Dashboard API Server
//  Express REST API on port 3001
//  Secured via Discord OAuth2 admin verification
//  EchoBastion Group
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PermissionFlagsBits } = require('discord.js');

const { getConfig, setConfig, resetConfig, DEFAULT_CONFIG } = require('./src/config');
const {
  getStrikes, getUserLog, clearStrikes, recordBan, removeBan,
  addStrike, getPendingAppeals, resolveAppeal, getGuildStats,
  listActiveBans,
} = require('./src/strikeManager');
const { readLogEntries, getLogFiles, getStats } = require('./src/logger');
const { getVoiceActivity } = require('./src/voiceModerator');

const DASHBOARD_PORT = parseInt(process.env.DASHBOARD_PORT || '3001', 10);
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DASHBOARD_BASE_URL = process.env.DASHBOARD_BASE_URL || `http://localhost:${DASHBOARD_PORT}`;
const ALLOWED_GUILDS = (process.env.ALLOWED_GUILD_IDS || '').split(',').filter(Boolean);

const app = express();
app.use(cors());
app.use(express.json());

// Serve the built-in dashboard UI at the API root (same tunnel)
const DASHBOARD_DIR = path.join(__dirname, 'dashboard');
const noCache = (res) => res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
app.get('/', (req, res) => {
  noCache(res);
  try {
    let index = fs.readFileSync(path.join(DASHBOARD_DIR, 'index.html'), 'utf8');
    index = index.split('__FG_API_URL__').join(DASHBOARD_BASE_URL);
    index = index.split('__FG_CLIENT_ID__').join(DISCORD_CLIENT_ID || '');
    res.type('html').send(index);
  } catch {
    res.status(500).send('Dashboard UI not found');
  }
});
app.use(express.static(DASHBOARD_DIR, { setHeaders: noCache }));

// ══════════════════════════════════════════════════════════════
//  AUTH: Discord OAuth2
// ══════════════════════════════════════════════════════════════

// Verify a user's Discord access token and check admin permissions.
const TOKEN_CACHE = new Map();
const TOKEN_CACHE_TTL_MS = 600000;

async function verifyToken(token) {
  if (!token) return null;
  const cached = TOKEN_CACHE.get(token);
  if (cached && Date.now() - cached.at < TOKEN_CACHE_TTL_MS) return cached.me;
  try {
    const meRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) return null;
    const me = await meRes.json();
    if (!me.id) return null;

    // Fetch guilds the user is in
    const gRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const guilds = gRes.ok ? await gRes.json() : [];
    me.guilds = guilds;

    TOKEN_CACHE.set(token, { me, at: Date.now() });
    if (TOKEN_CACHE.size > 200) {
      const oldest = TOKEN_CACHE.keys().next().value;
      TOKEN_CACHE.delete(oldest);
    }

    return me;
  } catch {
    return null;
  }
}

// Returns the set of guild IDs this user is an admin/moderator of.
function getAdminGuildIds(me) {
  if (!me || !Array.isArray(me.guilds)) return [];
  return me.guilds
    .filter(g => {
      const perms = BigInt(g.permissions || '0');
      const ADMIN = 0x8n;
      const MANAGE_GUILD = 0x20n;
      const MANAGE_MESSAGES = 0x2000n;
      const MANAGE_ROLES = 0x100000n;
      const MODERATE_MEMBERS = 0x10000000000n;
      const hasPerm = (perms & (ADMIN | MANAGE_GUILD | MANAGE_MESSAGES | MANAGE_ROLES | MODERATE_MEMBERS)) !== 0n;
      if (ALLOWED_GUILDS.length > 0) return ALLOWED_GUILDS.includes(g.id) && hasPerm;
      return hasPerm;
    })
    .map(g => g.id);
}

function cookieToken(req) {
  const raw = req.headers.cookie || '';
  const found = raw.split(';').map(s => s.trim()).find(s => s.startsWith('fg_session='));
  return found ? decodeURIComponent(found.slice('fg_session='.length)) : null;
}

function requireAuth(guildId) {
  return async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token || cookieToken(req);
    const me = await verifyToken(token);
    if (!me) {
      console.log(`  [DASHBOARD] auth DENIED: ${req.method} ${req.path} token=${token ? 'present' : 'none'}`);
      return res.status(401).json({ error: 'Unauthorized - invalid or missing token' });
    }
    console.log(`  [DASHBOARD] auth ok: ${req.method} ${req.path}`);
    const adminGuilds = getAdminGuildIds(me);

    if (guildId && !adminGuilds.includes(req.params[guildId])) {
      return res.status(403).json({ error: 'Forbidden - you do not have moderator permissions in this server' });
    }

    req.me = me;
    req.adminGuilds = adminGuilds;
    next();
  };
}

// ══════════════════════════════════════════════════════════════
//  DISCORD CLIENT ACCESS (set by index.js)
// ══════════════════════════════════════════════════════════════

let discordClient = null;
function setDiscordClient(client) { discordClient = client; }

function getGuild(guildId) {
  return discordClient?.guilds?.cache?.get(guildId);
}

async function createInviteBack(guild) {
  const me = guild.members.me;
  const channel = guild.systemChannel || guild.channels.cache
    .filter(c => c.isTextBased && c.isTextBased() && c.permissionsFor(me).has(PermissionFlagsBits.CreateInstantInvite))
    .sort((a, b) => a.position - b.position)
    .first();
  if (!channel) return null;
  const invite = await channel.createInvite({ maxAge: 0, maxUses: 1, reason: 'Ban appeal approved — invite back' });
  return `https://discord.gg/${invite.code}`;
}

// ══════════════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════════════

// Health check (public, no auth)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()), guilds: discordClient?.guilds?.cache?.size || 0 });
});

// Public diagnostics — confirms the runtime config without any login
app.get('/api/config', (req, res) => {
  res.json({
    dashboardPort: DASHBOARD_PORT,
    baseUrl: DASHBOARD_BASE_URL,
    clientIdSet: !!DISCORD_CLIENT_ID,
    clientSecretSet: !!DISCORD_CLIENT_SECRET,
    allowedGuilds: ALLOWED_GUILDS,
  });
});

// Public diagnostics — dumps the data-shape the UI receives (no auth, for debugging)
app.get('/api/diag/stats', async (req, res) => {
  try {
    const gid = ALLOWED_GUILDS[0];
    const guild = getGuild(gid);
    const strikes = await getGuildStats(gid);
    res.json({
      guild: guild ? { id: guild.id, name: guild.name, members: guild.memberCount } : null,
      strikes,
      loggerStats: getStats(),
      voiceActive: getVoiceActivity(gid).length,
      config: getConfig(gid),
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.stack) || e) });
  }
});

// Response status logging — shows what the browser actually receives
app.use((req, res, next) => {
  res.on('finish', () => {
    if (!req.path.startsWith('/api/health') && !req.path.startsWith('/api/config') && !req.path.startsWith('/api/diag')) {
      console.log(`  [DASHBOARD] ${req.method} ${req.path} -> ${res.statusCode}`);
    }
  });
  next();
});

// OAuth2 callback — exchange code for token (public endpoint)
app.get('/api/auth/callback', async (req, res) => {
  const code = req.query.code;
  const isBrowserNav = req.get('sec-fetch-dest') === 'document';
  const ship = (status, obj) => {
    if (isBrowserNav) {
      return res.status(status).type('html').send(
        `<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;background:#12141a;color:#e6e9ef;padding:40px;text-align:center">` +
        `<h2 style="color:#ed4245">${(obj.error || obj.message || 'Error').replace(/</g, '&lt;')}</h2>` +
        `<p><a href="${DASHBOARD_BASE_URL}" style="color:#7289da">Back to dashboard</a></p></body></html>`
      );
    }
    return res.status(status).json(obj);
  };
  if (!code) return ship(400, { error: 'Missing code' });

  try {
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${DASHBOARD_BASE_URL}/api/auth/callback`,
      scope: 'identify guilds',
    });

    console.log(`  [DASHBOARD] OAuth callback received, code present`);
    const tokRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    console.log(`  [DASHBOARD] Discord token exchange status=${tokRes.status}`);
    if (!tokRes.ok) return ship(400, { error: 'Token exchange failed' });
    const tok = await tokRes.json();

    const me = await verifyToken(tok.access_token);
    console.log(`  [DASHBOARD] Discord identity: ${me ? 'valid' : 'INVALID'}`);
    if (!me) return ship(401, { error: 'Could not verify identity' });

    const adminGuilds = getAdminGuildIds(me);
    console.log(`  [DASHBOARD] Admin guilds matched: ${adminGuilds.length}`);
    if (adminGuilds.length === 0) {
      return ship(403, { error: 'No moderator permissions in any allowed server' });
    }

    const payload = { token: tok.access_token, me: { id: me.id, username: me.username, avatar: me.avatar }, guilds: adminGuilds };
    if (isBrowserNav) {
      res.setHeader('Set-Cookie', `fg_session=${encodeURIComponent(payload.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
      return res.redirect(DASHBOARD_BASE_URL);
    }
    return res.json(payload);
  } catch (err) {
    return ship(500, { error: 'OAuth failed: ' + err.message });
  }
});

// Auth bootstrap (for frontend to verify an existing token/cookie session)
app.get('/api/auth/me', requireAuth(null), (req, res) => {
  res.json({ me: { id: req.me.id, username: req.me.username, avatar: req.me.avatar }, guilds: req.adminGuilds });
});

// Logout — clears the session cookie
app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'fg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ── Stats ─────────────────────────────────────────────────────
app.get('/api/guilds/:guildId/stats', requireAuth('guildId'), async (req, res) => {
  const { guildId } = req.params;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const strikes = await getGuildStats(guildId);
  const loggerStats = getStats();

  const voiceActive = getVoiceActivity(guildId).length;

  res.json({
    guild: { id: guild.id, name: guild.name, members: guild.memberCount, icon: guild.icon },
    strikes,
    voiceActive,
    loggerStats,
    guildConfig: getConfig(guildId),
  });
});

// ── Members ───────────────────────────────────────────────────
app.get('/api/guilds/:guildId/members', requireAuth('guildId'), async (req, res) => {
  const { guildId } = req.params;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const rawList = [];

  if (guild.members.cache && guild.members.cache.size > 0) {
    for (const member of guild.members.cache.values()) {
      rawList.push({
        id: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatar: member.user.displayAvatarURL({ format: 'png' }),
        bot: !!member.user.bot,
        roles: member.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
        joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
      });
    }
  }

  // Fallback: plain REST fetch — works without the Server Members intent and
  // avoids the gateway member-chunk rate limit that kept 500ing.
  if (rawList.length === 0 && discordClient && discordClient.token) {
    try {
      const mRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`, {
        headers: { Authorization: `Bot ${discordClient.token}` },
      });
      if (mRes.ok) {
        const data = await mRes.json();
        if (Array.isArray(data)) {
          for (const m of data) {
            const u = m.user || {};
            rawList.push({
              id: u.id,
              username: u.username || 'unknown',
              displayName: m.nick || u.global_name || u.username || 'unknown',
              avatar: m.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${m.avatar}.png` : null,
              bot: !!u.bot,
              roles: [],
              joinedAt: m.joined_at || null,
            });
          }
        }
      } else {
        console.log(`[DASHBOARD] members REST ${mRes.status} ${mRes.statusText}`);
      }
    } catch (err) {
      console.log('[DASHBOARD] members REST error: ' + err.message);
    }
  }

  if (rawList.length === 0) {
    return res.status(500).json({ error: 'Could not fetch members' });
  }

  const memberList = [];
  for (const mm of rawList) {
    const record = await getUserLog(mm.id, guildId);
    const strikeCount = record?.count || 0;
    const banInfo = await require('./src/strikeManager').getBanInfo(mm.id, guildId);
    memberList.push({ ...mm, strikeCount, banned: !!banInfo, banInfo });
  }

  // All members (bots included), sorted by strikes desc then join date
  memberList.sort((a, b) => b.strikeCount - a.strikeCount || ((a.joinedAt || '') < (b.joinedAt || '') ? 1 : -1));
  res.json({ members: memberList });
});

// ── Member detail ─────────────────────────────────────────────
app.get('/api/guilds/:guildId/members/:userId', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId } = req.params;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  let member;
  try { member = await guild.members.fetch(userId); } catch {}

  const record = await getUserLog(userId, guildId);
  const banInfo = await require('./src/strikeManager').getBanInfo(userId, guildId);

  const memberRoles = member ? member.roles.cache.map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position })) : [];

  const guildRoles = (guild.roles.cache || [])
    .sort((a, b) => b.position - a.position)
    .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position }))
    .filter(r => r.id !== guild.id);

  res.json({
    member: member ? {
      id: member.id, username: member.user.username, displayName: member.displayName,
      avatar: member.user.displayAvatarURL({ format: 'png' }), bot: member.user.bot,
      roles: memberRoles,
      joinedAt: member.joinedAt,
    } : null,
    memberRoleIds: memberRoles.map(r => r.id),
    guildRoles,
    strikes: record || { count: 0, strikes: [], appeals: [] },
    banInfo,
  });
});

// ── Actions ───────────────────────────────────────────────────
app.post('/api/guilds/:guildId/members/:userId/warn', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId } = req.params;
  const { reason } = req.body;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const record = await addStrike(userId, guildId, {
    reason: reason || 'Manual warning from dashboard',
    category: 'MANUAL',
    severity: 'medium',
    by: req.me.username,
  });

  res.json({ success: true, strikes: record });
});

app.post('/api/guilds/:guildId/members/:userId/clears', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId } = req.params;
  const { reason } = req.body;
  await clearStrikes(userId, guildId, reason || `Cleared by ${req.me.username} via dashboard`);
  res.json({ success: true });
});

app.post('/api/guilds/:guildId/members/:userId/ban', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId } = req.params;
  const { reason, durationHours } = req.body;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const duration = durationHours ? durationHours * 3600000 : (getConfig(guildId).banDurationHours * 3600000);

  try {
    await guild.members.ban(userId, { reason: reason || `Banned by ${req.me.username} via dashboard` });
    await recordBan(userId, guildId, duration, reason || `Banned via dashboard by ${req.me.username}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ban failed: ' + err.message });
  }
});

app.post('/api/guilds/:guildId/members/:userId/kick', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId } = req.params;
  const { reason } = req.body;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  try {
    await guild.members.kick(userId, reason || `Kicked by ${req.me.username} via dashboard`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Kick failed: ' + err.message });
  }
});

app.post('/api/guilds/:guildId/members/:userId/unban', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId } = req.params;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  try {
    await guild.bans.remove(userId);
    await removeBan(userId, guildId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Unban failed: ' + err.message });
  }
});

app.post('/api/guilds/:guildId/members/:userId/dm', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId } = req.params;
  const { message } = req.body;
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'Message is required' });
  const client = discordClient;
  if (!client || !client.token) return res.status(500).json({ error: 'Bot not connected' });

  try {
    const user = await client.users.fetch(userId);
    await user.send({ content: String(message).trim() });
    console.log(`[DASHBOARD] DM sent to ${userId} by ${req.me.username}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'DM failed: ' + (err.message || 'user may have DMs closed') });
  }
});

app.post('/api/guilds/:guildId/members/:userId/roles/:roleId', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId, roleId } = req.params;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  try {
    const member = await guild.members.fetch(userId);
    const role = guild.roles.cache.get(roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    await member.roles.add(role);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Add role failed: ' + err.message });
  }
});

app.delete('/api/guilds/:guildId/members/:userId/roles/:roleId', requireAuth('guildId'), async (req, res) => {
  const { guildId, userId, roleId } = req.params;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  try {
    const member = await guild.members.fetch(userId);
    const role = guild.roles.cache.get(roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    await member.roles.remove(role);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Remove role failed: ' + err.message });
  }
});

// ── Config ────────────────────────────────────────────────────
app.get('/api/guilds/:guildId/config', requireAuth('guildId'), (req, res) => {
  const guild = getGuild(req.params.guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });
  res.json({ config: getConfig(guild.id), defaults: DEFAULT_CONFIG });
});

app.post('/api/guilds/:guildId/config', requireAuth('guildId'), (req, res) => {
  const { guildId } = req.params;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const updates = req.body || {};
  setConfig(guildId, updates);
  res.json({ success: true, config: getConfig(guildId) });
});

app.post('/api/guilds/:guildId/config/reset', requireAuth('guildId'), (req, res) => {
  const { guildId } = req.params;
  resetConfig(guildId);
  res.json({ success: true, config: getConfig(guildId) });
});

// ── Logs ──────────────────────────────────────────────────────
app.get('/api/guilds/:guildId/logs', requireAuth('guildId'), (req, res) => {
  const { guildId } = req.params;
  const { date, level, category, search, limit } = req.query;
  let entries = readLogEntries(date, { level, category, search });
  entries = entries.slice(-(parseInt(limit) || 100));
  res.json({ entries: entries.reverse() });
});

app.get('/api/logs/files', requireAuth(null), (req, res) => {
  res.json({ files: getLogFiles() });
});

// ── Voice ─────────────────────────────────────────────────────
app.get('/api/guilds/:guildId/voice', requireAuth('guildId'), (req, res) => {
  const { guildId } = req.params;
  const guild = getGuild(guildId);
  if (!guild) return res.status(404).json({ error: 'Guild not found' });

  const active = getVoiceActivity(guildId);
  const voiceStates = [];
  for (const [id, vs] of guild.voiceStates.cache) {
    if (vs.channelId) {
      voiceStates.push({
        userId: id,
        username: vs.member?.user?.username || id,
        channelId: vs.channelId,
        channelName: vs.channel?.name || 'Unknown',
        muted: vs.mute,
        deafened: vs.deaf,
        streaming: vs.streaming,
        camera: vs.selfVideo,
      });
    }
  }

  res.json({ monitored: active, voiceStates });
});

// ── Appeals ───────────────────────────────────────────────────
app.get('/api/guilds/:guildId/appeals', requireAuth('guildId'), async (req, res) => {
  const { guildId } = req.params;
  const pending = await getPendingAppeals(guildId);
  const appeals = pending.map(a => ({
    appealId: a.id,
    userId: a.key ? a.key.split(':')[0] : null,
    reason: a.reason,
    submittedAt: a.submittedAt,
    status: a.status,
  }));
  res.json({ appeals });
});

app.post('/api/guilds/:guildId/appeals/:appealId/resolve', requireAuth('guildId'), async (req, res) => {
  const { guildId, appealId } = req.params;
  const { approved } = req.body;

  const pending = await getPendingAppeals(guildId);
  const appeal = pending.find(a => a.id === appealId);
  if (!appeal) return res.status(404).json({ error: 'Appeal not found' });

  const key = appeal.key;
  const [userId] = key.split(':');
  await resolveAppeal(userId, guildId, appealId, approved === true, req.me.username);

  if (approved === true) {
    const guild = getGuild(guildId);
    try {
      if (guild) await guild.bans.remove(userId, 'Appeal approved via dashboard');
      await removeBan(userId, guildId);
    } catch (e) {
      console.log(`[DASHBOARD] Appeal approved but unban failed for ${userId}: ${e.message}`);
    }
    try {
      const user = await discordClient.users.fetch(userId);
      const invite = guild ? await createInviteBack(guild) : null;
      await user.send(
        '🎉 **Your appeal was accepted — you\'re unbanned!**\n\nYour ban has been lifted and your strikes cleared.\n\n' +
        (invite ? `**Join the server again:** ${invite}` : 'You can rejoin the server now.')
      );
    } catch (e) {
      console.log(`[DASHBOARD] Appeal accepted but DM failed for ${userId}: ${e.message}`);
    }
  }
  res.json({ success: true });
});

// ── Bans list ─────────────────────────────────────────────────
app.get('/api/guilds/:guildId/bans', requireAuth('guildId'), async (req, res) => {
  const { guildId } = req.params;
  const bansObj = await listActiveBans();
  const bans = Object.values(bansObj).filter(b => b.guildId === guildId).map(b => ({
    userId: b.userId,
    reason: b.reason,
    expiresAt: b.expiresAt,
    bannedAt: b.bannedAt,
  }));
  res.json({ bans });
});

// ══════════════════════════════════════════════════════════════
//  START SERVER
// ══════════════════════════════════════════════════════════════

function startDashboard() {
  const server = app.listen(DASHBOARD_PORT, () => {
    console.log(`  [DASHBOARD] API listening on http://localhost:${DASHBOARD_PORT}`);
    console.log(`  [DASHBOARD] Base URL: ${DASHBOARD_BASE_URL}`);
    console.log(`  [DASHBOARD] OAuth client id: ${DISCORD_CLIENT_ID ? 'set' : 'MISSING'}, client secret: ${DISCORD_CLIENT_SECRET ? 'set' : 'MISSING'}, allowed guilds: ${ALLOWED_GUILDS.length}`);
  });
  return server;
}

function stopDashboard(server) {
  if (server) server.close();
}

module.exports = {
  startDashboard,
  stopDashboard,
  setDiscordClient,
  app,
};
