// app.js — StudyShare frontend (vanilla JS, no build step required)

const state = {
  token: localStorage.getItem('ss_token') || null,
  user: JSON.parse(localStorage.getItem('ss_user') || 'null'),
  currentNoteId: null,
  page: 1,
  lastVerificationUrl: localStorage.getItem('ss_verification_url') || null,
};

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// For file uploads: send as multipart/form-data (no base64 inflation).
// Do NOT set Content-Type manually — the browser sets it with the boundary.
async function apiUpload(path, formData, method = 'POST') {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { ...authHeaders() },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- view switching ----------

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${name}`).classList.add('active');
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name === 'browse') loadNotes();
  if (name === 'bookmarks') loadBookmarks();
  if (name === 'notifications') loadNotifications();
  if (name === 'moderation') loadModeration();
}

document.getElementById('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('.navbtn');
  if (!btn) return;
  if (!state.token) { renderAuthArea(); showView('auth'); return; }
  showView(btn.dataset.view);
});

document.getElementById('backToBrowse').addEventListener('click', () => showView('browse'));

// ---------- auth ----------

function renderAuthArea() {
  const el = document.getElementById('authArea');
  if (state.user) {
    el.innerHTML = `<span>${escapeHtml(state.user.name)} (${escapeHtml(state.user.role)})</span> <button id="logoutBtn">Log out</button>`;
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.querySelector('.mod-only').style.display =
      (state.user.role === 'moderator' || state.user.role === 'admin') ? 'inline-block' : 'none';
  } else {
    el.innerHTML = `<button id="loginNavBtn">Login / Register</button>`;
    document.getElementById('loginNavBtn').addEventListener('click', () => showView('auth'));
  }
  renderVerifyBanner();
}

function renderVerifyBanner() {
  const banner = document.getElementById('verifyBanner');
  if (state.user && !state.user.email_verified) {
    banner.style.display = 'flex';
    banner.innerHTML = `<span>⚠️ Verify your email to upload notes.</span>` +
      (state.lastVerificationUrl
        ? `<a href="${state.lastVerificationUrl}" target="_blank">Click to verify</a>`
        : `<button id="resendBtn">Resend verification link</button>`);
    const resendBtn = document.getElementById('resendBtn');
    if (resendBtn) {
      resendBtn.addEventListener('click', async () => {
        try {
          const data = await api('/resend-verification', { method: 'POST' });
          if (data.verification_url) {
            state.lastVerificationUrl = data.verification_url;
            localStorage.setItem('ss_verification_url', data.verification_url);
          }
          renderVerifyBanner();
        } catch (err) { alert(err.message); }
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
  localStorage.removeItem('ss_token');
  localStorage.removeItem('ss_user');
  localStorage.removeItem('ss_verification_url');
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
      localStorage.setItem('ss_verification_url', data.verification_url);
    }
    onAuthSuccess(data);
  } catch (err) {
    document.getElementById('authMsg').textContent = err.message;
  }
});

function onAuthSuccess(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('ss_token', data.token);
  localStorage.setItem('ss_user', JSON.stringify(data.user));
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
  list.innerHTML = notes.map(renderNoteCard).join('') || '<p>No notes found.</p>';
  list.querySelectorAll('.note-card').forEach((card) => {
    card.addEventListener('click', () => openNote(card.dataset.id));
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
  const verifiedBadge = n.verified_by_faculty ? `<span class="badge-verified">✓ Faculty-verified</span>` : '';
  return `
    <div class="note-card" data-id="${n.id}">
      <h3>${escapeHtml(n.title)} ${verifiedBadge}</h3>
      <div class="meta">${escapeHtml(n.course_code || n.subject || '')} · by ${escapeHtml(n.uploader_name)}</div>
      <div>${tags}</div>
      <div class="stats">
        <span>${starString(n.avg_stars)} (${n.rating_count})</span>
        <span>💬 ${n.comment_count}</span>
        <span>👁 ${n.views}</span>
      </div>
    </div>`;
}

document.getElementById('searchBtn').addEventListener('click', () => loadNotes(1));

async function openNote(id) {
  state.currentNoteId = id;
  const { note } = await api(`/notes/${id}`);
  const { comments } = await api(`/notes/${id}/comments`);
  const { versions } = await api(`/notes/${id}/versions`);
  const detail = document.getElementById('noteDetail');
  const tags = (note.tags || '').split(',').filter(Boolean).map((t) => `<span class="tag-pill">${escapeHtml(t.trim())}</span>`).join('');
  const verifiedBadge = note.verified_by_faculty ? `<span class="badge-verified">✓ Faculty-verified</span>` : '';
  const isStaff = state.user && ['faculty', 'moderator', 'admin'].includes(state.user.role);
  const isOwnerOrStaff = state.user && (state.user.id === note.uploader_id || isStaff);

  detail.innerHTML = `
    <div class="note-full">
      <h2>${escapeHtml(note.title)} ${verifiedBadge}</h2>
      <div class="meta">${escapeHtml(note.subject || '')} · ${escapeHtml(note.course_code || '')} · ${escapeHtml(note.semester || '')}</div>
      <div>${tags}</div>
      <p>${escapeHtml(note.description || '')}</p>
      <div class="rating-row" id="starRow"></div>
      <div class="action-row">
        <a href="/api/notes/${note.id}/download"><button type="button">⬇ Download (v${note.current_version})</button></a>
        <button id="bookmarkBtn">🔖 Bookmark</button>
        <button id="reportBtn">🚩 Report</button>
        ${isStaff && !note.verified_by_faculty ? '<button id="verifyBtn">✓ Mark as faculty-verified</button>' : ''}
      </div>
      <div class="version-list">
        ${versions.map((v) => `<div class="${v.version === note.current_version ? 'current' : ''}">v${v.version} — ${escapeHtml(v.file_name)} by ${escapeHtml(v.uploaded_by_name)} (${v.created_at})</div>`).join('')}
      </div>
      ${isOwnerOrStaff ? `
      <form id="versionForm" class="authform">
        <label style="font-size:0.85rem;color:var(--muted)">Upload a new version of this file:</label>
        <input type="file" name="file" required>
        <button type="submit">Upload new version</button>
      </form>` : ''}
      <h3>Comments (${comments.length})</h3>
      <div id="commentsList">${comments.map(renderComment).join('') || '<p>No comments yet.</p>'}</div>
      <form id="commentForm" class="authform">
        <textarea name="body" placeholder="Add a comment…" required></textarea>
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
      } catch (err) { alert(err.message); }
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
      } catch (err) { alert(err.message); }
    });
  });
}

