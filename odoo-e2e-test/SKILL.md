---
name: odoo-e2e-test
description: >
  Self-healing Odoo E2E test framework. Accepts a .docx/.xlsx test case file,
  parses it with an agent, executes each test case via playwright-cli, and
  generates a test report (HTML dashboard / Markdown / plain text) with
  Bug/Pass/Total counts and fix recommendations.
  Always asks for target URL, credentials, and report format at runtime — nothing is hardcoded.
  Use this skill whenever the user asks to run, automate, or validate any Odoo
  workflow: Ticket, Release, Issue, Change Request, or any other module.
---

# Odoo E2E Test — Self-Healing Framework

> **This skill depends on the `playwright-cli` skill.**
> Always load and follow `playwright-cli` conventions for all browser interactions.

---

## 🚫 CRITICAL ENFORCEMENT RULES

> **Full rules, enforcement matrix, escalation path → [references/ENFORCEMENT.md](references/ENFORCEMENT.md)**
> **READ IT BEFORE any browser action.**

| # | Rule | Consequence |
|---|---|---|
| 1 | Never hardcode credentials or URLs | Test FAIL |
| 2 | Ask Q1-Q7 **before** any browser action | Test ABORT |
| 3 | Create `test-runs/<RUN-ID>/` folder FIRST | Output lost |
| 4 | Wait for `test-cases.json` before Step 4 | No TCs execute |
| 5 | Correct session prefix per browserMode | Browser conflict |
| 6 | Respect TC dependencies (background mode) | Data corruption |
| 7 | Write `result.json` before next TC | Missing audit trail |
| 8 | Screenshot after EVERY step | No visual proof |
| 9 | Never auto-send emails | Unintended emails |
| 10 | Flow is EXAMPLE only — must adapt per TC | Wrong flow execution |
| 11 | Selector repair must be logged as artifacts | No traceability / no reusable fix |

---

## Pre-Flight Checklist

**BEFORE starting any execution, the main agent must verify:**

- [ ] `ask_user` was called for Q1-Q7 ✓
- [ ] `run-config.json` created with masked password and `reportFormat` ✓
- [ ] `./test-runs/<RUN-ID>/` folder exists ✓
- [ ] `test-cases.json` exists and contains valid TC array ✓
- [ ] Dependencies field checked in each TC (if using background mode) ✓
- [ ] playwright-cli skill loaded (`skill("playwright-cli")`) ✓
- [ ] Browser mode (visible/background) confirmed ✓
- [ ] Email sending: verified ALL send-email steps have explicit test case instruction ✓
- [ ] Flow source resolved (from prompt or matched from library) and logged ✓
- [ ] `flow.adapted.json` is generated for each TC before execution ✓
- [ ] Selector-repair artifacts path is prepared (`failed-steps.json`, `healing-log.json`, `flow.repaired.json`) ✓

**If ANY item is missing/false:** STOP and report to user. Do NOT proceed.

---

## Activation checklist

When this skill is invoked, do the following **in order**:

### Step 1 — Gather runtime config (ask_user)

Ask these questions one at a time using the `ask_user` tool:

1. Target URL (e.g. `http://172.20.108.223`)
2. Login username (e.g. `admin@nissho.vn`)
3. Login password
4. Path to test case file (.docx or .xlsx) — or describe test cases verbally
5. Browser mode — offer two choices:
   - **"Visible (Recommended)"** — mở browser lên màn hình để theo dõi từng bước
   - **"Background"** — chạy ngầm, nhanh hơn, không hiện browser
6. **Special notes / considerations for this test run** (e.g. "Skip payments validation", "Test on staging DB only", "Expect 2 known bugs in module X"):
   - Allow freeform text input
   - This helps document known issues, workarounds, or special setup needed
7. **Report format** — offer these choices:
   - **"HTML (Recommended)"** — Dashboard đẹp với ảnh preview lightbox, sẵn sàng gửi cấp trên (self-contained, ảnh nhúng base64)
   - **"Markdown (.md)"** — Structured text, phù hợp GitHub / tài liệu
   - **"Plain text (.txt)"** — Tóm tắt văn bản thuần, nhẹ nhất
   - **"All"** — Tạo cả 3 định dạng cùng lúc
   - Default nếu user không trả lời: **HTML**

