// FreeGuard Dashboard — glass console (demo-design) wired to the live API
'use strict';

// ── API base — override with ?api= or the server-injected API_URL ──
const API_BASE = (() => {
  const p = new URLSearchParams(window.location.search);
  if (p.get('api')) return p.get('api');
  return window.API_URL || 'http://localhost:3001';
})();

const DISCORD_CLIENT_ID = (() => {
  const p = new URLSearchParams(window.location.search);
  if (p.get('client')) return p.get('client');
  const injected = window.DISCORD_CLIENT_ID || '';
  return injected.startsWith('__FG_') ? '' : injected;
})();

const DISCORD_OAUTH_URL = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(API_BASE + '/api/auth/callback')}&response_type=code&scope=identify%20guilds`;

const state = {
  token: localStorage.getItem('fg_token'),
  me: null,
  guilds: [],
  guildId: null,
  view: 'overview',
  guildNames: {},
  members: [],
};

let refreshTimer = null;
const inflight = {};
const AVATAR = ['#3d6ef7', '#eb459e', '#22c88a', '#f5a623', '#8b6cff', '#ff8454', '#16b6c9', '#e25073'];
const CAT_COLOR = {
  PROFANITY: '#3d6ef7', SEXUAL_CONTENT: '#eb459e', SPAM: '#f5a623', HATE_SPEECH: '#8b6cff',
  VIOLENT_THREAT: '#ff5470', SELF_HARM: '#16b6c9', IMAGE: '#e25073', INVITE: '#22c88a', LINK: '#16b6c9', MANUAL: '#8b6cff',
};
const VALID = ['overview', 'members', 'logs', 'voice', 'appeals', 'bans', 'settings'];
const TITLES = { overview: 'Overview', members: 'Members', logs: 'Audit Log', voice: 'Voice', appeals: 'Appeals', bans: 'Bans', settings: 'Settings' };
const SUB = { overview: 'Workspace overview', members: 'Members & flag history', logs: 'Moderation trail', voice: 'Live voice monitoring', appeals: 'Review & decision queue', bans: 'Active enforcement', settings: 'Moderation behaviour' };

// ── Helpers ──
const dbg = () => {}; // debug strip removed

// GET response cache — makes every view instant after the initial warm-up
const dataCache = new Map();
const CACHE_TTL = (path) =>
  path.includes('/members') ? 30000 :
  path.includes('/logs') ? 20000 :
  path.includes('/config') ? 120000 :
  path.includes('/auth/me') ? 120000 : 15000;

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const ck = method + ' ' + path;
  if (method === 'GET') {
    const hit = dataCache.get(ck);
    if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  }
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (res.status === 401) { dataCache.clear(); logout(); throw new Error('Unauthorized'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (method === 'GET') dataCache.delete(ck); throw new Error(data.error || res.statusText); }
  if (method === 'GET') {
    if (dataCache.size > 150) {
      const oldest = dataCache.keys().next().value;
      dataCache.delete(oldest);
    }
    dataCache.set(ck, { data, at: Date.now(), ttl: CACHE_TTL(path) });
  } else {
    dataCache.clear();
  }
  return data;
}

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, type) {
  dbg('toast(' + msg + ')');
  const t = $('#toast');
  if (!t) { alert(msg); return; }
  t.innerHTML = '<svg><use href="#i-' + (type === 'ok' ? 'ok' : type === 'err' ? 'err' : 'warn') + '"/></svg><span></span>';
  t.querySelector('span').textContent = msg;
  t.className = (type || 'ok') === 'err' ? 'show err' : type === 'warn' ? 'show warn' : 'show ok';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ''), 3200);
}
window.toast = toast;

function avatarColor(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}
function avatarHTML(name, color) {
  const c = color || '#3d6ef7';
  return '<span class="avatar" style="background:linear-gradient(135deg,' + c + ',' + c + 'C0)">' + esc((name || '?').charAt(0).toUpperCase()) + '</span>';
}
function pill(text, cls) {
  return text ? ' <span class="pill-tag ' + (cls || '') + '">' + esc(text) + '</span>' : '';
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString();
}
function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const now = new Date();
  const days = Math.floor((now - d) / 86400000);
  if (days <= 0) return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (days < 30) return days + 'd ago';
  return d.toLocaleDateString();
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ── Theme ──
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const sun = $('.i-sun'), moon = $('.i-moon');
  if (sun) sun.classList.toggle('hidden', theme === 'dark');
  if (moon) moon.classList.toggle('hidden', theme !== 'dark');
  try { localStorage.setItem('fg-theme', theme); } catch (e) {}
}
window.toggleTheme = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
(function initTheme() {
  let t = null;
  try { t = localStorage.getItem('fg-theme'); } catch (e) {}
  if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(t);
})();

// ── Router ──
function go(view) {
  if (VALID.indexOf(view) === -1) return;
  if (location.hash !== '#/' + view) { location.hash = '#/' + view; return; }
  render(view);
}
window.go = go;

function render(view) {
  view = VALID.indexOf(view) !== -1 ? view : 'overview';
  state.view = view;
  $('#crumb').textContent = TITLES[view];
  $('#page-title').textContent = SUB[view];
  window.scrollTo({ top: 0 });
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const section = document.getElementById('view-' + view);
  if (section) section.classList.add('active');
  document.querySelectorAll('.nav-item, .tab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  scheduleView(view);
}
window.addEventListener('hashchange', () => {
  const p = (location.hash.replace(/^#\/?/, '') || 'overview').split('/')[0];
  render(p);
});
function goNow(view) { render(view); }

function scheduleView(view) {
  clearInterval(refreshTimer);
  if (!state.guildId) return;
  callView(view);
  const AUTO = ['overview', 'voice', 'appeals', 'bans', 'logs'];
  if (AUTO.indexOf(view) !== -1) {
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible') callView(view);
    }, 15000);
  }
}

function callView(view) {
  if (inflight[view]) return;
  inflight[view] = true;
  const views = {
    overview: loadOverview, members: loadMembers, logs: loadLogs, voice: loadVoice,
    appeals: loadAppeals, bans: loadBans, settings: loadSettings,
  };
  Promise.resolve((views[view] || loadOverview)()).catch(err => {
    dbg('view ' + view + ' failed: ' + err.message);
  }).finally(() => { inflight[view] = false; });
}

// ── Auth ──
function logout() {
  localStorage.removeItem('fg_token');
  state.token = null; state.me = null; state.guildId = null;
  fetch(API_BASE + '/api/auth/logout', { method: 'POST' }).catch(() => {});
  clearInterval(refreshTimer);
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}
window.logout = logout;

function showLoginError(msg) {
  const box = $('#login-error');
  if (box) { box.textContent = msg; box.classList.remove('hidden'); }
  console.error(msg);
}

async function bootstrap() {
  $('#login-btn').addEventListener('click', () => { window.location.href = DISCORD_OAUTH_URL; });
  let ok = false;
  try {
    const data = await api('/api/auth/me');
    state.me = data.me;
    state.guilds = data.guilds || [];
    if (state.guilds.length) {
      state.guildId = state.guilds[0];
      ok = true;
    } else {
      showLoginError('Your Discord account has no moderator access to allowed servers.');
    }
  } catch (e) {
    showLoginError('Login failed: ' + ((e && e.message) || 'could not reach the API. Is the bot online?'));
  }
  if (ok) enterApp(); else $('#login-screen').classList.remove('hidden');
}

function enterApp() {
  $('#login-screen').classList.add('hidden');
  const app = $('#app');
  app.classList.remove('hidden');

  $('#me-name').textContent = state.me.username || state.me.id || '…';
  const av = state.me.avatar ? `https://cdn.discordapp.com/avatars/${state.me.id}/${state.me.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/1.png';
  $('#me-avatar').src = av;

  $('#logout-btn').addEventListener('click', logout);
  $('#theme-toggle').addEventListener('click', window.toggleTheme);
  $('#bell-btn').addEventListener('click', () => { go('logs'); toast('Jumped to the audit log', 'ok'); });
  $('#foot-logs').addEventListener('click', e => { e.preventDefault(); go('logs'); });
  $('#member-refresh').addEventListener('click', loadMembers);
  $('#log-reload').addEventListener('click', loadLogs);
  $('#log-date').addEventListener('change', loadLogs);
  $('#log-search').addEventListener('input', debounce(loadLogs, 300));
  $('#member-search').addEventListener('input', debounce(() => renderMembers(), 300));
  $('#global-search').addEventListener('keydown', e => { if (e.key === 'Enter') { go('members'); } });
  $('#cfg-save').addEventListener('click', saveConfig);
  $('#cfg-reset').addEventListener('click', resetConfig);

  document.querySelectorAll('.nav-item, .tab').forEach(b => {
    b.addEventListener('click', () => go(b.dataset.view));
  });

  renderServerSwitcher();

  // Warm every view's data in parallel so tab switches are instant
  VALID.forEach(v => callView(v));
  go('overview');
}

