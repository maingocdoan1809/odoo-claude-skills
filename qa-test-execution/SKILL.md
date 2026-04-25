---
name: qa-test-execution
description: Use when starting a QA regression test execution session. Triggers on user requests like "run testcases", "execute QA tests", "chạy test", or when given a testcase Excel/JSON file plus target URL. Orchestrates pre-flight intake, parallel test execution via playwright-cli, per-step screenshots only at meaningful points, per-testcase result.json capture, automatic bug detection/severity classification, crash-resume, and final HTML+MD report generation via the bundled script.
---

# QA Test Execution

You orchestrate an automated regression test session. Responsibilities span pre-flight intake → folder setup → parallel test execution via playwright-cli → per-testcase result capture → final report generation.

The runner you operate inside provides a `playwright` CLI wrapper. You emit one command per turn at decision points. The runner executes it and feeds back DOM/screenshot state.

---

## 1. Session Pre-Flight (mandatory — do not skip)

Before any execution, ask the user. Wait for explicit answers; do not assume defaults.

1. **Testcase source** — one of:
   - Path to Excel file (`.xlsx`)
   - Path to parsed JSON file
   - Natural-language description of what to test (you infer testcases yourself)
2. **Target URL** — base URL of the app under test
3. **Login credentials** — username + password if required, otherwise `none`
4. **Run mode** — `headless` or `headed` (user choice; affects trace/video — see §3)

Only after all 4 answers proceed. If answers are partial, ask only for the missing items.

---

## 2. Run Folder Setup

Create at the user's working directory (or ask if unclear):

```
<business-area>_<YYYYMMDD-HHMMSS>/
├── _session.json              # session metadata + resume state
├── TC001/
│   ├── result.json
│   └── screenshots/
│       ├── 01_form_opened.png
│       ├── 02_saved.png
│       └── ...
├── TC002/
│   ├── result.json
│   └── screenshots/
├── report.html                # generated at end
└── report.md                  # generated at end
```

`<business-area>` is a slugified summary (lowercase, hyphens) of what is being tested — e.g. `helpdesk-ticket-creation_20260425-143012`. Derive it from testcase titles or the user's description.

Write `_session.json` immediately after pre-flight (see §8). Update on every testcase completion.

---

## 3. Parallel Execution

Run testcases in **3 concurrent agents**. Each agent:

- Owns its testcase end-to-end. No shared state with peers.
- Writes only to its own `TC<id>/` folder.
- Uses its own browser context (separate cookies/session).
- Pulls the next testcase from the queue when its current one completes.

Continue until queue is empty. **Never stop on failure** — every testcase runs.

If `headed` mode: enable Playwright trace + video recording (`trace: 'on'`, `video: 'on'`) per agent so the user can replay. Save trace to `TC<id>/trace.zip`, video to `TC<id>/video.webm`.
If `headless` mode: trace + video off (faster).

---

## 4. Per-Step Execution Rules (Playwright CLI)

### 4.1 Allowed commands

Only these. No raw JS, no chaining, no shell pipes.

- `playwright click <selector>`
- `playwright fill <selector> <value>`
- `playwright select-option <selector> <value>`
- `playwright press <selector> <key>`
- `playwright set-input-files <selector> <absolute-path>`
- `playwright screenshot <output-path>`
- `playwright evaluate <expression>` — DOM extraction only

Multi-step interactions (extract → choose → click) span multiple turns.

### 4.2 Selector priority — most stable first

1. **Test ids** — `[data-testid="..."]`, `[data-cy="..."]`, `[data-test="..."]`
2. **Field name attribute** (Odoo and many forms) — `[name="partner_id"]`, `[name="email"]`
3. **ARIA / role-based** — `role=button[name="Save"]`, `[aria-label="..."]`
4. **Semantic CSS classes** — `.o_form_button_save`, `.btn-primary[type="submit"]`
5. **Text-based** — `button:has-text("Save")`, `a:has-text("Helpdesk")`
6. **NEVER use** — dynamic ids (`#widget_42`), positional (`tr:nth-child(3)`), fragile chains (`div > div > div`)

If only fragile selectors visible, extract a stable one with `playwright evaluate` first.

