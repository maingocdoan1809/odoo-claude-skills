#!/usr/bin/env bash
# Delegate EXECUTION of an already-written Playwright test spec to opencode's
# locked-down `playwright-tester` agent (see ~/.config/opencode/opencode.jsonc).
#
# Division of labor (do not skip steps 1-2, they are not this script's job):
#   1. Claude writes the test spec: concrete steps + expected result per step,
#      as a numbered list a human could follow by hand.
#   2. Claude shows the spec to the user and gets confirmation before running it.
#   3. THIS SCRIPT hands the confirmed spec to opencode, which drives the real
#      browser via playwright-cli and must save a screenshot per step into an
#      evidence directory.
#   4. Claude reads the evidence back (Read tool on the screenshot files) and
#      the PASS/FAIL summary opencode prints — do not report "tested" on
#      opencode's word alone, verify by actually looking at the screenshots.
#
# Safety: whitelist, not blocklist. `playwright-tester`'s bash permission only
# allows playwright-cli UI-driving/inspection subcommands (open, goto, click,
# fill, screenshot, console, requests, ...). It explicitly does NOT include
# `eval`/`run-code` (arbitrary JS in the page — an escape hatch), `route`/
# `unroute` (network mocking — could be used to fake a pass), `state-save`
# (could write session/auth data anywhere), or `install`/`kill-all`/
# `close-all`. `edit` and `external_directory` are denied, so it cannot touch
# source files or write outside the given working directory. Anything not on
# the whitelist falls through to a catch-all deny.
#
# Usage:
#   playwright-test.sh <spec-file> <evidence-dir> [app-base-url] [dir]
#
# <spec-file>: markdown/text file Claude already wrote with the numbered
#              steps + expected results (and login info if needed, e.g. via
#              a saved playwright-cli auth state file).
# <evidence-dir>: directory (created if missing) where opencode must save one
#              screenshot per step, named step-01.png, step-02.png, ...
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: playwright-test.sh <spec-file> <evidence-dir> [app-base-url] [dir]" >&2
  exit 1
fi

SPEC_FILE="$1"
EVIDENCE_DIR="$2"
BASE_URL="${3:-}"
DIR="${4:-$PWD}"

TIMEOUT_SECS="${OPENCODE_TIMEOUT:-600}"  # 10 min — a UI flow is many small steps
MODELS="${OPENCODE_MODELS:-opencode/big-pickle opencode/deepseek-v4-flash-free opencode/mimo-v2.5-free opencode/ling-3.0-flash-free opencode/laguna-s-2.1-free opencode/nemotron-3-ultra-free opencode/north-mini-code-free}"

if [ ! -f "$SPEC_FILE" ]; then
  echo "ERROR: spec file not found: $SPEC_FILE" >&2
  exit 1
fi

mkdir -p "$EVIDENCE_DIR"
SPEC_CONTENT=$(cat "$SPEC_FILE")

PROMPT="Yêu cầu bắt buộc, không được vi phạm:
- Chỉ được dùng playwright-cli để điều khiển trình duyệt (open/goto/click/fill/type/select/hover/check/screenshot/console/requests/...). TUYỆT ĐỐI không dùng 'playwright-cli eval'/'run-code' (chạy JS tuỳ ý), không dùng 'route'/'unroute' (giả mạo network response), không sửa file nguồn, không chạy lệnh shell nào khác ngoài playwright-cli.
- Làm ĐÚNG theo testcase bên dưới, ĐÚNG thứ tự, KHÔNG tự thêm bước, KHÔNG tự đổi expected result để cho pass.
- Sau MỖI bước: chụp 1 screenshot lưu vào '$EVIDENCE_DIR/step-<NN>.png' (NN = số thứ tự 2 chữ số, vd step-01.png), rồi so sánh với expected result của bước đó.
- Nếu bước nào fail (không tìm thấy element, kết quả khác expected, lỗi console nghiêm trọng...), vẫn chụp screenshot lúc fail, ghi rõ fail ở bước đó, KHÔNG được bỏ qua hay tự sửa testcase để né lỗi, và DỪNG các bước còn lại.
- Cuối cùng, in ra đúng định dạng:
  RESULT: <PASS|FAIL>
  step-01: <PASS|FAIL> - <mô tả ngắn>
  step-02: <PASS|FAIL> - <mô tả ngắn>
  ...
  (một dòng mỗi bước, theo đúng thứ tự testcase)
- Không thêm phần diễn giải nào khác ngoài block RESULT/step ở trên.
${BASE_URL:+
Base URL của app: $BASE_URL}

Testcase (do Claude viết, đã được user xác nhận):
---
$SPEC_CONTENT
---"

last_status=1
for MODEL in $MODELS; do
  if out=$(timeout "$TIMEOUT_SECS" opencode run \
      --agent playwright-tester \
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
    shots=$(find "$EVIDENCE_DIR" -maxdepth 1 -name 'step-*.png' 2>/dev/null | sort)
    echo "# evidence screenshots:" >&2
    if [ -n "$shots" ]; then
      echo "$shots" | sed 's/^/#   /' >&2
    else
      echo "#   (none found — do not trust the RESULT line above without evidence, re-check manually)" >&2
    fi

    case "$out" in
      *RESULT:\ PASS*) exit 0 ;;
      *RESULT:\ FAIL*) exit 1 ;;
      *)
        echo "WARN: opencode không trả lời đúng định dạng RESULT: PASS/FAIL — tự xem lại screenshot trong $EVIDENCE_DIR trước khi tin bất kỳ kết luận nào" >&2
        exit 3
        ;;
    esac
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
  echo "$out" >&2
  echo "ERROR: $MODEL exited with status $status" >&2
  exit "$status"
done

echo "ERROR: all models exhausted or unavailable (last exit status $last_status)" >&2
exit "$last_status"
