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
content_id: optional-shared-id # optional: links related cross-platform posts
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

## Discovery

The dashboard discovers evangelist groups by scanning GROUPS_DIR recursively
for a `.evangelist` marker file (single line: `evangelist`).

`findEvangelistGroups(groupsDir)` in `src/dashboards/evangelist.ts`:

- Returns `{folder: 'atlas/evangelist', dir: '/srv/.../groups/atlas/evangelist'}[]`
- Shell page shows a group selector dropdown when multiple groups are found

Template includes `templates/evangelist/.evangelist` so seeded groups are
auto-discovered.

## Content pieces

Posts in the same pipeline directories may share a `content_id:` frontmatter
field. Same idea, multiple platform posts (e.g. one thread → twitter thread +
reddit reply + bluesky post).

```yaml
content_id: launch-v2-march # optional — agent sets on related posts
```

The dashboard groups posts with the same `content_id` visually in the drafts
view (shown as a labelled cluster row, not separate rows).

## Calendar view

Fragment: `GET /dash/evangelist/x/calendar?group=<folder>` (60s refresh)

Shows posts from `approved/` and `scheduled/`. Grouped by date:

- ISO date in `schedule:` field → shown under that date (sorted ascending)
- Natural-language schedule → shown under "Unscheduled"

Rendered as `<dl>` (date = `<dt>`, each post = `<dd>` with platform badge,
target, first line of body). No visual grid.

Tab: "Calendar" in dashboard shell alongside Drafts/Approved/Posted/Knowledge.

## Knowledge tab

Fragment: `GET /dash/evangelist/x/knowledge?group=<folder>` (120s refresh)

Shows `facts/sources.md` and `facts/product.md` in `<pre>` blocks.
Read-only. Tab: "Knowledge".

## Template

`templates/evangelist/` seeds a new evangelist group:

```
templates/evangelist/
  .evangelist             — marker file for auto-discovery
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
2. **Drafts** tab — files in `posts/drafts/`. Two card modes:
   - **Tweet mode**: platforms is only `twitter` OR body < 300 chars → compact inline card
     (platform badge + 120-char preview + approve/reject)
   - **Post mode**: everything else → full table row (source, relevance, strategy, schedule,
     200-char body excerpt, approve/reject)
   - Posts sharing `content_id` shown as a labelled cluster
3. **Approved** tab — files in `posts/approved/` with schedule
4. **Calendar** tab — `approved/` + `scheduled/` posts grouped by date
5. **Posted** tab — last 20 files in `posts/posted/`
6. **Knowledge** tab — `facts/sources.md` and `facts/product.md` in `<pre>` blocks

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
