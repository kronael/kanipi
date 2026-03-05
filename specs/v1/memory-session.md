# Memory: Session — partial

Claude Code session continuity across container invocations.

## How it works today

Each group has a persistent `~/.claude` directory on the host at
`data/sessions/<folder>/.claude/`, mounted into every container spawn at
`/home/node/.claude`. It contains:

- `CLAUDE.md` — agent instructions (seeded from `container/CLAUDE.md`)
- `MEMORY.md` — auto-memory (Claude Code managed)
- `projects/-workspace-group/memory/` — project memory directory
- Claude Code session transcripts (JSONL files, one per session)
- `sessions-index.json` — index of past sessions with summaries
- `skills/` — agent skills (seeded from `container/skills/`)

The Claude Code SDK `resume: sessionId` resumes a prior transcript.
The gateway maintains the active session ID in the `sessions` DB table:

```
container start
  → gateway passes sessionId via stdin
  → SDK resumes transcript, agent continues conversation
  → agent runner returns newSessionId in output
  → gateway stores newSessionId in sessions table
  → next spawn receives stored ID → continuous conversation
```

Session ID is per-group-folder. One active session per group.

## Pre-compact hook

When the context window approaches its limit, Claude Code fires the
`PreCompact` hook before compacting. The agent runner:

1. Reads the session transcript JSONL
2. Parses into user/assistant message pairs
3. Writes a markdown archive to `/workspace/group/conversations/YYYY-MM-DD-<title>.md`
4. Records entry in `sessions-index.json` (sessionId → summary → filename)

The archive title comes from the session summary in `sessions-index.json`
(set by Claude Code when it compacts). Archives are permanent — never deleted.

## Session reset problem

Gateway idle timeout (`IDLE_TIMEOUT`, default 30min) kills the container.
On next message the gateway starts a **new** session (no stored ID or expired).

The new session has no SDK context from before. But:

- `CLAUDE.md` and `MEMORY.md` persist → behavioural memory intact
- Prior conversation archives exist in `conversations/` → history accessible
- DB messages since last agent run are piped in → recent messages visible

The agent wakes up knowing _what was said_ (DB pipe) but not _what it responded_
(SDK context gone). This can cause repeated introductions or lost thread.

## Proposed: session pointer injection

When a new session starts and prior archives exist, gateway prepends a
pointer to the first prompt before the message XML:

```
[Previous session: 2026-03-05 — "alice-deployment-help"
Alice asked about deploying to hel1v5 and configuring the Ansible playbook.
Full transcript: /workspace/group/conversations/2026-03-05-alice-deployment-help.md]

<messages>
  ...current messages...
</messages>
```

### Pointer construction

Gateway reads:

1. Most recent entry in `sessions-index.json` (or most recent file in
   `conversations/` by mtime if index missing)
2. Archive filename → date + title
3. First ~5 lines of the archive body → opening exchange snippet

Total pointer: ≤100 words. No API call — pure file read.

### Agent behaviour

The agent receives the pointer and decides autonomously:

- Read the full archive if the new conversation is a continuation
- Summarise key facts into `MEMORY.md` if worth retaining long-term
- Ignore if the new conversation is unrelated

The gateway does not force any action — it just surfaces the pointer.

### When to inject

- Session ID is absent (first ever start) or unknown: **no injection**
  (no prior archive exists)
- Session ID was valid but idle timeout fired: **inject** if
  `conversations/` contains at least one archive
- Session was explicitly resumed (`resume: sessionId` succeeded): **no
  injection** (SDK context already intact)

### Implementation

In `src/container-runner.ts`, `buildVolumeMounts` or `runContainerAgent`:

```typescript
function buildSessionPointer(groupDir: string): string | null {
  const convsDir = path.join(groupDir, 'conversations');
  if (!fs.existsSync(convsDir)) return null;
  const files = fs
    .readdirSync(convsDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  const latest = files[0];
  const title = latest.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
  const date = latest.slice(0, 10);
  const body = fs
    .readFileSync(path.join(convsDir, latest), 'utf-8')
    .split('\n')
    .slice(0, 8)
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
  return `[Previous session: ${date} — "${title}"\n${body}\nFull transcript: /workspace/group/conversations/${latest}]`;
}
```

Prepend result to `input.prompt` when `isNewSession` (no stored session ID
or session resume failed).

## Open

- Collapse `sessions` table into `registered_groups.session_id` column
  (tracked in `specs/v1/db-bootstrap.md`)
- Handle session resume failure gracefully (SDK may reject stale IDs) —
  detect via error, fall back to new session + inject pointer
- Multiple recent archives: inject pointer to last N (e.g. 3) if conversation
  spans multiple compaction cycles
