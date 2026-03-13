# Gateway Actions

**Status**: shipped

Atomic operations. Action registry is the single source of
truth — MCP tools, commands, and IPC dispatch all reference it.

## Model

```
  /new command ──▶ Action Registry ◀── MCP tool (via IPC)
                   (gateway-side)
                   action(input) → output
```

- **Commands** — call actions directly (in-process)
- **MCP tools** — agent calls MCP tool in container, which
  writes IPC request, gateway dispatches, writes reply
- **IPC dispatch** — request-response over files

## Action interface

```typescript
interface Action {
  name: string;
  description: string;
  input: ZodSchema;
  handler(input: unknown, ctx: ActionContext): Promise<unknown>;
  command?: string; // registers as /command
  mcp?: boolean; // auto-exposed as MCP tool (default: true)
}

interface ActionContext {
  sourceGroup: string;
  isRoot: boolean;
  sendMessage(jid: string, text: string): Promise<void>;
  sendDocument(jid: string, path: string, name?: string): Promise<void>;
  registeredGroups(): Record<string, RegisteredGroup>;
  registerGroup(jid: string, group: RegisteredGroup): void;
  syncGroupMetadata(force: boolean): Promise<void>;
  getAvailableGroups(): AvailableGroup[];
  writeGroupsSnapshot(
    folder: string,
    groups: AvailableGroup[],
    jids: Set<string>,
  ): void;
  clearSession(folder: string): void;
  delegateToChild(
    childFolder: string,
    prompt: string,
    originJid: string,
    depth: number,
  ): Promise<void>;
}
```

## IPC: request-response over files

Current IPC is fire-and-forget (agent writes file, gateway
picks it up, no response). New model: request-response.

### Flow

```
Agent MCP tool call
  → ipc-mcp-stdio writes /workspace/ipc/requests/<id>.json
  → polls /workspace/ipc/replies/<id>.json
  → reads reply, returns to agent

Gateway
  → fs.watch requests/
  → looks up action by type
  → validates input (Zod)
  → calls handler
  → writes /workspace/ipc/replies/<id>.json
```

### Request format

```json
{
  "id": "1709693200000-abc123",
  "type": "send_message",
  "chatJid": "tg:-100123456",
  "text": "hello"
}
```

### Reply format

```json
{
  "id": "1709693200000-abc123",
  "ok": true,
  "result": { ... }
}
```

```json
{
  "id": "1709693200000-abc123",
  "ok": false,
  "error": "unauthorized"
}
```

### Tool discovery

Agent requests available actions at startup:

```json
{ "id": "...", "type": "list_actions" }
```

Gateway replies with action manifest:

```json
{
  "id": "...",
  "ok": true,
  "result": [
    {
      "name": "send_message",
      "description": "Send text to a channel",
      "input": { ... }
    }
  ]
}
```

Agent-runner reads the manifest and auto-registers MCP tools.
Each tool writes a request file and waits for the reply.

### Agent-side MCP stub

`ipc-mcp-stdio.ts` is a generic proxy — generates all MCP tools
from the manifest, no per-action code. 100ms poll, 30s timeout
on replies.

## Current actions

### Messaging

| Action         | Cmd | MCP | Input                              |
| -------------- | --- | --- | ---------------------------------- |
| `send_message` | --  | yes | `{ chatJid, text, sender? }`       |
| `send_file`    | --  | yes | `{ chatJid, filepath, filename? }` |

### Session

| Action          | Cmd       | MCP | Input |
| --------------- | --------- | --- | ----- |
| `reset_session` | `/new`    | yes | --    |
| `ping`          | `/ping`   | --  | --    |
| `chatid`        | `/chatid` | --  | --    |

### Tasks

| Action          | MCP | Input                                                                 |
| --------------- | --- | --------------------------------------------------------------------- |
| `schedule_task` | yes | `{ targetJid, prompt, schedule_type, schedule_value, context_mode? }` |
| `pause_task`    | yes | `{ taskId }`                                                          |
| `resume_task`   | yes | `{ taskId }`                                                          |
| `cancel_task`   | yes | `{ taskId }`                                                          |

`schedule_type`: `'cron' | 'interval' | 'once'`.
`context_mode`: `'group' | 'isolated'` (default `'isolated'`).
`list_tasks` reads from `current_tasks.json`.

### Groups

| Action           | MCP | Input                                                                         |
| ---------------- | --- | ----------------------------------------------------------------------------- |
| `refresh_groups` | yes | --                                                                            |
| `register_group` | yes | `{ jid, name, folder, trigger, requiresTrigger?, containerConfig?, parent? }` |
| `delegate_group` | yes | `{ group, prompt, chatJid, depth? }`                                          |

`register_group` requires tier ≤ 1 (root or world). `delegate_group` is authorized
by `isAuthorizedRoutingTarget(sourceGroup, group)`; `depth` is
injected by the gateway on recursive delegation (max 3).

### Routing

| Action         | MCP | Input            |
| -------------- | --- | ---------------- |
| `get_routes`   | yes | `{ jid }`        |
| `add_route`    | yes | `{ jid, route }` |
| `delete_route` | yes | `{ id }`         |

Tier 0 can modify any routes. Tier 1 can modify routes only
if target folder is in its own subtree. Tier 2+ cannot modify
routes. Authorization checked at route creation, not runtime.

Route schema:

```typescript
type Route = {
  seq: number; // evaluation order (lower first)
  type: RouteType; // command/verb/pattern/keyword/sender/default
  match?: string; // trigger/pattern/keyword value
  target: string; // destination folder
};

type RouteType =
  | 'command'
  | 'verb'
  | 'pattern'
  | 'keyword'
  | 'sender'
  | 'default';
```

Evaluation: select routes for JID, scan by seq, first match wins.

### Future

| Action           | Cmd     | MCP | Input                       |
| ---------------- | ------- | --- | --------------------------- |
| `edit_message`   | --      | yes | `{ chatJid, msgId, text }`  |
| `react`          | --      | yes | `{ chatJid, msgId, emoji }` |
| `delete_message` | --      | yes | `{ chatJid, msgId }`        |
| `pin_message`    | --      | yes | `{ chatJid, msgId }`        |
| `help`           | `/help` | --  | --                          |

## Command dispatch

Commands call actions directly — no IPC, no bus. Thin
wrappers that parse user input and call the action.

## Authorization

- Root group can target any JID
- Non-root can only target their own
- Enforced in action handlers

## Open

- Action middleware (logging, rate limiting) — v2 via
  MCP proxy hooks (see `3/A-ipc-mcp-proxy.md`)
- Filtered manifest per group — see `3/U-channel-actions.md`
- Dynamic channel action registration — see `3/U-channel-actions.md`
