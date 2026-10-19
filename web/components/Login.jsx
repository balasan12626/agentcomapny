'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

export function Login() {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    try { await api('/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } }); location.reload(); }
    catch (err) { setError(err.status === 401 ? 'Invalid email or password' : err.message); setBusy(false); }
  }
  return (
    <main style={{ maxWidth: 380, margin: '12vh auto' }}>
      <div className="brand" style={{ fontSize: 20 }}><span>DATYLUNE</span> AI OS</div>
      <form className="card" onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
        {error && <p role="alert" className="s-err">{error}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
