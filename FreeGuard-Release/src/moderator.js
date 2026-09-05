// ============================================================
//  USCCB:free-Guard — AI Moderation Engine v3
//  Zero-bypass content detection with full Unicode normalization
//  EchoBastion Group
// ============================================================

const { getConfig } = require('./config');

// ── AI Configuration ─────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Discord content moderation classifier. Analyse the message and classify it.

CRITICAL: Users will try to bypass filters using creative spelling, Unicode tricks, emoji, abbreviations, sarcasm, coded language, and context-dependent slurs. You MUST catch ALL of these.

Examples of bypasses you MUST flag:
- "f u c k", "f.u.c.k", "f***", "f**k", "f_ck" -> PROFANITY
- "n1gg3r", "n i g g a", "\u043d\u0438\u0433\u0433\u0435\u0440" (Cyrillic), "\ud835\udc6e\ud835\udc78\ud835\udc80\ud835\udc80\ud835\udc7c\ud835\udc72\ud835\udc7d" (Mathematical) -> HATE_SPEECH
- "b1tch", "b!tch", "BITCHH" -> PROFANITY
- "kys", "k y s", "kill y0urself" -> VIOLENT_THREAT
- "\ud83c\udf46\ud83d\udca6" (eggplant + water droplets in sexual context) -> SEXUAL_CONTENT
- "send nudes" -> SEXUAL_CONTENT
- "go commit off yourself" -> SELF_HARM
- "I know where you live" -> VIOLENT_THREAT (implied)

RESPOND WITH VALID JSON ONLY. No markdown, no explanation, no text outside the JSON.

{
  "violated": true or false,
  "category": "HATE_SPEECH" | "VIOLENT_THREAT" | "SEXUAL_CONTENT" | "PROFANITY" | "SELF_HARM" | "DOXXING" | "EXTREMISM" | "SPAM" | "SCAM" | "IMPERSONATION" | "CLEAN",
  "confidence": 0.0 to 1.0,
  "reason": "Brief explanation",
  "severity": "low" | "medium" | "high" | "critical"
}