// ── Server switcher ──
function serverName(gid) { return state.guildNames[gid] || ('Server ' + String(gid).slice(-6)); }

function ddToggle() {
  const menu = $('#server-menu');
  const btn = $('#server-btn');
  const open = menu.classList.toggle('open');
  btn.setAttribute('aria-expanded', String(open));
}
window.ddToggle = ddToggle;
document.addEventListener('click', (e) => {
  const dd = $('#server-dd');
  if (dd && !dd.contains(e.target)) { $('#server-menu').classList.remove('open'); $('#server-btn').setAttribute('aria-expanded', 'false'); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#server-menu').classList.remove('open'); $('#server-btn').setAttribute('aria-expanded', 'false'); } });

function renderServerSwitcher() {
  const menu = $('#server-menu');
  const current = state.guildId;
  $('#sv-av').textContent = serverName(current).charAt(0).toUpperCase();
  $('#sv-name b').textContent = serverName(current);
  $('#sv-label').textContent = serverName(current);
  menu.innerHTML = state.guilds.map((gid, i) => {
    const name = serverName(gid);
    return '<div class="dd-item' + (gid === current ? ' active' : '') + '" role="option" data-srv="' + i + '">' +
      '<span class="av-tile" style="background:linear-gradient(135deg,' + avatarColor(gid) + ',' + avatarColor(gid) + 'C0)">' + esc(name.charAt(0).toUpperCase()) + '</span>' +
      '<span class="name">' + esc(name) + '</span>' +
      '<svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>';
  }).join('');
  menu.querySelectorAll('.dd-item').forEach(it => {
    it.addEventListener('click', () => {
      const gid = state.guilds[+it.dataset.srv];
      if (gid && gid !== state.guildId) {
        state.guildId = gid;
        renderServerSwitcher();
        go(state.view);
        toast('Switched to ' + serverName(gid), 'ok');
      }
      ddToggle();
    });
  });
  $('#server-btn').onclick = e => { e.stopPropagation(); ddToggle(); };
}

function applyGuildMeta(guild) {
  if (guild && guild.id && guild.name) state.guildNames[guild.id] = guild.name;
  renderServerSwitcher();
}

// ── Overview ──
async function loadOverview() {
  const [data] = await Promise.all([
    api(`/api/guilds/${state.guildId}/stats`),
    loadOverviewFeed(),
  ]);
  const g = data.guild || {};
  const s = data.strikes || {};

  applyGuildMeta(g);
  $('#side-status').textContent = 'online';
  $('#foot-count').textContent = data.loggerStats?.total ?? 0;

  const first = (state.me && (state.me.global_name || state.me.username)) || 'moderator';
  $('#hero-title').textContent = `Good day, ${esc(first)}.`;
  $('#hero-sub').textContent = `${esc(g.name || 'This server')} has been monitored by the AI funnel. ${s.totalStrikes || 0} strikes issued, ${s.activeUsers || 0} flagged users, ${data.voiceActive || 0} live voice sessions.`;

  const chips = [];
  if (data.loggerStats?.total) chips.push(['shield', `${data.loggerStats.total} events today`]);
  if (data.loggerStats?.errors) chips.push(['bell', `${data.loggerStats.errors} fatal errors`]);
  chips.push(['check', 'All systems operational']);
  $('#hero-chips').innerHTML = chips.map(([icon, label]) =>
    '<span class="chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
    (icon === 'shield' ? '<path d="M12 3l7 4v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V7z"/>' :
    icon === 'bell' ? '<path d="M18 9a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10 19a2 2 0 004 0"/>' :
    '<path d="M20 6L9 17l-5-5"/>') + '</svg>' + esc(label) + '</span>').join('');

  $('#stat-members').innerHTML = String(g.members ?? '–') + ' <small>members</small>';
  $('#stat-users').innerHTML = String(s.activeUsers ?? '–') + ' <small>flagged</small>';
  $('#stat-strikes').innerHTML = String(s.totalStrikes ?? '–') + ' <small>strikes</small>';
  $('#stat-voice').innerHTML = String(data.voiceActive ?? '–') + ' <small>sessions</small>';

  const cats = s.categoryCounts || {};
  const entries = Object.entries(cats);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  $('#cat-bars').innerHTML = entries.length
    ? entries.map(([cat, count]) => {
        const c = CAT_COLOR[cat] || '#3d6ef7';
        return '<div class="cat"><span class="cat-name"><i class="swatch" style="background:' + c + '"></i>' + esc(cat.toLowerCase().replace(/_/g, ' ')) + '</span>' +
          '<div class="cat-track"><div class="cat-fill" data-w="' + Math.round(count / max * 100) + '%" style="width:0;background:linear-gradient(90deg,' + c + ',transparent 260%)"></div></div>' +
          '<span class="cat-num">' + count + '</span></div>';
      }).join('')
    : '<div class="empty">No violations recorded yet</div>';
  requestAnimationFrame(() => document.querySelectorAll('#cat-bars .cat-fill').forEach(f => { f.style.width = f.dataset.w; }));
}

async function loadOverviewFeed() {
  const feed = $('#overview-feed');
  try {
    const date = new Date().toISOString().split('T')[0];
    const data = await api(`/api/guilds/${state.guildId}/logs?date=${date}&limit=8`);
    const entries = data.entries || [];
    feed.innerHTML = entries.length
      ? entries.map(e => {
          const lvl = e.l || 'INFO';
          const tag = lvl === 'ERROR' || lvl === 'FATAL' ? 'red' : lvl === 'WARN' ? 'amber' : lvl === 'STRIKE' || lvl === 'BAN' ? 'violet' : 'green';
          const msg = (typeof e.m === 'string' ? e.m : JSON.stringify(e.m)).replace(/\n/g, ' ');
          return '<div class="feed-item"><span class="t mono">' + esc((e.t || '').slice(11, 19) || '') + '</span>' +
            '<span class="b">' + esc(msg) + pill(String(e.c || lvl).slice(0, 8), tag) + '</span></div>';
        }).join('')
      : '<div class="empty">No activity recorded today</div>';
  } catch (e) {
    feed.innerHTML = '<div class="empty">Could not load activity</div>';
  }
}

// ── Members ──
async function loadMembers() {
  const data = await api(`/api/guilds/${state.guildId}/members`);
  state.members = data.members || [];
  renderMembers();
}

function renderMembers() {
  const q = ($('#member-search').value || '').toLowerCase();
  const list = state.members.filter(m =>
    !q || (m.username + ' ' + (m.displayName || '') + ' ' + (m.id || '')).toLowerCase().includes(q)
  );
  const tbody = $('#members-tbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty">No members match this search</div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map((m, i) => {
    const c = avatarColor(m.id);
    const status = m.bot
      ? pill('Bot', '')
      : m.banned ? pill('Banned', 'red')
      : m.strikeCount >= 5 ? pill(m.strikeCount + ' strikes', 'red')
      : m.strikeCount > 0 ? pill(m.strikeCount + ' strikes', 'amber')
      : pill('Clean', 'green');
    return '<tr>' +
      '<td><div class="cell-user">' + avatarHTML(m.displayName || m.username, c) +
      '<div><b>' + esc(m.displayName || m.username) + '</b><small>@' + esc(m.username) + (m.id ? ' · ' + esc(m.id) : '') + '</small></div></div></td>' +
      '<td class="mono">' + esc(fmtWhen(m.joinedAt)) + '</td>' +
      '<td><b class="mono" style="color:var(--ink)">' + m.strikeCount + '</b></td>' +
      '<td>' + status + '</td>' +
      '<td style="text-align:right"><button class="btn ghost sm" data-midx="' + i + '">View</button></td></tr>';
  }).join('');
  tbody.querySelectorAll('button[data-midx]').forEach(b =>
    b.addEventListener('click', () => openMember(+(b.dataset.midx))));
}

async function openMember(idx) {
  const m = state.members[idx];
  if (!m) return;
  const d = $('#member-drawer');
  d.classList.remove('hidden');
  d.innerHTML = '<div class="empty">Loading…</div>';
  let detail;
  try {
    detail = await api(`/api/guilds/${state.guildId}/members/${m.id}`);
  } catch (e) {
    d.innerHTML = '<div class="empty">Could not load member: ' + esc(e.message) + '</div>';
    return;
  }
  const strikes = (detail.strikes && detail.strikes.strikes || []).slice(-8).reverse();
  const c = avatarColor(m.id);
  const name = m.displayName || m.username;
  const roleIds = detail.memberRoleIds || [];
  const guildRoles = detail.guildRoles || [];
  const available = guildRoles.filter(r => roleIds.indexOf(r.id) === -1);

  const roleChips = (detail.member && detail.member.roles || []).map(r =>
    '<span class="pill-tag" style="margin:2px;cursor:pointer" data-rm-role="' + r.id + '" title="Remove role ' + esc(r.name) + '">' + esc(r.name) + ' ✕</span>'
  ).join('') || '<span style="color:var(--ink-3);font-size:12px">No roles</span>';

  const addRoleOpts = available.length
    ? '<option value="">Add a role…</option>' + available.map(r => '<option value="' + r.id + '">' + esc(r.name) + '</option>').join('')
    : '<option value="">No assignable roles</option>';

  const inner = '<div class="subhead">' + avatarHTML(name, c) +
    '<span><b>' + esc(name) + (m.bot ? ' <span class="pill-tag">Bot</span>' : '') + '</b><small>@' + esc(m.username) + ' · ' + esc(fmtWhen(m.joinedAt)) + '</small></span>' +
    '<span style="flex:1"></span>' +
    '<button class="btn success sm" data-act="warn">Warn</button>' +
    '<button class="btn sm" data-act="dm">DM</button>' +
    '<button class="btn sm" data-act="clear">Clear</button>' +
    (m.bot ? '' : '<button class="btn danger sm" data-act="kick">Kick</button>') +
    (m.bot ? '' : '<button class="btn danger sm" data-act="ban">Ban</button>') + '</div>';

  const history = strikes.length
    ? strikes.map(s => '<div class="feed-item"><span class="t mono">' + esc(fmtTime(s.timestamp)) + '</span>' +
        '<span class="b">' + esc(s.reason || 'No reason') + pill(String(s.category || 'LOG').slice(0, 10), 'amber') + '</span></div>').join('')
    : '<div class="empty">No strikes on record — clean sheet</div>';

  const rolesBlock = '<h3 style="margin-top:14px">Roles (' + roleIds.length + ')</h3>' +
    '<div class="feed" style="margin-bottom:10px">' + roleChips + '</div>' +
    '<div class="acts" style="margin-top:0">' +
    '<select class="val" id="role-add" style="background:var(--glass-3);border:1px solid var(--line-2);border-radius:10px;padding:7px 10px;color:var(--ink);font:600 12.5px Inconsolata,monospace;min-width:150px">' + addRoleOpts + '</select>' +
    '<button class="btn sm" id="role-add-btn" ' + (available.length ? '' : 'disabled') + '>Assign</button></div>';

  d.innerHTML = '<h3>Member — actions</h3>' + inner + rolesBlock + '<h3>Strike history (' + (detail.strikes && detail.strikes.count || 0) + ')</h3>' + history;
  d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const reload = () => { const ni = state.members.findIndex(x => x.id === m.id); if (ni !== -1) openMember(ni); };
  const qa = sel => d.querySelector(sel);
  const withConfirm = (fn) => { try { fn(); } catch (e) { toast(e.message, 'err'); } };
  qa('[data-act=warn]').addEventListener('click', () => withConfirm(() => actWarn(m.id)));
  qa('[data-act=clear]').addEventListener('click', () => withConfirm(() => actClear(m.id)));
  if (qa('[data-act=kick]')) qa('[data-act=kick]').addEventListener('click', () => withConfirm(() => actKick(m.id)));
  if (qa('[data-act=ban]')) qa('[data-act=ban]').addEventListener('click', () => withConfirm(() => actBan(m.id)));
  qa('[data-act=dm]').addEventListener('click', () => withConfirm(() => actDm(m.id)));

  d.querySelectorAll('[data-rm-role]').forEach(chip => chip.addEventListener('click', () => {
    if (confirm('Remove role from ' + name + '?')) { withConfirm(() => actRemoveRole(m.id, chip.dataset.rmRole, reload)); }
  }));
  qa('#role-add-btn').addEventListener('click', () => {
    const rid = qa('#role-add').value;
    if (!rid) { toast('Pick a role first', 'warn'); return; }
    withConfirm(() => actAddRole(m.id, rid, reload));
  });
}

function actDm(id) {
  const message = prompt('Message to send by DM:');
  if (message === null) return;
  memberAction(id + '/dm', { method: 'POST', body: JSON.stringify({ message }) }, 'DM sent');
}
function actAddRole(id, roleId, after) {
  api(`/api/guilds/${state.guildId}/members/${id}/roles/${roleId}`, { method: 'POST' })
    .then(() => { toast('Role assigned', 'ok'); after && after(); })
    .catch(e => { if (e.status === 403) toast(e.message, 'err'); else toast(e.message, 'err'); });
}
function actRemoveRole(id, roleId, after) {
  api(`/api/guilds/${state.guildId}/members/${id}/roles/${roleId}`, { method: 'DELETE' })
    .then(() => { toast('Role removed', 'ok'); after && after(); })
    .catch(e => toast(e.message, 'err'));
}

async function memberAction(path, opts, okMsg) {
  try {
    await api(`/api/guilds/${state.guildId}/members/${path}`, opts);
    toast(okMsg, 'ok');
    loadMembers();
  } catch (e) {
    toast(e.message, 'err');
  }
}
function actWarn(id) {
  const reason = prompt('Reason for strike:', 'Manual strike from dashboard');
  if (reason === null) return;
  memberAction(id + '/warn', { method: 'POST', body: JSON.stringify({ reason: reason || 'Manual strike' }) }, 'Strike recorded');
}
function actClear(id) {
  if (!confirm('Clear all strikes for this user?')) return;
  const reason = prompt('Reason:') || 'Cleared via dashboard';
  memberAction(id + '/clears', { method: 'POST', body: JSON.stringify({ reason }) }, 'Strikes cleared');
}
function actKick(id) {
  if (!confirm('Kick this member from the server?')) return;
  const reason = prompt('Reason:') || 'Kicked via dashboard';
  memberAction(id + '/kick', { method: 'POST', body: JSON.stringify({ reason }) }, 'Member kicked');
}
function actBan(id) {
  const dur = prompt('Ban duration (hours):', '24');
  if (dur === null) return;
  const reason = prompt('Reason:') || 'Banned via dashboard';
  memberAction(id + '/ban', { method: 'POST', body: JSON.stringify({ reason, durationHours: parseFloat(dur) || 24 }) }, 'Member banned');
}

// ── Logs ──
async function loadLogs() {
  const date = $('#log-date').value || new Date().toISOString().split('T')[0];
  if (!$('#log-date').value) $('#log-date').value = date;
  const q = ($('#log-search').value || '').toLowerCase();
  const data = await api(`/api/guilds/${state.guildId}/logs?date=${date}&limit=300`);
  const entries = (data.entries || []).filter(e =>
    !q || ((typeof e.m === 'string' ? e.m : JSON.stringify(e.m)) + ' ' + (e.c || '')).toLowerCase().includes(q));
  const tbody = $('#logs-tbody');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty">Nothing matches this filter</div></td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(e => {
    const lvl = e.l || 'INFO';
    const tag = lvl === 'ERROR' || lvl === 'FATAL' ? 'red' : lvl === 'WARN' ? 'amber' : lvl === 'STRIKE' || lvl === 'BAN' || lvl === 'MOD' ? 'violet' : 'green';
    const msg = (typeof e.m === 'string' ? e.m : JSON.stringify(e.m)).replace(/\n/g, ' ');
    return '<tr><td class="mono" style="white-space:nowrap">' + esc((e.t || '').slice(11, 19) || e.t || '') + '</td>' +
      '<td>' + pill(String(e.c || lvl).slice(0, 10), tag) + '</td>' +
      '<td>' + esc(msg) + '</td>' +
      '<td><span style="color:var(--ink-3);font-size:12.5px">' + esc(lvl) + '</span></td></tr>';
  }).join('');
}

