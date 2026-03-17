---
status: spec
---

# Dashboard: Groups & Routing

Operator view of the group hierarchy, routing configuration, and
per-group settings. Shows the world structure as a tree, routing
rules, and group configuration.

## Screen

Monospace font, max-width 900px, centered. Back link to portal.
H1: "Groups & Routing".

### 1. Summary Bar

Counts: total groups, worlds (tier 0), active groups (with
running container or queued messages).

```
14 groups | 3 worlds | 5 active
```

### 2. Group Tree

Hierarchical view of groups organized by world (root folder
segment). Tree rendered as indented text with connectors:

```
root/                     [tier 0] [active]
  support/                [tier 1]
    support/alice/        [tier 2] [active]
    support/bob/          [tier 2]
  dev/                    [tier 1] [active]

marinade/                 [tier 0]
  marinade/general/       [tier 1] [active]
```

Each group shows: folder path, tier, active badge (if container
running or queue non-empty). Clickable -> expands inline to show
group detail.

### 3. Group Detail (expanded)

When a group node is clicked, expands inline to show:

- **Config**: name, folder, tier, requires_trigger, world
- **Routes**: routing rules for this group's JIDs (type, match,
  target, sequence)
- **Queue state**: active, idle, pending msgs/tasks, failures
- **Container**: running container name and uptime (if active)
- **Knowledge files**: count of MEMORY.md, diary, episodes, facts,
  users (links to memory dashboard)
- **Tasks**: count of scheduled tasks (links to tasks dashboard)

### 4. Routing Table

Full routing table, grouped by JID. Columns: JID, seq, type,
match, target folder. Sorted by JID then sequence.

Color coding:

- `command` type: blue
- `pattern`/`keyword` type: purple
- `sender` type: orange
- `default` type: grey

Template targets (`{sender}`) shown with a distinct marker.

### 5. World Map

Text visualization of the world hierarchy. Each world is a
separate block showing the nesting structure and tier assignments.
Same data as group tree but focused on the tier/permission model.

```
World: root
  T0  root/
  T1  root/support/
  T2  root/support/{sender}/
  T1  root/dev/
```

## Health Function

```typescript
health(ctx): { status, summary }
// Always ok (groups are static config)
// summary: "14 groups, 3 worlds"
```

## Stories

1. Operator opens `/dash/groups/` -> sees group tree with tier badges
2. Active groups highlighted with badge
3. Operator clicks a group -> expands to show config, routes, queue state
4. Routing table shows all rules grouped by JID
5. Template routes (`{sender}`) visually distinct
6. World map shows tier hierarchy for permission understanding
7. Group detail links to memory dashboard for that group
8. Group detail links to tasks dashboard for that group's tasks
9. Operator finds which JID routes to which group via routing table
10. Routing types color-coded for quick visual scanning

## HTMX Fragments

```
GET /dash/groups/x/summary                -> summary bar (30s refresh)
GET /dash/groups/x/tree                   -> group tree (30s refresh)
GET /dash/groups/x/detail?folder=<f>      -> expanded group detail
GET /dash/groups/x/routes                 -> full routing table (60s refresh)
GET /dash/groups/x/worlds                 -> world map (60s refresh)
```

## API

```
GET /dash/groups/api/groups               -> all groups with config
GET /dash/groups/api/group?folder=<f>     -> single group detail
GET /dash/groups/api/routes               -> full routing table
GET /dash/groups/api/worlds               -> world structure
```

### `GET /api/groups`

```json
[
  {
    "name": "root",
    "folder": "root",
    "tier": 0,
    "requires_trigger": false,
    "world": "root",
    "active": true,
    "container": "nanoclaw-root-abc",
    "queue": { "pending_messages": 0, "pending_tasks": 1, "failures": 0 },
    "knowledge_files": {
      "memory": true,
      "diary": 12,
      "episodes": 5,
      "facts": 3,
      "users": 4
    },
    "task_count": 3
  }
]
```

### `GET /api/worlds`

```json
[
  {
    "name": "root",
    "groups": [
      { "folder": "root", "tier": 0 },
      { "folder": "root/support", "tier": 1 },
      { "folder": "root/support/{sender}", "tier": 2, "template": true },
      { "folder": "root/dev", "tier": 1 }
    ]
  }
]
```

## DashboardContext Dependencies

- `getAllGroupConfigs()` -- group list with tier, folder, name
- `getAllRoutes()` -- routing table
- `GroupQueue.getStatus()` -- per-JID queue state
- `docker ps` -- active containers (cached, shared with status dashboard)
- `groupsDir` -- base path for counting knowledge files
- File system: count files in diary/, episodes/, facts/, users/
  per group (stat only, no content read)

## Not in Scope

- Route editing (use CLI `group route add/rm`)
- Group creation/deletion
- Tier changes
- Route testing/simulation ("what would this message match?")