async function rateNote(id, stars) {
  try {
    await api(`/notes/${id}/rate`, { method: 'POST', body: { stars } });
    openNote(id);
  } catch (err) { alert(err.message); }
}

async function bookmarkNote(id) {
  try {
    await api(`/notes/${id}/bookmark`, { method: 'POST' });
    alert('Bookmarked!');
  } catch (err) { alert(err.message); }
}

async function reportNote(id) {
  const reason = prompt('Why are you reporting this note?');
  if (reason === null) return;
  try {
    await api(`/notes/${id}/report`, { method: 'POST', body: { reason } });
    alert('Report submitted. A moderator will review it.');
  } catch (err) { alert(err.message); }
}

async function verifyNote(id) {
  try {
    await api(`/notes/${id}/verify`, { method: 'POST' });
    openNote(id);
  } catch (err) { alert(err.message); }
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
  try {
    await apiUpload('/notes', fd);
    document.getElementById('uploadMsg').textContent = 'Uploaded successfully!';
    e.target.reset();
  } catch (err) {
    document.getElementById('uploadMsg').textContent = err.message;
  }
});

// ---------- bookmarks ----------

async function loadBookmarks() {
  const { notes } = await api('/bookmarks');
  const list = document.getElementById('bookmarksList');
  list.innerHTML = notes.map(renderNoteCard).join('') || '<p>No bookmarks yet.</p>';
  list.querySelectorAll('.note-card').forEach((card) => {
    card.addEventListener('click', () => openNote(card.dataset.id));
  });
}

// ---------- notifications ----------

async function loadNotifications() {
  const { notifications } = await api('/notifications');
  const list = document.getElementById('notificationsList');
  list.innerHTML = notifications.map((n) => `<li>${escapeHtml(n.message)} <span style="color:var(--muted)">— ${n.created_at}</span></li>`).join('') || '<li>No notifications.</li>';
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
      </div>`).join('') || '<p>No open reports.</p>';

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

renderAuthArea();
if (state.token) {
  showView('browse');
} else {
  showView('auth');
}
