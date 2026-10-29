// app.js — StudyShare frontend (vanilla JS, no build step required)

const state = {
  token: ssStore.getItem('ss_token') || null,
  user: JSON.parse(ssStore.getItem('ss_user') || 'null'),
  currentNoteId: null,
  page: 1,
  lastVerificationUrl: ssStore.getItem('ss_verification_url') || null,
  demo: ssStore.getItem('ss_demo_mode') === '1' || !ssIsWeb,
};

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function api(path, options = {}) {
  if (state.demo) return demoApi(path, options);
  let res;
  try { res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }); } catch (e) { state.demo = true; document.body.classList.add('demo'); return demoApi(path, options); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}


function enableDemoMode() {
  state.demo = true;
  ssStore.setItem('ss_demo_mode', '1');
  document.body.classList.add('demo');
  if (!state.user) {
    state.user = { id: 3, name: 'Demo Student', role: 'student', email: 'student@studyshare.local', email_verified: 1 };
    state.token = 'demo';
    ssStore.setItem('ss_token', 'demo');
    ssStore.setItem('ss_user', JSON.stringify(state.user));
  }
  renderAuthArea();
}

async function checkBackend() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const res = await fetch('/api/notes?page=1&page_size=1', { signal: controller.signal, headers: authHeaders() });
    clearTimeout(timer);
    if (!res.ok) throw new Error('Backend unavailable');
    if (state.demo && state.token === 'demo') { state.token = null; state.user = null; ssStore.removeItem('ss_token'); ssStore.removeItem('ss_user'); }
    state.demo = false; ssStore.removeItem('ss_demo_mode'); document.body.classList.remove('demo');
    return true;
  } catch (_) {
    enableDemoMode();
    return false;
  }
}

// For file uploads: send as multipart/form-data (no base64 inflation).
// Do NOT set Content-Type manually — the browser sets it with the boundary.
function apiUpload(path, formData, method = 'POST', onProgress) {
  if (state.demo) return demoUpload(formData);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `/api${path}`);
    if (state.token) xhr.setRequestHeader('Authorization', `Bearer ${state.token}`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.onload = () => {
      let data = {}; try { data = JSON.parse(xhr.responseText || '{}'); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.send(formData);
  });
}

// ---------- ui helpers ----------

