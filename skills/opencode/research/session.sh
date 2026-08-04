#!/usr/bin/env bash
# Multi-turn session wrapper for opencode (agent "plan").
# Usage:
#   session.sh start "<prompt>" [dir]         # Start new session
#   session.sh continue "<prompt>" [session]  # Continue existing session
#   session.sh list                           # List active sessions
#   session.sh delete <session>               # Delete a session
set -euo pipefail

ACTION="${1:-}"
shift || true

TIMEOUT_SECS="${OPENCODE_TIMEOUT:-300}"  # 5 minutes per attempt
MODELS="${OPENCODE_MODELS:-opencode/big-pickle opencode/deepseek-v4-flash-free opencode/mimo-v2.5-free opencode/ling-3.0-flash-free opencode/laguna-s-2.1-free opencode/nemotron-3-ultra-free opencode/north-mini-code-free}"

# Session state dir
SESSION_DIR="$HOME/.opencode/claude-sessions"
mkdir -p "$SESSION_DIR"

# Helper: wrap user prompt with constraints
wrap_prompt() {
  local user_prompt="$1"
  cat <<EOF
Yêu cầu bắt buộc, không được vi phạm:
- Chỉ đọc và tìm hiểu, TUYỆT ĐỐI không sửa file, không viết code mới, không đề xuất diff.
- Trả lời ngắn gọn, ưu tiên dạng file:line, không diễn giải dài dòng.
- Nếu không tìm thấy hoặc không chắc, nói rõ 'không tìm thấy / không chắc' thay vì đoán.
- Không copy nguyên đoạn code dài vào câu trả lời, chỉ trích tối đa 1-2 dòng nếu thực sự cần.
- Mỗi ý một dòng dạng 'file:line — mô tả ngắn', không dùng markdown heading/table/emoji.
- Trả lời thẳng vào nội dung, không mô tả quá trình tìm kiếm, không lời mở đầu/kết luận thừa.

Câu hỏi:
$user_prompt
EOF
}

# Helper: run opencode with fallback models
run_opencode() {
  local session_arg="$1"
  local prompt="$2"
  local dir="${3:-$PWD}"

  local last_status=1
  for MODEL in $MODELS; do
    local cmd=(timeout "$TIMEOUT_SECS" opencode run)
    [ -n "$session_arg" ] && cmd+=($session_arg)
    cmd+=(
      --agent plan
      --auto
      -m "$MODEL"
      --dir "$dir"
      "$prompt"
    )

    if out=$("${cmd[@]}" 2>&1); then
      status=0
    else
      status=$?
    fi

    if [ "$status" -eq 0 ]; then
      echo "$out"
      return 0
    fi

    last_status=$status
    if [ "$status" -eq 124 ]; then
      echo "WARN: $MODEL timed out after ${TIMEOUT_SECS}s, trying next model" >&2
      continue
    fi
    if echo "$out" | grep -qiE "quota|rate.?limit|429|insufficient|credit"; then
      echo "WARN: $MODEL appears out of quota, trying next model" >&2
      continue
    fi
    # Non-quota, non-timeout error: stop here
    echo "$out" >&2
    echo "ERROR: $MODEL exited with status $status" >&2
    return "$status"
  done

  echo "ERROR: all models exhausted or unavailable (last exit status $last_status)" >&2
  return "$last_status"
}

