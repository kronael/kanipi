---
name: recall
description: Search knowledge stores for relevant information.
user_invocable: true
arg: <question>
---

# Recall

Search `facts/`, `diary/`, `users/`, `episodes/` for information
relevant to a question. Read-only — never writes files.

## Protocol

Spawn an Explore subagent with the query. The subagent:

1. Grep `summary:` in `*.md` across facts/, diary/, users/, episodes/
2. Read each summary value
3. Judge: does this summary relate to the query?
4. Return matches: file path, store name, why it matches

Example subagent prompt:

Search for markdown files whose `summary:` frontmatter relates to:
"<question>"

Directories: facts/, diary/, users/, episodes/

For each .md file, read the YAML `summary:` field. Return only
files where the summary clearly relates to the query. Report:
file path, directory, and why it matches.

## After results

Deliberate in `<think>` (mandatory):

1. List matched files
2. For each: what does it say? Does it answer? What gap?
3. Verdict: use it, refresh via `/facts`, or research fresh

## When to use

- Technical question → /recall (searches facts/)
- Question about a person → /recall (searches users/)
- Question about recent work → /recall (searches diary/)
- Trivial message → skip
