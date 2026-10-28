// server.js
// StudyShare - full-stack student notes sharing platform
// Plain Node.js (http module) backend + static frontend. No external npm packages required.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const storage = require('./storage');
const { parseMultipart } = require('./multipart');
const rateLimiter = require('./rateLimiter');
const {
  isValidEmail, isStrongPassword, sanitizeText, sanitizeTags,
  isAllowedFileType, isWithinUploadLimit,
} = require('./validation');
const { hashPassword, verifyPassword, createSession, requireAuth, generateVerificationToken } = require('./auth');

const PORT = config.PORT;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- small helpers ----------

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// Security headers applied to every response. Note on CSRF: this API uses
// Authorization: Bearer <token> (never cookies) for auth, so requests cannot
// be triggered cross-site by a browser automatically attaching credentials —
// classic CSRF does not apply to this auth scheme.
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSONBody(req) {
  const buf = await readRawBody(req, 2 * 1024 * 1024); // 2MB cap for plain JSON bodies
  if (buf.length === 0) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch (e) { throw new Error('Invalid JSON body'); }
}

function notifyFollowers(courseCode, message) {
  if (!courseCode) return;
  const followers = db.prepare('SELECT user_id FROM follows WHERE course_code = ?').all(courseCode);
  const insert = db.prepare('INSERT INTO notifications (user_id, message) VALUES (?, ?)');
  for (const f of followers) insert.run(f.user_id, message);
}

function noteWithStats(note) {
  const avg = db.prepare(
    'SELECT AVG(stars) as avg_stars, COUNT(*) as rating_count FROM ratings WHERE note_id = ?'
  ).get(note.id);
  const comment_count = db.prepare(
    'SELECT COUNT(*) as c FROM comments WHERE note_id = ?'
  ).get(note.id).c;
  const uploader = db.prepare('SELECT name FROM users WHERE id = ?').get(note.uploader_id);
  return {
    ...note,
    uploader_name: uploader ? uploader.name : 'Unknown',
    avg_stars: avg.avg_stars ? Math.round(avg.avg_stars * 10) / 10 : 0,
    rating_count: avg.rating_count,
    comment_count,
  };
}

function requireRole(user, roles) {
  return !!user && roles.includes(user.role);
}

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- auth routes ----------

async function handleRegister(req, res) {
  if (!rateLimiter.allow(clientIp(req), 'register')) {
    return sendJSON(res, 429, { error: 'Too many registration attempts. Please try again later.' });
  }
  const body = await readJSONBody(req);
  const name = sanitizeText(body.name, 100);
  const email = sanitizeText(body.email, 254).toLowerCase();
  const password = body.password;

  if (!name) return sendJSON(res, 400, { error: 'Name is required' });
  if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'A valid email is required' });
  if (!isStrongPassword(password)) {
    return sendJSON(res, 400, { error: 'Password must be at least 8 characters and include a letter and a number' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return sendJSON(res, 409, { error: 'Email already registered' });

  const { hash, salt } = hashPassword(password);
  const verificationToken = generateVerificationToken();
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, salt, role, verification_token) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, email, hash, salt, 'student', verificationToken);

  const verification_url = `${config.APP_URL}/api/verify-email?token=${verificationToken}`;
  // No outbound network/email in this environment: we log the "sent" email
  // to the server console and also return the link directly (dev-mode
  // convenience). In production, send this via a real email provider instead.
  console.log(`[StudyShare] Verification email for ${email}: ${verification_url}`);

  const token = createSession(info.lastInsertRowid);
  sendJSON(res, 201, {
    token,
    user: { id: info.lastInsertRowid, name, email, role: 'student', email_verified: false },
    verification_url,
    note: 'Email sending is not available in this environment; use verification_url to verify the account.',
  });
}

async function handleLogin(req, res) {
  const ip = clientIp(req);
  if (rateLimiter.isBlocked(ip, 'login')) {
    return sendJSON(res, 429, { error: 'Too many failed login attempts. Please try again later.' });
  }
  const body = await readJSONBody(req);
  const email = sanitizeText(body.email, 254).toLowerCase();
  const password = body.password || '';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    rateLimiter.recordAttempt(ip, 'login'); // only failed attempts consume the budget
    return sendJSON(res, 401, { error: 'Invalid email or password' });
  }
  const token = createSession(user.id);
  sendJSON(res, 200, {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, email_verified: !!user.email_verified },
  });
}

