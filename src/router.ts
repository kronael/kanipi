import { Channel, NewMessage, RoutingRule } from './types.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map(
    (m) =>
      `<message sender="${escapeXml(m.sender_name ?? m.sender)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`,
  );
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
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

// Returns true if source group may statically route to target:
// same world (same root segment) and direct parent→child only
// (target has exactly one more path segment than source).
export function isAuthorizedRoutingTarget(
  sourceFolder: string,
  targetFolder: string,
): boolean {
  const sourceRoot = sourceFolder.split('/')[0];
  const targetRoot = targetFolder.split('/')[0];
  if (sourceRoot !== targetRoot) return false;
  const suffix = targetFolder.slice(sourceFolder.length);
  return suffix.startsWith('/') && suffix.indexOf('/', 1) === -1;
}

// Evaluate routing rules against a message. Returns target folder or null.
// Evaluation order: command → pattern → keyword → sender → default.
// First match within each tier wins; tiers evaluated in order.
export function resolveRoutingTarget(
  msg: NewMessage,
  rules: RoutingRule[],
): string | null {
  const tiers: RoutingRule['type'][] = [
    'command',
    'pattern',
    'keyword',
    'sender',
    'default',
  ];
  for (const tier of tiers) {
    for (const rule of rules) {
      if (rule.type !== tier) continue;
      if (rule.type === 'command') {
        const t = msg.content.trim();
        if (t === rule.trigger || t.startsWith(rule.trigger + ' '))
          return rule.target;
      } else if (rule.type === 'pattern') {
        try {
          if (new RegExp(rule.pattern).test(msg.content)) return rule.target;
        } catch {
          /* invalid regex — skip */
        }
      } else if (rule.type === 'keyword') {
        if (msg.content.toLowerCase().includes(rule.keyword.toLowerCase()))
          return rule.target;
      } else if (rule.type === 'sender') {
        const s = msg.sender_name ?? msg.sender;
        try {
          if (new RegExp(rule.pattern).test(s)) return rule.target;
        } catch {
          /* invalid regex — skip */
        }
      } else if (rule.type === 'default') {
        return rule.target;
      }
    }
  }
  return null;
}