Store all answers as runtime config — **never hardcode** these values in any script.

### Step 2 — Generate a Run ID

```
RUN-<YYYYMMDD>-<HHMMSS>-<screen-slug>
e.g.  RUN-20260421-082500-change-medium-category
```

`<screen-slug>` = tên màn hình / module đang test, kebab-case, tối đa 40 ký tự.
- Lấy từ tên file test case (nếu có), hoặc từ mô tả của user.
- Ví dụ: `ticket`, `change-medium-category`, `release-management`, `issue-workflow`

Create the output root folder:
```
./test-runs/<RUN-ID>/
```

Save `run-config.json` there (mask the password):
```json
{
  "runId": "RUN-20260421-082500-change-medium-category",
  "screen": "Change Medium Category",
  "url": "http://172.20.108.223",
  "username": "admin@nissho.vn",
  "password": "***",
  "inputFile": "path/to/testcases.xlsx",
  "browserMode": "visible",
  "reportFormat": "html",
  "notes": "Skip payments validation, expect 2 known bugs in approval workflow",
  "startedAt": "2026-04-21T08:25:00+07:00"
}
```

Valid values for `reportFormat`: `"html"` | `"md"` | `"txt"` | `"all"`

### Step 3 — Parse test cases (background agent) → Generate test-cases.json

**This step MUST complete before any browser execution.**

Launch a **general-purpose background agent** with complete context to parse the test case file.

**Agent prompt should include:**
```
Parse the test case file at <path>.
Output a JSON array saved to ./test-runs/<RUN-ID>/test-cases.json.
Each test case must follow the schema in:
  $env:USERPROFILE\.agents\skills\odoo-e2e-test\references\test-case-format.md

Number test cases sequentially: TC-001, TC-002, …

Include any "dependencies" field if a TC depends on another TC to complete first:
{
  "id": "TC-002",
  "title": "...",
  ...,
  "dependencies": ["TC-001"]  ← only if this TC must wait for TC-001 to PASS first
}
```

**CRITICAL:** Wait for this agent to complete and verify `test-cases.json` exists before proceeding to Step 4.

If parsing fails:
- If user provided file path → re-attempt with corrected path
- If user described test cases verbally → agent should convert to test-case.json format automatically

### Step 3.5 — Resolve flow source (prompt first, library fallback)

For each run, resolve an execution flow using this priority:

1. **Flow JSON from prompt** (if user provided an object with `steps[]`)
2. **Best match from flow library** (based on URL/module/action/keywords)
3. **Bootstrap flow from TC steps** (if no candidate is reliable)

The chosen flow is an **example baseline only**.

Save artifacts:
- `./test-runs/<RUN-ID>/flow-resolution.json`
- `./test-runs/<RUN-ID>/candidate-flows.json`

Matching guidance is defined in [references/flow-resolution.md](references/flow-resolution.md).

### Step 3.6 — Adapt flow per testcase (mandatory)

For each `TC-ID`:

1. Load baseline flow from Step 3.5.
2. Adapt flow to testcase specifics:
   - replace placeholders with TC data,
   - insert/remove/reorder actions to satisfy `steps[]` + `expectedResults[]`,
   - keep business intent, but update selectors/actions if page structure differs.
3. Save:
   - `./test-runs/<RUN-ID>/<TC-ID>/flow.original.json`
   - `./test-runs/<RUN-ID>/<TC-ID>/flow.adapted.json`

**Hard rule:** never execute baseline flow as-is without adaptation.

Adaptation rules are defined in [references/flow-adaptation.md](references/flow-adaptation.md).

### Step 4 — Execute adapted flow via stable step engine (default: no codegen)

**Read `test-cases.json` first.** Build a dependency graph:
- TCs with no dependencies → ready to run in parallel
- TCs with dependencies → wait for parent TC to PASS before starting

