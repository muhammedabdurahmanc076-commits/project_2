// server.js
// StudyShare - full-stack student notes sharing platform
// Plain Node.js (http module) backend + static frontend. No external npm packages required.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { hashPassword, verifyPassword, createSession, requireAuth } = require('./auth');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------- helpers ----------

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) { // 25MB cap
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
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

// serve static files from /public
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

// ---------- route handlers ----------

async function handleRegister(req, res) {
  const body = await readBody(req);
  const { name, email, password } = body;
  if (!name || !email || !password) return sendJSON(res, 400, { error: 'name, email, password are required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return sendJSON(res, 409, { error: 'Email already registered' });
  const { hash, salt } = hashPassword(password);
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, salt, role) VALUES (?, ?, ?, ?, ?)'
  ).run(name, email, hash, salt, 'student');
  const token = createSession(info.lastInsertRowid);
  sendJSON(res, 201, { token, user: { id: info.lastInsertRowid, name, email, role: 'student' } });
}

async function handleLogin(req, res) {
  const body = await readBody(req);
  const { email, password } = body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) {
    return sendJSON(res, 401, { error: 'Invalid email or password' });
  }
  const token = createSession(user.id);
  sendJSON(res, 200, { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}

async function handleListNotes(req, res, query) {
  const { q, subject, course_code, tag, sort } = query;
  let sql = "SELECT * FROM notes WHERE status = 'active'";
  const params = [];
  if (q) { sql += ' AND (title LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (subject) { sql += ' AND subject = ?'; params.push(subject); }
  if (course_code) { sql += ' AND course_code = ?'; params.push(course_code); }
  if (tag) { sql += ' AND tags LIKE ?'; params.push(`%${tag}%`); }
  sql += ' ORDER BY created_at DESC';
  let notes = db.prepare(sql).all(...params).map(noteWithStats);

  if (sort === 'top_rated') notes.sort((a, b) => b.avg_stars - a.avg_stars);
  else if (sort === 'most_viewed') notes.sort((a, b) => b.views - a.views);

  sendJSON(res, 200, { notes });
}

async function handleGetNote(req, res, id) {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!note) return sendJSON(res, 404, { error: 'Note not found' });
  db.prepare('UPDATE notes SET views = views + 1 WHERE id = ?').run(id);
  note.views += 1;
  sendJSON(res, 200, { note: noteWithStats(note) });
}

async function handleUploadNote(req, res) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const body = await readBody(req);
  const { title, subject, course_code, semester, tags, description, file_name, file_base64 } = body;
  if (!title || !file_name || !file_base64) {
    return sendJSON(res, 400, { error: 'title, file_name and file_base64 are required' });
  }
  const safeName = `${Date.now()}_${file_name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const diskPath = path.join(UPLOADS_DIR, safeName);
  fs.writeFileSync(diskPath, Buffer.from(file_base64, 'base64'));

  const info = db.prepare(
    `INSERT INTO notes (uploader_id, title, subject, course_code, semester, tags, file_name, file_path, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(user.id, title, subject || null, course_code || null, semester || null, tags || '', file_name, safeName, description || '');

  notifyFollowers(course_code, `New note "${title}" uploaded for ${course_code}`);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, { note: noteWithStats(note) });
}

async function handleDownloadNote(req, res, id) {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  if (!note || note.status !== 'active') { res.writeHead(404); return res.end('Not found'); }
  const diskPath = path.join(UPLOADS_DIR, note.file_path);
  fs.readFile(diskPath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('File missing'); }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${note.file_name}"`,
    });
    res.end(data);
  });
}

async function handleRateNote(req, res, id) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const body = await readBody(req);
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
  const body = await readBody(req);
  if (!body.body) return sendJSON(res, 400, { error: 'Comment body is required' });
  db.prepare('INSERT INTO comments (note_id, user_id, body) VALUES (?, ?, ?)').run(id, user.id, body.body);
  sendJSON(res, 201, { ok: true });
}

async function handleListComments(req, res, id) {
  const comments = db.prepare(
    `SELECT c.id, c.body, c.created_at, u.name as user_name
     FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.note_id = ? ORDER BY c.created_at ASC`
  ).all(id);
  sendJSON(res, 200, { comments });
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
  const body = await readBody(req);
  if (!body.course_code) return sendJSON(res, 400, { error: 'course_code is required' });
  db.prepare('INSERT OR IGNORE INTO follows (user_id, course_code) VALUES (?, ?)').run(user.id, body.course_code);
  sendJSON(res, 201, { ok: true });
}

