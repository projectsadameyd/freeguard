#!/bin/bash
# free-Guard — quick smoke test (structure + syntax).
# Author: Adam Eyd.

set -e
echo "[1/2] Syntax check (index, dashboard, src)..."
node --check index.js
node --check dashboard-server.js
node --check src/moderator.js
node --check src/strikeManager.js
node --check src/logger.js

echo "[2/2] Structure check..."
for f in index.js dashboard-server.js src/*.js dashboard/index.html dashboard/style.css dashboard/app.js .env.example package.json; do
  [ -f "$f" ] || { echo "MISSING: $f"; exit 1; }
done

echo ""
echo "All checks passed ✓"
echo "Next: cp .env.example .env && npm start"