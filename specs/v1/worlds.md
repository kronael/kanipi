# Worlds

**Status**: partial

What ships today:

- normalized JID schemes in DB (`telegram:`, `discord:`, `whatsapp:`, `email:`, `web:`)
- nested group folders using `/`
- world boundary checks based on first folder segment
- share-dir mounting by world

What does not ship today:

- glob-based JID routing
- wildcard registered-group lookup

## JID format

```text
channel:id
```

Current examples:

| Channel  | Example               |
| -------- | --------------------- |
| telegram | `telegram:-100123456` |
| discord  | `discord:1234567890`  |
| whatsapp | `whatsapp:12345@g.us` |
| email    | `email:<thread-id>`   |
| web      | `web:main`            |

## Group folders

```text
main
main/code
main/code/py
atlas
atlas/support
```

World = first folder segment.

```typescript
worldOf('atlas/support') === 'atlas';
```

## Authorization boundary

Current routing and task authorization use same-world checks.

- same world: allowed where the action permits it
- cross world: denied

Parent-to-descendant routing/delegation must also stay inside the source
subtree.

## Share mount

The container runner mounts:

```text
/workspace/share <- groups/<world>/share
```

Tier 0 and world groups can write there. deeper groups are readonly.

## Open

- wildcard JID registration
- hierarchical platform JIDs like `telegram:chat:thread`
- tree-wide IPC auth beyond current action checks
