# Execution Protocol

The test runner agent follows this protocol for every test case.

> **Dependency:** Before any browser interaction, invoke the `playwright-cli` skill by calling:
> `skill("playwright-cli")`
> Then follow its conventions for all browser commands.

> **Page Inspector:** This skill uses **scan-page-iife.js** instead of `snapshot --depth=3` for
> page exploration. Load it once per agent run:
> ```powershell
> $scanPage     = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-page-iife.js" -Raw
> $scanDropdown = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-dropdown-iife.js" -Raw
> $scanReq      = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-iife.js" -Raw
> ```
> Then use `playwright-cli eval $scanPage` instead of `snapshot --depth=3` after every navigation.
> See [page-inspector.md](page-inspector.md) for full usage guide.

---

## ⚠️ VALIDATION GATES (Check before proceeding)

**Before executing ANY test case:**

1. ✅ **test-cases.json exists** — verify file at `./test-runs/<RUN-ID>/test-cases.json`
2. ✅ **Verify TC structure** — each TC has `id`, `title`, `steps[]`, `expectedResults[]`
3. ✅ **Check dependencies** — if TC has `dependencies`, verify parent TCs completed first
4. ✅ **Confirm session mode** — browserMode is either "visible" or "background"
5. ✅ **Check result.json path** — ensure `./test-runs/<RUN-ID>/<TC-ID>/` folder can be created
6. ✅ **Flow source resolved** — baseline flow from prompt/library saved in run artifacts
7. ✅ **flow.adapted.json exists** for current TC before execution
8. ✅ **Runner input exists** (`flow.adapted.json`) and step engine is selected

**If ANY validation fails:** Log the error and STOP. Do NOT attempt to execute.

---

## Flow-driven preparation (MANDATORY before browser steps)

For each testcase, run this sequence:

1. Resolve baseline flow:
   - from prompt-provided flow object, or
   - from best library match.
2. Save resolution artifacts:
   - `./test-runs/<RUN-ID>/flow-resolution.json`
   - `./test-runs/<RUN-ID>/candidate-flows.json`
3. Adapt baseline flow to the testcase:
   - save `./test-runs/<RUN-ID>/<TC-ID>/flow.original.json`
   - save `./test-runs/<RUN-ID>/<TC-ID>/flow.adapted.json`
4. Execute the adapted flow using stable runner/step engine:
   - input: `./test-runs/<RUN-ID>/<TC-ID>/flow.adapted.json`
   - engine: playwright-cli command sequence or existing `executeStep`-like executor
5. Persist execution artifacts (JSON/log oriented):
   - `./test-runs/<RUN-ID>/<TC-ID>/execution-log.json`
   - `./test-runs/<RUN-ID>/<TC-ID>/playwright/stdout.log`
   - `./test-runs/<RUN-ID>/<TC-ID>/playwright/stderr.log`

If execution fails due to locator issues, follow selector-repair protocol in
[selector-repair.md](selector-repair.md), then retry with repaired flow.

> **Flow-ops reliability rule:** Prefer file-based arguments over inline JSON strings.
> Use `--steps-file <path>` and `--patch-file <path>` whenever the runner supports them.
> This avoids escaping/quoting failures with complex JSON.

---

## Setup (once per agent)

The setup differs by `browserMode` passed in the agent's context.

> ⚠️ **CRITICAL HEADED MODE RULE**:
> - `visible` mode: MUST use `--headed` to make browser visible to user
> - `background` mode: MUST NOT use `--headed` (headless is correct for parallel agents)
> - **Each `--headed` browser is a UNIQUE window** — do not share with other agents

### Mode: `visible` (user watches in real time)

Use a **named persistent session** `-s=odoo-visible` so all commands share the same browser window.

```bash
# MUST use --headed so the browser window appears on screen
playwright-cli -s=odoo-visible open --headed "<BASE_URL>/web/login"
playwright-cli -s=odoo-visible snapshot --depth=3
```

All subsequent commands in this agent **must use `-s=odoo-visible`**.

⚠️ **Only ONE visible session should exist per run.** If testing visible mode, run sequentially.

### Mode: `background` (parallel / headless)

