import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, ClientGameView, ClientMessage, GameEvent, ServerMessage } from '@ek/shared';
import { roomSocketUrl } from '../lib/api.js';

export interface GameEventEnvelope {
  /** Monotonic local id so consumers can react to each batch once. */
  id: number;
  events: GameEvent[];
}

export interface UseGameSocket {
  connected: boolean;
  view: ClientGameView | null;
  /** Latest batch of game events (for animations); changes identity each batch. */
  lastEvents: GameEventEnvelope | null;
  /** Top-3 cards from the most recent See the Future (this player only). */
  seeFuture: Card[] | null;
  error: string | null;
  send: (msg: ClientMessage) => void;
  clearSeeFuture: () => void;
}

export function useGameSocket(code: string, pid: string, name: string): UseGameSocket {
  const [connected, setConnected] = useState(false);
  const [view, setView] = useState<ClientGameView | null>(null);
  const [lastEvents, setLastEvents] = useState<GameEventEnvelope | null>(null);
  const [seeFuture, setSeeFuture] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const eventSeq = useRef(0);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const closedByUs = useRef(false);

  const connect = useCallback(() => {
    const ws = new WebSocket(roomSocketUrl(code, pid, name));
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      if (!closedByUs.current) {
        reconnectRef.current = setTimeout(connect, 1000);
      }
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      switch (msg.t) {
        case 'view':
          setView(msg.view);
          break;
        case 'events':
          eventSeq.current += 1;
          setLastEvents({ id: eventSeq.current, events: msg.events });
          break;
        case 'see_future':
          setSeeFuture(msg.cards);
          break;
        case 'error':
          setError(msg.message);
          setTimeout(() => setError(null), 3000);
          break;
        case 'joined':
          break;
      }
    };
  }, [code, pid, name]);

  useEffect(() => {
    closedByUs.current = false;
    connect();
    return () => {
      closedByUs.current = true;
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const clearSeeFuture = useCallback(() => setSeeFuture(null), []);

  return { connected, view, lastEvents, seeFuture, error, send, clearSeeFuture };
}
