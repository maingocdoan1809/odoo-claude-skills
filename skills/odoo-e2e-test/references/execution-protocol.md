# Execution Protocol

The test runner agent follows this protocol for every test case.

> **Dependency:** Before any browser interaction, invoke the `playwright-cli` skill by calling:
> `skill("playwright-cli")`
> Then follow its conventions for all commands. Full reference: `.claude/skills/playwright-cli/SKILL.md`

---

## ⚠️ VALIDATION GATES (Check before proceeding)

**Before executing ANY test case:**

1. ✅ **test-cases.json exists** — verify file at `./test-runs/<RUN-ID>/test-cases.json`
2. ✅ **Verify TC structure** — each TC has `id`, `title`, `steps[]`, `expectedResults[]`
3. ✅ **Check dependencies** — if TC has `dependencies`, verify parent TCs completed first
4. ✅ **Confirm session mode** — browserMode is either "visible" or "background"
5. ✅ **Check result.json path** — ensure `./test-runs/<RUN-ID>/<TC-ID>/` folder can be created

**If ANY validation fails:** Log the error and STOP. Do NOT attempt to execute.

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

## Per-step execution

For each step in the test case, execute the corresponding playwright-cli commands.

> **Session prefix rule:**
> - `visible` mode → prefix every command with `-s=odoo-visible` (e.g. `playwright-cli -s=odoo-visible goto ...`)
> - `background` mode → no prefix needed (commands below show background mode for brevity)

### navigate → ticket-list
```bash
playwright-cli goto "<BASE_URL>/web#action=213&model=sh.helpdesk.ticket&view_type=list&cids=1&menu_id=144"
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-navigate.png"
```

### navigate → home
```bash
playwright-cli goto "<BASE_URL>/odoo"
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-home.png"
```

### navigate → url:<full-url>
```bash
playwright-cli goto "<full-url>"
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-navigate.png"
```

### click
```bash
playwright-cli snapshot --depth=3
# Find the element ref from snapshot, then:
playwright-cli click <ref>
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-click-<slug>.png"
```

### fill (Odoo field)
See [field-filling.md](field-filling.md) for widget-specific strategies.

```bash
# For plain input fields:
playwright-cli snapshot "css=.o_field_widget[name=<fieldName>]"
playwright-cli fill <input-ref> "<value>"

# For many2one autocomplete:
playwright-cli click <input-ref>
playwright-cli type "<value>"
playwright-cli snapshot    # find dropdown item ref
playwright-cli click <dropdown-item-ref>

# For select:
playwright-cli select <select-ref> "<option-value>"

# For boolean/checkbox:
playwright-cli check <checkbox-ref>    # or uncheck
```

Always screenshot after filling important fields:
```bash
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-fill-<fieldName>.png"
```

### select-record-type
```bash
playwright-cli snapshot "css=.o_field_widget[name=case_record_type_id]"
playwright-cli select <select-ref> "<recordType>"
# Wait ~2s for form re-render, then snapshot
playwright-cli snapshot --depth=3
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-record-type.png"
```

### save
```bash
playwright-cli snapshot --depth=2
# Find save button ref (usually labeled "Save manually" or "保存")
playwright-cli click <save-btn-ref>
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-save.png"
```

### send-email

⚠️ **CRITICAL: NEVER auto-send emails. Only execute if explicitly in test case steps.**

```bash
# 1. Check test case allows email sending
# If send-email NOT in test_cases.json[TC-ID].steps[] → SKIP this step

# 2. Find 宛先 (To) field and fill it
playwright-cli click <to-field-ref>
# Only type if test case provides explicit email (do NOT guess addresses)
playwright-cli type "<to-email-from-test-case>"
playwright-cli press Enter

# 3. Fill subject if provided in test case
playwright-cli fill <subject-ref> "<subject>"

# 4. Fill body if provided in test case
playwright-cli click <body-ref>
playwright-cli type "<body>"

# 5. Screenshot before send
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-email-compose.png"

# 6. Click send ONLY if test case explicitly asks for it
# Do NOT send if test case only asks to "fill" email fields
playwright-cli click <send-btn-ref>
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
      "stepRef": 6,
      "severity": "high | medium | low",
      "title": "Validation error on valid input",
      "expected": "Ticket saved with INC number",
      "actual": "Validation error on category_id",
      "screenshot": "screenshots/06-save.png",
      "recommendFix": "Check required field cascade logic for category → sub_category.",
      "recommendUXFix": "Show a clear indicator that sub_category is required when category is selected."
    }
  ],
  "healingLog": [
    {
      "step": 2,
      "issue": "Button '新規' not found at expected location",
      "action": "Searched for button by text content instead of position",
      "resolved": true
    }
  ]
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
