'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DashboardRoute() {
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(({ user }) => router.replace(user ? '/?view=dashboard' : '/login?next=%2Fdashboard'))
      .catch(() => router.replace('/login?next=%2Fdashboard'));
  }, [router]);

  return <main className="routeLoading"><span className="spinner"/><p>Opening your dashboard…</p></main>;
}
