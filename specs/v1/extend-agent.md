# Agent Self-Extension

How the agent extends its own capabilities across sessions.
The agent runs Claude Code inside a container with a persistent
writable `~/.claude/` directory.

## SDK-native mechanisms (shipped)

| Mechanism    | Path                               | Effect                             |
| ------------ | ---------------------------------- | ---------------------------------- |
| Skills       | `~/.claude/skills/<name>/SKILL.md` | New capabilities, loaded by SDK    |
| Instructions | `~/.claude/CLAUDE.md`              | Changes own behavior/personality   |
| Memory       | `~/.claude/projects/*/memory/`     | Persists knowledge across sessions |
| Settings     | `~/.claude/settings.json`          | SDK configuration                  |

Changes take effect on next session spawn.

### Skill seeding

Gateway seeds `container/skills/` → `~/.claude/skills/` on first
spawn. `/migrate` skill propagates updates. See `specs/v1/skills.md`.

## Agent-registered MCP servers (v1 — to ship)

The agent can register its own MCP servers by writing to
`~/.claude/settings.json`. Agent-runner merges them with the
built-in `nanoclaw` server before calling `query()`.

### How it works

1. Agent writes an MCP server binary/script to its workspace
2. Agent adds entry to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "mytools": {
      "command": "node",
      "args": ["/workspace/group/tools/myserver.js"]
    }
  }
}
```

3. On next spawn, agent-runner reads settings, merges MCP servers
4. Agent has access to `mcp__mytools__*` tools

### Agent-runner changes

Two changes in `container/agent-runner/src/index.ts`:

**1. Merge MCP servers from settings:**

```typescript
const settingsPath = '/home/node/.claude/settings.json';
let agentMcp: Record<string, unknown> = {};
if (fs.existsSync(settingsPath)) {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    agentMcp = s.mcpServers ?? {};
  } catch {}
}

// built-in nanoclaw wins — agent cannot override it
const mcpServers = {
  ...agentMcp,
  nanoclaw: {
    command: 'node',
    args: [mcpServerPath],
    env: { ... },
  },
};
```

**2. Dynamic allowedTools:**

```typescript
const builtinTools = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TaskOutput',
  'TaskStop',
  'TodoWrite',
  'ToolSearch',
  'Skill',
  'NotebookEdit',
];
const mcpWildcards = Object.keys(mcpServers).map((name) => `mcp__${name}__*`);
const allowedTools = [...builtinTools, ...mcpWildcards];
```

### Security

- Agent can only run binaries inside its container (sandboxed)
- MCP servers run with same privileges as the agent itself
- `nanoclaw` cannot be overridden (spread order: agent first,
  built-in last wins)
- Gateway-side IPC dispatch is unaffected — agent MCP servers
  are local to the container, they don't talk to the gateway

### Gateway-side settings injection

Gateway already writes to `~/.claude/settings.json` per-spawn
(`container-runner.ts:162-189`) to inject env vars. The merge
must preserve agent-written `mcpServers` entries:

```typescript
// container-runner.ts — preserve agent's mcpServers
const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
settings.env = settings.env ?? {};
settings.env.WEB_HOST = WEB_HOST;
// ... other env injections ...
// DO NOT overwrite settings.mcpServers — agent owns those
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
```

## Known limitation: hooks

Agent cannot add SDK hooks (PreCompact, PreToolUse, etc).
These are hardcoded in agent-runner. Two exist:

- **PreCompact** — archives conversation to markdown
- **PreToolUse/Bash** — strips API keys from subprocess env

Adding hooks requires editing `agent-runner/src/index.ts`. No
agent-facing mechanism planned for v1. Diary flush (phase II)
would be the third hook, added by the developer.

## What the agent cannot extend

Gateway-side code — always requires developer changes:

- **Gateway actions** — IPC dispatch, MCP tool definitions
- **Channels** — messaging platform connectors
- **MIME handlers** — media processing pipeline
- **Volume mounts** — container filesystem layout
- **Inbound pipeline** — message processing steps

See `specs/v1/extend.md` for the gateway registry reference.
