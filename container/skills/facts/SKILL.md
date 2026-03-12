---
name: facts
description: Retrieve or research facts. Use for any question that may
  have known answers in facts/. Also use to create new facts when
  knowledge is missing or stale.
user_invocable: true
arg: <question or topic>
---

# Facts

facts/ is your knowledge base. Use it for both retrieval and creation.

## Retrieval first

Before researching anything, scan what you already know:

```
Grep("header:", "facts/", -A 4)
```

This returns the `header:` line plus 4 lines of content for every fact
file — enough to read all summaries in one shot. The `header:` field is
a multi-line YAML block scalar; the actual text is on the indented lines
after `header: >`. Read the full file only for entries that look relevant.

A fact is fresh enough to trust if `verified_at` is within 14 days.
If the matching fact is older than 14 days, treat it as a starting
point — verify and update rather than discarding.

If headers contain a good answer → answer directly, no research needed.
If headers are relevant but stale → go to Step 1 with the existing files
as starting knowledge.
If no headers match → go to Step 1 fresh.

## Step 1: Research (subagent)

Spawn a research subagent with the topic. It must:

- Read any relevant existing fact files found above
- Search codebase refs in /workspace/extra/ (Grep, Read)
- Search the web (WebSearch, WebFetch)
- Write new or updated fact files to facts/ with YAML frontmatter:
  ```yaml
  ---
  path: <slug>
  category: <top-level category>
  topic: <specific topic>
  verified_at: <ISO timestamp>
  header: >
    <one-paragraph summary — this is the retrieval key, make it dense>
  ---
  <full content with sources, code refs, explanations>
  ```
- One fact per file, named by topic slug
- Update existing files if refreshing stale knowledge (update verified_at)
- Stop after 3-10 new/updated facts

## Step 2: Verify (subagent per batch)

For each batch of new facts (max 5 per batch), spawn a verifier
subagent. It must:

- Read each new fact file
- Cross-reference against codebase and web sources
- Check for contradictions with existing facts
- Check that cited sources support the claims
- Delete facts that fail verification
- Update verified_at on facts that pass

## Step 3: Answer

Read the surviving fact files, then answer the user's original
question using them as knowledge. Don't report the research
process — just answer naturally as if you always knew.

## Rules

- ALWAYS use subagents — never research in main context
- Batch verification: max 5 facts per verifier subagent
- Research subagent tools: Read, Glob, Grep, WebSearch, WebFetch, Write
- Verifier subagent tools: Read, Glob, Grep, WebSearch, WebFetch, Bash
- headers must be dense enough to answer simple questions without reading the full file
