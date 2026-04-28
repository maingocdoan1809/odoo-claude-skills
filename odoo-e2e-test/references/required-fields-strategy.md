# Required Fields Strategy — Scan Before Fill

## Problem

Odoo forms have required fields that may not all be visible upfront.
Selecting a value in one field can trigger `onchange` that marks additional fields as required.

**Old (slow) approach:** Try to save → get validation error → fix that field → try again → repeat.

**New (fast) approach:** Scan DOM for required+empty fields → fill all in one pass → save.
If save still fails, scan again for newly revealed required fields → fill → save.

---

## When to use this strategy

Use this strategy whenever a test step creates or edits an Odoo form record.
Specifically, apply it **before clicking Save** for any new record or after a major field change.

---

## The scan command

Run this at any point to get a list of unfilled required fields on the current page.

**No temp file needed.** Read `scan-iife.js` directly from the skills directory via PowerShell variable, then pass to `playwright-cli eval`:

```powershell
# PowerShell (recommended — no temp file)
$scan = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-iife.js" -Raw
playwright-cli -s=<session> eval $scan
```

`eval` runs JS directly in the page context and has no file-path restrictions, so the script can live in the skills directory and be read on-the-fly.

The command returns a JSON array like:

```json
[
  { "name": "partner_id",    "label": "Customer",  "type": "many2one",  "isEmpty": true,  "isInvalid": false },
  { "name": "category_id",   "label": "Category",  "type": "selection", "isEmpty": true,  "isInvalid": false },
  { "name": "priority",      "label": "Priority",  "type": "selection", "isEmpty": false, "isInvalid": true  }
]
```

---

## Execution loop (use instead of a plain save)

### Overview

```
SCAN → FILL all empty required fields → TRY SAVE
  └─ Save OK?
       ✅ YES → done
       ❌ NO (validation error) → compare new invalid set vs previous set
             ├─ New fields appeared? → FILL new required fields → TRY SAVE again (max 3 total)
             └─ Same fields as before? → STUCK → report BUG (field value rejected by server)
```

### Step-by-step

**Step A — Scan before first fill**

```powershell
# 1. Scan for required fields on the open form
$scan = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-iife.js" -Raw
playwright-cli -s=<session> eval $scan
# → parse JSON output → store as requiredFields[]

# 2. Fill ALL fields from requiredFields[] where isEmpty === true
#    Use field-filling.md conventions per type (many2one, selection, input, etc.)
#    See "Filling strategies by type" section below.

# 3. Take screenshot
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-fields-pre-save.png"
```

**Step B — Try to save**

```bash
playwright-cli snapshot --depth=2
playwright-cli click <save-btn-ref>
playwright-cli screenshot --filename="<TC-DIR>/screenshots/<N>-save-attempt.png"
```

**Step C — Check result**

```bash
# Check how many invalid fields remain
playwright-cli eval "document.querySelectorAll('.o_field_invalid').length"
```

- If result is `"0"` → **PASS**, proceed to assertions.
- If result is `> 0` → **validation failed**, go to Step D.

**Step D — Rescan and compare (max 2 more attempts)**

```powershell
# Rescan invalid + still-empty required fields
$scan = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-iife.js" -Raw
playwright-cli -s=<session> eval $scan
# → parse JSON output → store as newRequiredFields[]
```

Compare `newRequiredFields` with the previous scan:

- **New field names appeared** (onchange revealed more required fields) → fill them → go back to Step B.
- **Same field names as before** → the server rejected the value:
  - Log as `BUG`: "Server validation rejected value for field `<name>`"
  - Do NOT loop further — proceed to write `result.json` with BUG status.
- **Max 3 save attempts reached** → mark as `FAIL` (could not complete flow), write `result.json`.

---

## Filling strategies by type

After scanning, fill each field using the appropriate playwright-cli commands.
For full details see [field-filling.md](field-filling.md).

| type       | Strategy summary |
|------------|-----------------|
| `input`    | `playwright-cli fill "css=.o_field_widget[name=X] input" "<value>"` |
| `selection`| `playwright-cli select "css=.o_field_widget[name=X] select" "<option-label>"` |
| `many2one` | click input → type value → snapshot → click dropdown item |
| `many2many` | same as many2one, repeated per tag |
| `date`     | `playwright-cli fill <input-ref> "YYYY/MM/DD"` → `playwright-cli press Escape` |
| `datetime` | `playwright-cli fill <input-ref> "YYYY/MM/DD HH:MM"` → `playwright-cli press Escape` |
| `html`     | click editor → `Control+a` → type value |
| `boolean`  | only fill if `isInvalid` is true — check or uncheck as test case requires |

> ⚠️ After filling a `many2one` or `selection` field, always take a fresh snapshot.
> Odoo `onchange` may reveal or hide other fields immediately after.
> Re-run the scan command if the form visually changes significantly.

---

## Unsupported field types (fallback to snapshot)

The scan script does **not** handle these types automatically.
If a required field of these types is found, use snapshot to inspect and fill manually:

- `binary` / `image` / `many2many_binary` — file upload
- `one2many` inline lists — create sub-records via dialog
- `radio` buttons styled as button groups — click directly
- `properties` / `json` — inspect snapshot to determine structure
- Server-side constraints not reflected in DOM — only detectable after save failure

For these, log the field name and type in `result.json → healingLog`.

---

## Example: creating a Helpdesk ticket

```
1. Navigate to /odoo/helpdesk/new → blank form opens

2. SCAN → result: [partner_id (many2one, empty), team_id (many2one, empty)]

3. Fill partner_id: click input → type "Nissho" → select from dropdown
   Fill team_id: click input → type "Support" → select from dropdown
   Screenshot: 03-pre-save-fill.png

4. TRY SAVE → click Save button

5. CHECK: .o_field_invalid count = 1
   RESCAN → result: [category_id (selection, empty)]
   → category_id appeared because team_id onchange revealed it

6. Fill category_id: select "Hardware"
   Screenshot: 05-fill-category.png

7. TRY SAVE (attempt 2) → .o_field_invalid count = 0 → PASS ✅
```

Total saves: **2** (instead of potentially 4-5 blind save attempts).

---

## Notes

- The script only scans the **active form view** and **active notebook tab**.
  If required fields are on other tabs, switch tabs and rescan.
- Required fields inside **dialogs/modals** are scanned automatically as long as
  the dialog is open and overlays the current page.
- The script filters out fields with `.o_invisible_modifier` — these are conditionally
  hidden by Odoo and do not need to be filled even if technically required.