For each test case, feed `flow.adapted.json` to a stable runner (playwright-cli command sequence / executeStep-like engine), then save:
- `./test-runs/<RUN-ID>/<TC-ID>/execution-log.json`
- `./test-runs/<RUN-ID>/<TC-ID>/playwright/stdout.log`
- `./test-runs/<RUN-ID>/<TC-ID>/playwright/stderr.log`

**Flow-ops reliability rule:** prefer file-based arguments over inline JSON strings:
- `--steps-file ./test-runs/<RUN-ID>/<TC-ID>/flow.adapted.json`
- `--patch-file ./test-runs/<RUN-ID>/<TC-ID>/selector-repair.patch.json`

This prevents escaping/quoting failures in large JSON payloads.

Execution strategy depends on `browserMode`:

#### Mode: `visible` (user watches)

⚠️ **IMPORTANT: Visible mode opens ONE physical browser window.**

**Sequential execution in main agent:**
1. Open browser ONCE with `--headed`:
   ```bash
   playwright-cli -s=odoo-visible open --headed "<BASE_URL>/web/login"
   ```
   
2. Login ONCE:
   ```bash
   playwright-cli -s=odoo-visible fill "[name=login]" "<username>"
   playwright-cli -s=odoo-visible fill "[name=password]" "<password>"
   playwright-cli -s=odoo-visible click "button[type=submit]"
   ```

3. Execute each TC sequentially using the SAME `-s=odoo-visible` session:
    ```bash
    # For each TC in order:
    # - Resolve/adapt flow JSON for the TC
    # - Run it through the stable step engine (no mandatory script generation)
    # - Write ./test-runs/<RUN-ID>/<TC-ID>/result.json
    ```
   
   Follow [references/execution-protocol.md](references/execution-protocol.md) for step-by-step detail.

4. After all TCs complete → proceed to Step 5 (dashboard)

**Why sequential?** User is watching one browser. Multiple windows would confuse them.

---

#### Mode: `background` (parallel execution)

🚀 **High-speed parallel mode: Each TC runs in its own headless browser.**

Read `test-cases.json` and build dependency groups:

```
Group 1 (no deps): [TC-001, TC-003, TC-005]  → launch all 3 agents in parallel
├─ TC-001 completes → TC-004 becomes ready
├─ TC-003 completes → TC-006 becomes ready
└─ TC-005 completes → ...

Group 2 (waiting): [TC-002, TC-004, TC-006]  → launch after Group 1 finishes
```

**For each TC, launch a separate `general-purpose` background agent:**

```
Agent for TC-001:
  Input: full run-config.json + test-cases.json[TC-001] + all reference docs
  
  Browser session: ANONYMOUS (no -s flag, no --headed)
  playwright-cli open "<BASE_URL>/web/login"
  
  Execute flow.adapted.json via stable step engine
  Write result to ./test-runs/<RUN-ID>/TC-001/result.json
```

**Each agent:**
- Opens its own headless browser session
- Does NOT share session state (-s flag)
- Does NOT interfere with other agents
- Runs to completion independently
- Writes result.json when done

**CRITICAL:** Do NOT use `-s=odoo` in background mode. Each agent must open a fresh, anonymous session.

**Wait for all agents to complete** before proceeding to Step 5.

If a TC has dependencies (e.g., TC-002 depends on TC-001):
- Do NOT launch TC-002 until TC-001's result.json shows `status: "PASS"`
- If TC-001 fails/bugs → still proceed (TC-002 may still provide valuable data)

### Step 5 — Generate report (run script)

After all test case agents complete, run the report generator script:

```powershell
python "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\generate-report.py" `
  ./test-runs/<RUN-ID> `
  --format <reportFormat-from-run-config>
```

Examples:
```bash
# HTML only (default, self-contained with embedded screenshots)
python "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\generate-report.py" ./test-runs/RUN-20260421-082500-ticket --format html

# All formats at once
python "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\generate-report.py" ./test-runs/RUN-20260421-082500-ticket --format all

# HTML with relative image paths (for local browsing, not for emailing)
python "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\generate-report.py" ./test-runs/RUN-20260421-082500-ticket --format html --relative-images
```

