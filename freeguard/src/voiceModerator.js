// ============================================================
//  USCCB:free-Guard — Voice Chat Moderation v2.2
//  Pipeline: Discord Voice → Opus → ffmpeg PCM → WAV → Whisper
//  Fixes: Proper connection state handling, waits for ready
//  before attaching receiver, state change logging
//  EchoBastion Group
// ============================================================

const { EndBehaviorType, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { moderateMessage } = require('./moderator');
const { addStrike, clearStrikes } = require('./strikeManager');
const { getConfig } = require('./config');
const { log } = require('./logger');
const { spawn } = require('child_process');

const activeRecordings = new Map();
const userCooldowns = new Map();
const voiceWarnings = new Map();
const COOLDOWN_MS = 5000;
const WARNING_COOLDOWN_MS = 30000;
const SAMPLE_RATE = 48000;
const CHANNELS = 2;

async function waitForReady(connection, timeoutMs) {
  return new Promise((resolve) => {
    if (connection.state.status === VoiceConnectionStatus.Ready) {
      resolve(true);
      return;
    }

    const timer = setTimeout(() => {
      connection.off('stateChange', handler);
      resolve(false);
    }, timeoutMs);

    function handler(oldState, newState) {
      console.log(`  [VOICE] State: ${oldState.status} -> ${newState.status}`);
      if (newState.status === VoiceConnectionStatus.Ready) {
        clearTimeout(timer);
        connection.off('stateChange', handler);
        resolve(true);
      }
      if (newState.status === VoiceConnectionStatus.Destroyed) {
        clearTimeout(timer);
        connection.off('stateChange', handler);
        resolve(false);
      }
    }

    connection.on('stateChange', handler);
  });
}

async function startVoiceMonitoring(connection, guild, client) {
  console.log(`  [VOICE] Waiting for voice connection to be ready...`);

  const ready = await waitForReady(connection, 60_000);

  if (!ready) {
    const finalState = connection.state.status;
    console.error(`  [VOICE] Connection failed — final state: ${finalState}`);
    console.error(`  [VOICE] Possible causes:`);
    console.error(`  [VOICE]   - Bot missing Connect/Speak permissions`);
    console.error(`  [VOICE]   - Firewall blocking UDP (port 50000-65535)`);
    console.error(`  [VOICE]   - Pi cannot reach Discord voice servers`);
    connection.destroy();
    return;
  }

  console.log(`  [VOICE] Connection ready!`);
  await new Promise(r => setTimeout(r, 2000));

  const receiver = connection.receiver;
  if (!receiver) {
    console.error('  [VOICE] No receiver — check Connect + Speak permissions');
    return;
  }

  log('INFO', 'VOICE', `Voice monitoring active in ${guild.name}`);
  console.log(`  [VOICE] Listening in: ${guild.name}`);
  console.log(`  [VOICE] Receiver OK — waiting for speech...`);

  receiver.speaking.on('start', (userId) => {
    const member = guild.members.cache.get(userId);
    if (member?.user?.bot) return;

    const key = `${guild.id}:${userId}`;
    if (activeRecordings.has(key)) return;

    const now = Date.now();
    if (now - (userCooldowns.get(key) || 0) < COOLDOWN_MS) return;

    const cfg = getConfig(guild.id);
    if (!cfg.voiceModeration) return;

    activeRecordings.set(key, { startTime: now });

    console.log(`  [VOICE] Recording user: ${userId}`);

    const opusStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1500,
      },
    });

    const opusPackets = [];

    opusStream.on('data', (chunk) => {
      opusPackets.push(chunk);
    });

    opusStream.on('end', async () => {
      activeRecordings.delete(key);
      userCooldowns.set(key, Date.now());

      if (opusPackets.length < 5) {
        console.log(`  [VOICE] Too few packets (${opusPackets.length}), skipping`);
        return;
      }

      console.log(`  [VOICE] Processing ${opusPackets.length} packets from ${userId}`);

      try {
        const wavBuffer = await decodeOpusToWav(opusPackets);
        if (!wavBuffer) {
          console.log('  [VOICE] ffmpeg decode failed');
          return;
        }

        console.log(`  [VOICE] WAV: ${wavBuffer.length} bytes`);

        if (wavBuffer.length < 4000) {
          console.log('  [VOICE] Audio too short, skipping');
          return;
        }

        const transcript = await transcribeAudio(wavBuffer);
        if (!transcript || transcript.trim().length < 2) {
          console.log('  [VOICE] No transcript returned');
          return;
        }

        console.log(`  [VOICE] Transcript: "${transcript}"`);
        log('INFO', 'VOICE_TRANSCRIPT', `User ${userId}: "${transcript}"`, { userId, guildId: guild.id });

        const result = await moderateMessage(transcript, userId, guild.id);
        if (!result.violated) {
          console.log('  [VOICE] Clean');
          return;
        }

        console.log(`  [VOICE] VIOLATION: ${result.category} | ${result.reason}`);
        log('WARN', 'VOICE_VIOLATION', `${userId}: ${result.reason}`, {
          userId, guildId: guild.id, category: result.category, severity: result.severity,
        });

        await handleVoiceViolation(guild, client, userId, result, transcript);
      } catch (err) {
        console.error('  [VOICE] Processing error:', err.message);
        log('ERROR', 'VOICE', `Processing error: ${err.message}`);
      }
    });

    opusStream.on('error', (err) => {
      activeRecordings.delete(key);
      console.error('  [VOICE] Stream error:', err.message);
    });
  });

  receiver.speaking.on('end', () => {});

  // Monitor connection health — if it drops, log it
  connection.on('stateChange', (oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Destroyed) {
      console.log('  [VOICE] Voice connection destroyed');
      log('INFO', 'VOICE', `Voice connection destroyed in ${guild.name}`);
    }
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      console.log('  [VOICE] Voice disconnected — attempting reconnect...');
    }
  });
}

