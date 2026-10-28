# StudyShare — Student Notes Sharing Platform

A full-stack web app where students upload, organize, search, rate, comment on,
and bookmark study notes, with a moderation workflow for reported content.

Built with **zero external npm packages** — just Node.js's built-in `http` and
`node:sqlite` modules on the backend, and vanilla HTML/CSS/JS on the frontend.
This means `npm install` is not required; it runs anywhere Node 22+ is installed.

## Requirements

- Node.js **v22.5+** (for the built-in `node:sqlite` module). Check with `node -v`.

## Running it

```bash
cd studyshare
node server.js
```

Then open **http://localhost:3000** in your browser.

The first run creates `studyshare.db` (SQLite file) and an `uploads/` folder
automatically — no extra setup needed.

## Creating a moderator/admin account

New registrations default to the `student` role. To promote a user to
moderator (so they can see the Moderation dashboard and resolve reports),
run this after they've registered:

```bash
node -e "
const db = require('./db');
db.prepare('UPDATE users SET role = ? WHERE email = ?').run('moderator', 'someone@example.com');
console.log('done');
"
```

## Project structure

```
studyshare/
├── server.js        # HTTP server + all REST API routes
├── db.js            # SQLite schema & connection (node:sqlite)
├── auth.js          # password hashing + session tokens
├── uploads/          # uploaded note files (created at runtime)
├── studyshare.db     # SQLite database file (created at runtime)
└── public/           # frontend (served as static files)
    ├── index.html
    ├── style.css
    └── app.js
```

## Modules implemented

| Module                     | Where |
|-----------------------------|-------|
| User Management (register/login, roles) | `/api/register`, `/api/login` |
| Notes Upload (file, subject, course, tags) | `/api/notes` (POST) |
| Search & Filter | `/api/notes?q=&course_code=&tag=&sort=` |
| Rating & Review (stars, comments) | `/api/notes/:id/rate`, `/api/notes/:id/comments` |
| Moderation (report, review, remove) | `/api/notes/:id/report`, `/api/moderation/reports` |
| Bookmark & Follow | `/api/notes/:id/bookmark`, `/api/follow` |
| Notifications | `/api/notifications` |
| Dashboard & Analytics | `/api/dashboard/stats` |
| Authentication & Security | scrypt password hashing, bearer-token sessions, role-based access control |

## API quick reference

```
POST   /api/register              { name, email, password }
POST   /api/login                 { email, password }
GET    /api/notes                 ?q=&subject=&course_code=&tag=&sort=top_rated|most_viewed
POST   /api/notes                 { title, subject, course_code, semester, tags, description, file_name, file_base64 }  [auth]
GET    /api/notes/:id
GET    /api/notes/:id/download
POST   /api/notes/:id/rate        { stars: 1-5 }                                   [auth]
GET    /api/notes/:id/comments
POST   /api/notes/:id/comments    { body }                                          [auth]
POST   /api/notes/:id/bookmark                                                       [auth]
DELETE /api/notes/:id/bookmark                                                       [auth]
POST   /api/notes/:id/report      { reason }                                        [auth]
POST   /api/follow                { course_code }                                    [auth]
GET    /api/bookmarks                                                                [auth]
GET    /api/notifications                                                            [auth]
GET    /api/moderation/reports                                                       [moderator]
POST   /api/moderation/reports/:id { action: "remove_note" | "dismiss" }             [moderator]
GET    /api/dashboard/stats                                                           [moderator]
```

Auth routes marked `[auth]` expect `Authorization: Bearer <token>` (the token
returned from `/api/register` or `/api/login`).

## Notes on scaling this to production

This implementation prioritizes zero dependencies so it runs anywhere.
For a production deployment you'd typically swap in:
- Express (or similar) for routing
- A dedicated multipart/form-data parser for file uploads
- PostgreSQL/MongoDB instead of SQLite, for concurrent write-heavy workloads
- JWT with expiry + refresh tokens instead of opaque session tokens
- Cloud storage (S3 etc.) instead of local disk for uploaded files
