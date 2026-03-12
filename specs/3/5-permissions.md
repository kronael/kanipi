# Group Permissions

**Status**: partial

Four-tier permission model. Core enforcement is shipped. Two items remain open.

## Terminology

- **Tier 0**: root (instance admin)
- **Tier 1**: world (top-level folder)
- **Tier 2**: agent (group container)
- **Tier 3**: worker (subagent/sandboxed)

## Problem

Binary root/non-root was not enough. The gateway needs:

- an instance root with broad control
- top-level worlds isolated from one another
- deeper agent/worker groups with narrower permissions
- mount restrictions that reduce prompt-injection blast radius

## Hierarchy

Four tiers derived from folder structure.

```text
main                    tier 0 — instance root
atlas                   tier 1 — world
atlas/support           tier 2 — agent
atlas/support/web       tier 3 — worker
```

`root` is the tier-0 folder name.

```typescript
function isRoot(folder: string): boolean {
  return folder === 'root';
}

function permissionTier(folder: string): 0 | 1 | 2 | 3 {
  if (isRoot(folder)) return 0;
  return Math.min(folder.split('/').length, 3) as 1 | 2 | 3;
}
```

Top-level non-root folders are worlds. Depth 2 is a normal agent.
Depth 3+ is clamped to worker. Folders deeper than depth 3 should be
rejected at registration — not yet enforced (see open items below).

## Tier semantics

### Tier 0: instance root

- Can call all existing gateway actions
- Can send to any registered JID
- Can schedule/pause/resume/cancel tasks for any registered group
- Can set routing rules for any registered group
- Can delegate to direct child groups
- Can escalate nothing upward
- Sees `/workspace/self/`

Tier 0 cannot create top-level worlds via action — new worlds are CLI-only. Child groups
inside existing worlds are allowed.

### Tier 1: world

- Scoped to its own world only
- Can send to any registered JID in the same world
- Can schedule and manage tasks in the same world
- Can create direct children in its own world
- Can set routing rules for direct children
- Cannot refresh group metadata globally
- Cannot see `/workspace/self/`
- Cannot see `~/groups`

### Tier 2: agent

- Can send to its own registered JID only
- Can send files to its own registered JID only
- Can schedule/manage tasks for its own group only
- Can delegate to direct child groups
- Can escalate to its direct parent
- Cannot register groups
- Cannot set routing rules

### Tier 3: worker

- Read-mostly container mounts
- Can send text to its own registered JID only
- Cannot send files
- Cannot delegate to children
- Cannot schedule tasks
- Can escalate to its direct parent

## Action authorization

### Messaging

`send_message`:

- tier 0: any target
- tier 1: any registered target in same world (`isInWorld()` check in `messaging.ts`)
- tier 2/3: only own group's registered JID

`send_file`:

- tier 0: any target
- tier 1: any registered target in same world
- tier 2: only own group's registered JID
- tier 3: denied

### Tasks

`schedule_task`, `pause_task`, `resume_task`, `cancel_task`:

- tier 0: any registered target/task
- tier 1: same world only
- tier 2: own group only
- tier 3: denied

### Group management

`register_group`:

- tier 0: allowed for child groups only, not new worlds
- tier 1: allowed for direct children in own world
- tier 2/3: denied

`set_routing_rules`:

- tier 0: any registered group
- tier 1: direct children in own world
- tier 2/3: denied

`delegate_group` (send to `local:{child}` — downward only):

- tier 0: any descendant in any world
- tier 1: any descendant in own subtree
- tier 2: any descendant in own subtree
- tier 3: denied

`escalate_group`:

- tier 2: direct parent only
- tier 3: direct parent only
- tier 0/1: denied
- tier 2/3 at depth 1 (no `/` in folder): throws "unauthorized: no parent group"
- currently fire-and-forget — parent output streams to origin JID, no IPC round-trip

### Session and metadata

`reset_session`: all tiers allowed for their own current group context

`refresh_groups`: tier 0 only