### 4.3 Per-step timeout

30 seconds. If the runner reports timeout, classify per §6.

### 4.4 Dropdown / many2one pattern

Three-turn state machine:

1. Click to open the dropdown: `playwright click <field selector>`
2. Extract options:
   ```
   playwright evaluate "Array.from(document.querySelectorAll('<dropdown-item-selector>')).map(el => el.textContent.trim())"
   ```
3. Click chosen option: `playwright click <option selector>:has-text("<chosen>")`

Choosing rules (in order):
- Exact case-insensitive match with hint
- Substring match on most distinctive token
- Semantic fit ("VIP" → option containing "VIP" / "Premium" / "Hạng 1")
- If none fits → BLOCKED, classify per §6

Never type-then-select if the dropdown can be opened directly — typing can trigger quick-create that creates new records unintentionally.

### 4.5 Many2many

Same as many2one, click multiple options sequentially. Close after last selection:
```
playwright press body Escape
```

### 4.6 Text and number fields — Vietnamese realistic data

- **Names** — "Nguyễn Văn An", "Trần Thị Bình" (never "Test User", "abc", "xxx")
- **Companies** — "Công ty TNHH Phát Triển Phần Mềm Minh Quân"
- **Addresses** — "123 Lê Lợi, Phường Bến Nghé, Quận 1, TP.HCM"
- **Phone** — Vietnamese mobile prefixes (03x/05x/07x/08x/09x), 10 digits
- **Email** — lowercase, no diacritics, plausible domain (`an.nguyen@minhquan.vn`)
- **Numbers** — within hint range, never 0 unless hint explicitly says
- **Descriptions** — 1–3 Vietnamese sentences, in testcase context

Match length hints:
- "ngắn" / "short" → ≤ 30 chars
- "dài" / "long" → ≥ 200 chars
- "ký tự đặc biệt" → include `!@#$%`, accented Vietnamese, emoji

Stay consistent with already-filled params (email plausibly belongs to filled company; phone area code matches address city).

### 4.7 File upload

```
playwright set-input-files <file input selector> <absolute-path>
```

If selector unclear, extract first via `playwright evaluate`.

---

## 5. Screenshot Policy — only meaningful moments

**Capture only:**
- **Business milestones** — form submitted, record created, payment confirmed, login success, major state transitions
- **Bug detection** — immediately after a step that triggers an unexpected exception, error message, or wrong result
- **Final success** — closing screen of testcase when business goal completes

**Do NOT capture:**
- Every click, fill, navigation
- Dropdown open/extract turns
- Intermediate steps with no business meaning

**Filename convention:** `TC<id>/screenshots/<NN>_<short-slug>.png` where `NN` is zero-padded sequence (`01`, `02`, ...). Slug describes business state — `01_login_success.png`, `05_save_error_500.png`, `08_ticket_created.png`.

---

## 6. Bug Detection and Classification (AI auto — never ask user)

You classify outcomes yourself. Never pause to ask the user mid-run.

### Status decision table

| Outcome | Status | Bug? |
|---------|--------|------|
| Business goal completed, all asserts pass | `passed` | No |
| Unexpected exception, app crashes, business cannot complete | `failed` | **Yes — bug** |
| Validation error when input was valid per testcase | `failed` | **Yes — bug** |
| Wrong business result (saved with wrong value, status not updated, etc.) | `failed` | **Yes — bug** |
| Selector not found but goal still achievable via alternate path | `passed` | No |
| Selector not found and blocks goal completion | `failed` | **Yes — bug** |
| Test data / pre-condition missing (e.g. no customer record exists yet) | `skipped` | No |
| Page returns 500 / network error / app unreachable | `failed` | **Yes — bug** |
| Login session expired mid-test | `error` | No (environmental) |
| Browser crash, runner crash | `error` | No (environmental) |

**Rule of thumb:** *bug = business cannot complete in a way the user did not expect*. Environmental failures and missing pre-conditions are not bugs.

### Severity (auto-assigned)

- **High** — payment, data integrity loss, security, login broken, legal/compliance
- **Medium** — main user flow blocked (cannot create record, cannot save, cannot search)
- **Low** — UI glitch, wrong message text, non-blocking validation issue, cosmetic

