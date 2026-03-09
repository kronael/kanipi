# Shipped Spec Audit

## Summary

- 19 specs fully verified
- 6 specs had gaps — all fixed

## Gaps Found (all resolved)

### 0-actions.md

- [x] 5 missing MCP tools added to `ipc-mcp-stdio.ts`: delegate_group, escalate_group, set_routing_rules, refresh_groups, inject_message
- [x] `list_tasks` spec updated to reflect implementation
- [x] `register_group` tier check clarified in spec (tier ≤ 1)

### 5-cli.md

- [x] Spec updated: manual arg parsing, single cli.ts, folder=root, user/mount subcommands

### 7-db-bootstrap.md

- [x] Spec updated: `src/migrations/` path

### F-group-routing.md

- [x] Code fixed: `isAuthorizedRoutingTarget` now allows any descendant (was direct child only)

### 4-channels.md

- [x] "To ship" section renamed to "Open" — messages.raw is a future item

### Q-mime.md

- [x] GenericFileSaver noted as covered by pipeline default; status → shipped
