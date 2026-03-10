import { describe, it, expect } from 'vitest';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from './config.js';
import {
  escapeXml,
  formatMessages,
  formatOutbound,
  stripInternalTags,
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
  it('escapes ampersands', () => {
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(escapeXml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than', () => {
    expect(escapeXml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeXml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('handles multiple special characters together', () => {
    expect(escapeXml('a & b < c > d "e"')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot;',
    );
  });

  it('passes through strings with no special chars', () => {
    expect(escapeXml('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });
});

// --- formatMessages ---

describe('formatMessages', () => {
  it('formats a single message as XML', () => {
    const result = formatMessages([makeMsg()]);
    expect(result).toBe(
      '<messages>\n' +
        '<message sender="Alice" time="2024-01-01T00:00:00.000Z">hello</message>\n' +
        '</messages>',
    );
  });

  it('formats multiple messages', () => {
    const msgs = [
      makeMsg({
        id: '1',
        sender_name: 'Alice',
        content: 'hi',
        timestamp: 't1',
      }),
      makeMsg({ id: '2', sender_name: 'Bob', content: 'hey', timestamp: 't2' }),
    ];
    const result = formatMessages(msgs);
    expect(result).toContain('sender="Alice"');
    expect(result).toContain('sender="Bob"');
    expect(result).toContain('>hi</message>');
    expect(result).toContain('>hey</message>');
  });

  it('escapes special characters in sender names', () => {
    const result = formatMessages([makeMsg({ sender_name: 'A & B <Co>' })]);
    expect(result).toContain('sender="A &amp; B &lt;Co&gt;"');
  });

  it('escapes special characters in content', () => {
    const result = formatMessages([
      makeMsg({ content: '<script>alert("xss")</script>' }),
    ]);
    expect(result).toContain(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('handles empty array', () => {
    const result = formatMessages([]);
    expect(result).toBe('<messages>\n\n</messages>');
  });

  it('includes platform and verb when set', () => {
    const result = formatMessages([
      makeMsg({ platform: 'telegram', verb: 'message' }),
    ]);
    expect(result).toContain('platform="telegram"');
    expect(result).toContain('verb="message"');
  });

  it('includes mentions_me only when true', () => {
    const with_ = formatMessages([makeMsg({ mentions_me: true })]);
    expect(with_).toContain('mentions_me="true"');

    const without = formatMessages([makeMsg({ mentions_me: false })]);
    expect(without).not.toContain('mentions_me');

    const undef = formatMessages([makeMsg()]);
    expect(undef).not.toContain('mentions_me');
  });

  it('includes thread and target when set', () => {
    const result = formatMessages([makeMsg({ thread: '999', target: '456' })]);
    expect(result).toContain('thread="999"');
    expect(result).toContain('target="456"');
  });

  it('omits optional attributes when not set', () => {
    const result = formatMessages([makeMsg()]);
    expect(result).not.toContain('platform=');
    expect(result).not.toContain('verb=');
    expect(result).not.toContain('thread=');
    expect(result).not.toContain('target=');
  });

  it('escapes special characters in new attributes', () => {
    const result = formatMessages([makeMsg({ thread: '<unsafe>&"value' })]);
    expect(result).toContain('thread="&lt;unsafe&gt;&amp;&quot;value"');
  });
});

// --- TRIGGER_PATTERN ---

describe('TRIGGER_PATTERN', () => {
  const name = ASSISTANT_NAME;
  const lower = name.toLowerCase();
  const upper = name.toUpperCase();

  it('matches @name at start of message', () => {
    expect(TRIGGER_PATTERN.test(`@${name} hello`)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(TRIGGER_PATTERN.test(`@${lower} hello`)).toBe(true);
    expect(TRIGGER_PATTERN.test(`@${upper} hello`)).toBe(true);
  });

  it('does not match when not at start of message', () => {
    expect(TRIGGER_PATTERN.test(`hello @${name}`)).toBe(false);
  });

  it('does not match partial name like @NameExtra (word boundary)', () => {
    expect(TRIGGER_PATTERN.test(`@${name}extra hello`)).toBe(false);
  });

  it('matches with word boundary before apostrophe', () => {
    expect(TRIGGER_PATTERN.test(`@${name}'s thing`)).toBe(true);
  });

  it('matches @name alone (end of string is a word boundary)', () => {
    expect(TRIGGER_PATTERN.test(`@${name}`)).toBe(true);
  });

  it('matches with leading whitespace after trim', () => {
    // The actual usage trims before testing: TRIGGER_PATTERN.test(m.content.trim())
    expect(TRIGGER_PATTERN.test(`@${name} hey`.trim())).toBe(true);
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
  it('returns text with internal tags stripped', () => {
    expect(formatOutbound('hello world')).toBe('hello world');
  });

  it('returns empty string when all text is internal', () => {
    expect(formatOutbound('<internal>hidden</internal>')).toBe('');
  });

  it('strips internal tags from remaining text', () => {
    expect(
      formatOutbound('<internal>thinking</internal>The answer is 42'),
    ).toBe('The answer is 42');
  });

  it('returns empty string when only whitespace remains after tag strip', () => {
    expect(formatOutbound('<internal>x</internal>   ')).toBe('');
  });
});

// --- Trigger gating via route type ---

describe('trigger gating (route-type-based)', () => {
  // Replicates the logic from processGroupMessages and startMessageLoop:
  //   if (!isRootGroup && jidsTrigger.has(chatJid)) { check trigger }
  function shouldProcess(
    isRootGroup: boolean,
    jidNeedsTrigger: boolean,
    messages: NewMessage[],
  ): boolean {
    if (isRootGroup || !jidNeedsTrigger) return true;
    return messages.some((m) => TRIGGER_PATTERN.test(m.content.trim()));
  }

  it('root group always processes (no trigger needed)', () => {
    const msgs = [makeMsg({ content: 'hello no trigger' })];
    expect(shouldProcess(true, false, msgs)).toBe(true);
  });

  it('root group processes even when jid is in trigger set', () => {
    const msgs = [makeMsg({ content: 'hello no trigger' })];
    expect(shouldProcess(true, true, msgs)).toBe(true);
  });

  it('non-root group with trigger route requires trigger', () => {
    const msgs = [makeMsg({ content: 'hello no trigger' })];
    expect(shouldProcess(false, true, msgs)).toBe(false);
  });

  it('non-root group with trigger route processes when trigger present', () => {
    const msgs = [makeMsg({ content: `@${ASSISTANT_NAME} do something` })];
    expect(shouldProcess(false, true, msgs)).toBe(true);
  });

  it('non-root group with default route always processes', () => {
    const msgs = [makeMsg({ content: 'hello no trigger' })];
    expect(shouldProcess(false, false, msgs)).toBe(true);
  });
});
