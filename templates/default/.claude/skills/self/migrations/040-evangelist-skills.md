# Migration 040: evangelist template

Added `templates/evangelist/` — a kanipi group template for community
engagement. Key design: posts are markdown files with YAML frontmatter
in `posts/`, no DB table. Two skills:

- `draft/SKILL.md` — browse web via WebSearch/WebFetch, create post drafts
- `post/SKILL.md` — scan approved posts, post via social actions, mark posted

Dashboard at `/dash/evangelist/` provides approve/reject UI over the posts/
directory. First write-capable dashboard in kanipi.

No agent-side changes required — this migration is informational only.