const ICONS = {
  down: '<path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"/>',
  mark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  flag: '<path d="M5 21V4m0 0h12l-2 4 2 4H5"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
function spineColor(key) {
  let h = 0;
  for (const c of String(key || 'x')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 52%)`;
}
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- theme + enhanced upload ----------
function applyTheme() {
  const saved = ssStore.getItem('ss_theme');
  const dark = saved === 'dark' || (!saved && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('dark', dark);
  const btn = document.getElementById('themeToggle');
  if (btn) { btn.textContent = dark ? '☀' : '◐'; btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); }
}
applyTheme();
document.getElementById('themeToggle')?.addEventListener('click', () => {
  const dark = !document.body.classList.contains('dark');
  ssStore.setItem('ss_theme', dark ? 'dark' : 'light');
  applyTheme();
});

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const fileName = document.getElementById('fileName');
function showSelectedFile(file) {
  if (!fileName || !file) return;
  const mb = (file.size / 1024 / 1024).toFixed(2);
  fileName.textContent = `${file.name} · ${mb} MB`;
}
fileInput?.addEventListener('change', () => showSelectedFile(fileInput.files[0]));
['dragenter','dragover'].forEach(ev => dropzone?.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave','drop'].forEach(ev => dropzone?.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone?.addEventListener('drop', e => { const file=e.dataTransfer.files[0]; if(file){ const dt=new DataTransfer(); dt.items.add(file); fileInput.files=dt.files; showSelectedFile(file); } });

// ---------- view switching ----------

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'browse') loadNotes();
  if (name === 'dashboard') loadDashboard();
  if (name === 'bookmarks') loadBookmarks();
  if (name === 'notifications') loadNotifications();
  if (name === 'moderation') loadModeration();
}

document.getElementById('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.navbtn');
  if (!btn) return;
  if (!state.token && !state.demo) { renderAuthArea(); showView('auth'); return; }
  showView(btn.dataset.view);
});

document.getElementById('backToBrowse').addEventListener('click', () => showView('browse'));

// ---------- auth ----------

function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (state.user) {
    el.innerHTML = `<div class="userchip"><span class="avatar">${escapeHtml(state.user.name.trim().charAt(0).toUpperCase())}</span><span>${escapeHtml(state.user.name)} <span class="role">${escapeHtml(state.user.role)}</span></span></div> <button id="logoutBtn">Log out</button>`;
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.querySelector('.mod-only').style.display =
      (state.user.role === 'moderator' || state.user.role === 'admin') ? 'inline-block' : 'none';
  } else {
    el.innerHTML = `<button id="loginNavBtn">Log in</button>`;
    document.getElementById('loginNavBtn').addEventListener('click', () => showView('auth'));
  }
  renderVerifyBanner();
}

function renderVerifyBanner() {
  const banner = document.getElementById('verifyBanner');
  if (state.user && !state.user.email_verified) {
    banner.style.display = 'flex';
    banner.innerHTML = `<span>Verify your email to upload notes.</span>` +
      (state.lastVerificationUrl
        ? `<a href="${state.lastVerificationUrl}" target="_blank">Verify now</a>`
        : `<button id="resendBtn">Resend verification link</button>`);
    const resendBtn = document.getElementById('resendBtn');
    if (resendBtn) {
      resendBtn.addEventListener('click', async () => {
        try {
          const data = await api('/resend-verification', { method: 'POST' });
          if (data.verification_url) {
            state.lastVerificationUrl = data.verification_url;
            ssStore.setItem('ss_verification_url', data.verification_url);
          }
          renderVerifyBanner();
        } catch (err) { toast(err.message); }
      });
    }
  } else {
    banner.style.display = 'none';
  }
}

function logout() {
  state.token = null;
  state.user = null;
  state.lastVerificationUrl = null;
  ssStore.removeItem('ss_token');
  ssStore.removeItem('ss_user');
  ssStore.removeItem('ss_verification_url');
  renderAuthArea();
  showView('auth');
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('loginForm').style.display = tab.dataset.tab === 'login' ? 'flex' : 'none';
    document.getElementById('registerForm').style.display = tab.dataset.tab === 'register' ? 'flex' : 'none';
  });
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/login', { method: 'POST', body: { email: fd.get('email'), password: fd.get('password') } });
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById('authMsg').textContent = err.message;
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api('/register', {
      method: 'POST',
      body: { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') },
    });
    if (data.verification_url) {
      state.lastVerificationUrl = data.verification_url;
      ssStore.setItem('ss_verification_url', data.verification_url);
    }
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById('authMsg').textContent = err.message;
  }
});

function onAuthSuccess(data) {
  state.token = data.token;
  state.user = data.user;
  ssStore.setItem('ss_token', data.token);
  ssStore.setItem('ss_user', JSON.stringify(data.user));
  renderAuthArea();
  showView('browse');
}

// ---------- browse / notes ----------

function starString(avg) {
  const full = Math.round(avg);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

async function loadNotes(page = 1) {
  state.page = page;
  const q = document.getElementById('searchInput').value;
  const course_code = document.getElementById('courseInput').value;
  const tag = document.getElementById('tagInput').value;
  const sort = document.getElementById('sortSelect').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (course_code) params.set('course_code', course_code);
  if (tag) params.set('tag', tag);
  if (sort) params.set('sort', sort);
  params.set('page', page);
  params.set('page_size', 9);
  const { notes, pagination } = await api(`/notes?${params.toString()}`);
  const list = document.getElementById('notesList');
  list.innerHTML = notes.map(renderNoteCard).join('') || '<div class="empty"><strong>No notes match that search</strong>Try a different keyword, or clear the filters.</div>';
  list.querySelectorAll('.note-card').forEach((card) => {
    card.addEventListener('click', () => openNote(card.dataset.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openNote(card.dataset.id); });
  });
  renderPagination(pagination);
}

function renderPagination(p) {
  const el = document.getElementById('pagination');
  if (!p || p.total_pages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button id="prevPage" ${p.page <= 1 ? 'disabled' : ''}>&larr; Prev</button>
    <span>Page ${p.page} of ${p.total_pages} (${p.total} notes)</span>
    <button id="nextPage" ${p.page >= p.total_pages ? 'disabled' : ''}>Next &rarr;</button>
  `;
  const prev = document.getElementById('prevPage');
  const next = document.getElementById('nextPage');
  if (prev) prev.addEventListener('click', () => loadNotes(p.page - 1));
  if (next) next.addEventListener('click', () => loadNotes(p.page + 1));
}

function renderNoteCard(n) {
  const tags = (n.tags || '').split(',').filter(Boolean).map((t) => `<span class="tag-pill">${escapeHtml(t.trim())}</span>`).join('');
  const verifiedBadge = n.verified_by_faculty ? `<span class="badge-verified">${icon('check')} Faculty-verified</span>` : '';
  return `
    <article class="note-card" data-id="${n.id}" tabindex="0" style="--spine:${spineColor(n.course_code || n.subject)}">
      <div>${verifiedBadge}</div>
      <h3>${escapeHtml(n.title)}</h3>
      <div class="meta"><span class="course">${escapeHtml(n.course_code || n.subject || 'General')}</span> &middot; by ${escapeHtml(n.uploader_name)}</div>
      <div>${tags}</div>
      <div class="stats">
        <span class="stars" title="${Number(n.avg_stars || 0).toFixed(1)} out of 5">${starString(n.avg_stars)}</span><span>${n.rating_count}</span>
        <span>${icon('chat')} ${n.comment_count}</span>
        <span>${icon('eye')} ${n.views}</span>
      </div>
    </article>`;
}

document.getElementById('searchBtn').addEventListener('click', () => loadNotes(1));
document.getElementById('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadNotes(1); });
['courseInput','tagInput','sortSelect'].forEach(id => document.getElementById(id)?.addEventListener('change', () => loadNotes(1)));


async function openNote(id) {
  state.currentNoteId = id;
  const { note } = await api(`/notes/${id}`);
  const { comments } = await api(`/notes/${id}/comments`);
  const { versions } = await api(`/notes/${id}/versions`);
  const detail = document.getElementById('noteDetail');
  const tags = (note.tags || '').split(',').filter(Boolean).map((t) => `<span class="tag-pill">${escapeHtml(t.trim())}</span>`).join('');
  const verifiedBadge = note.verified_by_faculty ? `<span class="badge-verified">${icon('check')} Faculty-verified</span>` : '';
  const isStaff = state.user && ['faculty', 'moderator', 'admin'].includes(state.user.role);
  const isOwnerOrStaff = state.user && (state.user.id === note.uploader_id || isStaff);

  detail.innerHTML = `
    <div class="note-full" style="--spine:${spineColor(note.course_code || note.subject)}">
      <h2>${escapeHtml(note.title)} ${verifiedBadge}</h2>
      <div class="meta">${[note.subject, note.course_code, note.semester].filter(Boolean).map(escapeHtml).join(' &middot; ')} &middot; by ${escapeHtml(note.uploader_name || '')}</div>
      <div>${tags}</div>
      <p>${escapeHtml(note.description || '')}</p>
      <div class="rating-row" id="starRow"></div>
      <div class="action-row">
        <a href="/api/notes/${note.id}/download"><button type="button" class="primary">${icon('down')} Download (v${note.current_version})</button></a>
        <button id="bookmarkBtn">${icon('mark')} Bookmark</button>
        <button id="reportBtn">${icon('flag')} Report</button>
        ${isStaff && !note.verified_by_faculty ? `<button id="verifyBtn">${icon('check')} Mark as faculty-verified</button>` : ''}
      </div>
      <div class="version-list">
        ${versions.map((v) => `<div class="${v.version === note.current_version ? 'current' : ''}">v${v.version} — ${escapeHtml(v.file_name)} by ${escapeHtml(v.uploaded_by_name)} (${v.created_at})</div>`).join('')}
      </div>
      ${isOwnerOrStaff ? `
      <form id="versionForm" class="authform">
        <label class="field">Upload a new version of this file</label>
        <input type="file" name="file" required>
        <button type="submit">Upload new version</button>
      </form>` : ''}
      <h3>Comments (${comments.length})</h3>
      <div id="commentsList">${comments.map(renderComment).join('') || '<p class="msg">No comments yet. Be the first to say what helped.</p>'}</div>
      <form id="commentForm" class="authform">
        <textarea name="body" placeholder="Add a comment" required></textarea>
        <button type="submit">Post comment</button>
      </form>
    </div>`;

  const starRow = document.getElementById('starRow');
  for (let i = 1; i <= 5; i++) {
    const span = document.createElement('span');
    span.className = 'star' + (i <= Math.round(note.avg_stars) ? ' filled' : '');
    span.textContent = '★';
    span.addEventListener('click', () => rateNote(note.id, i));
    starRow.appendChild(span);
  }

  document.getElementById('bookmarkBtn').addEventListener('click', () => bookmarkNote(note.id));
  document.getElementById('reportBtn').addEventListener('click', () => reportNote(note.id));
  const verifyBtn = document.getElementById('verifyBtn');
  if (verifyBtn) verifyBtn.addEventListener('click', () => verifyNote(note.id));

  const versionForm = document.getElementById('versionForm');
  if (versionForm) {
    versionForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await apiUpload(`/notes/${note.id}/version`, fd);
        openNote(note.id);
      } catch (err) { toast(err.message); }
    });
  }

  document.getElementById('commentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await api(`/notes/${note.id}/comments`, { method: 'POST', body: { body: fd.get('body') } });
    openNote(note.id);
  });

  attachReplyHandlers(note.id);
  showView('note');
}