async function decodeOpusToWav(opusPackets) {
  return new Promise((resolve) => {
    try {
      const opusBuffer = Buffer.concat(opusPackets);

      const ffmpeg = spawn('ffmpeg', [
        '-f', 'opus',
        '-ar', String(SAMPLE_RATE),
        '-ac', String(CHANNELS),
        '-i', 'pipe:0',
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        '-acodec', 'pcm_s16le',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      let wavData = [];
      let stderrData = '';

      ffmpeg.stdout.on('data', (chunk) => wavData.push(chunk));
      ffmpeg.stderr.on('data', (chunk) => { stderrData += chunk.toString(); });

      ffmpeg.on('close', (code) => {
        if (code !== 0 || wavData.length === 0) {
          console.error(`  [ffmpeg] Exit ${code}: ${stderrData.slice(0, 300)}`);
          resolve(null);
          return;
        }
        resolve(Buffer.concat(wavData));
      });

      ffmpeg.on('error', (err) => {
        console.error('  [ffmpeg] Error:', err.message);
        resolve(null);
      });

      ffmpeg.stdin.write(opusBuffer);
      ffmpeg.stdin.end();
    } catch (err) {
      console.error('  [ffmpeg] Exception:', err.message);
      resolve(null);
    }
  });
}

async function transcribeAudio(wavBuffer) {
  if (!process.env.HUGGINGFACE_TOKEN) {
    console.error('  [Whisper] HUGGINGFACE_TOKEN not set');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(
      'https://router.huggingface.co/hf-inference/models/openai/whisper-large-v3',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_TOKEN}`,
          'Content-Type': 'audio/wav',
        },
        body: wavBuffer,
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`  [Whisper] HTTP ${response.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    return data?.text?.trim() || null;
  } catch (err) {
    console.error('  [Whisper] Error:', err.message);
    return null;
  }
}

async function handleVoiceViolation(guild, client, userId, result, transcript) {
  const cfg = getConfig(guild.id);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;

  const warningKey = `${guild.id}:${userId}`;
  const lastWarning = voiceWarnings.get(warningKey) || 0;

  if (result.severity === 'critical' || result.category === 'SEXUAL_CONTENT' || result.category === 'VIOLENT_THREAT') {
    await applyVoiceBan(member, guild, result, cfg);
    return;
  }

  if (cfg.voiceWarningBeforeDisconnect && (Date.now() - lastWarning) < WARNING_COOLDOWN_MS) {
    await disconnectWithStrike(member, guild, result, cfg, client);
    return;
  }

  voiceWarnings.set(warningKey, Date.now());
  await sendVoiceWarning(member, guild, result, client);
  await disconnectUser(member, guild);
}

async function sendVoiceWarning(member, guild, result, client) {
  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setColor(0xf5c518)
    .setTitle('Voice Chat Warning')
    .setDescription(
      `You received a warning in **${guild.name}** voice chat.\n\n` +
      `**Reason:** ${result.reason}\n\n` +
      `Further violations will result in disconnection and strikes.`
    )
    .setFooter({ text: 'USCCB:free-Guard | Voice Moderation' })
    .setTimestamp();

  await member.user.send({ embeds: [embed] }).catch(() => {});
  log('INFO', 'VOICE_WARNING', `Warning sent to ${member.user.tag}`, { userId: member.id, guildId: guild.id });
}

async function disconnectWithStrike(member, guild, result, cfg, client) {
  const strikeData = await addStrike(member.id, guild.id, {
    reason: `[VOICE] ${result.reason}`,
    category: result.category,
    originalContent: '[Voice transcript]',
    channelId: 'voice',
    source: 'voice',
  });

  const strikes = strikeData.count;
  await disconnectUser(member, guild);

  const { EmbedBuilder } = require('discord.js');
  const embed = new EmbedBuilder()
    .setColor(strikes >= 3 ? 0xd4202a : strikes === 2 ? 0xff8800 : 0xf5c518)
    .setTitle(`Voice Violation — Strike ${strikes}/${cfg.maxStrikes}`)
    .setDescription(
      `You were **disconnected** from voice chat in **${guild.name}** for: ${result.reason}\n\n` +
      (strikes >= cfg.maxStrikes
        ? `**Maximum strikes reached.** You are now banned for ${cfg.banDurationHours} hours.`
        : `**${strikes}/${cfg.maxStrikes}** strikes. Further violations will result in a ban.`)
    )
    .addFields(
      { name: 'Category', value: `\`${result.category}\``, inline: true },
      { name: 'Source', value: 'Voice Chat', inline: true },
    )
    .setFooter({ text: 'USCCB:free-Guard | Voice Moderation' })
    .setTimestamp();

  await member.user.send({ embeds: [embed] }).catch(() => {});
  log('INFO', 'VOICE_DISCONNECT', `${member.user.tag} disconnected — strike ${strikes}`, {
    userId: member.id, guildId: guild.id, strikes,
  });

  if (strikes >= cfg.maxStrikes) {
    await applyVoiceBan(member, guild, result, cfg, true);
  }
}

async function applyVoiceBan(member, guild, result, cfg, fromStrike = false) {
  const { EmbedBuilder } = require('discord.js');
  const durationMs = cfg.banDurationHours * 60 * 60 * 1000;

  const embed = new EmbedBuilder()
    .setColor(0xd4202a)
    .setTitle('Voice Chat Ban')
    .setDescription(
      fromStrike
        ? `You reached the maximum strike limit in **${guild.name}** voice chat.\nYou are banned for **${cfg.banDurationHours} hours**.`
        : `You have been **banned for ${cfg.banDurationHours} hours** from **${guild.name}** for a critical voice violation.\n\n**Reason:** ${result.reason}`
    )
    .addFields(
      { name: 'Duration', value: `${cfg.banDurationHours} hours`, inline: true },
      { name: 'Auto-Unban', value: 'Ban lifts automatically. Strikes reset.', inline: true },
    )
    .setFooter({ text: 'USCCB:free-Guard | Voice Moderation' })
    .setTimestamp();

  await member.user.send({ embeds: [embed] }).catch(() => {});

  await guild.members.ban(member.id, {
    reason: `[free-Guard VOICE] ${result.reason}`,
    deleteMessageSeconds: 0,
  }).catch(e => console.error('  [Voice Ban Error]', e.message));

  setTimeout(async () => {
    await guild.members.unban(member.id, '[free-Guard] Voice ban expired').catch(() => {});
    await clearStrikes(member.id, guild.id);
    voiceWarnings.delete(`${guild.id}:${member.id}`);
    log('INFO', 'VOICE_UNBAN', `${member.id} voice ban expired`);
  }, durationMs);

  log('INFO', 'VOICE_BAN', `${member.user.tag} banned for ${cfg.banDurationHours}h`, {
    userId: member.id, guildId: guild.id, duration: cfg.banDurationHours,
  });
}

async function disconnectUser(member, guild) {
  await member.voice?.disconnect('[free-Guard] Voice moderation').catch((e) => {
    console.error('  [Voice Disconnect Error]', e.message);
  });
}

function getVoiceActivity(guildId) {
  const active = [];
  for (const [key, data] of activeRecordings) {
    if (key.startsWith(guildId)) {
      const [, userId] = key.split(':');
      active.push({ userId, duration: Math.round((Date.now() - data.startTime) / 1000) });
    }
  }
  return active;
}

function stopVoiceMonitoring(guildId) {
  for (const key of activeRecordings) {
    if (key.startsWith(guildId)) activeRecordings.delete(key);
  }
  for (const key of voiceWarnings) {
    if (key.startsWith(guildId)) voiceWarnings.delete(key);
  }
}

module.exports = { startVoiceMonitoring, stopVoiceMonitoring, getVoiceActivity };
