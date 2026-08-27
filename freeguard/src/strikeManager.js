// ============================================================
//  USCCB:free-Guard — Strike Manager v2
//  Features: per-guild config, appeal system, strike expiry,
//  temporary ban tracking, audit trail, configurable thresholds
//  EchoBastion Group
// ============================================================

const fs = require('fs');
const path = require('path');
const { encrypt, decrypt, hashUserId } = require('./encryption');
const { getConfig } = require('./config');
const { log } = require('./logger');

const DATA_DIR = path.resolve(__dirname, '../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const BANS_FILE = path.join(DATA_DIR, '.bans.enc');
const APPEALS_FILE = path.join(DATA_DIR, '.appeals.enc');

// ── File Helpers ─────────────────────────────────────────────

function getLogPath(userId, guildId) {
  const hashedId = hashUserId(`${userId}:${guildId}`);
  return path.join(DATA_DIR, `${hashedId}.enc`);
}

function readRecord(userId, guildId) {
  const filePath = getLogPath(userId, guildId);
  if (!fs.existsSync(filePath)) {
    return { userId, guildId, count: 0, strikes: [], appeals: [], createdAt: new Date().toISOString() };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const decrypted = decrypt(raw, true);
    return decrypted || { userId, guildId, count: 0, strikes: [], appeals: [], createdAt: new Date().toISOString() };
  } catch {
    return { userId, guildId, count: 0, strikes: [], appeals: [], createdAt: new Date().toISOString() };
  }
}

function writeRecord(userId, guildId, record) {
  const filePath = getLogPath(userId, guildId);
  const encrypted = encrypt(record);
  fs.writeFileSync(filePath, encrypted, 'utf8');
}

function readBans() {
  if (!fs.existsSync(BANS_FILE)) return {};
  try {
    const raw = fs.readFileSync(BANS_FILE, 'utf8');
    return decrypt(raw, true) || {};
  } catch { return {}; }
}

function writeBans(bans) {
  fs.writeFileSync(BANS_FILE, encrypt(bans), 'utf8');
}

function readAppeals() {
  if (!fs.existsSync(APPEALS_FILE)) return {};
  try {
    const raw = fs.readFileSync(APPEALS_FILE, 'utf8');
    return decrypt(raw, true) || {};
  } catch { return {}; }
}

function writeAppeals(appeals) {
  fs.writeFileSync(APPEALS_FILE, encrypt(appeals), 'utf8');
}

// ── Strike Operations ────────────────────────────────────────

async function getStrikes(userId, guildId) {
  const record = readRecord(userId, guildId);
  return record.count || 0;
}

async function getUserLog(userId, guildId) {
  return readRecord(userId, guildId);
}

async function addStrike(userId, guildId, strikeInfo) {
  const record = readRecord(userId, guildId);
  const cfg = getConfig(guildId);
  record.count = (record.count || 0) + 1;
  record.strikes = record.strikes || [];

  const strike = {
    strikeNumber: record.count,
    reason: strikeInfo.reason,
    category: strikeInfo.category,
    originalContent: strikeInfo.originalContent || '[redacted]',
    channelId: strikeInfo.channelId,
    timestamp: new Date().toISOString(),
    moderator: strikeInfo.moderator || 'free-Guard',
    source: strikeInfo.source || 'text',
  };

  record.strikes.push(strike);
  record.lastStrikeAt = new Date().toISOString();
  record.strikeExpiry = calculateStrikeExpiry(cfg);

  writeRecord(userId, guildId, record);

  log('INFO', 'STRIKE', `User ${userId} received strike #${record.count} in guild ${guildId}: ${strikeInfo.reason}`, {
    userId,
    guildId,
    strikeCount: record.count,
    category: strikeInfo.category,
    source: strikeInfo.source || 'text',
  });

  return record;
}

function calculateStrikeExpiry(cfg) {
  if (!cfg.autoClearOnExpiry || cfg.strikeExpiryDays <= 0) return null;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + cfg.strikeExpiryDays);
  return expiry.toISOString();
}

async function clearStrikes(userId, guildId, reason = 'Manual clear') {
  const record = readRecord(userId, guildId);
  const previousCount = record.count || 0;
  record.count = 0;
  record.strikes = [];
  record.strikeExpiry = null;
  record.clearedAt = new Date().toISOString();
  record.clearedBy = reason;
  writeRecord(userId, guildId, record);

  log('INFO', 'CLEAR', `Strikes cleared for ${userId} in guild ${guildId} (was ${previousCount}): ${reason}`);
  return record;
}

