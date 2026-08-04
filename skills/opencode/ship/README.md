# Ship delegation (commit → push → PR → optional merge)

Delegate the full mechanical shipping pipeline — staging, writing the
commit message, pushing, opening the PR, and (only when told to)
squash-merging it — to opencode's locked-down `git-shipper` agent instead of
doing it yourself.

```bash
~/.claude/skills/opencode/ship/ship.sh [dir] "<strategy agreed with the user>" [--merge]
```

**Why:** reading `git status`/`git diff`/`git log` yourself and composing
the commit message/PR description burns your own context on content (diffs)
you often already touched while editing — that's the real token cost, not
the git/gh calls themselves. Delegating means opencode reads the diff in its
own context and only a one-line result comes back into yours.

**Claude's job upstream of this script: negotiate the strategy, not do the
mechanics.** Before calling this script, ask the user (don't assume):
- Which base branch the PR targets (almost always `develop`).
- Roughly what the PR title/description should communicate.
- Whether opencode should also squash-merge after creating the PR, or stop
  at the PR for a human to merge.

Pass all of that as the `<strategy>` string. Still applies regardless of
delegation: only invoke this when the user has actually asked to
commit/ship — this script doesn't change the "don't commit unless asked"
rule, it just changes who executes the mechanical part, and now covers more
of the pipeline than just the commit.

## Safety — whitelist, not blocklist

The `git-shipper` agent (defined in `~/.config/opencode/opencode.jsonc`) has
`edit: deny`, `external_directory: deny`, and a `bash` permission map that
only allows:

```
git status* / git diff* / git log* / git show* / git branch --show-current*
git add <file>
git commit -m "..."
git push -u origin <current-feature-branch>   (develop/main/production explicitly denied)
gh pr create / gh pr view / gh pr checks / gh pr merge
```

Every other command — `reset`, `checkout`, `rebase`, `branch -D`, `commit
--amend`, `--no-verify`, `--force`, any non-git/gh shell command — is not on
the whitelist, so it falls through to a catch-all `deny`. It cannot edit
files and cannot touch directories outside the repo.

## Protected-branch guard — two layers, neither alone sufficient

1. **Script-level**: `ship.sh` refuses to run at all if the currently
   checked-out branch is `develop`/`main`/`master`/`production`.
2. **Permission-level**: `git push -u origin develop|main|production` is
   explicitly denied ahead of the general `git push -u origin *` allow.

**Known gap**: neither layer stops a bare `git push` (no branch named in the
command) while a protected branch happens to be checked out — the branch
name only appears in the command string when spelled out. Layer 1 (the
script's upfront guard) is what actually closes this in practice, since it
means opencode never even gets invoked from a protected branch. The prompt
also tells opencode to double check `git branch --show-current` first as a
third, softer layer.

## Merging — `develop` only, never `production`

`gh pr merge` is in the whitelist so opencode *can* merge when `--merge` is
passed, but the prompt requires it to run `gh pr view --json baseRefName`
first and refuse (`BLOCKED`) if the base is `production`. This is a
prompt-level rule, not a permission-level one — the base branch isn't
reliably present in the merge command string either. For anything actually
shipping to production, use the separate `ship-to-production` skill, which
stays a manual, explicitly-requested flow every time — never chain into it
from here.

## Exit codes

- `0` — prints `DONE <PR URL> [merged|not merged]`. Success.
- `2` — prints `BLOCKED: <reason>`. opencode refused to guess (conflict,
  hook failure, unclear what to stage, PR already exists with different
  content, base branch is production). Treat this as "come back and look",
  not a bug.
- `3` — didn't answer in the expected format (rare). Run `git log -1
  --stat` and `gh pr view` yourself to check what actually happened before
  trusting anything.

## Known limitation (inherited from the commit-only version)

The whitelist pattern `git commit -m *` matches by prefix, so in theory
extra flags could be appended after the message text (e.g. `--no-verify`).
Residual risk is low since the prompt sent to opencode is authored by
Claude, not by an untrusted external source — but the agent's system prompt
also explicitly forbids `--amend`/`--no-verify`/`--force` as a second layer
of defense.
