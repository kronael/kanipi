# Draft Skill

Browse configured sources for relevant conversations and create post drafts.

## When to use

Run on cron (every few hours) to find new threads worth engaging with.
Also run manually: `/draft` to trigger an immediate browse-and-draft cycle.

## Steps

1. Read `~/facts/sources.md` — get the sources list and search terms
2. Read `~/facts/product.md` — load product knowledge and talking points
3. Read existing `~/posts/*/` frontmatter — collect `source:` URLs to dedup
4. For each source/search term:
   a. Use WebSearch to find recent relevant discussions
   b. Use WebFetch to read promising threads
   c. Score relevance 1-10 based on:
   - Problem fit: user has a problem the product solves
   - Feature match: discussion about a capability we have
   - Community fit: tone and context appropriate for engagement
     d. Skip anything scoring below 6
     e. Skip URLs already in existing posts/ files
5. For each qualifying thread, create `~/posts/drafts/YYYYMMDD-<slug>.md`:

```markdown
---
platforms: [reddit]
targets: [r/example]
schedule: tomorrow afternoon
strategy: helpful_reply
source: https://reddit.com/r/...
relevance: 8
created: 2026-03-18T22:00:00Z
---

Draft response text here...
```

6. Report summary: N threads checked, M drafts created, K skipped

## Filename convention

`YYYYMMDD-<slug>.md` where slug is a 3-5 word kebab-case summary of the thread.
Example: `20260318-whatsapp-multi-agent-question.md`

## Strategy guide

- `helpful_reply` — user asked a question, answer it + mention product if relevant
- `feature_mention` — thread discusses something the product does; mention it naturally
- `experience_share` — share a usage pattern or outcome relevant to the discussion

Choose strategy based on what would genuinely help the conversation.

## Notes

- Write to `posts/drafts/` ONLY — never write to other pipeline directories
- Never set a `status:` frontmatter field — the directory is the status
- Never fabricate quotes or claims about the product
- If unsure whether engagement is appropriate, set relevance low and add a note in the draft
- The draft is for human review — err on the side of drafting; reviewer will reject if needed