async function handleVerifyEmail(req, res, query) {
  const token = query.token;
  const user = db.prepare('SELECT * FROM users WHERE verification_token = ?').get(token);
  if (!user) return sendJSON(res, 400, { error: 'Invalid or expired verification link' });
  db.prepare('UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?').run(user.id);
  sendJSON(res, 200, { ok: true, message: 'Email verified. You can now upload notes.' });
}

async function handleResendVerification(req, res) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  if (user.email_verified) return sendJSON(res, 200, { ok: true, message: 'Already verified.' });
  const token = generateVerificationToken();
  db.prepare('UPDATE users SET verification_token = ? WHERE id = ?').run(token, user.id);
  const verification_url = `${config.APP_URL}/api/verify-email?token=${token}`;
  console.log(`[StudyShare] Verification email for ${user.email}: ${verification_url}`);
  sendJSON(res, 200, { ok: true, verification_url });
}

// ---------- notes: browse / search / pagination / ranking ----------

async function handleListNotes(req, res, query) {
  const q = sanitizeText(query.q, 100);
  const subject = sanitizeText(query.subject, 100);
  const course_code = sanitizeText(query.course_code, 50);
  const tag = sanitizeText(query.tag, 30);
  const sort = query.sort || '';
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(query.page_size, 10) || 12));

  let sql = "SELECT * FROM notes WHERE status = 'active'";
  const params = [];
  if (q) { sql += ' AND (title LIKE ? OR description LIKE ? OR tags LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (subject) { sql += ' AND subject = ?'; params.push(subject); }
  if (course_code) { sql += ' AND course_code = ?'; params.push(course_code); }
  if (tag) { sql += ' AND tags LIKE ?'; params.push(`%${tag}%`); }
  sql += ' ORDER BY created_at DESC';

  let notes = db.prepare(sql).all(...params).map(noteWithStats);

  // Simple relevance ranking when there's a free-text query and no explicit sort:
  // title matches score higher than description/tag matches.
  if (q && !sort) {
    const qLower = q.toLowerCase();
    notes = notes
      .map((n) => {
        let score = 0;
        if ((n.title || '').toLowerCase().includes(qLower)) score += 3;
        if ((n.description || '').toLowerCase().includes(qLower)) score += 1;
        if ((n.tags || '').toLowerCase().includes(qLower)) score += 2;
        return { ...n, _score: score };
      })
      .sort((a, b) => b._score - a._score || new Date(b.created_at) - new Date(a.created_at))
      .map(({ _score, ...rest }) => rest);
  } else if (sort === 'top_rated') {
    notes.sort((a, b) => b.avg_stars - a.avg_stars);
  } else if (sort === 'most_viewed') {
    notes.sort((a, b) => b.views - a.views);
  }

  const total = notes.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paged = notes.slice((page - 1) * pageSize, page * pageSize);

  sendJSON(res, 200, { notes: paged, pagination: { page, page_size: pageSize, total, total_pages: totalPages } });
}

async function handleGetNote(req, res, id) {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!note) return sendJSON(res, 404, { error: 'Note not found' });
  db.prepare('UPDATE notes SET views = views + 1 WHERE id = ?').run(id);
  note.views += 1;
  sendJSON(res, 200, { note: noteWithStats(note) });
}

// ---------- notes: upload (multipart) / versioning ----------

async function parseMultipartRequest(req) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('multipart/form-data')) {
    throw new Error('Expected multipart/form-data request');
  }
  const maxBytes = config.MAX_UPLOAD_MB * 1024 * 1024 + 1024 * 1024; // + headroom for form fields/boundaries
  const buf = await readRawBody(req, maxBytes);
  return parseMultipart(buf, contentType);
}

