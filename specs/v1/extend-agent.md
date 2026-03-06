# Agent Self-Extension

How the agent extends its own capabilities across sessions.
The agent runs Claude Code inside a container with a persistent
writable `.claude/` directory.

## SDK-native mechanisms (shipped)

| Mechanism    | Path                             | Effect                             |
| ------------ | -------------------------------- | ---------------------------------- |
| Skills       | `.claude/skills/<name>/SKILL.md` | New capabilities, loaded by SDK    |
| Instructions | `.claude/CLAUDE.md`              | Changes own behavior/personality   |
| Memory       | `.claude/projects/*/memory/`     | Persists knowledge across sessions |
| Settings     | `.claude/settings.json`          | SDK configuration                  |

The agent can create skills, edit its own instructions, and write
memory files without gateway involvement. Changes take effect on
next session spawn.

### Skill seeding

Gateway seeds skills from `container/skills/` into `.claude/skills/`
on first spawn per group. The `/migrate` skill propagates updates
across groups. See `specs/v1/skills.md`.

## Gaps

Three things the agent cannot extend today because agent-runner
hardcodes them in the `query()` call:

### 1. MCP servers

`mcpServers` is hardcoded to just `nanoclaw`. The agent cannot add
new MCP servers to its own runtime.

**Fix**: agent-runner reads `.claude/settings.json` at spawn time,
merges any `mcpServers` entries with the hardcoded `nanoclaw` server
before calling `query()`.

```typescript
// agent-runner reads agent's settings
const agentSettings = JSON.parse(
  fs.readFileSync('/home/node/.claude/settings.json', 'utf-8')
);
const agentMcp = agentSettings.mcpServers ?? {};

// merge with built-in nanoclaw
const mcpServers = { nanoclaw: { ... }, ...agentMcp };
```

The agent then self-registers by writing to its own settings:

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

Next spawn, agent-runner merges it. Agent has new tools.

Security: agent can only run binaries inside its container. MCP
servers run with the same sandboxing as the agent itself. The
`nanoclaw` server cannot be overridden (built-in wins).

### 2. Allowed tools

`allowedTools` is hardcoded. It includes `mcp__nanoclaw__*` as a
wildcard. If the agent adds a new MCP server `mytools`, the tools
it provides would need `mcp__mytools__*` in the allowed list.

**Fix**: agent-runner generates `allowedTools` dynamically from the
merged MCP servers list:

```typescript
const toolWildcards = Object.keys(mcpServers).map((name) => `mcp__${name}__*`);
const allowedTools = [...builtinTools, ...toolWildcards];
```

Pairs with the MCP server merge above — one change enables both.

### 3. Hooks

`hooks` is hardcoded to PreCompact (conversation archiving) and
PreToolUse/Bash (secret sanitization). The agent cannot add hooks.

**Defer**: hooks modify SDK behavior at a deep level. Only two exist,
a third (diary flush) is planned. No agent use case for self-defined
hooks yet. If needed later, agent-runner could load hook definitions
from a well-known path (`.claude/hooks/`).

## What the agent cannot extend

Gateway-side code — always requires developer changes:

- **Gateway actions** — IPC dispatch, MCP tool definitions
- **Channels** — messaging platform connectors
- **MIME handlers** — media processing pipeline
- **Volume mounts** — container filesystem layout
- **Inbound pipeline** — message processing steps

See `specs/v1/extend.md` for the gateway registry reference.

## Implementation

### v1 — MCP server merge + dynamic allowedTools

Two changes in `container/agent-runner/src/index.ts`:

1. Before `query()`, read `.claude/settings.json`, extract
   `mcpServers`, merge with hardcoded `nanoclaw`
2. Generate `allowedTools` from merged MCP server names

Small, self-contained. No framework.

### v2 — hook loading (if needed)

Agent-runner scans `.claude/hooks/` for hook definition files.
Each exports a hook factory matching the SDK's `HookCallback`
interface. Only when a real use case appears.
