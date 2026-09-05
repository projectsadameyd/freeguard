// ============================================================
//  USCCB:free-Guard — Encryption Module v2
//  Algorithm: AES-256-GCM (authenticated encryption)
//  Key derivation: PBKDF2 / SHA-512 / 310,000 iterations
//  Features: key versioning, per-record salts, HMAC file naming
//  EchoBastion Group
// ============================================================

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 310000;
const PBKDF2_DIGEST = 'sha512';
const KEY_VERSION = 1;

function deriveKey(salt, version = KEY_VERSION) {
  const masterSecret = process.env.ENCRYPTION_SECRET;
  if (!masterSecret || masterSecret.length < 16) {
    throw new Error('ENCRYPTION_SECRET must be set and at least 16 characters');
  }
  const versionedSecret = `${masterSecret}:v${version}`;
  return crypto.pbkdf2Sync(versionedSecret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

function encrypt(data) {
  const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: version(1) | salt(32) | iv(16) | authTag(16) | ciphertext
  const versionByte = Buffer.from([KEY_VERSION]);
  const packed = Buffer.concat([versionByte, salt, iv, authTag, encrypted]);
  return packed.toString('base64');
}

function decrypt(payload, parseJson = true) {
  try {
    const packed = Buffer.from(payload, 'base64');

    let offset = 0;
    const version = packed.readUInt8(offset);
    offset += 1;

    if (version > KEY_VERSION) {
      console.error(`[Encryption] Unknown key version: ${version}`);
      return null;
    }

    const salt = packed.subarray(offset, offset + SALT_LENGTH);
    offset += SALT_LENGTH;
    const iv = packed.subarray(offset, offset + IV_LENGTH);
    offset += IV_LENGTH;
    const authTag = packed.subarray(offset, offset + AUTH_TAG_LENGTH);
    offset += AUTH_TAG_LENGTH;
    const ciphertext = packed.subarray(offset);

    const key = deriveKey(salt, version);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const plaintext = decrypted.toString('utf8');

    if (parseJson) {
      try { return JSON.parse(plaintext); } catch { return plaintext; }
    }
    return plaintext;
  } catch (err) {
    console.error('[Encryption] Decryption failed:', err.message);
    return null;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashUserId(userId) {
  const secret = process.env.HASH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('HASH_SECRET must be set and at least 16 characters');
  }
  return crypto.createHmac('sha256', secret).update(userId).digest('hex');
}

function generateSecret(length = 48) {
  return crypto.randomBytes(length).toString('hex');
}

module.exports = { encrypt, decrypt, randomToken, hashUserId, generateSecret };