BE STRICT: borderline = flag. Intent to harm or offend = flag. Everything in context.`;

const MODERATION_MODEL = process.env.MODERATION_MODEL || 'google/gemma-4-31b-it:free';

// ══════════════════════════════════════════════════════════════
//  TEXT NORMALIZATION ENGINE
// ══════════════════════════════════════════════════════════════

// Unicode homoglyph map (Cyrillic, Greek)
const HOMOGLYPH_MAP = {
  '\u0430': 'a', '\u0431': '6', '\u0432': 'b', '\u0433': 'r', '\u0434': 'd',
  '\u0435': 'e', '\u0436': 'x', '\u0437': '3', '\u0438': 'u', '\u0439': 'u',
  '\u043A': 'k', '\u043B': 'n', '\u043C': 'm', '\u043D': 'h', '\u043E': 'o',
  '\u043F': 'n', '\u0440': 'p', '\u0441': 'c', '\u0442': 't', '\u0443': 'y',
  '\u0444': 'o', '\u0445': 'x', '\u0446': 'u', '\u0447': '4', '\u0448': 'w',
  '\u0449': 'u', '\u044A': 'b', '\u044B': 'b', '\u044C': 'b', '\u044D': 'e',
  '\u044E': 'u', '\u044F': 'a',
  '\u03B1': 'a', '\u03B2': 'b', '\u03B3': 'y', '\u03B4': 'd', '\u03B5': 'e',
  '\u03B6': 'z', '\u03B7': 'h', '\u03B8': 'th', '\u03B9': 'i', '\u03BA': 'k',
  '\u03BB': 'l', '\u03BC': 'm', '\u03BD': 'n', '\u03BE': 'x', '\u03BF': 'o',
  '\u03C0': 'p', '\u03C1': 'p', '\u03C3': 's', '\u03C4': 't', '\u03C5': 'u',
  '\u03C6': 'ph', '\u03C7': 'x', '\u03C8': 'ps', '\u03C9': 'w',
};

// Full-width Latin (UFF01-FF5E) -> ASCII
function fullWidthToAscii(char) {
  const code = char.charCodeAt(0);
  if (code >= 0xFF01 && code <= 0xFF5E) return String.fromCharCode(code - 0xFEE0);
  if (code === 0x3000) return ' ';
  return char;
}

// Enclosed/encircled letters -> ASCII
const ENCLOSED_MAP = {
  '\u24B6': 'a', '\u24B7': 'b', '\u24B8': 'c', '\u24B9': 'd', '\u24BA': 'e',
  '\u24BB': 'f', '\u24BC': 'g', '\u24BD': 'h', '\u24BE': 'i', '\u24BF': 'j',
  '\u24C0': 'k', '\u24C1': 'l', '\u24C2': 'm', '\u24C3': 'n', '\u24C4': 'o',
  '\u24C5': 'p', '\u24C6': 'q', '\u24C7': 'r', '\u24C8': 's', '\u24C9': 't',
  '\u24CA': 'u', '\u24CB': 'v', '\u24CC': 'w', '\u24CD': 'x', '\u24CE': 'y',
  '\u24CF': 'z',
  '\u24D0': 'a', '\u24D1': 'b', '\u24D2': 'c', '\u24D3': 'd', '\u24D4': 'e',
  '\u24D5': 'f', '\u24D6': 'g', '\u24D7': 'h', '\u24D8': 'i', '\u24D9': 'j',
  '\u24DA': 'k', '\u24DB': 'l', '\u24DC': 'm', '\u24DD': 'n', '\u24DE': 'o',
  '\u24DF': 'p', '\u24E0': 'q', '\u24E1': 'r', '\u24E2': 's', '\u24E3': 't',
  '\u24E4': 'u', '\u24E5': 'v', '\u24E6': 'w', '\u24E7': 'x', '\u24E8': 'y',
  '\u24E9': 'z',
};

// Mathematical alphanumerics -> ASCII
const MATH_MAP = {};
const mathRanges = [
  [0x1D400, 'A'], [0x1D41A, 'a'], [0x1D434, 'A'], [0x1D44E, 'a'],
  [0x1D468, 'A'], [0x1D482, 'a'], [0x1D49C, 'A'], [0x1D4B6, 'a'],
  [0x1D504, 'A'], [0x1D51E, 'a'], [0x1D538, 'A'], [0x1D552, 'a'],
  [0x1D56C, 'A'], [0x1D586, 'a'], [0x1D5A0, 'A'], [0x1D5BA, 'a'],
  [0x1D5D4, 'A'], [0x1D5EE, 'a'], [0x1D608, 'A'], [0x1D622, 'a'],
  [0x1D63C, 'A'], [0x1D656, 'a'], [0x1D670, 'A'], [0x1D68A, 'a'],
];
for (const [start, base] of mathRanges) {
  for (let i = 0; i < 26; i++) {
    MATH_MAP[String.fromCodePoint(start + i)] = String.fromCharCode(base.charCodeAt(0) + i);
  }
}

// Leet speak map
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '+': 't', '*': 'u', '?': 'i' };

function normalizeText(text) {
  let result = '';

  for (const char of text) {
    const full = fullWidthToAscii(char);
    if (full !== char) { result += full.toLowerCase(); continue; }
    if (ENCLOSED_MAP[char]) { result += ENCLOSED_MAP[char]; continue; }
    if (MATH_MAP[char]) { result += MATH_MAP[char]; continue; }
    if (HOMOGLYPH_MAP[char]) { result += HOMOGLYPH_MAP[char]; continue; }

    const code = char.charCodeAt(0);
    // Strip combining characters (zalgo)
    if ((code >= 0x0300 && code <= 0x036F) || (code >= 0x1AB0 && code <= 0x1AFF) ||
        (code >= 0x1DC0 && code <= 0x1DFF) || (code >= 0x20D0 && code <= 0x20FF) ||
        (code >= 0xFE20 && code <= 0xFE2F)) continue;
    // Strip zero-width characters
    if ([0x200B, 0x200C, 0x200D, 0xFEFF, 0x2060, 0x00AD].includes(code)) continue;
    // Strip non-ASCII
    if (code > 0x7F) continue;

    result += char.toLowerCase();
  }

  // Apply leet before stripping
  result = result.replace(/[0-9@$!+*?]/g, c => LEET_MAP[c] || c);
  // Remove all non-alphanumeric
  result = result.replace(/[^a-z0-9]/g, '');
  // Collapse repeated chars
  result = result.replace(/(.)\1{2,}/g, '$1$1');

  return result;
}

// ══════════════════════════════════════════════════════════════
//  BLOCKED WORD LIST
// ══════════════════════════════════════════════════════════════

const BLOCKED_WORDS = {
  HATE_SPEECH: [
    'nigger', 'nigga', 'niggas', 'niggers', 'niggar', 'nigglet',
    'faggot', 'faggots', 'faggit', 'faget', 'fag', 'fags',
    'retard', 'retarded', 'retards', 'retardation',
    'coon', 'coons', 'kike', 'kikes', 'spic', 'spics',
    'chink', 'chinks', 'wetback', 'wetbacks', 'beaner', 'beaners',
    'tranny', 'trannies', 'nazi', 'nazis',
    'jihad', 'terrorist', 'terrorists',
  ],
  PROFANITY: [
    'fuck', 'fucks', 'fucker', 'fuckers', 'fucking', 'fucked', 'fuckin', 'motherfucker', 'motherfucking',
    'shit', 'shits', 'shitty', 'shitting', 'bullshit',
    'bitch', 'bitches', 'bitchy',
    'cunt', 'cunts', 'cunty',
    'dick', 'dicks', 'cock', 'cocks',
    'pussy', 'pussies',
    'asshole', 'assholes', 'whore', 'whores', 'slut', 'sluts', 'slutty',
    'bastard', 'bastards', 'twat', 'twats', 'damn',
    'wtf', 'stfu', 'pos',
    // Leet/obfuscated variants
    'fuuck', 'fick', 'fcuk', 'cuck', 'dik', 'shyt', 'bytch', 'pussi',
    'cum', 'cumming', 'cumshot',
  ],
  VIOLENT_THREAT: [
    'kys', 'kill yourself', 'kill urself', 'killmyself', 'kill myself', 'killyourself',
    'go die', 'go kill', 'die in a fire', 'hope you die',
    'i will kill', 'im going to kill', 'i am going to kill',
    'gonna kill', 'wanna kill', 'gotta kill',
    'i will find you', 'i will end you', 'i will hurt you',
    'i will shoot you', 'i will stab you',
    'shoot up', 'bomb threat', 'bomb the',
  ],
  SEXUAL_CONTENT: [
    'porn', 'pornhub', 'xnxx', 'xvideos', 'xhamster',
    'nudes', 'nude', 'send nudes', 'send pics',
    'naked', 'onlyfans', 'only fans',
    'masturbate', 'masturbating', 'masturbation',
    'jerk off', 'jerkoff', 'jacking off',
    'dick pic', 'dickpic', 'boobs', 'tits', 'titty', 'titties', 'breasts',
    'penis', 'vagina', 'genitals', 'oral', 'anal', 'handjob', 'blowjob', 'titjob',
    'sex tape', 'sex video', 'hentai', 'xxx', 'nsfw', 'adult content',
    'erotic', 'erotica', 'sexy', 'orgasm',
  ],
  SELF_HARM: [
    'kill myself', 'suicide', 'commit suicide', 'end my life', 'end your life',
    'cut myself', 'cutting myself', 'hurt myself',
    'hang myself', 'overdose', 'jump off',
    'noose', 'razor blades', 'pills',
    'want to die', 'wish i was dead', 'wish i were dead',
    'end it all', 'not worth living',
  ],
  EXTREMISM: [
    'heil hitler', 'white power', 'white supremac',
    'kkk', 'klan', 'aryan', 'isis', 'al qaeda', 'al-qaeda',
    'extremist', 'radicalize', 'radicalised',
  ],
  DOXXING: [
    'my address is', 'my ip address', 'my phone number',
    'dox', 'doxx', 'doxing', 'doxxing',
    'home address', 'personal info',
    'social security', 'credit card',
  ],
};

// Build regexes from blocked words
// as-written (with spaces) and spaceless (for normalized text)
function buildBlockedRegexes() {
  const asWritten = [];
  const spaceless = [];
  for (const category of Object.keys(BLOCKED_WORDS)) {
    for (const word of BLOCKED_WORDS[category]) {
      const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      asWritten.push(esc);
      spaceless.push(esc.replace(/\s+/g, ''));
    }
  }
  asWritten.sort((a, b) => b.length - a.length);
  spaceless.sort((a, b) => b.length - a.length);
  return {
    asWritten: new RegExp(`(?:${asWritten.join('|')})`, 'gi'),
    spaceless: new RegExp(`(?:${spaceless.join('|')})`, 'gi'),
  };
}

const { asWritten: BLOCKED_REGEX, spaceless: BLOCKED_REGEX_SPACELESS } = buildBlockedRegexes();

function getCategory(word) {
  for (const [cat, words] of Object.entries(BLOCKED_WORDS)) {
    if (words.some(w => w.toLowerCase() === word.toLowerCase())) return cat;
  }
  return 'PROFANITY';
}

// Short words that could appear inside other words ("ass" in "pass", "cum" in "accumulate")
// Checked against a space-preserving leet-normalized copy with word boundaries to avoid false positives.
const SHORT_BOUNDED_WORDS = [
  { word: 'ass', category: 'PROFANITY' },
  { word: 'cum', category: 'SEXUAL_CONTENT' },
  { word: 'fag', category: 'HATE_SPEECH' },
  { word: 'dick', category: 'PROFANITY' },
  { word: 'cock', category: 'PROFANITY' },
  { word: 'twat', category: 'PROFANITY' },
];

// Convert homoglyphs/leet but KEEP word separation so short words
// can be matched as standalone tokens (avoids "pass" -> "ass" FPs).
function normalizeKeepingSpaces(text) {
  let result = '';
  for (const char of text.toLowerCase()) {
    const full = fullWidthToAscii(char);
    if (full !== char) { result += full; continue; }
    if (ENCLOSED_MAP[char]) { result += ENCLOSED_MAP[char]; continue; }
    if (MATH_MAP[char]) { result += MATH_MAP[char]; continue; }
    if (HOMOGLYPH_MAP[char]) { result += HOMOGLYPH_MAP[char]; continue; }
    const code = char.charCodeAt(0);
    if ((code >= 0x0300 && code <= 0x036F) || (code >= 0x1AB0 && code <= 0x1AFF) ||
        (code >= 0x1DC0 && code <= 0x1DFF) || (code >= 0x20D0 && code <= 0x20FF) ||
        (code >= 0xFE20 && code <= 0xFE2F)) continue;
    if (code > 0x7F) continue;
    result += LEET_MAP[char] || char;
  }
  // collapse non-letters to a single space
  return result.replace(/[^a-z]+/g, ' ').trim();
}

function findBlockedWord(content) {
  // 1) Match against spaceless blocked regex (normalized text)
  const normalized = normalizeText(content);
  const spacelessMatch = normalized.match(BLOCKED_REGEX_SPACELESS);
  if (spacelessMatch) {
    const word = spacelessMatch[0].toLowerCase();
    return { word, category: getCategory(word) };
  }

  // 2) Short words: standalone tokens on space-preserving normalized text (avoid "pass"->"ass" FPs)
  const spaced = normalizeKeepingSpaces(content);
  for (const { word, category } of SHORT_BOUNDED_WORDS) {
    if (spaced === word) return { word, category };
    const re = new RegExp(`(^|\\s)${word}(\\s|$)`, 'i');
    if (re.test(spaced)) return { word, category };
  }

  // 3) Letter-by-letter obfuscation ("a s s", "n i g g a", "k i l l")
  //    Concatenate single-letter tokens and re-check short words + full blocked regex.
  if (spaced) {
    const tokens = spaced.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2 && tokens.filter(t => t.length === 1).length >= tokens.length * 0.5) {
      const concat = tokens.join('');
      for (const { word, category } of SHORT_BOUNDED_WORDS) {
        if (concat === word || concat.endsWith(word) || concat.startsWith(word)) {
          return { word, category };
        }
      }
      // also full blocked words concatenated (e.g. "p o r n" -> "porn")
      if (BLOCKED_REGEX_SPACELESS.test(concat)) {
        const w = concat.match(BLOCKED_REGEX_SPACELESS)[0].toLowerCase();
        return { word: w, category: getCategory(w) };
      }
    }
  }

  return null;
}

// ── Spam Detection ───────────────────────────────────────────

const userMessageHistory = new Map();
setInterval(() => {
  const cutoff = Date.now() - 300000;
  for (const [key, messages] of userMessageHistory) {
    const filtered = messages.filter(m => m.timestamp > cutoff);
    if (filtered.length === 0) userMessageHistory.delete(key);
    else userMessageHistory.set(key, filtered);
  }
}, 60000);

// ══════════════════════════════════════════════════════════════
//  MAIN MODERATION
// ══════════════════════════════════════════════════════════════

async function moderateMessage(content, userId, guildId) {
  if (!content || content.trim().length === 0) {
    return { violated: false, reason: 'Empty message', category: 'CLEAN' };
  }

  const cfg = getConfig(guildId);

  // Layer 1: Normalized text check (catches ALL bypasses)
  const blockedWord = findBlockedWord(content);
  if (blockedWord) {
    const { word, category } = blockedWord;
    return {
      violated: true,
      reason: `Prohibited content: "${word}" detected via normalization`,
      category,
      confidence: 1.0,
      severity: category === 'HATE_SPEECH' || category === 'VIOLENT_THREAT' ? 'critical' : 'high',
    };
  }

  // Layer 2: Spam detection
  const normalized = normalizeText(content);
  if (cfg.spamFilter) {
    const key = `${userId}:${guildId}`;
    if (!userMessageHistory.has(key)) userMessageHistory.set(key, []);
    const messages = userMessageHistory.get(key);
    const now = Date.now();
    messages.push({ content: normalized, timestamp: now });
    const windowStart = now - cfg.spamTimeWindowMs;
    const recent = messages.filter(m => m.timestamp >= windowStart);
    userMessageHistory.set(key, recent);

    if (recent.length > cfg.spamMessageLimit) {
      userMessageHistory.delete(key);
      return { violated: true, reason: `Spam: ${recent.length} messages in ${cfg.spamTimeWindowMs / 1000}s`, category: 'SPAM', confidence: 1.0, severity: 'high' };
    }
    const identical = recent.filter(m => m.content === normalized);
    if (identical.length >= 3) {
      return { violated: true, reason: 'Repeated identical messages', category: 'SPAM', confidence: 0.95, severity: 'medium' };
    }
  }

  // Layer 3: Link filter
  if (cfg.linkFilter) {
    const urls = content.match(/https?:\/\/[^\s]+/gi);
    if (urls) {
      for (const url of urls) {
        try {
          const domain = new URL(url).hostname.toLowerCase();
          if (!cfg.linkWhitelist.some(d => domain.includes(d))) {
            return { violated: true, reason: `Non-whitelisted link: ${domain}`, category: 'SCAM', confidence: 0.8, severity: 'medium' };
          }
        } catch {}
      }
    }
  }

  // Layer 4: Invite filter
  if (cfg.inviteFilter) {
    const invites = content.match(/discord\.(gg|com\/invite|app\.com\/invite)\/[a-zA-Z0-9]+/gi);
    if (invites) {
      for (const invite of invites) {
        const code = invite.split('/').pop();
        if (!cfg.inviteWhitelist.includes(code.toLowerCase())) {
          return { violated: true, reason: `Unauthorized invite: ${code}`, category: 'SPAM', confidence: 0.9, severity: 'medium' };
        }
      }
    }
  }

  // Layer 5: Caps filter
  if (cfg.capsFilter && content.length >= cfg.capsMinLength) {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 0) {
      const ratio = ((content.match(/[A-Z]/g) || []).length / letters.length) * 100;
      if (ratio >= cfg.capsPercentageThreshold) {
        return { violated: true, reason: `Excessive caps: ${Math.round(ratio)}%`, category: 'PROFANITY', confidence: 0.7, severity: 'low' };
      }
    }
  }

  // Layer 6: Mention spam
  const mentions = content.match(/<@!?\d+>/g);
  if (mentions && mentions.length > cfg.maxMentions) {
    return { violated: true, reason: `Mention spam: ${mentions.length} mentions`, category: 'SPAM', confidence: 0.85, severity: 'medium' };
  }

  // Layer 7: AI analysis
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ebsgroup.online',
        'X-Title': 'USCCB:free-Guard v3',
      },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyse this Discord message. Return JSON only:\n\n"${content.slice(0, 2000)}"` },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      console.error(`[OpenRouter] ${response.status}`);
      return { violated: false, reason: 'AI unavailable', category: 'CLEAN' };
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || '{}';
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return {
      violated: parsed.violated === true,
      reason: parsed.reason || 'Policy violation detected',
      category: parsed.category || 'UNKNOWN',
      confidence: parsed.confidence || 1.0,
      severity: parsed.severity || 'medium',
    };
  } catch (err) {
    console.error('[AI Moderation Error]', err.message);
    return { violated: false, reason: 'AI error', category: 'CLEAN' };
  }
}

