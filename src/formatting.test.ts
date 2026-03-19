import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  clockXml,
  escapeXml,
  formatMessages,
  senderToUserFileId,
  timeAgo,
  userContextXml,
} from './router.js';
import { InboundEvent } from './types.js';

function makeMsg(overrides: Partial<InboundEvent> = {}): InboundEvent {
  return {
    id: '1',
    chat_jid: 'whatsapp:group@g.us',
    sender: 'whatsapp:123@s.whatsapp.net',
    sender_name: 'Alice',
    content: 'hello',
    timestamp: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// --- escapeXml ---

describe('escapeXml', () => {
  it('escapes &, <, >, " and passes through clean strings', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot;',
    );
    expect(escapeXml('hello world')).toBe('hello world');
    expect(escapeXml('')).toBe('');
  });
});

// --- formatMessages ---

// Fixed "now" for deterministic ago values: 3h after the default timestamp
const NOW = new Date('2024-01-01T03:00:00.000Z').getTime();

describe('formatMessages', () => {
  it('formats a single message with all attributes', () => {
    const result = formatMessages([makeMsg()], NOW);
    expect(result).toBe(
      '<messages>\n' +
        '<message sender="Alice" sender_id="whatsapp:123@s.whatsapp.net"' +
        ' chat_id="whatsapp:group@g.us"' +
        ' time="2024-01-01T00:00:00.000Z" ago="3h">hello</message>\n' +
        '</messages>',
    );
  });

  it('formats multiple messages', () => {
    const msgs = [
      makeMsg({
        id: '1',
        sender_name: 'Alice',
        content: 'hi',
        timestamp: '2024-01-01T02:00:00.000Z',
      }),
      makeMsg({
        id: '2',
        sender_name: 'Bob',
        content: 'hey',
        timestamp: '2024-01-01T02:30:00.000Z',
      }),
    ];
    const result = formatMessages(msgs, NOW);
    expect(result).toContain('sender="Alice"');
    expect(result).toContain('sender="Bob"');
    expect(result).toContain('>hi</message>');
    expect(result).toContain('>hey</message>');
    expect(result).toContain('ago="1h"');
    expect(result).toContain('ago="30m"');
  });

  it('includes chat attribute when group_name is set', () => {
    const result = formatMessages([makeMsg({ group_name: 'Support' })], NOW);
    expect(result).toContain('chat="Support"');
  });

  it('omits chat attribute when not a group', () => {
    const result = formatMessages([makeMsg()], NOW);
    expect(result).not.toContain('chat=');
  });

  it('escapes special characters in sender names', () => {
    const result = formatMessages(
      [makeMsg({ sender_name: 'A & B <Co>' })],
      NOW,
    );
    expect(result).toContain('sender="A &amp; B &lt;Co&gt;"');
  });

  it('escapes special characters in content', () => {
    const result = formatMessages(
      [makeMsg({ content: '<script>alert("xss")</script>' })],
      NOW,
    );
    expect(result).toContain(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('handles empty array', () => {
    const result = formatMessages([]);
    expect(result).toBe('<messages>\n\n</messages>');
  });

  it('includes platform and verb when set', () => {
    const result = formatMessages(
      [makeMsg({ platform: 'telegram', verb: 'message' })],
      NOW,
    );
    expect(result).toContain('platform="telegram"');
    expect(result).toContain('verb="message"');
  });

  it('includes mentions_me only when true', () => {
    const with_ = formatMessages([makeMsg({ mentions_me: true })], NOW);
    expect(with_).toContain('mentions_me="true"');

    const without = formatMessages([makeMsg({ mentions_me: false })], NOW);
    expect(without).not.toContain('mentions_me');

    const undef = formatMessages([makeMsg()], NOW);
    expect(undef).not.toContain('mentions_me');
  });

  it('includes thread and target when set', () => {
    const result = formatMessages(
      [makeMsg({ thread: '999', target: '456' })],
      NOW,
    );
    expect(result).toContain('thread="999"');
    expect(result).toContain('target="456"');
  });

  it('formats forwarded_from with all attributes', () => {
    const result = formatMessages(
      [
        makeMsg({
          forwarded_from: 'Fwd User',
          forwarded_from_id: 'chat:fwd',
          forwarded_msgid: 'orig-123',
          content: 'forwarded text',
        }),
      ],
      NOW,
    );
    expect(result).toContain('<forwarded_from sender="Fwd User"');
    expect(result).toContain('chat="chat:fwd"');
    expect(result).toContain('id="orig-123"');
    expect(result).toContain('forwarded text');
  });

  it('formats forwarded_from with only sender', () => {
    const result = formatMessages(
      [makeMsg({ forwarded_from: 'Fwd User', content: 'text' })],
      NOW,
    );
    expect(result).toContain('<forwarded_from sender="Fwd User"/>');
    expect(result).not.toContain('chat=');
  });

  it('formats reply_to_text with sender and id', () => {
    const result = formatMessages(
      [
        makeMsg({
          reply_to_text: 'original msg',
          reply_to_sender: 'Bob',
          reply_to_id: 'msg-orig',
          content: 'reply text',
        }),
      ],
      NOW,
    );
    expect(result).toContain('<reply_to sender="Bob" id="msg-orig">');
    expect(result).toContain('original msg');
    expect(result).toContain('</reply_to>');
    expect(result).toContain('reply text');
  });

  it('formats reply_to_text without sender defaults to (unknown)', () => {
    const result = formatMessages(
      [makeMsg({ reply_to_text: 'quoted', content: 'response' })],
      NOW,
    );
    expect(result).toContain('sender="(unknown)"');
  });

  it('falls back to sender JID when sender_name is missing', () => {
    const result = formatMessages([makeMsg({ sender_name: undefined })], NOW);
    expect(result).toContain('sender="whatsapp:123@s.whatsapp.net"');
    expect(result).toContain('sender_id="whatsapp:123@s.whatsapp.net"');
  });

  it('sender_id contains platform prefix', () => {
    const tg = formatMessages(
      [makeMsg({ sender: 'telegram:99', chat_jid: 'telegram:-100123' })],
      NOW,
    );
    expect(tg).toContain('sender_id="telegram:99"');
    expect(tg).toContain('chat_id="telegram:-100123"');
  });
});

// --- timeAgo ---

describe('timeAgo', () => {
  const base = new Date('2024-01-01T00:00:00.000Z').getTime();

  it('returns seconds', () => {
    expect(timeAgo('2024-01-01T00:00:00.000Z', base + 30_000)).toBe('30s');
  });

  it('returns minutes', () => {
    expect(timeAgo('2024-01-01T00:00:00.000Z', base + 5 * 60_000)).toBe('5m');
  });

  it('returns hours', () => {
    expect(timeAgo('2024-01-01T00:00:00.000Z', base + 3 * 3_600_000)).toBe(
      '3h',
    );
  });

  it('returns days', () => {
    expect(timeAgo('2024-01-01T00:00:00.000Z', base + 2 * 86_400_000)).toBe(
      '2d',
    );
  });

  it('returns weeks', () => {
    expect(timeAgo('2024-01-01T00:00:00.000Z', base + 14 * 86_400_000)).toBe(
      '2w',
    );
  });

  it('returns 0s for future timestamps', () => {
    expect(timeAgo('2024-01-01T01:00:00.000Z', base)).toBe('0s');
  });

  it('floors partial units', () => {
    expect(timeAgo('2024-01-01T00:00:00.000Z', base + 90_000)).toBe('1m');
  });
});

// --- clockXml ---

describe('clockXml', () => {
  it('returns clock tag with time and tz', () => {
    const result = clockXml('Europe/Prague');
    expect(result).toMatch(
      /^<clock time="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z" tz="Europe\/Prague" \/>$/,
    );
  });

  it('escapes tz value', () => {
    const result = clockXml('A & B');
    expect(result).toContain('tz="A &amp; B"');
  });
});

// --- senderToUserFileId ---

describe('senderToUserFileId', () => {
  it('converts telegram sender to tg-id', () => {
    expect(senderToUserFileId('telegram:123456')).toBe('tg-123456');
  });

  it('converts discord sender to dc-id', () => {
    expect(senderToUserFileId('discord:789')).toBe('dc-789');
  });

  it('converts email sender with colon in address', () => {
    expect(senderToUserFileId('email:user@example.com')).toBe(
      'em-user@example.com',
    );
  });

  it('handles unknown platform with 2-char prefix', () => {
    expect(senderToUserFileId('unknown:abc')).toBe('un-abc');
  });
});

// --- userContextXml ---

describe('userContextXml', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'user-ctx-'));
    fs.mkdirSync(path.join(tmpDir, 'users'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for system sender', () => {
    expect(userContextXml('system', tmpDir)).toBeNull();
  });

  it('returns null for empty sender', () => {
    expect(userContextXml('', tmpDir)).toBeNull();
  });

  it('returns tag with id only when no user file exists', () => {
    const result = userContextXml('telegram:123456', tmpDir);
    expect(result).toBe('<user id="tg-123456" />');
  });

  it('returns tag with memory path when user file exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'users', 'tg-123456.md'), 'hello');
    const result = userContextXml('telegram:123456', tmpDir);
    expect(result).toBe(
      '<user id="tg-123456" memory="~/users/tg-123456.md" />',
    );
  });

  it('extracts name from YAML frontmatter', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'users', 'tg-123456.md'),
      '---\nname: Alice\nfirst_seen: 2026-03-06\n---\n\nSome content',
    );
    const result = userContextXml('telegram:123456', tmpDir);
    expect(result).toBe(
      '<user id="tg-123456" name="Alice" memory="~/users/tg-123456.md" />',
    );
  });

  it('handles file without name field', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'users', 'tg-123456.md'),
      '---\nfirst_seen: 2026-03-06\n---\n\nNo name here',
    );
    const result = userContextXml('telegram:123456', tmpDir);
    expect(result).toBe(
      '<user id="tg-123456" memory="~/users/tg-123456.md" />',
    );
  });

  it('escapes special characters in name', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'users', 'tg-123456.md'),
      '---\nname: A & B <Co>\n---\n',
    );
    const result = userContextXml('telegram:123456', tmpDir);
    expect(result).toContain('name="A &amp; B &lt;Co&gt;"');
  });

  it('path traversal in sender id is blocked', () => {
    const result = userContextXml('telegram:../../../etc/passwd', tmpDir);
    expect(result).toBeNull();
  });

  it('handles file without frontmatter at all', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'users', 'tg-123456.md'),
      'Just plain text, no frontmatter',
    );
    const result = userContextXml('telegram:123456', tmpDir);
    expect(result).toBe(
      '<user id="tg-123456" memory="~/users/tg-123456.md" />',
    );
  });

  it('handles invalid YAML frontmatter gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'users', 'tg-123456.md'),
      '---\n: invalid yaml:\n  - [ broken\n---\n',
    );
    const result = userContextXml('telegram:123456', tmpDir);
    // File exists so memory is set, but name extraction fails gracefully
    expect(result).toBe(
      '<user id="tg-123456" memory="~/users/tg-123456.md" />',
    );
  });
});
