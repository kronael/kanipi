# Monitored Sources

Configure the sources the draft skill should browse. The agent reads this file
before each draft run and searches/browses accordingly.

## Subreddits

```
# Add subreddits to monitor (one per line, with r/ prefix):
# r/claudeai
# r/LocalLLaMA
# r/selfhosted
# r/MachineLearning
```

## Search terms

```
# Add search terms to look for across the web:
# "<product name>" site:reddit.com
# "<product name>" review
# "<product name>" alternative
# "<competitor name>" vs "<product name>"
```

## Sites and forums

```
# Specific sites to check for relevant discussions:
# news.ycombinator.com
# lobste.rs
# dev.to
```

## Instructions for agent

- Search each source for new discussions mentioning the product or related topics
- Prioritise threads where users have a problem the product solves
- Skip threads already represented in posts/ (check source URL in frontmatter)
- Score relevance 1-10 before drafting; skip anything below 6
