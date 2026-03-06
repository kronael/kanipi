# Worlds

JIDs are structured paths. Group folders can nest. The router
maps JIDs to groups via exact match or glob. This spec covers
the JID format, separator migration, glob routing, isMain→isRoot
rename, and global/→share/ mount change.

---

## JID format

```
channel/world/room/thread
```

`/` separator. First segment is the full channel name. Not
every channel has all levels — path is as deep as the platform
goes.

| Channel  | Flat (current)      | With world                  | With thread                          |
| -------- | ------------------- | --------------------------- | ------------------------------------ |
| telegram | `telegram/chatid`   | —                           | `telegram/chatid/threadid`           |
| discord  | `discord/channelid` | `discord/guildid/channelid` | `discord/guildid/channelid/threadid` |
| whatsapp | `whatsapp/groupjid` | —                           | (flat for now)                       |
| email    | `email/threadid`    | `email/domain/threadid`     | (flat for now)                       |
| web      | `web/slinkid`       | —                           | (flat for now)                       |

Flat JIDs remain valid — shortest form. Channels add segments
as hierarchy becomes available.

### Why `/` not `:`

- Glob libraries understand `/` natively
- `:` was already prefix separator, ambiguous with hierarchy
- Channel IDs never contain `/`
- JIDs are paths, groups are mount points

### Channel responsibility

Each channel constructs its own JIDs. Gateway only sees the
string and matches against registered groups.

- **Discord** — `discord/<guildId>/<channelId>`, threads add
  `/<threadId>`. DMs: `discord/dm/<channelId>`.
- **Telegram** — `telegram/<chatId>`, forum topics add
  `/<messageThreadId>`.
- **WhatsApp** — `whatsapp/<groupJid>` or `/<phoneJid>`.
- **Email** — `email/<domain>/<threadId>` or `email/<threadId>`.
- **Web** — `web/<slinkId>`.

### ownsJid update

```typescript
// before: jid.startsWith('tg:')
ownsJid(jid: string) { return jid.startsWith('telegram/'); }
```

---

## Phase 1 (implement now)

### 1a. Separator migration (`:` → `/`, prefix expansion)

One-time DB migration in a transaction:

```sql
UPDATE chats SET jid =
  REPLACE(REPLACE(REPLACE(jid,
    'tg:', 'telegram/'), 'wa:', 'whatsapp/'), ':', '/');
UPDATE messages SET chat_jid =
  REPLACE(REPLACE(REPLACE(chat_jid,
    'tg:', 'telegram/'), 'wa:', 'whatsapp/'), ':', '/');
UPDATE registered_groups SET jid =
  REPLACE(REPLACE(REPLACE(jid,
    'tg:', 'telegram/'), 'wa:', 'whatsapp/'), ':', '/');
UPDATE scheduled_tasks SET chat_jid =
  REPLACE(REPLACE(REPLACE(chat_jid,
    'tg:', 'telegram/'), 'wa:', 'whatsapp/'), ':', '/');
```

Nested REPLACE handles prefix expansion (`tg:` → `telegram/`,
`wa:` → `whatsapp/`) and separator change (`discord:` →
`discord/` etc.). Channel IDs never contain `:`.

Code: search-replace `startsWith('tg:')` → `startsWith('telegram/')`
etc. in all channel files. Update `kanipi` CLI `group add`.

### 1b. isRoot replaces isMain

`MAIN_GROUP_FOLDER = 'main'` and `isMain = folder === 'main'`
are a hardcoded special case. Replace with:

```typescript
// config.ts — replaces MAIN_GROUP_FOLDER constant
export function isRoot(folder: string): boolean {
  return !folder.includes('/');
}
```

`main` has no `/` → `isRoot('main') → true`. Any single-segment
folder is a root. Nested folders like `acme/ops` are non-root.

`isMain` field removed from `ContainerInput` — computed from
`groupFolder` at each call site.

#### Changes

**Gateway (src/):**

