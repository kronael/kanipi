---
status: spec
---

# Evangelist

Community engagement agent. Monitors the web for relevant conversations,
drafts responses using product knowledge and narrative strategy, submits for
human review, and posts approved drafts on schedule.

## 1. Overview

Four-step pipeline:

1. **Browse** — agent uses WebSearch/WebFetch to find relevant threads on
   configured sources (subreddits, search terms, sites from `facts/sources.md`)
2. **Draft** — reads `narratives/` first (story angles, voice), then `facts/`
   (product knowledge), then `ideas/` (operator inputs); writes
   `posts/drafts/YYYYMMDD-<slug>.md`
3. **Review** — operator approves or rejects via Evangelist dashboard (moves
   files between pipeline dirs)
4. **Post** — agent scans `posts/approved/`, interprets schedule, posts via
   social actions, moves file to `posts/posted/`

## 2. Directory layout

Full group folder structure for an evangelist group:

```
<group>/
  .evangelist                 # marker file — enables dashboard discovery
  CLAUDE.md                   # routing, engagement rules
  SOUL.md                     # persona definition

  narratives/                 # story angles — consulted FIRST when drafting
    <slug>.md                 # one narrative file per angle/theme

  facts/
    product.md                # product knowledge, features, talking points
    sources.md                # monitored sources: subreddits, search terms, sites

  ideas/                      # ephemeral operator inputs
    <YYYYMMDD>-<slug>.md      # one idea per file
    depleted/                 # agent moves here after drafting from the idea

  posts/
    drafts/                   # agent writes here ONLY
    approved/                 # operator moves here (dashboard)
    scheduled/                # agent moves here after interpreting schedule
    posted/                   # agent moves here after posting
    rejected/                 # operator moves here (dashboard)

  .claude/
    skills/
      draft/SKILL.md
      post/SKILL.md
```

## 3. Post file format

Filename: `posts/<dir>/YYYYMMDD-<slug>.md`

Slug: 3-5 word kebab-case summary of the thread.
Example: `20260318-whatsapp-multi-agent-question.md`

Frontmatter:

```yaml
---
platforms: [reddit, twitter, bluesky]
targets: [r/claudeai, r/LocalLLaMA]
schedule: tomorrow afternoon
strategy: helpful_reply
source: https://reddit.com/r/...
relevance: 8
content_id: optional-grouping-id # groups related platform posts together
narrative_id: optional-narrative-slug # links to narratives/ file used
created: 2026-03-18T22:00:00Z
---
Draft response text here.
```

Rules:

- Never set a `status:` field — the directory is the status
- `content_id` groups posts that are platform variants of the same content
  (e.g. same message for twitter + reddit). Dashboard clusters them visually.
- `narrative_id` links the post back to the narrative file that shaped its
  angle and voice
- `schedule` is natural language: "now", "tomorrow afternoon", "peak hours",
  "this weekend", or ISO datetime — agent resolves at post time
- `targets`, `schedule`, `strategy` are hints, not rigid schema — agent
  interprets them

Strategy types:

- `helpful_reply` — answer a question, link to docs; product mentioned if relevant
- `feature_mention` — relevant feature exists; mention it naturally in context
- `experience_share` — share a usage pattern or outcome relevant to the thread

## 4. Narrative format and purpose

Narratives are the agent's primary creative input. They encode story angles,
recurring themes, voice notes, and connective tissue across posts. The agent
reads `narratives/` BEFORE reading `facts/` when drafting — narrative shapes
how facts are expressed.

File: `narratives/<slug>.md`

```yaml
---
title: Decentralization Matters
tags: [staking, validators, defi]
created: 2026-03-18
---
Story angle and connective tissue here. Key phrases, voice notes,
recurring themes to weave in across posts.

What tension does this narrative resolve? What does the reader feel
after encountering it? What vocabulary carries the angle?
```

Purpose:

- Give the agent a consistent voice across many posts and platforms
- Surface non-obvious angles that pure fact-recitation misses
- Let the operator shape positioning without writing every draft
- `narrative_id` in post frontmatter links posts back to the narrative used

The `narratives/` directory is operator-maintained and long-lived. Entries
are not deleted after use — they accumulate and inform future drafts.

