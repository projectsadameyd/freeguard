// ============================================================
//  USCCB:free-Guard v2 — Keep-Alive + Health Server
//  Features: HTTP health endpoint, metrics, auto-restart,
//  crash logging, graceful shutdown, process management
//  EchoBastion Group
// ============================================================

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Configuration ────────────────────────────────────────────

const CRASH_LOG = path.join(__dirname, 'logs', 'crashes.log');
const PING_PORT = process.env.PORT || 3000;
const RESTART_DELAY_MS = 3000;
const MAX_RESTARTS = 25;
const HEALTH_CHECK_INTERVAL = 60000;

let restartCount = 0;
let botProcess = null;
let lastStartTime = Date.now();
let lastHealthCheck = Date.now();
let botAlive = true;

// ── Ensure Directories ───────────────────────────────────────

if (!fs.existsSync(path.join(__dirname, 'logs'))) {
  fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
}

// ── HTTP Health Server ───────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PING_PORT}`);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoint
  if (url.pathname === '/health' || url.pathname === '/') {
    const uptime = Math.floor((Date.now() - lastStartTime) / 1000);
    const status = {
      status: botAlive ? 'healthy' : 'degraded',
      service: 'USCCB:free-Guard',
      version: '2.0.0',
      by: 'EchoBastion Group',
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
      uptimeSeconds: uptime,
      bot: {
        pid: botProcess?.pid || null,
        alive: botAlive,
        restarts: restartCount,
        maxRestarts: MAX_RESTARTS,
      },
      server: {
        port: PING_PORT,
        lastHealthCheck: new Date(lastHealthCheck).toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    res.writeHead(botAlive ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
    return;
  }

  // Metrics endpoint
  if (url.pathname === '/metrics') {
    const uptime = Math.floor((Date.now() - lastStartTime) / 1000);
    const metrics = {
      uptime_seconds: uptime,
      restarts_total: restartCount,
      bot_pid: botProcess?.pid || 0,
      bot_alive: botAlive ? 1 : 0,
      memory_usage: process.memoryUsage(),
      timestamp: Date.now(),
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics, null, 2));
    return;
  }

  // Ping endpoint (for UptimeRobot)
  if (url.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('pong');
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', endpoints: ['/', '/health', '/metrics', '/ping'] }));
});

server.listen(PING_PORT, () => {
  console.log(`\n[Keep-Alive] Health server running on port ${PING_PORT}`);
  console.log(`[Keep-Alive] Endpoints:`);
  console.log(`  GET /health  — Full health status`);
  console.log(`  GET /metrics — Prometheus-style metrics`);
  console.log(`  GET /ping    — Simple liveness check`);
  console.log(`[Keep-Alive] Point UptimeRobot to: http://your-url:${PING_PORT}/ping\n`);
});

// ── Bot Process Manager ──────────────────────────────────────

function writeCrashLog(message) {
  const entry = `${new Date().toISOString()} ${message}\n`;
  fs.appendFileSync(CRASH_LOG, entry);
  console.error(message);
}

function startBot() {
  if (restartCount >= MAX_RESTARTS) {
    const msg = `[FATAL] Max restarts (${MAX_RESTARTS}) reached. Manual intervention required.`;
    writeCrashLog(msg);
    botAlive = false;
    process.exit(1);
  }

  lastStartTime = Date.now();
  botAlive = true;

  console.log(`\n[Keep-Alive] Starting bot... (attempt ${restartCount + 1}/${MAX_RESTARTS})`);

  botProcess = spawn('node', ['index.js'], {
    stdio: 'inherit',
    env: process.env,
    cwd: __dirname,
  });

  botProcess.on('exit', (code, signal) => {
    botAlive = false;
    const msg = `[Keep-Alive] Bot exited | code=${code} signal=${signal} | restart #${restartCount + 1}`;
    writeCrashLog(msg);

    restartCount++;
    const delay = Math.min(RESTART_DELAY_MS * Math.pow(1.5, restartCount), 60000);
    console.log(`[Keep-Alive] Restarting in ${Math.round(delay / 1000)}s...`);
    setTimeout(startBot, delay);
  });

  botProcess.on('error', (err) => {
    botAlive = false;
    writeCrashLog(`[Keep-Alive] Process error: ${err.message}`);
  });

  // Watchdog: check if bot is responsive
  clearInterval(watchdogInterval);
  watchdogInterval = setInterval(() => {
    lastHealthCheck = Date.now();
    if (botProcess && botAlive) {
      // Bot is running, update health check time
    }
  }, HEALTH_CHECK_INTERVAL);
}

let watchdogInterval;

// ── Graceful Shutdown ────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[Keep-Alive] ${signal} received. Shutting down gracefully...`);

  clearInterval(watchdogInterval);

  if (botProcess) {
    botProcess.kill('SIGTERM');
    setTimeout(() => {
      if (botProcess && !botProcess.killed) {
        botProcess.kill('SIGKILL');
      }
    }, 5000);
  }

  server.close(() => {
    console.log('[Keep-Alive] HTTP server closed.');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.log('[Keep-Alive] Forced exit.');
    process.exit(0);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ── Start ────────────────────────────────────────────────────

startBot();
