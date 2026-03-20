---
status: open
---

# get_history IPC Action

On-demand message history retrieval for agents that need more
context than the 100-message injection provides.

See `N-memory-messages.md` for the injected history model.

## When to use

- Session resumed with no injection (transcript has context, but
  no `<messages>` block was injected)
- Agent needs context older than 100 messages
- Agent is processing a JID it hasn't seen in the current session

## IPC request

```json
{
  "id": "1709693200000-abc123",
  "type": "get_history",
  "chatJid": "telegram:-100123456",
  "limit": 50,
  "before": "2026-03-19T10:00:00.000Z"
}
```

`limit` — optional, default 100, max 200.
`before` — optional ISO 8601 timestamp cursor. Returns messages
with `timestamp < before`, ordered newest-first then reversed.
Omit for most recent.

## IPC reply

```json
{
  "id": "1709693200000-abc123",
  "ok": true,
  "result": {
    "messages": "<messages>...</messages>",
    "count": 47,
    "oldest": "2026-03-10T08:32:11.000Z"
  }
}
```

`messages` — same XML format as the injected `<messages>` block
(see `N-memory-messages.md`). Includes skipped-count comment
when the table has older rows beyond the limit.

`oldest` — timestamp of the oldest returned message. Use as
`before` cursor for the next page.

## Scoping

- Non-root agents: only JIDs routed to their group folder. Request
  for an out-of-scope JID returns `{ ok: false, error: "unauthorized" }`.
- Root agent: any JID.

## Gateway implementation

New action `get_history` in `src/actions/history.ts`. Calls new
DB function `getMessagesBefore(chatJid, before, limit, topic)` in
`src/db.ts`:

```typescript
function getMessagesBefore(
  chatJid: string,
  before: string | undefined,
  limit: number,
  topic?: string,
): InboundEvent[];
```

Same column selection and `is_bot_message = 0` filter as
`getMessagesSince`. Ordered `timestamp DESC LIMIT limit`, reversed
before return. `before` maps to `timestamp < ?`; when omitted,
no upper bound.

Action registration:

```typescript
export const getHistory: Action = {
  name: 'get_history',
  description: 'Fetch message history for a chat.',
  input: z.object({
    chatJid: z.string(),
    limit: z.number().int().min(1).max(200).optional(),
    before: z.string().optional(),
  }),
  async handler(raw, ctx) { ... },
};
```

## MCP

Auto-registered via action manifest — no agent-side changes needed.
Agent calls `mcp__nanoclaw__get_history` with the input schema above.
