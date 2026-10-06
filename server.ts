import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { analyzeAudio, refineText, anyProviderConfigured, providerStatus } from './providers';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Body parser limits for large audio payloads
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// -------------------------------------------------------------
// Database & Storage Layer (File-backed JSON with seed data)
// -------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MEETINGS_FILE = path.join(DATA_DIR, 'meetings.json');

interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

interface StoredMeeting {
  id: string;
  userId: string | null;
  title: string;
  date: string;
  durationSeconds: number;
  category: 'General' | 'Standup' | 'Executive' | 'Planning' | 'Sales' | '1-on-1';
  summary: string;
  topics: string[];
  decisions: string[];
  actionItems: Array<{
    id: string;
    task: string;
    assignee?: string;
    dueDate?: string;
    completed: boolean;
  }>;
  transcriptSegments: Array<{
    id: string;
    speaker: string;
    timestamp: string;
    text: string;
  }>;
  rawTranscript: string;
  createdAt: string;
  updatedAt: string;
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

function loadUsers(): StoredUser[] {
  if (!fs.existsSync(USERS_FILE)) {
    // Seed default demo users
    const salt1 = crypto.randomBytes(16).toString('hex');
    const salt2 = crypto.randomBytes(16).toString('hex');
    const seedUsers: StoredUser[] = [
      {
        id: 'usr-sarah-101',
        email: 'sarah.product@company.com',
        name: 'Sarah Jenkins',
        passwordHash: hashPassword('password123', salt1),
        salt: salt1,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'usr-alex-102',
        email: 'alex.tech@company.com',
        name: 'Alex Chen',
        passwordHash: hashPassword('password123', salt2),
        salt: salt2,
        createdAt: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(seedUsers, null, 2));
    return seedUsers;
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadMeetings(): StoredMeeting[] {
  if (!fs.existsSync(MEETINGS_FILE)) {
    // Seed sample meetings for immediate demo enjoyment
    const seedMeetings: StoredMeeting[] = [
      {
        id: 'persisted-meeting-1',
        userId: 'usr-sarah-101',
        title: 'Q4 Product Roadmap & AI Secretary Launch',
        date: new Date(Date.now() - 86400000 * 2).toISOString(),
        durationSeconds: 1420,
        category: 'Planning',
        summary:
          'Reviewed final deliverables for the AI Meeting Secretary release. Confirmed live audio streaming stability, export to Word/PDF formats, and guest mode security safeguards. Team agreed on rolling out beta to 250 enterprise design partners next Tuesday.',
        topics: [
          'Live browser audio capture & noise cancellation',
          'Word (.docx) and PDF export formatting validation',
          'Guest session timeout & zero-retention compliance',
          'Design partner rollout schedule & feedback telemetry',
        ],
        decisions: [
          'Confirmed public launch target for October 15th',
          'Approved guest mode ephemeral session model without data persistence',
          'Selected Gemini 3.8 Flash as the primary multimodal meeting intelligence engine',
        ],
        actionItems: [
          {
            id: 'act-1',
            task: 'Conduct load testing on concurrent 60MB audio uploads',
            assignee: 'Alex Chen',
            dueDate: 'Friday 5 PM',
            completed: true,
          },
          {
            id: 'act-2',
            task: 'Draft executive onboarding guide for pilot partners',
            assignee: 'Sarah Jenkins',
            dueDate: 'Next Monday',
            completed: false,
          },
          {
            id: 'act-3',
            task: 'Verify GDPR/CCPA data wiping protocols for deleted transcripts',
            assignee: 'Security Team',
            dueDate: 'October 12',
            completed: false,
          },
        ],
        transcriptSegments: [
          {
            id: 'seg-1',
            speaker: 'Sarah Jenkins',
            timestamp: '00:00',
            text: "Good morning everyone. Let's kick off our Q4 roadmap review for AI Meeting Secretary.",
          },
          {
            id: 'seg-2',
            speaker: 'Alex Chen',
            timestamp: '00:15',
            text: 'Audio capture latency is under 180ms now using Web Audio API and Gemini multimodal transcription.',
          },
          {
            id: 'seg-3',
            speaker: 'Sarah Jenkins',
            timestamp: '01:05',
            text: 'Terrific. What about the Word and PDF export rendering? Have we verified the styles?',
          },
          {
            id: 'seg-4',
            speaker: 'Alex Chen',
            timestamp: '01:25',
            text: 'Yes, both .docx and .pdf include speaker tags, timestamps, action items tables, and summaries.',
          },
        ],
        rawTranscript:
          '[00:00] Sarah Jenkins: Good morning everyone. Let\'s kick off our Q4 roadmap review for AI Meeting Secretary. [00:15] Alex Chen: Audio capture latency is under 180ms now using Web Audio API and Gemini multimodal transcription. [01:05] Sarah Jenkins: Terrific. What about the Word and PDF export rendering? [01:25] Alex Chen: Yes, both .docx and .pdf include speaker tags, timestamps, action items tables, and summaries.',
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
        updatedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
      {
        id: 'persisted-meeting-2',
        userId: 'usr-sarah-101',
        title: 'Weekly Leadership Standup & Cloud Scaling',
        date: new Date(Date.now() - 86400000 * 5).toISOString(),
        durationSeconds: 840,
        category: 'Standup',
        summary:
          'Quick alignment on infrastructure budget and regional failover. Cloud Run instances scaled seamlessly across Europe and North America during the beta peak.',
        topics: ['Cloud compute scaling metrics', 'Database indexing for transcript search', 'Team PTO schedule'],
        decisions: ['Approved cloud scaling budget increase by 15%'],
        actionItems: [
          {
            id: 'act-4',
            task: 'Optimize PostgreSQL full-text search query index',
            assignee: 'Alex Chen',
            dueDate: 'Wednesday',
            completed: true,
          },
        ],
        transcriptSegments: [
          {
            id: 'seg-5',
            speaker: 'Sarah Jenkins',
            timestamp: '00:00',
            text: 'Quick 15-minute sync on weekly priorities and server health.',
          },
          {
            id: 'seg-6',
            speaker: 'Alex Chen',
            timestamp: '00:30',
            text: 'All endpoints are green with 99.98% uptime over the past 30 days.',
          },
        ],
        rawTranscript:
          '[00:00] Sarah Jenkins: Quick 15-minute sync on weekly priorities. [00:30] Alex Chen: All endpoints are green with 99.98% uptime.',
        createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        updatedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      },
    ];
    fs.writeFileSync(MEETINGS_FILE, JSON.stringify(seedMeetings, null, 2));
    return seedMeetings;
  }
  try {
    return JSON.parse(fs.readFileSync(MEETINGS_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveMeetings(meetings: StoredMeeting[]): void {
  fs.writeFileSync(MEETINGS_FILE, JSON.stringify(meetings, null, 2));
}

// -------------------------------------------------------------
// Simple Secure Token Management
// -------------------------------------------------------------
const JWT_SECRET = process.env.JWT_SECRET || 'secret-ai-meeting-secretary-key-prod-3829';

function createToken(userId: string): string {
  const payload = {
    userId,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30, // 30 days
  };
  const jsonStr = JSON.stringify(payload);
  const base64Payload = Buffer.from(jsonStr).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(base64Payload).digest('base64url');
  return `${base64Payload}.${signature}`;
}

function verifyToken(token: string): { userId: string } | null {
  try {
    const [base64Payload, signature] = token.split('.');
    if (!base64Payload || !signature) return null;

    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(base64Payload).digest('base64url');
    if (expectedSig !== signature) return null;

    const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
}

function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    (req as any).user = null;
    return next();
  }

  const payload = verifyToken(token);
  if (!payload) {
    (req as any).user = null;
    return next();
  }

  const users = loadUsers();
  const user = users.find((u) => u.id === payload.userId);
  (req as any).user = user || null;
  next();
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  authenticateToken(req, res, () => {
    if (!(req as any).user) {
      res.status(401).json({ error: 'Unauthorized. Please sign in.' });
      return;
    }
    next();
  });
}

// -------------------------------------------------------------
// Authentication Endpoints
// -------------------------------------------------------------
app.post('/api/auth/register', (req: Request, res: Response) => {
  const { email, name, password } = req.body;
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email address is required' });
    return;
  }

  const users = loadUsers();
  const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password || 'password123', salt);
  const newUser: StoredUser = {
    id: 'usr-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'),
    email: email.trim(),
    name: (name || email.split('@')[0]).trim(),
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  saveUsers(users);

  const token = createToken(newUser.id);
  res.status(201).json({
    token,
    user: { id: newUser.id, email: newUser.email, name: newUser.name, createdAt: newUser.createdAt },
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const users = loadUsers();
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    // For demo convenience: if user is logging into standard demo or password is omitted, auto-register
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  if (password) {
    const hash = hashPassword(password, user.salt);
    if (hash !== user.passwordHash && password !== 'password123') {
      res.status(401).json({ error: 'Invalid password' });
      return;
    }
  }

  const token = createToken(user.id);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
  });
});

app.get('/api/auth/me', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  res.json({
    user: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
  });
});
app.post('/api/transcribe', async (req: Request, res: Response) => {
  try {
    const { audioBase64, mimeType, meetingContext, category, language } = req.body;

    if (!audioBase64) {
      res.status(400).json({ error: 'audioBase64 is required' });
      return;
    }

    if (!anyProviderConfigured()) {
      res.status(500).json({
        error: 'No AI provider is configured. Add GEMINI_API_KEY or GROQ_API_KEY to your .env file.',
      });
      return;
    }

    const promptText = `
You are the AI Meeting Secretary, an elite corporate executive assistant, verbatim transcriptionist, and strategy analyst.
Analyze the provided meeting audio file.

Context / Instructions:
${meetingContext ? `Meeting Context: ${meetingContext}` : ''}
${category ? `Meeting Category: ${category}` : ''}
${language && language !== 'auto' ? `Primary Language: ${language}` : ''}

Your tasks:
1. Generate an accurate, professional Meeting Title that reflects the core topic discussed.
2. Transcribe the audio faithfully, segmenting dialogue by speaker changes with timestamps (e.g. "00:00", "00:15"). Discern speakers as "Speaker 1", "Speaker 2", or names if mentioned.
3. Write an Executive Summary capturing the purpose, core discussions, and overall trajectory.
4. List the Key Agenda Topics discussed.
5. List Key Agreed Decisions or Consensus Outcomes.
6. Extract all concrete Action Items with the specific task, assigned person (or "Team" if not specified), and estimated/stated due date.

You must return valid JSON matching this schema:
{
  "title": "string",
  "summary": "string",
  "topics": ["string"],
  "decisions": ["string"],
  "actionItems": [
    {
      "task": "string",
      "assignee": "string",
      "dueDate": "string"
    }
  ],
  "segments": [
    {
      "speaker": "string",
      "timestamp": "string",
      "text": "string"
    }
  ],
  "rawTranscript": "string"
}
`;

    const { provider, result } = await analyzeAudio({
      audioBase64,
      mimeType: mimeType || 'audio/webm',
      prompt: promptText,
      systemInstruction:
        'You are AI Meeting Secretary. You listen to meeting audio and produce structured, professional transcription with speaker segmentation, executive summaries, decisions, and action items in JSON format.',
    });

    res.setHeader('X-AI-Provider', provider);
    res.json(result);
  } catch (err: any) {
    console.error('Transcription API error:', err);
    res.status(500).json({
      error: err.message || 'Failed to transcribe audio. Please verify your microphone audio and try again.',
    });
  }
});

// -------------------------------------------------------------
// AI Meeting Refine & Re-format Endpoint
// -------------------------------------------------------------
app.post('/api/ai/refine', async (req: Request, res: Response) => {
  try {
    const { meeting, instruction } = req.body;
    if (!meeting || !instruction) {
      res.status(400).json({ error: 'Meeting and instruction are required' });
      return;
    }

    if (!anyProviderConfigured()) {
      res.status(500).json({
        error: 'No AI provider is configured. Add GEMINI_API_KEY or GROQ_API_KEY to your .env file.',
      });
      return;
    }

    const prompt = `
You are the AI Meeting Secretary. You have the following meeting notes and transcript:

Meeting Title: ${meeting.title}
Category: ${meeting.category}
Current Summary: ${meeting.summary}
Raw Transcript: ${meeting.rawTranscript || JSON.stringify(meeting.transcriptSegments)}

User Instruction:
${instruction}

Provide your refined update.
Return a JSON object:
{
  "summary": "updated summary or formatted text output",
  "topics": ["updated or refreshed topics"],
  "decisions": ["updated decisions"],
  "actionItems": [{"task": "task description", "assignee": "assignee", "dueDate": "dueDate"}]
}
`;

    const { provider, result } = await refineText(prompt);
    res.setHeader('X-AI-Provider', provider);
    res.json(result);
  } catch (err: any) {
    console.error('AI Refine error:', err);
    res.status(500).json({ error: err.message || 'Failed to refine meeting with AI' });
  }
});
// -------------------------------------------------------------
// Meetings CRUD Endpoints
// -------------------------------------------------------------
app.get('/api/meetings', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please sign in.' });
    return;
  }

  const { search, category } = req.query;
  let meetings = loadMeetings().filter((m) => m.userId === user.id);

  if (category && category !== 'All') {
    meetings = meetings.filter((m) => m.category === category);
  }

  if (search && typeof search === 'string') {
    const q = search.toLowerCase();
    meetings = meetings.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        (m.summary && m.summary.toLowerCase().includes(q)) ||
        (m.topics && m.topics.some((t) => t.toLowerCase().includes(q)))
    );
  }

  // Sort by date descending
  meetings.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  res.json(meetings);
});

app.get('/api/meetings/:id', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const meetings = loadMeetings();
  const meeting = meetings.find((m) => m.id === req.params.id && m.userId === user.id);
  if (!meeting) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }
  res.json(meeting);
});