// ── Strike Expiry Check ──────────────────────────────────────

function checkExpiredStrikes() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.enc') && !f.startsWith('.') && !f.startsWith('config-'));
  let expired = 0;

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
      const record = decrypt(raw, true);
      if (!record || !record.strikeExpiry || record.count === 0) continue;

      if (new Date(record.strikeExpiry) <= new Date()) {
        record.count = 0;
        record.strikes = [];
        record.strikeExpiry = null;
        record.autoExpiredAt = new Date().toISOString();

        const encrypted = encrypt(record);
        fs.writeFileSync(path.join(DATA_DIR, file), encrypted, 'utf8');
        expired++;
      }
    } catch {}
  }
  return expired;
}

// ── Ban Management ───────────────────────────────────────────

async function recordBan(userId, guildId, durationMs, reason) {
  const bans = readBans();
  bans[`${userId}:${guildId}`] = {
    userId,
    guildId,
    bannedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + durationMs).toISOString(),
    reason,
  };
  writeBans(bans);
}

async function removeBan(userId, guildId) {
  const bans = readBans();
  delete bans[`${userId}:${guildId}`];
  writeBans(bans);
}

async function getBanInfo(userId, guildId) {
  const bans = readBans();
  return bans[`${userId}:${guildId}`] || null;
}

async function listActiveBans() {
  const bans = readBans();
  const now = new Date();
  const active = {};

  for (const [key, ban] of Object.entries(bans)) {
    if (new Date(ban.expiresAt) > now) {
      active[key] = ban;
    }
  }
  return active;
}

// ── Appeal System ────────────────────────────────────────────

async function submitAppeal(userId, guildId, reason) {
  const appeals = readAppeals();
  const key = `${userId}:${guildId}`;
  const record = readRecord(userId, guildId);

  if (!appeals[key]) appeals[key] = [];
  appeals[key].push({
    id: Date.now().toString(36),
    reason,
    submittedAt: new Date().toISOString(),
    status: 'pending',
    strikeCountAtSubmission: record.count,
  });
  writeAppeals(appeals);

  log('INFO', 'APPEAL', `Appeal submitted by ${userId} in guild ${guildId}: ${reason}`);
  return appeals[key][appeals[key].length - 1];
}

async function resolveAppeal(userId, guildId, appealId, approved, resolverTag) {
  const appeals = readAppeals();
  const key = `${userId}:${guildId}`;
  if (!appeals[key]) return null;

  const appeal = appeals[key].find(a => a.id === appealId);
  if (!appeal) return null;

  appeal.status = approved ? 'approved' : 'denied';
  appeal.resolvedAt = new Date().toISOString();
  appeal.resolvedBy = resolverTag;
  writeAppeals(appeals);

  if (approved) {
    await clearStrikes(userId, guildId, `Appeal approved by ${resolverTag}`);
  }

  log('INFO', 'APPEAL', `Appeal ${appealId} ${approved ? 'approved' : 'denied'} by ${resolverTag} for ${userId}`);
  return appeal;
}

async function getPendingAppeals(guildId) {
  const appeals = readAppeals();
  const pending = [];
  const suffix = `:${guildId}`;

  for (const [key, userAppeals] of Object.entries(appeals)) {
    if (!key.endsWith(suffix)) continue;
    for (const appeal of userAppeals) {
      if (appeal.status === 'pending') {
        pending.push({ ...appeal, key });
      }
    }
  }
  return pending;
}

// ── Statistics ───────────────────────────────────────────────

async function getGuildStats(guildId) {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.enc') && !f.startsWith('.') && !f.startsWith('config-'));
  let totalUsers = 0;
  let totalStrikes = 0;
  let activeUsers = 0;
  const categoryCounts = {};

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
      const record = decrypt(raw, true);
      if (!record || record.guildId !== guildId) continue;
      totalUsers++;
      totalStrikes += record.count || 0;
      if (record.count > 0) activeUsers++;

      for (const strike of (record.strikes || [])) {
        const cat = strike.category || 'UNKNOWN';
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
    } catch {}
  }

  return {
    totalUsers,
    totalStrikes,
    activeUsers,
    categoryCounts,
  };
}

module.exports = {
  getStrikes,
  addStrike,
  clearStrikes,
  getUserLog,
  recordBan,
  removeBan,
  getBanInfo,
  listActiveBans,
  submitAppeal,
  resolveAppeal,
  getPendingAppeals,
  checkExpiredStrikes,
  getGuildStats,
};
