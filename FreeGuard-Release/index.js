// ============================================================
//  USCCB:free-Guard v2 — Main Bot
//  AI-Powered Discord Moderation by EchoBastion Group
//  Features: text/image/voice moderation, configurable rules,
//  appeal system, welcome system, audit logging, health stats
// ============================================================

require('dotenv').config();
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  PermissionFlagsBits, REST, Routes, SlashCommandBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  channelMention, userMention,
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const { moderateMessage, moderateImage, isAnalysableImage, moderateReaction } = require('./src/moderator');
const { getStrikes, addStrike, getUserLog, clearStrikes, recordBan, removeBan, submitAppeal, resolveAppeal, getPendingAppeals, checkExpiredStrikes, getGuildStats } = require('./src/strikeManager');
const { getConfig, setConfig, resetConfig, isChannelExempt } = require('./src/config');
const { log, logError, logWarn, setAuditChannel, getStats } = require('./src/logger');
const { startVoiceMonitoring, stopVoiceMonitoring, getVoiceActivity } = require('./src/voiceModerator');
const { startDashboard, setDiscordClient } = require('./dashboard-server');

const monitoredChannels = new Map();
const startTime = Date.now();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// ── Slash Command Definitions ────────────────────────────────

const commands = [
  // ── Admin: Moderation ──
  new SlashCommandBuilder()
    .setName('guard-log')
    .setDescription('[ADMIN] View a user\'s full strike log')
    .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('guard-strikes')
    .setDescription('[ADMIN] View a user\'s current strike count')
    .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('guard-clear')
    .setDescription('[ADMIN] Clear all strikes for a user')
    .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
    .addUserOption(opt => opt.setName('reason').setDescription('Reason for clearing'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('guard-status')
    .setDescription('[ADMIN] View bot status, stats, and system health')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('guard-unban')
    .setDescription('[ADMIN] Manually unban a user')
    .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  // ── Admin: Config ──
  new SlashCommandBuilder()
    .setName('guard-config')
    .setDescription('[ADMIN] View or modify bot configuration')
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View current configuration'))
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set a configuration value')
      .addStringOption(opt => opt.setName('key').setDescription('Setting key').setRequired(true).setAutocomplete(true))
      .addStringOption(opt => opt.setName('value').setDescription('New value').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('reset')
      .setDescription('Reset all settings to defaults'))
    .addSubcommand(sub => sub
      .setName('exempt-channel')
      .setDescription('Toggle channel exemption')
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel to toggle').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('exempt-role')
      .setDescription('Toggle role exemption')
      .addRoleOption(opt => opt.setName('role').setDescription('Role to toggle').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('audit-log')
      .setDescription('Set the audit log channel')
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel for audit logs').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ── Admin: Stats ──
  new SlashCommandBuilder()
    .setName('guard-stats')
    .setDescription('[ADMIN] View moderation statistics')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('guard-voice')
    .setDescription('[ADMIN] View voice moderation activity')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // ── Admin: Appeal Management ──
  new SlashCommandBuilder()
    .setName('guard-appeals')
    .setDescription('[ADMIN] View pending appeals')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('guard-resolve-appeal')
    .setDescription('[ADMIN] Approve or deny an appeal')
    .addStringOption(opt => opt.setName('appeal-id').setDescription('Appeal ID').setRequired(true))
    .addStringOption(opt => opt.setName('action').setDescription('Approve or deny').setRequired(true).addChoices(
      { name: 'Approve', value: 'approve' },
      { name: 'Deny', value: 'deny' },
    ))
    .addUserOption(opt => opt.setName('user').setDescription('User who submitted the appeal').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // ── Admin: Logs ──
  new SlashCommandBuilder()
    .setName('guard-logs')
    .setDescription('[ADMIN] Read and filter encrypted logs')
    .addStringOption(opt => opt.setName('date').setDescription('Date (YYYY-MM-DD)'))
    .addStringOption(opt => opt.setName('filter').setDescription('Search filter'))
    .addStringOption(opt => opt.setName('level').setDescription('Log level').addChoices(
      { name: 'Info', value: 'INFO' },
      { name: 'Warn', value: 'WARN' },
      { name: 'Error', value: 'ERROR' },
    ))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  // ── User Commands ──
  new SlashCommandBuilder()
    .setName('my-strikes')
    .setDescription('Check your own strike count'),

  new SlashCommandBuilder()
    .setName('my-log')
    .setDescription('View your personal moderation history'),

  new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Submit an appeal for your strikes')
    .addStringOption(opt => opt.setName('reason').setDescription('Why your strikes should be reviewed').setRequired(true)),
];

// ── Register Slash Commands ──────────────────────────────────

client.once('ready', async () => {
  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║  USCCB:free-Guard v2  ONLINE              ║`);
  console.log(`║  by EchoBastion Group                     ║`);
  console.log(`╠═══════════════════════════════════════════╣`);
  console.log(`║  Bot: ${client.user.tag.padEnd(35)}║`);
  console.log(`║  Guilds: ${String(client.guilds.cache.size).padEnd(32)}║`);
  console.log(`║  Model: arcee-ai/trinity-large-thinking   ║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);

  // Register commands per guild
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  let registered = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guild.id),
        { body: commands.map(c => c.toJSON()) }
      );
      registered++;
      console.log(`  [OK] Commands registered: ${guild.name}`);

      // Setup audit log channel
      const cfg = getConfig(guild.id);
      if (cfg.auditLogChannelId) {
        const ch = guild.channels.cache.get(cfg.auditLogChannelId);
        if (ch) setAuditChannel(ch);
      }
    } catch (err) {
      console.error(`  [FAIL] ${guild.name}: ${err.message}`);
    }
  }

  // Start strike expiry checker (every hour)
  setInterval(() => {
    const expired = checkExpiredStrikes();
    if (expired > 0) console.log(`  [EXPIRY] ${expired} user(s) had strikes expire`);
  }, 3600000);

  // Start log pruner (daily)
  setInterval(() => {
    const { pruneLogs } = require('./src/logger');
    const pruned = pruneLogs(30);
    if (pruned > 0) console.log(`  [PRUNE] ${pruned} old log file(s) removed`);
  }, 86400000);

  log('INFO', 'STARTUP', `Bot online — ${client.guilds.cache.size} guild(s), ${registered} commands registered`);
});