## Action registry

Actions carry a `maxTier` field (named `minTier` in code — semantic debt, rename pending).
`getManifest()` filters out actions where `opts.tier > a.maxTier` — i.e. if the caller's
tier number is higher (less privileged) than the action's `maxTier`, the action is hidden.
Actions without `maxTier` are available to all tiers; per-action handlers do fine-grained
checks beyond that.

## Mount enforcement

Container runner enforces mount restrictions based on tier.
Tier 2 and 3 have no filesystem access to `/workspace/web` — HTTP is always available.

`~` = `/home/node` inside agent containers. `no` = mount is absent entirely.
`—` = not applicable (inherited or overlaid separately).

| Mount                     | Tier 0 | Tier 1 | Tier 2           | Tier 3           |
| ------------------------- | ------ | ------ | ---------------- | ---------------- |
| `/home/node`              | rw     | rw     | rw               | ro               |
| `/home/node/CLAUDE.md`    | —      | —      | ro overlay       | ro (from parent) |
| `/home/node/SOUL.md`      | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/CLAUDE.md`     | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/skills`        | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/settings.json` | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/output-styles` | —      | —      | ro overlay       | ro (from parent) |
| `~/.claude/projects`      | —      | —      | rw (from parent) | rw overlay       |
| `/home/node/media`        | —      | —      | rw (from parent) | rw overlay       |
| `/home/node/tmp`          | —      | —      | rw (from parent) | rw overlay       |
| `/workspace/share`        | rw     | rw     | ro               | ro               |
| `/workspace/ipc`          | rw     | rw     | rw               | rw               |
| `/workspace/web`          | rw     | rw     | no               | no               |
| `/workspace/self`         | ro     | no     | no               | no               |
| `~/groups`                | rw     | no     | no               | no               |
| `/app/src`                | rw     | rw     | rw               | ro               |

## Agent env vars

| Variable                  | Value                              |
| ------------------------- | ---------------------------------- |
| `NANOCLAW_GROUP_NAME`     | display name of the group          |
| `NANOCLAW_GROUP_FOLDER`   | folder path (e.g. `atlas/support`) |
| `NANOCLAW_TIER`           | permission tier (0-3)              |
| `NANOCLAW_IS_ROOT`        | `"1"` if tier 0, absent otherwise  |
| `NANOCLAW_IS_WORLD_ADMIN` | `"1"` if tier 1, absent otherwise  |
| `NANOCLAW_ASSISTANT_NAME` | bot name from config               |
| `NANOCLAW_DELEGATE_DEPTH` | current delegation depth           |

## local: routing enforcement

### Where enforcement lives

All `local:` routing rules are enforced in the **action handlers** (`src/actions/`),
not in the router/message loop. Rationale:

- Action handlers run in the gateway process — unreachable by agent code
- `/app/src` is mounted `ro` for tier 2/3; agents cannot modify gateway enforcement
- The IPC request mechanism always passes through gateway validation
- Duplicating rules in the router creates drift; action handlers are the single source

The router/message loop may do a lightweight sanity check on delivery (drop a
`local:` message whose source is not an ancestor of the target) as defense-in-depth,
but this is not the primary gate.

### Rules

**Downward (delegation)** — `delegate_group` / `send_message` to `local:{child}`:

- Sender must be an ancestor of the target folder
- Enforced in `delegate_group` handler and `send_message` handler (target JID check)

**Upward (escalation)** — `escalate_group` only:

- Sender may only target its **direct parent** (one level up, no skipping)
- Enforced in `escalate_group` handler (already checks `lastIndexOf('/')`)
- `send_message` **cannot target `local:` JIDs at all** — local: is internal plumbing,
  not a channel. Only `escalate_group` and `delegate_group` produce `local:`-routed messages.

**Tier 0/1 cannot escalate** — already enforced (no parent exists).

### Why not the router?

