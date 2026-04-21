---
name: odoo-e2e-test
description: >
  Self-healing Odoo E2E test framework. Accepts a .docx/.xlsx test case file,
  parses it with an agent, executes each test case via playwright-cli, and
  generates a single-file HTML dashboard with Bug/Pass/Total counts and fix recommendations.
  Always asks for target URL and credentials at runtime — nothing is hardcoded.
  Use this skill whenever the user asks to run, automate, or validate any Odoo
  workflow: Ticket, Release, Issue, Change Request, or any other module.
---

# Odoo E2E Test — Self-Healing Framework

> **This skill depends on the `playwright-cli` skill.**
> Always load and follow `playwright-cli` conventions for all browser interactions.

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

Store answers as runtime config — **never hardcode** these values in any script.

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
  "startedAt": "2026-04-21T08:25:00+07:00"
}
```

### Step 3 — Parse test cases (background agent)

Launch a **general-purpose background agent** with this prompt:

```
Parse the test case file at <path>.
Output a JSON array saved to ./test-runs/<RUN-ID>/test-cases.json.
Each test case must follow the schema in:
  .claude/skills/odoo-e2e-test/references/test-case-format.md
Number test cases sequentially: TC-001, TC-002, …
```

Wait for the agent to complete, then read `test-cases.json`.

### Step 4 — Execute test cases

Execution strategy depends on `browserMode`:

#### Mode: `visible` (user wants to watch)

**Run test cases sequentially in the main agent** — do NOT launch sub-agents.

> ⚠️ **MUST use `--headed`** — without it the browser runs invisibly (headless) and the user sees nothing.

```bash
# Open a named HEADED browser session once — user will see the window appear
playwright-cli -s=odoo open --headed "<BASE_URL>/web/login"

# Login
playwright-cli -s=odoo fill "[name=login]" "<username>"
playwright-cli -s=odoo fill "[name=password]" "<password>"
playwright-cli -s=odoo click "button[type=submit]"

# Then execute each TC one by one using the same -s=odoo session
# After each TC, write result to ./test-runs/<RUN-ID>/<TC-ID>/result.json
```

- All `playwright-cli` calls use `-s=odoo` so the user sees every action in real time.
- Take a screenshot after every step.
- Run TCs **sequentially** (one at a time) — the user is watching a single browser.

#### Mode: `background` (faster, headless-like)

For each test case in `test-cases.json`, launch a **general-purpose background agent** to run it.
Pass the full context: run config + test case JSON + reference to:
- `.claude/skills/odoo-e2e-test/references/execution-protocol.md`
- `.claude/skills/odoo-e2e-test/references/self-healing.md`
- `.claude/skills/playwright-cli/SKILL.md`

Each agent opens its own **anonymous headless** session:
```bash
playwright-cli open "<BASE_URL>/web/login"   # no --headed, no -s flag
```
The agent writes its result to `./test-runs/<RUN-ID>/<TC-ID>/result.json`.

### Step 5 — Generate HTML dashboard (main agent)

After all test case agents complete, read all `result.json` files and call the
`generate-dashboard` logic from:
`.claude/skills/odoo-e2e-test/references/dashboard-template.md`

Save the dashboard to: `./test-runs/<RUN-ID>/report.html`

Tell the user the path and open it.

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

- [Test case JSON format](references/test-case-format.md)
- [Execution protocol (step-by-step)](references/execution-protocol.md)
- [Self-healing rules & BUG criteria](references/self-healing.md)
- [HTML dashboard template](references/dashboard-template.md)
- [Odoo widget filling guide](references/field-filling.md)
- [Troubleshooting](references/troubleshooting.md)