## 5. Idea format and lifecycle

Ideas are ephemeral operator inputs. The operator drops a rough observation,
angle, or topic into `ideas/`. The agent picks it up during the next draft
cycle, drafts from it, then moves it to `ideas/depleted/`.

File: `ideas/YYYYMMDD-<slug>.md`

```yaml
---
created: 2026-03-18
depleted: null # agent sets to ISO date when drafted
---
Raw idea or observation here. What's happening, what's on your mind.
Could reference a specific thread, a trend noticed, or a talking point
the operator wants surfaced.
```

Lifecycle:

1. Operator creates file in `ideas/`
2. Agent reads all non-depleted files in `ideas/` during `/draft`
3. Agent drafts one or more posts from each idea
4. Agent moves file to `ideas/depleted/` (sets `depleted:` field and moves)
5. Ideas in `ideas/depleted/` are preserved for history; agent ignores them

Ideas supplement web discovery — they seed targeted drafts without requiring
the agent to find threads organically.

## 6. Agent skills

### `/draft` — `draft/SKILL.md`

Browse configured sources and create drafts. Runs on cron (every few hours)
or manually via `/draft`.

Steps:

1. Read `narratives/` — load all narrative files (story angles, voice)
2. Read `facts/product.md` — load product knowledge and talking points
3. Read `facts/sources.md` — get sources list and search terms
4. Read `ideas/*.md` (excluding `ideas/depleted/`) — collect operator inputs
5. Read existing `posts/*/` frontmatter — collect `source:` URLs for dedup
6. For each idea file:
   - Draft one or more posts from the idea, applying narrative framing
   - Move idea to `ideas/depleted/` after drafting
7. For each source/search term:
   - Use WebSearch to find recent relevant discussions
   - Use WebFetch to read promising threads
   - Score relevance 1-10 (problem fit, feature match, community fit)
   - Skip anything below 6
   - Skip URLs already in existing `posts/` files
8. For each qualifying thread, write `posts/drafts/YYYYMMDD-<slug>.md`
9. Report: N threads checked, M ideas consumed, K drafts created, J skipped

Constraints:

- Write to `posts/drafts/` ONLY — never touch other pipeline directories
- Never set `status:` in frontmatter
- Never fabricate quotes or claims about the product
- Prefer drafting over skipping — reviewer will reject if needed
- If unsure about engagement appropriateness, set relevance low and add a
  note in the draft body

### `/post` — `post/SKILL.md`

Scan approved posts and publish those that are due. Runs on cron (hourly)
or manually via `/post`.

Steps:

1. Glob `posts/approved/*.md` — collect all approved post files
2. For each approved post:
   - Parse `schedule:` with natural language interpretation:
     - "now" / "immediately" → post now
     - "tomorrow afternoon" → next day 13:00-17:00
     - "peak hours" → 09:00-12:00 or 18:00-21:00
     - "this weekend" → Saturday or Sunday
     - ISO datetime → honour it
   - If not yet due: move to `posts/scheduled/`, skip
   - If due: post via social action (`post` for top-level, `reply` for
     thread replies; pass `source:` URL as reply target)
3. On success: move file to `posts/posted/`
4. On failure: log in diary, leave in `posts/approved/` for retry
5. If source URL is unreachable or thread deleted: move to `posts/rejected/`
   and add a comment in the file body explaining why
6. Report: N approved checked, M posted, K skipped (not due), errors

Constraints:

- Never touch `posts/drafts/` or `posts/rejected/`
- Never re-post a file already in `posts/posted/`

## 7. Dashboard (`/dash/evangelist/`)

### Discovery

Groups are identified by a `.evangelist` marker file. The dashboard scans
`GROUPS_DIR` recursively for this marker. Multiple evangelist instances are
supported; a group selector appears when more than one is found.

URL: `/dash/evangelist/?group=<folder>` (default: first discovered group)

### Tabs

1. **Drafts** — files in `posts/drafts/`. Two card modes:
   - Tweet card (compact): twitter-only platforms or body < 300 chars.
     Shows platform badge, body preview, Approve/Reject buttons inline.
   - Post card (full table row): source link, relevance, strategy, platforms,
     targets, schedule, body preview, created timestamp, Approve/Reject buttons.
   - Posts sharing a `content_id` are visually clustered under a cluster header.
   - Approve moves file `drafts/ -> approved/`; Reject moves to `rejected/`.