The agent controls what IPC requests it writes. If enforcement were only in the
router, a misconfigured or prompt-injected agent could write a crafted IPC request
that bypasses action-level checks and reaches the router with an arbitrary target.
The action handler validates the request before it ever produces a routable message,
closing that gap.

## Delegation prompt format

When a parent delegates down via `delegate_group`, the gateway wraps the prompt
in an XML tag before sending to the child container:

```xml
<delegated_by group="atlas">
  ...original prompt...
</delegated_by>
```

The child always knows it was delegated (also via `NANOCLAW_DELEGATE_DEPTH > 0` env var).
The parent does not receive the child's result — delegation is fire-and-forget routing.
The child replies directly to `chatJid`.

## Shipped (previously open)

- **Depth rejection**: `register_group` now rejects folders deeper than 3 levels.
- **maxTier rename**: `minTier` renamed to `maxTier` throughout — tier 0 = most privileged.
- **Tier auth for send_message/send_file**: `assertAuthorized` uses `isInWorld` for all non-root
  tiers; tier 2 agents can send to any JID routed within their world.
- **Main → root**: `isRoot()` checks `folder === 'root'`; CLI defaults new instances to `root`;
  `'main'` wiped from all source and test files.

## Open items

### Escalation response protocol

`escalate_group` is currently fire-and-forget: parent runs and replies to the original
`chatJid` directly, bypassing the worker entirely.

**Intended behaviour**: when a worker escalates, the parent runs with `chatJid` set to the
**worker's own registered JID** (not the original user JID). The parent's reply is then
routed as a normal incoming message back to the worker. The worker gets a fresh turn,
sees the parent's answer in conversation context, and replies to the original user.

```
user → worker (chatJid = user_jid)
  worker calls escalate_group(prompt)
    → parent container runs with chatJid = worker_jid
      → parent replies → routed to worker as new message
        → worker processes answer + history → replies to user_jid
```

No special IPC injection needed — escalation reuses the normal routing pipeline.
The parent is unaware it is servicing an escalation; it simply answers whoever
sent the message.

**Design: `local:` JID namespace**

Every registered group gets a guaranteed synthetic JID: `local:{folder}`.

- Created automatically at group registration time (no setup required)
- `routes` entry: `local:atlas/support → atlas/support`
- Never exposed to external channels — internal routing only
- Mirrors the existing `web:{folder}` pattern

**Escalation flow with `local:` JIDs:**

1. Worker (`atlas/support`) processes user message (`chatJid = tg/12345`), calls `escalate_group(prompt)`
2. Gateway fires parent (`atlas`) container with `chatJid = local:atlas/support`
3. Parent processes, produces output
4. Gateway routes parent's output through the **normal message router**: stored as a message
   with `chatJid = local:atlas/support` in the messages table — same path as any channel message,
   except `local:` JIDs are never sent to an external channel
5. Message loop picks up `local:atlas/support` → routes to `atlas/support` folder → new worker container
6. Worker gets fresh turn with parent's reply; calls `send_message(tg/12345, text)` to reply to user

The parent is unaware it is servicing an escalation. Normal turn metadata is preserved.
**Maximum one escalation level** — no recursive chaining for now.

**Required changes:**

- `register_group`: insert `local:{folder}` into `routes` table alongside any channel JID
- `escalate_group` handler: pass `local:{ctx.sourceGroup}` as `chatJid` to parent container

The rest is normal message flow. Parent calls `send_reply(text)` — bound to
`local:atlas/support` — which routes to the `atlas/support` folder via the
existing router. `local:` has no external channel handler so nothing is sent
externally. No special casing needed.

**Circuit breaker**: `escalate_group` already passes `depth + 1` to the parent.
When the parent receives an escalated message, its container runs with `depth = 1`.
If the parent attempts to escalate again, the existing `depth >= MAX_DELEGATE_DEPTH`
check rejects it. Set `MAX_DELEGATE_DEPTH = 1` to enforce single-level escalation.
No new code — just a config constant change.

### Host/web actions

Web virtual host management deferred to `8-web-virtual-hosts.md`.