// ── Auto-register commands when added to new server ──────────

client.on('guildCreate', async (guild) => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, guild.id),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log(`  [OK] Commands auto-registered: ${guild.name}`);
  } catch (err) {
    console.error(`  [FAIL] Auto-register ${guild.name}: ${err.message}`);
  }
});

// ── Voice State Monitoring ───────────────────────────────────

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  function shouldModerate(channel) {
    if (!channel) return false;
    return !isChannelExempt(channel.name, guild.id);
  }

  const newChannel = newState.channel;
  const oldChannel = oldState.channel;

  if (newChannel && shouldModerate(newChannel)) {
    const existingConnection = getVoiceConnection(guild.id);
    if (!existingConnection) {
      try {
        const connection = joinVoiceChannel({
          channelId: newChannel.id,
          guildId: guild.id,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: true,
        });

        monitoredChannels.set(guild.id, newChannel.id);
        log('INFO', 'VOICE', `Joined voice channel: ${newChannel.name} in ${guild.name}`);
        console.log(`  [VOICE] Monitoring: #${newChannel.name} in ${guild.name}`);

        await startVoiceMonitoring(connection, guild, client);
      } catch (err) {
        console.error('[Voice Join Error]', err.message);
      }
    }
  }

  if (oldChannel && shouldModerate(oldChannel)) {
    const connection = getVoiceConnection(guild.id);
    if (connection) {
      setTimeout(() => {
        const vc = guild.channels.cache.get(oldChannel.id);
        if (!vc) return;
        const humans = vc.members.filter(m => !m.user.bot).size;
        if (humans === 0) {
          connection.destroy();
          monitoredChannels.delete(guild.id);
          log('INFO', 'VOICE', `Left empty channel: ${oldChannel.name}`);
          console.log(`  [VOICE] Left: #${oldChannel.name}`);
        }
      }, 15000);
    }
  }
});

