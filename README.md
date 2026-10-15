# AI Meeting Secretary

AI Meeting Secretary turns meeting recordings into searchable transcripts, summaries, decisions, and action items. Record a meeting in the browser or upload an audio/video file, then save it and transcribe it now or later.

## Features

- Record audio or upload common audio and video formats.
- Generate transcripts, summaries, topics, decisions, and action items with Gemini or Groq.
- Save meetings to an account and retry transcription later.
- Edit transcripts and action items, and export notes to Markdown, Word, or PDF.
- Store recordings locally or in an S3-compatible service.
- Verify email addresses and reset passwords through console, SMTP, or Resend email delivery.

## Project layout

```text
backend/             FastAPI API, database models, Alembic migrations, and provider integrations
  .env.example       Backend configuration template
  tests/             Backend provider-chain tests
frontend/            Next.js web application
.gitignore           Excludes local secrets, databases, recordings, and build artifacts
README.md             Setup and configuration guide
```

## Run locally

### Requirements

- Python 3.10 or newer
- Node.js 20.9 or newer and npm
- FFmpeg and FFprobe on the backend machine for media validation and audio extraction
- An API key for at least one transcription provider: [Google AI Studio](https://aistudio.google.com/app/apikey) or [Groq](https://console.groq.com/keys)

### Setup

1. Clone the repository and open a terminal in its root directory.
2. Create a Python virtual environment and install the backend packages:

   ```powershell
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install -r backend/requirements.txt
   ```

   On macOS or Linux, use `python3 -m venv .venv` and activate it with `source .venv/bin/activate`.

3. Create the backend environment file:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```

   Edit `backend/.env`. Set a unique `JWT_SECRET` and at least one provider key (`GEMINI_API_KEY` or `GROQ_API_KEY`). Keep this file private; never commit it.

4. Apply the database migrations from `backend/`:

   ```powershell
   cd backend
   python -m alembic upgrade head
   cd ..
   ```

5. Start the backend in one terminal from the project root:

   ```powershell
   python -m uvicorn backend.main:app --reload --port 8000
   ```

   Alternatively, from `backend/`, run `python -m uvicorn main:app --reload --port 8000`.

6. In a second terminal, start the frontend:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

7. Open `http://localhost:3000`. The API health route is `http://localhost:8000/api/health`; interactive API docs are at `http://localhost:8000/docs`.

The local SQLite database and retained recordings are stored under `backend/data/`. The `.gitignore` excludes local environment files, databases, recordings, dependency folders, and build output.

## Database and migrations

The backend uses SQLAlchemy 2.0 and Alembic. `DATABASE_URL` selects the database: local development defaults to SQLite (`sqlite:///data/meetings.sqlite3` in `backend/.env.example`); production can use PostgreSQL, for example `postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME`. Run migrations from `backend/` with `python -m alembic upgrade head` after installing dependencies and whenever a new migration is added.

To copy an existing local SQLite database into the configured target, first set `DATABASE_URL` to the target database, run `python -m alembic upgrade head` from `backend/`, then from the project root run:

```powershell
python -m backend.scripts.migrate_sqlite_to_url
```

The script defaults to `backend/data/meetings.sqlite3`, preserves existing IDs and audio paths, and skips rows already present in the target. Use `--source` to select another SQLite file. Back up both databases before copying.

## Audio storage

`STORAGE_PROVIDER=local` stores audio under `backend/data/audio/`. Set `STORAGE_PROVIDER=s3` for AWS S3, Cloudflare R2, or Supabase Storage's S3-compatible endpoint. Configure `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`; set `S3_ENDPOINT_URL` for R2 or Supabase (for Supabase, use the project's S3 endpoint). The API issues short-lived signed playback and download URLs. Local storage uses expiring signed API URLs; S3-compatible storage uses provider presigned URLs. `AUDIO_SIGNED_URL_TTL` controls link lifetime in seconds.

After applying migrations, set the storage provider and credentials in `backend/.env`, then migrate existing local audio from the SQLite rows:

```powershell
python -m backend.scripts.migrate_storage
```

Run it from the project root. The script updates each meeting to use a provider-neutral storage key and leaves source files in place by default. Add `--delete-source` only after checking the destination; it deletes a source file after its copy is stored and the database row is updated. Retention cleanup, transcription, and meeting deletion work through the configured provider.

## Providers and configuration