// ── Image Moderation ─────────────────────────────────────────

async function fetchImageBuffer(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally { clearTimeout(timeout); }
}

async function moderateImage(imageUrl) {
  try {
    const imageBuffer = await fetchImageBuffer(imageUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(
        'https://router.huggingface.co/hf-inference/models/Falconsai/nsfw_image_detection',
        { method: 'POST', headers: { 'Authorization': `Bearer ${process.env.HUGGINGFACE_TOKEN}`, 'Content-Type': 'application/octet-stream' }, body: imageBuffer, signal: controller.signal }
      );
      clearTimeout(timeout);
      if (!response.ok) return { violated: false, reason: 'Image AI unavailable', category: 'CLEAN' };
      const results = await response.json();
      if (!Array.isArray(results)) return { violated: false, reason: 'Unexpected response', category: 'CLEAN' };
      const nsfw = results.find(r => r.label === 'nsfw');
      const score = nsfw?.score || 0;
      if (score >= 0.70) {
        return { violated: true, reason: `NSFW detected (${Math.round(score * 100)}%)`, category: 'SEXUAL_CONTENT', confidence: score, severity: score >= 0.9 ? 'critical' : 'high' };
      }
      return { violated: false, reason: `Clean (NSFW: ${Math.round(score * 100)}%)`, category: 'CLEAN', confidence: 1 - score };
    } finally { clearTimeout(timeout); }
  } catch (err) {
    console.error('[Image Error]', err.message);
    return { violated: false, reason: 'Image error', category: 'CLEAN' };
  }
}