case "$ACTION" in
  start)
    if [ $# -lt 1 ]; then
      echo "Usage: session.sh start \"<prompt>\" [dir]" >&2
      exit 1
    fi
    USER_PROMPT="$1"
    DIR="${2:-$PWD}"

    PROMPT=$(wrap_prompt "$USER_PROMPT")

    # Start new session with a title to make it easier to track
    # Truncate to avoid excessively long titles
    title="Claude: $(echo "$USER_PROMPT" | head -c 40)"

    # opencode run creates a session automatically
    output=$(run_opencode "--title \"$title\"" "$PROMPT" "$DIR")
    echo "$output"

    # Get the session ID - it's the newest one with our title pattern
    # opencode session list format: "ses_XXXX   Title   Time"
    # Session IDs are base58-like: ses_ + 26 chars
    session_id=$(opencode session list 2>/dev/null | grep -oE 'ses_[a-zA-Z0-9]{26}' | head -1)

    if [ -n "$session_id" ]; then
      # Save session metadata
      echo "$DIR" > "$SESSION_DIR/$session_id.dir"
      date +%s > "$SESSION_DIR/$session_id.timestamp"
      echo "# Session created: $(date)" > "$SESSION_DIR/$session_id.log"
      echo "" >&2
      echo "SESSION_ID=$session_id" >&2
      echo "Use: session.sh continue \"<next-question>\" $session_id" >&2
    fi
    ;;

  continue)
    if [ $# -lt 1 ]; then
      echo "Usage: session.sh continue \"<prompt>\" [session-id]" >&2
      echo "If session-id is omitted, continues the last session" >&2
      exit 1
    fi
    USER_PROMPT="$1"
    SESSION_ID="${2:-}"

    # If no session ID provided, use the last one
    if [ -z "$SESSION_ID" ]; then
      SESSION_ID=$(ls -t "$SESSION_DIR"/*.timestamp 2>/dev/null | head -1 | xargs basename | sed 's/.timestamp$//')
      if [ -z "$SESSION_ID" ]; then
        echo "ERROR: no active sessions found. Use 'session.sh start' first." >&2
        exit 1
      fi
      echo "# Continuing last session: $SESSION_ID" >&2
    fi

    # Get the directory from session metadata
    if [ -f "$SESSION_DIR/$SESSION_ID.dir" ]; then
      DIR=$(cat "$SESSION_DIR/$SESSION_ID.dir")
    else
      DIR="$PWD"
    fi

    PROMPT=$(wrap_prompt "$USER_PROMPT")

    # Continue session
    output=$(run_opencode "--session $SESSION_ID" "$PROMPT" "$DIR")
    echo "$output"

    # Update timestamp
    date +%s > "$SESSION_DIR/$SESSION_ID.timestamp"
    echo "# Continued: $(date)" >> "$SESSION_DIR/$SESSION_ID.log"
    ;;

  top)
    N="${1:-5}"
    if [ ! -d "$SESSION_DIR" ] || [ -z "$(ls -A "$SESSION_DIR"/*.timestamp 2>/dev/null || true)" ]; then
      echo "(no sessions tracked yet)"
      exit 0
    fi
    ls -t "$SESSION_DIR"/*.timestamp | head -n "$N" | while read -r ts_file; do
      session_id=$(basename "$ts_file" .timestamp)
      timestamp=$(cat "$ts_file")
      dir=$(cat "$SESSION_DIR/$session_id.dir" 2>/dev/null || echo "unknown")
      age=$(($(date +%s) - timestamp))
      age_human=$(printf '%dd %dh %dm' $((age/86400)) $((age%86400/3600)) $((age%3600/60)))
      last_line=$(tail -1 "$SESSION_DIR/$session_id.log" 2>/dev/null || echo "")
      echo "$session_id  |  $dir  |  ${age_human} ago  |  $last_line"
    done
    ;;

  list)
    echo "Active opencode sessions (tracked by this skill):"
    if [ -d "$SESSION_DIR" ] && [ -n "$(ls -A "$SESSION_DIR"/*.timestamp 2>/dev/null || true)" ]; then
      for ts_file in "$SESSION_DIR"/*.timestamp; do
        session_id=$(basename "$ts_file" .timestamp)
        timestamp=$(cat "$ts_file")
        dir=$(cat "$SESSION_DIR/$session_id.dir" 2>/dev/null || echo "unknown")
        age=$(($(date +%s) - timestamp))
        age_human=$(printf '%dd %dh %dm' $((age/86400)) $((age%86400/3600)) $((age%3600/60)))
        echo "  $session_id"
        echo "    Dir: $dir"
        echo "    Age: $age_human ago"
        echo ""
      done
    else
      echo "  (none)"
    fi
    echo ""
    echo "All opencode sessions (from opencode session list):"
    opencode session list 2>&1 | grep -v "opencode-mobile" | grep -v "Plugin init"
    ;;

  delete)
    if [ $# -lt 1 ]; then
      echo "Usage: session.sh delete <session-id>" >&2
      exit 1
    fi
    SESSION_ID="$1"

    # Delete session via opencode
    opencode session delete "$SESSION_ID" || true

    # Delete local metadata
    rm -f "$SESSION_DIR/$SESSION_ID".{dir,timestamp,log}
    echo "Session $SESSION_ID deleted"
    ;;

  *)
    cat >&2 <<EOF
Usage:
  session.sh start "<prompt>" [dir]         # Start new session
  session.sh continue "<prompt>" [session]  # Continue existing (or last) session
  session.sh top [N]                        # Quick recall: last N sessions (default 5), one line each
  session.sh list                           # List active sessions (verbose, cross-checked with `opencode session list`)
  session.sh delete <session>               # Delete a session

Examples:
  # Start a new research session
  session.sh start "Tìm hàm xử lý refresh token trong backend/src/auth" /home/user/project

  # Continue the last session with a follow-up question
  session.sh continue "Hàm đó được gọi từ đâu?"

  # Continue a specific session
  session.sh continue "Còn hàm login thì sao?" abc123-session-id

  # List all active sessions
  session.sh list

  # Clean up a session
  session.sh delete abc123-session-id
EOF
    exit 1
    ;;
esac
