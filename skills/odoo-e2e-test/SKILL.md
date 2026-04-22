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

**These rules are NON-NEGOTIABLE. Violating any rule will cause test failure or data corruption.**

### Rule 1: NEVER hardcode credentials or URLs
```
❌ BLOCKED: Storing username/password in scripts, test files, or logs
❌ BLOCKED: Embedding URLs in code
✅ ALLOWED: Read from ask_user responses → store in runtime config only
```
**Consequence:** Test will fail validation; credentials logged to user.

### Rule 2: MUST ask runtime questions before ANY browser action
```
❌ BLOCKED: Starting browser before gather Q1-Q7
❌ BLOCKED: Skipping any question
✅ ALLOWED: Ask all 7 questions using ask_user (one at a time)
```
**Consequence:** Test will not execute; user will be notified.

### Rule 3: MUST create test-runs/<RUN-ID>/ folder structure FIRST
```
❌ BLOCKED: Executing tests before folder exists
❌ BLOCKED: Putting test output anywhere else
✅ ALLOWED: Create ./test-runs/<RUN-ID>/ → run-config.json → then Step 3
```
**Consequence:** Test output will be lost; cannot generate dashboard.

### Rule 4: MUST wait for test-cases.json to exist before Step 4
```
❌ BLOCKED: Starting browser before test-case.json is written
❌ BLOCKED: Parallel execution without dependencies parsed
✅ ALLOWED: Wait for Step 3 agent to complete, verify test-cases.json exists
```
**Consequence:** No test cases will execute; dangling agents.

### Rule 5: MUST use correct session prefix per browserMode
```
❌ BLOCKED: Using -s=odoo in background mode (causes conflicts)
❌ BLOCKED: Using --headed in background mode (defeats parallelization)
❌ BLOCKED: Omitting --headed in visible mode (browser invisible to user)
✅ ALLOWED: 
   Visible   → playwright-cli -s=odoo-visible open --headed "<URL>"
   Background → playwright-cli open "<URL>"
```
**Consequence:** Browser conflict, invisible execution, or test hangs.

### Rule 6: MUST respect TC dependencies (background mode)
```
❌ BLOCKED: Launching TC-002 if TC-001 (its dependency) hasn't completed
❌ BLOCKED: Ignoring dependencies field in test-cases.json
✅ ALLOWED: Build dependency graph → launch in waves → wait between waves
```
**Consequence:** Data corruption; TC-002 operates on non-existent data.

### Rule 7: MUST generate result.json BEFORE moving to next TC
```
❌ BLOCKED: Launching next TC without writing result.json for current TC
❌ BLOCKED: Missing result.json entry
✅ ALLOWED: Write result.json to ./test-runs/<RUN-ID>/<TC-ID>/result.json after each TC
```
**Consequence:** Dashboard will have missing test results; incomplete audit trail.

### Rule 8: MUST take screenshot after EVERY step
```
❌ BLOCKED: Skipping screenshot on non-critical steps
❌ BLOCKED: Screenshots without proper naming (01-login.png format)
✅ ALLOWED: screenshot --filename="<TC-DIR>/screenshots/<N>-<slug>.png" after each step
```
**Consequence:** No visual audit trail; harder to debug failures.

### Rule 9: NEVER auto-send emails without explicit test case instruction
```
❌ BLOCKED: Sending email as part of self-healing or cleanup
❌ BLOCKED: Auto-filling "to" address without test case defining it
❌ BLOCKED: Sending test emails to real addresses without user consent
✅ ALLOWED: Only execute send-email step if explicitly in test-cases.json steps[]
✅ ALLOWED: Use dummy test addresses (@test, @localhost) if not specified
```
**Consequence:** Unintended emails sent to real users; legal/compliance issues.

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
  .claude/skills/odoo-e2e-test/references/test-case-format.md

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

### Step 4 — Execute test cases

**Read `test-cases.json` first.** Build a dependency graph:
- TCs with no dependencies → ready to run in parallel
- TCs with dependencies → wait for parent TC to PASS before starting

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
   # - Execute all steps
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
  
  Execute all steps from test-cases.json[TC-001].steps[]
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

```bash
python3 .claude/skills/odoo-e2e-test/scripts/generate-report.py \
  ./test-runs/<RUN-ID> \
  --format <reportFormat-from-run-config>
```

Examples:
```bash
# HTML only (default, self-contained with embedded screenshots)
python3 .claude/skills/odoo-e2e-test/scripts/generate-report.py ./test-runs/RUN-20260421-082500-ticket --format html

# All formats at once
python3 .claude/skills/odoo-e2e-test/scripts/generate-report.py ./test-runs/RUN-20260421-082500-ticket --format all

# HTML with relative image paths (for local browsing, not for emailing)
python3 .claude/skills/odoo-e2e-test/scripts/generate-report.py ./test-runs/RUN-20260421-082500-ticket --format html --relative-images
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
    report.html              ← single-file HTML dashboard
    TC-001/
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
- [Test case JSON format](references/test-case-format.md)
- [Execution protocol (step-by-step)](references/execution-protocol.md)
- [Parallel execution & dependencies](references/parallel-execution.md)
- [Self-healing rules & BUG criteria](references/self-healing.md)
- [HTML dashboard template spec](references/dashboard-template.md)
- [Odoo widget filling guide](references/field-filling.md)
- [Troubleshooting](references/troubleshooting.md)
- [Report generator script](scripts/generate-report.py) ← **used in Step 5**