// ── Voice ──
async function loadVoice() {
  const data = await api(`/api/guilds/${state.guildId}/voice`);
  const states = data.voiceStates || [];
  const monitored = data.monitored || [];
  const mon = new Map(monitored.map(m => [m.userId, m]));
  const grid = $('#voice-grid');
  if (!states.length && !monitored.length) {
    grid.innerHTML = '<div class="empty">No live voice sessions — nobody connected right now</div>';
    return;
  }
  grid.innerHTML = states.map(v => {
    const dur = mon.get(v.id) || mon.get(v.userId);
    const c = avatarColor(v.id || v.userId);
    const live = dur
      ? '<span class="live"><span class="bar"></span><span class="bar"></span><span class="bar"></span>' + (dur.duration ? dur.duration + 's' : 'monitoring') + '</span>'
      : '<span class="meta" style="margin-top:10px">standby</span>';
    return '<div class="voice glass">' +
      '<div class="vc"><span class="av" style="background:linear-gradient(135deg,' + c + ',' + c + 'C0)">' + esc((v.username || '?').charAt(0).toUpperCase()) + '</span><b>' + esc(v.username || 'Unknown') + '</b></div>' +
      '<div class="meta"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 11h18M8 4v16M16 7v10"/></svg>' + esc('#' + (v.channelName || 'voice')) + '</div>' +
      '<div class="meta mono">' + ([v.muted && 'muted', v.deafened && 'deafened', v.streaming && 'streaming', v.camera && 'camera'].filter(Boolean).join(' · ') || 'not recently active') + '</div>' +
      live + '</div>';
  }).join('');
}

