# cats — Recruitment & Hiring Platform

cats covers the whole hiring cycle in one place. The flow is: create a job → collect resumes (career page, upload, email inbox) → reviewer screening → proctored online tests → AI interview series → offer and negotiation → pre-joining documents and background verification → joining, which closes the position.

```
                         ┌──────────────────────────────┐
  Browser (React app) ──▶│  API Gateway :4000           │  Supabase JWT auth, roles, rate limits,
  HR app + candidate     │  /api/*   /api/public/*      │  routing, header hardening
  portal                 └──────────────┬───────────────┘
                                        │ internal key + user context
   ┌──────────┬──────────┬──────────┬───┴──────┬───────────┬──────────┬────────────┬────────┬──────────────┐
   identity    jobs      talent     assessment interview    offer      onboarding    ai       notification
   :4001       :4002     :4003      :4004      :4005        :4006      :4007         :4008    :4009
   users,      jobs,     candidates tests,     AI / proctored offers,  documents,    Groq     SMTP outbox,
   roles,      interview resumes,   proctored  & live rounds, versions, BGV vendors,  LLM      templates,
   departments plans,    pipeline,  attempts,  transcripts,  negotiation joining     calls    activity feed
               careers   reviews    grading    feedback
   └──────────┴──────────┴──────────┴──────────┴───────────┴──────────┴────────────┴────────┴──────────────┘
        │ reads: per-service Redis cache first (versioned keys)          │ cache miss / writes / transactions
        ▼                                                                 ▼
   ┌──────────────┐                                     ┌─────────────────────────────────────────┐
   │ Redis        │◀── table versions bumped on commit ─│ DB service :4010  (only DB client)      │
   │ db0 versions │                                     │ queue · write batching · remote tx ·    │
   │ db1-8 caches │                                     │ schema guard · DB_POOL_MAX connection(s)│
   └──────────────┘                                     └────────────────────┬────────────────────┘
                      Supabase Postgres: one schema per service  ·  Supabase Storage (private bucket)
```

## Highlights

| Area                  | What you get                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jobs**              | Job requisitions with AI-written job descriptions, skills, openings, a per-job interview plan, reviewers, and a public careers page with an apply form                                                                                                                                                                                    |
| **Resume intake**     | Drag-and-drop bulk upload, career-page applications, and automatic import from an email inbox (IMAP). AI parses every resume into a structured profile and de-duplicates candidates by email                                                                                                                                              |
| **AI matching**       | Every application gets a 0–100 fit score with strengths and gaps against the job                                                                                                                                                                                                                                                          |
| **Pipeline**          | Kanban board per job with drag & drop, bulk actions, stage history and an activity timeline                                                                                                                                                                                                                                               |
| **Resume review**     | Send resumes to department reviewers in bulk. Reviewers get one email and work through a review queue (resume preview, rating, decision)                                                                                                                                                                                                  |
| **Assessments**       | Test builder with AI question generation (MCQ, multi-select, short/long answers, code). Proctored test portal with timer, autosave, and full-screen, tab-switch, paste and camera monitoring. Automatic grading with AI marking for written answers, plus an integrity score                                                              |
| **Interviews**        | One click starts the job's interview series: AI screening → AI proctored technical rounds → live panel rounds. AI interviews are adaptive chats with a transcript, a scored evaluation and competency breakdown. Live rounds send calendar invites (.ics) and collect panel feedback. Passing a round automatically triggers the next one |
| **Offers**            | Versioned offers, a candidate offer portal (accept / decline / counter-offer), a negotiation thread and revisions                                                                                                                                                                                                                         |
| **Pre-joining & BGV** | The document checklist is sent automatically when an offer is accepted. Candidates upload through a secure link and HR verifies or rejects each item. One click sends the documents to the third-party verification firm (secure 7-day links), and the BGV status is tracked                                                              |
| **Closing**           | "Mark as joined" sets the candidate to hired and fills the position. The job closes automatically when all openings are filled                                                                                                                                                                                                            |
| **Email**             | Branded, editable templates, a reliable outbox with retries, a full email log, and AI-drafted custom emails                                                                                                                                                                                                                               |
| **Team**              | Roles: admin, recruiter, hiring manager, reviewer, interviewer. Invite-only access                                                                                                                                                                                                                                                        |

