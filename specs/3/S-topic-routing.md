---
status: spec
---

# Topic Routing

Routing symbols `@agent` and `#topic` as predefined route
table entries. Created automatically on group registration
for tiers 0-2. Tier 3 must add them explicitly.

## Routing symbols

Two message prefixes handled as route table entries:

### @agent — route to subgroup

`@support hello` routes to `<parent>/support` (child group).
The prefix is stripped before the agent sees the message.

- Route type: `prefix`, match: `@` (matches any `@<name>` prefix)
- Resolves target: `<parent>/<name>`
- Child must exist in groups table for delegation to succeed
- Message delivered via `delegateToChild` with stripped text
- If child doesn't exist: delegation fails, logged, no response

### #topic — route to named session

`#deploy let's review` routes to session "deploy" within
the same group. Same agent, same folder, different session.

- Route type: `prefix`, match: `#` (matches any `#<name>` prefix)
- Target: same group folder (self-route with topic context)
- Creates or resumes a named session keyed by `(group_folder, topic)`
- Same container config, CLAUDE.md, skills
- Agent sees only messages from that topic's session history
- The `#` prefix is consumed — agent sees "let's review"
- No prefix = default session (topic = '')

### Difference

|              | @agent                    | #topic                        |
| ------------ | ------------------------- | ----------------------------- |
| Routes to    | different group/container | same group, different session |
| Agent config | can differ                | same                          |
| Folder       | different                 | same                          |
| Context      | separate                  | separate                      |
| Container    | separate                  | same image + mounts           |

## Predefined routes on group creation

When `registerGroup` creates a group, it already inserts a
default route. For tiers 0-2, also insert `@` and `#` routes:

```typescript
// In registerGroup(), after addRoute(jid, { seq:0, type:'default', ... })
if (permissionTier(group.folder) <= 2) {
  addRoute(jid, { seq: -2, type: 'prefix', match: '@', target: group.folder });
  addRoute(jid, { seq: -1, type: 'prefix', match: '#', target: group.folder });
}
```

Negative seq values ensure `@` and `#` are evaluated before
all user-defined routes (which start at seq 0).

| Tier | @agent route | #topic route | Notes                          |
| ---- | ------------ | ------------ | ------------------------------ |
| 0    | predefined   | predefined   | root — full control            |
| 1    | predefined   | predefined   | world group — manages children |
| 2    | predefined   | predefined   | subgroup — can have children   |
| 3    | not created  | not created  | leaf — add via IPC/CLI         |

Tier 3 can opt in by adding route entries explicitly via
`add_route` IPC action or CLI.

## Evaluation order

Message arrives on JID:

```
1. Gateway commands (/new, /stop, /ping, /status, etc.)
2. Route table scan (seq-ordered, first match wins)
   seq -2: @ prefix, type 'prefix' (predefined for tiers 0-2)
   seq -1: # prefix, type 'prefix' (predefined for tiers 0-2)
   seq  0: default route
   seq  N: user-defined routes
```

`@` and `#` are regular route entries resolved by
`resolveRoute` in router.ts. The gateway handles the
matched route differently based on whether the resolved
route's `match` value is `@` or `#`.

## Route matching for @ and

**Important:** the existing `command` route type matches via
`text === match || text.startsWith(match + ' ')`. For `@` and
`#` routes, this means match=`@` would only match messages
that are exactly `@` or start with `@ ` (space after `@`).
This does NOT match `@support hello`.

Two approaches:

**Option A — New route type `prefix`**: matches
`text.startsWith(match)` without requiring a space. Route
entries use `type: 'prefix'` instead of `command`.

**Option B — Change match to empty + custom matcher**: the
`@` and `#` routes use a dedicated check in `routeMatches`
that does `text.startsWith('@')` / `text.startsWith('#')`.

**Chosen: Option A.** Add `prefix` to the Route type union.
`routeMatches` gains a case that returns
`text.startsWith(r.match)`. This keeps the route table clean
and doesn't special-case `@`/`#` in the matcher.

```typescript
// router.ts — new case in routeMatches
case 'prefix':
  return !!(r.match && msg.content.trim().startsWith(r.match));
```

Route entries become:

