#!/usr/bin/env bash
# Wrapper: delegate a read-only research question to opencode (agent "plan").
# Fixed flags on purpose — never call `opencode` directly from this skill,
# always go through this script, so there is one correct invocation to remember.
set -euo pipefail

if [ $# -lt 1 ] || [ -z "${1:-}" ]; then
  echo "Usage: ask.sh \"<prompt>\" [dir]" >&2
  exit 1
fi

USER_PROMPT="$1"
DIR="${2:-$PWD}"
TIMEOUT_SECS="${OPENCODE_TIMEOUT:-300}"  # 5 minutes per attempt

# Fixed constraints, injected here so neither the caller (Claude Code) nor the
# user has to remember to state them every time.
PROMPT="Yêu cầu bắt buộc, không được vi phạm:
- Chỉ đọc và tìm hiểu, TUYỆT ĐỐI không sửa file, không viết code mới, không đề xuất diff.
- Trả lời ngắn gọn, ưu tiên dạng file:line, không diễn giải dài dòng.
- Nếu không tìm thấy hoặc không chắc, nói rõ 'không tìm thấy / không chắc' thay vì đoán.
- Không copy nguyên đoạn code dài vào câu trả lời, chỉ trích tối đa 1-2 dòng nếu thực sự cần.
- Mỗi ý một dòng dạng 'file:line — mô tả ngắn', không dùng markdown heading/table/emoji.
- Trả lời thẳng vào nội dung, không mô tả quá trình tìm kiếm, không lời mở đầu/kết luận thừa.

Câu hỏi:
$USER_PROMPT"

# Tried in order. If one model is out of quota/rate-limited, fall back to the
# next free one instead of just failing. Override with OPENCODE_MODELS
# (space-separated) to change the order.
MODELS="${OPENCODE_MODELS:-opencode/big-pickle opencode/deepseek-v4-flash-free opencode/mimo-v2.5-free opencode/ling-3.0-flash-free opencode/laguna-s-2.1-free opencode/nemotron-3-ultra-free opencode/north-mini-code-free}"

last_status=1
for MODEL in $MODELS; do
  if out=$(timeout "$TIMEOUT_SECS" opencode run \
      --agent plan \
      --auto \
      -m "$MODEL" \
      --dir "$DIR" \
      "$PROMPT" 2>&1); then
    status=0
  else
    status=$?
  fi

  if [ "$status" -eq 0 ]; then
    echo "$out"
    exit 0
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
  # Non-quota, non-timeout error: not worth burning through every model, stop here.
  echo "$out" >&2
  echo "ERROR: $MODEL exited with status $status" >&2
  exit "$status"
done

echo "ERROR: all models exhausted or unavailable (last exit status $last_status)" >&2
exit "$last_status"
