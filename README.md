# StudyShare — Student Notes Sharing Platform

A full-stack web app where students upload, organize, search, rate, comment on,
and bookmark study notes, with faculty verification and a moderation workflow
for reported content.

Built with **zero external npm packages** — just Node.js's built-in `http` and
`node:sqlite` modules on the backend, and vanilla HTML/CSS/JS on the frontend.
`npm install` is not required; it runs anywhere Node 22.5+ is installed.

## Requirements

- Node.js **v22.5+** (for the built-in `node:sqlite` module). Check with `node -v`.

## Quick start (with sample data)

```bash
cd studyshare
node seed.js      # creates sample accounts + 5 sample notes (safe to re-run)
node server.js
```

Open **http://localhost:3000**.

### Seed accounts (all pre-verified, ready to log in with)

| Role       | Email                        | Password       |
|------------|-------------------------------|----------------|
| Moderator  | admin@studyshare.local         | Admin@1234     |
| Faculty    | faculty@studyshare.local       | Faculty@1234   |
| Student    | asha@studyshare.local          | Student@1234   |
| Student    | rahul@studyshare.local         | Student@1234   |

The seed also creates 5 sample notes (OS scheduling, DBMS normalization,
networking, data structures, and a faculty-verified SE notes file), with a
few sample ratings and comments already in place so the Browse page isn't
empty on first run.

To run without sample data, just skip `node seed.js` and run `node server.js`
directly — the database and uploads folder are created automatically.

## Configuration

Copy `.env.example` to `.env` to override any default (see that file for all
options): port, session lifetime, max upload size, allowed file extensions,
rate-limit thresholds, and the data directory.

## Running with Docker

```bash
docker compose up --build
```

This builds the zero-dependency image and persists the database + uploads in
a named volume (`studyshare_data`), mounted at `/app/data` via `DATA_DIR`.

## Project structure

```
studyshare/
├── server.js          # HTTP server + all REST API routes
├── db.js              # SQLite schema, migrations & connection (node:sqlite)
├── auth.js            # password hashing + session tokens (with expiry)
├── config.js          # .env loader + centralized settings
├── validation.js       # input validation & sanitization
├── rateLimiter.js      # in-memory sliding-window rate limiter
├── storage.js          # file storage abstraction (local disk; S3-ready)
├── multipart.js         # multipart/form-data parser (no "multer" needed)
├── seed.js             # sample accounts + sample notes
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── uploads/             # uploaded note files (created at runtime)
├── studyshare.db        # SQLite database file (created at runtime)
└── public/               # frontend (served as static files)
    ├── index.html     # self-contained: CSS + JS are inlined, so it also works on its own
    ├── style.css      # same styles as in index.html (kept for easy editing)
    ├── app.js         # frontend logic (uses the API, or demo mode if there's no backend)
    └── demo.js        # sample data + fake API used by preview (no-backend) mode
```

## Frontend-only preview (no backend needed)

The frontend works without the server. If the API can't be reached, or the
page is opened as a plain file (`file://`, or `content://` on Android), it
switches to **preview mode** (no badge is shown) and the
app runs on the 5 sample notes from `public/demo.js`. Browsing, search, ratings,
comments, bookmarks and uploads all work, and demo uploads are kept in the
browser's storage when it allows that (otherwise just for the current visit).
Logins and uploads in preview mode are not real and nothing is sent anywhere.

Ways to open it:

- **On a computer:** open `public/index.html` in any browser, or run
  `node server.js` for the real app.
- **On a phone:** extract the zip first, then open `public/index.html` in
  Chrome. Do **not** open it from inside a zip viewer such as ZArchiver: only
  that one file is passed to the browser, so `app.js`, `demo.js` and
  `style.css` can't load and the Browse page stays empty. `index.html` has
  everything built in, so once it is extracted or saved as a normal file it
  works on its own.

## Modules implemented

| Module                                   | Where |
|--------------------------------------------|-------|
| User Management (register/login, roles, email verification) | `/api/register`, `/api/login`, `/api/verify-email`, `/api/resend-verification` |
| Notes Upload (multipart file, subject, course, tags) | `POST /api/notes` |
| Note Versioning (re-upload a new file revision, keep history) | `POST /api/notes/:id/version`, `GET /api/notes/:id/versions` |
| Search, Filter & Relevance Ranking | `GET /api/notes?q=&course_code=&tag=&sort=` |
| Pagination | `GET /api/notes?page=&page_size=` |
| Rating & Threaded Comments | `/api/notes/:id/rate`, `/api/notes/:id/comments` (supports `parent_id` replies) |
| Faculty Verification ("verified" badge) | `POST /api/notes/:id/verify` (faculty/moderator/admin only) |
| Moderation (report, review, remove) | `/api/notes/:id/report`, `/api/moderation/reports` |
| Bookmark & Follow | `/api/notes/:id/bookmark`, `/api/follow` |
| Notifications | `/api/notifications` |
| Dashboard & Analytics | `/api/dashboard/stats` |
| Security | scrypt password hashing, bearer-token sessions with expiry, RBAC, rate limiting, input validation, file type/size allow-listing, security headers |

## Roles

