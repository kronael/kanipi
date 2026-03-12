import { describe, it, expect } from 'vitest';

import {
  clockXml,
  escapeXml,
  formatMessages,
  formatOutbound,
  stripInternalTags,
  timeAgo,
} from './router.js';
import { NewMessage } from './types.js';

function makeMsg(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    id: '1',
    chat_jid: 'group@g.us',
    sender: '123@s.whatsapp.net',
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
        '<message sender="Alice" sender_id="123@s.whatsapp.net"' +
        ' chat_id="group@g.us"' +
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

  it('omits optional attributes when not set', () => {
    const result = formatMessages([makeMsg()], NOW);
    expect(result).not.toContain('platform=');
    expect(result).not.toContain('verb=');
    expect(result).not.toContain('thread=');
    expect(result).not.toContain('target=');
  });

  it('escapes special characters in new attributes', () => {
    const result = formatMessages(
      [makeMsg({ thread: '<unsafe>&"value' })],
      NOW,
    );
    expect(result).toContain('thread="&lt;unsafe&gt;&amp;&quot;value"');
  });

  it('falls back to sender JID when sender_name is missing', () => {
    const result = formatMessages([makeMsg({ sender_name: undefined })], NOW);
    expect(result).toContain('sender="123@s.whatsapp.net"');
    expect(result).toContain('sender_id="123@s.whatsapp.net"');
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

// --- Outbound formatting (internal tag stripping + prefix) ---

describe('stripInternalTags', () => {
  it('strips single-line internal tags', () => {
    expect(stripInternalTags('hello <internal>secret</internal> world')).toBe(
      'hello  world',
    );
  });

  it('strips multi-line internal tags', () => {
    expect(
      stripInternalTags('hello <internal>\nsecret\nstuff\n</internal> world'),
    ).toBe('hello  world');
  });

  it('strips multiple internal tag blocks', () => {
    expect(
      stripInternalTags('<internal>a</internal>hello<internal>b</internal>'),
    ).toBe('hello');
  });

  it('returns empty string when text is only internal tags', () => {
    expect(stripInternalTags('<internal>only this</internal>')).toBe('');
  });
});

describe('formatOutbound', () => {
  it('strips internal tags and trims', () => {
    expect(
      formatOutbound('<internal>thinking</internal>The answer is 42'),
    ).toBe('The answer is 42');
    expect(formatOutbound('<internal>x</internal>   ')).toBe('');
  });
});
