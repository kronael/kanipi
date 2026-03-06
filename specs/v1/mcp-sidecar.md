# MCP Sidecar — agent-driven isolation

Supersedes `isolation.md` (gateway-managed sidecars). This spec
covers agent-initiated MCP server isolation: the agent decides
which MCP servers to run; the gateway provisions containers on
demand via IPC.

## Problem

Today two mechanisms exist:

1. **Agent-registered MCP servers** (`extend-agent.md`): agent
   writes to `settings.json`, server runs inside agent container.
   No isolation — a buggy MCP server can crash the agent, access
   all mounted files, consume all memory.

2. **Gateway-managed sidecars** (`isolation.md`): gateway
   pre-provisions sidecar containers from operator config.
   Isolated, but agent has no say — can't install new tools
   at runtime, can't write an MCP server and run it sandboxed.

The agent needs to run its own MCP processes in isolated
containers and connect to the gateway through IPC.

## Design

```
Agent container
  │
  ├─ writes MCP server code to /workspace/group/tools/myserver.js
  ├─ calls request_sidecar action (IPC)
  │    { name: "mytools", image: "node:22-slim",
  │      command: ["node", "/workspace/tools/myserver.js"],
  │      network: "none" }
  │
  ▼
Gateway (IPC handler)
  │
  ├─ validates request (allowlist, resource limits)
  ├─ spawns sidecar container:
  │    docker run -d --rm --name nanoclaw-sidecar-mytools-<group>
  │      --memory=256m --cpus=0.5 --network=none
  │      -v <sockdir>:/run/socks
  │      -v <group-dir>/tools:/workspace/tools:ro
  │      -e MCP_SOCK=/run/socks/mytools.sock
  │      node:22-slim node /workspace/tools/myserver.js
  │
  ├─ waits for socket + probe
  ├─ returns { ok: true, sockPath, name }
  │
  ▼
Agent
  ├─ connects to /workspace/ipc/sidecars/mytools.sock
  └─ uses MCP tools from sidecar
```

## IPC actions

### request_sidecar

Agent requests a new sidecar. Gateway validates and spawns.

```typescript
const RequestSidecarInput = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  image: z.string(),
  command: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  memoryMb: z.number().max(1024).optional(),
  cpus: z.number().max(2).optional(),
  network: z.enum(['none', 'bridge']).optional(),
  mounts: z
    .array(
      z.object({
        src: z.string(), // relative to /workspace/group/
        dst: z.string(), // inside sidecar
        ro: z.boolean().optional(),
      }),
    )
    .optional(),
  allowedTools: z.array(z.string()).optional(),
});
```

Reply:

```json
{
  "ok": true,
  "name": "mytools",
  "sockPath": "/workspace/ipc/sidecars/mytools.sock"
}
```

Or on failure:

```json
{ "ok": false, "error": "image not in allowlist" }
```

### stop_sidecar

```typescript
const StopSidecarInput = z.object({
  name: z.string(),
});
```

Agent can stop sidecars it started. Gateway stops the container.

### list_sidecars

Returns running sidecars for this group. Includes both
gateway-configured and agent-requested.

## Validation and security

### Image allowlist

Not every image is safe. Operator configures allowed images:

```bash
# .env
SIDECAR_ALLOWED_IMAGES=node:22-slim,python:3.12-slim,kanipi-sidecar-*
```

Glob matching. Agent can only request images matching the
allowlist. Gateway-configured sidecars (from `containerConfig`)
bypass the allowlist — operator already approved them.

### Mount restrictions

Agent-requested mounts are restricted:

- `src` must be relative, no `..`, no absolute paths
- Resolved under `/workspace/group/<group>/` only
- Default: read-only. Agent must explicitly request `ro: false`
- Gateway validates with same logic as `mount-security.ts`

### Resource caps

Per-sidecar limits enforced by gateway:

| Field      | Agent max | Default |
| ---------- | --------- | ------- |
| `memoryMb` | 1024      | 256     |
| `cpus`     | 2.0       | 0.5     |
| `network`  | operator  | `none`  |

Network access requires operator opt-in via allowlist:

```bash
# .env — images allowed to use network
SIDECAR_NETWORK_IMAGES=kanipi-sidecar-websearch:*
```

### Max sidecars per group

```bash
MAX_SIDECARS_PER_GROUP=4  # default: 4
```

Prevents agent from spawning unbounded containers.

## Lifecycle

### Agent-requested sidecars

1. Agent calls `request_sidecar` action
2. Gateway validates (allowlist, limits, max count)
3. Gateway spawns container, waits for socket
4. Returns socket path to agent
5. Agent connects via socat or direct socket
6. On agent exit: gateway stops all agent-requested sidecars
   (same as gateway-managed ones in `stopSidecars()`)

### Gateway-configured sidecars (existing)

Unchanged from `isolation.md`. Started before agent, stopped
after. Agent sees them as pre-existing sockets.

### Mixed

Both can coexist. Gateway starts its configured sidecars first,
then agent can request additional ones at runtime. Socket dir
is shared: `/workspace/ipc/sidecars/`.

