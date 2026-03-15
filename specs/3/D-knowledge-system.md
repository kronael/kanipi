---
status: shipped
---

# Knowledge System

The pattern underlying diary, facts, episodes, and user context.
Each is: markdown files in a directory, summaries selected and
injected into agent context.

## Memory Layers

| Layer    | Spec                | Status  | Storage   |
| -------- | ------------------- | ------- | --------- |
| Messages | 1/N-memory-messages | shipped | DB (SQL)  |
| Session  | 3/E-memory-session  | shipped | SDK (.jl) |
| Managed  | 1/M-memory-managed  | shipped | Files     |
| Diary    | 1/L-memory-diary    | shipped | Files     |
| User ctx | 3/7-user-context    | shipped | Files     |
| Facts    | 3/1-atlas           | shipped | Files     |
| Recall   | 3/T-recall          | shipped | Files+DB  |
| Compact  | 4/B-memory-episodic | shipped | Files     |

Messages, sessions, and MEMORY.md have their own implementations
and aren't instances of this pattern.

## The pattern

Given a directory of markdown files:

1. **Index** — scan files, extract summaries (frontmatter)
2. **Select** — choose which to surface (by recency, sender, relevance)
3. **Surface** — push into prompt, or pull on agent demand
4. **Nudge** — at defined moments, prompt the agent to write/update

## Push vs pull

**Push** — small corpus, gateway injects automatically:

- **Diary** — 14 most recent, injected on session start
- **User context** — sender pointer per message, agent reads file
- **Episodes** — most recent day/week/month (when built)

**Pull** — large corpus, agent searches on demand:

- **Facts** — agent greps summaries, deliberates, reads matches
- **Recall** — `/recall` skill across all layers (see T-recall.md)

## Injection format

```xml
<diary count="14">
  <entry key="20260306" age="today">summary</entry>
</diary>

<user id="tg-123456" name="Alice" memory="~/users/tg-123456.md" />

<episodes count="3">
  <entry key="20260314" type="day">summary</entry>
  <entry key="2026-W11" type="week">summary</entry>
  <entry key="2026-02" type="month">summary</entry>
</episodes>
```

## Nudges

- Hook-based: PreCompact, Stop, session start
- Message-based: first message from unknown user
- Skill-based: `/diary`, `/facts`
- Scheduled: cron triggers researcher, `/compact-memories` aggregation

## Specs

| Spec                | What                                             |
| ------------------- | ------------------------------------------------ |
| 1/L-memory-diary    | Diary layer (shipped)                            |
| 1/M-memory-managed  | MEMORY.md + CLAUDE.md (shipped, not pattern)     |
| 1/N-memory-messages | Message history DB (shipped, not pattern)        |
| 3/7-user-context    | User context layer (shipped)                     |
| 3/1-atlas           | Facts + researcher (shipped)                     |
| 3/3-code-research   | Research agent prompts (shipped)                 |
| 3/E-memory-session  | SDK sessions (shipped, not pattern)              |
| 3/T-recall          | /recall retrieval (open)                         |
| 4/B-memory-episodic | Progressive compression: episodes + diary (open) |