function renderComment(c) {
  const replies = (c.replies || []).map((r) => `
    <div class="comment reply-block">
      <div class="who">${escapeHtml(r.user_name)}</div>
      <div class="body">${escapeHtml(r.body)}</div>
    </div>`).join('');
  return `
    <div class="comment" data-id="${c.id}">
      <div class="who">${escapeHtml(c.user_name)}</div>
      <div class="body">${escapeHtml(c.body)}</div>
      <button class="reply-btn" data-id="${c.id}">Reply</button>
      <form class="reply-form" data-parent="${c.id}">
        <textarea placeholder="Write a reply…" required></textarea>
        <button type="submit">Post</button>
      </form>
      ${replies}
    </div>`;
}

function attachReplyHandlers(noteId) {
  document.querySelectorAll('.reply-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = document.querySelector(`.reply-form[data-parent="${btn.dataset.id}"]`);
      form.classList.toggle('active');
    });
  });
  document.querySelectorAll('.reply-form').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const textarea = form.querySelector('textarea');
      try {
        await api(`/notes/${noteId}/comments`, {
          method: 'POST',
          body: { body: textarea.value, parent_id: form.dataset.parent },
        });
        openNote(noteId);
      } catch (err) { toast(err.message); }
    });
  });
}

async function rateNote(id, stars) {
  try {
    await api(`/notes/${id}/rate`, { method: 'POST', body: { stars } });
    openNote(id);
  } catch (err) { toast(err.message); }
}

