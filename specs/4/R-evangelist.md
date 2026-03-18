---
status: spec
---

# Evangelist

Community engagement agent. Monitors the web for relevant conversations
and drafts responses for human review before posting.

Supersedes earlier planned spec (SQLite-based draft storage) in favour of
a file-based approach: posts are markdown files with YAML frontmatter in
`posts/`. No gateway DB changes required.

## What it does

1. **Browse** — agent uses WebSearch/WebFetch to find relevant threads on
   configured sources (subreddits, search terms, sites from `facts/sources.md`)
2. **Draft** — writes `posts/drafts/YYYYMMDD-<slug>.md` with frontmatter + draft text
3. **Review** — human approves or rejects via the Evangelist dashboard (moves files)
4. **Post** — agent scans `posts/approved/`, interprets schedule, posts via social
   actions (Skill tool calling `post`/`reply`), moves file to `posts/posted/`

## Pipeline directories

Posts move between directories — the directory IS the status:

```
posts/
  drafts/     ← agent writes here ONLY
  approved/   ← operator moves files here (dashboard)
  scheduled/  ← agent moves here after interpreting schedule
  posted/     ← agent moves here after posting
  rejected/   ← operator moves files here (dashboard)
```

## Post file format

Files live in `posts/<dir>/` inside the group folder:

```
posts/drafts/YYYYMMDD-<slug>.md
```

Frontmatter:

```yaml
---
platforms: [reddit, twitter, bluesky]
targets: [r/claudeai, r/LocalLLaMA]
schedule: tomorrow afternoon
strategy: helpful_reply | feature_mention | experience_share
source: https://...
relevance: 8
created: 2026-03-18T22:00:00Z
---
```

Agent interprets frontmatter loosely — targets, schedule, strategy are hints
not rigid schema. Schedule in natural language ("peak hours", "this weekend")
is resolved by the agent at post time.

Strategy types:

- `helpful_reply` — answer a question, link to docs
- `feature_mention` — relevant feature exists, mention naturally
- `experience_share` — share usage experience (conversational)

## Architecture

```
web (WebSearch/WebFetch) → agent browses sources
        ↓ cron: draft skill
posts/drafts/
        ↓ human approves via /dash/evangelist/ (file move)
posts/approved/
        ↓ cron: post skill (schedule check)
posts/scheduled/
        ↓ cron: post skill (posts via social actions)
posts/posted/
```

## Agent skills

Two skills in the group's `.claude/skills/`:

### `draft/SKILL.md`

Browses configured sources from `facts/sources.md`. Uses WebSearch/WebFetch
to find relevant conversations. For each relevant thread:

- Scores relevance 1-10
- Writes `posts/drafts/YYYYMMDD-<slug>.md` with frontmatter + draft text
- Skips threads already present in any `posts/` subdirectory (dedup by source URL)

Reads `facts/product.md` for product knowledge and talking points.
Runs on cron (e.g. every few hours).

### `post/SKILL.md`

Scans `posts/approved/` for files ready to post. For each:

- Checks schedule against current time
- If due, posts via social actions (Skill tool: `post` or `reply`)
- Moves file to `posts/posted/` on success

Runs on cron (e.g. hourly).

## Engagement rules

The agent's CLAUDE.md encodes engagement principles:

- Never lie about what the product does
- Never disparage competitors
- Be genuinely helpful first, promotional second
- Match community tone
- Don't engage in every thread — quality over quantity
- Disclose affiliation when directly asked
- No astroturfing — one account per platform, transparent identity

## Template

`templates/evangelist/` seeds a new evangelist group:

```
templates/evangelist/
  CLAUDE.md               — routing note, persona, engagement rules
  SOUL.md                 — professional community member persona
  facts/sources.md        — monitored sources (fill in per deployment)
  facts/product.md        — product knowledge and talking points
  env.example             — social platform credentials
  .claude/skills/
    draft/SKILL.md        — draft-browsing cron skill
    post/SKILL.md         — post-scheduling cron skill
```

## Dashboard (`/dash/evangelist/`)

File browser over the group's `posts/` directories.

URL: `/dash/evangelist/?group=<folder>` (default: first group named `evangelist`)

### Sections

1. **Summary bar** — counts by directory (drafts/approved/posted/rejected)
2. **Drafts queue** — files in `posts/drafts/`: source URL, relevance, strategy, schedule,
   draft text preview. Approve/Reject buttons (move files to approved/ or rejected/).
3. **Scheduled** — files in `posts/approved/` with schedule
4. **Posted history** — last 20 files in `posts/posted/`

### API endpoints

- `GET  /dash/evangelist/api/posts?group=<folder>` — JSON list of all posts
- `POST /dash/evangelist/api/posts/:filename/approve` — moves file from drafts/ to approved/
- `POST /dash/evangelist/api/posts/:filename/reject` — moves file from drafts/ to rejected/

Dashboard health: warn if drafts queue > 10 or any draft > 3 days old.

## Migration

Migration 040 added to `templates/default/.claude/skills/self/migrations/`.
Informs agents that the evangelist template is available.

## Out of scope

- Auto-posting (all drafts require human review)
- Custom gateway actions (uses existing social actions)
- Custom ingestion pipeline (agent browses web directly)
- SQLite draft storage (files are simpler and git-trackable)
