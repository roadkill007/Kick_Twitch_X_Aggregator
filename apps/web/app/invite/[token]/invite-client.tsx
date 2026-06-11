'use client';

import { FormEvent, useEffect, useState } from 'react';
import { API_BASE_URL, apiRequest, getApiBaseUrl } from '../../api-client';

type User = { id: string; email: string };
type AuthResponse = { token: string; user: User };
type CollaboratorResponse = { collaborator: { id: string; shared_session_id: string; display_label: string; role: string; status: string } };

export function InviteClient({ inviteToken }: { inviteToken: string }) {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authForm, setAuthForm] = useState({ email: '', password: '', displayName: '', handle: '' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(API_BASE_URL);

  useEffect(() => {
    setApiBaseUrl(getApiBaseUrl());
    const storedToken = window.localStorage.getItem('sca_token') ?? '';
    const storedUser = window.localStorage.getItem('sca_user');
    if (storedToken) setToken(storedToken);
    if (storedUser) setUser(JSON.parse(storedUser));
  }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const payload = authMode === 'register' ? authForm : { email: authForm.email, password: authForm.password };
      const data = await apiRequest<AuthResponse>(`/api/v1/auth/${authMode}`, { body: payload });
      setToken(data.token);
      setUser(data.user);
      window.localStorage.setItem('sca_token', data.token);
      window.localStorage.setItem('sca_user', JSON.stringify(data.user));
      setMessage(`Signed in as ${data.user.email}. Now accept the invite.`);
    });
  }

  async function acceptInvite() {
    if (!token) return;
    await run(async () => {
      const data = await apiRequest<CollaboratorResponse>(`/api/v1/invitations/${encodeURIComponent(inviteToken)}/accept`, { token, method: 'POST' });
      setMessage(`Invite accepted as ${data.collaborator.display_label}. Go to the dashboard to connect your platforms and start providers.`);
    });
  }

  async function declineInvite() {
    await run(async () => {
      await apiRequest(`/api/v1/invitations/${encodeURIComponent(inviteToken)}/decline`, { method: 'POST' });
      setMessage('Invite declined.');
    });
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Shared Chat Session invite</p>
          <h1>Join a collaborative stream chat session</h1>
          <p>Accept this invite, then connect your own Twitch, Kick, and X accounts from the dashboard. Your messages will join the same unified session and overlay.</p>
        </div>
        <div className="status-card">
          <span>API</span>
          <strong>{apiBaseUrl}</strong>
          <span>Status</span>
          <strong>{user ? `Signed in as ${user.email}` : 'Sign in required'}</strong>
        </div>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      {!token || !user ? (
        <section className="card auth-card">
          <div className="tabs">
            <button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>Register</button>
            <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Login</button>
          </div>
          <form onSubmit={submitAuth} className="form-grid">
            <label>Email<input type="email" required value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} /></label>
            <label>Password<input type="password" required minLength={8} value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} /></label>
            {authMode === 'register' ? (
              <>
                <label>Display name<input required value={authForm.displayName} onChange={(e) => setAuthForm({ ...authForm, displayName: e.target.value })} /></label>
                <label>Handle<input required value={authForm.handle} onChange={(e) => setAuthForm({ ...authForm, handle: e.target.value })} /></label>
              </>
            ) : null}
            <button disabled={busy}>{busy ? 'Working…' : authMode === 'register' ? 'Create account' : 'Login'}</button>
          </form>
        </section>
      ) : (
        <section className="card">
          <h2>Accept invite</h2>
          <p>This adds your account as a collaborator in the Shared Chat Session. You will then see the session on the dashboard.</p>
          <div className="control-row">
            <button disabled={busy} onClick={() => void acceptInvite()}>Accept invite</button>
            <button className="secondary" disabled={busy} onClick={() => void declineInvite()}>Decline</button>
            <a className="button-link" href="/">Open dashboard</a>
          </div>
        </section>
      )}
    </main>
  );
}
