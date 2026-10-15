'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mic } from 'lucide-react';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setToken(new URLSearchParams(window.location.search).get('token') || ''), []);

  async function submit(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/password-reset/confirm', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || 'Could not reset your password.');
      setMessage(data.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <main className="authPage"><Link className="authBrand" href="/"><span className="brandIcon"><Mic/></span><b>AI Meeting Secretary</b></Link><section className="authCard"><span className="eyebrow">Account recovery</span><h1>Choose a new password</h1><p className="muted">Use at least 12 characters. This reset link expires after one hour.</p>{error && <p className="error" role="alert">{error}</p>}{message ? <><p className="successMessage" role="status">{message}</p><Link className="primary authAction" href="/login">Log in</Link></> : <form onSubmit={submit} className="stack"><label>New password<input required minLength={12} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters"/></label><button className="primary" disabled={busy || !token}>{busy ? 'Updating…' : 'Update password'}</button>{!token && <p className="error">This reset link is missing or invalid. Request a new one.</p>}</form>}<Link className="authBack" href="/login">Back to login</Link></section></main>;
}
