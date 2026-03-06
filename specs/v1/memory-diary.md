# Memory: Diary — shipping

Agent-written daily notes. The agent decides what goes in —
content is subjective, freeform. The primary human-readable
record of what happened in a group over time.

## Path

```
groups/<folder>/diary/YYYYMMDD.md
```

Mounted rw at `/workspace/group/diary/` inside the container.

## File format

```markdown
---
summary: |
  Working on kanipi gateway. Alice is the main user.
  - auth: OAuth flow design, provider TBD
  - deploy: hel1v5 Ansible config done
  - open: two bugs in IPC file sending
---

## 10:32

Helped Alice configure Ansible for hel1v5. Vault password
path was wrong — fixed.

## 14:07

Auth flow discussion. Alice wants OAuth not passwords.
Open: which provider.
```

- `summary:` — YAML block scalar: one line of project context,
  then up to 5 bullet points of high-level tasks/status.
  Gateway reads only this field for session-start injection.
- `## HH:MM` entries — 250 chars max each
- Agent may rewrite/compress old entries to save space
- Truthful, summarizing — only what matters
- If nothing noteworthy, skip

## Triggers

### 1. `/diary` skill (agent-initiated)

Agent can run `/diary` anytime during a session. The skill
instructs the agent to append to `/workspace/group/diary/YYYYMMDD.md`.

### 2. PreCompact hook (automatic)

On compaction, the hook injects a system message:

```
If anything worth noting happened since your last diary
entry, run /diary.
```

Agent decides whether to act. Not a command — a nudge.
Replaces the current `createPreCompactHook` transcript dump.

### 3. Gateway turn nudge (automatic, every 100 turns)

Gateway counts agent responses per group. Every 100 turns,
injects the same nudge text as a system message via stdin
piping. Resets counter after nudge. PreCompact resets it too.

## Gateway: session-start injection

On session reset, gateway reads the most recent diary file's
YAML frontmatter and injects a system message:

```
[diary] <summary text> — see /workspace/group/diary/
```

Construction (no API call):

1. List `groups/<folder>/diary/*.md`, sort descending
2. Read `summary:` from frontmatter of most recent file
3. Inject as system message before conversation XML

No diary = no injection (cold start with MEMORY.md only).

## Gateway: mount

`container-runner.ts` adds:

```
groups/<folder>/diary/ → /workspace/group/diary/ (rw)
```

Create dir if missing (`mkdirSync recursive`).

## What gets deleted

- `createPreCompactHook` — transcript dump (replaced by nudge)
- `parseTranscript`, `formatTranscriptMarkdown`,
  `sanitizeFilename`, `generateFallbackName` — dead code
- `conversations/` directory — no longer created

## Implementation

| Component  | File                                   | Change                              |
| ---------- | -------------------------------------- | ----------------------------------- |
| Mount      | `src/container-runner.ts`              | Add diary dir mount                 |
| Injection  | `src/index.ts`                         | Read frontmatter, inject system msg |
| PreCompact | `container/agent-runner/src/index.ts`  | Replace transcript dump with nudge  |
| Turn nudge | `src/index.ts`                         | Counter per group, nudge at 100     |
| Skill      | `container/skills/self/diary/SKILL.md` | Writing rules                       |
| Migration  | `container/skills/self/migrations/`    | Skill file delivery                 |

## Relationship to other memory layers

| Layer                | Trigger        | Granularity           |
| -------------------- | -------------- | --------------------- |
| Diary (this)         | Agent + hooks  | Per-session, daily    |
| Episodes (v2)        | Scheduled task | Weekly/monthly        |
| Long-term/facts (v2) | Episode rollup | Permanent, conceptual |

Diary is the raw input. Episodes aggregate upward.
Long-term distills recurring concepts from episodes.
