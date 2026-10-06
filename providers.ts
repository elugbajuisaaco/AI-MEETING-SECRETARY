import { GoogleGenAI, Type } from '@google/genai';
import Groq, { toFile } from 'groq-sdk';

// NOTE: no process.env reads at the top level. Keys are read when a request
// arrives, after dotenv has loaded your .env file.

export type AudioInput = {
  audioBase64: string;
  mimeType: string;
  prompt: string;            // your full prompt text from server.ts
  systemInstruction: string; // your short system instruction
};

type Provider = {
  name: string;
  isConfigured: () => boolean;
  transcribe: (i: AudioInput) => Promise<any>;
  refine: (prompt: string) => Promise<any>;
};

// ---------- helpers ----------
function normalizeMeeting(d: any, fallbackTranscript = '') {
  return {
    title: String(d?.title || 'Untitled Meeting'),
    summary: String(d?.summary || ''),
    topics: Array.isArray(d?.topics) ? d.topics.map(String) : [],
    decisions: Array.isArray(d?.decisions) ? d.decisions.map(String) : [],
    actionItems: Array.isArray(d?.actionItems)
      ? d.actionItems
          .filter((a: any) => a && a.task)
          .map((a: any) => ({
            task: String(a.task),
            assignee: a.assignee ? String(a.assignee) : 'Team',
            dueDate: a.dueDate ? String(a.dueDate) : undefined,
          }))
      : [],
    segments: Array.isArray(d?.segments)
      ? d.segments
          .filter((s: any) => s && s.text)
          .map((s: any) => ({
            speaker: String(s.speaker || 'Speaker 1'),
            timestamp: String(s.timestamp || ''),
            text: String(s.text),
          }))
      : [],
    rawTranscript: String(d?.rawTranscript || fallbackTranscript),
  };
}

const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function audioExt(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('flac')) return 'flac';
  return 'webm';
}

// ---------- Gemini ----------
const geminiClient = () => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const geminiProvider: Provider = {
  name: 'gemini',
  isConfigured: () => !!process.env.GEMINI_API_KEY,

  transcribe: async (i) => {
    const res = await geminiClient().models.generateContent({
      model: geminiModel(),
      contents: {
        parts: [
          { inlineData: { mimeType: i.mimeType, data: i.audioBase64 } },
          { text: i.prompt },
        ],
      },
      config: {
        systemInstruction: i.systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            summary: { type: Type.STRING },
            topics: { type: Type.ARRAY, items: { type: Type.STRING } },
            decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
            actionItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  task: { type: Type.STRING },
                  assignee: { type: Type.STRING },
                  dueDate: { type: Type.STRING },
                },
                required: ['task'],
              },
            },
            segments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speaker: { type: Type.STRING },
                  timestamp: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                required: ['speaker', 'text'],
              },
            },
            rawTranscript: { type: Type.STRING },
          },
          required: ['title', 'summary', 'topics', 'decisions', 'actionItems', 'segments', 'rawTranscript'],
        },
      },
    });
    if (!res.text) throw new Error('Empty response from Gemini');
    return normalizeMeeting(JSON.parse(res.text.trim()));
  },

  refine: async (prompt) => {
    const res = await geminiClient().models.generateContent({
      model: geminiModel(),
      contents: prompt,
      config: { responseMimeType: 'application/json' },
    });
    return JSON.parse(res.text || '{}');
  },
};

// ---------- Groq ----------
const groqClient = () => new Groq({ apiKey: process.env.GROQ_API_KEY });
const groqLLM = () => process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b';

const groqProvider: Provider = {
  name: 'groq',
  isConfigured: () => !!process.env.GROQ_API_KEY,

  transcribe: async (i) => {
    const groq = groqClient();

    // 1) Audio -> timestamped text (Whisper)
    const baseMime = i.mimeType.split(';')[0] || 'audio/webm';
    const file = await toFile(Buffer.from(i.audioBase64, 'base64'), `meeting.${audioExt(i.mimeType)}`, {
      type: baseMime,
    });
    const stt: any = await groq.audio.transcriptions.create({
      file,
      model: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
    } as any);

    const plainText: string = (stt.text || '').trim();
    if (!plainText) throw new Error('Groq Whisper returned no speech');
    const timestamped = Array.isArray(stt.segments) && stt.segments.length
      ? stt.segments.map((s: any) => `[${mmss(s.start)}] ${String(s.text).trim()}`).join('\n')
      : plainText;

    // 2) Text -> structured JSON (Llama)
    const chat = await groq.chat.completions.create({
      model: groqLLM(),
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            i.systemInstruction +
            '\nYou are given a timestamped transcript produced by speech recognition instead of raw audio. ' +
            'Speaker labels are not available: infer speaker changes from context and label them "Speaker 1", ' +
            '"Speaker 2", or real names if people are addressed by name. Reply with JSON only.',
        },
        { role: 'user', content: `${i.prompt}\n\nTRANSCRIPT:\n${timestamped}` },
      ],
    });
    const content = chat.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from Groq');
    return normalizeMeeting(JSON.parse(content), plainText);
  },

  refine: async (prompt) => {
    const chat = await groqClient().chat.completions.create({
      model: groqLLM(),
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'You are the AI Meeting Secretary. Reply with JSON only.' },
        { role: 'user', content: prompt },
      ],
    });
    return JSON.parse(chat.choices[0]?.message?.content || '{}');
  },
};

// ---------- the fallback engine ----------
const registry: Record<string, Provider> = { gemini: geminiProvider, groq: groqProvider };

function getOrder(): Provider[] {
  return (process.env.PROVIDER_ORDER || 'gemini,groq')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((n) => registry[n])
    .filter(Boolean);
}

export function anyProviderConfigured(): boolean {
  return getOrder().some((p) => p.isConfigured());
}

export function providerStatus() {
  return {
    providerOrder: getOrder().map((p) => p.name),
    geminiApiKeyConfigured: geminiProvider.isConfigured(),
    groqApiKeyConfigured: groqProvider.isConfigured(),
  };
}

async function runWithFallback(fn: (p: Provider) => Promise<any>) {
  const failures: string[] = [];
  for (const p of getOrder()) {
    if (!p.isConfigured()) {
      failures.push(`${p.name}: no API key set`);
      continue;
    }
    try {
      const result = await fn(p);
      console.log(`[providers] answered by ${p.name}`);
      return { provider: p.name, result };
    } catch (err: any) {
      const msg = String(err?.message || err).slice(0, 300);
      console.warn(`[providers] ${p.name} failed: ${msg}`);
      failures.push(`${p.name}: ${msg}`);
    }
  }
  throw new Error('All AI providers failed. ' + failures.join(' | '));
}

export const analyzeAudio = (input: AudioInput) => runWithFallback((p) => p.transcribe(input));
export const refineText = (prompt: string) => runWithFallback((p) => p.refine(prompt));