async function handleUploadNote(req, res) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  if (!user.email_verified) {
    return sendJSON(res, 403, { error: 'Please verify your email before uploading notes. Use /api/resend-verification if you need a new link.' });
  }

  let fields, files;
  try {
    ({ fields, files } = await parseMultipartRequest(req));
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  const file = files.find((f) => f.fieldname === 'file');
  if (!file) return sendJSON(res, 400, { error: 'A file is required' });
  if (!isAllowedFileType(file.filename)) {
    return sendJSON(res, 400, { error: `File type not allowed. Allowed: ${config.ALLOWED_EXTENSIONS.join(', ')}` });
  }
  if (!isWithinUploadLimit(file.data.length)) {
    return sendJSON(res, 400, { error: `File exceeds the ${config.MAX_UPLOAD_MB}MB upload limit` });
  }

  const title = sanitizeText(fields.title, 200);
  if (!title) return sendJSON(res, 400, { error: 'Title is required' });
  const subject = sanitizeText(fields.subject, 100);
  const course_code = sanitizeText(fields.course_code, 50);
  const semester = sanitizeText(fields.semester, 50);
  const tags = sanitizeTags(fields.tags);
  const description = sanitizeText(fields.description, 2000);

  const safeName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  storage.save(file.data, safeName);

  const info = db.prepare(
    `INSERT INTO notes (uploader_id, title, subject, course_code, semester, tags, file_name, file_path, description, current_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(user.id, title, subject || null, course_code || null, semester || null, tags, file.filename, safeName, description);

  db.prepare(
    `INSERT INTO note_versions (note_id, version, file_name, file_path, uploaded_by) VALUES (?, 1, ?, ?, ?)`
  ).run(info.lastInsertRowid, file.filename, safeName, user.id);

  notifyFollowers(course_code, `New note "${title}" uploaded for ${course_code}`);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, { note: noteWithStats(note) });
}

async function handleUploadNewVersion(req, res, id) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!note) return sendJSON(res, 404, { error: 'Note not found' });
  const isOwnerOrStaff = note.uploader_id === user.id || requireRole(user, ['faculty', 'moderator', 'admin']);
  if (!isOwnerOrStaff) return sendJSON(res, 403, { error: 'Only the original uploader or staff can add a new version' });

  let files;
  try {
    ({ files } = await parseMultipartRequest(req));
  } catch (e) {
    return sendJSON(res, 400, { error: e.message });
  }
  const file = files.find((f) => f.fieldname === 'file');
  if (!file) return sendJSON(res, 400, { error: 'A file is required' });
  if (!isAllowedFileType(file.filename)) {
    return sendJSON(res, 400, { error: `File type not allowed. Allowed: ${config.ALLOWED_EXTENSIONS.join(', ')}` });
  }
  if (!isWithinUploadLimit(file.data.length)) {
    return sendJSON(res, 400, { error: `File exceeds the ${config.MAX_UPLOAD_MB}MB upload limit` });
  }

  const safeName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${file.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  storage.save(file.data, safeName);
  const newVersion = note.current_version + 1;

  db.prepare(
    `INSERT INTO note_versions (note_id, version, file_name, file_path, uploaded_by) VALUES (?, ?, ?, ?, ?)`
  ).run(id, newVersion, file.filename, safeName, user.id);
  db.prepare(
    'UPDATE notes SET file_name = ?, file_path = ?, current_version = ? WHERE id = ?'
  ).run(file.filename, safeName, newVersion, id);

  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  sendJSON(res, 200, { note: noteWithStats(updated) });
}

async function handleListVersions(req, res, id) {
  const versions = db.prepare(
    `SELECT v.version, v.file_name, v.created_at, u.name as uploaded_by_name
     FROM note_versions v JOIN users u ON u.id = v.uploaded_by
     WHERE v.note_id = ? ORDER BY v.version DESC`
  ).all(id);
  sendJSON(res, 200, { versions });
}

async function handleDownloadNote(req, res, id) {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!note || note.status !== 'active') { res.writeHead(404); return res.end('Not found'); }
  if (!storage.exists(note.file_path)) { res.writeHead(404); return res.end('File missing'); }
  const data = storage.read(note.file_path);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${note.file_name}"`,
  });
  res.end(data);
}

async function handleVerifyNote(req, res, id) {
  const user = requireAuth(req);
  if (!requireRole(user, ['faculty', 'moderator', 'admin'])) {
    return sendJSON(res, 403, { error: 'Faculty or moderator access required' });
  }
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!note) return sendJSON(res, 404, { error: 'Note not found' });
  db.prepare('UPDATE notes SET verified_by_faculty = 1, verified_by = ? WHERE id = ?').run(user.id, id);
  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  sendJSON(res, 200, { note: noteWithStats(updated) });
}

// ---------- ratings / comments / bookmarks / follows / reports ----------

