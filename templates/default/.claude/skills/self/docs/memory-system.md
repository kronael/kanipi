# Memory System

Seven layers split into push (gateway-injected each session) and pull (agent-searched on demand).

## Push layers — always available in context

| Layer        | Storage                 | How injected                                  |
| ------------ | ----------------------- | --------------------------------------------- |
| Messages     | SQLite                  | recent N as `<messages>` XML                  |
| Session      | `.jsonl` transcript     | `--resume <id>` (Claude Code native)          |
| Managed      | `CLAUDE.md`/`MEMORY.md` | Claude Code reads natively                    |
| Diary        | `~/diary/*.md`          | 14 most recent as `<diary>` XML               |
| User context | `~/users/*.md`          | `<user memory="~/users/tg-xxx.md" />` pointer |
| Episodes     | `~/episodes/*.md`       | recent day/week/month as `<episodes>` XML     |

## Pull layers — search on demand

| Layer | Storage        | How to search                                          |
| ----- | -------------- | ------------------------------------------------------ |
| Facts | `~/facts/*.md` | `/recall-memories <query>`                             |
| All   | all stores     | `/recall-memories` searches facts/diary/users/episodes |

## MEMORY.md

Stable, terse knowledge: user preferences, long-term projects, recurring patterns.

- Keep entries under 200 lines total
- Always report to user what you wrote: `memory: "prefer cursor-based pagination"`
- Never update silently
- Prune stale entries — run `/diary` periodically to review

Location: `~/.claude/projects/*/memory/MEMORY.md` (Claude Code native memory).

## facts/

File-based knowledge store. One `.md` file per fact topic.

Format: YAML frontmatter + markdown body.

```markdown
---
summary: User prefers metric units for all measurements
verified_at: 2026-03-20
---

Alice always uses metric. When presenting data, use km, kg, °C.
```

Create/update facts via `/facts` skill. Search via `/recall-memories`.

**Good fact**: single topic, `summary:` line that's searchable, `verified_at` date.

**When to update**: after researching something, after user confirms a preference, when existing fact is stale (>14 days for volatile topics).

**When to research fresh**: no match found, or match is stale — run `/facts` to research and create/update.

## diary/

Daily work log. Gateway injects 14 most recent entries as `<diary>` XML each session.

Write during sessions for: tasks done, decisions made, open questions, things to continue.

```bash
# Write entry (use /diary skill or write directly)
cat >> ~/diary/$(date +%Y%m%d).md << 'EOF'
- Researched X, found Y
- User wants Z next session
EOF
```

## users/

Per-user context files. Gateway injects `<user memory="~/users/tg-123.md" />` per sender.

Read when a user message arrives (unless trivial exchange). Update via `/users` skill.

Structure:

- **Profile section**: role, expertise, preferences (stable)
- **Recent section**: meaningful interactions (~50 lines, auto-compact)

```bash
ls ~/users/          # list known users
cat ~/users/tg-123456.md
```

## episodes/

Progressive summaries of session transcripts. Gateway injects as `<episodes>` XML.

Created by `/compact-memories` skill (run via scheduled tasks):

```
sessions (.jsonl) → episodes/YYYYMMDD.md   (daily,  cron: 0 2 * * *)
daily          → episodes/YYYY-Wnn.md    (weekly, cron: 0 3 * * 1)
weekly         → episodes/YYYY-MM.md     (monthly, cron: 0 4 1 * *)
```

Diary also gets compressed: `diary/week/` and `diary/month/` for `/recall` search.

## Previous session recovery

On new session, gateway injects `<previous_session id="abc123">`. Read the transcript:

```bash
ls -t ~/.claude/projects/-home-node/*.jsonl | head -5
# then Read the matching file
```

Never claim "no access to session history" — the `.jl` files are accessible.

## Recall workflow

Before answering a technical question:

1. Run `/recall-memories <question>`
2. For each match: does it fully answer? Is it fresh (verified_at < 14 days)?
3. Full match + fresh → answer from it
4. Full match but stale → run `/facts` to refresh, then answer
5. No full match → run `/facts` to research and create, then answer

Partial or tangential matches = not relevant, ignore them.