function isAnalysableImage(attachment) {
  const types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (attachment.contentType && types.includes(attachment.contentType.toLowerCase())) return true;
  const ext = attachment.name?.split('.').pop()?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
}

// ── Reaction Moderation ──────────────────────────────────────

function moderateReaction(emoji, userId, guildId) {
  const cfg = getConfig(guildId);
  if (!cfg.reactionModeration) return null;
  if (emoji.name) {
    const lower = emoji.name.toLowerCase();
    const harmful = ['nsfw', 'porn', 'nude', 'naked', 'sex', 'kill', 'die', 'hate', 'slur', 'fuck', 'shit'];
    for (const h of harmful) {
      if (lower.includes(h)) {
        return { violated: true, reason: `Harmful emoji: ${emoji.name}`, category: 'SEXUAL_CONTENT', confidence: 0.85, severity: 'medium' };
      }
    }
  }
  return null;
}

// ── Backward-compatible helpers ──────────────────────────────

function checkHardBlocked(content) {
  const hit = findBlockedWord(content);
  if (!hit) return null;
  return {
    violated: true,
    reason: `Prohibited content: "${hit.word}" detected via normalization`,
    category: hit.category,
    confidence: 1.0,
    severity: hit.category === 'HATE_SPEECH' || hit.category === 'VIOLENT_THREAT' ? 'critical' : 'high',
  };
}

function clearUserHistory(userId, guildId) {
  userMessageHistory.delete(`${userId}:${guildId}`);
}

module.exports = {
  moderateMessage, moderateImage, isAnalysableImage,
  moderateReaction, clearUserHistory, normalizeText,
  checkHardBlocked,
};
