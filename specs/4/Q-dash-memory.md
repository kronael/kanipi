---
status: spec
---

# Dashboard: Memory & Knowledge

Per-group browser for agent knowledge stores. View MEMORY.md,
diary entries, episode summaries, facts, and user context files.
Read-only -- operators inspect what agents know without editing.

## Criticism of Previous Design

The v0 spec (planned, never shipped) was a per-group editor with
PUT endpoints. Problems:

1. **Editing is dangerous** -- operators changing MEMORY.md while
   an agent session is active causes confusion. Read-only first.
2. **Per-group URL scheme was wrong** -- `/dash/memory/:folder/`
   bakes the group into the URL path, complicating routing. Better:
   group selector in the UI, folder as query param.
3. **No cross-group view** -- can't compare what different groups
   know or search across all groups.
4. **No episode/user context** -- only covered MEMORY.md, diary,
   and facts. Episodes and user files are equally important.

## Screen

Monospace font, max-width 900px, centered. Back link to portal.
H1: "Memory & Knowledge".

### 1. Group Selector

Dropdown of all groups. Defaults to first group. Changing group
reloads all sections via HTMX.

### 2. MEMORY.md

Full content displayed in a `<pre>` block. Shows file size and
last modified time.

### 3. CLAUDE.md (group)

The group's CLAUDE.md content in a collapsible `<details>` block.

### 4. Diary

List of diary entries (newest first). Each entry shows date and
first line (summary). Clickable -> expands to show full content.
Shows last 30 entries.

### 5. Episodes

List of episode files grouped by type (daily, weekly, monthly).
Each shows date range and summary line. Expandable.

### 6. User Context

List of `users/*.md` files. Each shows filename (user identifier)
and first line. Expandable to full content.

### 7. Facts

List of `facts/*.md` files. Each shows filename, `summary:`
frontmatter value, and file size. Expandable.

### 8. Search

Text input that searches across all knowledge stores for the
selected group. Searches file contents (simple substring match).
Results show filename, matched line, and context.

## Health Function

```typescript
health(ctx): { status, summary }
// Always ok (memory is passive data)
// summary: "12 groups, 847 knowledge files"
```

## Stories

1. Operator opens `/dash/memory/` -> sees group selector, MEMORY.md for first group
2. Operator switches group -> all sections reload for new group
3. Operator clicks diary entry -> expands to show full content
4. Operator searches "deployment" -> results across all stores
5. Episode section shows daily/weekly/monthly grouping
6. User context section shows per-user memory files
7. Facts section shows summary frontmatter for quick scanning
8. Large MEMORY.md renders in scrollable pre block
9. Empty sections show "no files" rather than hiding
10. File modification times shown to gauge freshness

## HTMX Fragments

```
GET /dash/memory/x/selector               -> group dropdown
GET /dash/memory/x/memory?group=<f>       -> MEMORY.md content
GET /dash/memory/x/claude-md?group=<f>    -> CLAUDE.md content
GET /dash/memory/x/diary?group=<f>        -> diary entry list
GET /dash/memory/x/diary-entry?group=<f>&file=<name>  -> single entry
GET /dash/memory/x/episodes?group=<f>     -> episode list
GET /dash/memory/x/users?group=<f>        -> user context list
GET /dash/memory/x/facts?group=<f>        -> facts list
GET /dash/memory/x/file?group=<f>&path=<p>  -> any file content
GET /dash/memory/x/search?group=<f>&q=<query>  -> search results
```

## API

```
GET /dash/memory/api/groups                -> list of groups with file counts
GET /dash/memory/api/files?group=<f>       -> file tree for group
GET /dash/memory/api/file?group=<f>&path=<p>  -> file content (plain text)
GET /dash/memory/api/search?group=<f>&q=<q>   -> search results JSON
```

### `GET /api/files?group=root`

```json
{
  "group": "root",
  "memory": {
    "path": "MEMORY.md",
    "size": 2048,
    "modified": "2026-03-17T08:00:00Z"
  },
  "claude_md": {
    "path": "CLAUDE.md",
    "size": 1024,
    "modified": "2026-03-15T12:00:00Z"
  },
  "diary": [
    {
      "path": "diary/20260317.md",
      "size": 512,
      "modified": "2026-03-17T09:00:00Z",
      "summary": "deployed v1.5.0"
    }
  ],
  "episodes": [
    { "path": "episodes/20260317.md", "type": "daily", "size": 1024 },
    { "path": "episodes/2026-W11.md", "type": "weekly", "size": 2048 }
  ],
  "users": [
    {
      "path": "users/alice.md",
      "size": 256,
      "modified": "2026-03-16T14:00:00Z"
    }
  ],
  "facts": [
    {
      "path": "facts/deployment-checklist.md",
      "size": 512,
      "summary": "Steps for production deploy"
    }
  ]
}
```

## DashboardContext Dependencies

- `getAllGroupConfigs()` -- group list
- `groupsDir` -- base path for reading group files
- File system access to group folders (read-only):
  - `MEMORY.md`, `CLAUDE.md`
  - `diary/*.md`, `diary/week/*.md`, `diary/month/*.md`
  - `episodes/*.md`
  - `users/*.md`
  - `facts/*.md`

## Path Safety

Only read files matching the known store patterns. Reject paths
with `..`, absolute paths, or outside the allowlist. Use
`resolveGroupFolderPath()` for base resolution.

## Not in Scope

- File editing (read-only for now)
- Cross-group search (search within selected group only)
- Semantic/embedding search (use `/recall` in agent)
- Diff view or version history
- Session transcript (`.jl`) browsing
