// ============================================================
//  USCCB:free-Guard — Runtime Configuration Manager
//  Per-guild settings stored encrypted, editable via slash commands
//  EchoBastion Group
// ============================================================

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./encryption');

const DATA_DIR = path.resolve(__dirname, '../data');
const CONFIG_FILE = path.join(DATA_DIR, 'guild-configs.enc');

const DEFAULT_CONFIG = {
  // Moderation toggles
  textModeration: true,
  imageModeration: true,
  voiceModeration: true,
  reactionModeration: true,
  linkFilter: true,
  spamFilter: true,
  inviteFilter: true,
  capsFilter: true,

  // Thresholds
  spamMessageLimit: 5,
  spamTimeWindowMs: 5000,
  capsPercentageThreshold: 70,
  capsMinLength: 10,
  linkWhitelist: ['youtube.com', 'youtu.be', 'twitch.tv', 'discord.gg', 'github.com', 'google.com', 'wikipedia.org'],
  inviteWhitelist: [],

  // Strike system
  maxStrikes: 3,
  banDurationHours: 24,
  strikeExpiryDays: 30,
  autoClearOnExpiry: true,

  // Voice settings
  voiceSensitivity: 0.7,
  voiceDisconnectOnViolation: true,
  voiceBanOnSexualViolent: true,
  voiceWarningBeforeDisconnect: true,
  voiceMaxRecordingSeconds: 30,

  // Channels
  exemptChannels: [],
  exemptRoles: [],
  logChannelId: null,
  welcomeChannelId: null,
  auditLogChannelId: null,

  // Welcome system
  welcomeEnabled: false,
  welcomeMessage: 'Welcome to **{server}**, {user}! Please read the rules and enjoy your stay.',
  welcomeRole: null,

  // Auto-mod
  autoDeleteInvites: true,
  autoDeleteLinks: false,
  maxMentions: 5,

  // Language
  moderationLanguage: 'en',

  // Features
  dmWarnings: true,
  deleteViolations: true,
  logTranscripts: true,
};

function getConfigPath(guildId) {
  return path.join(DATA_DIR, `config-${guildId}.enc`);
}

function loadAllConfigs() {
  const configs = {};
  const configDir = DATA_DIR;
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
    return configs;
  }

  const files = fs.readdirSync(configDir).filter(f => f.startsWith('config-') && f.endsWith('.enc'));
  for (const file of files) {
    try {
      const guildId = file.replace('config-', '').replace('.enc', '');
      const raw = fs.readFileSync(path.join(configDir, file), 'utf8');
      const decrypted = decrypt(raw, true);
      if (decrypted) {
        configs[guildId] = { ...DEFAULT_CONFIG, ...decrypted };
      }
    } catch {}
  }
  return configs;
}

const guildConfigs = loadAllConfigs();

function getConfig(guildId) {
  if (!guildConfigs[guildId]) {
    guildConfigs[guildId] = { ...DEFAULT_CONFIG };
  }
  return guildConfigs[guildId];
}

function setConfig(guildId, updates) {
  const current = getConfig(guildId);
  const merged = { ...current, ...updates };
  guildConfigs[guildId] = merged;

  try {
    const encrypted = encrypt(merged);
    fs.writeFileSync(getConfigPath(guildId), encrypted, 'utf8');
  } catch (err) {
    console.error(`[Config] Failed to save config for guild ${guildId}:`, err.message);
  }
  return merged;
}

function resetConfig(guildId) {
  guildConfigs[guildId] = { ...DEFAULT_CONFIG };
  try {
    const encrypted = encrypt(guildConfigs[guildId]);
    fs.writeFileSync(getConfigPath(guildId), encrypted, 'utf8');
  } catch (err) {
    console.error(`[Config] Failed to reset config for guild ${guildId}:`, err.message);
  }
  return guildConfigs[guildId];
}

function isExempt(userId, memberRoles, channelId, guildId) {
  const cfg = getConfig(guildId);
  if (cfg.exemptChannels.includes(channelId)) return true;
  if (memberRoles && memberRoles.some(r => cfg.exemptRoles.includes(r))) return true;
  return false;
}

function isChannelExempt(channelName, guildId) {
  const cfg = getConfig(guildId);
  const lower = channelName.toLowerCase();
  if (lower.startsWith('unfiltered') || lower.startsWith('gaming')) return true;
  return false;
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  setConfig,
  resetConfig,
  isExempt,
  isChannelExempt,
  loadAllConfigs,
};
