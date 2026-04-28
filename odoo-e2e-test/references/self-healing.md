# Self-Healing Rules & BUG Criteria

---

## Core principle

> **Self-heal** when the *path* to the outcome is blocked by a UI/navigation issue.
> Report **BUG** when the path completes correctly but the *outcome* is wrong.

---

## Decision flowchart

```
Execute step
    │
    ▼
Did the step succeed as-is?
    │ YES → log PASS, continue
    │ NO
    ▼
Is the failure caused by a UI/flow issue?
(element not found, wrong ref, unexpected dialog, page re-rendered)
    │ YES → SELF-HEAL (see rules below)
    │ NO
    ▼
Did the flow complete correctly but result is wrong?
(wrong data, unexpected validation error, wrong status, missing INC number)
    │ YES → report BUG
    │ NO
    ▼
Unrecoverable / 3 healing attempts failed → FAIL
```

---

## Self-healing rules

### Rule 1 — Element ref is stale
**Symptom**: Ref `eXXX` not found in current snapshot.
**Heal**: Take a fresh snapshot, find the element by role/text/selector instead of ref.

```bash
playwright-cli snapshot --depth=4
# Use role selector:
playwright-cli click "getByRole('button', { name: '新規' })"
# Or CSS:
playwright-cli click "css=.o_form_button_save"
```

Log: `"Stale ref eXXX — re-resolved by role selector"`

---

### Rule 2 — Unexpected modal/dialog blocking
**Symptom**: A dialog appeared (confirmation, error, unsaved changes) blocking the next step.
**Heal**: Identify the dialog, take appropriate action (accept / dismiss / fill required fields), then retry the step.

```bash
playwright-cli snapshot --depth=5
# If "Unsaved changes" modal:
playwright-cli click "getByRole('button', { name: '破棄' })"
# If error dialog:
playwright-cli click "getByRole('button', { name: 'OK' })"
playwright-cli dialog-accept
```

Log: `"Unexpected modal '<title>' — dismissed, retrying step"`

---

### Rule 3 — Form re-rendered after selection
**Symptom**: After selecting a record type or filling a select, expected fields disappeared.
**Heal**: Take fresh snapshot, re-locate fields by name attribute, continue filling.

```bash
playwright-cli snapshot "css=.o_form_view"
```

Log: `"Form re-rendered — re-snapshotted to find updated field refs"`

---

### Rule 4 — Navigation didn't reach expected page
**Symptom**: After `goto`, the page is at a login screen or an error page instead of expected module.
**Heal**: Check if session expired → re-login, then retry navigation.

```bash
playwright-cli eval "document.title"
# If title contains "Login" → re-login
playwright-cli goto "<BASE_URL>/web/login"
playwright-cli fill "[name=login]" "<username>"
playwright-cli fill "[name=password]" "<password>"
playwright-cli click "button[type=submit]"
# Then retry original navigation
```

Log: `"Session expired — re-logged in and retried navigation"`

---

### Rule 5 — Many2one dropdown has no matching item
**Symptom**: Typed a value but no matching dropdown item appeared.
**Heal**: Try a shorter prefix (first 3 chars). If still nothing, try the first available item and log a warning.

```bash
playwright-cli type "ADM"   # shorter prefix
# If still no match → pick first item and warn
```

Log: `"No exact match for '<value>' in many2one — used first available item '<actual>'"`

---

### Rule 6 — Wrong button label (localization)
**Symptom**: `getByRole('button', { name: 'Save' })` not found (UI may be in Japanese).
**Heal**: Try common Japanese equivalents.

| English | Japanese alternatives |
|---|---|
| Save | 保存, Save manually |
| New | 新規 |
| Discard | 破棄 |
| Confirm | 確認, OK |
| Cancel | キャンセル |
| Send | 送信 |
| Delete | 削除 |

```bash
playwright-cli click "getByRole('button', { name: '保存' })"
```

---

## Selector-only repair loop (flow patching)

When a generated script fails due to locator errors, run a dedicated selector-repair pass.

### Trigger conditions

Run selector-repair only when failure is locator-related:
- element not found
- strict mode violation / too many matches
- stale element reference
- timeout waiting for selector visibility

Do **not** run selector-repair for business failures (validation, wrong data, server 500).

### Required artifacts per TC

- `failed-steps.json`
- `healing-log.json`
- `selector-repair.patch.json`
- `flow.repaired.json`

Example `failed-steps.json`:

```json
{
  "tcId": "TC-001",
  "failedSteps": [
    {
      "stepId": "step-04",
      "action": "click",
      "selector": "css=.o_form_button_save",
      "xpath": "//button[@name='save_manually']",
      "error": "Timeout 10000ms exceeded while waiting for selector",
      "pageUrl": "http://172.20.108.223/web#id=...",
      "scanPageSummary": {
        "view": "form",
        "actions": ["Save manually", "Discard"]
      }
    }
  ]
}
```

### Patch rules

1. Only update selector fields:
   - `selector`
   - `playwrightSel`
   - `xpath`
   - `fallback` (if used for disambiguation)
2. Do not change:
   - `action`
   - business intent of the step
   - input values unless required for selector disambiguation
3. Save all changes as explicit patch entries in `selector-repair.patch.json`.
4. Re-run with `flow.repaired.json`.

### Repair attempts

- Max 3 repair attempts per failing step.
- If all attempts fail:
  - mark testcase `FAIL`,
  - keep artifacts for audit,
  - continue with next testcase.

### Decide in-place patch vs new flow version

AI can decide per testcase:
- **Patch in place** when change is tiny and deterministic.
- **Create new flow version** when changes are broad or risky to apply globally.

Record decision in `healing-log.json` with rationale.

---

## BUG criteria

Report a **BUG** when:

1. **Unexpected validation error on valid input**
   - All required fields were filled with correct values
   - Odoo still shows `.o_field_invalid` on one or more fields
   - *Recommended fix*: Check field dependency logic / required conditions

2. **Save succeeded but wrong data**
   - Ticket was created, but a field shows a different value than what was entered
   - *Recommended fix*: Check field write permissions or computed field logic

3. **Workflow state not progressing**
   - Clicked a workflow button (e.g., 承認, クローズ)
   - Status/stage did not change as expected
   - *Recommended fix*: Check state machine conditions / user access rights

4. **Unexpected error message on valid flow**
   - A server error (500) or access denied appeared during normal operation
   - *Recommended fix*: Check server logs, access rights, required field configs

5. **Data not persisted after save**
   - Form showed success, but on reload the data is gone or partially missing
   - *Recommended fix*: Check ORM write / inverse method logic

6. **Expected element not visible after correct action**
   - E.g., INC number not assigned after ticket save
   - *Recommended fix*: Check sequence configuration

---

## Bug severity classification

| Severity | Criteria |
|---|---|
| `high` | Blocks the main workflow (cannot create/save/submit) |
| `medium` | Functional issue but workaround exists, or affects optional fields |
| `low` | UI/UX issue only (wrong label, layout problem, confusing message) |

---

## Healing attempt limit

- Max **3 self-healing attempts** per step
- If all 3 fail: set step status = `FAIL`, log all attempts, continue to next step
- If a critical step (save, navigate) fails: set test case status = `FAIL`

---

## What NOT to self-heal

Do **not** self-heal:
- Fundamental data issues (wrong option values in JSON test case)
- Server 500 errors (those are BUGs)
- Missing master data that should be set up as preconditions

For precondition failures → set status = `SKIP` with reason.