async function bookmarkNote(id) {
  try {
    await api(`/notes/${id}/bookmark`, { method: 'POST' });
    toast('Bookmarked');
  } catch (err) { toast(err.message); }
}

async function reportNote(id) {
  const reason = prompt('Why are you reporting this note?');
  if (reason === null) return;
  try {
    await api(`/notes/${id}/report`, { method: 'POST', body: { reason } });
    toast('Report sent. A moderator will review it.');
  } catch (err) { toast(err.message); }
}

async function verifyNote(id) {
  try {
    await api(`/notes/${id}/verify`, { method: 'POST' });
    openNote(id);
  } catch (err) { toast(err.message); }
}

// ---------- upload ----------

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const file = fd.get('file');
  if (!file || !file.size) {
    document.getElementById('uploadMsg').textContent = 'Please choose a file.';
    return;
  }
  const progress = document.getElementById('uploadProgress');
  progress.hidden = false;
  document.getElementById('uploadMsg').textContent = 'Uploading your notes…';
  try {
    await apiUpload('/notes', fd, 'POST', (pct) => { progress.hidden = false; progress.querySelector('span').style.width = `${pct}%`; });
    progress.hidden = true;
    progress.querySelector('span').style.width = '0%';
    document.getElementById('uploadMsg').textContent = '✓ Uploaded successfully. Your notes are now live.';
    e.target.reset();
    if (fileName) fileName.textContent = 'PDF, DOCX, PPTX, TXT, MD, JPG or PNG';
  } catch (err) {
    progress.hidden = true;
    document.getElementById('uploadMsg').textContent = err.message;
  }
});

// ---------- personal dashboard ----------

async function loadDashboard() {
  if (!state.user) return;
  document.getElementById('dashName').textContent = state.user.name.split(' ')[0];
  try {
    const data = await api('/me/stats');
    document.getElementById('personalStats').innerHTML = `
      <div class="stat-pill"><div class="num">${data.uploads}</div><div class="label">Notes uploaded</div></div>
      <div class="stat-pill"><div class="num">${data.bookmarks}</div><div class="label">Bookmarks</div></div>
      <div class="stat-pill"><div class="num">${data.comments}</div><div class="label">Comments</div></div>
      <div class="stat-pill"><div class="num">${data.views}</div><div class="label">Views on your notes</div></div>`;
    document.getElementById('myUploads').innerHTML = data.recentUploads.map(renderMiniNote).join('') || '<div class="mini-empty">No uploads yet. Share your first notes.</div>';
    document.getElementById('myBookmarks').innerHTML = data.recentBookmarks.map(renderMiniNote).join('') || '<div class="mini-empty">No bookmarks yet.</div>';
  } catch (err) { toast(err.message); }
}

