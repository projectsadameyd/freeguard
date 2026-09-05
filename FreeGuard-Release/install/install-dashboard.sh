#!/bin/bash
# free-Guard — one-command Raspberry Pi installer + systemd service.
# Author: Adam Eyd. Run on the Pi itself.
set -e

echo "=========================================="
echo "  free-Guard installer"
echo "=========================================="

# 1. Install dependencies
if ! command -v node >/dev/null 2>&1; then
  echo "[1/4] Installing Node.js 20 (LTS)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[1/4] Node.js present: $(node -v)"
fi

# 2. Install project dependencies
echo "[2/4] npm install..."
npm install --omit=dev

# 3. Create runtime directories (gitignored)
echo "[3/4] Creating data/ and logs/..."
mkdir -p data logs

# 4. Install the systemd service
echo "[4/4] Installing systemd service 'freeguard'..."
sudo tee /etc/systemd/system/freeguard.service > /dev/null <<EOF
[Unit]
Description=free-Guard Discord moderation bot + dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PWD
EnvironmentFile=$PWD/.env
ExecStart=/usr/bin/node index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now freeguard

echo ""
echo "=========================================="
echo "  DONE!"
echo "=========================================="
echo "Next steps:"
echo "  1. Fill in ${PWD}/.env (copy from .env.example in this folder)"
echo "  2. Expose the dashboard publicly:"
echo "     tailscale funnel --bg ${DASHBOARD_PORT:-3002}   # or a Cloudflare tunnel"
echo "  3. Add this redirect to your OAuth app:"
echo "     http://raspberry.example.ts.net/api/auth/callback"
echo "  4. sudo systemctl restart freeguard"
echo ""
echo "Logs: journalctl -u freeguard -f"
echo ""