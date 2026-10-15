'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mic } from 'lucide-react';

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || 'Request failed');
  return data;
}

export default function AuthPage({ mode }) {
  const router = useRouter();
  const signup = mode === 'signup';
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [canResend, setCanResend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState('/dashboard');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    if (next?.startsWith('/') && !next.startsWith('//')) setDestination(next);
    request('/api/auth/me').then(({ user }) => { if (user) router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'); }).catch(() => {});
  }, [router]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await request(`/api/auth/${signup ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, ...(signup ? { name } : {}) }),
      });
      if (signup) setMessage('Check your email for a verification link. It expires in 24 hours.');
      else router.replace(destination);
    } catch (err) {
      setError(err.message);
      setCanResend(!signup && err.message.includes('Verify your email'));
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setError('');
    try {
      const result = await request('/api/auth/verification/resend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      setMessage(result.message);
      setCanResend(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  const otherPath = `${signup ? '/login' : '/signup'}${destination !== '/dashboard' ? `?next=${encodeURIComponent(destination)}` : ''}`;
  return <main className="authPage">
    <Link className="authBrand" href="/"><span className="brandIcon"><Mic/></span><b>AI Meeting Secretary</b></Link>
    <section className="authCard">
      <span className="eyebrow">{signup ? 'Start for free' : 'Welcome back'}</span>
      <h1>{signup ? 'Create your account' : 'Log in to your account'}</h1>
      <p className="muted">{signup ? 'Save your meetings and turn recordings into clear next steps.' : 'Open your saved meetings and continue where you left off.'}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="successMessage" role="status">{message}</p>}
      {!message && <form onSubmit={submit} className="stack">
        {signup && <label>Your name<input required autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Full name"/></label>}
        <label>Email address<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/></label>
        <label>Password<input required type="password" minLength={signup ? 12 : 1} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={signup ? 'At least 12 characters' : 'Your password'}/></label>
        <button className="primary" disabled={busy}>{busy ? 'Please wait…' : signup ? 'Create account' : 'Log in'}</button>
      </form>}
      {canResend && <button className="textButton" disabled={busy} onClick={resendVerification}>Resend verification email</button>}
      {!signup && <Link className="authForgot" href="/forgot-password">Forgot your password?</Link>}
      <p className="authSwitch">{signup ? 'Already have an account?' : 'New to AI Meeting Secretary?'} <Link href={otherPath}>{signup ? 'Log in' : 'Sign up'}</Link></p>
      <Link className="authBack" href="/">← Back to home</Link>
    </section>
  </main>;
}
