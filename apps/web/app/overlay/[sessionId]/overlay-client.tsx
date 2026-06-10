'use client';

import { useEffect, useMemo, useState } from 'react';
import { createOverlayWebSocketUrl, getApiBaseUrl } from '../../api-client';

type OverlayMessage = {
  id: string;
  platform: 'twitch' | 'kick' | 'x';
  ownerName: string;
  username: string;
  message: string;
  timestamp: string;
};

export function OverlayClient({ sessionId, token }: { sessionId: string; token: string }) {
  const [messages, setMessages] = useState<OverlayMessage[]>([]);
  const [status, setStatus] = useState('connecting');
  const wsUrl = useMemo(() => createOverlayWebSocketUrl(getApiBaseUrl(), sessionId, token), [sessionId, token]);

  useEffect(() => {
    if (!token) {
      setStatus('missing-token');
      return;
    }
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setStatus('connected');
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data) as { type: string; message?: OverlayMessage };
        if (payload.type === 'chat_message' && payload.message) {
          setMessages((current) => [...current.slice(-74), payload.message as OverlayMessage]);
        }
      };
      socket.onclose = () => {
        if (closed) return;
        setStatus('reconnecting');
        retry = setTimeout(connect, 1500);
      };
      socket.onerror = () => setStatus('connection-error');
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, [token, wsUrl]);

  return (
    <main className="overlay-shell">
      <div className="overlay-status">{status}</div>
      <div className="overlay-feed">
        {messages.map((chat) => (
          <article key={chat.id} className={`overlay-message platform-${chat.platform}`}>
            <div className="overlay-meta">
              <span className="platform">{chat.platform.toUpperCase()}</span>
              <span className="owner">{chat.ownerName}</span>
              <span className="username">@{chat.username}</span>
            </div>
            <p>{chat.message}</p>
          </article>
        ))}
      </div>
    </main>
  );
}
