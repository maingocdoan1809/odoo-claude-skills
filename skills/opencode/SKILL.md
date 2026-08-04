---
name: opencode
description: Delegate mechanical work to the free opencode CLI so Claude doesn't burn its own tokens on it. Covers four subcommands routed by argument — "/opencode research ..." / "/opencode ask ..." for read-only codebase questions, "/opencode session ..." for multi-turn research sessions (start/continue/top/list/delete), "/opencode commit ..." (aka "/opencode ship ...") for the FULL stage→commit→push→PR→(optional squash-merge) pipeline once Claude has agreed a strategy with the user, and "/opencode playwright ..." to execute an already-written Playwright test spec. Use whenever the user types "/opencode ...", says "hỏi opencode" / "nhờ opencode tìm" / "để opencode commit/push/tạo PR", or whenever a task is mostly mechanical (multi-file search, staging+committing, driving a browser test) rather than a judgment call.
---

# opencode — delegate mechanical work

opencode (free CLI, `~/.opencode/bin/opencode`) does mechanical work in its
own context and hands back a short result, instead of Claude spending its
own tokens on grep/git status/diff reading. Every mode below runs under a
locked-down opencode agent whose permissions were verified with
`opencode agent list`, not just prompt wording.

**Claude's job changed from "do the mechanical work" to "negotiate the
strategy, then hand it off."** For commit/ship in particular: Claude should
NOT run `git status`/`git diff`/`git log` itself and should NOT write the
commit message or PR description — that is now entirely opencode's job,
reading the diff in its own context. Claude's only job upstream is asking
the user what they want (which branch, PR title/description style, merge or
not) and then calling `ship.sh` with that strategy.

| Subcommand | What it does | Script |
|---|---|---|
| `research` / `ask` | One-shot read-only question | `research/ask.sh` |
| `session` | Multi-turn read-only research (start/continue/top/list/delete) | `research/session.sh` |
| `commit` / `ship` | Full stage→commit→push→PR→(optional merge) pipeline | `ship/ship.sh` |
| `playwright` | Execute an already-written Playwright test spec | `playwright-test/playwright-test.sh` |

Full detail per mode lives in each subfolder's own `README.md` — read only
the one you need for the current call, don't load all three.

## Session memory — check before you call `start`

**Before calling `session.sh start` for a topic, ask yourself: did I already
open a session on this topic earlier in THIS conversation?** If the
conversation already shows a `SESSION_ID=...` line from an earlier turn on
the same topic, reuse it with `session.sh continue <id>` — don't start a new
one just because it's a new tool call. Starting a fresh session per question
throws away context opencode already built up and doubles the token/time
cost for no reason.

If you're not sure / lost track of the ID mid-conversation, don't guess —
run:
```bash
~/.claude/skills/opencode/research/session.sh top 5
```
This prints the 5 most recently touched sessions (id, working dir, age,
last-touched line) in one line each, cheap enough to run any time you're
unsure rather than defaulting to `start`. Only start a genuinely new session
when the topic is actually different from anything recently open.

## `commit` / `ship` — full pipeline, not just a local commit

This subcommand now covers stage → commit → push → PR → optionally
squash-merge, all in one opencode call, via `ship/ship.sh`. Read
[`ship/README.md`](ship/README.md) before using it — it documents the
protected-branch guard, the known limitation around bare `git push`, and why
merging into `production` is refused even with `--merge`.

Workflow:
1. **Ask the user for the strategy** — don't assume. At minimum: which base
   branch the PR targets (almost always `develop`), roughly what the PR
   title/description should say, and whether opencode should also
   squash-merge after creating the PR or just stop at the PR.
2. Call `ship/ship.sh [dir] "<strategy>" [--merge]`.
3. Report back what opencode did (`DONE <PR URL> [merged|not merged]` or
   `BLOCKED: <reason>`). A `BLOCKED` result means something needs a human
   look — don't retry blindly.
4. This still only ships to `develop`. Production release stays the separate
   `ship-to-production` skill, explicitly requested each time — never chain
   into it automatically from here.

## `checkpr` — post-merge CI/deploy status

If the current project has a Jenkins-deploy-check-style skill available
(check the skill listing / `Skill` tool), invoke it after a merge to confirm
the build actually deployed — a merge isn't done until the pipeline is
green. This project (thienmenh) does not have one wired up (it uses GitHub
Actions, not Jenkins) — the existing `jenkins-deploy-check` skill is scoped
to a different project's repos. Don't force that skill onto a project it
wasn't built for; if no CI-check skill exists here, say so rather than
guessing at `gh run` commands ad hoc.

## What NOT to use this for (applies to all subcommands)

- Any decision you're accountable for — delegate the mechanical execution
  (staging, pushing, opening the PR, driving the browser), not the judgment
  call (what the strategy should be, whether the diff is actually correct,
  whether a failing CI run is safe to ignore).
- Production merges/deploys — always the separate, explicitly-requested
  `ship-to-production` flow.
- Answers/results that need high-confidence verification before acting on
  something risky — opencode runs on smaller/weaker free models that
  occasionally get it wrong or answer in the wrong format. Treat its output
  as a lead to confirm, not a final source of truth.
