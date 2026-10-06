# AI Meeting Secretary

An intelligent, full-stack web application that records live audio directly from the browser, transcribes it using Google's multimodal **Gemini API** (`@google/genai`) with **Groq** as a fallback, generates speaker-labeled dialogue, executive summaries, key agenda topics, and concrete action items, and allows editing and one-click export to **Microsoft Word (.docx)** and **PDF**.

---

## 1. Tech Stack & Architecture

- **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide Icons, Motion.
- **Audio Capture & Analysis:** HTML5 `MediaRecorder` API + Web Audio API (`AnalyserNode`) for live waveform visualization.
- **Backend:** Node.js, Express, `tsx` TypeScript runtime, with Vite middleware integration in development and static asset serving in production.
- **AI Engine:** Google Gemini API (`@google/genai`) using multimodal `gemini-3.8-flash`, with Groq Whisper and `openai/gpt-oss-120b` as a fallback for transcription and structured analysis.
- **Export Engine:** Client-side document generation using `docx` for Microsoft Word and `jspdf` for PDF.
- **Authentication & Persistence:** Secure token authentication with password hashing (PBKDF2/SHA-512) and persistent database storage for registered users.
- **Guest Access:** Zero-friction guest mode with ephemeral local sessions and persistent warning prompts.

---

## 2. Project Directory Structure

```text
├── .env.example              # Environment variables template
├── index.html                # HTML entry point with synchronized metadata & title
├── metadata.json             # Applet capabilities & permissions
├── package.json              # App dependencies & scripts (Express, React, Gemini SDK)
├── tsconfig.json             # TypeScript compiler configuration
├── vite.config.ts            # Vite build and Tailwind configuration
├── server.ts                 # Full-stack Express server + Gemini AI endpoints
├── data/                     # Persistent database storage
│   ├── users.json            # Encrypted user accounts & salt hashes
│   └── meetings.json         # Past meeting transcripts, action items & summaries
└── src/
    ├── main.tsx              # React DOM mounting
    ├── index.css             # Tailwind CSS imports
    ├── App.tsx               # Main application container & view orchestration
    ├── types/
    │   └── index.ts          # TypeScript interfaces (Meeting, User, Transcript, etc.)
    ├── services/
    │   └── api.ts            # Client-side API service connecting to Express backend
    ├── utils/
    │   └── exportDocs.ts     # Word (.docx), PDF, and Markdown export generators
    └── components/
        ├── Header.tsx        # Top navigation, brand logo, guest alert & user profile
        ├── AuthModal.tsx     # Sign In, Sign Up, and 1-click Demo Profiles
        ├── Recorder.tsx      # MediaRecorder audio capture, live waveform & file upload
        ├── TranscriptEditor.tsx # Interactive editor, action item checklist & exports
        └── Dashboard.tsx     # Saved meetings list, search filter, and statistics
```

---

## 3. Database Schema

### SQL (PostgreSQL / Relational)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    salt VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(50) DEFAULT 'General',
    summary TEXT,
    topics JSONB DEFAULT '[]'::jsonb,
    decisions JSONB DEFAULT '[]'::jsonb,
    action_items JSONB DEFAULT '[]'::jsonb,
    transcript_segments JSONB DEFAULT '[]'::jsonb,
    raw_transcript TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_meetings_user_id ON meetings(user_id);
CREATE INDEX idx_meetings_date ON meetings(date DESC);
```

### NoSQL (Firebase Firestore / MongoDB)
```json
// Collection: users/{userId}
{
  "id": "usr-101",
  "email": "sarah.product@company.com",
  "name": "Sarah Jenkins",
  "createdAt": "2026-10-05T08:00:00Z"
}

// Collection: meetings/{meetingId}
{
  "id": "persisted-meeting-1",
  "userId": "usr-101",
  "title": "Q4 Product Roadmap & AI Secretary Launch",
  "date": "2026-10-05T08:15:00Z",
  "durationSeconds": 1420,
  "category": "Planning",
  "summary": "Executive overview of sprint milestones...",
  "topics": ["Live browser audio", "Word/PDF export"],
  "decisions": ["Approved launch on Oct 15"],
  "actionItems": [
    { "id": "act-1", "task": "Load test audio uploads", "assignee": "Alex", "completed": true }
  ],
  "transcriptSegments": [
    { "speaker": "Sarah Jenkins", "timestamp": "00:00", "text": "Good morning team..." }
  ]
}
```

---

## 4. API Endpoints Specification

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/api/auth/register` | Register new user account | No |
| `POST` | `/api/auth/login` | Sign in with email and password | No |
| `GET` | `/api/auth/me` | Fetch active user profile | Bearer Token |
| `POST` | `/api/transcribe` | Process base64 audio and generate structured transcript | No (supports Guest) |
| `POST` | `/api/ai/refine` | Polish notes or create executive email follow-up | No (supports Guest) |
| `GET` | `/api/meetings` | List saved meetings with search and category filters | Bearer Token |
| `POST` | `/api/meetings` | Save new meeting to dashboard | Bearer Token |
| `PUT` | `/api/meetings/:id` | Update meeting transcript, title, or action items | Bearer Token |
| `DELETE` | `/api/meetings/:id` | Permanently delete meeting | Bearer Token |
| `GET` | `/api/health` | Service health status and Gemini API key check | No |
| `GET` | `/api/docs` | OpenAPI 3.0 API specification | No |

---

## 5. Security & Privacy (GDPR & CCPA Compliant)

1. **Client-Side Ephemeral Processing for Guests:** Guest recordings are kept in memory and never persisted to disks or databases without user consent.
2. **Audio File Security:** Audio payloads sent to the backend are processed in-memory directly with Google's secure AI API and not permanently stored on disk.
3. **Data Encryption at Rest:** Passwords are encrypted using salted PBKDF2 with SHA-512.
4. **Permanent Right to Erasure:** Deleting a meeting deletes all transcript segments, summaries, and metadata immediately from the storage layer.

---

## 6. Docker Containerization

To run this application in any environment using Docker:

```dockerfile
# Multi-stage production Dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/data ./data
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
```

Build and run:
```bash
docker build -t ai-meeting-secretary .
docker run -p 3000:3000 -e GEMINI_API_KEY="YOUR_KEY" ai-meeting-secretary
```

---

## 7. Running Locally

```bash
# 1. Install dependencies
npm install

# 2. Set your environment variables
cp .env.example .env
# GEMINI_API_KEY is required; GROQ_API_KEY is optional and enables the fallback provider.

# 3. Start development server
npm run dev

# 4. Open in browser
http://localhost:3000
```
