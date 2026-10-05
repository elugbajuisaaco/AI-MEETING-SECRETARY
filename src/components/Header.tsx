import React, { useState } from 'react';
import {
  Mic,
  LayoutDashboard,
  User as UserIcon,
  LogOut,
  Sparkles,
  AlertTriangle,
  LogIn,
  CheckCircle2,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { User } from '../types';

interface HeaderProps {
  user: User | null;
  currentView: 'recorder' | 'editor' | 'dashboard';
  hasActiveMeeting: boolean;
  onNavigate: (view: 'recorder' | 'editor' | 'dashboard') => void;
  onOpenAuth: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  user,
  currentView,
  hasActiveMeeting,
  onNavigate,
  onOpenAuth,
  onLogout,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      {/* Guest Mode Warning Banner */}
      {!user && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs md:text-sm text-amber-900 flex items-center justify-between">
          <div className="flex items-center gap-2 max-w-4xl mx-auto w-full">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Guest Mode Active:</strong> Recordings and transcripts in this session are ephemeral.
              They will be lost if you refresh or close this tab.
            </span>
            <button
              onClick={onOpenAuth}
              className="ml-auto underline font-medium text-amber-950 hover:text-amber-800 shrink-0"
            >
              Sign In to Save
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <div
          onClick={() => onNavigate('recorder')}
          className="flex items-center gap-3 cursor-pointer select-none group"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-200 group-hover:scale-105 transition-transform">
            <Mic className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg tracking-tight text-slate-900">AI Meeting Secretary</span>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200 flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> Gemini
              </span>
            </div>
            <p className="text-xs text-slate-500 hidden sm:block">
              Live Transcription • Executive Summaries • Action Items
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 sm:gap-2">
          <button
            onClick={() => onNavigate('recorder')}
            className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              currentView === 'recorder'
                ? 'bg-indigo-50 text-indigo-700 font-semibold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Mic className="w-4 h-4" />
            <span className="hidden sm:inline">Record Meeting</span>
          </button>

          {hasActiveMeeting && (
            <button
              onClick={() => onNavigate('editor')}
              className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                currentView === 'editor'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Current Transcript</span>
            </button>
          )}

          {user && (
            <button
              onClick={() => onNavigate('dashboard')}
              className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                currentView === 'dashboard'
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Saved Meetings</span>
            </button>
          )}
        </nav>

        {/* User Profile or Sign In */}
        <div className="relative">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2.5 p-1.5 pl-3 rounded-full border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all text-sm font-medium text-slate-700"
              >
                <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs uppercase">
                  {user.name ? user.name[0] : 'U'}
                </div>
                <span className="max-w-[120px] truncate hidden md:inline">{user.name || user.email}</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {dropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setDropdownOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-100 py-1.5 z-40 animate-in fade-in slide-in-from-top-2">
                    <div className="px-4 py-2 border-b border-slate-100">
                      <p className="text-xs font-medium text-slate-500">Signed in as</p>
                      <p className="text-sm font-semibold text-slate-900 truncate">{user.email}</p>
                    </div>

                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onNavigate('dashboard');
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5"
                    >
                      <LayoutDashboard className="w-4 h-4 text-slate-400" />
                      Dashboard & Past Meetings
                    </button>

                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onNavigate('recorder');
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2.5"
                    >
                      <Mic className="w-4 h-4 text-slate-400" />
                      New Recording
                    </button>

                    <div className="border-t border-slate-100 my-1"></div>

                    <button
                      onClick={() => {
                        setDropdownOpen(false);
                        onLogout();
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5"
                    >
                      <LogOut className="w-4 h-4 text-red-500" />
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenAuth}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-sm flex items-center gap-1.5"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign In / Register</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
