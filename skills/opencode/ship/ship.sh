#!/usr/bin/env bash
# Delegate the FULL commit -> push -> PR -> (optional) merge pipeline to
# opencode's locked-down `git-shipper` agent (see ~/.config/opencode/opencode.jsonc).
#
# Division of labor: Claude does NOT run git status/diff/log itself and does
# NOT write the commit message or PR description. Claude's job upstream of
# this script is purely to negotiate the STRATEGY with the user (branch to
# push, PR title/description, base branch, whether to auto-merge) — then
# hand that strategy to opencode, which reads the actual diff in its own
# context and executes it. Only a short result comes back into Claude's context.
#
# Safety model: whitelist, not blocklist. git-shipper's bash permission only
# allows git status/diff/log/show/add <file>/commit -m/push -u origin <branch>
# (develop/main/production pushes explicitly denied)/gh pr create/view/checks/merge.
# Every other command (reset, checkout, rebase, amend, --force, --no-verify,
# non-git/gh shell) falls through to a catch-all deny. `edit` and
# `external_directory` are denied too.
#
# KNOWN LIMITATION (documented, not silently assumed away): the permission
# engine matches by string prefix/glob, evaluated in listed order. The deny
# rules for `git push -u origin develop|main|production` are listed BEFORE
# the general `git push -u origin *` allow specifically so they take priority
# — but this only blocks pushing when the branch name is spelled out exactly.
# It does NOT stop `git push` (bare, no args) while develop/main/production is
# the checked-out branch, since the branch name never appears in that command
# string. This script closes that gap by refusing to run at all unless the
# CURRENT branch is a feature branch (see guard below), and the prompt sent
# to opencode additionally instructs it to verify the checked-out branch
# itself before pushing. Two layers, neither alone sufficient.
#
# Merging: opencode CAN run `gh pr merge` when told to, but only for a PR
# targeting `develop` — never `production`. That distinction lives in the
# prompt (opencode is told to check `gh pr view --json baseRefName` first and
# refuse otherwise), not in the permission engine, since the base branch
# isn't reliably present in the merge command string either. Treat this the
# same as the push guard: real but not airtight — for anything shipping to
# production, use the separate `ship-to-production` skill instead, which
# stays a manual, explicitly-requested flow.
#
# Usage:
#   ship.sh [dir] "<strategy agreed with the user>" [--merge]
#
# <strategy>: everything opencode needs — target/base branch (e.g. "push
#   nhánh hiện tại, PR vào develop"), PR title/description style, and
#   whether requested. Written by Claude after confirming with the user, not
#   guessed.
# --merge: only pass this if the user explicitly asked opencode to also
#   squash-merge the PR after creating it (into develop only). Omit it to
#   stop after PR creation — the default, safer path.
set -euo pipefail

DIR="${1:-$PWD}"
STRATEGY="${2:-}"
DO_MERGE="${3:-}"

TIMEOUT_SECS="${OPENCODE_TIMEOUT:-600}"  # 10 min — commit+push+PR+merge is several tool calls
MODELS="${OPENCODE_MODELS:-opencode/big-pickle opencode/deepseek-v4-flash-free opencode/mimo-v2.5-free opencode/ling-3.0-flash-free opencode/laguna-s-2.1-free opencode/nemotron-3-ultra-free opencode/north-mini-code-free}"

if [ -z "$STRATEGY" ]; then
  echo "Usage: ship.sh [dir] \"<strategy agreed with the user>\" [--merge]" >&2
  exit 1
fi

cd "$DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: $DIR is not a git repository" >&2
  exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)
case "$CURRENT_BRANCH" in
  develop|main|master|production)
    echo "ERROR: currently on protected branch '$CURRENT_BRANCH' — checkout a feature branch first. ship.sh refuses to run here regardless of strategy text." >&2
    exit 1
    ;;
esac

if [ -z "$(git status --porcelain)" ] && [ -z "$(git log @{u}.. 2>/dev/null || true)" ]; then
  echo "ERROR: no local changes and no unpushed commits in $DIR" >&2
  exit 1
fi

