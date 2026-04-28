# Page Inspector — scan-page + scan-dropdown

**Purpose:** Replace repeated `playwright-cli snapshot --depth=3` calls with a single structured JSON scan.
Instead of parsing a verbose accessibility tree, the AI calls one script and gets back a compact JSON describing every actionable element on the page — with ready-to-use CSS selectors.

---

## Why this matters

| Old approach | New approach |
|---|---|
| `snapshot --depth=3` → parse ~200 line tree → find ref `e123` → act | `eval scan-page-iife.js` → parse JSON → use `inputSelector` directly |
| Repeat snapshot after every navigation | Scan once per navigation / major action |
| AI must reason about every element from raw HTML | AI reads structured fields/actions/tabs |
| Cannot tell what's a button vs a label | `actions[]` lists only clickable buttons |

---

## scan-page-iife.js

### Invocation (PowerShell)

```powershell
# Load once per agent run (or per TC in visible mode)
$scanPage = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-page-iife.js" -Raw

# Call after every navigation or major action:
playwright-cli -s=odoo-visible eval $scanPage      # visible mode
playwright-cli eval $scanPage                       # background mode
```

### When to call scan-page

| Event | Call scan-page? |
|---|---|
| After `goto` (navigation) | ✅ Always |
| After clicking a workflow button (status change) | ✅ Always |
| After `Save` | ✅ Yes — verify save succeeded, check new state |
| After switching a notebook tab | ✅ Yes — new fields become visible |
| After a modal dialog opens | ✅ Yes — `root` changes to `"modal"` |
| After a modal dialog closes | ✅ Yes — `root` returns to `"main"` |
| Between filling individual fields | ❌ Only if form re-renders (many2one onchange) |

### JSON output schema

```json
{
  "url": "http://172.20.108.223/odoo/helpdesk/new",
  "title": "Helpdesk / New",
  "view": "form",
  "root": "main",
  "editable": true,
  "dirty": true,

  "breadcrumbs": ["Tickets", "New"],

  "statusbar": {
    "current": "In Progress",
    "stages": [
      { "label": "Draft", "current": false, "selector": "text=Draft" },
      { "label": "In Progress", "current": true, "selector": "text=In Progress" },
      { "label": "Done", "current": false, "selector": "text=Done" }
    ]
  },

  "actions": [
    { "label": "Save manually", "selector": "css=button[name=save_manually]", "primary": true },
    { "label": "Discard",       "selector": "text=Discard",                   "primary": false },
    { "label": "Approve",       "selector": "css=button[name=action_approve]","primary": false }
  ],

  "tabs": [
    { "label": "General",      "active": true,  "selector": "text=General" },
    { "label": "Other Info",   "active": false, "selector": "text=Other Info" }
  ],
  "hiddenRequiredTabs": ["Other Info"],

  "fields": [
    {
      "name": "partner_id",
      "label": "Customer",
      "type": "many2one",
      "selector": "css=.o_field_widget[name=\"partner_id\"]",
      "inputSelector": "css=.o_field_widget[name=\"partner_id\"] input",
      "required": true
    },
    {
      "name": "subject",
      "label": "Subject",
      "type": "input",
      "value": "Test Subject",
      "selector": "css=.o_field_widget[name=\"subject\"]",
      "inputSelector": "css=.o_field_widget[name=\"subject\"] input:not([type=hidden])",
      "required": true
    },
    {
      "name": "stage_id",
      "label": "Stage",
      "type": "many2one",
      "value": "In Progress",
      "selector": "css=.o_field_widget[name=\"stage_id\"]",
      "inputSelector": "css=.o_field_widget[name=\"stage_id\"] input",
      "readonly": true
    }
  ],

  "dialogs": [],
  "notifications": [],
  "validationErrors": [
    { "name": "partner_id", "selector": "css=.o_field_invalid[name=\"partner_id\"]" }
  ]
}
```

### Key fields explained

| Field | Description |
|---|---|
| `view` | `form` \| `list` \| `kanban` \| `other` |
| `root` | `main` — no modal open. `modal` — a dialog is on top |
| `editable` | `true` if form is in edit mode (not readonly preview) |
| `dirty` | `true` if form has unsaved changes |
| `loading` | `true` if Odoo spinner is active (transient state) |
| `actions[].selector` | Use directly with `playwright-cli click` |
| `fields[].inputSelector` | The **actual input element** to use with `playwright-cli fill` or `click` |
| `fields[].selector` | The widget wrapper — use for `snapshot` scoping or assertions |
| `hiddenRequiredTabs` | Inactive tabs that have unfilled required fields — switch to them before Save |
| `dialogs[].buttons[].selector` | Use to respond to open dialogs |
| `validationErrors` | Fields currently marked invalid (after a failed save) |

---

## Using selectors with playwright-cli

### Clicking buttons

```bash
# Using selector from actions[]
playwright-cli -s=odoo-visible click "css=button[name=save_manually]"
playwright-cli -s=odoo-visible click "text=Discard"
playwright-cli -s=odoo-visible click "css=button[name=action_approve]"
```

### Filling input fields

