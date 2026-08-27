#!/usr/bin/env node
// ============================================================
//  USCCB:free-Guard v2 — Admin Log Reader
//  Usage:
//    node readlog.js                          — Today's logs
//    node readlog.js 2025-01-15               — Specific date
//    node readlog.js 2025-01-15 --level WARN  — Filter by level
//    node readlog.js 2025-01-15 --search spam  — Search filter
//    node readlog.js 2025-01-15 --category VIOLATION
//    node readlog.js --files                   — List log files
//    node readlog.js --export 2025-01-15       — Export as JSON
//  EchoBastion Group
// ============================================================

require('dotenv').config();
const { readLogEntries, getLogFiles } = require('./src/logger');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

// ── Parse Arguments ──────────────────────────────────────────

function parseArgs(args) {
  const result = { date: null, level: null, search: null, category: null, files: false, export: null };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--files') { result.files = true; continue; }
    if (arg === '--level' && args[i + 1]) { result.level = args[++i].toUpperCase(); continue; }
    if (arg === '--search' && args[i + 1]) { result.search = args[++i]; continue; }
    if (arg === '--category' && args[i + 1]) { result.category = args[++i].toUpperCase(); continue; }
    if (arg === '--export' && args[i + 1]) { result.export = args[++i]; continue; }
    if (!arg.startsWith('--') && !result.date) { result.date = arg; }
  }
  return result;
}

const opts = parseArgs(args);

// ── List Log Files ───────────────────────────────────────────

if (opts.files) {
  const files = getLogFiles();
  if (files.length === 0) {
    console.log('No log files found.');
  } else {
    console.log('\n═══ USCCB:free-Guard Log Files ═══\n');
    for (const file of files) {
      const stat = fs.statSync(path.join(__dirname, 'logs', file));
      const sizeKB = (stat.size / 1024).toFixed(1);
      console.log(`  ${file}  (${sizeKB} KB)`);
    }
    console.log(`\n  Total: ${files.length} file(s)\n`);
  }
  process.exit(0);
}

// ── Read Logs ────────────────────────────────────────────────

const entries = readLogEntries(opts.date, {
  level: opts.level,
  category: opts.category,
  search: opts.search,
});

if (entries.length === 0) {
  console.log(`No log entries found for ${opts.date || 'today'}.`);
  process.exit(0);
}

// ── Export Mode ──────────────────────────────────────────────

if (opts.export) {
  const exportPath = path.join(__dirname, 'logs', `export-${opts.export || 'today'}.json`);
  fs.writeFileSync(exportPath, JSON.stringify(entries, null, 2));
  console.log(`Exported ${entries.length} entries to ${exportPath}`);
  process.exit(0);
}

// ── Display Mode ─────────────────────────────────────────────

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  USCCB:free-Guard v2 — Decrypted Logs`);
console.log(`  Date: ${opts.date || 'Today'} | Entries: ${entries.length}`);
if (opts.level) console.log(`  Level Filter: ${opts.level}`);
if (opts.category) console.log(`  Category Filter: ${opts.category}`);
if (opts.search) console.log(`  Search: "${opts.search}"`);
console.log(`═══════════════════════════════════════════════════\n`);

for (const entry of entries) {
  const time = entry.t ? entry.t.slice(11, 19) : '??:??:??';
  const level = (entry.l || '?').padEnd(5);
  const cat = (entry.c || '?').padEnd(18);
  console.log(`  [${time}] [${level}] [${cat}] ${entry.m}`);
  if (entry.d && typeof entry.d === 'object') {
    const extra = Object.entries(entry.d).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`           └─ ${extra}`);
  }
}

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  Total: ${entries.length} entry(ies)`);
console.log(`═══════════════════════════════════════════════════\n`);
