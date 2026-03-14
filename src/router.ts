import fs from 'fs';
import path from 'path';

import { Channel, NewMessage, Platform, Route } from './types.js';

// Platform short codes for user file naming
const PLATFORM_SHORT: Record<string, string> = {
  telegram: 'tg',
  whatsapp: 'wa',
  discord: 'dc',
  email: 'em',
  web: 'web',
  reddit: 'rd',
  twitter: 'tw',
  mastodon: 'ms',
  bluesky: 'bs',
  twitch: 'tc',
  youtube: 'yt',
  facebook: 'fb',
  instagram: 'ig',
  threads: 'th',
  linkedin: 'li',
};

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

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function timeAgo(iso: string, now?: number): string {
  const ms = (now ?? Date.now()) - new Date(iso).getTime();
  if (ms < 0) return '0s';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  if (ms < 604_800_000) return `${Math.floor(ms / 86_400_000)}d`;
  return `${Math.floor(ms / 604_800_000)}w`;
}

export function clockXml(tz: string): string {
  return `<clock time="${new Date().toISOString()}" tz="${escapeXml(tz)}" />`;
}

export function formatMessages(messages: NewMessage[], now?: number): string {
  const t = now ?? Date.now();
  const lines = messages.map((m) => {
    const parts: string[] = [];
    if (m.forwarded_from) {
      const attrs = [`sender="${escapeXml(m.forwarded_from)}"`];
      if (m.forwarded_from_id)
        attrs.push(`chat="${escapeXml(m.forwarded_from_id)}"`);
      if (m.forwarded_msgid) attrs.push(`id="${escapeXml(m.forwarded_msgid)}"`);
      parts.push(`<forwarded_from ${attrs.join(' ')}/>`);
    }
    if (m.reply_to_text) {
      const rSender = m.reply_to_sender || '(unknown)';
      const idAttr = m.reply_to_id ? ` id="${escapeXml(m.reply_to_id)}"` : '';
      parts.push(
        `<reply_to sender="${escapeXml(rSender)}"${idAttr}>${escapeXml(m.reply_to_text)}</reply_to>`,
      );
    }
    parts.push(escapeXml(m.content));
    const inner = parts.join('\n');
    const a = [
      `sender="${escapeXml(m.sender_name ?? m.sender)}"`,
      `sender_id="${escapeXml(m.sender)}"`,
      `chat_id="${escapeXml(m.chat_jid)}"`,
      m.group_name && `chat="${escapeXml(m.group_name)}"`,
      m.platform && `platform="${escapeXml(m.platform)}"`,
      `time="${m.timestamp}" ago="${timeAgo(m.timestamp, t)}"`,
      m.verb && `verb="${escapeXml(m.verb)}"`,
      m.mentions_me === true && `mentions_me="true"`,
      m.thread && `thread="${escapeXml(m.thread)}"`,
      m.target && `target="${escapeXml(m.target)}"`,
    ];
    const tag = `<message ${a.filter(Boolean).join(' ')}>`;
    if (parts.length === 1) return `${tag}${inner}</message>`;
    return `${tag}\n${inner}\n</message>`;
  });
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}

// First match wins. Routes ordered by seq from DB.
// RFC 6570 Level 1 template expansion for route targets.
// Only {sender} is supported — expands to senderToUserFileId(msg.sender).
function expandTarget(target: string, msg: NewMessage): string | null {
  if (!target.includes('{')) return target;
  const id = senderToUserFileId(msg.sender);
  if (!id || id === '-' || id === '-unknown') return null;
  return target.replace('{sender}', id);
}

function routeMatches(r: Route, msg: NewMessage): boolean {
  switch (r.type) {
    case 'command': {
      const t = msg.content.trim();
      return !!(r.match && (t === r.match || t.startsWith(r.match + ' ')));
    }
    case 'verb':
      return msg.verb === r.match;
    case 'pattern':
      if (!r.match || r.match.length > 200) return false;
      try {
        return new RegExp(r.match).test(msg.content);
      } catch {
        return false;
      }
    case 'keyword':
      return !!(
        r.match && msg.content.toLowerCase().includes(r.match.toLowerCase())
      );
    case 'sender':
      if (!r.match || r.match.length > 200) return false;
      try {
        return new RegExp(r.match).test(msg.sender_name ?? msg.sender);
      } catch {
        return false;
      }
    case 'trigger':
    case 'default':
      return true;
    default:
      return false;
  }
}

export interface ResolvedRoute {
  target: string;
  command: string | null;
}

export function resolveRoute(
  msg: NewMessage,
  routes: Route[],
): ResolvedRoute | null {
  for (const r of routes) {
    if (!routeMatches(r, msg)) continue;
    const t = expandTarget(r.target, msg);
    if (t) return { target: t, command: r.command ?? null };
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

// Convert platform:id sender to short filename form (e.g., tg-123456)
export function senderToUserFileId(sender: string): string {
  const [platform, ...rest] = sender.split(':');
  const id = rest.join(':'); // Handle email with : in address
  const short = PLATFORM_SHORT[platform] || platform.slice(0, 2);
  return `${short}-${id}`;
}

// Parse YAML frontmatter from markdown file to extract name
function parseUserName(content: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;
  const fm = match[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  if (!nameMatch) return undefined;
  const raw = nameMatch[1].trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

// Generate <user> tag for the given sender
// Returns XML tag with id, optional name, optional memory path
export function userContextXml(
  sender: string,
  groupDir: string,
): string | null {
  if (!sender || sender === 'system') return null;

  const fileId = senderToUserFileId(sender);
  const usersDir = path.join(groupDir, 'users');
  const userFile = path.join(usersDir, `${fileId}.md`);
  const resolved = path.resolve(userFile);
  if (!resolved.startsWith(path.resolve(usersDir) + path.sep)) return null;
  const attrs: string[] = [`id="${escapeXml(fileId)}"`];

  if (fs.existsSync(userFile)) {
    try {
      const content = fs.readFileSync(userFile, 'utf-8');
      const name = parseUserName(content);
      if (name) attrs.push(`name="${escapeXml(name)}"`);
    } catch {}
    attrs.push(`memory="~/users/${fileId}.md"`);
  }

  return `<user ${attrs.join(' ')} />`;
}