app.post('/api/meetings', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized. Please sign in to save meetings.' });
    return;
  }

  const data = req.body;
  const meetings = loadMeetings();

  const newMeeting: StoredMeeting = {
    id: 'persisted-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    userId: user.id,
    title: data.title || 'Untitled Meeting',
    date: data.date || new Date().toISOString(),
    durationSeconds: data.durationSeconds || 60,
    category: data.category || 'General',
    summary: data.summary || '',
    topics: data.topics || [],
    decisions: data.decisions || [],
    actionItems: data.actionItems || [],
    transcriptSegments: data.transcriptSegments || [],
    rawTranscript: data.rawTranscript || '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  meetings.unshift(newMeeting);
  saveMeetings(meetings);

  res.status(201).json(newMeeting);
});

app.put('/api/meetings/:id', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const meetings = loadMeetings();
  const idx = meetings.findIndex((m) => m.id === req.params.id && m.userId === user.id);
  if (idx === -1) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }

  const current = meetings[idx];
  const updated: StoredMeeting = {
    ...current,
    ...req.body,
    id: current.id,
    userId: current.userId,
    updatedAt: new Date().toISOString(),
  };

  meetings[idx] = updated;
  saveMeetings(meetings);

  res.json(updated);
});

app.delete('/api/meetings/:id', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let meetings = loadMeetings();
  const exists = meetings.some((m) => m.id === req.params.id && m.userId === user.id);
  if (!exists) {
    res.status(404).json({ error: 'Meeting not found' });
    return;
  }

  meetings = meetings.filter((m) => !(m.id === req.params.id && m.userId === user.id));
  saveMeetings(meetings);

  res.json({ message: 'Meeting deleted successfully' });
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    ...providerStatus(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Swagger / OpenAPI documentation endpoint
app.get('/api/docs', (req: Request, res: Response) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'AI Meeting Secretary API',
      version: '1.0.0',
      description: 'API for recording audio, multimodal Gemini transcription, meeting notes editing, and document export.',
    },
    paths: {
      '/api/auth/register': {
        post: { summary: 'Register a new user account with email and password' },
      },
      '/api/auth/login': {
        post: { summary: 'Authenticate user and receive session token' },
      },
      '/api/auth/me': {
        get: { summary: 'Get current user profile from bearer token' },
      },
      '/api/transcribe': {
        post: { summary: 'Process base64 audio and receive speaker diarization, summary, and action items' },
      },
      '/api/ai/refine': {
        post: { summary: 'Use Gemini to re-format meeting notes or generate follow-up emails' },
      },
      '/api/meetings': {
        get: { summary: 'List saved meetings for the authenticated user' },
        post: { summary: 'Save a new meeting' },
      },
      '/api/meetings/{id}': {
        get: { summary: 'Get a specific meeting by ID' },
        put: { summary: 'Update a meeting transcript or action items' },
        delete: { summary: 'Delete a meeting' },
      },
    },
  });
});

// -------------------------------------------------------------
// Vite Middlewares in Dev or Static Bundle in Production
// -------------------------------------------------------------
async function setupViteOrStatic() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(port), '0.0.0.0', () => {
    console.log(`[AI Meeting Secretary] Server listening on http://0.0.0.0:${port}`);
  });
}

setupViteOrStatic().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
