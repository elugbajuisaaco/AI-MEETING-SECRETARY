import { Meeting, TranscriptionRequest, TranscriptionResponse, User } from '../types';

const TOKEN_KEY = 'meeting_secretary_auth_token';

export const authStorage = {
  getToken: (): string | null => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clearToken: (): void => localStorage.removeItem(TOKEN_KEY),
};

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = authStorage.getToken();
  const headers = new Headers(options.headers || {});
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(url, { ...options, headers });
}

export const api = {
  // Auth
  async login(email: string, password?: string): Promise<{ user: User; token: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Login failed' }));
      throw new Error(err.error || 'Login failed');
    }
    const data = await res.json();
    authStorage.setToken(data.token);
    return data;
  },

  async register(email: string, name: string, password?: string): Promise<{ user: User; token: string }> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Registration failed' }));
      throw new Error(err.error || 'Registration failed');
    }
    const data = await res.json();
    authStorage.setToken(data.token);
    return data;
  },

  async getMe(): Promise<User | null> {
    const token = authStorage.getToken();
    if (!token) return null;
    try {
      const res = await fetchWithAuth('/api/auth/me');
      if (!res.ok) {
        authStorage.clearToken();
        return null;
      }
      const data = await res.json();
      return data.user;
    } catch {
      return null;
    }
  },

  async logout(): Promise<void> {
    authStorage.clearToken();
  },

  // Transcribe with Gemini on Backend
  async transcribeAudio(payload: TranscriptionRequest): Promise<TranscriptionResponse> {
    const res = await fetchWithAuth('/api/transcribe', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Transcription failed' }));
      throw new Error(err.error || 'Failed to transcribe audio with Gemini AI');
    }
    return res.json();
  },

  // AI Refine/Summarize
  async refineMeeting(meeting: Partial<Meeting>, instruction: string): Promise<Partial<Meeting>> {
    const res = await fetchWithAuth('/api/ai/refine', {
      method: 'POST',
      body: JSON.stringify({ meeting, instruction }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'AI refinement failed' }));
      throw new Error(err.error || 'Failed to refine meeting with AI');
    }
    return res.json();
  },

  // Meetings CRUD
  async getMeetings(search?: string, category?: string): Promise<Meeting[]> {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category && category !== 'All') params.set('category', category);

    const res = await fetchWithAuth(`/api/meetings?${params.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to fetch meetings');
    }
    return res.json();
  },

  async getMeeting(id: string): Promise<Meeting> {
    const res = await fetchWithAuth(`/api/meetings/${id}`);
    if (!res.ok) {
      throw new Error('Failed to fetch meeting');
    }
    return res.json();
  },

  async createMeeting(meeting: Omit<Meeting, 'id' | 'createdAt' | 'updatedAt'>): Promise<Meeting> {
    const res = await fetchWithAuth('/api/meetings', {
      method: 'POST',
      body: JSON.stringify(meeting),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to save meeting' }));
      throw new Error(err.error || 'Failed to save meeting');
    }
    return res.json();
  },

  async updateMeeting(id: string, meeting: Partial<Meeting>): Promise<Meeting> {
    const res = await fetchWithAuth(`/api/meetings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(meeting),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update meeting' }));
      throw new Error(err.error || 'Failed to update meeting');
    }
    return res.json();
  },

  async deleteMeeting(id: string): Promise<void> {
    const res = await fetchWithAuth(`/api/meetings/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new Error('Failed to delete meeting');
    }
  },
};
