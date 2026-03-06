# Facts

YAML markdown knowledge files. The agent's institutional memory.

## Format

```markdown
---
topic: validator-bonds
verified_at: 2026-01-15
confidence: high
---

# Validator Bonds Overview

Validators post bonds as collateral...
```

Frontmatter: topic, verified_at, confidence (high/medium/low), source.
Body: markdown paragraphs. Each paragraph is a searchable unit.

## Storage

`/workspace/group/facts/*.md` — flat directory, one file per topic slug.
Subdirectories allowed for organization (e.g., `facts/marinade-validators/`).

## Index

`facts/INDEX.md` — auto-generated summary of all facts.
Topic, file count, last verified date. Rebuilt by `/index-facts` skill
or after research writes new files.

## Injection

? How should facts reach the agent context?

- Diary-style: gateway injects N most relevant on session start
- On-demand: agent reads facts/ when it needs them
- Hybrid: inject index + let agent pull specific files

? What triggers relevance matching?

- User's question text
- Conversation history
- Both?

## Open questions

- How large can the facts corpus get before grep stops working?
- When do we need embeddings vs keyword search?
- Should facts be read-only for the agent or writable?
- How to handle conflicting facts (old vs new)?
- Versioning: git track facts/ or treat as ephemeral?