// ── Appeals ──
async function loadAppeals() {
  const data = await api(`/api/guilds/${state.guildId}/appeals`);
  const list = $('#appeals-list');
  const appeals = data.appeals || [];
  if (!appeals.length) {
    list.innerHTML = '<div class="empty">No pending appeals — queue clear</div>';
    return;
  }
  list.innerHTML = appeals.map((a, i) => {
    const c = avatarColor(a.userId);
    const name = a.username || ('User ' + String(a.userId).slice(-6));
    const lvl = a.status || 'Pending';
    return '<div class="item glass"><div class="ih">' +
      avatarHTML(name, c) +
      '<b>' + esc(name) + '</b>' + pill(String(lvl).slice(0, 12), lvl === 'PENDING' ? 'amber' : lvl === 'APPROVED' ? 'green' : 'red') + '<span class="sp"></span>' +
      '<span class="mono" style="color:var(--ink-3);font-size:12px">' + esc(fmtWhen(a.submittedAt)) + '</span></div>' +
      '<div class="why">"' + esc(a.reason || 'No reason given') + '"</div>' +
      '<div class="acts"><button class="btn success sm" data-appeal="approve:' + i + '">Approve</button>' +
      '<button class="btn danger sm" data-appeal="deny:' + i + '">Deny</button></div></div>';
  }).join('');
  list.querySelectorAll('[data-appeal]').forEach(b => b.addEventListener('click', () => {
    const [act, i] = b.dataset.appeal.split(':');
    const a = appeals[+i];
    resolveAppeal(a.appealId || a.id, act === 'approve');
  }));
}