| File                          | Current                                              | Change                             |
| ----------------------------- | ---------------------------------------------------- | ---------------------------------- |
| config.ts:58                  | `MAIN_GROUP_FOLDER = 'main'`                         | `isRoot()` function                |
| container-runner.ts:58        | `isMain: boolean` in ContainerInput                  | Remove                             |
| container-runner.ts:116       | `buildVolumeMounts(group, isMain)`                   | Remove param, compute inside       |
| container-runner.ts:190       | `NANOCLAW_IS_MAIN`                                   | → `NANOCLAW_IS_ROOT`               |
| container-runner.ts:252       | `validateAdditionalMounts(..., isMain)`              | Pass `root`                        |
| container-runner.ts:267       | `if (isMain)` sessions mount                         | `if (root)`                        |
| container-runner.ts:335       | `buildVolumeMounts(group, input.isMain)`             | `buildVolumeMounts(group)`         |
| container-runner.ts:377,608   | Log `isMain`                                         | Log `root`                         |
| container-runner.ts:775,813   | `writeTasksSnapshot/writeGroupsSnapshot(... isMain)` | Compute from folder                |
| index.ts:195,384,509          | `folder === MAIN_GROUP_FOLDER`                       | `isRoot(group.folder)`             |
| index.ts:207,510              | `!isMainGroup && ...` trigger                        | `!isRoot(group.folder) && ...`     |
| index.ts:391,407,420          | `isMain` in ContainerInput                           | Remove                             |
| ipc.ts:71                     | `sourceGroup === MAIN_GROUP_FOLDER`                  | `isRoot(sourceGroup)`              |
| ipc.ts:89,346,419,437,455     | `isMain \|\| target === self`                        | `isRoot(src) \|\| target === self` |
| ipc.ts:472,496                | `if (isMain)` refresh/register                       | `if (isRoot(src))`                 |
| task-scheduler.ts:97          | `folder === MAIN_GROUP_FOLDER`                       | `isRoot(folder)`                   |
| mount-security.ts:235,297,339 | `isMain` param                                       | Rename to `root`                   |

**Agent runner (container/):**

| File                                                      | Current                    | Change                          |
| --------------------------------------------------------- | -------------------------- | ------------------------------- |
| agent-runner/src/index.ts:11                              | `isMain: boolean`          | Remove, derive from groupFolder |
| agent-runner/src/index.ts:472                             | `!containerInput.isMain`   | `isRoot()` on groupFolder       |
| agent-runner/src/index.ts:525                             | `NANOCLAW_IS_MAIN`         | → `NANOCLAW_IS_ROOT`            |
| agent-runner/src/ipc-mcp-stdio.ts:21                      | `NANOCLAW_IS_MAIN === '1'` | → `NANOCLAW_IS_ROOT`            |
| agent-runner/src/ipc-mcp-stdio.ts:153,188,221,240,259,281 | `isMain` checks            | → `isRoot`                      |

**Tests:**

| File                                       | Change                                               |
| ------------------------------------------ | ---------------------------------------------------- |
| container-runner.test.ts:23,114            | Remove `MAIN_GROUP_FOLDER` mock, `isMain` from input |
| ipc-auth.test.ts:387-398                   | Update auth helper                                   |
| formatting.test.ts:195-208                 | Rename `isMainGroup`                                 |
| tests/e2e/container-runner.test.ts:49,144+ | Same                                                 |
| tests/e2e/message-loop.test.ts:25          | Remove `MAIN_GROUP_FOLDER` mock                      |

**Docs:**

| File                              | Change                                               |
| --------------------------------- | ---------------------------------------------------- |
| specs/v1/prompt-format.md         | Remove `isMain` from schema                          |
| specs/enricher-pipeline.md        | Remove `isMain` from schema                          |
| container/skills/self/SKILL.md    | `NANOCLAW_IS_ROOT`, `/workspace/share`, layout table |
| container/skills/migrate/SKILL.md | `NANOCLAW_IS_ROOT`                                   |
| ARCHITECTURE.md                   | Mount examples                                       |
| CHANGELOG.md                      | Entry                                                |

**Bash entrypoint (kanipi):**

| Line | Change                                              |
| ---- | --------------------------------------------------- |
| 76   | Keep — `main` is a valid root                       |
| 112  | `folder === 'main'` guard → `!folder.includes('/')` |

### 1c. global/ → share/

`groups/global/` → `groups/<world>/share/`. For flat folders
the world IS the folder: `groups/main/share/`.

Bot's shared state: personality, knowledge, long-term memory.
Root gets rw, children get ro.

#### Mount model

**Root** (`main`, `acme`, any single-segment):

```
/workspace/group/   ← groups/main/         rw
/workspace/share/   ← groups/main/share/   rw
```

**Child** (`acme/ops`, `acme/ops/alerts`):

```
/workspace/group/   ← groups/acme/ops/     rw
/workspace/share/   ← groups/acme/share/   ro
```

World = `folder.split('/')[0]`. For flat folders, world = folder.

#### Changes