function renderMiniNote(n) {
  return `<button class="mini-note" data-note-id="${n.id}" type="button"><span><strong>${escapeHtml(n.title)}</strong><small>${escapeHtml(n.course_code || n.subject || 'General')} · ${n.views} views</small></span><span class="mini-arrow">→</span></button>`;
}

document.getElementById('dashUploadBtn')?.addEventListener('click', () => showView('upload'));
document.getElementById('dashBrowseUploads')?.addEventListener('click', () => showView('browse'));
document.getElementById('dashBrowseBookmarks')?.addEventListener('click', () => showView('bookmarks'));
document.getElementById('myUploads')?.addEventListener('click', e => { const b=e.target.closest('[data-note-id]'); if(b) openNote(b.dataset.noteId); });
document.getElementById('myBookmarks')?.addEventListener('click', e => { const b=e.target.closest('[data-note-id]'); if(b) openNote(b.dataset.noteId); });

// ---------- bookmarks ----------

async function loadBookmarks() {
  const { notes } = await api('/bookmarks');
  const list = document.getElementById('bookmarksList');
  list.innerHTML = notes.map(renderNoteCard).join('') || '<div class="empty"><strong>Nothing saved yet</strong>Open a note and choose Bookmark to keep it here.</div>';
  list.querySelectorAll('.note-card').forEach((card) => {
    card.addEventListener('click', () => openNote(card.dataset.id));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openNote(card.dataset.id); });
  });
}

// ---------- notifications ----------

async function loadNotifications() {
  const { notifications } = await api('/notifications');
  const list = document.getElementById('notificationsList');
  list.innerHTML = notifications.map((n) => `<li class="${n.is_read ? '' : 'unread'}"><span>${escapeHtml(n.message)}</span><span class="when">${escapeHtml(n.created_at)}</span></li>`).join('') || '<li>You\'re all caught up.</li>';
  const unread = notifications.filter(n => !n.is_read).length; const badge = document.getElementById('notifBadge'); badge.hidden = !unread; badge.textContent = unread;
  if (unread) { try { await api('/notifications/read', {method:'POST'}); } catch {} }
}

// ---------- moderation ----------

async function loadModeration() {
  try {
    const stats = await api('/dashboard/stats');
    document.getElementById('statsBox').innerHTML = `
      <div class="stat-pill"><div class="num">${stats.totalUsers}</div><div class="label">Users</div></div>
      <div class="stat-pill"><div class="num">${stats.totalNotes}</div><div class="label">Active Notes</div></div>
      <div class="stat-pill"><div class="num">${stats.verifiedNotes}</div><div class="label">Faculty-verified</div></div>
      <div class="stat-pill"><div class="num">${stats.openReports}</div><div class="label">Open Reports</div></div>
    `;
    const { reports } = await api('/moderation/reports');
    document.getElementById('reportsList').innerHTML = reports.map((r) => `
      <div class="report-card" data-id="${r.id}">
        <strong>${escapeHtml(r.title)}</strong> reported by ${escapeHtml(r.reporter_name)}<br>
        <span style="color:var(--muted)">${escapeHtml(r.reason || 'No reason given')}</span>
        <div class="actions">
          <button class="dismiss">Dismiss</button>
          <button class="remove">Remove note</button>
        </div>
      </div>`).join('') || '<div class="empty"><strong>No open reports</strong>Nothing needs review right now.</div>';

    document.querySelectorAll('.report-card .dismiss').forEach((btn) =>
      btn.addEventListener('click', (e) => resolveReport(e.target.closest('.report-card').dataset.id, 'dismiss')));
    document.querySelectorAll('.report-card .remove').forEach((btn) =>
      btn.addEventListener('click', (e) => resolveReport(e.target.closest('.report-card').dataset.id, 'remove_note')));
  } catch (err) {
    document.getElementById('statsBox').innerHTML = `<p>${escapeHtml(err.message)}</p>`;
  }
}

async function resolveReport(id, action) {
  await api(`/moderation/reports/${id}`, { method: 'POST', body: { action } });
  loadModeration();
}

// ---------- utils ----------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- boot ----------

(async function boot() {
  // If the API can't be reached (or isn't JSON), switch to sample-data preview mode.
  try {
    if (!ssIsWeb) throw new Error('not served over http');
    const r = await fetch('/api/notes?page_size=1');
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('no api');
  } catch (e) {
    state.demo = true;
    document.body.classList.add('demo');
  }
  renderAuthArea();
  showView(state.token || state.demo ? 'browse' : 'auth');
})();
