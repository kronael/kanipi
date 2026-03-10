# Hierarchical Group Routing

**Status**: shipped

Any group can define routing rules for child groups beneath
it. A parent group decides how inbound messages flow to
its children — statically via rules, or dynamically via
IPC delegation from its agent.

## Terminology

- **group_folder**: The path (e.g., `atlas/support`)
- **group_jid**: The channel binding (e.g., `telegram:-100123`)
- **group_record**: The DB row in `registered_groups`

Builds on `specs/1/e-worlds.md` (shipped: `/` separator,
JID normalization, world boundaries). Glob matching is not
currently shipped.

---

## Group tree model

Group folder hierarchy mirrors a file path:

```
main          ← root (isRoot = true)
main/code     ← child of main
main/code/py  ← grandchild
team          ← another root
team/alice    ← child of team
team/bob      ← child of team
```

`parent` = folder with one fewer segment. Root groups
have no parent. A group is a parent if any registered
group has it as a prefix.

**Channel bindings** live on the parent (or root). Child
groups have no JID of their own — they are addressed by
folder. Responses from children are sent to the originating
JID.

---

## Routing rules

A parent group holds a JSON array `routing_rules`. Each
rule maps a condition to a target child folder.

```typescript
type RoutingRule =
  | { type: 'command'; trigger: string; target: string }
  | { type: 'verb'; verb: string; target: string }
  | { type: 'pattern'; pattern: string; target: string }
  | { type: 'keyword'; keyword: string; target: string }
  | { type: 'sender'; pattern: string; target: string }
  | { type: 'default'; target: string };
```

| Field     | Description                                             |
| --------- | ------------------------------------------------------- |
| `type`    | Rule kind (command / verb / pattern / keyword / sender) |
| `trigger` | Command prefix (`/code`, `@root`)                       |
| `verb`    | Message verb match (e.g. `join`, `leave`)               |
| `pattern` | Regex against full message text                         |
| `keyword` | Substring match (case-insensitive)                      |
| `target`  | Target folder (`main/code`, `atlas`, `root`)            |

`sender` matches against the sender JID or display name.

### Evaluation order

For each inbound message on a parent-bound JID:

1. **Exact command** — message starts with `trigger` value
2. **Verb** — message verb matches exactly
3. **Pattern** — regex matches message text
4. **Keyword** — case-insensitive substring in message
5. **Sender** — regex matches sender name or JID
6. **Default** — catch-all, if present
7. **No match** — message handled by parent group itself

First matching rule wins. Rules evaluated in array order
within each type tier.

### Self-targeting rules

If a routing rule resolves to the group's own folder
(`target === group.folder`), delegation is skipped and the
message falls through to normal processing by the group's
own agent. This enables dual-role setups where a single JID
uses routing rules to split traffic:

```json
{
  "folder": "root",
  "routing_rules": [
    { "type": "command", "trigger": "@root", "target": "root" },
    { "type": "default", "target": "atlas" }
  ]
}
```

Here `@root` matches and returns `root` (self) — delegation
is skipped, and root's agent handles the message directly.
All other messages delegate to `atlas`.

### Recursive chain resolution

The gateway resolves routing rules recursively. If root
routes to `atlas`, and `atlas` has rules that route to
`atlas/support`, the gateway follows the full chain and
spawns `atlas/support` directly — no intermediate agent
spawns.

```
root (rules: default → atlas)
  └─ atlas (rules: default → atlas/support)
       └─ atlas/support ← gateway spawns here directly
```

`resolveRoutingChain()` walks the chain with safeguards:

- **Self-target** stops the chain (handle locally)
- **Auth denied** stops the chain (non-root can't cross worlds)
- **Missing group** stops the chain (target not registered)
- **Depth limit** (8) prevents infinite loops

Agents can override routing at runtime via `set_routing_rules`
IPC action. Tier 0 (root) can set rules on any group. Tier 1
can set rules on direct children only. Tier 2+ cannot set rules.
The gateway reads fresh rules from DB each message loop, so
agent-set rules take effect on the next message.

---

## IPC delegation

A parent's agent can delegate dynamically at runtime by
writing an IPC request:

```json
{
  "id": "1709693200000-abc123",
  "type": "delegate_group",
  "group": "main/code",
  "prompt": "Fix the type error in src/db.ts",
  "chatJid": "tg:-100123456"
}
```

| Field     | Description                              |
| --------- | ---------------------------------------- |
| `group`   | Target child folder (must be registered) |
| `prompt`  | Prompt to send to the child agent        |
| `chatJid` | Originating JID (for reply routing)      |

Gateway reply:

```json
{ "id": "...", "ok": true, "result": { "queued": true } }
```

The child agent's response is sent back to the originating
JID via `sendMessage`. Delegation is fire-and-queue: the
parent's current container does not wait for the child to
finish. The child runs in its own GroupQueue slot.

Authorization: root world groups (`root` and `root/*`) can
delegate to any folder in any world. Other groups may only
delegate to descendants in their own subtree within the same
world. Sibling, ancestor, and same-folder targets are denied
for non-root groups. Self-targeting (`target === source`) is
handled at the call site — `isAuthorizedRoutingTarget` does
not check for it.

```typescript
function isAuthorizedRoutingTarget(source: string, target: string): boolean {
  if (source.split('/')[0] === 'root') return true;
  const sourceRoot = source.split('/')[0];
  const targetRoot = target.split('/')[0];
  if (sourceRoot !== targetRoot) return false;
  return target.startsWith(source + '/');
}
```

---

## Schema changes

New columns on `registered_groups`:

```sql
ALTER TABLE registered_groups ADD COLUMN parent TEXT;
ALTER TABLE registered_groups ADD COLUMN routing_rules TEXT;
```

| Column          | Type | Description                            |
| --------------- | ---- | -------------------------------------- |
| `parent`        | TEXT | Parent folder, NULL for roots          |
| `routing_rules` | TEXT | JSON array of `RoutingRule[]`, NULL=[] |

`parent` is informational — routing lookups use folder
prefix matching. `routing_rules` is only read on the
parent; child rows ignore it.

Migration: existing rows get `parent = NULL`,
`routing_rules = NULL`.

`register_group` action gains optional `parent` param.
Setting `parent` does not require the parent to exist yet
(allows bottom-up registration).

---

## Gateway changes

### router.ts

Add `resolveRoutingTarget()`:

```typescript
function resolveRoutingTarget(
  msg: NewMessage,
  rules: RoutingRule[],
): string | null {
  for (const rule of rules) {
    if (rule.type === 'command') {
      if (
        msg.content.startsWith(rule.trigger + ' ') ||
        msg.content === rule.trigger
      )
        return rule.target;
    } else if (rule.type === 'pattern') {
      if (new RegExp(rule.pattern).test(msg.content)) return rule.target;
    } else if (rule.type === 'keyword') {
      if (msg.content.toLowerCase().includes(rule.keyword.toLowerCase()))
        return rule.target;
    } else if (rule.type === 'sender') {
      const s = msg.sender_name ?? msg.sender;
      if (new RegExp(rule.pattern).test(s)) return rule.target;
    } else if (rule.type === 'default') {
      return rule.target;
    }
  }
  return null;
}
```

`processGroupMessages` calls this after trigger check, before
`runContainerAgent`. If a target is found, the message is
enqueued for the child group instead.

### group-queue.ts

`GroupQueue` is already keyed by an opaque string ID.
Child groups use their folder as the queue key (not a JID).
No structural changes needed — `enqueueMessageCheck` and
`enqueueTask` accept any string key.

`processMessagesFn` is invoked with the child folder key.
The calling code must look up the child group by folder
and use the originating JID for `sendMessage` responses.

Add `delegateToChild()` helper in `index.ts`:

```typescript
async function delegateToChild(
  childFolder: string,
  prompt: string,
  originJid: string,
): Promise<void> {
  const child = registeredGroups[childFolder];
  if (!child) return; // unregistered child, silently drop
  queue.enqueueMessageCheck(childFolder);
  // store synthetic message for the child's folder/JID
}
```

---

## Examples

### 1. Root routes `/code` to child group

Root group `main` (JID `telegram:-100111`) has:

```json
{
  "folder": "main",
  "routing_rules": [
    { "type": "command", "trigger": "/code", "target": "main/code" }
  ]
}
```

Child group `main/code` registered:

```json
{ "folder": "main/code", "parent": "main", "requires_trigger": 0 }
```

Message `/code fix the null check` arrives on
`telegram:-100111`:

1. Gateway finds group `main` via JID lookup
2. `resolveRoutingTarget` matches `command` rule
3. Message enqueued for `main/code` GroupQueue slot
4. `main/code` container spawned; response sent back to
   `telegram:-100111`

The `/code` prefix can be stripped before the child sees
it (configurable per rule, default: strip).

### 2. Team parent routes by sender to per-person children

Group `team` (JID `discord:12345`) has:

```json
{
  "folder": "team",
  "routing_rules": [
    { "type": "sender", "pattern": "alice", "target": "team/alice" },
    { "type": "sender", "pattern": "bob", "target": "team/bob" },
    { "type": "default", "target": "team/shared" }
  ]
}
```

Message from Alice → routes to `team/alice` (own session,
CLAUDE.md, skills). Message from unknown → `team/shared`.

Each child maintains its own session history in
`data/sessions/team/<name>/`.

### 3. Parent agent delegates dynamically via IPC

Parent `main` processes a message: "can you deploy the
app and then summarize the logs?". The agent decides
to split the work:

```
Agent in main:
  calls mcp__nanoclaw__delegate_group
    { "group": "main/deploy", "prompt": "deploy the app" }
  calls mcp__nanoclaw__delegate_group
    { "group": "main/logs",   "prompt": "summarize recent logs" }
```

Gateway receives both delegate requests, enqueues both
child groups. They can run in parallel (subject to
`MAX_CONCURRENT_CONTAINERS`). Each child sends its
response back to the originating JID independently.

`delegate_group` is registered as a gateway action
(see `specs/1/0-actions.md`), exposed as an MCP tool
via the action manifest.

---

## Prior art

See `specs/1/S-reference-systems.md` for detailed comparison.
Key influences: brainpro (ChannelSessionMap), takopi (per-thread FIFO).

This spec covers inter-group routing (child groups with their own
session/config). See `specs/1/1-agent-routing.md` for intra-group workers.

---

## Error handling: static vs dynamic

**Static routing** (gateway message loop): if the target is
unauthorized or missing, the gateway logs a warning and falls
back to the parent agent. The message is not lost.

**Dynamic routing** (`delegate_group` action): if the target
is unauthorized, the action throws an error. The caller gets
an error reply via IPC. This is intentional — the agent chose
to delegate explicitly and should handle the failure.

## Open

- Strip command prefix before child sees it: per-rule flag
  or always-strip? Default proposal: strip.
- Circular delegation: `main` delegates to `main/code`
  which delegates back. Detect via delegation depth counter
  (max 3). Gateway enforces, not agent.
- Child response threading: should child responses reply-to
  the triggering message? Per-channel support varies.
- Static rules evaluated on latest message only; multi-
  message context (e.g., "route if last 3 messages from
  same sender") is out of scope for v1.
- `routing_rules` regex untrusted if operator-supplied —
  validate patterns on insert, reject malformed.
- Broadcast mode: send to multiple children (no winner).
  Out of scope for v1.
- Phase 4 (worlds.md): tree-scoped IPC auth — shipped.
  Root world has cross-world delegation; other worlds
  are descendant-only within same subtree.

### 3. Parent delegates to a deeper descendant

`main` may delegate directly to `main/code/py` if it wants
to skip the intermediate `main/code` container for a
specialized task:

```json
{
  "type": "delegate_group",
  "group": "main/code/py",
  "prompt": "Run the Python-specific lint and fix pass",
  "chatJid": "telegram:-100111"
}
```

This is allowed because `main/code/py` is still inside
`main`'s subtree. Non-root groups still cannot delegate
to siblings or cross-world targets. Root world groups
(`root`, `root/*`) can delegate to any folder.