async function resolveAppeal(appealId, approved) {
  try {
    await api(`/api/guilds/${state.guildId}/appeals/${appealId}/resolve`, { method: 'POST', body: JSON.stringify({ approved }) });
    toast(approved ? 'Appeal approved' : 'Appeal denied', approved ? 'ok' : 'warn');
    loadAppeals();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ── Bans ──
async function loadBans() {
  const data = await api(`/api/guilds/${state.guildId}/bans`);
  const list = $('#bans-list');
  const bans = data.bans || [];
  if (!bans.length) {
    list.innerHTML = '<div class="empty">No active bans</div>';
    return;
  }
  list.innerHTML = bans.map((b, i) => {
    const c = avatarColor(b.userId);
    const name = b.username || ('User ' + String(b.userId).slice(-6));
    const until = b.expiresAt ? 'Expires ' + fmtWhen(b.expiresAt) : 'Permanent';
    return '<div class="item glass"><div class="ih">' +
      avatarHTML(name, c) +
      '<b>' + esc(name) + '</b><span class="sp"></span>' +
      '<span class="mono" style="color:var(--ink-3);font-size:12px">' + esc(until) + '</span></div>' +
      '<div class="why">' + esc(b.reason || 'No reason recorded') + '</div>' +
      '<div class="acts"><button class="btn success sm" data-ban="' + i + '">Unban</button></div></div>';
  }).join('');
  list.querySelectorAll('[data-ban]').forEach(btn => btn.addEventListener('click', () => {
    const b = bans[+btn.dataset.ban];
    if (!confirm('Unban ' + (b.username || b.userId) + '?')) return;
    actUnban(b.userId);
  }));
}

async function actUnban(userId) {
  try {
    await api(`/api/guilds/${state.guildId}/members/${userId}/unban`, { method: 'POST' });
    toast('User unbanned', 'ok');
    loadBans();
  } catch (e) {
    toast(e.message, 'err');
  }
}

// ── Settings ──
const cfgDraft = {};
const cfgOriginal = {};
const switchKeys = ['textModeration', 'imageModeration', 'voiceModeration', 'reactionModeration', 'linkFilter', 'spamFilter', 'inviteFilter', 'capsFilter', 'autoDeleteInvites', 'deleteViolations', 'dmWarnings', 'autoClearOnExpiry', 'voiceWarningBeforeDisconnect', 'welcomeEnabled'];

async function loadSettings() {
  const data = await api(`/api/guilds/${state.guildId}/config`);
  const cfg = data.config || {};
  Object.keys(cfgDraft).forEach(k => delete cfgDraft[k]);
  Object.keys(cfgOriginal).forEach(k => delete cfgOriginal[k]);
  Object.assign(cfgOriginal, cfg);

  const groups = [
    ['Moderation toggles', switchKeys, 'switch'],
    ['Thresholds', ['spamMessageLimit', 'spamTimeWindowMs', 'capsPercentageThreshold', 'capsMinLength', 'maxMentions', 'voiceSensitivity', 'maxStrikes', 'banDurationHours', 'strikeExpiryDays'], 'num'],
    ['Channels & messages', ['logChannelId', 'welcomeMessage', 'moderationLanguage'], 'text'],
  ];
  $('#settings-grid').innerHTML = groups.map(([title, keys, kind]) => {
    const rows = keys.filter(k => cfg[k] !== undefined).map(k => {
      const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
      if (kind === 'switch') {
        return '<div class="sett-row"><div style="flex:1"><b>' + esc(label) + '</b><small>Enabled / disabled</small></div>' +
          '<label class="switch"><input type="checkbox" data-key="' + k + '"' + (cfg[k] ? ' checked' : '') + '><span class="sl"></span></label></div>';
      }
      if (kind === 'num') {
        return '<div class="sett-row"><div style="flex:1"><b>' + esc(label) + '</b><small>' + esc(typeof cfg[k] === 'number' ? '' : '') + '</small></div>' +
          '<input type="number" class="val" data-key="' + k + '" value="' + esc(cfg[k]) + '" /></div>';
      }
      return '<div class="sett-row"><div style="flex:1"><b>' + esc(label) + '</b><small>Value</small></div>' +
        '<input type="text" class="val" data-key="' + k + '" value="' + esc(cfg[k]) + '" style="width:auto;min-width:180px" /></div>';
    }).join('');
    return '<div class="sett glass"><h4>' + esc(title) + '</h4>' + (rows || '<div class="sett-row"><span class="sp"></span></div>') + '</div>';
  }).join('');

  $('#settings-grid').querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => {
      const k = inp.dataset.key;
      const raw = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? parseFloat(inp.value) : inp.value;
      cfgDraft[k] = raw;
      toast('Staged — remember to save', 'ok');
    });
  });
}

async function saveConfig() {
  const dirty = {};
  for (const [k, v] of Object.entries(cfgDraft)) {
    if (String(cfgOriginal[k]) !== String(v)) dirty[k] = v;
  }
  if (!Object.keys(dirty).length) { toast('No changes to save', 'warn'); return; }
  try {
    await api(`/api/guilds/${state.guildId}/config`, { method: 'POST', body: JSON.stringify(dirty) });
    toast('Settings saved', 'ok');
    loadSettings();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function resetConfig() {
  if (!confirm('Reset config to defaults?')) return;
  try {
    await api(`/api/guilds/${state.guildId}/config/reset`, { method: 'POST' });
    toast('Settings reset to defaults', 'ok');
    loadSettings();
  } catch (e) { toast(e.message, 'err'); }
}

// ── Init ──
(async function init() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('code')) {
    try {
      await fetch(`${API_BASE}/api/auth/callback?code=${encodeURIComponent(p.get('code'))}`).then(r => r.json());
    } catch (e) {}
  }
  if (!DISCORD_CLIENT_ID) showLoginError('Dashboard not configured — client id missing on server.');
  bootstrap();
})();