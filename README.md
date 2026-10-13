# EduAshram (eduashram.in)

An interactive math classroom quiz platform with teacher-led live rounds, timed self-paced quizzes, student passkeys, persisted results, and real-time classroom updates.

## Stack

- React 19, TypeScript, Vite, and Socket.IO client
- Express 5 and Socket.IO on one Node server
- PostgreSQL 16 with Prisma ORM
- bcrypt-hashed passwords/passkeys, signed HttpOnly session cookies, Helmet, request validation, and login rate limiting

The production server serves the built React app and its API from the same origin. PostgreSQL can run locally in Docker or on any managed PostgreSQL host. No paid real-time service is required.

## Data model

- `Admin`: teacher email and bcrypt password hash.
- `Student`: name, active state, bcrypt passkey hash, and a keyed HMAC lookup value. The raw passkey is only shown when created or reset.
- `Quiz`: title, mode, draft/active/closed status, optional time limit, result visibility, and live question/reveal state.
- `Question` and `Option`: ordered prompt/options, marks, and the server-only correct option.
- `Attempt`: unique `(quizId, studentId)` pair, status, start/deadline/submission times, and server-calculated score.
- `Answer`: one row per `(attemptId, questionId)`; upserting lets students change a timed answer before submission.

Students receive only their own attempt and answers. Live response names and option choices are sent only to authenticated teacher sockets.

## Run locally

Prerequisites: Node.js 20+ and Docker Desktop (or another PostgreSQL 16 instance).

1. Install dependencies: `npm install`.
2. Create local environment settings: `Copy-Item .env.example .env` in PowerShell. Replace `SESSION_SECRET` with a random value of at least 32 characters and change the initial admin password.
3. Start PostgreSQL: `docker compose up -d db`.
4. Create/update the database schema: `npm run db:migrate`.
5. Start the API in one terminal: `npm run dev`.
6. Start the web app in another terminal: `npm run dev:web`.
7. Open `http://localhost:5173`. Sign in to the teacher view using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. The server creates the first admin automatically; `npm run db:seed` can also create/update that account.

The database volume is named `livequiz_data`; `docker compose down` leaves it intact. Do not remove the volume unless you intend to delete local quiz data.

## Deploy

Use a Node.js 20+ host and a PostgreSQL database. Set `DATABASE_URL`, `SESSION_SECRET` (32+ random characters), `ADMIN_EMAIL`, and `ADMIN_PASSWORD` as deployment secrets. Build with `npm install` and `npm run build`; run `npm start`. The app serves the client and API from the same origin, so Socket.IO uses the same secure session cookie. Enable HTTPS in production. Run `npm run db:deploy` against the production database during release before starting the new application version. This MVP uses Prisma schema synchronization; adopt checked-in migrations before making destructive database changes or coordinating multiple app versions.

The included Docker Compose file is intended for local development, not as a public production database configuration. Use a managed PostgreSQL service or a private, access-controlled PostgreSQL deployment for Internet hosting.

## Version 2: Complete Education Portal & Study Materials (Grades 4–10)

Version 2 transforms EduAshram into an open, full-fledged educational portal for school students and teachers:

- **Public Educational Hub (No login required)**: Anyone with the link can explore study materials, chapter summaries, formulas, presentations, and video lectures.
- **Curriculum Scope**: Focused on **Grade 4 to Grade 10** (CBSE & ICSE), architected for smooth future expansion to Grades 11 and 12.
- **Dedicated Grade Hubs**: Specialized hubs for Grade 4 through Grade 10 highlighting core syllabus topics and filtered resources.
- **Rich Media Formats**:
  - 📖 **Articles & Revision Notes**: Typography-focused reading layouts with formulas, proofs, and solved examples.
  - 📄 **PDFs & Cheat-Sheets**: Formula sheets and printable revision guides.
  - 🎥 **Video Lessons**: Embedded lectures with summaries.
  - 📊 **Presentations**: Slide decks breaking down concepts step-by-step.
  - 🖼️ **Infographics**: Visual diagrams and mind-maps.
- **Teacher Study Material Manager**: Teachers can publish, edit, attach files, embed videos, and organize materials by Grade and Subject.
- **Integrated Classroom Portals**: Modal login for Student Passkey and Teacher Admin credentials allows seamless access to live quizzes, timed assessments, and workbook submissions without leaving the portal.