```typescript
addRoute(jid, { seq: -2, type: 'prefix', match: '@', target: group.folder });
addRoute(jid, { seq: -1, type: 'prefix', match: '#', target: group.folder });
```

After match, the caller parses the full prefix:

```typescript
function parsePrefix(text: string): { name: string; rest: string } | null {
  const m = text.match(/^[@#](\w[\w-]*)(?:\s+([\s\S]+))?$/);
  if (!m) return null;
  return { name: m[1], rest: (m[2] ?? '').trim() };
}
```

Note: the regex allows bare `@agent` or `#topic` with no
trailing message. In that case, `rest` is empty string.

## @agent resolution

The `@` route's `target` field stores the group's own folder
(the parent). This is intentional: the route target is a
_base path_, not the final destination. Post-match logic
appends the parsed agent name to form the child folder.

**Self-route caveat:** both `@` and `#` routes have
`target = group.folder`. The existing `processGroupMessages`
code treats `resolved.target === group.folder` as a self-route
(no delegation). The implementation must check the route's
`match` value BEFORE this comparison:

- `match === '@'`: parse `@<name>`, rewrite effective target
  to `<folder>/<name>`, then delegate
- `match === '#'`: handle as topic-scoped self-route (see
  #topic resolution below)
- Otherwise: existing logic applies

This means `resolveRoute` returns the route's raw `match`
field in its result (already available via `ResolvedRoute`),
and `processGroupMessages` inspects it to determine dispatch
behavior.

After route match with `@` prefix:

1. Parse `@<name>` from message text
2. Resolve child folder: `<target>/<name>` (target = parent folder)
3. Check child exists in groups table
4. Strip prefix, delegate with stripped text via `delegateToChild`
5. Reply threading per R-reply-routing

If child doesn't exist, log and drop (no fall-through to
default route — the `@` route already matched).

## #topic resolution

After route match with `#` prefix (detected via
`resolved.match === '#'`):

1. Parse `#<name>` from message text
2. Target is the group itself (self-route, `resolved.target === group.folder`)
3. Strip prefix from message text
4. Look up `getSession(folder, topic)` for topic-specific session
5. Pass topic to `runAgent` / container input (via `start.json`)
6. Run container with that session ID
7. Store returned session ID via `setSession(folder, sessionId, topic)`
8. Agent sees stripped message + topic session history only

Since `resolved.target === group.folder`, the `#` route
falls into the normal (non-delegation) processing path.
The topic-aware logic is an extension of the existing
self-processing code, not a new delegation path.

### Schema change

Sessions table gains a `topic` column. PK changes from
`group_folder` to `(group_folder, topic)`:

```sql
-- Migration 0013-topic-sessions.sql
CREATE TABLE sessions_new (
  group_folder TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL,
  PRIMARY KEY (group_folder, topic)
);
INSERT INTO sessions_new (group_folder, topic, session_id)
  SELECT group_folder, '', session_id FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
```

Default topic is `''` (empty string = null semantics).
Named topics use the parsed string (e.g., `'deploy'`).

### DB functions

```typescript
export function getSession(
  groupFolder: string,
  topic = '',
): string | undefined {
  const row = db
    .prepare(
      'SELECT session_id FROM sessions WHERE group_folder = ? AND topic = ?',
    )
    .get(groupFolder, topic);
  return row?.session_id;
}

export function setSession(
  groupFolder: string,
  sessionId: string,
  topic = '',
): void {
  db.prepare(
    'INSERT OR REPLACE INTO sessions (group_folder, topic, session_id) VALUES (?, ?, ?)',
  ).run(groupFolder, topic, sessionId);
}
```

```typescript
export function deleteSession(groupFolder: string, topic = ''): void {
  db.prepare('DELETE FROM sessions WHERE group_folder = ? AND topic = ?').run(
    groupFolder,
    topic,
  );
}
```

Existing callers pass no topic → default `''` → backward compatible.
`/new #deploy` calls `deleteSession(folder, 'deploy')` to reset
only that topic's session. `/new` with no topic resets the
default session.

### Message history scoping

Messages in a topic session are tagged with the topic.
The messages table gains a topic column:

```sql
ALTER TABLE messages ADD COLUMN topic TEXT DEFAULT '';
```

`formatMessages` filters by topic when building the prompt:

```typescript
const msgs = getMessagesSince(chatJid, cursor).filter(
  (m) => (topic || '') === (m.topic || ''),
);
```

### start.json topic injection

When `#topic` is active, topic is injected into `start.json`:

```json
{
  "topic": "deploy",
  "annotations": ["Topic session: #deploy"]
}
```

### Topic lifecycle

- **Create**: first message with `#topic` prefix
- **Resume**: subsequent messages with same `#topic`
- **No prefix**: goes to default session (topic = '')
- **Session reset**: `/new #topic` resets that topic's session
- **Idle timeout**: per topic, same timeout as group

## Integration with commands

Gateway commands (`/new`, `/stop`, etc.) are checked first
(step 1 in evaluation order, before route table).

`/new #topic message` — resets the named topic's session,
then routes "message" to that topic.

`/stop #topic` — stops the active container for that topic.

## Integration with F-group-routing

This spec extends F-group-routing. Route types gain one new
value: `prefix` (in addition to existing `command`, `verb`,
`pattern`, `keyword`, `sender`, `default`). The `@` and `#`
routes use type `prefix`.

The `prefix` type matches `text.startsWith(match)` — no
space required after the match string. This differs from
`command` which requires exact match or `match + ' '`.

Post-match behavior: when the matched route's `match` value
is `@` or `#`, `processGroupMessages` applies @agent or
#topic resolution instead of normal delegation.

One new route type (`prefix`). One new case in `routeMatches`.
`resolveRoute` must also return the matched route's `match`
field in `ResolvedRoute` (currently returns only `target`
and `command`). The dispatch logic in `processGroupMessages`
inspects `resolved.match` to detect `@`/`#` prefix routes.

## Implementation changes

| File            | Change                                                      |
| --------------- | ----------------------------------------------------------- |
| `src/types.ts`  | `Route.type`: add `'prefix'` to union                       |
| `src/router.ts` | `routeMatches`: add `prefix` type case                      |
| `src/router.ts` | `ResolvedRoute`: add `match` field, return from resolve     |
| `src/index.ts`  | `registerGroup`: insert @ and # routes for tiers 0-2        |
| `src/index.ts`  | `processGroupMessages`: handle @ and # via `resolved.match` |
| `src/db.ts`     | `getSession`/`setSession`/`deleteSession`: add topic param  |
| `src/cli.ts`    | CLI `group add`: insert @ and # for tiers 0-2               |
| migration 0013  | sessions table: add topic column, change PK                 |
| migration 0013  | messages table: add topic column                            |

## Interaction with per-sender batching (R-reply-routing)

Per-sender batching splits messages by sender before
dispatch. In the current code, route resolution happens on
the batch's last non-command message BEFORE the per-sender
split. All messages in the batch go to the same resolved
target, then `delegatePerSender` splits by sender for
reply threading.

For `@agent` and `#topic`, this means the LAST message in
the batch determines routing. If Alice sends `@support help`
and Bob sends `#deploy status` in the same poll cycle, only
Bob's message determines the route (last wins). This is a
known limitation of batch-then-route ordering.

**Future improvement:** resolve routes per-message instead
of per-batch, allowing mixed `@`/`#` routing within a single
poll cycle. This would require restructuring the message loop
to iterate messages individually before batching.

Order: gateway commands intercepted first, then route table
resolution on last message, then per-sender split for
dispatch.

## Interaction with template routing (Q-auto-threading)

Template routing (`{sender}`) creates child groups per user.
`@agent` delegates to named child groups. These are distinct:

- `{sender}` is automatic (route target contains template)
- `@agent` is explicit (user addresses a named child)
- Both use `delegateToChild` for dispatch
- A group can have both: `{sender}` as default, `@agent`
  for explicit routing to named children

## Not in scope

- Agent-created topics (agent output `#topic` → gateway tracks)
- Topic ACLs (who can post to which topic)
- Topic listing command (`/topics`)
- Cross-group topic routing (#topic in one group → session in another)
- Pipeline/DAG routing between topics
