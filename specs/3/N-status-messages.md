# Agent-Initiated Status Updates

**Status**: spec

Agent emits `<status>` blocks during long tasks. The agent-runner detects
them in the output stream, sends each one immediately as an interim result,
and strips them from the final text.

## Problem

The current heartbeat (every 100 SDK messages, snippet of last assistant
text) is mechanical and misleading:

- Fires on SDK internal messages, not meaningful milestones
- Snippet is random assistant output, not a deliberate user-facing message
- Agent cannot signal intent: "searching…", "reading files…", "writing…"

The user gets either silence or an opaque counter with a random text chunk.

## Design

### Block format

```
<status>searching facts for telescope models…</status>
```

- Opening tag: `<status>` (8 chars), closing: `</status>`
- Case-sensitive, exact match
- Content: one line, under 100 characters
- No nesting (a `<status>` block may not contain another `<status>`)
- Multiple blocks allowed in one turn — each fires an immediate send

### Detection and stripping: agent-runner

Happens in `container/agent-runner/src/index.ts`, inside `runQuery`, after
each `result` message (where `textResult` is assembled). The same pass that
strips `<think>` blocks (see `specs/3/M-think-blocks.md`) is extended to
also handle `<status>`.

```typescript
// Returns { cleaned: string; statuses: string[] }
function extractStatusBlocks(text: string): {
  cleaned: string;
  statuses: string[];
} {
  const statuses: string[] = [];
  const cleaned = text.replace(
    /<status>([\s\S]*?)<\/status>/g,
    (_match, content) => {
      statuses.push(content.trim());
      return '';
    },
  );
  return { cleaned: cleaned.trim(), statuses };
}
```

Called on `textResult` before the final `writeOutput`. For each extracted
status, an interim `writeOutput` is called first:

```typescript
const { cleaned, statuses } = extractStatusBlocks(textResult ?? '');
for (const s of statuses) {
  writeOutput({ status: 'success', result: `⏳ ${s}`, newSessionId });
}
writeOutput({ status: 'success', result: cleaned || null, newSessionId });
```

The interim writes are indistinguishable from the existing 100-message
heartbeat: `status: 'success'` with a non-null `result`. The gateway already
handles multiple outputs per container run — it sends each one to the channel.

### Mechanical heartbeat

The 100-message heartbeat (lines 357–360 in `index.ts`) can be removed once
agents use `<status>` reliably. For now it stays as a fallback — do not
remove it in the same change. Mark it for removal in a follow-up.

### Agent instruction

Add to `container/CLAUDE.md`, after the `# Diary` section:

```
# Status Updates

For long-running tasks, emit `<status>text</status>` to keep the user
informed. The agent-runner strips these blocks and sends them as interim
updates before your final answer.

Examples:
  <status>searching facts for antenna models…</status>
  <status>reading 12 files, synthesising…</status>
  <status>writing response…</status>

Keep status text short (one line, under 100 chars). Multiple blocks are
fine — each sends an immediate update to the user.
```

### What the user sees

Each `<status>` block produces a message like:

```
⏳ searching facts for antenna models…
```

followed eventually by the final answer. This mirrors the existing heartbeat
prefix so the UX is consistent.

## Scope

- One helper function added to `container/agent-runner/src/index.ts`
- Called once, just before `writeOutput` of the final result
- No gateway changes required (interim outputs already supported)
- Agent-side: one section added to `container/CLAUDE.md`
- ~15 lines total

## What this does NOT cover

- Streaming partial text to the channel mid-generation (would require
  gateway changes — out of scope)
- `<status>` blocks inside `<think>` blocks: the think-block stripper runs
  first, so nested status blocks inside think are silently dropped — correct
  behaviour since the whole think block is hidden
- Unclosed `<status>` tags: treat as literal text (do not strip), same
  conservative stance as `<think>` unclosed tags
