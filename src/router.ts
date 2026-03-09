import { Channel, NewMessage, Platform, RoutingRule } from './types.js';

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

// JID format: "platform:identifier" — e.g. "mastodon:@user@instance.social"
export function platformFromJid(jid: string): Platform {
  const prefix = jid.split(':')[0] as Platform;
  return prefix;
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

// Returns true if source group may delegate/route to target:
// same world and target is any descendant of source.
export function isAuthorizedRoutingTarget(
  sourceFolder: string,
  targetFolder: string,
): boolean {
  const sourceRoot = sourceFolder.split('/')[0];
  const targetRoot = targetFolder.split('/')[0];
  if (sourceRoot !== targetRoot) return false;
  return targetFolder.startsWith(sourceFolder + '/');
}

// Evaluate routing rules against a message. Returns target folder or null.
// Evaluation order: command → verb → pattern → keyword → sender → default.
// First match within each tier wins; tiers evaluated in order.
export function resolveRoutingTarget(
  msg: NewMessage,
  rules: RoutingRule[],
): string | null {
  const tiers: RoutingRule['type'][] = [
    'command',
    'verb',
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
      } else if (rule.type === 'verb') {
        if (msg.verb === rule.verb) return rule.target;
      } else if (rule.type === 'pattern') {
        if (rule.pattern.length > 200) continue;
        try {
          if (new RegExp(rule.pattern).test(msg.content)) return rule.target;
        } catch {
          /* invalid regex — skip */
        }
      } else if (rule.type === 'keyword') {
        if (msg.content.toLowerCase().includes(rule.keyword.toLowerCase()))
          return rule.target;
      } else if (rule.type === 'sender') {
        if (rule.pattern.length > 200) continue;
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
