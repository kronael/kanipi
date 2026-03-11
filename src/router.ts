import { Channel, NewMessage, Platform, Route } from './types.js';

// Derive a valid group folder segment from a JID.
// Replaces non-alphanumeric chars with _, collapses consecutive _, trims.
// e.g. "tg:-100123456" → "tg_100123456"
export function spawnFolderName(jid: string): string {
  return jid
    .replace(/[^A-Za-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 63);
}

export function platformFromJid(jid: string): Platform {
  return jid.split(':')[0] as Platform;
}

export function parseJid(jid: string): {
  scheme: string;
  id: string;
  name?: string;
  isSender: boolean;
} {
  const colonIdx = jid.indexOf(':');
  if (colonIdx === -1) return { scheme: '', id: jid, isSender: false };
  const scheme = jid.slice(0, colonIdx);
  let rest = jid.slice(colonIdx + 1);
  const isSender = rest.startsWith('~');
  if (isSender) rest = rest.slice(1);
  const hashIdx = rest.indexOf('#');
  if (hashIdx === -1) return { scheme, id: rest, isSender };
  return {
    scheme,
    id: rest.slice(0, hashIdx),
    name: rest.slice(hashIdx + 1),
    isSender,
  };
}

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map((m) => {
    const parts: string[] = [];
    if (m.forwarded_from) {
      parts.push(`<forwarded_from sender="${escapeXml(m.forwarded_from)}"/>`);
    }
    if (m.reply_to_text) {
      const rSender = m.reply_to_sender || '(unknown)';
      parts.push(
        `<reply_to sender="${escapeXml(rSender)}">${escapeXml(m.reply_to_text)}</reply_to>`,
      );
    }
    parts.push(escapeXml(m.content));
    const inner = parts.join('\n');
    let attrs = `sender="${escapeXml(m.sender_name ?? m.sender)}" time="${m.timestamp}"`;
    if (m.platform) attrs += ` platform="${escapeXml(m.platform)}"`;
    if (m.verb) attrs += ` verb="${escapeXml(m.verb)}"`;
    if (m.group_name) attrs += ` group="${escapeXml(m.group_name)}"`;
    if (m.mentions_me === true) attrs += ` mentions_me="true"`;
    if (m.thread) attrs += ` thread="${escapeXml(m.thread)}"`;
    if (m.target) attrs += ` target="${escapeXml(m.target)}"`;
    const tag = `<message ${attrs}>`;
    if (parts.length === 1) return `${tag}${inner}</message>`;
    return `${tag}\n${inner}\n</message>`;
  });
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  return stripInternalTags(rawText);
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}

// First match wins. Routes ordered by seq from DB.
export function resolveRoute(msg: NewMessage, routes: Route[]): string | null {
  for (const r of routes) {
    if (r.type === 'command') {
      const t = msg.content.trim();
      if (r.match && (t === r.match || t.startsWith(r.match + ' ')))
        return r.target;
    } else if (r.type === 'verb') {
      if (msg.verb === r.match) return r.target;
    } else if (r.type === 'pattern') {
      if (!r.match || r.match.length > 200) continue;
      try {
        if (new RegExp(r.match).test(msg.content)) return r.target;
      } catch {}
    } else if (r.type === 'keyword') {
      if (r.match && msg.content.toLowerCase().includes(r.match.toLowerCase()))
        return r.target;
    } else if (r.type === 'sender') {
      if (!r.match || r.match.length > 200) continue;
      try {
        if (new RegExp(r.match).test(msg.sender_name ?? msg.sender))
          return r.target;
      } catch {}
    } else if (r.type === 'trigger') {
      return r.target;
    } else if (r.type === 'default') {
      return r.target;
    }
  }
  return null;
}

// Returns true if source group may delegate/route to target:
// root can delegate to any folder; otherwise same world + descendant.
export function isAuthorizedRoutingTarget(
  sourceFolder: string,
  targetFolder: string,
): boolean {
  if (sourceFolder.split('/')[0] === 'root') return true;
  const sourceRoot = sourceFolder.split('/')[0];
  const targetRoot = targetFolder.split('/')[0];
  if (sourceRoot !== targetRoot) return false;
  return targetFolder.startsWith(sourceFolder + '/');
}
