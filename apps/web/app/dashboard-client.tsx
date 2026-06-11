'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { API_BASE_URL, apiRequest, getApiBaseUrl } from './api-client';

type User = { id: string; email: string };
type SharedSession = { id: string; name: string; slug: string; description?: string; is_active?: boolean };
type Connection = { platform: 'twitch' | 'kick' | 'x'; external_username?: string; external_account_id?: string; status: string };
type ProviderStatus = { sessionId: string; platform: 'twitch' | 'kick' | 'x'; status: string; ownerName?: string; error?: string };
type Collaborator = { id: string; user_id?: string; invited_email?: string; display_label: string; role: 'owner' | 'admin' | 'member'; status: 'active' | 'invited' | 'declined' };

type AuthResponse = { token: string; user: User };
type SessionListResponse = { sharedSessions: SharedSession[] };
type ConnectionListResponse = { connections: Connection[] };
type ProviderListResponse = { providers: ProviderStatus[] };
type CollaboratorListResponse = { collaborators: Collaborator[] };

const initialAuth = { email: '', password: '', displayName: '', handle: '' };

export function DashboardClient() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authForm, setAuthForm] = useState(initialAuth);
  const [sessions, setSessions] = useState<SharedSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [sessionForm, setSessionForm] = useState({ name: '', creatorLabel: '', description: '' });
  const [providerForm, setProviderForm] = useState({ kickUsername: '', xBroadcastUrl: '' });
  const [inviteForm, setInviteForm] = useState({ email: '', displayLabel: '', role: 'member' as 'admin' | 'member' });
  const [inviteUrl, setInviteUrl] = useState('');
  const [overlayUrl, setOverlayUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(API_BASE_URL);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  useEffect(() => {
    setApiBaseUrl(getApiBaseUrl());
    const storedToken = window.localStorage.getItem('sca_token') ?? '';
    const storedUser = window.localStorage.getItem('sca_user');
    if (storedToken) setToken(storedToken);
    if (storedUser) setUser(JSON.parse(storedUser));
  }, []);

  useEffect(() => {
    if (token) void refreshWorkspace(token);
  }, [token]);

  async function refreshWorkspace(activeToken = token, sessionId = selectedSessionId) {
    if (!activeToken) return;
    const [sessionData, connectionData] = await Promise.all([
      apiRequest<SessionListResponse>('/api/v1/shared-sessions', { token: activeToken }),
      apiRequest<ConnectionListResponse>('/api/v1/connections', { token: activeToken }),
    ]);
    setSessions(sessionData.sharedSessions);
    setConnections(connectionData.connections);
    const nextSessionId = sessionId || sessionData.sharedSessions[0]?.id || '';
    setSelectedSessionId(nextSessionId);
    if (nextSessionId) {
      const [providerData, collaboratorData] = await Promise.all([
        apiRequest<ProviderListResponse>(`/api/v1/shared-sessions/${nextSessionId}/providers`, { token: activeToken }),
        apiRequest<CollaboratorListResponse>(`/api/v1/shared-sessions/${nextSessionId}/collaborators`, { token: activeToken }),
      ]);
      setProviders(providerData.providers);
      setCollaborators(collaboratorData.collaborators);
    }
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const payload = authMode === 'register'
        ? authForm
        : { email: authForm.email, password: authForm.password };
      const data = await apiRequest<AuthResponse>(`/api/v1/auth/${authMode}`, { body: payload });
      setToken(data.token);
      setUser(data.user);
      window.localStorage.setItem('sca_token', data.token);
      window.localStorage.setItem('sca_user', JSON.stringify(data.user));
      setMessage(`Signed in as ${data.user.email}`);
    });
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const data = await apiRequest<{ sharedSession: SharedSession }>('/api/v1/shared-sessions', {
        token,
        body: {
          name: sessionForm.name,
          creatorLabel: sessionForm.creatorLabel || undefined,
          description: sessionForm.description || undefined,
        },
      });
      setSessionForm({ name: '', creatorLabel: '', description: '' });
      setSelectedSessionId(data.sharedSession.id);
      await refreshWorkspace(token, data.sharedSession.id);
      setMessage(`Created Shared Chat Session: ${data.sharedSession.name}`);
    });
  }

  async function connectTwitch() {
    await run(async () => {
      const data = await apiRequest<{ authorizationUrl: string; redirectUri: string }>('/api/v1/connections/twitch/start', { token });
      window.open(data.authorizationUrl, '_blank', 'noopener,noreferrer');
      setMessage(`Opened Twitch OAuth. Redirect URI: ${data.redirectUri}`);
    });
  }

  async function connectKick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await apiRequest('/api/v1/connections/kick/resolve', { token, body: { username: providerForm.kickUsername } });
      await refreshWorkspace();
      setMessage(`Connected Kick channel ${providerForm.kickUsername}`);
    });
  }

  async function connectX(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await apiRequest('/api/v1/connections/x/resolve', { token, body: { broadcastUrl: providerForm.xBroadcastUrl } });
      await refreshWorkspace();
      setMessage('Connected X broadcast link');
    });
  }

  async function startProvider(platform: 'twitch' | 'kick' | 'x') {
    if (!selectedSessionId) return;
    await run(async () => {
      await apiRequest(`/api/v1/shared-sessions/${selectedSessionId}/providers/${platform}/start`, { token, method: 'POST' });
      await refreshWorkspace(token, selectedSessionId);
      setMessage(`Started ${platform.toUpperCase()} for ${selectedSession?.name ?? 'session'}`);
    });
  }

  async function stopProvider(platform: 'twitch' | 'kick' | 'x') {
    if (!selectedSessionId) return;
    await run(async () => {
      await apiRequest(`/api/v1/shared-sessions/${selectedSessionId}/providers/${platform}/stop`, { token, method: 'POST' });
      await refreshWorkspace(token, selectedSessionId);
      setMessage(`Stopped ${platform.toUpperCase()}`);
    });
  }

  async function inviteCollaborator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSessionId) return;
    await run(async () => {
      const data = await apiRequest<{ invitation: Collaborator; token: string }>(`/api/v1/shared-sessions/${selectedSessionId}/invitations`, {
        token,
        body: { email: inviteForm.email, displayLabel: inviteForm.displayLabel, role: inviteForm.role },
      });
      const url = `${window.location.origin}/invite/${encodeURIComponent(data.token)}`;
      setInviteUrl(url);
      setInviteForm({ email: '', displayLabel: '', role: 'member' });
      await refreshWorkspace(token, selectedSessionId);
      setMessage(`Created invite for ${data.invitation.invited_email}. Send them the private invite link.`);
    });
  }

  async function createOverlayToken() {
    if (!selectedSessionId) return;
    await run(async () => {
      const data = await apiRequest<{ token: string; overlayUrl: string }>(`/api/v1/shared-sessions/${selectedSessionId}/overlay-token`, { token, method: 'POST' });
      setOverlayUrl(data.overlayUrl);
      setMessage('Created OBS/Streamlabs browser-source overlay URL. Keep it private.');
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

  function logout() {
    window.localStorage.removeItem('sca_token');
    window.localStorage.removeItem('sca_user');
    setToken('');
    setUser(null);
    setSessions([]);
    setConnections([]);
    setProviders([]);
    setCollaborators([]);
    setInviteUrl('');
    setSelectedSessionId('');
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Level 4 Product UI</p>
          <h1>Unified Twitch, Kick, and X livestream chat</h1>
          <p>
            Create a Shared Chat Session, connect the platforms each creator owns, then start the real provider listeners for a unified feed.
          </p>
        </div>
        <div className="status-card">
          <span>API</span>
          <strong>{apiBaseUrl}</strong>
          <span>Session</span>
          <strong>{selectedSession?.name ?? 'None selected'}</strong>
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
        <div className="workspace">
          <section className="card account-card">
            <div>
              <p className="eyebrow">Signed in</p>
              <h2>{user.email}</h2>
            </div>
            <button className="secondary" onClick={logout}>Logout</button>
          </section>

          <section className="card">
            <h2>Create Shared Chat Session</h2>
            <form onSubmit={createSession} className="form-grid">
              <label>Session name<input required value={sessionForm.name} onChange={(e) => setSessionForm({ ...sessionForm, name: e.target.value })} /></label>
              <label>Your creator label<input placeholder="Host, Guest, Creator A…" value={sessionForm.creatorLabel} onChange={(e) => setSessionForm({ ...sessionForm, creatorLabel: e.target.value })} /></label>
              <label className="wide">Description<input value={sessionForm.description} onChange={(e) => setSessionForm({ ...sessionForm, description: e.target.value })} /></label>
              <button disabled={busy}>Create session</button>
            </form>
          </section>

          <section className="card">
            <h2>Shared Chat Sessions</h2>
            <div className="session-list">
              {sessions.map((session) => (
                <button key={session.id} className={session.id === selectedSessionId ? 'active session-button' : 'session-button'} onClick={() => void refreshWorkspace(token, session.id)}>
                  <strong>{session.name}</strong>
                  <span>{session.slug}</span>
                </button>
              ))}
              {!sessions.length ? <p>No sessions yet.</p> : null}
            </div>
          </section>


          <section className="card">
            <h2>Invite collaborators</h2>
            <p>Invite another creator into the selected Shared Chat Session. After they accept, they can connect their own Twitch, Kick, and X accounts to the same session.</p>
            <form onSubmit={inviteCollaborator} className="form-grid">
              <label>Email<input type="email" required value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} /></label>
              <label>Creator label<input required placeholder="Guest B, Co-host…" value={inviteForm.displayLabel} onChange={(e) => setInviteForm({ ...inviteForm, displayLabel: e.target.value })} /></label>
              <label>Role<select value={inviteForm.role} onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value as 'admin' | 'member' })}><option value="member">Member</option><option value="admin">Admin</option></select></label>
              <button disabled={!selectedSessionId || busy}>Create invite link</button>
            </form>
            {inviteUrl ? (
              <div className="overlay-url-box">
                <strong>Private invite link</strong>
                <input readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} />
              </div>
            ) : null}
            <div className="provider-list">
              {collaborators.map((collaborator) => (
                <div key={collaborator.id} className="provider-row">
                  <strong>{collaborator.display_label}</strong>
                  <span>{collaborator.role}</span>
                  <span>{collaborator.status}</span>
                  <span>{collaborator.invited_email ?? collaborator.user_id ?? 'creator'}</span>
                </div>
              ))}
              {!collaborators.length ? <p>No collaborators loaded for this session.</p> : null}
            </div>
          </section>

          <section className="card platform-grid">
            <div>
              <h2>Connect Twitch</h2>
              <p>Connect the Twitch account that owns the chat access.</p>
              <button onClick={connectTwitch} disabled={busy}>Open Twitch OAuth</button>
            </div>
            <form onSubmit={connectKick}>
              <h2>Connect Kick</h2>
              <label>Kick channel<input required value={providerForm.kickUsername} onChange={(e) => setProviderForm({ ...providerForm, kickUsername: e.target.value })} /></label>
              <button disabled={busy}>Save Kick channel</button>
            </form>
            <form onSubmit={connectX}>
              <h2>Connect X</h2>
              <label>X broadcast URL<input required placeholder="https://x.com/i/broadcasts/..." value={providerForm.xBroadcastUrl} onChange={(e) => setProviderForm({ ...providerForm, xBroadcastUrl: e.target.value })} /></label>
              <button disabled={busy}>Save X broadcast</button>
            </form>
          </section>

          <section className="card">
            <h2>Connections</h2>
            <div className="pill-row">
              {connections.map((connection) => (
                <span className="pill" key={connection.platform}>{connection.platform.toUpperCase()} · {connection.status} · {connection.external_username ?? 'configured'}</span>
              ))}
              {!connections.length ? <p>No platforms connected yet.</p> : null}
            </div>
          </section>

          <section className="card">
            <h2>Provider controls</h2>
            <p>Start or stop real provider listeners for the selected Shared Chat Session.</p>
            <div className="control-row">
              {(['twitch', 'kick', 'x'] as const).map((platform) => (
                <div className="control-card" key={platform}>
                  <strong>{platform.toUpperCase()}</strong>
                  <div>
                    <button disabled={!selectedSessionId || busy} onClick={() => void startProvider(platform)}>Start</button>
                    <button className="secondary" disabled={!selectedSessionId || busy} onClick={() => void stopProvider(platform)}>Stop</button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Active provider status</h2>
            <div className="provider-list">
              {providers.map((provider) => (
                <div key={`${provider.platform}-${provider.sessionId}`} className="provider-row">
                  <strong>{provider.platform.toUpperCase()}</strong>
                  <span>{provider.status}</span>
                  <span>{provider.ownerName ?? 'Creator'}</span>
                  {provider.error ? <span className="error">{provider.error}</span> : null}
                </div>
              ))}
              {!providers.length ? <p>No provider listeners running for this session.</p> : null}
            </div>
          </section>

          <section className="card">
            <h2>OBS / Streamlabs browser-source overlay</h2>
            <p>Create a private browser-source URL for the selected Shared Chat Session. Add it as a browser source in OBS or Streamlabs.</p>
            <button disabled={!selectedSessionId || busy} onClick={() => void createOverlayToken()}>Create overlay URL</button>
            {overlayUrl ? (
              <div className="overlay-url-box">
                <strong>Private overlay URL</strong>
                <input readOnly value={overlayUrl} onFocus={(event) => event.currentTarget.select()} />
              </div>
            ) : null}
          </section>
        </div>
      )}
    </main>
  );
}