```bash
# Plain input / char field
playwright-cli -s=odoo-visible fill "css=.o_field_widget[name=\"subject\"] input:not([type=hidden])" "My ticket subject"

# Date field
playwright-cli -s=odoo-visible fill "css=.o_field_widget[name=\"date_deadline\"] input" "2026/04/30"
playwright-cli -s=odoo-visible press Escape

# Datetime field
playwright-cli -s=odoo-visible fill "css=.o_field_widget[name=\"datetime_start\"] input" "2026/04/30 09:00"
playwright-cli -s=odoo-visible press Escape
```

### Filling many2one fields (requires scan-dropdown)

```bash
# 1. Click the input
playwright-cli -s=odoo-visible click "css=.o_field_widget[name=\"partner_id\"] input"

# 2. Type search value (MUST use 'type', not 'fill')
playwright-cli -s=odoo-visible type "Azure"

# 3. Scan dropdown items
$scanDropdown = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-dropdown-iife.js" -Raw
playwright-cli -s=odoo-visible eval $scanDropdown
# → {"open":true,"items":[{"label":"Azure Interior","selector":"text=Azure Interior"},...]}

# 4. Click the matching item
playwright-cli -s=odoo-visible click "text=Azure Interior"
```

### Navigating notebook tabs

```bash
# Using selector from tabs[]
playwright-cli -s=odoo-visible click "text=Other Info"

# After switching tab: MUST rescan to get new fields
playwright-cli -s=odoo-visible eval $scanPage
```

### Responding to dialogs

```bash
# scan-page returns dialogs[0].buttons[] when a dialog is open
# Example: confirm dialog with "OK" and "Cancel" buttons
playwright-cli -s=odoo-visible click "text=OK"
```

### Workflow buttons (status bar)

```bash
# Click a stage button from statusbar.stages[]
playwright-cli -s=odoo-visible click "text=Done"

# Or if stage has a specific data-value (more precise)
playwright-cli -s=odoo-visible click "css=.o_statusbar_status button[data-value=done]"
```

---

## scan-dropdown-iife.js

### Invocation

```powershell
$scanDropdown = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-dropdown-iife.js" -Raw
playwright-cli -s=odoo-visible eval $scanDropdown
```

### When to call scan-dropdown

Call it **only** after clicking a many2one input and typing a search value. Do NOT call on every step.

```bash
playwright-cli -s=odoo-visible click "css=.o_field_widget[name=\"category_id\"] input"
playwright-cli -s=odoo-visible type "Hardware"
playwright-cli -s=odoo-visible eval $scanDropdown
# → parse items → click matching label
```

### JSON output schema

```json
{
  "open": true,
  "items": [
    { "label": "Hardware", "selector": "text=Hardware" },
    { "label": "Hardware / Components", "selector": "text=Hardware / Components" }
  ],
  "createOption": {
    "label": "Create and edit...",
    "selector": "css=.o_m2o_dropdown_option_create_edit"
  },
  "searchMore": {
    "label": "Search More...",
    "selector": "css=.o_m2o_dropdown_option_search_more"
  }
}
```

### Handling no match

```
items: []  AND  open: true → no results found
```

Self-heal with shorter prefix (first 3 chars), then re-scan.
If still no match after 2 attempts → log as healing action, proceed without filling the field, note as potential issue.

---

## When to still use playwright-cli snapshot

| Situation | Use snapshot? | Why |
|---|---|---|
| Many2one typing → dropdown appeared | ❌ Use scan-dropdown instead | Cleaner, structured output |
| Need to verify a specific element ref | ✅ Yes | When CSS selector is ambiguous |
| Complex widget not covered by scan-page | ✅ Yes | E.g. one2many inline list |
| Debugging a failed click/fill | ✅ Yes | Visual confirmation of DOM state |
| Radio buttons styled as button groups | ✅ Yes | Non-standard widget |

**Rule:** scan-page first → use selectors → only fall back to snapshot when a selector fails.

---

## AI workflow summary

```
START of each TC:
  1. Login (if not logged in)
  2. Navigate to target URL
  3. $page = eval scan-page-iife.js → parse JSON
  4. Check: page.view, page.root, page.dialogs, page.loading

FOR EACH STEP:
  click button    → use page.actions[label].selector
  fill field      → use page.fields[name].inputSelector
  many2one fill   → click inputSelector → type → eval scan-dropdown → click item
  workflow button → use page.statusbar.stages[label].selector
  save            → click page.actions["Save manually"].selector
                  → eval scan-page-iife.js → check validationErrors
  assert          → eval assertion JS or check page.notifications

AFTER major action (save / workflow / tab switch):
  → eval scan-page-iife.js again to refresh state

BEFORE Save (always):
  → Check page.hiddenRequiredTabs — if non-empty, switch tabs and fill those fields first
  → Run scan-required-fields.js (for deep required field audit on current tab)
```

---

## Common selectors quick reference

| Element | Selector |
|---|---|
| Save button | `css=button[name=save_manually]` or `text=Save manually` |
| Discard | `text=Discard` or `text=破棄` |
| New record button | `text=New` or `text=新規` |
| Delete | `text=Delete` or `text=削除` |
| Any workflow button | `text=<button label>` |
| Status bar stage | `text=<stage name>` |
| Dialog OK | `text=OK` |
| Dialog Cancel | `text=Cancel` or `text=キャンセル` |
| Notebook tab | `text=<tab label>` |
