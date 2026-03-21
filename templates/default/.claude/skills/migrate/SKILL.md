---
name: migrate
description: Sync skills and run pending migrations across all groups. Root group only. Use when asked to "migrate", "sync skills", "update skills", or "run migrations".
---

# Migrate

Root group only. Refuse if `NANOCLAW_IS_ROOT` is not `1`.

```bash
if [ "$NANOCLAW_IS_ROOT" != "1" ]; then echo "ERROR: migrate is root-group only"; exit 1; fi
echo "root group confirmed"
```

## a) Skill sync

Copy updated skills from source to all group session dirs.

```bash
src=/workspace/self/container/skills

for session in ~/groups/*/; do
  skills_dir="$session/.claude/skills"
  test -d "$skills_dir" || continue
  group=$(basename "$session")
  updated=""
  for skill in "$src"/*/; do
    name=$(basename "$skill")
    dest="$skills_dir/$name"
    # Skip locally managed skills (disabled: true or managed: local in frontmatter)
    if grep -qE "^(disabled: true|managed: local)" "$dest/SKILL.md" 2>/dev/null; then continue; fi
    # Compare SKILL.md; copy if missing or changed
    if ! diff -q "$skill/SKILL.md" "$dest/SKILL.md" >/dev/null 2>&1; then
      cp -r "$skill" "$dest"
      updated="$updated $name"
    fi
  done
  test -n "$updated" && echo "$group: updated$updated" || echo "$group: up to date"
done
```

## b) Run pending migrations

For each group session, check MIGRATION_VERSION and run missing migrations.

```bash
src=/workspace/self/container/skills/self/migrations

for session in ~/groups/*/; do
  skills_dir="$session/.claude/skills/self"
  test -d "$skills_dir" || continue
  group=$(basename "$session")
  current=$(cat "$skills_dir/MIGRATION_VERSION" 2>/dev/null || echo 0)
  pending=$(ls "$src"/*.md 2>/dev/null \
    | grep -oP '/(\d+)-' | grep -oP '\d+' | sort -n \
    | awk -v v="$current" '$1 > v')
  if test -z "$pending"; then
    echo "$group: no pending migrations (version $current)"
    continue
  fi
  echo "$group: running migrations: $pending"
  for n in $pending; do
    f=$(ls "$src"/$(printf '%03d' $n)-*.md 2>/dev/null | head -1)
    test -f "$f" || continue
    echo "  → migration $n: $f"
    cat "$f"
    echo "$n" > "$skills_dir/MIGRATION_VERSION"
  done
done
```

## c) Re-read CLAUDE.md

After migrations that update `~/.claude/CLAUDE.md`, re-read it to apply
changes in the current session:

```bash
cat ~/.claude/CLAUDE.md
```

## d) Apply template overlays

For each group with `~/.claude/skills/self/TEMPLATES`, apply named overlays from `/workspace/self/templates/<name>/`.

```bash
src_templates=/workspace/self/templates

for session in ~/groups/*/; do
  self_dir="$session/.claude/skills/self"
  tfile="$self_dir/TEMPLATES"
  test -f "$tfile" || continue
  group=$(basename "$session")

  while IFS= read -r name || [ -n "$name" ]; do
    name=$(echo "$name" | tr -d '[:space:]')
    [ -z "$name" ] && continue
    tdir="$src_templates/$name"
    if [ ! -d "$tdir" ]; then
      echo "  $group: warning: template '$name' not found, skipping"
      continue
    fi

    [ -f "$tdir/SOUL.md" ]   && cp "$tdir/SOUL.md"   "$session/SOUL.md"   && echo "$group: $name: SOUL.md"
    [ -f "$tdir/SYSTEM.md" ] && cp "$tdir/SYSTEM.md" "$session/SYSTEM.md" && echo "$group: $name: SYSTEM.md"

    if [ -f "$tdir/CLAUDE.md" ]; then
      target="$session/.claude/CLAUDE.md"
      python3 -c "
import re
src = open('$tdir/CLAUDE.md').read()
tgt = open('$target').read() if __import__('os').path.exists('$target') else ''
parts = re.split(r'(?=^## )', src, flags=re.M)
with open('$target', 'a') as f:
    for p in parts:
        h = re.match(r'^(## [^\n]+)', p)
        if h and h.group(1) not in tgt:
            f.write(('\n' if tgt.rstrip() else '') + p)
            tgt += p
"
      echo "$group: $name: CLAUDE.md merged"
    fi

    if [ -d "$tdir/.claude/skills" ]; then
      for skill_dir in "$tdir/.claude/skills/"/*/; do
        sname=$(basename "$skill_dir")
        dest="$session/.claude/skills/$sname"
        grep -qE "^(disabled: true|managed: local)" "$dest/SKILL.md" 2>/dev/null && continue
        cp -r "$skill_dir" "$dest" && echo "$group: $name: skills/$sname"
      done
    fi

    if [ -d "$tdir/.claude/output-styles" ]; then
      mkdir -p "$session/.claude/output-styles/"
      cp "$tdir/.claude/output-styles/"* "$session/.claude/output-styles/" 2>/dev/null
      echo "$group: $name: output-styles"
    fi
  done < "$tfile"

  date -u +%Y-%m-%dT%H:%M:%SZ > "$self_dir/TEMPLATES.applied"
  echo "$group: overlays done"
done
```

Report summary of groups updated and migrations run.