async function handleRateNote(req, res, id) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const body = await readJSONBody(req);
  const stars = parseInt(body.stars, 10);
  if (!stars || stars < 1 || stars > 5) return sendJSON(res, 400, { error: 'stars must be 1-5' });
  db.prepare(
    `INSERT INTO ratings (note_id, user_id, stars) VALUES (?, ?, ?)
     ON CONFLICT(note_id, user_id) DO UPDATE SET stars = excluded.stars`
  ).run(id, user.id, stars);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  sendJSON(res, 200, { note: noteWithStats(note) });
}

async function handleCommentNote(req, res, id) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const body = await readJSONBody(req);
  const text = sanitizeText(body.body, 2000);
  if (!text) return sendJSON(res, 400, { error: 'Comment body is required' });
  let parentId = null;
  if (body.parent_id) {
    const parent = db.prepare('SELECT id FROM comments WHERE id = ? AND note_id = ?').get(body.parent_id, id);
    if (!parent) return sendJSON(res, 400, { error: 'Invalid parent comment' });
    parentId = parent.id;
  }
  db.prepare('INSERT INTO comments (note_id, user_id, parent_id, body) VALUES (?, ?, ?, ?)').run(id, user.id, parentId, text);
  sendJSON(res, 201, { ok: true });
}

async function handleListComments(req, res, id) {
  const rows = db.prepare(
    `SELECT c.id, c.body, c.created_at, c.parent_id, u.name as user_name
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.note_id = ? ORDER BY c.created_at ASC`
  ).all(id);
  // Nest replies one level under their parent for easier rendering.
  const topLevel = rows.filter((r) => !r.parent_id);
  const byParent = {};
  for (const r of rows) {
    if (r.parent_id) {
      byParent[r.parent_id] = byParent[r.parent_id] || [];
      byParent[r.parent_id].push(r);
    }
  }
  const nested = topLevel.map((c) => ({ ...c, replies: byParent[c.id] || [] }));
  sendJSON(res, 200, { comments: nested });
}

async function handleBookmark(req, res, id) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  db.prepare('INSERT OR IGNORE INTO bookmarks (user_id, note_id) VALUES (?, ?)').run(user.id, id);
  sendJSON(res, 201, { ok: true });
}

async function handleUnbookmark(req, res, id) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND note_id = ?').run(user.id, id);
  sendJSON(res, 200, { ok: true });
}

async function handleListBookmarks(req, res) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const notes = db.prepare(
    `SELECT n.* FROM bookmarks b JOIN notes n ON n.id = b.note_id WHERE b.user_id = ? ORDER BY b.created_at DESC`
  ).all(user.id).map(noteWithStats);
  sendJSON(res, 200, { notes });
}

async function handleFollow(req, res) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const body = await readJSONBody(req);
  const course_code = sanitizeText(body.course_code, 50);
  if (!course_code) return sendJSON(res, 400, { error: 'course_code is required' });
  db.prepare('INSERT OR IGNORE INTO follows (user_id, course_code) VALUES (?, ?)').run(user.id, course_code);
  sendJSON(res, 201, { ok: true });
}

async function handleReportNote(req, res, id) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const body = await readJSONBody(req);
  const reason = sanitizeText(body.reason, 500);
  db.prepare('INSERT INTO reports (note_id, reporter_id, reason) VALUES (?, ?, ?)').run(id, user.id, reason);
  sendJSON(res, 201, { ok: true });
}

// ---------- moderation / dashboard ----------

async function handleListReports(req, res) {
  const user = requireAuth(req);
  if (!requireRole(user, ['moderator', 'admin'])) return sendJSON(res, 403, { error: 'Moderator access required' });
  const reports = db.prepare(
    `SELECT r.id, r.reason, r.status, r.created_at, n.id as note_id, n.title, u.name as reporter_name
     FROM reports r JOIN notes n ON n.id = r.note_id JOIN users u ON u.id = r.reporter_id
     WHERE r.status = 'open' ORDER BY r.created_at ASC`
  ).all();
  sendJSON(res, 200, { reports });
}

async function handleResolveReport(req, res, id) {
  const user = requireAuth(req);
  if (!requireRole(user, ['moderator', 'admin'])) return sendJSON(res, 403, { error: 'Moderator access required' });
  const body = await readJSONBody(req);
  const action = body.action; // 'remove_note' | 'dismiss'
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
  if (!report) return sendJSON(res, 404, { error: 'Report not found' });
  if (action === 'remove_note') {
    db.prepare("UPDATE notes SET status = 'removed' WHERE id = ?").run(report.note_id);
  }
  db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").run(id);
  sendJSON(res, 200, { ok: true });
}

