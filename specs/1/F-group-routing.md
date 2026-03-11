# Gateway Routing

**Status**: done

The gateway has one routing table. Messages arrive on a JID,
the router scans the table, and resolves a destination folder.
Groups are folder configs — they don't own JIDs or routing
rules.

## Concepts

- **JID** — a chat identifier (`telegram:123`, `discord:456`).
  The source of inbound messages. Not owned by any group.
- **Group** — a folder with config (name, container_config,
  tier). Receives messages via routing or delegation. Has no
  JID.
- **Route** — a rule in the routing table. Maps a JID +
  condition to a destination folder.

## Routing table

One flat ordered table in the gateway. Each row:

```sql
CREATE TABLE routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL,         -- which JID this rule applies to
  seq INTEGER NOT NULL,      -- evaluation order (lower first)
  type TEXT NOT NULL,        -- command/verb/pattern/keyword/sender/default
  match TEXT,                -- trigger/pattern/keyword/verb value
  target TEXT NOT NULL       -- destination folder
);
```

### Evaluation

Message arrives on JID:

1. Select all routes for that JID, ordered by `seq`
2. Scan rules, first match wins:
   - `command` — message starts with `match` value
   - `verb` — message verb equals `match`
   - `pattern` — regex `match` against message text
   - `keyword` — case-insensitive substring
   - `sender` — regex `match` against sender name/JID
   - `default` — always matches (catch-all)
3. Match found → destination folder. No match → drop (no
   group handles this JID).

No hops, no chains. One scan, one destination.

### Example

```
routes for telegram:1112184352 (DM):
  seq=0  command  @root    → root
  seq=1  default  *        → atlas

routes for telegram:-1003805633088 (group chat):
  seq=0  default  *        → atlas/support
```

DM message "hello" → atlas. DM message "@root status" → root.
Group message → atlas/support.

## Groups table

Groups are folder configs. No JID, no routing rules.

## Channel JID check

Channels check `isRoutedJid(jid)` — a boolean that answers "does any
route exist for this JID?". They do not receive or use GroupConfig.
The concept of "a group for a JID" does not exist in flat routing.
One JID can route to different folders based on message content.

```sql
CREATE TABLE groups (
  folder TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  added_at TEXT NOT NULL,
  container_config TEXT,
  parent TEXT
);
```

Tier is derived from folder path (same as today):

```typescript
function permissionTier(folder: string): 0 | 1 | 2 | 3 {
  if (folder === 'root') return 0;
  return Math.min(folder.split('/').length, 3);
}
```

## IPC actions

### Routing (gateway-level)

- `get_routes` — read routes for a JID (or all)
- `add_route` — add a single route rule for a JID
- `delete_route` — remove a route rule by ID

Tier 0 can modify any routes. Tier 1 can modify routes
targeting folders in its own subtree. Tier 2+ cannot
modify routes.

### Delegation (agent-level)

- `delegate_group` — send a prompt to another group's
  agent. Root world can delegate anywhere. Others can
  only delegate to descendants in the same world.
- `escalate_group` — send a prompt to the parent group.

Delegation is an agent choice at runtime. Routing is
gateway-level, pre-spawn.

## IPC delegation auth

Root world groups (`root`, `root/*`) can delegate to any
folder. Other groups can only delegate to descendants in
their own subtree.

```typescript
function isAuthorizedRoutingTarget(src: string, dst: string): boolean {
  if (src.split('/')[0] === 'root') return true;
  const srcWorld = src.split('/')[0];
  const dstWorld = dst.split('/')[0];
  if (srcWorld !== dstWorld) return false;
  return dst.startsWith(src + '/');
}
```

## Migration from registered_groups

**Done** (migration 0005). The old `registered_groups` table
merged JID mapping, group config, and routing rules into one row.
It has been replaced by:

1. `groups` table — folder-keyed config (name, container_config,
   parent, trigger_pattern, slink_token, etc.)
2. `routes` table — flat JID → folder routing rules
3. `registered_groups` table dropped

## Error handling

**No route match**: Message is stored but not processed.
Gateway logs at debug level. No agent runs.

**Route match, delegation fails** (target can't spawn):
Message cursor advances (marked as processed). Gateway
logs error. No retry — message is "dropped" but still in
DB for parent access via MCP message history tools.

**Authorization check**: Happens at route creation time
(IPC actions), not at runtime. If a route exists, it's
followed. Bad routes in DB are the operator's problem.

**Dynamic delegation** (`delegate_group`): unauthorized
target → error reply via IPC. The agent handles it.

## Open

- **`action_manifest.json` is dead** — `container-runner.ts` still writes it
  but the MCP server calls `list_actions` IPC directly and never reads it.
  Remove the write from `container-runner.ts` and delete the file.
- **IpcDeps callback injection** — `ipc.ts` receives a bundle of callbacks
  (`getDefaultTarget`, `sendMessage`, etc.) rather than importing db/channel
  modules directly. The indirection exists for test isolation but adds
  duplication. Future: collapse into direct imports, test via integration
  tests against real db + fake channels instead.
- Strip command prefix before child sees it: per-rule
  flag or always-strip?
- Circular delegation: detect via depth counter (max 3).
- Broadcast mode: route to multiple targets. Out of scope.
- Wildcard JID routes (`*`) for catch-all across all chats.

## Route complexity ordering

**Status**: proposed

Routes within a JID should auto-order by specificity instead
of relying on manual `seq` numbers. Agents add rules without
thinking about ordering — the gateway sorts them.

### Complexity score

Each route type gets a base specificity score. Higher =
more specific = evaluated first.

```
command    100   exact prefix match ("/help")
sender     80   regex against sender
verb       70   exact verb match
pattern    50 + len(match)   regex — longer patterns are more specific
keyword    40   substring match
default     0   catch-all
```

Pattern routes add `len(match)` so `@support\b` (9) ranks
above `@` (1). This is a simple heuristic — not a full regex
complexity analysis.

### Evaluation

1. Fetch all routes for JID
2. Sort by complexity score descending (stable sort preserves
   insertion order for ties)
3. First match wins

The `seq` column becomes a tiebreaker within the same
complexity score, not the primary sort key. Existing routes
with explicit `seq` values still work — they just matter less
when types differ.

### Migration

No schema change. Sorting happens at query time in
`getRoutesForJid()`:

```typescript
function complexityScore(r: Route): number {
  const base: Record<string, number> = {
    command: 100,
    sender: 80,
    verb: 70,
    pattern: 50,
    keyword: 40,
    default: 0,
  };
  const score = base[r.type] ?? 0;
  if (r.type === 'pattern' && r.match) return score + r.match.length;
  return score;
}

// sort descending by complexity, then ascending by seq
routes.sort((a, b) => complexityScore(b) - complexityScore(a) || a.seq - b.seq);
```

### Why not just fix agent behavior?

Agents shouldn't need to reason about ordering. A `command`
rule always beats a `pattern` rule regardless of when it was
added. Manual `seq` is an operator escape hatch, not the
primary mechanism.
