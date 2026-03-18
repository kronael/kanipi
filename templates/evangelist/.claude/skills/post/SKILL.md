# Post Skill

Scan approved post drafts and publish those that are due.

## When to use

Run on cron (hourly) to check for approved posts ready to publish.
Also run manually: `/post` to trigger an immediate posting cycle.

## Steps

1. Glob `~/posts/approved/*.md` — collect all approved post files
2. For each approved post:
   a. Parse `schedule:` field using natural language interpretation:
   - "now" / "immediately" → post now
   - "tomorrow afternoon" → next day 13:00-17:00
   - "peak hours" → 09:00-12:00 or 18:00-21:00 in a reasonable timezone
   - "this weekend" → Saturday or Sunday
   - Specific datetime → honour it
     b. If not yet due, move to `posts/scheduled/` and skip
     c. If due, post via appropriate social action:
   - Use the `post` skill for top-level posts
   - Use the `reply` skill for replies to existing threads
   - Pass the draft text from the file body
   - Pass `source:` URL as the target thread for replies
3. On success, move the file to `posts/posted/`
4. On failure, log the error in diary and leave the file in `posts/approved/` to retry

## Safety

- NEVER read from or touch `posts/drafts/` or `posts/rejected/`
- NEVER post a file that is already in `posts/posted/`
- If the source URL is unreachable or thread deleted, move file to `posts/rejected/`
  and add a comment in the file body explaining why

## Report

After each run, report:

- N approved posts checked
- M posted successfully
- K skipped (not yet due, moved to scheduled/)
- Any errors encountered