---

## 7. Per-Testcase `result.json`

Write to `TC<id>/result.json` when testcase ends (any status). Schema:

```json
{
  "tc_id": "TC001",
  "title": "Tạo ticket trong Helpdesk",
  "module": "Helpdesk",
  "status": "passed | failed | skipped | error",
  "started_at": "2026-04-25T14:30:12.000Z",
  "finished_at": "2026-04-25T14:30:45.000Z",
  "duration_ms": 33000,
  "param_set": { "subject": "...", "customer": "..." },
  "steps": [
    {
      "step_id": 1,
      "type": "click | fill | navigate | assert | screenshot | evaluate",
      "description": "Open Helpdesk menu",
      "status": "passed | failed | skipped",
      "screenshot": "screenshots/01_helpdesk_open.png",
      "duration_ms": 120,
      "error": null
    }
  ],
  "bugs": [
    {
      "step_id": 5,
      "severity": "high | medium | low",
      "description": "Server returns 500 when saving ticket with valid data",
      "screenshot": "screenshots/05_save_error.png",
      "exception": "HTTP 500 — Internal Server Error"
    }
  ],
  "expected_result": "Ticket created successfully with status Mới",
  "actual_result": "Server error 500 on save"
}
```

`screenshot` paths are **relative to the testcase folder** so the report script can resolve them.

---

## 8. `_session.json` and Resume on Crash

`_session.json` is the source of truth for resume. Format:

```json
{
  "started_at": "2026-04-25T14:30:00.000Z",
  "status": "in_progress | finished",
  "preflight": {
    "source": "path or description",
    "url": "https://...",
    "login": { "username": "...", "password": "..." } | null,
    "mode": "headed | headless"
  },
  "queue": ["TC001", "TC002", "TC003", "..."],
  "in_progress": ["TC002", "TC003"],
  "done": ["TC001"]
}
```

**Resume protocol** — on every session start, check if a `_session.json` already exists in the target run folder:

- `status === "in_progress"` → resume: skip testcases in `done`, continue with remaining queue. Do NOT re-ask pre-flight.
- `status === "finished"` → fresh start in a new timestamped folder.
- File missing → fresh start.

Update `_session.json` after every testcase completion (atomic write: write to tmp, rename).

---

## 9. Blocked Behavior (per step)

When a single step cannot proceed, an agent must emit:

```
BLOCKED: <plain Vietnamese reason>
```

Examples:
- `BLOCKED: không tìm thấy field "partner_id" trên trang hiện tại`
- `BLOCKED: dropdown rỗng, không có dữ liệu để chọn`
- `BLOCKED: trang trả về lỗi 500`
- `BLOCKED: phiên đăng nhập đã hết hạn`

Never:
- Output a guessed selector
- Invent option text not in the extracted list
- Skip silently to the next step
- Fabricate a screenshot or evaluate result

The runner classifies BLOCKED steps via §6 and decides whether to continue the testcase (alternate path) or terminate it.

---

## 10. Output Contract (per turn)

Each agent turn emits exactly one of:

(a) A single playwright-cli command on one line — no quotes wrapping the whole thing, no leading/trailing whitespace, no markdown, no code fence.

(b) The literal `BLOCKED: <reason>` line.

No prose, no "Here is the command:", no explanations. The runner parses raw stdout — anything else breaks execution.

---

## 11. Post-Run: Generate Reports

When all testcases done (queue empty, all in `done`), DO NOT manually write HTML or MD. Run the bundled script:

```bash
node "<skill-root>/scripts/generate-report.js" "<run-folder-path>"
```

Where `<skill-root>` is the folder containing this `SKILL.md`. The script reads all `result.json` + `_session.json` and produces:

- `report.html` — dashboard with grouped cards (Outcomes + Bugs), filter toolbar, top-level Bugs section (severity-grouped, click to jump-to-TC), per-testcase sections (auto-expanded for fail/error/skip/bug, collapsed for pass), inline thumbnails next to relevant steps, base64-embedded screenshots, lightbox with prev/next navigation (arrow keys + buttons)
- `report.md` — compact summary with grouped Bugs Found section, Failures detail with params, all-testcases table

