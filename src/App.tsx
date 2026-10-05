/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Recorder } from './components/Recorder';
import { TranscriptEditor } from './components/TranscriptEditor';
import { Dashboard } from './components/Dashboard';
import { AuthModal } from './components/AuthModal';
import { User, Meeting } from './types';
import { api, authStorage } from './services/api';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authCustomMessage, setAuthCustomMessage] = useState<string | undefined>();
  const [currentView, setCurrentView] = useState<'recorder' | 'editor' | 'dashboard'>('recorder');
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [pendingSaveAfterAuth, setPendingSaveAfterAuth] = useState(false);

  // Check existing session on load
  useEffect(() => {
    const checkSession = async () => {
      try {
        const currentUser = await api.getMe();
        if (currentUser) {
          setUser(currentUser);
        }
      } catch (err) {
        console.error('Session restore error:', err);
      }
    };
    checkSession();
  }, []);

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    if (currentView === 'dashboard') {
      setCurrentView('recorder');
    }
  };

  const handleTranscriptionSuccess = (newMeeting: Meeting) => {
    setActiveMeeting(newMeeting);
    setCurrentView('editor');
  };

  const handleUpdateMeeting = (updated: Meeting) => {
    setActiveMeeting(updated);
  };

  const handleOpenAuthForSave = () => {
    setAuthCustomMessage('Create a free account or sign in to save this meeting to your permanent cloud dashboard.');
    setPendingSaveAfterAuth(true);
    setIsAuthModalOpen(true);
  };

  const handleAuthSuccess = async (authenticatedUser: User) => {
    setUser(authenticatedUser);
    setIsAuthModalOpen(false);

    // If user was in the middle of saving a meeting
    if (pendingSaveAfterAuth && activeMeeting) {
      setPendingSaveAfterAuth(false);
      try {
        const saved = await api.createMeeting({
          ...activeMeeting,
          userId: authenticatedUser.id,
          isGuest: false,
        });
        setActiveMeeting(saved);
        alert('Meeting successfully saved to your account!');
      } catch (err: any) {
        console.error('Failed to save after login:', err);
      }
    }
  };

  const handleOpenMeetingFromDashboard = (meeting: Meeting) => {
    setActiveMeeting(meeting);
    setCurrentView('editor');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <Header
        user={user}
        currentView={currentView}
        hasActiveMeeting={!!activeMeeting}
        onNavigate={(view) => setCurrentView(view)}
        onOpenAuth={() => {
          setAuthCustomMessage(undefined);
          setPendingSaveAfterAuth(false);
          setIsAuthModalOpen(true);
        }}
        onLogout={handleLogout}
      />

      <main className="flex-1 pb-16">
        {currentView === 'recorder' && (
          <Recorder
            isGuest={!user}
            onTranscriptionSuccess={handleTranscriptionSuccess}
            onOpenAuth={() => {
              setAuthCustomMessage('Sign in to automatically sync your recordings to your dashboard.');
              setIsAuthModalOpen(true);
            }}
          />
        )}

        {currentView === 'editor' && activeMeeting && (
          <TranscriptEditor
            meeting={activeMeeting}
            isGuest={!user}
            onUpdateMeeting={handleUpdateMeeting}
            onSaveToAccount={handleOpenAuthForSave}
            onBackToRecorder={() => setCurrentView('recorder')}
            onOpenAuth={() => setIsAuthModalOpen(true)}
          />
        )}

        {currentView === 'dashboard' && user && (
          <Dashboard
            user={user}
            onOpenMeeting={handleOpenMeetingFromDashboard}
            onNewMeeting={() => setCurrentView('recorder')}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>© {new Date().getFullYear()} AI Meeting Secretary. Powered by Gemini Multimodal AI.</p>
          <div className="flex items-center gap-4 text-slate-400">
            <span>Client-side Audio Capture</span>
            <span>•</span>
            <span>GDPR/CCPA Compliant</span>
            <span>•</span>
            <span>Encrypted at Rest</span>
          </div>
        </div>
      </footer>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => {
          setIsAuthModalOpen(false);
          setPendingSaveAfterAuth(false);
        }}
        onSuccess={handleAuthSuccess}
        customMessage={authCustomMessage}
      />
    </div>
  );
}
