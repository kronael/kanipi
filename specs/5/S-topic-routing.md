---
status: shipped
---

# Topic Routing

Routing symbols `@agent` and `#topic` as predefined route
table entries. Created automatically on group registration
for tiers 0-2. Tier 3 must add them explicitly.

## Routing symbols

Two message symbols handled implicitly for tier 0-2 groups:

### @agent — route to subgroup

`@support hello` or `hey @support can you help?` routes to
`<parent>/support` (child group). The `@name` token is stripped
before the agent sees the message. The symbol can appear anywhere
in the message — the first `@word` match wins.

- Detection: `/@\w/.test(content)` — anywhere in message
- Resolves target: `<parent>/<name>` (parent = group's own folder)
- Child must exist in groups table for delegation to succeed
- Message delivered via `delegateToChild` with `@name` token stripped
- If child doesn't exist: falls through to normal self-processing

### #topic — route to named session

`#deploy let's review` or `working on #billing — status?` routes
to session "deploy"/"billing" within the same group. Same agent,
same folder, different session. The `#name` token can appear
anywhere in the message — first match wins.

- Detection: `/#\w/.test(content)` — anywhere in message
- Target: same group folder (self-route with topic context)
- Creates or resumes a named session keyed by `(group_folder, topic)`
- Same container config, CLAUDE.md, skills
- Agent sees only messages from that topic's session history
- The `#name` token is stripped — agent sees the rest of the message
- No `#name` in message = default session (topic = '')

### Difference

|              | @agent                    | #topic                        |
| ------------ | ------------------------- | ----------------------------- |
| Routes to    | different group/container | same group, different session |
| Agent config | can differ                | same                          |
| Folder       | different                 | same                          |
| Context      | separate                  | separate                      |
| Container    | separate                  | same image + mounts           |

## Predefined routes on group creation

When `registerGroup` creates a group, it inserts a default route
plus `@` and `#` prefix routes for tiers 0-2:

```typescript
// In registerGroup(), after addRoute(jid, { seq:0, type:'default', ... })
if (permissionTier(group.folder) <= 2) {
  addRoute(jid, { seq: -2, type: 'prefix', match: '@', target: group.folder });
  addRoute(jid, { seq: -1, type: 'prefix', match: '#', target: group.folder });
}
```

Negative seq values ensure `@` and `#` are evaluated before the
default route (seq 0) and all user-defined routes (seq ≥ 0).

**Note:** detection of `@`/`#` uses content matching (`/@\w/`,
`/#\w/`), not `resolved.match`, because default route (seq 0) would
otherwise shadow the prefix routes in the first-match resolution.
The route table entries exist for visibility and future tooling.

| Tier | @agent route | #topic route | Notes                          |
| ---- | ------------ | ------------ | ------------------------------ |
| 0    | predefined   | predefined   | root — full control            |
| 1    | predefined   | predefined   | world group — manages children |
| 2    | predefined   | predefined   | subgroup — can have children   |
| 3    | not created  | not created  | leaf — add via IPC/CLI         |

Tier 3 can opt in by adding route entries explicitly via
CLI or `add_route` IPC action (requires a grant override
since tier 2+ cannot modify routes by default — see
`specs/3/V-action-grants.md`).

## Evaluation order

Message arrives on JID:

```
1. Gateway commands (/new, /stop, /ping, /status, etc.)
2. @agent / #topic content check (anywhere in message)
3. Route table scan (seq-ordered, first match wins)
   seq -2: @ prefix (predefined for tiers 0-2)
   seq -1: # prefix (predefined for tiers 0-2)
   seq  0: default route
   seq  N: user-defined routes
```

`@` and `#` are detected via content regex before route delegation.
The route table entries (seq -2/-1) exist for visibility and
tooling but detection does not rely on `resolved.match`.

## Detection and parsing

`@` and `#` symbols are detected via content regex anywhere in the
message, then parsed to extract the name and stripped message:

```typescript
// @agent detection — index.ts
if (/@\w/.test(lastMsg.content)) {
  const m = lastMsg.content.match(/@(\w[\w-]*)/);
  if (m) {
    const childFolder = `${group.folder}/${m[1]}`;
    const stripped = lastMsg.content.replace(/@\w[\w-]*/, '').trim();
    // delegate to child if exists
  }
}

// #topic detection — index.ts
if (/#\w/.test(lastMsg.content)) {
  const m = lastMsg.content.match(/#(\w[\w-]*)/);
  if (m) {
    const topicName = m[1];
    const stripped = lastMsg.content.replace(/#\w[\w-]*/, '').trim();
    // run agent with topic session
  }
}
```

First match wins. Bare `@agent` or `#topic` with no other text
produces an empty stripped string.

The `prefix` route type in `routeMatches` uses `startsWith` for
user-defined prefix routes (e.g. routing `/code` prefix to a code
group). The `@`/`#` implicit detection above is separate from this
and runs in the message loop before route delegation.

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

| File            | Change                                                          |
| --------------- | --------------------------------------------------------------- |
| `src/types.ts`  | `Route.type`: add `'prefix'` to union                           |
| `src/router.ts` | `routeMatches`: add `prefix` type case (`startsWith`)           |
| `src/router.ts` | `ResolvedRoute`: add `match` field, return from resolve         |
| `src/index.ts`  | `registerGroup`: insert @ (seq -2) and # (seq -1) for tiers 0-2 |
| `src/index.ts`  | message loop: detect `@`/`#` via content regex anywhere in msg  |
| `src/db.ts`     | `getSession`/`setSession`/`deleteSession`: add topic param      |
| `src/cli.ts`    | CLI `group add`: insert @ and # for tiers 0-2                   |
| migration 0014  | sessions table: add topic column, change PK                     |
| migration 0014  | messages table: add topic column                                |
| migration 0016  | fix @ and # route seq values (9998/9999 → -2/-1)                |

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

## Interaction with chat-bound sessions (L-chat-bound-sessions)

One container per folder, serial. Since `#topic` routes to
the same folder with different sessions, multiple topics for
the same group are serialized — you cannot run `#deploy` and
`#staging` simultaneously. The container queue key is the
folder, not the topic. This is acceptable for v1 since topics
are lightweight session switches, not parallel workloads.

## Not in scope

- Agent-created topics (agent output `#topic` → gateway tracks)
- Topic ACLs (who can post to which topic)
- Topic listing command (`/topics`)
- Cross-group topic routing (#topic in one group → session in another)
- Pipeline/DAG routing between topics
