'use client';

import { useEffect, useState } from 'react';

function shortAddr(a) {
  if (!a || a.length < 16) return a || '';
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

function relTime(ts) {
  const d = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)));
  if (d < 10) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  if (d < 2592000) return `${Math.floor(d / 86400)}d ago`;
  return `${Math.floor(d / 2592000)}mo ago`;
}

export function Message({ m }) {
  return (
    <div className={`msg${m.isOperator ? ' op' : ''}`}>
      <div className="head">
        <a className="who" href={`https://opensea.io/${m.address}`} target="_blank" rel="noreferrer">
          {m.name || shortAddr(m.address)}
        </a>
        {m.isOperator ? <span className="tag">operator</span> : null}
        <span className="when">{relTime(m.timestamp)}</span>
      </div>
      <div className="text">{m.text}</div>
    </div>
  );
}

export default function ChatFeed({ initial = [] }) {
  const [messages, setMessages] = useState(initial);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const res = await fetch('/api/chat/messages', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (alive && Array.isArray(data.messages)) setMessages(data.messages);
      } catch {
        // chain hiccup — keep showing what we have
      }
    }

    poll();
    const id = setInterval(() => {
      poll();
      setTick((t) => t + 1); // re-render so relative timestamps stay honest
    }, 10_000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!messages.length) {
    return <p className="dim">No messages yet.</p>;
  }

  return (
    <div data-tick={tick}>
      {messages.map((m, i) => (
        <Message key={`${m.address}-${m.timestamp}-${i}`} m={m} />
      ))}
    </div>
  );
}