Set `GEMINI_API_KEY` or `GROQ_API_KEY` in `backend/.env`. The chain uses `PROVIDER_ORDER` (default `gemini,groq`) and only falls back after transient provider errors. Groq transcription uses `GROQ_WHISPER_MODEL` and structured analysis uses `GROQ_MODEL`.

Install FFmpeg and FFprobe on the backend machine. Uploads are validated by their file contents and probed for an audio stream and actual duration; submitted MIME types and duration fields are not trusted. Video audio is extracted before either AI provider receives it. Groq audio above its upload limit is split into smaller chunks.

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | — | Session signing key; required in production. |
| `PROVIDER_ORDER` | `gemini,groq` | Provider order. |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Gemini model. |
| `GROQ_WHISPER_MODEL` | `whisper-large-v3-turbo` | Groq audio transcription model. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq meeting analysis model. |
| `MONTHLY_TRANSCRIPTION_QUOTA` | `60` | Monthly transcriptions per user. |
| `TRANSCRIPTION_JOB_TIMEOUT_MINUTES` | `30` | On startup, processing meetings older than this are marked failed so they can be retried. |
| `AUDIO_RETENTION_DAYS` | `30` | Days audio is retained; `0` removes audio after transcription. |
| `STORAGE_PROVIDER` | `local` | `local`, `s3`, `r2`, or `supabase`. |
| `LOCAL_STORAGE_DIR` | `data` | Local storage root relative to `backend/`; media keys use the `audio/` prefix. |
| `S3_ENDPOINT_URL` | — | Optional S3-compatible service endpoint. |
| `S3_BUCKET` | — | Required for an S3-compatible provider. |
| `S3_REGION` | `auto` | S3 region or provider-specific region. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | S3-compatible service credentials. |
| `AUDIO_SIGNED_URL_TTL` | `3600` | Lifetime of generated audio links, in seconds. |
| `MAX_AUDIO_BYTES` | `20971520` | Maximum uploaded audio or video size. |
| `MAX_AUDIO_DURATION_SECONDS` | `7200` | Maximum source audio/video duration; enforced by FFprobe on the backend. |
| `DATABASE_URL` | `sqlite:///data/meetings.sqlite3` | SQLAlchemy database URL. SQLite paths are relative to `backend/`; PostgreSQL uses `postgresql+psycopg://...`. |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed browser origins. |
| `APP_BASE_URL` | `http://localhost:3000` | Frontend origin used in account email links. |
| `EMAIL_PROVIDER` | `console` | `console` for local links, or `smtp` / `resend` for delivery. Production requires a real sender. |
| `EMAIL_FROM` | — | Verified sender address for SMTP or Resend. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS` | — / `587` / `true` | SMTP server settings. |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | — | Optional SMTP authentication credentials. |
| `RESEND_API_KEY` | — | API key when `EMAIL_PROVIDER=resend`. |

New registrations require email verification. In local development, the console email provider prints verification and reset links in the backend terminal. Password reset links expire after one hour; verification links expire after 24 hours. Apply the latest migration before starting the backend.

For SMTP, set `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, and the appropriate SMTP credentials. For Resend, set `EMAIL_PROVIDER=resend`, `EMAIL_FROM`, and `RESEND_API_KEY`. Keep these values in `backend/.env` or your production secret store; they are used only by the backend.

The auth routes are `POST /api/auth/verify?token=...`, `POST /api/auth/verification/resend`, `POST /api/auth/password-reset`, and `POST /api/auth/password-reset/confirm`. The local limiter keeps separate per-IP counters in each backend process; use a shared rate-limit store if deploying multiple API workers.

## API overview

- `POST /api/transcribe` transcribes audio immediately.
- `POST /api/meetings` saves uploaded audio and meeting details; set `transcribe_now` to start transcription immediately.
- `POST /api/meetings/{id}/transcribe` starts or retries transcription for an owned meeting.
- Authentication, meeting management, and AI refinement endpoints are available under `/api/`.

The frontend proxy defaults to `http://127.0.0.1:8000`. Set `API_ORIGIN` in `frontend/.env.local` when the backend runs elsewhere.

## Checks

Run backend syntax and provider-chain checks from the project root:

```powershell
python -m py_compile backend/main.py
python -m unittest discover -s backend/tests -v
```

Build the frontend from `frontend/` with `npm run build`.

## Legacy data

The unused JSON data files from the earlier demo are preserved in `backend/data/archive/`. They are not imported automatically. Review or export them before deleting the archive.
