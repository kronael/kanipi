# Think Blocks

**Status**: shipped

Agent uses `<think>` delimiters for internal reasoning. The agent-runner
strips the block before the gateway sees it. If the agent never exits
`<think>`, nothing is sent — enabling clean silent decisions.

## Problem

Group-chat agents must sometimes stay silent. The instruction "produce NO
output at all" is brittle — agents often leak a brief explanation. The root
cause: no safe place to reason before deciding whether to respond.

## Design

- `<think>...</think>` tags, case-sensitive, supports nesting (depth-tracking)
- Stripping happens in agent-runner before `writeOutput` — zero gateway changes
- Unclosed `<think>` hides everything after it (safe default)
- Empty result after stripping becomes `null` (silent turn)
- Agent instruction: open `<think>` before producing any visible text when
  deliberating. Silence is the natural result of never closing the block.

## What this does NOT cover

- Tool calls (happen before final text, unaffected)
- Tier-based authorization (orthogonal)
- `<think>` in code samples — agents should use backticks