async function handleReportNote(req, res, id) {
  const user = requireAuth(req);
  if (!user) return sendJSON(res, 401, { error: 'Login required' });
  const body = await readBody(req);
  db.prepare('INSERT INTO reports (note_id, reporter_id, reason) VALUES (?, ?, ?)').run(id, user.id, body.reason || '');
  sendJSON(res, 201, { ok: true });
}

function requireModerator(user) {
  return user && (user.role === 'moderator' || user.role === 'admin');
}

async function handleListReports(req, res) {
  const user = requireAuth(req);
  if (!requireModerator(user)) return sendJSON(res, 403, { error: 'Moderator access required' });
  const reports = db.prepare(
    `SELECT r.id, r.reason, r.status, r.created_at, n.id as note_id, n.title, u.name as reporter_name
     FROM reports r JOIN notes n ON n.id = r.note_id JOIN users u ON u.id = r.reporter_id
     WHERE r.status = 'open' ORDER BY r.created_at ASC`
  ).all();
  sendJSON(res, 200, { reports });
}

async function handleResolveReport(req, res, id) {
  const user = requireAuth(req);
  if (!requireModerator(user)) return sendJSON(res, 403, { error: 'Moderator access required' });
  const body = await readBody(req);
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
  if (!requireModerator(user)) return sendJSON(res, 403, { error: 'Moderator access required' });
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const totalNotes = db.prepare("SELECT COUNT(*) c FROM notes WHERE status = 'active'").get().c;
  const topRated = db.prepare(
    `SELECT n.id, n.title, AVG(r.stars) as avg_stars, COUNT(r.id) as rating_count
     FROM notes n LEFT JOIN ratings r ON r.note_id = n.id
     WHERE n.status = 'active' GROUP BY n.id ORDER BY avg_stars DESC LIMIT 5`
  ).all();
  const mostViewed = db.prepare(
    "SELECT id, title, views FROM notes WHERE status = 'active' ORDER BY views DESC LIMIT 5"
  ).all();
  const openReports = db.prepare("SELECT COUNT(*) c FROM reports WHERE status = 'open'").get().c;
  sendJSON(res, 200, { totalUsers, totalNotes, topRated, mostViewed, openReports });
}

// ---------- router ----------

const server = http.createServer(async (req, res) => {
  try {
    const [urlPath, queryString] = req.url.split('?');
    const query = Object.fromEntries(new URLSearchParams(queryString || ''));
    const segments = urlPath.split('/').filter(Boolean); // e.g. ['api','notes','3','rate']

    if (segments[0] !== 'api') return serveStatic(req, res);

    // /api/register
    if (segments[1] === 'register' && req.method === 'POST') return await handleRegister(req, res);
    // /api/login
    if (segments[1] === 'login' && req.method === 'POST') return await handleLogin(req, res);
    // /api/notes
    if (segments[1] === 'notes' && segments.length === 2) {
      if (req.method === 'GET') return await handleListNotes(req, res, query);
      if (req.method === 'POST') return await handleUploadNote(req, res);
    }
    // /api/notes/:id ...
    if (segments[1] === 'notes' && segments.length >= 3) {
      const id = segments[2];
      if (segments.length === 3 && req.method === 'GET') return await handleGetNote(req, res, id);
      if (segments[3] === 'download' && req.method === 'GET') return await handleDownloadNote(req, res, id);
      if (segments[3] === 'rate' && req.method === 'POST') return await handleRateNote(req, res, id);
      if (segments[3] === 'comments' && req.method === 'POST') return await handleCommentNote(req, res, id);
      if (segments[3] === 'comments' && req.method === 'GET') return await handleListComments(req, res, id);
      if (segments[3] === 'bookmark' && req.method === 'POST') return await handleBookmark(req, res, id);
      if (segments[3] === 'bookmark' && req.method === 'DELETE') return await handleUnbookmark(req, res, id);
      if (segments[3] === 'report' && req.method === 'POST') return await handleReportNote(req, res, id);
    }
    // /api/bookmarks
    if (segments[1] === 'bookmarks' && req.method === 'GET') return await handleListBookmarks(req, res);
    // /api/follow
    if (segments[1] === 'follow' && req.method === 'POST') return await handleFollow(req, res);
    // /api/notifications
    if (segments[1] === 'notifications' && req.method === 'GET') return await handleNotifications(req, res);
    // /api/moderation/reports
    if (segments[1] === 'moderation' && segments[2] === 'reports' && segments.length === 3 && req.method === 'GET') {
      return await handleListReports(req, res);
    }
    if (segments[1] === 'moderation' && segments[2] === 'reports' && segments.length === 4 && req.method === 'POST') {
      return await handleResolveReport(req, res, segments[3]);
    }
    // /api/dashboard/stats
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
  console.log(`StudyShare server running at http://localhost:${PORT}`);
});
