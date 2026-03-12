# Think Blocks

**Status**: spec

Agent uses `<think>` delimiters for internal reasoning. Gateway strips the
block before sending to the channel. If the agent never exits `<think>`, the
user sees nothing — enabling clean silent decisions without leaking reasoning.

## Problem

Group-chat agents must sometimes stay silent. The current instruction
("produce NO output at all") requires the agent to suppress its own output
entirely. In practice, the agent often produces a brief explanation of why
it's staying silent, which the gateway dutifully sends to the channel.

The root cause: the agent has no safe place to reason before deciding whether
to respond. Any deliberation that accidentally exits as text gets sent.

## Design

### Delimiters

```
<think>
...internal reasoning...
</think>
```

- Opening tag: `<think>` (7 chars)
- Closing tag: `</think>`
- Case-sensitive, exact match
- Everything between the tags is stripped by the gateway before channel delivery
- If the agent opens `<think>` and never closes it (output ends mid-thought),
  the entire remaining output after `<think>` is treated as hidden

### Stripping location: agent-runner

Stripping happens in `container/agent-runner/src/index.ts`, immediately before
`writeOutput` is called with the final `textResult`. The agent-runner already
owns the raw SDK text output and wraps it in `OUTPUT_START/END` markers before
writing to stdout. Stripping here means the gateway never sees `<think>` content
and requires zero gateway changes.

```typescript
function stripThinkBlocks(text: string): string {
  // Remove complete think blocks (multiline)
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Strip from unclosed <think> to end of string
  const open = result.indexOf('<think>');
  if (open !== -1) result = result.slice(0, open);
  return result.trim();
}
```

Called on `textResult` before `writeOutput({ status: 'success', result: textResult, ... })`.

If the stripped result is empty string, pass `result: null` — the gateway
already handles `null` result as a silent turn (no channel send).

### Agent instruction

Add to `container/CLAUDE.md` under the `# Soul` / group-chat section:

```
When deciding whether to respond in a group chat, use <think> blocks for
all internal deliberation. Text inside <think>...</think> is stripped by
the gateway and never shown to users. If you decide not to respond, keep
your entire output inside <think> — nothing will be sent.
```

This replaces the brittle "produce NO output at all" instruction with a
reliable mechanism: the agent can reason freely, and silence is a natural
consequence of never exiting the think block.

### Partial output

A common failure mode: agent starts generating a response, then mid-stream
decides it shouldn't. With think blocks:

1. Agent opens `<think>` at the start of its turn
2. Reasons about whether to respond
3. If yes: closes `</think>`, writes visible response
4. If no: entire output is inside `<think>` → nothing sent

The key constraint: the agent must open `<think>` before producing any visible
text if it is deliberating. The CLAUDE.md instruction enforces this.

### Interaction with SOUL.md

Think blocks are stripped at the gateway level, after the agent's full output
is received. The agent's persona (SOUL.md) operates normally inside think
blocks — it can reason in character. Only the decision whether to produce
visible output is affected.

## Scope

- Strip in one function, called in one place in `container/agent-runner/src/index.ts`
- No changes to gateway, IPC, actions, or channel code
- ~10 lines in the agent-runner
- Agent-side: one paragraph added to `container/CLAUDE.md`

## What this does NOT cover

- Structured tool calls are not affected — tool use happens before final text
  output and is not stripped
- The `<think>` tag must not appear in legitimate agent output (code samples
  that demo think blocks). Agents writing about this feature should use
  backticks: `` `<think>` ``
- Does not replace tier-based action authorization — only addresses visible
  text output suppression
