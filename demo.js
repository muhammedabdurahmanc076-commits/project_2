// Safe storage: pages opened from content:// or file:// can throw on localStorage access.
const ssStore = (() => {
  try { const s = window.localStorage; s.getItem('ss_probe'); return s; }
  catch (e) {
    const m = {};
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
  }
})();
const ssIsWeb = /^https?:$/.test(location.protocol);

// demo.js — sample data used only when the backend can't be reached (preview mode).
const DEMO = {
  bookmarks: new Set([2]),
  notes: [
    { id: 1, title: 'CPU scheduling: FCFS, SJF, Round Robin', subject: 'Operating Systems', course_code: 'CS301', semester: 'S5', tags: 'scheduling,unit-2,exam', description: 'Worked Gantt charts for every algorithm, with waiting-time tables and the usual exam traps.', uploader_id: 3, uploader_name: 'Asha K', verified_by_faculty: 1, avg_stars: 4.6, rating_count: 18, comment_count: 2, views: 412, current_version: 2 },
    { id: 2, title: 'Normalization made simple (1NF to BCNF)', subject: 'Database Management', course_code: 'CS303', semester: 'S5', tags: 'dbms,normalization', description: 'One running example taken from 1NF all the way to BCNF, plus 10 practice decompositions.', uploader_id: 4, uploader_name: 'Rahul M', verified_by_faculty: 0, avg_stars: 4.2, rating_count: 9, comment_count: 1, views: 268, current_version: 1 },
    { id: 3, title: 'OSI vs TCP/IP: one-page cheat sheet', subject: 'Computer Networks', course_code: 'CS305', semester: 'S5', tags: 'networking,cheatsheet', description: 'Layer by layer comparison with protocols, PDUs and port numbers.', uploader_id: 3, uploader_name: 'Asha K', verified_by_faculty: 0, avg_stars: 3.8, rating_count: 6, comment_count: 0, views: 190, current_version: 1 },
    { id: 4, title: 'Trees and graphs: traversal patterns', subject: 'Data Structures', course_code: 'CS201', semester: 'S3', tags: 'trees,graphs,bfs,dfs', description: 'BFS/DFS templates in C and Java, with complexity notes and common interview variants.', uploader_id: 4, uploader_name: 'Rahul M', verified_by_faculty: 0, avg_stars: 4.9, rating_count: 22, comment_count: 3, views: 530, current_version: 1 },
    { id: 5, title: 'Software engineering: SDLC models compared', subject: 'Software Engineering', course_code: 'CS309', semester: 'S6', tags: 'sdlc,agile,exam', description: 'Waterfall, spiral, V-model and agile side by side, verified by faculty against the syllabus.', uploader_id: 2, uploader_name: 'Dr. Nair', verified_by_faculty: 1, avg_stars: 4.4, rating_count: 12, comment_count: 1, views: 301, current_version: 1 },
  ],
  comments: [
    { id: 1, user_name: 'Rahul M', body: 'The Round Robin example finally made quantum size click for me.', replies: [{ user_name: 'Asha K', body: 'Glad it helped! I added the SJF preemptive case in v2.' }] },
    { id: 2, user_name: 'Nisha P', body: 'Could you add a few more practice problems for priority scheduling?', replies: [] },
  ],
};

