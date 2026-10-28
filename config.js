// config.js
// Minimal .env loader (no "dotenv" package needed) + centralized settings.

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  // Where the SQLite file and uploads/ folder live. Point this at a mounted
  // volume in Docker (see docker-compose.yml) so data survives a container restart.
  DATA_DIR: process.env.DATA_DIR || __dirname,
  SESSION_TTL_DAYS: parseInt(process.env.SESSION_TTL_DAYS || '7', 10),
  MAX_UPLOAD_MB: parseInt(process.env.MAX_UPLOAD_MB || '15', 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10) || 15 * 60 * 1000,
  RATE_LIMIT_MAX_ATTEMPTS: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || '10', 10),
  ALLOWED_EXTENSIONS: (process.env.ALLOWED_EXTENSIONS ||
    'pdf,doc,docx,ppt,pptx,txt,md,jpg,jpeg,png').split(',').map((e) => e.trim().toLowerCase()),
  APP_URL: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
};
