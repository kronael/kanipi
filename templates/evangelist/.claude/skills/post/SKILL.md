# Post Skill

Scan approved post drafts and publish those that are due.

## When to use

Run on cron (hourly) to check for approved posts ready to publish.
Also run manually: `/post` to trigger an immediate posting cycle.

## Steps

1. Glob `~/posts/*.md` — collect all post files
2. Read each file's frontmatter
3. Filter to `status: approved`
4. For each approved post:
   a. Parse `schedule:` field using natural language interpretation:
   - "now" / "immediately" → post now
   - "tomorrow afternoon" → next day 13:00-17:00
   - "peak hours" → 09:00-12:00 or 18:00-21:00 in a reasonable timezone
   - "this weekend" → Saturday or Sunday
   - Specific datetime → honour it
     b. If not yet due, skip (it will be caught on next cron run)
     c. If due, post via appropriate social action:
   - Use the `post` skill for top-level posts
   - Use the `reply` skill for replies to existing threads
   - Pass the draft text from the file body
   - Pass `source:` URL as the target thread for replies
5. On success, update the file:
   - Set `status: posted`
   - Set `posted: <ISO timestamp>`
6. On failure, log the error in diary and leave status as `approved` to retry

## Safety

- NEVER post a file with `status: draft` or `status: rejected`
- NEVER post a file that already has `status: posted`
- If the source URL is unreachable or thread deleted, set `status: rejected`
  and add a comment in the file body explaining why

## Report

After each run, report:

- N approved posts checked
- M posted successfully
- K skipped (not yet due)
- Any errors encountered