## Agent-side connection

Agent connects to the sidecar socket directly (no socat needed
if using MCP SDK socket transport):

```typescript
// In agent code (after request_sidecar reply)
const transport = new StdioClientTransport({
  command: 'socat',
  args: [`UNIX-CONNECT:${sockPath}`, 'STDIO'],
});
const client = new Client({ name: 'agent' }, {});
await client.connect(transport);
```

Or if the MCP SDK supports unix sockets natively:

```typescript
const transport = new UnixSocketTransport(sockPath);
```

## Relation to extend-agent.md

Today: agent writes `settings.json` → agent-runner merges →
MCP server runs inside container. This still works for
trusted, lightweight tools.

New path: agent calls `request_sidecar` → gateway spawns
isolated container → agent connects via socket. For untrusted
or resource-heavy tools.

Agent chooses: in-process (fast, no isolation) or sidecar
(slower startup, full isolation).

## Gateway code changes

| File                  | Change                                         |
| --------------------- | ---------------------------------------------- |
| `actions/sidecars.ts` | NEW: request_sidecar, stop_sidecar, list       |
| `container-runner.ts` | Track agent-requested handles alongside        |
|                       | gateway-managed ones; stop all on exit         |
| `config.ts`           | SIDECAR_ALLOWED_IMAGES, SIDECAR_NETWORK_IMAGES |
| `ipc.ts`              | Wire new actions to IPC handler                |

## Isolation modes

Network isolation is not the primary dimension. Sidecars operate
in one of three modes based on what they can access:

| Mode           | Files | Network | IPC | Use case                    |
| -------------- | ----- | ------- | --- | --------------------------- |
| **privileged** | yes   | yes     | yes | runs alongside agent, full  |
| **offline**    | yes   | no      | no  | code exec, file processing  |
| **web**        | no    | yes     | no  | search, API calls, fetching |

**Privileged**: sidecar mounts group workspace and IPC socket
dir, has bridge network. Effectively an extension of the agent
container — same access, separate process. For trusted tools
that need everything (e.g. a coding assistant sidecar).

**Offline**: sidecar mounts group workspace (or subset), no
network (`--network=none`), no IPC socket. For compute-bound
tools that process files — code execution, image processing,
PDF parsing. Can't exfiltrate data.

**Web**: sidecar has bridge network, no file mounts (only the
MCP socket dir). For tools that fetch external data — web
search, API integrations. Can't read agent files.

### Mode selection

Agent specifies mode in `request_sidecar`:

```typescript
const RequestSidecarInput = z.object({
  // ... existing fields ...
  mode: z.enum(['privileged', 'offline', 'web']).optional(),
});
```

Default: `offline` (safest). Gateway enforces:

- `privileged` requires operator allowlist
  (`SIDECAR_PRIVILEGED_IMAGES` in `.env`)
- `web` requires network allowlist (existing
  `SIDECAR_NETWORK_IMAGES`)
- `offline` always permitted (within resource caps)

Gateway translates mode to docker flags:

```typescript
function modeToFlags(
  mode: string,
  sockDir: string,
  groupDir: string,
): string[] {
  switch (mode) {
    case 'privileged':
      return [
        '--network=bridge',
        '-v',
        `${groupDir}:/workspace:rw`,
        '-v',
        `${sockDir}:/run/socks`,
      ];
    case 'web':
      return ['--network=bridge', '-v', `${sockDir}:/run/socks`];
    case 'offline':
    default:
      return [
        '--network=none',
        '-v',
        `${groupDir}:/workspace:ro`,
        '-v',
        `${sockDir}:/run/socks`,
      ];
  }
}
```

> **Status**: to spec and resolve. Mode names, default mounts,
> and permission model need validation against real use cases
> before implementation.

## Open questions

- **Docker socket access**: agent needs gateway to spawn
  containers (no docker socket in agent container). This is
  the right boundary — agent requests, gateway provisions.
  But latency: IPC round-trip + docker run + socket wait =
  5-10s. Agent must handle async startup.

- **Hot sidecars**: frequently-used sidecars (node, python
  runtimes) could be pooled — gateway keeps warm containers
  and assigns to groups on request. Reduces startup to <1s.

- **Sidecar persistence across sessions**: agent-requested
  sidecars die with the agent container. If the agent wants a
  sidecar to persist (e.g. a model-loaded server), it should
  use gateway-configured sidecars or a new `persistent: true`
  flag (operator-approved only).

- **Sidecar-to-gateway IPC**: can a sidecar call gateway
  actions? Today no. If needed: mount gateway IPC socket into
  sidecar. Security: sidecar would need its own auth token.

- **Image pull**: if the agent requests an image not locally
  available, gateway must pull it. Slow. Option: pre-pull at
  instance startup, or fail fast with "image not available".

- **Sidecar stdout/stderr**: where do logs go? Options:
  gateway captures and writes to group log dir, or sidecar
  writes to mounted log volume.

- **SDK native socket support**: the Claude Code MCP SDK may
  support unix sockets directly (no socat). Track upstream.