## 1. Prerequisites

- Node.js 20+ (22 recommended) and npm
- A **Supabase** project (free tier works)
- A **Groq** API key — https://console.groq.com/keys
- An SMTP mailbox for sending email. For Gmail or Google Workspace, use an App Password: Google Account → Security → 2-Step Verification → App passwords

## 2. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable                                                         | Where to find it                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API                                                                           |
| `DATABASE_URL`                                                   | Supabase → Connect → **Session pooler** connection string (port 5432)                                       |
| `SUPABASE_JWT_SECRET`                                            | Only needed for projects that still use the legacy JWT secret. Leave it empty to verify tokens through JWKS |
| `GROQ_API_KEY`                                                   | Groq console                                                                                                |
| `SMTP_*`, `EMAIL_FROM`                                           | Your mail provider                                                                                          |
| `INTERNAL_API_KEY`                                               | Any long random string, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`     |
| `APP_URL`, `CORS_ORIGINS`                                        | Where the web app runs (`http://localhost:5173` in dev)                                                     |
| `VITE_*`                                                         | Same Supabase URL/anon key plus the gateway URL, for the browser                                            |
| `IMAP_*` (optional)                                              | The careers inbox to import resumes from                                                                    |

In Supabase → Authentication → URL Configuration, set **Site URL** to `APP_URL` and add `APP_URL/login` to the redirect URLs.

## 3. Create the database

```bash
npm install
npm run db:migrate
```

This creates one schema per service (`identity`, `jobs`, `talent`, `assessment`, `interview`, `offer`, `onboarding`, `notify`, `platform`), with seed email templates and onboarding document types. The private storage bucket is created automatically on first upload.

> **Schema isolation** is enforced by the DB service (`DB_SCHEMA_GUARD=enforce`): each service may only touch its own schema, plus appending to `platform.events`. `db/roles.sql` and `<SCHEMA>_DATABASE_URL` only apply in `DB_MODE=direct`.

## 4. Create the first admin

After running migrations, create an admin from the command line (uses `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env`):

```bash
npm run admin:create -- --email you@company.com --password "a-strong-password" --name "Your Name"
```

Leave out `--password` to have one generated and printed. The script is safe to re-run: for an existing account it promotes the user to admin, reactivates them, and resets the password if you pass `--password`.

(Alternative: create a user in Supabase → Authentication → Users with _auto-confirm_; the **first person to sign in becomes the admin**.)

Admins manage everyone else under **Settings → Team & roles**:

- **Add member**: send an email invitation, or set a password so they can sign in right away
- **Edit details / role**: name, title, department, role
- **Set password** or **Send password reset** email
- **Deactivate / Reactivate**: deactivated users are blocked at sign-in, and their history is kept
- **Delete**: only for users who have never signed in (for example, a mistaken invite)

You can't demote, deactivate or delete the last active admin.

## 5. Run

```bash
docker run -d --name hf-redis -p 6379:6379 redis:7-alpine   # optional: enables the query cache
npm run dev          # DB service + all 10 services + web app with hot reload
```

- HR app: http://localhost:5173
- Public careers page: http://localhost:5173/careers
- API gateway: http://localhost:4000 (`/api/system/health` shows the status of every service)

Set `EMAIL_DRY_RUN=true` to log emails instead of sending them while testing.

## 6. Deploy (production)

**Docker (any VM, e.g. a $10–20/month server):**

```bash
# set APP_URL / CORS_ORIGINS / VITE_API_URL to your real domains first
docker compose up -d --build
```

This exposes the gateway on `:4000` and the web app on `:8080`. Put a reverse proxy with TLS in front, such as Caddy or nginx. For example, `hire.yourco.com` → web and `api.hire.yourco.com` → gateway.

**Without Docker:** run `npm run build` and then `npm start`, which runs all built services. Host the `apps/web/dist` folder on any static host (Netlify, Vercel, Cloudflare Pages) with an SPA fallback to `index.html`.

Each service is an independent Node process with its own `/health` endpoint, so services can be scaled or moved separately. Service URLs are configured with `*_URL` env vars.

## Database access, queue & cache