### Script exit codes

| Code | Meaning | Action |
|------|---------|--------|
| 0    | Reports generated successfully | Set `_session.json.status = "finished"` |
| 1    | Fatal error (bad path / IO failure) | Investigate path, retry once; escalate to user if persistent |
| 2    | One or more `result.json` malformed — validation failed | **Self-heal** per §11.1, then re-run |

---

## 11.1 Self-Healing on Validation Failure

When the report script exits with code `2`, it prints a structured JSON to stdout listing every malformed file. You **must self-heal** rather than skip — silent skips lose data.

### Structured error payload (stdout)

```json
{
  "ok": false,
  "reason": "validation_failed",
  "failures": [
    {
      "tc_folder": "TC003",
      "result_path": "...",
      "kind": "missing_file | parse_error | schema_invalid | io_error",
      "errors": [{ "field": "status", "issue": "invalid value ..." }],
      "evidence": {
        "screenshots": ["01_form.png", "02_saved.png"],
        "tc_id_from_folder": "TC003",
        "parsed_preview": { ... }
      },
      "raw_content": "<truncated raw bytes if parse_error>"
    }
  ],
  "heal_protocol": [...]
}
```

### Healing steps (per failure)

1. **Backup the broken file** — rename `result.json` → `result.json.broken`. Never overwrite without backup.
2. **Reconstruct from evidence:**
   - `evidence.screenshots` lists artefacts that were saved during the run → infer which steps had screenshots
   - `evidence.parsed_preview` shows what fields the broken file did contain (for schema_invalid kind)
   - `evidence.raw_content` is truncated raw bytes (for parse_error kind) — try to recover any salvageable JSON fragments
   - `_session.json.preflight` gives `started_at`, target URL, run mode
   - Agent memory of this run gives steps actually executed, params used, business outcome
3. **Build a valid `result.json`** that satisfies the schema (§7) using only **real evidence** — see "Don't fabricate" rule below.
4. **Mark the heal**:
   ```json
   {
     "tc_id": "TC003",
     ...
     "_healed": true,
     "_heal_notes": "result.json gốc parse_error, tái dựng từ 2 screenshot + memory"
   }
   ```
5. **Re-run the script.** If a TC fails validation a second time, give up gracefully:
   - Write a minimal valid `result.json` with `status: "error"`, `actual_result: "Không thể tái dựng kết quả testcase từ evidence — file gốc bị lỗi"`, `_healed: true`, `_heal_notes: "<details>"` and proceed.

### Don't fabricate rule

You may **only** include in a healed `result.json`:
- Steps you can prove from screenshots (filename → step description) or remember from this session's memory
- Bugs that were observable (server errors, exceptions captured in memory or screenshot text)
- Params that came from the input testcase (Excel/JSON/description) — never guess values that weren't actually used

You **must not** invent:
- Pass/fail outcomes when evidence is ambiguous → mark `status: "error"` instead
- Step durations you don't remember → omit `duration_ms` rather than guess
- Screenshots that don't exist on disk

### Heal cap

Heal each file **at most once**. If after healing the script still rejects it, mark TC as `error` with a heal_note explaining the gap and continue. Do not loop indefinitely.

---

## 12. Pre-Emit Checklist (every command)

Before emitting any command, verify:

- [ ] Selector is from priority 1–5, never 6
- [ ] If dropdown options unknown, extract first instead of guessing
- [ ] Value (if any) is realistic Vietnamese, not placeholder
- [ ] Generated data consistent with already-filled params
- [ ] Output is one line, no decoration
- [ ] Screenshot only if business-meaningful, bug, or final success

---

## 13. Quick Operational Summary

1. Ask 4 pre-flight questions → wait for answers
2. Check resume → if not, create run folder + `_session.json`
3. Spawn 3 parallel agents pulling from queue
4. Each agent: execute testcase via playwright-cli rules → write `result.json` + screenshots → update `_session.json.done`
5. When queue empty → run `generate-report.js`
6. **If exit code 2** → self-heal per §11.1 → re-run (max 1 heal cycle per file)
7. Mark `_session.json.status = "finished"`
