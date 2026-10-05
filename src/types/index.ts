export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface SpeakerSegment {
  id: string;
  speaker: string;
  timestamp: string; // e.g., "00:15"
  text: string;
}

export interface ActionItem {
  id: string;
  task: string;
  assignee?: string;
  dueDate?: string;
  completed: boolean;
}

export interface Meeting {
  id: string;
  userId?: string | null; // null for guest meetings
  title: string;
  date: string; // ISO date string
  durationSeconds: number;
  category: 'General' | 'Standup' | 'Executive' | 'Planning' | 'Sales' | '1-on-1';
  summary: string;
  topics: string[];
  decisions: string[];
  actionItems: ActionItem[];
  transcriptSegments: SpeakerSegment[];
  rawTranscript: string;
  audioUrl?: string; // local blob URL or data URL
  createdAt: string;
  updatedAt: string;
  isGuest?: boolean;
}

export interface TranscriptionRequest {
  audioBase64: string;
  mimeType: string;
  durationSeconds?: number;
  language?: string;
  meetingContext?: string;
  category?: Meeting['category'];
}

export interface TranscriptionResponse {
  title: string;
  summary: string;
  topics: string[];
  decisions: string[];
  actionItems: Array<{ task: string; assignee?: string; dueDate?: string }>;
  segments: Array<{ speaker: string; timestamp: string; text: string }>;
  rawTranscript: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isGuest: boolean;
}
