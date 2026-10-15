'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Mic } from 'lucide-react';

export default function VerifyEmailPage() {
  const [message, setMessage] = useState('Verifying your email…');
  const [success, setSuccess] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) { setMessage('This verification link is missing its token. Request a new one from the login page.'); return; }
    fetch(`/api/auth/verify?token=${encodeURIComponent(token)}`, { method: 'POST', credentials: 'same-origin' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || 'This verification link is invalid or expired.');
        setMessage(data.message || 'Your email is verified. You can log in now.');
        setSuccess(true);
      })
      .catch(error => setMessage(error.message));
  }, []);

  return <main className="authPage"><Link className="authBrand" href="/"><span className="brandIcon"><Mic/></span><b>AI Meeting Secretary</b></Link><section className="authCard"><span className="eyebrow">Email verification</span><h1>{success ? 'You’re all set' : 'Verify your email'}</h1><p className={success ? 'successMessage' : 'muted'} role="status">{message}</p>{success && <Link className="primary authAction" href="/login">Log in</Link>}{!success && <Link className="authBack" href="/login">Back to login</Link>}</section></main>;
}
