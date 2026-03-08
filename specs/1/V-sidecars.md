# MCP Sidecars

**Status**: partial

The shipped part is gateway-managed sidecars configured on the group's
`container_config.sidecars`.

## Shipped

- per-group sidecar config in `registered_groups.container_config`
- sidecar startup before agent run
- readiness probe via socket wait
- socket entries merged into `~/.claude/settings.json`
- sidecar cleanup after agent exit

Implementation: `src/container-runner.ts`

## Current transport

```text
agent        -> /workspace/ipc/sidecars/<name>.sock
sidecar      -> /run/socks/<name>.sock
host bridge  -> shared socket dir under group IPC/session state
```

## Current spec shape

```typescript
interface SidecarSpec {
  image: string;
  env?: Record<string, string>;
  memoryMb?: number;
  cpus?: number;
  network?: 'bridge' | 'none';
  allowedTools?: string[];
}
```

## Not yet shipped

- `request_sidecar`
- `stop_sidecar`
- `list_sidecars`
- operator approval / allowlist flow for agent-requested sidecars

## Notes

- whisper is the reference precedent for an external sidecar pattern
- gateway-managed sidecars work today; agent-requested sidecars remain open
