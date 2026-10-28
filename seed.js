// seed.js
// Populates the database with a moderator, a faculty account, a couple of
// student accounts, and a handful of sample notes — so the app isn't empty
// on first run and evaluators don't need to create a moderator by hand.
//
// Usage:  node seed.js            (safe to re-run; skips existing users)

const db = require('./db');
const storage = require('./storage');
const { hashPassword, generateVerificationToken } = require('./auth');

function upsertUser(name, email, password, role) {
  const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existing) return existing;
  const { hash, salt } = hashPassword(password);
  const info = db.prepare(
    `INSERT INTO users (name, email, password_hash, salt, role, email_verified, verification_token)
     VALUES (?, ?, ?, ?, ?, 1, NULL)`
  ).run(name, email, hash, salt, role);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function insertNote({ uploader, title, subject, course_code, semester, tags, description, filename, content }) {
  const existing = db.prepare('SELECT id FROM notes WHERE title = ? AND uploader_id = ?').get(title, uploader.id);
  if (existing) return existing.id;
  const safeName = `seed_${Date.now()}_${Math.random().toString(16).slice(2)}_${filename}`;
  storage.save(Buffer.from(content, 'utf8'), safeName);
  const info = db.prepare(
    `INSERT INTO notes (uploader_id, title, subject, course_code, semester, tags, file_name, file_path, description, current_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(uploader.id, title, subject, course_code, semester, tags, filename, safeName, description);
  db.prepare(
    'INSERT INTO note_versions (note_id, version, file_name, file_path, uploaded_by) VALUES (?, 1, ?, ?, ?)'
  ).run(info.lastInsertRowid, filename, safeName, uploader.id);
  return info.lastInsertRowid;
}

console.log('Seeding StudyShare sample data...\n');

const moderator = upsertUser('Moderator Admin', 'admin@studyshare.local', 'Admin@1234', 'moderator');
const faculty = upsertUser('Dr. Nair', 'faculty@studyshare.local', 'Faculty@1234', 'faculty');
const asha = upsertUser('Asha Menon', 'asha@studyshare.local', 'Student@1234', 'student');
const rahul = upsertUser('Rahul Varma', 'rahul@studyshare.local', 'Student@1234', 'student');

const notes = [
  {
    uploader: asha,
    title: 'Operating Systems — CPU Scheduling Algorithms',
    subject: 'Operating Systems',
    course_code: 'CS301',
    semester: 'Sem 5',
    tags: 'os,scheduling,fcfs,round-robin',
    description: 'Summary of FCFS, SJF, Priority and Round Robin scheduling with worked examples.',
    filename: 'os_cpu_scheduling.txt',
    content:
`CPU Scheduling Algorithms — Quick Notes

1. FCFS (First Come First Served)
   - Simplest algorithm, non-preemptive.
   - Suffers from the convoy effect.

2. SJF (Shortest Job First)
   - Optimal average waiting time, but requires knowing burst time in advance.
   - Preemptive version: Shortest Remaining Time First.

3. Priority Scheduling
   - Each process assigned a priority; lower number = higher priority (convention varies).
   - Risk: starvation — mitigated with aging.

4. Round Robin
   - Each process gets a fixed time quantum.
   - Good for time-sharing systems; quantum size affects performance significantly.

Example: Processes P1(burst 5), P2(burst 3), P3(burst 8) arriving at t=0.
FCFS order P1,P2,P3 -> avg waiting time = (0 + 5 + 8)/3 = 4.33
`,
  },
  {
    uploader: asha,
    title: 'DBMS — Normalization (1NF to BCNF)',
    subject: 'Database Management Systems',
    course_code: 'CS302',
    semester: 'Sem 5',
    tags: 'dbms,normalization,bcnf',
    description: 'Step-by-step explanation of normal forms with an example relation.',
    filename: 'dbms_normalization.txt',
    content:
`Normalization — 1NF through BCNF

1NF: Atomic values only, no repeating groups.
2NF: 1NF + no partial dependency on a composite key.
3NF: 2NF + no transitive dependency on non-key attributes.
BCNF: For every functional dependency X -> Y, X must be a super key.

Worked example:
StudentCourse(StudentID, CourseID, StudentName, CourseName, Instructor)
- StudentName depends only on StudentID (partial dependency) -> violates 2NF.
- Decompose into Student(StudentID, StudentName) and
  Course(CourseID, CourseName, Instructor) and
  Enrollment(StudentID, CourseID).
`,
  },
  {
    uploader: rahul,
    title: 'Computer Networks — OSI vs TCP/IP Model',
    subject: 'Computer Networks',
    course_code: 'CS303',
    semester: 'Sem 6',
    tags: 'networks,osi,tcpip',
    description: 'Layer-by-layer comparison with protocol examples at each layer.',
    filename: 'networks_osi_tcpip.txt',
    content:
`OSI Model (7 layers) vs TCP/IP Model (4 layers)

OSI: Physical, Data Link, Network, Transport, Session, Presentation, Application
TCP/IP: Network Access, Internet, Transport, Application

Key protocol examples:
- Network/Internet layer: IP, ICMP, ARP
- Transport layer: TCP, UDP
- Application layer: HTTP, FTP, DNS, SMTP

TCP/IP merges Session+Presentation+Application into one Application layer,
and Physical+Data Link into one Network Access layer.
`,
  },
  {
    uploader: rahul,
    title: 'Data Structures — Binary Search Tree Operations',
    subject: 'Data Structures',
    course_code: 'CS201',
    semester: 'Sem 3',
    tags: 'dsa,bst,trees',
    description: 'Insertion, deletion (3 cases) and traversal pseudocode for BSTs.',
    filename: 'dsa_bst.txt',
    content:
`Binary Search Tree — Core Operations

Insertion: recurse left if value < node.value, else right; insert at null leaf.

Deletion — 3 cases:
1. Leaf node: simply remove it.
2. One child: replace node with its child.
3. Two children: replace node's value with its in-order successor
   (smallest value in right subtree), then delete that successor.

Traversals:
- In-order (left, root, right) -> sorted order for a BST
- Pre-order (root, left, right)
- Post-order (left, right, root)

Average time complexity: O(log n) for balanced trees, O(n) worst case (skewed tree).
`,
  },
  {
    uploader: faculty,
    title: 'Software Engineering — SDLC Models Overview',
    subject: 'Software Engineering',
    course_code: 'CS304',
    semester: 'Sem 6',
    tags: 'sdlc,agile,waterfall',
    description: 'Faculty-prepared comparison of Waterfall, Incremental, Spiral and Agile models.',
    filename: 'se_sdlc_models.txt',
    content:
`SDLC Models — Overview

Waterfall: Sequential phases (Requirements -> Design -> Implementation -> Testing -> Maintenance).
  Best for well-understood, stable requirements.

Incremental: Build the system in increments, each adding functionality.

Spiral: Combines iterative development with risk analysis at each loop.

Agile: Iterative, incremental, customer-collaboration-focused (Scrum, Kanban, XP).
  Favors adapting to changing requirements over following a rigid plan.

Choosing a model depends on requirement stability, project size, and risk tolerance.
`,
  },
];

const noteIds = {};
for (const n of notes) {
  const id = insertNote(n);
  noteIds[n.title] = id;
  console.log(`  note: ${n.title} (id=${id})`);
}

// A few ratings and comments so the Browse page isn't empty-looking.
function rate(noteId, user, stars) {
  db.prepare(
    `INSERT INTO ratings (note_id, user_id, stars) VALUES (?, ?, ?)
     ON CONFLICT(note_id, user_id) DO UPDATE SET stars = excluded.stars`
  ).run(noteId, user.id, stars);
}
function comment(noteId, user, body) {
  const existing = db.prepare('SELECT id FROM comments WHERE note_id = ? AND user_id = ? AND body = ?').get(noteId, user.id, body);
  if (!existing) db.prepare('INSERT INTO comments (note_id, user_id, body) VALUES (?, ?, ?)').run(noteId, user.id, body);
}

const osNoteId = noteIds['Operating Systems — CPU Scheduling Algorithms'];
const dbmsNoteId = noteIds['DBMS — Normalization (1NF to BCNF)'];
const seNoteId = noteIds['Software Engineering — SDLC Models Overview'];

rate(osNoteId, rahul, 5);
rate(osNoteId, faculty, 4);
comment(osNoteId, rahul, 'The worked example really helped, thanks!');
rate(dbmsNoteId, rahul, 4);
comment(dbmsNoteId, faculty, 'Good summary — consider adding a 4NF example next time.');

// Mark one note as faculty-verified to showcase the badge.
db.prepare('UPDATE notes SET verified_by_faculty = 1, verified_by = ? WHERE id = ?').run(faculty.id, seNoteId);

console.log('\nSeed accounts (all pre-verified):');
console.log('  Moderator: admin@studyshare.local / Admin@1234');
console.log('  Faculty:   faculty@studyshare.local / Faculty@1234');
console.log('  Student:   asha@studyshare.local / Student@1234');
console.log('  Student:   rahul@studyshare.local / Student@1234');
console.log('\nDone.');
