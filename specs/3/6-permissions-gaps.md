# Permission Gaps

**Status**: open

Remaining items from the permissions spec that are not yet implemented.
See `5-permissions.md` for what is shipped.

## web mount enforcement (tier 2 and 3)

The mount table specifies `no` for `/workspace/web` at tier 2 and tier 3.
Container-runner must enforce this. Agents at these tiers can still reach
web content via HTTP — they do not need direct filesystem access to the
web directory.

## Explicit depth rejection

`permissionTier()` clamps depth ≥ 3 to tier 3 (worker). It does not prevent
groups from being registered at depth 4+. `register_group` should reject
folder paths deeper than depth 3.

## Main → root migration

The root folder is named `main` on existing instances but the spec names it
`root`. A CLI command or migration is needed to rename the root group folder
and update the `registered_groups` record.

## Escalation response protocol

`escalate_group` sends a message to the parent container but the parent has
no structured way to return a result to the child. A request/response protocol
is needed — likely an IPC round-trip similar to the existing request files,
but initiated from the child side.

## Host/web actions

Web virtual host management (create/destroy per-group vhosts) is deferred to
`8-web-virtual-hosts.md`.
