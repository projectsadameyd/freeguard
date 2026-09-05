# Installs dependencies and smoke-checks the project structure.

echo "[free-Guard] installing dependencies..."
npm install --omit=dev || { echo "npm install failed"; exit 1; }

echo "[free-Guard] database + log directories..."
mkdir -p data logs

echo "[free-Guard] done. Start with: npm start"