- `student` (default on registration)
- `faculty` — can mark notes as faculty-verified
- `moderator` / `admin` — can do everything faculty can, plus resolve reports and view the dashboard

Promote a user with:

```bash
node -e "
const db = require('./db');
db.prepare('UPDATE users SET role = ? WHERE email = ?').run('faculty', 'someone@example.com');
"
```

(or `'moderator'` instead of `'faculty'`).

## Security notes

- **Passwords**: hashed with scrypt + a random salt per user (never stored in plaintext).
- **Sessions**: opaque bearer tokens, expiring after `SESSION_TTL_DAYS` (default 7 days), swept automatically.
- **Rate limiting**: failed logins and registrations are throttled per IP (in-memory sliding window — for a multi-process production deployment, back this with Redis instead). Successful logins never count against the limit.
- **Input validation**: email format, password strength (8+ chars, letter + number), text length caps, tag sanitization.
- **File uploads**: restricted to an allow-list of extensions and a max size (both configurable), sent as real `multipart/form-data` (not base64, which would inflate payloads ~33%).
- **CSRF**: not applicable — this API authenticates via `Authorization: Bearer <token>`, never cookies, so a cross-site request can't carry credentials automatically.
- **Email verification**: since this environment has no outbound network access, "sending" an email just logs the verification link to the server console and returns it in the API response (clearly labeled as a dev-mode stand-in). Swap in a real provider (SendGrid, SES, etc.) for production — nothing else in the code needs to change beyond that one `console.log` call in `server.js`.

## Production scaling notes

A few things are intentionally simplified for a zero-dependency, easy-to-run
academic project. Each is already isolated behind a small module so swapping
it out doesn't require touching the rest of the codebase:

- **Database**: SQLite (`db.js`) is great for a single-process demo but not for
  concurrent write-heavy production traffic — swap for PostgreSQL/MongoDB behind the same `db.js` interface.
- **File storage**: local disk (`storage.js`) — swap for S3/GCS/Azure Blob; the
  file already includes a commented-out example.
- **Sessions**: opaque tokens in SQLite — swap for JWT with refresh tokens if you need stateless horizontal scaling.
- **Rate limiter**: in-memory — swap for Redis if you run more than one server process.

## API quick reference

```
POST   /api/register                { name, email, password }
POST   /api/login                   { email, password }
GET    /api/verify-email?token=...
POST   /api/resend-verification                                                      [auth]
GET    /api/notes                   ?q=&subject=&course_code=&tag=&sort=top_rated|most_viewed&page=&page_size=
POST   /api/notes                   multipart/form-data: title, subject, course_code, semester, tags, description, file   [auth, verified]
GET    /api/notes/:id
GET    /api/notes/:id/download
POST   /api/notes/:id/version       multipart/form-data: file                        [auth: uploader or staff]
GET    /api/notes/:id/versions
POST   /api/notes/:id/verify                                                          [faculty/moderator/admin]
POST   /api/notes/:id/rate          { stars: 1-5 }                                    [auth]
GET    /api/notes/:id/comments
POST   /api/notes/:id/comments      { body, parent_id? }                              [auth]
POST   /api/notes/:id/bookmark                                                        [auth]
DELETE /api/notes/:id/bookmark                                                        [auth]
POST   /api/notes/:id/report        { reason }                                        [auth]
POST   /api/follow                  { course_code }                                   [auth]
GET    /api/bookmarks                                                                 [auth]
GET    /api/notifications                                                             [auth]
GET    /api/moderation/reports                                                        [moderator/admin]
POST   /api/moderation/reports/:id  { action: "remove_note" | "dismiss" }              [moderator/admin]
GET    /api/dashboard/stats                                                           [moderator/admin]
```

## StudyShare v2 improvements

- Modern responsive student-focused interface
- Light/dark theme toggle with saved preference
- Improved search/filter experience and keyboard search
- Drag-and-drop note upload with file preview and upload state
- Cleaner note cards, verification badges, tags and statistics
- Mobile-friendly layouts and touch-friendly controls
- Improved empty states, visual hierarchy and accessibility

## Changelog (frontend)

- **v3 to v8** — layout and theme work, then inline style and colour fallbacks
  inside `index.html` so the page stays readable even if `style.css` fails to load.
- **v9** — storage is now accessed safely. Pages opened from `content://` or
  `file://` can throw on `localStorage`, which previously stopped all of
  `app.js` from running (blank Browse page). A built-in memory fallback is used
  instead, and non-`http(s)` pages start in preview mode automatically.
- **v10** — `index.html` is self-contained (CSS and JS inlined), fixing the
  blank page when it is opened by itself from a zip viewer.
- **v11** — mobile polish: compact one-row header with scrollable tabs, shorter
  hero card, search box and button on one row, side-by-side filters, tighter
  note cards, clearer keyboard focus, and reduced-motion support.
- **v14** — phone bottom tab bar (always reachable, nothing cut off), moon/sun
  theme icon, flatter pages without double frames, and a two-column action grid on the note page.

If you edit `app.js`, `demo.js` or `style.css`, re-inline them into
`public/index.html` (or edit `index.html` directly) so the single-file version
stays in sync.
