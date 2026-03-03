import type { ServerResponse } from 'http';

import type { Channel } from '../types.js';

// SSE listeners keyed by group folder
const listeners = new Map<string, Set<ServerResponse>>();

export function addSseListener(group: string, res: ServerResponse): void {
  if (!listeners.has(group)) listeners.set(group, new Set());
  listeners.get(group)!.add(res);
}

export function removeSseListener(group: string, res: ServerResponse): void {
  listeners.get(group)?.delete(res);
}

export class WebChannel implements Channel {
  name = 'web';

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  isConnected(): boolean {
    return true;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('web:');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    // jid format: "web:<group>"
    const group = jid.slice(4);
    const set = listeners.get(group);
    if (!set || set.size === 0) return;
    const payload = `data: ${JSON.stringify({ text })}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
  }
}
