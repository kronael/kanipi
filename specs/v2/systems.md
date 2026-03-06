# Systems

Kanipi decomposes into orthogonal systems. Each owns a domain,
exposes a clean interface, and could in principle run as its own
process.

## Infrastructure systems

```
 channels ──→ ROUTER ──→ spawner ──→ container
              │    ↑                    │
              │    └── actions ←────────┘ (IPC / MCP proxy)
              │
              ├── mime (enrichment in inbound pipeline)
              └── web (separate process, proxied)
```

### Router

The core. Receives messages from channels, runs the inbound pipeline,
dispatches to the spawner, handles action dispatch (IPC/commands/MCP).

- Inbound pipeline: channel event → DB store → format → enrich → spawn
- Action registry: typed operations, Zod schemas, auth checks
- Message formatting: `<messages>` XML block for agent context
- Channel management: init, polling, routing by JID

Code: `index.ts`, `router.ts`, `ipc.ts`, `commands/`, `actions/` (v1)

### Spawner

Container lifecycle. Knows how to create, mount, run, and clean up
agent containers. Knows nothing about routing or channels.

- `buildVolumeMounts()` — assembles the container's filesystem
- `runContainerAgent()` — spawn, stream I/O, collect output
- Session dir management, skill seeding, settings injection
- Orphan cleanup, idle timeout

Code: `container-runner.ts`, `container-runtime.ts`

### Web

Vite dev server for the web UI. Managed by the bash entrypoint,
not the TypeScript gateway. Gateway proxies web requests via
`web-proxy.ts`.

Already a separate process. No coupling to router or spawner.

### MCP Proxy

Replaces file-based IPC with MCP over unix socket. Multiplexes
gateway actions and sidecar MCP servers into a single interface
for the agent. See `specs/v2/ipc-mcp-proxy.md`.

### MIME

Media detection and enrichment. Currently embedded in the router's
inbound pipeline (synchronous enrichment before spawn).

Could move agent-side as MCP servers (v2/workflows.md) — agent
calls enrichment when needed instead of gateway pre-processing.

Code: `mime.ts`, `mime-handlers/`

## Application systems (v2 — open)

Above the infrastructure, three concepts handle what messages go
where and how they're processed:

```
#topic → @agent → workflow (enrich → prompt → call → transform)
```

### Topics (#topics)

Route messages by topic/thread to specific agents. Telegram forum
topics, discord threads, or custom topic patterns.

- Topic ID as JID segment (builds on worlds router)
- Glob patterns match topic families
- One topic can map to one or more agents

### Agents (@agents)

Different agent personas/configurations. Currently group = agent
(1:1). Multi-agent patterns:

- Topic-based: #support → @support-agent, #dev → @dev-agent
- Skill-based: same container, different CLAUDE.md / skills
- Model-based: different LLM per agent (Claude, Gemini, local)

### Workflows

Multi-step processing pipelines. An agent runs a workflow:
enrich inputs, call LLMs with specific prompts, transform
outputs, route results.

- Steps: enrich, prompt, LLM call, transform, route
- Pipelines compose steps into chains
- Agent orchestrates (v2/workflows.md) or gateway pre-defines

See `specs/v2/workflows.md` for agent-side media processing
and sub-workflow patterns.

## Interfaces between systems

| From              | To                                       | Interface |
| ----------------- | ---------------------------------------- | --------- |
| Channels → Router | `NewMessage` events, channel polling     |
| Router → Spawner  | `runContainerAgent(group, input)`        |
| Spawner → Router  | `ContainerOutput` (stdout JSON)          |
| Agent → Router    | IPC files (v1) / MCP proxy (v2)          |
| Router → Channels | `sendMessage()`, `sendDocument()`        |
| Router → MIME     | `enrichMessage(msg)` in inbound pipeline |
| Router → Topics   | JID pattern match → agent selection      |
| Web → Router      | HTTP proxy for API calls                 |

## Design principle

Each system should be replaceable without touching the others.
The spawner could switch from docker to firecracker. The MCP proxy
could replace file IPC. MIME could move agent-side. Topics/agents
are routing rules, not code coupling. The router is the orchestrator,
not a god object.