function demoApi(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const [route, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');
  const body = options.body || {};
  const m = route.match(/^\/notes\/(\d+)(?:\/(\w+))?$/);
  const note = m && DEMO.notes.find((n) => n.id === Number(m[1]));
  const ok = (d) => Promise.resolve(d);

  if (route === '/login' || route === '/register') {
    const email = body.email || 'student@studyshare.local';
    const role = /admin/.test(email) ? 'moderator' : /faculty/.test(email) ? 'faculty' : 'student';
    return ok({ token: 'demo', user: { id: 3, name: body.name || email.split('@')[0], role, email_verified: 1 } });
  }
  if (route === '/notes' && method === 'GET') {
    let list = DEMO.notes.slice();
    const q = (params.get('q') || '').toLowerCase(), cc = (params.get('course_code') || '').toLowerCase(), tag = (params.get('tag') || '').toLowerCase();
    if (q) list = list.filter((n) => (n.title + n.description + n.subject).toLowerCase().includes(q));
    if (cc) list = list.filter((n) => n.course_code.toLowerCase().includes(cc));
    if (tag) list = list.filter((n) => n.tags.toLowerCase().includes(tag));
    if (params.get('sort') === 'top_rated') list.sort((a, b) => b.avg_stars - a.avg_stars);
    if (params.get('sort') === 'most_viewed') list.sort((a, b) => b.views - a.views);
    return ok({ notes: list, pagination: { page: 1, total_pages: 1, total: list.length } });
  }
  if (note && !m[2]) return ok({ note });
  if (note && m[2] === 'comments') {
    if (method === 'POST') { DEMO.comments.push({ id: Date.now(), user_name: state.user ? state.user.name : 'You', body: body.body, replies: [] }); return ok({ ok: true }); }
    return ok({ comments: DEMO.comments });
  }
  if (note && m[2] === 'versions') return ok({ versions: Array.from({ length: note.current_version }, (_, i) => ({ version: note.current_version - i, file_name: `${note.course_code}-notes-v${note.current_version - i}.pdf`, uploaded_by_name: note.uploader_name, created_at: i ? '2026-09-02' : '2026-10-11' })) });
  if (note && m[2] === 'bookmark') { method === 'DELETE' ? DEMO.bookmarks.delete(note.id) : DEMO.bookmarks.add(note.id); return ok({ ok: true }); }
  if (note && m[2] === 'rate') { note.avg_stars = (note.avg_stars * note.rating_count + body.stars) / (note.rating_count + 1); note.rating_count++; return ok({ ok: true }); }
  if (note && m[2] === 'verify') { note.verified_by_faculty = 1; return ok({ ok: true }); }
  if (route === '/bookmarks') return ok({ notes: DEMO.notes.filter((n) => DEMO.bookmarks.has(n.id)) });
  if (route === '/notifications') return ok({ notifications: [
    { message: 'New note in CS301: “CPU scheduling: FCFS, SJF, Round Robin” (v2)', created_at: '2 hours ago' },
    { message: 'Rahul M replied to your comment on “Trees and graphs”', created_at: 'Yesterday' },
    { message: 'Dr. Nair verified your note “OSI vs TCP/IP”', created_at: '3 days ago' } ] });
  if (route === '/me/stats') { const mine = DEMO.notes.filter(n => n.uploader_id === (state.user?.id || 3)); return ok({ uploads: mine.length, bookmarks: DEMO.bookmarks.size, comments: 7, views: mine.reduce((a,n)=>a+(n.views||0),0), recentUploads: mine.slice(0,3), recentBookmarks: DEMO.notes.filter(n => DEMO.bookmarks.has(n.id)) }); }
  if (route === '/notifications/read') return ok({ ok: true });
  if (route === '/dashboard/stats') return ok({ totalUsers: 128, totalNotes: 342, verifiedNotes: 57, openReports: 2 });
  if (route === '/moderation/reports') return ok({ reports: [
    { id: 1, title: 'Old exam paper (2019)', reporter_name: 'Nisha P', reason: 'Looks like a copy of a university-owned paper.' },
    { id: 2, title: 'Trees and graphs: traversal patterns', reporter_name: 'Arjun S', reason: 'The DFS example has a bug on slide 4.' } ] });
  return ok({ ok: true, verification_url: null });
}


function demoUpload(formData) {
  const title = formData.get('title') || 'Untitled notes';
  const subject = formData.get('subject') || 'General';
  const course_code = formData.get('course_code') || 'GEN101';
  const semester = formData.get('semester') || 'S5';
  const tags = formData.get('tags') || 'notes,shared';
  const description = formData.get('description') || 'Uploaded in frontend preview mode.';
  const file = formData.get('file');
  const id = Math.max(...DEMO.notes.map(n => n.id), 0) + 1;
  const note = { id, title, subject, course_code, semester, tags, description, uploader_id: 3, uploader_name: state.user?.name || 'Demo Student', verified_by_faculty: 0, avg_stars: 0, rating_count: 0, comment_count: 0, views: 0, current_version: 1, file_name: file?.name || 'notes.pdf' };
  DEMO.notes.unshift(note);
  try { ssStore.setItem('ss_demo_notes', JSON.stringify(DEMO.notes)); } catch {}
  return Promise.resolve({ ok: true, note });
}

function restoreDemoData() {
  try {
    const saved = JSON.parse(ssStore.getItem('ss_demo_notes') || 'null');
    if (Array.isArray(saved) && saved.length) DEMO.notes = saved;
  } catch {}
}
restoreDemoData();