async function handleNotifications(req, res) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const notes = db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(user.id);
  sendJSON(res, 200, { notifications: notes });
}

async function handleDashboardStats(req, res) {
  const user = requireAuth(req);
  if (!requireRole(user, ['moderator', 'admin'])) return sendJSON(res, 403, { error: 'Moderator access required' });
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const totalNotes = db.prepare("SELECT COUNT(*) c FROM notes WHERE status = 'active'").get().c;
  const verifiedNotes = db.prepare("SELECT COUNT(*) c FROM notes WHERE status = 'active' AND verified_by_faculty = 1").get().c;
  const topRated = db.prepare(
    `SELECT n.id, n.title, AVG(r.stars) as avg_stars, COUNT(r.id) as rating_count
     FROM notes n LEFT JOIN ratings r ON r.note_id = n.id
     WHERE n.status = 'active' GROUP BY n.id ORDER BY avg_stars DESC LIMIT 5`
  ).all();
  const mostViewed = db.prepare(
    "SELECT id, title, views FROM notes WHERE status = 'active' ORDER BY views DESC LIMIT 5"
  ).all();
  const openReports = db.prepare("SELECT COUNT(*) c FROM reports WHERE status = 'open'").get().c;
  sendJSON(res, 200, { totalUsers, totalNotes, verifiedNotes, topRated, mostViewed, openReports });
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  try {
    const [urlPath, queryString] = req.url.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryString || ''));
    const segments = urlPath.split('/').filter(Boolean);

    if (segments[0] !== 'api') return serveStatic(req, res);

    if (segments[1] === 'register' && req.method === 'POST') return await handleRegister(req, res);
    if (segments[1] === 'login' && req.method === 'POST') return await handleLogin(req, res);
    if (segments[1] === 'verify-email' && req.method === 'GET') return await handleVerifyEmail(req, res, query);
    if (segments[1] === 'resend-verification' && req.method === 'POST') return await handleResendVerification(req, res);

    if (segments[1] === 'notes' && segments.length === 2) {
      if (req.method === 'GET') return await handleListNotes(req, res, query);
      if (req.method === 'POST') return await handleUploadNote(req, res);
    }
    if (segments[1] === 'notes' && segments.length >= 3) {
      const id = segments[2];
      if (segments.length === 3 && req.method === 'GET') return await handleGetNote(req, res, id);
      if (segments[3] === 'download' && req.method === 'GET') return await handleDownloadNote(req, res, id);
      if (segments[3] === 'version' && req.method === 'POST') return await handleUploadNewVersion(req, res, id);
      if (segments[3] === 'versions' && req.method === 'GET') return await handleListVersions(req, res, id);
      if (segments[3] === 'verify' && req.method === 'POST') return await handleVerifyNote(req, res, id);
      if (segments[3] === 'rate' && req.method === 'POST') return await handleRateNote(req, res, id);
      if (segments[3] === 'comments' && req.method === 'POST') return await handleCommentNote(req, res, id);
      if (segments[3] === 'comments' && req.method === 'GET') return await handleListComments(req, res, id);
      if (segments[3] === 'bookmark' && req.method === 'POST') return await handleBookmark(req, res, id);
      if (segments[3] === 'bookmark' && req.method === 'DELETE') return await handleUnbookmark(req, res, id);
      if (segments[3] === 'report' && req.method === 'POST') return await handleReportNote(req, res, id);
    }
    if (segments[1] === 'bookmarks' && req.method === 'GET') return await handleListBookmarks(req, res);
    if (segments[1] === 'follow' && req.method === 'POST') return await handleFollow(req, res);
    if (segments[1] === 'notifications' && req.method === 'GET') return await handleNotifications(req, res);
    if (segments[1] === 'moderation' && segments[2] === 'reports' && segments.length === 3 && req.method === 'GET') {
      return await handleListReports(req, res);
    }
    if (segments[1] === 'moderation' && segments[2] === 'reports' && segments.length === 4 && req.method === 'POST') {
      return await handleResolveReport(req, res, segments[3]);
    }
    if (segments[1] === 'dashboard' && segments[2] === 'stats' && req.method === 'GET') {
      return await handleDashboardStats(req, res);
    }

    sendJSON(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err);
    sendJSON(res, 500, { error: 'Internal server error', detail: String(err.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`StudyShare server running at ${config.APP_URL}`);
});
