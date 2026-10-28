// db.js
// Database layer for StudyShare, using Node's built-in node:sqlite module
// (no external dependencies required).

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const config = require('./config');

if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true });
const DB_PATH = path.join(config.DATA_DIR, 'studyshare.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student', -- student | faculty | moderator | admin
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uploader_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  subject TEXT,
  course_code TEXT,
  semester TEXT,
  tags TEXT, -- comma-separated
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | removed
  views INTEGER NOT NULL DEFAULT 0,
  current_version INTEGER NOT NULL DEFAULT 1,
  verified_by_faculty INTEGER NOT NULL DEFAULT 0,
  verified_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (uploader_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS note_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(note_id, user_id),
  FOREIGN KEY (note_id) REFERENCES notes(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  parent_id INTEGER, -- NULL for top-level comments; set for replies
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (parent_id) REFERENCES comments(id)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  note_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, note_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (note_id) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS follows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  course_code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, course_code)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open', -- open | resolved
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id),
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`);

// --- Lightweight migrations for DBs created before a column existed ---
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}
function addColumnIfMissing(table, column, definition) {
  if (!columnExists(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumnIfMissing('sessions', 'expires_at', "TEXT NOT NULL DEFAULT '2999-01-01'");
addColumnIfMissing('users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'verification_token', 'TEXT');
addColumnIfMissing('notes', 'current_version', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('notes', 'verified_by_faculty', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('notes', 'verified_by', 'INTEGER');
addColumnIfMissing('comments', 'parent_id', 'INTEGER');

module.exports = db;
