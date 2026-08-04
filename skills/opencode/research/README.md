# Research (read-only)

opencode's default `plan` agent, `edit: deny` on `*` (verified via
`opencode agent list`) — it cannot write or edit files no matter what the
prompt says. Two modes: one-shot for a single question, session for a
multi-turn back-and-forth that needs earlier context.

## One-shot (single question)

```bash
~/.claude/skills/opencode/research/ask.sh "<prompt>" [dir]
```

## Session (multi-turn conversation)

```bash
# Start a new session
~/.claude/skills/opencode/research/session.sh start "<prompt>" [dir]
# Output includes: SESSION_ID=<uuid>

# Continue the last session
~/.claude/skills/opencode/research/session.sh continue "<prompt>"

# Continue a specific session
~/.claude/skills/opencode/research/session.sh continue "<prompt>" <session-id>

# Quick recall: 5 most recently touched sessions, one line each
~/.claude/skills/opencode/research/session.sh top 5

# List active sessions
~/.claude/skills/opencode/research/session.sh list

# Clean up when done
~/.claude/skills/opencode/research/session.sh delete <session-id>
```

## When to use which

**Session** when:
- User explicitly wants a "conversation" with opencode ("khởi tạo session", "hỏi tiếp opencode")
- The research needs context from previous answers (e.g. "Hàm đó được gọi từ đâu?")
- Multiple related questions about the same area of code

**One-shot** when:
- Simple lookup ("where is X defined")
- Unrelated questions
- When you don't need follow-up context

## Rules for the prompt you send

Both scripts already wrap whatever you pass in with fixed constraints
(read-only, short answer with `file:line`, say "not found" instead of
guessing) — you don't need to restate those. The one thing still on you:
**state the scope explicitly** (which directory/module) — an unscoped
prompt makes opencode search the whole tree and burns time for nothing.

5 minute timeout built in, with fallback across several free models (see
`OPENCODE_MODELS` in the scripts). On timeout or failure the script prints a
clear `ERROR: ...` line to stderr and exits non-zero — if you see that,
don't just retry blindly; narrow the prompt's scope or fall back to doing
the search yourself.

## Examples

### One-shot query
```bash
~/.claude/skills/opencode/research/ask.sh \
  "Trong thư mục backend/src/auth, tìm hàm xử lý refresh token" \
  /home/doanmn/work/thienmenh
```

### Multi-turn session
```bash
# User: "Khởi tạo session opencode để research về auth flow"
session.sh start "Tìm tất cả endpoint liên quan đến authentication trong backend/src/auth" \
  /home/doanmn/work/thienmenh
# => SESSION_ID=abc-123-...

# User: "Hỏi tiếp: hàm refresh token được gọi từ đâu?"
session.sh continue "Hàm refresh token được gọi từ controller/middleware nào?"

# User: "Middleware đó apply cho route nào?"
session.sh continue "Middleware JwtAuthGuard này được dùng ở route nào?"

# When done
session.sh delete abc-123-...
```

## Two ways this gets triggered

1. **You decide to delegate.** The user's request is vague and needs
   exploration before you can plan real work (e.g. "where does auth
   currently live", "why might this build be failing"). Write the prompt
   yourself and call the script.
2. **The user asks directly** ("nhờ opencode tìm...", "hỏi opencode xem...").
   Pass their intent through with light cleanup for scope/clarity, don't
   rewrite it into something they didn't ask for.