2. **Approved** — files in `posts/approved/`. Shows scheduled posts awaiting
   the post cron. Columns: file, source, relevance, strategy, platforms,
   targets, schedule, preview, approved timestamp. No action buttons.

3. **Calendar** — approved + scheduled posts on a timeline grouped by date.
   Posts with ISO-parseable schedule dates appear under their date; others
   under "Unscheduled". Shows platform badge, first target, first line of body.

4. **Posted** — last 20 files in `posts/posted/`. Columns: file, source,
   strategy, platforms, targets, time-ago.

5. **Knowledge** — renders `facts/sources.md` and `facts/product.md` as
   preformatted text. Read-only reference view.

### Summary bar

Always visible above tabs. Counts per pipeline directory:
Drafts (amber if >0) / Approved / Scheduled / Posted / Rejected.

### Health

Dashboard health warns if:

- Total drafts across all evangelist groups > 10
- Any draft is older than 3 days

### API endpoints

- `GET  /dash/evangelist/api/posts?group=<folder>` — JSON array of all posts
  across all pipeline directories
- `POST /dash/evangelist/api/posts/:filename/approve?group=<folder>` — moves
  file from `drafts/` to `approved/`
- `POST /dash/evangelist/api/posts/:filename/reject?group=<folder>` — moves
  file from `drafts/` to `rejected/`

Path safety: only `[\w-]+\.md` filenames are accepted.

### HTMX fragments

Partial HTML endpoints for live reload without full page refresh:

- `GET /dash/evangelist/x/summary` — summary bar HTML
- `GET /dash/evangelist/x/drafts` — drafts tab content
- `GET /dash/evangelist/x/scheduled` — approved tab content
- `GET /dash/evangelist/x/calendar` — calendar tab content
- `GET /dash/evangelist/x/history` — posted tab content
- `GET /dash/evangelist/x/knowledge` — knowledge tab content

## 8. Template (`templates/evangelist/`)

Seeds a new evangelist group. Copied by `kanipi create` or manually.

```
templates/evangelist/
  .evangelist                   # marker file (empty)
  CLAUDE.md                     # routing + engagement principles
  SOUL.md                       # persona: knowledgeable community member
  env.example                   # social platform credentials template
  facts/
    product.md                  # fill in: features, use cases, talking points
    sources.md                  # fill in: subreddits, search terms, sites
  .claude/
    skills/
      draft/SKILL.md            # browse-and-draft cron skill
      post/SKILL.md             # schedule-check-and-post cron skill
```

Not seeded (operator creates per deployment):

- `narratives/` — story angles; operator writes these
- `ideas/` — ephemeral inputs; operator creates on demand
- `posts/` — pipeline dirs; created by agent and dashboard on first use

## 9. Engagement rules

Encoded in `CLAUDE.md` and `SOUL.md`. Distilled:

- **Never lie** — accuracy over enthusiasm; honest about limitations
- **Never disparage competitors** — focus on what this product does well
- **Helpful first** — answer the question before mentioning the product
- **Match community tone** — technical in r/selfhosted, casual elsewhere
- **Disclose affiliation when asked** — never deny product connection
- **One account per platform** — no astroturfing, transparent identity
- **Quality over quantity** — skip threads where engagement feels forced
- **Short over long** — tight replies get read, essays get skipped

Voice (from SOUL.md): genuine, technically credible, peer-like. Not corporate,
not salesy. Does not argue with critics or defend every flaw.

## 10. Not in scope

- Auto-posting without human review
- Narratives/ideas tabs in dashboard (files read directly by agent; no UI)
- Custom gateway actions (uses existing social actions: `post`, `reply`)
- Custom ingestion pipeline (agent browses web via WebSearch/WebFetch)
- SQLite draft storage (files are simpler and git-trackable)
- Undo for approve/reject (file moves are final; re-draft if needed)
- Automated relevance tuning (agent scores 1-10; threshold fixed at 6)
