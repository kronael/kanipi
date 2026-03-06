# Gateway Actions

Gateway actions are the atomic operations kanipi can perform. Each action is
a typed function with input/output. The action registry is the single source
of truth — MCP tools, commands, and IPC dispatch all reference it.

## Model

```
                   ┌─────────────────────┐
  /new command ───▶│                     │
                   │   Action Registry   │
  MCP tool ──bus──▶│   (gateway-side)    │
                   │                     │
  IPC file ──bus──▶│  action(input) → output
                   └─────────────────────┘
```

- **Commands** — call actions directly (in-process, no bus)
- **MCP tools** — auto-generated from registry; agent calls via MCP,
  posted to bus (IPC file), gateway dispatches
- **IPC dispatch** — reads `type` from file, looks up action, calls it

## Action interface

```typescript
interface Action {
  name: string;
  description: string;
  input: ZodSchema; // validates input from any caller
  handler(input: any, ctx: ActionContext): Promise<any>;
  command?: string; // if set, gateway registers as /command
  mcp?: boolean; // if true, auto-exposed as MCP tool (default: true)
}

interface ActionContext {
  sourceGroup: string; // who is calling
  isRoot: boolean; // root group has elevated permissions
  sendMessage: (jid: string, text: string) => Promise<void>;
  sendDocument: (jid: string, path: string, filename?: string) => Promise<void>;
}
```

## Current actions

### Messaging

| Action         | Command | MCP | Input                              | Description            |
| -------------- | ------- | --- | ---------------------------------- | ---------------------- |
| `send_message` | —       | ✓   | `{ chatJid, text, sender? }`       | Send text to a channel |
| `send_file`    | —       | ✓   | `{ chatJid, filepath, filename? }` | Send file attachment   |

### Session

| Action          | Command   | MCP | Input             | Description                   |
| --------------- | --------- | --- | ----------------- | ----------------------------- |
| `reset_session` | `/new`    | ✓   | `{ groupFolder }` | Clear session ID, start fresh |
| `ping`          | `/ping`   | —   | —                 | Reply with uptime/status      |
| `chatid`        | `/chatid` | —   | —                 | Reply with current JID        |

### Tasks

| Action          | Command | MCP | Input                                                                | Description           |
| --------------- | ------- | --- | -------------------------------------------------------------------- | --------------------- |
| `schedule_task` | —       | ✓   | `{ targetJid, prompt, schedule_type, schedule_value, context_mode }` | Create scheduled task |
| `list_tasks`    | —       | ✓   | —                                                                    | List scheduled tasks  |
| `pause_task`    | —       | ✓   | `{ taskId }`                                                         | Pause a task          |
| `resume_task`   | —       | ✓   | `{ taskId }`                                                         | Resume a task         |
| `cancel_task`   | —       | ✓   | `{ taskId }`                                                         | Cancel a task         |

### Groups

| Action           | Command | MCP | Input                      | Description           |
| ---------------- | ------- | --- | -------------------------- | --------------------- |
| `refresh_groups` | —       | ✓   | —                          | Resync group metadata |
| `register_group` | —       | ✓   | `{ chatJid, folder, ... }` | Register new group    |

### Future

| Action           | Command | MCP | Input                       | Description             |
| ---------------- | ------- | --- | --------------------------- | ----------------------- |
| `edit_message`   | —       | ✓   | `{ chatJid, msgId, text }`  | Edit a sent message     |
| `react`          | —       | ✓   | `{ chatJid, msgId, emoji }` | React to a message      |
| `delete_message` | —       | ✓   | `{ chatJid, msgId }`        | Delete a sent message   |
| `pin_message`    | —       | ✓   | `{ chatJid, msgId }`        | Pin a message           |
| `help`           | `/help` | —   | —                           | List available commands |

## MCP auto-generation

Each action with `mcp: true` (default) is auto-registered as an MCP tool:

```typescript
for (const action of actions) {
  if (action.mcp !== false) {
    server.tool(
      action.name,
      action.description,
      action.input,
      async (input) => {
        return action.handler(input, ctx);
      },
    );
  }
}
```

No manual MCP wiring needed. Add an action, it appears as an MCP tool.

## IPC dispatch

IPC files use `type` field matching the action name:

```json
{ "type": "send_message", "chatJid": "tg/123", "text": "hello" }
```

Gateway reads the file, validates input against the action's schema,
calls the handler. Unknown types are logged and dropped.

## Command dispatch

Commands call actions directly — no IPC file, no bus:

```typescript
// /new command handler
async handle(ctx) {
  await actions.get('reset_session').handler({ groupFolder: ctx.group.folder }, actionCtx);
  ctx.reply('Session reset.');
}
```

Commands are thin wrappers that parse user input and call the action.

## Authorization

Actions check `ctx.sourceGroup` and `ctx.isRoot`:

- Root group can call any action on any target JID
- Non-root groups can only target their own JID
- Already enforced in current IPC dispatch (`ipc.ts`)

## Implementation

- `src/actions/` — one file per action or grouped by domain
- `src/action-registry.ts` — registry, schema validation, MCP generation
- `src/ipc.ts` — dispatch rewired to call registry
- `src/commands/` — thin wrappers calling actions
- `container/agent-runner/src/ipc-mcp-stdio.ts` — auto-generated from registry

## Open

- Migrate existing IPC types and MCP tools to action registry
- Auto-generate `commands.xml` from actions with `command` field
- Action middleware (logging, rate limiting) — v2