Each background agent opens its own **anonymous headless** session (no `-s` flag, NO `--headed`).
These run silently in the background — the user does NOT see these windows.

```bash
# NO -s flag, NO --headed = fresh anonymous headless session
playwright-cli open "<BASE_URL>/web/login"
playwright-cli snapshot --depth=3
```

Each agent is independent — no session sharing, no window conflicts.

---

## Login (if not already logged in)

Check the snapshot — if already on the dashboard, skip this section.

### Visible mode
```bash
playwright-cli -s=odoo-visible snapshot --depth=3
# If login form visible:
playwright-cli -s=odoo-visible fill "[name=login]" "<username>"
playwright-cli -s=odoo-visible fill "[name=password]" "<password>"
playwright-cli -s=odoo-visible click "button[type=submit]"
playwright-cli -s=odoo-visible screenshot --filename="<TC-DIR>/screenshots/01-login.png"
```

### Background mode
```bash
playwright-cli snapshot --depth=3
# If login form visible:
playwright-cli fill "[name=login]" "<username>"
playwright-cli fill "[name=password]" "<password>"
playwright-cli click "button[type=submit]"
playwright-cli screenshot --filename="<TC-DIR>/screenshots/01-login.png"
```

---

## Per-step execution (from adapted flow)

For each step in `flow.adapted.json`, execute the corresponding playwright-cli commands.
`test-cases.json` remains the behavioral contract, while `flow.adapted.json` is the executable plan.

> **Session prefix rule:**
> - `visible` mode → prefix every command with `-s=odoo-visible`
> - `background` mode → no prefix (commands below show background mode for brevity)

> **Page Inspector first:** After EVERY navigation, call `eval $scanPage` to get the current
> page state as JSON. Use `actions[].selector` and `fields[].inputSelector` directly —
> **do NOT use `snapshot --depth=3` to find element refs**.
> Only use `snapshot` as a last resort for elements not covered by scan-page.

### navigate

```bash
playwright-cli goto "<URL>"
playwright-cli eval $scanPage    # ← get page state + selectors
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-navigate.png"
```

After `eval $scanPage`, read the JSON:
- `page.view` → confirms you're on the right page (form/list)
- `page.actions[]` → available buttons with selectors
- `page.fields[]` → form fields with `inputSelector`
- `page.dialogs[]` → any blocking dialogs to dismiss first

### click (button)

```bash
# Use selector from page.actions[] returned by scan-page:
playwright-cli click "css=button[name=<action_name>]"
# Or by label if no name attribute:
playwright-cli click "text=<Button Label>"
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-click-<slug>.png"
```

**Common button selectors (no snapshot needed):**
```bash
playwright-cli click "css=button[name=save_manually]"    # Save
playwright-cli click "text=Discard"                       # Discard
playwright-cli click "text=New"                           # New record
playwright-cli click "css=button[name=<workflow_action>]" # Workflow button
```

### fill (Odoo field)

Use `fields[].inputSelector` from scan-page. See [field-filling.md](field-filling.md) for widget types.

```bash
# Plain input / char / integer / float
playwright-cli fill "css=.o_field_widget[name=<field>] input:not([type=hidden])" "<value>"

# Date field
playwright-cli fill "css=.o_field_widget[name=<field>] input" "2026/04/30"
playwright-cli press Escape

# Datetime field
playwright-cli fill "css=.o_field_widget[name=<field>] input" "2026/04/30 09:00"
playwright-cli press Escape

# Selection (select)
playwright-cli select "css=.o_field_widget[name=<field>] select" "<option label>"

# Boolean / checkbox
playwright-cli check "css=.o_field_widget[name=<field>] input[type=checkbox]"
```

Always screenshot after filling important fields:
```bash
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-fill-<fieldName>.png"
```

### fill (many2one autocomplete)

```bash
# 1. Click the input
playwright-cli click "css=.o_field_widget[name=<field>] input"

# 2. Type search value (MUST use 'type', not 'fill')
playwright-cli type "<search value>"

# 3. Scan dropdown items
playwright-cli eval $scanDropdown
# → {"open":true,"items":[{"label":"Azure Interior","selector":"text=Azure Interior"},…]}

# 4. Click the matching item
playwright-cli click "text=<matching label>"

playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-fill-<fieldName>.png"
```