| File                           | Current                             | Change                                             |
| ------------------------------ | ----------------------------------- | -------------------------------------------------- |
| container-runner.ts:144-154    | `if (!isMain) { mount global/ ro }` | Always mount share/ — rw for root, ro for non-root |
| group-folder.ts:6              | `RESERVED_FOLDERS = ['global']`     | → `['share']`                                      |
| agent-runner/src/index.ts:104  | `/workspace/global/character.json`  | → `/workspace/share/character.json`                |
| agent-runner/src/index.ts:470  | `/workspace/global/CLAUDE.md`       | → `/workspace/share/CLAUDE.md`                     |
| ARCHITECTURE.md:218            | `global/:/workspace/global`         | → `share/:/workspace/share`                        |
| container/skills/self/SKILL.md | `/workspace/global`                 | → `/workspace/share`                               |

#### Instance migration

```bash
mkdir -p groups/main/share
mv groups/global/* groups/main/share/ 2>/dev/null
rmdir groups/global 2>/dev/null
```

### 1d. Folder validation

Allow `/` in folder names for hierarchy:

```typescript
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const RESERVED_FOLDERS = new Set(['share']);

function isValidGroupFolder(folder: string): boolean {
  if (!folder || folder !== folder.trim()) return false;
  if (folder.includes('..') || folder.includes('\\')) return false;
  const segments = folder.split('/');
  return (
    segments.every((s) => SEGMENT_PATTERN.test(s)) &&
    !segments.some((s) => RESERVED_FOLDERS.has(s.toLowerCase()))
  );
}
```

### 1e. Router with glob matching

New `src/router.ts`. Current `router.ts` → `src/formatting.ts`.

```typescript
function findGroup(
  jid: string,
  groups: Record<string, RegisteredGroup>,
): RegisteredGroup | undefined {
  // Fast path: exact match (O(1), 99% of lookups)
  if (groups[jid]) return groups[jid];

  // Slow path: glob, most-specific wins
  let best: RegisteredGroup | undefined;
  let bestLen = -1;
  for (const [pat, g] of Object.entries(groups)) {
    if (!pat.includes('*')) continue;
    if (minimatch(jid, pat) && pat.length > bestLen) {
      best = g;
      bestLen = pat.length;
    }
  }
  return best;
}
```

Pre-compile patterns at registration time. Wire into message
loop replacing direct `registeredGroups[chatJid]` lookups.

#### Glob examples

```
telegram/-100123456       → folder: main         (exact)
discord/891234567/*       → folder: acme          (all guild channels)
telegram/-100123456/*     → folder: main          (all forum topics)
discord/891234567/456/*   → folder: acme/ops      (channel threads)
```

### Implementation order

1. DB migration (`:` → `/`, prefix expansion)
2. Channel files: `ownsJid()`, JID construction
3. `config.ts`: `isRoot()` replaces `MAIN_GROUP_FOLDER`
4. `group-folder.ts`: allow `/`, reserve `share`
5. `container-runner.ts`: remove `isMain` param, share/ mount
6. `index.ts`, `ipc.ts`, `task-scheduler.ts`: isRoot
7. `mount-security.ts`: rename param
8. Agent runner: `NANOCLAW_IS_ROOT`, share/ paths
9. New `src/router.ts` with `findGroup()`
10. Wire router into message loop
11. `kanipi` CLI: glob JIDs, hierarchical folders
12. Tests, docs, CHANGELOG, migration skill
13. Rebuild images, run DB migration on instances

---

## Phase 2: Expand Discord + email JIDs (future)

1. Discord: emit `discord/<guildId>/<channelId>` always
2. Discord DMs: `discord/dm/<channelId>`
3. Email: emit `email/<domain>/<threadId>`
4. Migrate existing flat Discord JIDs (one-time guild lookup)
5. Discord threads: `discord/<guildId>/<channelId>/<threadId>`
6. Telegram forum topics: `telegram/<chatId>/<threadId>`

## Phase 3: World tree mount (future)

When agents need to browse siblings beyond share/:

```
/workspace/world/   ← groups/acme/   ro (non-root only)
```

Root doesn't need it (group/ IS the world). Deferred until
concrete use case.

## Phase 4: IPC authorization generalization (future)

Current: `isRoot || target === self`

Tree-scoped:

```typescript
function canTarget(src: string, target: string): boolean {
  return target === src || target.startsWith(src + '/');
}
```

`acme/ops` can target `acme/ops/alerts` but not `acme/dev`.
Deferred until nested groups exist.

---

## Open

- WhatsApp `@g.us` suffix — ugly in paths but harmless
- Email threading uses `email_threads` table, not JID hierarchy
- Cross-world visibility: use additionalMounts
- Max depth: filesystem path length is the limit
- Auto-create intermediate dirs: `mkdir -p` semantics
- share/ subdirs per concern: just convention
