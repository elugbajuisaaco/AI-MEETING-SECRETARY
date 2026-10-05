import React, { useState } from 'react';
import { X, Lock, Mail, User as UserIcon, Sparkles, Check, ArrowRight, ShieldCheck } from 'lucide-react';
import { api } from '../services/api';
import { User } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
  customMessage?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  customMessage,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signin') {
        const { user } = await api.login(email, password);
        onSuccess(user);
        onClose();
      } else {
        if (!name.trim()) throw new Error('Please enter your name');
        const { user } = await api.register(email, name, password);
        onSuccess(user);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (demoEmail: string, demoName: string) => {
    setError(null);
    setLoading(true);
    try {
      // Direct login or register as demo account
      const { user } = await api.login(demoEmail, 'password123').catch(async () => {
        return await api.register(demoEmail, demoName, 'password123');
      });
      onSuccess(user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden relative">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {mode === 'signin' ? 'Welcome Back' : 'Create Secretary Account'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {customMessage || 'Save meetings permanently, organize transcripts, and export anytime'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex border-b border-slate-100 px-6 pt-2">
          <button
            onClick={() => {
              setMode('signin');
              setError(null);
            }}
            className={`pb-2.5 text-sm font-semibold border-b-2 px-3 transition-colors ${
              mode === 'signin'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => {
              setMode('signup');
              setError(null);
            }}
            className={`pb-2.5 text-sm font-semibold border-b-2 px-3 transition-colors ${
              mode === 'signup'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Quick Demo Access Bar */}
          <div className="mb-5 p-3.5 bg-indigo-50/70 border border-indigo-100 rounded-xl">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>One-Click Demo Profiles (instant access)</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleDemoLogin('sarah.product@company.com', 'Sarah Jenkins')}
                disabled={loading}
                className="px-2.5 py-1.5 bg-white hover:bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-medium text-slate-700 hover:text-indigo-900 transition-all text-left shadow-xs flex items-center justify-between"
              >
                <span>Sarah (Head of Product)</span>
                <ArrowRight className="w-3 h-3 text-indigo-500" />
              </button>
              <button
                type="button"
                onClick={() => handleDemoLogin('alex.tech@company.com', 'Alex Chen')}
                disabled={loading}
                className="px-2.5 py-1.5 bg-white hover:bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-medium text-slate-700 hover:text-indigo-900 transition-all text-left shadow-xs flex items-center justify-between"
              >
                <span>Alex (Lead Architect)</span>
                <ArrowRight className="w-3 h-3 text-indigo-500" />
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Jordan Miller"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : mode === 'signin' ? (
                'Sign In'
              ) : (
                'Create Account & Continue'
              )}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1 text-slate-600">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Encrypted session
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-500 hover:text-slate-800 underline"
            >
              Continue in Guest Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
