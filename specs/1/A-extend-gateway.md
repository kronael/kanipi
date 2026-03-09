# Extensibility

**Status**: reference

Two surfaces: agent-side (SDK, see `extend-agent.md`) and
gateway-side (compiled TypeScript registries, this doc).

## Gateway registries

| Registry      | Location                              | How to extend                           |
| ------------- | ------------------------------------- | --------------------------------------- |
| Actions       | `src/actions/` (planned)              | Add action file, auto-registers         |
| Commands      | `src/commands/`                       | `registerCommand()` at startup          |
| Channels      | `src/channels/`                       | New file + conditional init in index.ts |
| MIME handlers | `src/mime-handlers/`                  | New handler + add to array              |
| Agent hooks   | `container/agent-runner/src/index.ts` | Add to `hooks:` object                  |

Details for each: `actions.md`, `commands.md`, `channels.md`,
`mime.md`.

### Inbound pipeline (hardcoded)

`processGroupMessages()` in `index.ts`. 10 sequential steps
with data deps. Not worth abstracting.

### Volume mounts (hardcoded)

`buildVolumeMounts()` in `container-runner.ts`. 10 mounts
with clear conditionals. Not worth abstracting.

## Design principles

- Lean on the SDK, don't rebuild extension mechanisms
- Keep hardcoded what only developers touch
- Registries where external code lives
- No custom framework, no manifests, no directory scanning