// ── Message Moderation ───────────────────────────────────────

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const cfg = getConfig(message.guild.id);
  if (!cfg.textModeration) return;
  if (isChannelExempt(message.channel.name, message.guild.id)) return;

  try {
    let result = await moderateMessage(message.content, message.author.id, message.guild.id);

    // Check images if text passed
    if (!result.violated && message.attachments.size > 0 && cfg.imageModeration) {
      const images = [...message.attachments.values()].filter(a => isAnalysableImage(a));
      for (const attachment of images) {
        const imgResult = await moderateImage(attachment.url);
        if (imgResult.violated) {
          result = imgResult;
          break;
        }
      }
    }

    if (result.violated) {
      if (cfg.deleteViolations) {
        await message.delete().catch(() => {});
      }

      const strikeData = await addStrike(message.author.id, message.guild.id, {
        reason: result.reason,
        category: result.category,
        originalContent: message.content,
        channelId: message.channel.id,
        source: 'text',
      });

      const currentStrikes = strikeData.count;

      log('WARN', 'VIOLATION', `${message.author.tag}: ${result.reason}`, {
        userId: message.author.id,
        guildId: message.guild.id,
        strikes: currentStrikes,
        category: result.category,
        severity: result.severity,
        channel: message.channel.name,
      });

      if (currentStrikes >= cfg.maxStrikes) {
        const banDurationMs = cfg.banDurationHours * 60 * 60 * 1000;
        try {
          await message.guild.members.ban(message.author.id, {
            reason: `[free-Guard] Strike ${currentStrikes}/${cfg.maxStrikes}: ${result.reason}`,
            deleteMessageSeconds: 0,
          });

          await recordBan(message.author.id, message.guild.id, banDurationMs, result.reason);

          if (cfg.dmWarnings) {
            const user = await client.users.fetch(message.author.id).catch(() => null);
            if (user) {
              const dmEmbed = buildDMEmbed(currentStrikes, result, true, cfg);
              const appealBtn = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`freeguard_appeal:${message.guild.id}`)
                  .setLabel('📝 Appeal this ban')
                  .setStyle(ButtonStyle.Primary)
              );
              await user.send({ embeds: [dmEmbed], components: [appealBtn] }).catch(() => {});
            }
          }

          setTimeout(async () => {
            await message.guild.members.unban(message.author.id, '[free-Guard] Ban expired').catch(() => {});
            await clearStrikes(message.author.id, message.guild.id, 'Ban expired');
            await removeBan(message.author.id, message.guild.id);
            log('INFO', 'UNBAN', `${message.author.id} unbanned — ban expired`);
          }, banDurationMs);

          log('INFO', 'BAN', `${message.author.tag} banned for ${cfg.banDurationHours}h`, {
            userId: message.author.id,
            guildId: message.guild.id,
          });
        } catch (banErr) {
          logError('BAN', `Ban failed for ${message.author.id}: ${banErr.message}`);
        }
      } else {
        if (cfg.dmWarnings) {
          const user = await client.users.fetch(message.author.id).catch(() => null);
          if (user) {
            const dmEmbed = buildDMEmbed(currentStrikes, result, false, cfg);
            await user.send({ embeds: [dmEmbed] }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    logError('MODERATION', `Error: ${err.message}`);
  }
});

// ── Reaction Moderation ──────────────────────────────────────

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (!reaction.message.guild) return;

  const result = moderateReaction(reaction.emoji, user.id, reaction.message.guild.id);
  if (!result) return;

  try {
    await reaction.users.remove(user.id).catch(() => {});

    const strikeData = await addStrike(user.id, reaction.message.guild.id, {
      reason: result.reason,
      category: result.category,
      originalContent: `[Reaction: ${reaction.emoji.name}]`,
      channelId: reaction.message.channel.id,
      source: 'reaction',
    });

    log('WARN', 'REACTION_VIOLATION', `${user.tag}: ${result.reason}`, {
      userId: user.id,
      guildId: reaction.message.guild.id,
      emoji: reaction.emoji.name,
    });

    const cfg = getConfig(reaction.message.guild.id);
    if (cfg.dmWarnings) {
      const dmEmbed = new EmbedBuilder()
        .setColor(0xf5c518)
        .setTitle('⚠️ Reaction Removed')
        .setDescription(`Your reaction was removed in **${reaction.message.guild.name}**.\n\n**Reason:** ${result.reason}\n**Strike:** ${strikeData.count}/${cfg.maxStrikes}`)
        .setFooter({ text: 'USCCB:free-Guard' })
        .setTimestamp();
      await user.send({ embeds: [dmEmbed] }).catch(() => {});
    }
  } catch {}
});

// ── Welcome System ───────────────────────────────────────────

client.on('guildMemberAdd', async (member) => {
  const cfg = getConfig(member.guild.id);
  if (!cfg.welcomeEnabled || !cfg.welcomeChannelId) return;

  const channel = member.guild.channels.cache.get(cfg.welcomeChannelId);
  if (!channel) return;

  const message = cfg.welcomeMessage
    .replace('{user}', `<@${member.id}>`)
    .replace('{server}', member.guild.name)
    .replace('{username}', member.user.username)
    .replace('{membercount}', member.guild.memberCount);

  const embed = new EmbedBuilder()
    .setColor(0x00c896)
    .setTitle(`Welcome to ${member.guild.name}!`)
    .setDescription(message)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: 'USCCB:free-Guard | Community Protection' })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});

  // Auto-role
  if (cfg.welcomeRole) {
    const role = member.guild.roles.cache.get(cfg.welcomeRole);
    if (role) {
      await member.roles.add(role, '[free-Guard] Welcome role').catch(() => {});
    }
  }

  log('INFO', 'WELCOME', `New member: ${member.user.tag} in ${member.guild.name}`);
});

