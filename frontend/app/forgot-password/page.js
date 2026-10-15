'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Mic } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/password-reset', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Could not request a reset link.');
      setMessage(data.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <main className="authPage"><Link className="authBrand" href="/"><span className="brandIcon"><Mic/></span><b>AI Meeting Secretary</b></Link><section className="authCard"><span className="eyebrow">Account recovery</span><h1>Reset your password</h1><p className="muted">Enter your account email and we’ll send a reset link if there’s a matching account.</p>{error && <p className="error" role="alert">{error}</p>}{message ? <p className="successMessage" role="status">{message}</p> : <form onSubmit={submit} className="stack"><label>Email address<input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/></label><button className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button></form>}<Link className="authBack" href="/login">Back to login</Link></section></main>;
}
