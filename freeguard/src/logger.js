// ============================================================
//  USCCB:free-Guard — Encrypted Logger v2
//  Features: structured logging, daily rotation, log forwarding
//  to Discord audit channel, log levels, redaction
//  EchoBastion Group
// ============================================================

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./encryption');

const LOG_DIR = path.resolve(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
const MIN_LOG_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase() || 'INFO'];

let auditChannel = null;
let stats = { total: 0, violations: 0, voiceEvents: 0, commands: 0, errors: 0 };

function setAuditChannel(channel) {
  auditChannel = channel;
}

function getStats() {
  return { ...stats };
}

function getLogFileName(date) {
  const d = date || new Date();
  const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return path.join(LOG_DIR, `freeguard-${dateStr}.enc.log`);
}

function redactSecrets(message) {
  return message
    .replace(/hf_[a-zA-Z0-9]{20,}/g, '[HF_TOKEN]')
    .replace(/sk-[a-zA-Z0-9]{20,}/g, '[API_KEY]')
    .replace(/OT[ policym]{20,}/g, '[DISCORD_TOKEN]')
    .replace(/\b\d{17,19}\b/g, (match) => {
      if (match.length === 18 || match.length === 19) return '[USER_ID]';
      return match;
    });
}

function log(level, category, message, data = null) {
  const levelEnum = LOG_LEVELS[level] || LOG_LEVELS.INFO;
  if (levelEnum < MIN_LOG_LEVEL) return;

  stats.total++;
  if (category === 'VIOLATION') stats.violations++;
  if (category.startsWith('VOICE')) stats.voiceEvents++;
  if (category === 'COMMAND') stats.commands++;
  if (level === 'ERROR' || level === 'FATAL') stats.errors++;

  const timestamp = new Date().toISOString();
  const redacted = redactSecrets(message);
  const entry = {
    t: timestamp,
    l: level,
    c: category,
    m: redacted,
  };
  if (data) entry.d = typeof data === 'string' ? redactSecrets(data) : data;

  const logLine = `[${timestamp}] [${level}] [${category}] ${redacted}`;
  console.log(`  [LOG] ${logLine}`);

  try {
    const encrypted = encrypt(JSON.stringify(entry)) + '\n';
    fs.appendFileSync(getLogFileName(), encrypted, 'utf8');
  } catch (err) {
    console.error('[Logger] Write failed:', err.message);
  }

  if (auditChannel && shouldForwardToAudit(level, category)) {
    forwardToAudit(entry);
  }
}

function shouldForwardToAudit(level, category) {
  if (level === 'ERROR' || level === 'FATAL') return true;
  const forwardCategories = ['VIOLATION', 'BAN', 'UNBAN', 'VOICE_BAN', 'VOICE_VIOLATION', 'CLEAR', 'MANUAL_UNBAN', 'APPEAL'];
  return forwardCategories.includes(category);
}

async function forwardToAudit(entry) {
  if (!auditChannel) return;
  try {
    const { EmbedBuilder } = require('discord.js');
    const colorMap = {
      VIOLATION: 0xf5c518,
      BAN: 0xd4202a,
      UNBAN: 0x00c896,
      VOICE_BAN: 0xd4202a,
      VOICE_VIOLATION: 0xff8800,
      CLEAR: 0x00c896,
      MANUAL_UNBAN: 0x00c896,
      APPEAL: 0x5865f2,
      ERROR: 0xd4202a,
      FATAL: 0xd4202a,
    };

    const embed = new EmbedBuilder()
      .setTitle(`📋 ${entry.c}`)
      .setColor(colorMap[entry.c] || 0x2b2d42)
      .setDescription(entry.m)
      .setFooter({ text: 'USCCB:free-Guard | Audit Log' })
      .setTimestamp(new Date(entry.t));

    if (entry.d && typeof entry.d === 'object') {
      const fields = Object.entries(entry.d).slice(0, 5);
      for (const [key, val] of fields) {
        embed.addFields({ name: key, value: String(val).slice(0, 1024), inline: true });
      }
    }

    await auditChannel.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}

function readLog(date) {
  const d = date || new Date().toISOString().split('T')[0];
  const filePath = path.join(LOG_DIR, `freeguard-${d}.enc.log`);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  return lines.map(line => {
    try {
      const decrypted = decrypt(line, true);
      if (decrypted && decrypted.m) {
        return `[${decrypted.t}] [${decrypted.l}] [${decrypted.c}] ${decrypted.m}`;
      }
      return decrypt(line, false) || '[unreadable]';
    } catch { return '[unreadable]'; }
  });
}

function readLogEntries(date, filter = {}) {
  const d = date || new Date().toISOString().split('T')[0];
  const filePath = path.join(LOG_DIR, `freeguard-${d}.enc.log`);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const entries = [];

  for (const line of lines) {
    try {
      const entry = decrypt(line, true);
      if (!entry || !entry.m) continue;
      if (filter.level && entry.l !== filter.level) continue;
      if (filter.category && entry.c !== filter.category) continue;
      if (filter.search && !entry.m.toLowerCase().includes(filter.search.toLowerCase())) continue;
      entries.push(entry);
    } catch {}
  }
  return entries;
}

function getLogFiles() {
  return fs.readdirSync(LOG_DIR)
    .filter(f => f.endsWith('.enc.log'))
    .sort()
    .reverse();
}

function pruneLogs(daysToKeep = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);
  const files = getLogFiles();
  let pruned = 0;

  for (const file of files) {
    const dateStr = file.replace('freeguard-', '').replace('.enc.log', '');
    const fileDate = new Date(dateStr + 'T23:59:59Z');
    if (fileDate < cutoff) {
      fs.unlinkSync(path.join(LOG_DIR, file));
      pruned++;
    }
  }
  return pruned;
}

function logDebug(category, message, data) { log('DEBUG', category, message, data); }
function logInfo(category, message, data) { log('INFO', category, message, data); }
function logWarn(category, message, data) { log('WARN', category, message, data); }
function logError(category, message, data) { log('ERROR', category, message, data); }
function logFatal(category, message, data) { log('FATAL', category, message, data); }

module.exports = {
  log: logInfo,
  logDebug,
  logInfo,
  logWarn,
  logError,
  logFatal,
  readLog,
  readLogEntries,
  getLogFiles,
  pruneLogs,
  setAuditChannel,
  getStats,
  LOG_LEVELS,
};