Supabase limits how many Postgres connections a project can open. Instead of every service keeping its own pool, **only the DB service (`services/db`) connects to Postgres**, with `DB_POOL_MAX` connections (default **1**).

- **Services don't change.** `createDb('<schema>')` returns a postgres.js-compatible client. Queries are shipped as template strings plus values and rebuilt as the identical postgres.js call in the DB service, so tagged templates, fragments, `sql(obj)` helpers, `sql.json`, `sql.array`, `sql.begin` and `result.count` behave as before. Postgres errors arrive with the same `code`, `severity` and `constraint_name` fields.
- **Queue.** Every operation goes through a bounded queue. When it is full, callers get `503 DB_BUSY`, and operations that wait longer than `DB_QUEUE_TIMEOUT_MS` are rejected without running. Reads are pipelined over the connection.
- **Write batching.** Autocommit writes that queue up together are group-committed in one transaction: one round trip and one commit instead of N. If any statement in a batch fails, the batch rolls back and each statement is re-run individually, so only the failing one reports an error and every other write applies exactly once.
- **Transactions.** `sql.begin` opens a remote session that holds a connection until commit or rollback. A failed statement rolls back immediately. Sessions idle for longer than `DB_TX_IDLE_TIMEOUT_MS` are rolled back, so a crashed caller can't hold the connection.
- **Cache.** Reads outside transactions are cached in the calling service's own Redis database. Each key includes a version for every table the query reads. The DB service bumps those versions after each commit, including tables changed through `ON DELETE CASCADE`, so a write from *any* service invalidates affected entries immediately and you always read your own writes. Queries using `now()`, `random()`, sequences or row locks are never cached. If Redis is down, the cache is bypassed and requests still succeed.
- **Monitoring.** `GET /internal/db/stats` on the DB service (internal key required) shows queue depth, batches, fallbacks, transactions and expiries.

Writes made outside the platform (SQL editor, scripts) don't bump versions, so cached reads of those tables can be up to `CACHE_TTL_SECONDS` old. With a single connection, one open transaction pauses other database work until it finishes. If `/internal/db/stats` shows queues building up, raise `DB_POOL_MAX` to 2–3, which is still far below Supabase's limits.

## Day-to-day workflow

1. **Jobs → New job.** Enter a title, then click _Generate with AI_ to draft the JD and skills. Adjust the interview plan and pick the department reviewers. Publish to get the public apply link.
2. **Collect resumes.** Share the apply link, drag resumes onto the job (_Upload resumes_), or forward them to the careers inbox with the job code (e.g. `JOB-1001`) in the subject. Every resume is parsed and AI-scored.
3. **Pipeline → select candidates → Send for review.** Reviewers get an email and decide from their **Resume reviews** queue.
4. **Shortlist → Send test.** Candidates take the proctored test. Scores, integrity and per-answer AI feedback show up under **Assessments**.
5. **Start interviews.** This runs the job's interview series. AI rounds are sent and evaluated automatically. Live rounds are scheduled with a calendar invite and collect panel feedback.
6. **Create offer → Send.** The candidate accepts, declines or counters in the offer portal, and you revise the offer if needed.
7. **Pre-joining.** This starts automatically on acceptance. Verify the documents, then _Send to BGV vendor_ and record the result.
8. **Mark as joined.** The candidate is marked hired, and the position closes once all openings are filled.

## Project layout

```
apps/web                 React + Vite + Tailwind (HR workspace + candidate portal)
services/gateway         API gateway (auth, routing, rate limiting)
services/db              Central DB service (only Postgres client: queue, batching, remote transactions)
services/<name>          Fastify microservices (one DB schema each, DB access via services/db)
packages/shared          Config, remote DB client + Redis cache, service bootstrap, internal client, events, storage, email helpers
db/migrations            SQL migrations (npm run db:migrate)
docs/API.md              API contract for every service
```

## Security notes

- Only the gateway is public. Every internal route requires `INTERNAL_API_KEY`, and the gateway strips spoofed identity headers.
- Candidate links use 256-bit random tokens. Only SHA-256 hashes are stored, and the links expire.
- Files live in a private bucket and are shared only through short-lived signed URLs.
- Role checks are enforced in each service, not just in the UI.