// ── Slash Command Handler ────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  // Autocomplete handler
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused();
    const keys = [
      'textModeration', 'imageModeration', 'voiceModeration', 'reactionModeration',
      'linkFilter', 'spamFilter', 'inviteFilter', 'capsFilter',
      'spamMessageLimit', 'spamTimeWindowMs', 'capsPercentageThreshold',
      'maxStrikes', 'banDurationHours', 'strikeExpiryDays', 'autoClearOnExpiry',
      'maxMentions', 'dmWarnings', 'deleteViolations',
      'voiceSensitivity', 'voiceWarningBeforeDisconnect', 'voiceMaxRecordingSeconds',
      'welcomeEnabled', 'welcomeMessage', 'welcomeRole',
      'logChannelId', 'welcomeChannelId', 'auditLogChannelId',
    ];
    const filtered = keys.filter(k => k.includes(focused.value.toLowerCase()));
    await interaction.respond(filtered.map(k => ({ name: k, value: k }))).catch(() => {});
    return;
  }

  // ── Ban appeal form: button → modal (sent in the ban DM) ──
  if (interaction.isButton() && interaction.customId.startsWith('freeguard_appeal:')) {
    const guildId = interaction.customId.split(':')[1];
    const modal = new ModalBuilder()
      .setCustomId(`freeguard_appeal_modal:${guildId}`)
      .setTitle('Appeal your ban');
    const reason = new TextInputBuilder()
      .setCustomId('appeal_reason')
      .setLabel('Why should the ban be lifted?')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1500);
    modal.addComponents(new ActionRowBuilder().addComponents(reason));
    return interaction.showModal(modal).catch(err => logError('APPEAL', `Show modal failed: ${err.message}`));
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('freeguard_appeal_modal:')) {
    const guildId = interaction.customId.split(':')[1];
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    try {
      const reason = interaction.fields.getTextInputValue('appeal_reason');
      await submitAppeal(interaction.user.id, guildId, reason);
      await interaction.editReply({ content: '✅ Your appeal has been submitted. A moderator will review it from the dashboard.' });
    } catch (err) {
      logError('APPEAL', `Submit failed: ${err.message}`);
      await interaction.editReply({ content: '⚠️ Appeal failed to save (' + err.message + '). Please try again.' }).catch(() => {});
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const { commandName, user, guild } = interaction;

  log('INFO', 'COMMAND', `/${commandName} by ${user.tag} in ${guild?.name || 'DM'}`);

  // ── /guard-log ──
  if (commandName === 'guard-log') {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user');
    const logData = await getUserLog(target.id, guild.id);

    if (!logData || !logData.strikes || logData.strikes.length === 0) {
      return interaction.editReply({ content: `✅ **${target.username}** has a clean record.` });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Strike Log — ${target.username}`)
      .setColor(0xd4202a)
      .setDescription(`**Total Strikes:** ${logData.count}\n**User ID:** \`${target.id}\``)
      .setFooter({ text: 'USCCB:free-Guard | AES-256-GCM Encrypted' })
      .setTimestamp();

    const recentStrikes = logData.strikes.slice(-10);
    for (const s of recentStrikes) {
      embed.addFields({
        name: `Strike #${s.strikeNumber} — ${s.category}`,
        value: `**Reason:** ${s.reason}\n**Source:** ${s.source || 'text'}\n**Channel:** ${s.channelId === 'voice' ? '🎙️ Voice' : `<#${s.channelId}>`}\n**Time:** <t:${Math.floor(new Date(s.timestamp).getTime() / 1000)}:R>`,
        inline: false,
      });
    }

    if (logData.strikes.length > 10) {
      embed.setDescription(embed.data.description + `\n\n*Showing last 10 of ${logData.strikes.length} strikes*`);
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /guard-strikes ──
  if (commandName === 'guard-strikes') {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user');
    const cfg = getConfig(guild.id);
    const data = await getStrikes(target.id, guild.id);

    const embed = new EmbedBuilder()
      .setTitle(`Strike Count — ${target.username}`)
      .setColor(data >= cfg.maxStrikes ? 0xd4202a : data >= cfg.maxStrikes - 1 ? 0xff8800 : 0x00c896)
      .setDescription(`**${target.username}** has **${data}/${cfg.maxStrikes}** strikes.`)
      .setFooter({ text: 'USCCB:free-Guard' });

    if (data >= cfg.maxStrikes - 1) {
      embed.setThumbnail('https://i.imgur.com/warning.png');
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /guard-clear ──
  if (commandName === 'guard-clear') {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || `Cleared by ${user.tag}`;
    await clearStrikes(target.id, guild.id, reason);

    const embed = new EmbedBuilder()
      .setColor(0x00c896)
      .setTitle('Strikes Cleared')
      .setDescription(`All strikes cleared for **${target.username}**.\n**Reason:** ${reason}`)
      .setFooter({ text: 'USCCB:free-Guard' });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /guard-status ──
  if (commandName === 'guard-status') {
    await interaction.deferReply({ ephemeral: true });
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;
    const loggerStats = getStats();
    const cfg = getConfig(guild.id);

    const embed = new EmbedBuilder()
      .setTitle('USCCB:free-Guard v2 — System Status')
      .setColor(0x00c896)
      .addFields(
        { name: 'Bot', value: `\`${client.user.tag}\``, inline: true },
        { name: 'Version', value: '`v2.0.0`', inline: true },
        { name: 'Uptime', value: `\`${uptimeStr}\``, inline: true },
        { name: 'Guilds', value: `\`${client.guilds.cache.size}\``, inline: true },
        { name: 'Text AI', value: '`arcee-ai/trinity-large-thinking:free`', inline: true },
        { name: 'Image AI', value: '`Falconsai/nsfw_image_detection`', inline: true },
        { name: 'Voice AI', value: '`openai/whisper-large-v3`', inline: true },
        { name: 'Encryption', value: '`AES-256-GCM`', inline: true },
        { name: 'Total Logs', value: `\`${loggerStats.total}\``, inline: true },
        { name: 'Violations', value: `\`${loggerStats.violations}\``, inline: true },
        { name: 'Voice Events', value: `\`${loggerStats.voiceEvents}\``, inline: true },
        { name: 'Commands Run', value: `\`${loggerStats.commands}\``, inline: true },
        { name: 'Text Mod', value: cfg.textModeration ? '`ON`' : '`OFF`', inline: true },
        { name: 'Image Mod', value: cfg.imageModeration ? '`ON`' : '`OFF`', inline: true },
        { name: 'Voice Mod', value: cfg.voiceModeration ? '`ON`' : '`OFF`', inline: true },
        { name: 'Spam Filter', value: cfg.spamFilter ? '`ON`' : '`OFF`', inline: true },
        { name: 'Link Filter', value: cfg.linkFilter ? '`ON`' : '`OFF`', inline: true },
      )
      .setFooter({ text: 'USCCB:free-Guard v2 | EchoBastion Group' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /guard-unban ──
  if (commandName === 'guard-unban') {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user');
    try {
      await guild.members.unban(target.id, `[free-Guard] Manual unban by ${user.tag}`);
      await clearStrikes(target.id, guild.id, `Unbanned by ${user.tag}`);
      await removeBan(target.id, guild.id);

      const embed = new EmbedBuilder()
        .setColor(0x00c896)
        .setTitle('User Unbanned')
        .setDescription(`**${target.username}** has been unbanned and strikes cleared.`)
        .setFooter({ text: 'USCCB:free-Guard' });

      return interaction.editReply({ embeds: [embed] });
    } catch {
      return interaction.editReply({ content: `Could not unban **${target.username}**. They may not be banned.` });
    }
  }

  // ── /guard-config ──
  if (commandName === 'guard-config') {
    await interaction.deferReply({ ephemeral: true });
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const cfg = getConfig(guild.id);
      const embed = new EmbedBuilder()
        .setTitle('Bot Configuration')
        .setColor(0x5865f2)
        .setDescription('Current settings for this server:')
        .setFooter({ text: 'USCCB:free-Guard | EchoBastion Group' })
        .setTimestamp();

      const groups = {
        'Moderation': ['textModeration', 'imageModeration', 'voiceModeration', 'reactionModeration', 'spamFilter', 'linkFilter', 'inviteFilter', 'capsFilter'],
        'Thresholds': ['spamMessageLimit', 'spamTimeWindowMs', 'capsPercentageThreshold', 'maxMentions', 'maxStrikes', 'banDurationHours', 'strikeExpiryDays'],
        'Voice': ['voiceSensitivity', 'voiceWarningBeforeDisconnect', 'voiceMaxRecordingSeconds'],
        'System': ['dmWarnings', 'deleteViolations', 'logTranscripts', 'autoClearOnExpiry', 'welcomeEnabled'],
      };

      for (const [group, keys] of Object.entries(groups)) {
        const values = keys.map(k => `**${k}:** \`${JSON.stringify(cfg[k])}\``).join('\n');
        embed.addFields({ name: group, value: values, inline: false });
      }

      if (cfg.exemptChannels.length > 0) {
        embed.addFields({ name: 'Exempt Channels', value: cfg.exemptChannels.map(id => `<#${id}>`).join(', '), inline: false });
      }
      if (cfg.exemptRoles.length > 0) {
        embed.addFields({ name: 'Exempt Roles', value: cfg.exemptRoles.map(id => `<@&${id}>`).join(', '), inline: false });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'set') {
      const key = interaction.options.getString('key');
      const value = interaction.options.getString('value');

      const booleanKeys = ['textModeration', 'imageModeration', 'voiceModeration', 'reactionModeration', 'linkFilter', 'spamFilter', 'inviteFilter', 'capsFilter', 'dmWarnings', 'deleteViolations', 'logTranscripts', 'autoClearOnExpiry', 'welcomeEnabled', 'voiceWarningBeforeDisconnect'];
      const numberKeys = ['spamMessageLimit', 'spamTimeWindowMs', 'capsPercentageThreshold', 'maxMentions', 'maxStrikes', 'banDurationHours', 'strikeExpiryDays', 'voiceSensitivity', 'voiceMaxRecordingSeconds'];

      let parsed;
      if (booleanKeys.includes(key)) {
        parsed = value.toLowerCase() === 'true' || value === '1' || value.toLowerCase() === 'on';
      } else if (numberKeys.includes(key)) {
        parsed = Number(value);
        if (isNaN(parsed)) return interaction.editReply({ content: `Invalid number for **${key}**.` });
      } else if (key === 'welcomeMessage') {
        parsed = value;
      } else {
        return interaction.editReply({ content: `Unknown key: **${key}**. Use \`/guard-config view\` to see available keys.` });
      }

      setConfig(guild.id, { [key]: parsed });

      const embed = new EmbedBuilder()
        .setColor(0x00c896)
        .setTitle('Configuration Updated')
        .setDescription(`**${key}** set to \`${JSON.stringify(parsed)}\``)
        .setFooter({ text: 'USCCB:free-Guard' });

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'reset') {
      resetConfig(guild.id);
      return interaction.editReply({ content: '✅ Configuration reset to defaults.' });
    }

    if (sub === 'exempt-channel') {
      const channel = interaction.options.getChannel('channel');
      const cfg = getConfig(guild.id);
      const idx = cfg.exemptChannels.indexOf(channel.id);
      if (idx >= 0) {
        cfg.exemptChannels.splice(idx, 1);
        setConfig(guild.id, { exemptChannels: cfg.exemptChannels });
        return interaction.editReply({ content: `✅ ${channelMention(channel.id)} is no longer exempt.` });
      } else {
        cfg.exemptChannels.push(channel.id);
        setConfig(guild.id, { exemptChannels: cfg.exemptChannels });
        return interaction.editReply({ content: `✅ ${channelMention(channel.id)} is now exempt from moderation.` });
      }
    }

    if (sub === 'exempt-role') {
      const role = interaction.options.getRole('role');
      const cfg = getConfig(guild.id);
      const idx = cfg.exemptRoles.indexOf(role.id);
      if (idx >= 0) {
        cfg.exemptRoles.splice(idx, 1);
        setConfig(guild.id, { exemptRoles: cfg.exemptRoles });
        return interaction.editReply({ content: `✅ <@&${role.id}> is no longer exempt.` });
      } else {
        cfg.exemptRoles.push(role.id);
        setConfig(guild.id, { exemptRoles: cfg.exemptRoles });
        return interaction.editReply({ content: `✅ <@&${role.id}> is now exempt from moderation.` });
      }
    }

    if (sub === 'audit-log') {
      const channel = interaction.options.getChannel('channel');
      setConfig(guild.id, { auditLogChannelId: channel.id });
      setAuditChannel(channel);
      return interaction.editReply({ content: `✅ Audit logs will be sent to ${channelMention(channel.id)}.` });
    }
  }

  // ── /guard-stats ──
  if (commandName === 'guard-stats') {
    await interaction.deferReply({ ephemeral: true });
    const stats = await getGuildStats(guild.id);
    const loggerStats = getStats();

    const embed = new EmbedBuilder()
      .setTitle('Moderation Statistics')
      .setColor(0x5865f2)
      .addFields(
        { name: 'Total Users Tracked', value: `\`${stats.totalUsers}\``, inline: true },
        { name: 'Active Offenders', value: `\`${stats.activeUsers}\``, inline: true },
        { name: 'Total Strikes', value: `\`${stats.totalStrikes}\``, inline: true },
        { name: 'Total Log Events', value: `\`${loggerStats.total}\``, inline: true },
        { name: 'Total Violations', value: `\`${loggerStats.violations}\``, inline: true },
        { name: 'Errors', value: `\`${loggerStats.errors}\``, inline: true },
      )
      .setFooter({ text: 'USCCB:free-Guard' })
      .setTimestamp();

    if (Object.keys(stats.categoryCounts).length > 0) {
      const catStr = Object.entries(stats.categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n');
      embed.addFields({ name: 'Violations by Category', value: catStr, inline: false });
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /guard-voice ──
  if (commandName === 'guard-voice') {
    await interaction.deferReply({ ephemeral: true });
    const activity = getVoiceActivity(guild.id);

    const embed = new EmbedBuilder()
      .setTitle('Voice Moderation Activity')
      .setColor(0x5865f2)
      .setTimestamp()
      .setFooter({ text: 'USCCB:free-Guard' });

    if (activity.length === 0) {
      embed.setDescription('No active voice sessions being monitored.');
    } else {
      embed.setDescription(`**${activity.length}** user(s) currently being monitored.`);
      for (const a of activity.slice(0, 10)) {
        embed.addFields({
          name: `User ${a.userId}`,
          value: `Recording for ${a.duration}s`,
          inline: true,
        });
      }
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /guard-appeals ──
  if (commandName === 'guard-appeals') {
    await interaction.deferReply({ ephemeral: true });
    const pending = await getPendingAppeals(guild.id);

    if (pending.length === 0) {
      return interaction.editReply({ content: '✅ No pending appeals.' });
    }

    const embed = new EmbedBuilder()
      .setTitle('Pending Appeals')
      .setColor(0xf5c518)
      .setDescription(`${pending.length} appeal(s) awaiting review:`)
      .setFooter({ text: 'USCCB:free-Guard' })
      .setTimestamp();

    for (const appeal of pending.slice(0, 10)) {
      const [userId] = appeal.key.split(':');
      embed.addFields({
        name: `Appeal \`${appeal.id}\` — ${userId}`,
        value: `**Reason:** ${appeal.reason}\n**Strikes at submission:** ${appeal.strikeCountAtSubmission}\n**Submitted:** <t:${Math.floor(new Date(appeal.submittedAt).getTime() / 1000)}:R>`,
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /guard-resolve-appeal ──
  if (commandName === 'guard-resolve-appeal') {
    await interaction.deferReply({ ephemeral: true });
    const appealId = interaction.options.getString('appeal-id');
    const action = interaction.options.getString('action');
    const target = interaction.options.getUser('user');

    const approved = action === 'approve';
    const result = await resolveAppeal(target.id, guild.id, appealId, approved, user.tag);

    if (!result) {
      return interaction.editReply({ content: `Appeal \`${appealId}\` not found for ${target.username}.` });
    }

    if (approved) {
      await interaction.guild.members.unban(target.id, '[free-Guard] Appeal approved').catch(() => {});
      await removeBan(target.id, guild.id);

      const dmUser = await client.users.fetch(target.id).catch(() => null);
      if (dmUser) {
        const invite = await createInviteBack(interaction.guild).catch(() => null);
        const notice = new EmbedBuilder()
          .setColor(0x00c896)
          .setTitle('🎉 Appeal accepted — welcome back!')
          .setDescription(
            'Your ban has been **lifted** and your strikes cleared.\n\n' +
            (invite ? `Ready to return? **Join again:** ${invite}` : 'You can rejoin the server now.')
          )
          .setFooter({ text: 'USCCB:free-Guard | EchoBastion Group' })
          .setTimestamp();
        await dmUser.send({ embeds: [notice] }).catch(() => {});
      }
    }

    const embed = new EmbedBuilder()
      .setColor(approved ? 0x00c896 : 0xd4202a)
      .setTitle(`Appeal ${approved ? 'Approved' : 'Denied'}`)
      .setDescription(
        `Appeal \`${appealId}\` for **${target.username}** has been **${approved ? 'approved' : 'denied'}**.\n` +
        (approved ? 'Ban lifted and strikes cleared.' : 'Strikes remain active.')
      )
      .setFooter({ text: 'USCCB:free-Guard' });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /guard-logs ──
  if (commandName === 'guard-logs') {
    await interaction.deferReply({ ephemeral: true });
    const date = interaction.options.getString('date') || undefined;
    const filter = interaction.options.getString('filter') || undefined;
    const level = interaction.options.getString('level') || undefined;

    const { readLogEntries } = require('./src/logger');
    const entries = readLogEntries(date, { level, search: filter });

    if (entries.length === 0) {
      return interaction.editReply({ content: `No log entries found for ${date || 'today'}.` });
    }

    const displayEntries = entries.slice(-15);
    const logText = displayEntries.map(e =>
      `[${e.t.slice(11, 19)}] [${e.l}] [${e.c}] ${e.m.slice(0, 100)}`
    ).join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`Encrypted Logs — ${date || 'Today'}`)
      .setColor(0x2b2d42)
      .setDescription(`\`\`\`\n${logText}\n\`\`\``)
      .setFooter({ text: `USCCB:free-Guard | ${entries.length} entries${entries.length > 15 ? ` (showing last 15)` : ''}` })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /my-strikes ──
  if (commandName === 'my-strikes') {
    await interaction.deferReply({ ephemeral: true });
    const cfg = getConfig(guild.id);
    const data = await getStrikes(user.id, guild.id);

    const embed = new EmbedBuilder()
      .setTitle('Your Strike Count')
      .setColor(data >= cfg.maxStrikes ? 0xd4202a : data >= cfg.maxStrikes - 1 ? 0xff8800 : 0x00c896)
      .setDescription(
        `You have **${data}/${cfg.maxStrikes}** strikes in this server.\n\n` +
        (data === 0 ? '✅ Clean record — keep it up!'
          : data === 1 ? '⚠️ 1 strike. Be careful.'
          : data === cfg.maxStrikes - 1 ? `🚨 ${data} strikes. One more = ${cfg.banDurationHours}h ban.`
          : `🔴 ${data} strikes reached. Action has been taken.`)
      )
      .setFooter({ text: 'USCCB:free-Guard' });

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /my-log ──
  if (commandName === 'my-log') {
    await interaction.deferReply({ ephemeral: true });
    const logData = await getUserLog(user.id, guild.id);

    if (!logData || !logData.strikes || logData.strikes.length === 0) {
      return interaction.editReply({ content: '✅ You have a clean record!' });
    }

    const embed = new EmbedBuilder()
      .setTitle('Your Moderation History')
      .setColor(0x2b2d42)
      .setDescription(`You have **${logData.count}** strike(s) on record.`)
      .setFooter({ text: 'USCCB:free-Guard' });

    const recent = logData.strikes.slice(-5);
    for (const s of recent) {
      embed.addFields({
        name: `Violation #${s.strikeNumber} — ${s.category}`,
        value: `**Reason:** ${s.reason}\n**Source:** ${s.source || 'text'}\n**Time:** <t:${Math.floor(new Date(s.timestamp).getTime() / 1000)}:R>`,
        inline: false,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  }

  // ── /appeal ──
  if (commandName === 'appeal') {
    await interaction.deferReply({ ephemeral: true });
    const reason = interaction.options.getString('reason');
    const strikes = await getStrikes(user.id, guild.id);

    if (strikes === 0) {
      return interaction.editReply({ content: 'You have no strikes to appeal.' });
    }

    const appeal = await submitAppeal(user.id, guild.id, reason);

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Appeal Submitted')
      .setDescription(
        `Your appeal has been submitted and is pending review.\n\n` +
        `**Appeal ID:** \`${appeal.id}\`\n**Your Strikes:** ${strikes}\n\n` +
        `A moderator will review your appeal. You will be notified of the outcome.`
      )
      .setFooter({ text: 'USCCB:free-Guard' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }
});

// ── DM Embed Builder ─────────────────────────────────────────

async function createInviteBack(guild) {
  const me = guild.members.me;
  const channel = guild.systemChannel || guild.channels.cache
    .filter(c => c.isTextBased() && c.permissionsFor(me).has(PermissionFlagsBits.CreateInstantInvite))
    .sort((a, b) => a.position - b.position)
    .first();
  if (!channel) return null;
  const invite = await channel.createInvite({ maxAge: 0, maxUses: 1, reason: 'Ban appeal approved — invite back' });
  return `https://discord.gg/${invite.code}`;
}

function buildDMEmbed(strikeCount, result, isBan, cfg) {
  const maxStrikes = cfg.maxStrikes;
  const banHours = cfg.banDurationHours;

  return new EmbedBuilder()
    .setColor(isBan ? 0xd4202a : strikeCount >= maxStrikes - 1 ? 0xff8800 : 0xf5c518)
    .setTitle(isBan ? `Banned for ${banHours} Hours` : `Warning — Strike ${strikeCount}/${maxStrikes}`)
    .setDescription(
      isBan
        ? `You have received your **${maxStrikes}th strike** and have been **banned for ${banHours} hours**.\nAfter ${banHours} hours, your ban will lift automatically and strikes will reset.\nIf you believe this was a mistake, press the **appeal button** below — a moderator can lift the ban early.`
        : `Your message was removed by **USCCB:free-Guard**.\n\nThis is strike **${strikeCount}** of ${maxStrikes}. At ${maxStrikes} strikes you will be **banned for ${banHours} hours**.`
    )
    .addFields(
      { name: 'Category', value: `\`${result.category}\``, inline: true },
      { name: 'Severity', value: `\`${result.severity || 'medium'}\``, inline: true },
      { name: 'Reason', value: result.reason, inline: false },
    )
    .setFooter({ text: 'USCCB:free-Guard v2 | EchoBastion Group' })
    .setTimestamp();
}

// ── Start Bot ────────────────────────────────────────────────

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('[FATAL] Login failed:', err.message);
  process.exit(1);
});

// ── Start Dashboard API ──────────────────────────────────────

let dashboardServer = null;
const startDashboardServer = async (retries = 0) => {
  try {
    if (process.env.ENABLE_DASHBOARD !== 'false') {
      setDiscordClient(client);
      dashboardServer = startDashboard();
      log('INFO', 'DASHBOARD', `Dashboard API online (port ${process.env.DASHBOARD_PORT || '3001'})`);
    }
  } catch (err) {
    // Dashboard deps may not be installed on bot-only deployments
    console.error('[DASHBOARD] Could not start (deps missing?):', err.message);
    if (retries < 3) setTimeout(() => startDashboardServer(retries + 1), 5000);
  }
};

client.once('ready', () => {
  startDashboardServer();
});

// ── Graceful Shutdown ────────────────────────────────────────

process.on('SIGINT', () => {
  log('INFO', 'SHUTDOWN', 'SIGINT received — shutting down');
  client.destroy();
  if (dashboardServer) dashboardServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('INFO', 'SHUTDOWN', 'SIGTERM received — shutting down');
  client.destroy();
  if (dashboardServer) dashboardServer.close();
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  logError('UNHANDLED', err?.message || String(err));
});