Self-heal if `items: []`: retry with shorter prefix (first 3 chars), then rescan.

### select-record-type

```bash
playwright-cli select "css=.o_field_widget[name=case_record_type_id] select" "<recordType>"
# Form re-renders — MUST rescan to get updated field list
playwright-cli eval $scanPage
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-record-type.png"
```

### save

> ⚡ **Use Required Fields Strategy** before every Save — see [required-fields-strategy.md](required-fields-strategy.md)

```bash
# 1. Check for unfilled required fields (active tab)
playwright-cli eval $scanReq
# → parse JSON → fill all where isEmpty=true using selectors above

# 2. Check hiddenRequiredTabs from scan-page — if non-empty, switch tab and fill first
# playwright-cli click "text=<Tab Name>"
# playwright-cli eval $scanPage   (rescan after tab switch)
# ... fill fields on that tab ...

playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-pre-save-fields.png"

# 3. Click Save (no snapshot needed)
playwright-cli click "css=button[name=save_manually]"
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-save.png"

# 4. Verify save result
playwright-cli eval $scanPage
# → check: validationErrors absent, dirty=false, record has ID in URL
# → if validationErrors present: rescan $scanReq → fill → retry save (max 3 attempts)
```

### send-email

⚠️ **CRITICAL: NEVER auto-send emails. Only execute if explicitly in test case steps.**

```bash
# 1. Check test case allows email sending
# If send-email NOT in test_cases.json[TC-ID].steps[] → SKIP this step

# 2. Fill To field (use scan-page inputSelector for email composer fields)
playwright-cli fill "css=.o_field_widget[name=email_to] input, css=.o_composer_input input[placeholder*='To']" "<to-email-from-test-case>"

# 3. Fill subject if provided in test case
playwright-cli fill "css=.o_field_widget[name=subject] input" "<subject>"

# 4. Fill body if provided in test case
playwright-cli click "css=.o_field_widget[name=body] .odoo-editor-editable"
playwright-cli type "<body>"

# 5. Screenshot before send
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-email-compose.png"

# 6. Click send ONLY if test case explicitly asks for it
# Do NOT send if test case only asks to "fill" email fields
playwright-cli click "css=button[name=action_send_mail], text=Send"
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-email-sent.png"
```

**Safety rules:**
- ✅ ALLOWED: Test case says "fill email form and send"
- ✅ ALLOWED: Test case explicitly defines "to", "subject", "body"
- ❌ BLOCKED: Sending to real email addresses without test case instruction
- ❌ BLOCKED: Auto-sending as part of cleanup/self-healing
- ❌ BLOCKED: Guessing email addresses

### assert

After each assertion, log PASS or FAIL:

```bash
# assert title-contains
playwright-cli eval "document.title"
# → if output contains assertValue → PASS, else FAIL

# assert no-validation-errors
playwright-cli eval "document.querySelectorAll('.o_field_invalid').length"
# → if "0" → PASS, else FAIL (list the invalid field names)

# assert field-value
playwright-cli eval "document.querySelector('.o_field_widget[name=<field>]')?.textContent?.trim()"
# → compare to assertValue

# assert url-contains
playwright-cli eval "location.href"
# → check contains assertValue

# assert element-visible
playwright-cli snapshot "<assertValue>"
# → if ref found → PASS, else FAIL

# assert toast-contains
playwright-cli eval "document.querySelector('.o_notification_content, .toast-body')?.textContent?.trim()"
```

---

## Screenshot every step

Take a screenshot at the end of every step, not just on failure.
This ensures the dashboard has a complete visual audit trail.

Naming convention:
```
<zero-padded-step-number>-<step-description-kebab-case>.png
e.g.:  01-login.png
       02-navigate-ticket-list.png
       03-open-blank-form.png
       04-select-record-type.png
       05-fill-subject.png
       06-fill-partner.png
       07-save.png
       08-assert-inc-number.png
```

---

## result.json format

Write this file when the test case finishes:

```json
{
  "id": "TC-001",
  "title": "Tạo ticket loại ヘルプデスク",
  "status": "PASS | FAIL | BUG | SKIP",
  "flow": {
    "source": "prompt | library | bootstrap",
    "selectedFlowId": "ticket-form",
    "selectedFlowVersion": "2026-04-24T05:46:09.248Z",
    "adaptedFlowPath": "flow.adapted.json",
    "repairedFlowPath": "flow.repaired.json"
  },
  "runner": {
    "engine": "step-engine",
    "stepsFile": "flow.adapted.json",
    "executionLog": "execution-log.json",
    "stdout": "playwright/stdout.log",
    "stderr": "playwright/stderr.log"
  },
  "scenario": "One-line description of input conditions, e.g. 'sequence=9999, unique value'",
  "action": "Short verb chain of the flow taken, e.g. 'Create → Save → Cancel dialog'",
  "keyAssert": "The decisive check that determined the status, e.g. 'No dialog · sequence=9,999 saved'",
  "findings": [
    "Factual one-line observations about system behaviour discovered during this TC.",
    "Prefix with ✅ for correct, ⚠️ for unexpected-but-not-a-bug, 🐛 for confirmed bug.",
    "Example: ✅ Dialog message correctly references the conflicting record name"
  ],
  "duration_ms": 12500,
  "startedAt": "2026-04-21T08:30:00+07:00",
  "finishedAt": "2026-04-21T08:30:12+07:00",
  "steps": [
    {
      "step": 1,
      "description": "Navigate to Ticket list",
      "status": "PASS",
      "screenshot": "screenshots/01-navigate-ticket-list.png",
      "healingApplied": null
    },
    {
      "step": 4,
      "description": "Fill subject",
      "status": "PASS",
      "screenshot": "screenshots/04-fill-subject.png",
      "healingApplied": null
    },
    {
      "step": 6,
      "description": "Save the ticket",
      "status": "BUG",
      "screenshot": "screenshots/06-save.png",
      "healingApplied": null,
      "bugDetail": {
        "expected": "Ticket saved with INC number",
        "actual": "Validation error on 'category_id' even though value was provided",
        "recommendFix": "Check if category_id selection triggers sub-category required validation. Consider adding UI hint for required sub-category."
      }
    }
  ],


  "bugs": [
    {
      "stepRef": 6,                        // which step number triggered this bug
      "severity": "high | medium | low",   // high=blocks workflow, medium=workaround exists, low=UX only
      "title": "Validation error on valid input",          // short bug title (required)
      "expected": "Ticket saved with INC number",          // what should have happened (required)
      "actual": "Validation error on category_id",         // what actually happened (required)
      "screenshot": "screenshots/06-save.png",             // optional
      "recommendFix": "Check required field cascade logic for category → sub_category.",   // optional
      "recommendUXFix": "Show a clear indicator that sub_category is required when category is selected."  // optional
    }
  ],
  "healingLog": [
    {
      "step": 2,
      "issue": "Button '新規' not found at expected location",
      "action": "Searched for button by text content instead of position",
      "resolved": true
    }
  ],
  "selectorRepair": {
    "attempted": true,
    "attemptCount": 1,
    "failedStepsPath": "failed-steps.json",
    "patchPath": "selector-repair.patch.json",
    "decision": "patched-in-place | created-new-flow-version | not-needed"
  }
}
```

### Field rules for `scenario`, `action`, `keyAssert`, `findings`

| Field | Max length | Guidance |
|---|---|---|
| `scenario` | 80 chars | Input state — what data was set up before the test |
| `action` | 60 chars | Verb chain — `A → B → C` format |
| `keyAssert` | 100 chars | Single most important check; separate multiple facts with `·` |
| `findings[]` | 1 item per observation | Write after execution, not before; include both ✅ and ⚠️ |

---

## Dismiss blocking modals

Before navigating to a fresh form:
```bash
playwright-cli press Escape
playwright-cli snapshot --depth=2
# If 破棄 or Discard button visible:
playwright-cli click <discard-btn-ref>
```

---

## On unrecoverable error

If the test cannot proceed after 3 self-healing attempts:
- Set `status: "FAIL"` (not BUG — flow could not complete)
- Screenshot the current state
- Write `result.json` with all steps completed so far
- Move on to the next test case
