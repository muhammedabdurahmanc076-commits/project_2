// auth.js
// Password hashing (scrypt), session tokens with expiry, and email
// verification tokens. Uses only Node's built-in crypto module.

const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).get(token);
  return row || null;
}

function requireAuth(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return getUserByToken(token);
}

function generateVerificationToken() {
  return crypto.randomBytes(20).toString('hex');
}

// Periodically sweep expired sessions so the table doesn't grow unbounded.
setInterval(() => {
  try { db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run(); } catch (e) { /* noop */ }
}, 60 * 60 * 1000).unref();

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getUserByToken,
  requireAuth,
  generateVerificationToken,
};
