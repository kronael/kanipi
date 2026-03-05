# Systems — open

Gateway and agent are organized around **systems**. Each system owns a
domain (messaging, tasks, memory, context) and exposes two symmetric sides:

- **push** — gateway injects into agent context at invocation time
- **pull** — agent queries or acts via MCP tools at runtime

Each system is independently hookable. Plugins can add hooks to existing
systems or register new systems entirely (see `specs/v2/plugins.md`).

## Interface

Every system has the same shape:

```typescript
interface System {
  name: string;
  // Push: called before each agent invocation. Returns string to inject
  // into prompt, or null. Runs in registration order.
  contextHook?(input: ContextInput): Promise<string | null>;
  // Push: called only on new session start. Returns string to prepend
  // to the first prompt, or null.
  sessionHook?(input: SessionInput): Promise<string | null>;
  // Pull: MCP tools this system exposes to the agent.
  tools?: McpTool[];
}
```

A system implements any subset. Pure MCP system has only `tools`. Pure
context injector has only `contextHook`. Most will mix.

## Current systems

### Messaging system

| Side | What                        |
| ---- | --------------------------- |
| push | —                           |
| pull | `send_message`, `send_file` |

IPC write-only. No push side. No hook points yet.

### Task system

| Side | What                                                                      |
| ---- | ------------------------------------------------------------------------- |
| push | (open) inject `current_tasks.json` summary into context                   |
| pull | `schedule_task`, `list_tasks`, `pause_task`, `resume_task`, `cancel_task` |

### Memory system

| Side | What                                                      |
| ---- | --------------------------------------------------------- |
| push | MEMORY.md + CLAUDE.md loaded by Claude Code automatically |
| pull | `get_history` (missing), `recall_facts` (missing)         |

`get_history(limit?, since?)` — queries `messages` DB via IPC, returns
recent messages for the current group. Lets agent look further back than
the current invocation window.

### Context system

| Side | What                                                      |
| ---- | --------------------------------------------------------- |
| push | mime annotations (voice, video), session pointer on reset |
| pull | —                                                         |

Currently `_annotations[]` ad-hoc array in `ContainerInput`. Should
become a registered `contextHook` array.

## Hook inputs

```typescript
interface ContextInput {
  chatJid: string;
  groupFolder: string;
  groupDir: string; // host path to group workspace
  messages: NewMessage[];
  isNewSession: boolean;
}

interface SessionInput {
  chatJid: string;
  groupFolder: string;
  groupDir: string;
  sessionId: string | undefined;
}
```

## Registration

Hooks run in registration order. Gateway registers built-ins at startup
in `src/systems.ts`:

```typescript
export const systems: System[] = [
  messagingSystem,
  taskSystem,
  memorySystem,
  contextSystem,
];
```

Plugins append to `systems[]` or push hooks onto existing systems.

## Current code reality

Nothing matches this structure yet:

| Component        | Where                                         | Status                            |
| ---------------- | --------------------------------------------- | --------------------------------- |
| MCP tools        | `container/agent-runner/src/ipc-mcp-stdio.ts` | Flat list, no grouping            |
| Mime pipeline    | `src/mime-handlers/`                          | Loose files, called from enricher |
| `_annotations[]` | `src/container-runner.ts`                     | Ad-hoc array                      |
| `get_history`    | —                                             | Missing                           |
| Session hooks    | —                                             | Missing                           |

## Ship order

1. `get_history` MCP tool (memory system, pull side)
2. Session pointer as `sessionHook` in context system
3. Formal `System` interface + `src/systems.ts`
4. Mime handlers refactored as `contextHook`s
