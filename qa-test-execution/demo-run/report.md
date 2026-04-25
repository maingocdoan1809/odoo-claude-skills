# QA Test Report

**URL:** https://erp.minhquan.vn  
**Mode:** headed  
**Started:** 2026-04-25T08:30:00.000Z  
**Finished:** 2026-04-25T16:00:04.677Z

## Summary

| Metric | Count |
|---|---|
| Total | 7 |
| ✅ Passed | 2 |
| ❌ Failed | 3 |
| ⏭️ Skipped | 1 |
| ⚠️ Error | 1 |
| 🐛 Bugs | 3 (1 high / 1 medium / 1 low) |

## Bugs Found

### 🔴 High (1)

- **TC002** — Server trả về lỗi 500 khi cập nhật trạng thái ticket — ảnh hưởng nghiệp vụ chốt ticket
  - Title: Cập nhật trạng thái ticket sang Đã giải quyết
  - Params: `{"ticket_id":"TKT-2026-0451","new_status":"Đã giải quyết","resolution_note":"Đã reset password cho khách hàng, hướng dẫn đăng nhập lại"}`
  - Exception: `POST /api/ticket/update_status`

### 🟠 Medium (1)

- **TC004** — Tìm kiếm không match từ khóa tiếng Việt có dấu — index có vẻ chỉ unicode-fold sai
  - Title: Tìm kiếm ticket theo từ khóa tiếng Việt có dấu
  - Params: `{"search_keyword":"đăng nhập"}`
  - Exception: `Expected: ≥1 ticket containing 'đăng nhập'`

### 🟡 Low (1)

- **TC006** — Badge số ticket Mới ở menu hiển thị sai — chênh 5 ticket so với API. Không chặn nghiệp vụ nhưng gây nhầm lẫn
  - Title: Hiển thị badge số ticket chưa xử lý ở menu
  - Exception: `Badge text: '7'`

## Failures & Errors

### TC002 — Cập nhật trạng thái ticket sang Đã giải quyết  `failed`
- Module: Helpdesk
- Duration: 33000ms
- Params: `{"ticket_id":"TKT-2026-0451","new_status":"Đã giải quyết","resolution_note":"Đã reset password cho khách hàng, hướng dẫn đăng nhập lại"}`
- Expected: Trạng thái ticket cập nhật thành Đã giải quyết, ghi chú resolution được lưu
- Actual: Server lỗi 500, trạng thái không thay đổi, ghi chú không được lưu
- Bugs:
  - **[high]** Server trả về lỗi 500 khi cập nhật trạng thái ticket — ảnh hưởng nghiệp vụ chốt ticket

### TC004 — Tìm kiếm ticket theo từ khóa tiếng Việt có dấu  `failed`
- Module: Helpdesk
- Duration: 10000ms
- Params: `{"search_keyword":"đăng nhập"}`
- Expected: Hiển thị các ticket có chứa từ 'đăng nhập' trong tiêu đề hoặc mô tả
- Actual: Không có kết quả nào, dù có ticket chứa từ này
- Bugs:
  - **[medium]** Tìm kiếm không match từ khóa tiếng Việt có dấu — index có vẻ chỉ unicode-fold sai

### TC006 — Hiển thị badge số ticket chưa xử lý ở menu  `failed`
- Module: Helpdesk
- Duration: 5000ms
- Expected: Badge hiển thị đúng số ticket có trạng thái Mới
- Actual: Badge hiển thị 7 nhưng thực tế có 12 ticket Mới
- Bugs:
  - **[low]** Badge số ticket Mới ở menu hiển thị sai — chênh 5 ticket so với API. Không chặn nghiệp vụ nhưng gây nhầm lẫn

### TC007 — Xóa ticket - kiểm tra quyền hạn của user thường  `error`
- Module: Helpdesk
- Duration: 3000ms
- Params: `{"ticket_id":"TKT-2026-0451"}`
- Expected: User thường không có nút Xóa, hoặc bấm Xóa hiện thông báo không có quyền
- Actual: Không thể test do session expired giữa chừng

## All Testcases

| TC | Title | Module | Status | Duration | Bugs |
|---|---|---|---|---|---|
| TC001 | Tạo ticket Helpdesk với khách hàng VIP | Helpdesk | ✅ passed | 13.0s |  |
| TC002 | Cập nhật trạng thái ticket sang Đã giải quyết | Helpdesk | ❌ failed | 33.0s | 1 |
| TC003 | Phân công ticket cho nhân viên hỗ trợ | Helpdesk | ✅ passed | 9.0s |  |
| TC004 | Tìm kiếm ticket theo từ khóa tiếng Việt có dấu | Helpdesk | ❌ failed | 10.0s | 1 |
| TC005 🔧 | Đính kèm file vào ticket | Helpdesk | ⏭️ skipped | 2.0s |  |
| TC006 | Hiển thị badge số ticket chưa xử lý ở menu | Helpdesk | ❌ failed | 5.0s | 1 |
| TC007 | Xóa ticket - kiểm tra quyền hạn của user thường | Helpdesk | ⚠️ error | 3.0s |  |