**Script output:**
- `./test-runs/<RUN-ID>/report.html` — if format is `html` or `all`
- `./test-runs/<RUN-ID>/report.md`   — if format is `md` or `all`
- `./test-runs/<RUN-ID>/report.txt`  — if format is `txt` or `all`

**Exit codes:**
- `0` — success
- `2` — generated with warnings (e.g. some result.json missing) — still usable
- `1` — critical failure (run directory not found) — fix the path and retry

**If the script exits with code 2:** Read the warnings printed to stderr. Common fixes:
- Missing `result.json` for a TC → that TC shows as UNKNOWN in the report; add the result or re-run the TC
- Missing screenshot file → warning is noted; image is skipped in report
- Invalid JSON in a result.json → the file path and line number are printed; fix the JSON and re-run

Tell the user the path(s) to the generated report(s) and open the HTML file if it was generated.

---

## Output folder structure

```
test-runs/
  RUN-20260421-082500-change-medium-category/
    run-config.json          ← runtime config (password masked)
    test-cases.json          ← all parsed test cases
    flow-resolution.json     ← selected baseline flow + reason
    candidate-flows.json     ← scored flow candidates
    report.html              ← single-file HTML dashboard
    TC-001/
      flow.original.json
      flow.adapted.json
      flow.repaired.json
      failed-steps.json
      healing-log.json
      selector-repair.patch.json
      execution-log.json
      playwright/
        stdout.log
        stderr.log
      result.json            ← PASS | FAIL | BUG | SKIP + details
      screenshots/
        01-login.png
        02-navigate-to-module.png
        03-open-form.png
        04-fill-fields.png
        05-save-result.png
        ...
    TC-002/
      result.json
      screenshots/
```

Screenshot naming: `<step-number>-<step-slug>.png`  (zero-padded, kebab-case)

---

## Self-healing vs BUG

See [references/self-healing.md](references/self-healing.md) for full rules.

**TL;DR:**
- If a step fails because the **UI changed or the flow is unexpected** → try to self-heal (find the correct element, use alternative navigation). Log the healing action.
- If the flow executes **correctly** but the **outcome is wrong** (wrong data saved, validation error on valid input, wrong status, etc.) → report as **BUG**.

---

## References

- [CRITICAL ENFORCEMENT RULES](references/ENFORCEMENT.md) ← **READ THIS FIRST**
- [**Page Inspector (scan-page + scan-dropdown)**](references/page-inspector.md) ← **USE INSTEAD OF snapshot --depth=3**
- [Test case JSON format](references/test-case-format.md)
- [Execution protocol (step-by-step)](references/execution-protocol.md)
- [Flow resolution strategy](references/flow-resolution.md)
- [Flow adaptation strategy](references/flow-adaptation.md)
- [Flow runner execution (no mandatory codegen)](references/script-generation.md)
- [Selector repair protocol](references/selector-repair.md)
- [Parallel execution & dependencies](references/parallel-execution.md)
- [Self-healing rules & BUG criteria](references/self-healing.md)
- [HTML dashboard template spec](references/dashboard-template.md)
- [Odoo widget filling guide](references/field-filling.md)
- [**Required fields scan strategy**](references/required-fields-strategy.md) ← **use before every Save**
- [Troubleshooting](references/troubleshooting.md)
- [Report generator script](scripts/generate-report.py) ← **used in Step 5**
- [Page scan script (readable)](scripts/scan-page.js) ← readable/documented version
- [Page scan IIFE](scripts/scan-page-iife.js) ← no backticks — `$scan = Get-Content ... -Raw; playwright-cli eval $scan`
- [Dropdown scan IIFE](scripts/scan-dropdown-iife.js) ← scan many2one dropdown items after typing
- [Required fields scan script (readable)](scripts/scan-required-fields.js)
- [Required fields IIFE](scripts/scan-iife.js) ← no backticks — `$scan = Get-Content ... -Raw; playwright-cli eval $scan`