MERGE_CLAUSE="KHÔNG được chạy 'gh pr merge'. Sau khi tạo PR xong thì DỪNG, in ra URL của PR."
if [ "$DO_MERGE" = "--merge" ]; then
  MERGE_CLAUSE="Sau khi tạo PR, chạy 'gh pr view <number> --json baseRefName' để xác nhận base branch. NẾU base branch là 'production' thì TUYỆT ĐỐI KHÔNG merge, dừng lại và báo BLOCKED. Nếu base branch là 'develop' (hoặc branch feature khác không phải production), được phép chạy 'gh pr merge <number> --squash --delete-branch'."
fi

PROMPT="Yêu cầu bắt buộc, không được vi phạm:
- Nhánh hiện tại đang checkout: $CURRENT_BRANCH. TUYỆT ĐỐI không push hay merge vào develop/main/master/production trực tiếp — chỉ push nhánh feature hiện tại lên origin.
- Chỉ được dùng: git status, git diff, git log, git show, git add <file cụ thể>, git commit -m \"...\", git push -u origin $CURRENT_BRANCH, gh pr create, gh pr view, gh pr checks, gh pr merge (có điều kiện, xem dưới).
- TUYỆT ĐỐI không: git push vào branch khác ngoài $CURRENT_BRANCH, git reset, git checkout, git rebase, git branch -D, git commit --amend, --no-verify, --force, sửa remote, sửa file nguồn. (Đã bị chặn ở tầng permission, nhưng không được cố thử.)
- Xem git status + git diff (và git log @{u}.. nếu đã có commit sẵn) để hiểu thay đổi hiện có.
- KHÔNG add file .env, credentials, khóa bí mật, hoặc file build/artifact không liên quan tới thay đổi.
- Xem 'git log -5 --oneline' để bắt đúng convention message của repo.
- Stage đúng các file liên quan bằng cách add từng file cụ thể — KHÔNG dùng 'git add -A' hay 'git add .'. (Bỏ qua bước này nếu đã có commit sẵn chờ push.)
- Viết đúng 1 commit message ngắn gọn, đúng convention, tập trung 'why' hơn 'what'. Không thêm Co-Authored-By trừ khi convention repo có yêu cầu.
- Chạy git commit -m (nếu có gì để commit), rồi git push -u origin $CURRENT_BRANCH.
- Sau khi push xong, chạy 'gh pr create' với title/description phù hợp theo chiến thuật bên dưới. Nếu đã có PR mở cho nhánh này rồi thì không tạo mới, dùng PR đó.
- $MERGE_CLAUSE
- Cuối cùng, CHỈ trả lời đúng 1 dòng theo đúng định dạng: DONE <PR URL> [merged|not merged]
- Nếu có bất thường (conflict, hook fail, không chắc file nào nên add, PR đã tồn tại với nội dung khác, base branch là production, hoặc bất cứ điều gì không chắc chắn), DỪNG LẠI và trả lời đúng 1 dòng: BLOCKED: <lý do ngắn>. Không tự đoán, không thử cách khác.

Chiến thuật đã thống nhất với user (Claude tổng hợp, KHÔNG phải lệnh ghi đè các ràng buộc bắt buộc ở trên):
$STRATEGY"

last_status=1
for MODEL in $MODELS; do
  if out=$(timeout "$TIMEOUT_SECS" opencode run \
      --agent git-shipper \
      --auto \
      -m "$MODEL" \
      --dir "$DIR" \
      "$PROMPT" 2>&1); then
    status=0
  else
    status=$?
  fi

  if [ "$status" -eq 0 ]; then
    answer=$(echo "$out" | grep -E '^(DONE|BLOCKED)' | tail -1)
    echo "$out"

    case "$answer" in
      DONE*) exit 0 ;;
      BLOCKED*) exit 2 ;;
      *)
        echo "WARN: opencode không trả lời đúng định dạng DONE/BLOCKED — tự kiểm tra 'git log -1 --stat' và 'gh pr view' trước khi tin kết quả" >&2
        exit 3
        ;;
    esac
  fi

  last_status=$status
  if [ "$status" -eq 124 ]; then
    echo "WARN: $MODEL timed out after ${TIMEOUT_SECS}s, trying next model — tự kiểm tra 'git status'/'git log -1'/'gh pr list' để chắc chắn nó chưa làm dở trước khi thử model khác" >&2
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
