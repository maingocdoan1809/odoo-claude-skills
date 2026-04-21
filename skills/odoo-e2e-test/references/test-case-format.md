# Test Case JSON Format

## Schema for each parsed test case

```json
{
  "id": "TC-001",
  "title": "Tạo ticket loại ヘルプデスク với đầy đủ thông tin bắt buộc",
  "module": "ticket",
  "action": "create | update | delete | workflow | navigate",
  "recordType": "01_ヘルプデスク",
  "priority": "high | medium | low",
  "tags": ["smoke", "regression", "happy-path"],
  "preconditions": [
    "User is logged in",
    "At least one Partner exists in the system"
  ],
  "steps": [
    {
      "step": 1,
      "description": "Navigate to Ticket list",
      "action": "navigate",
      "target": "ticket-list"
    },
    {
      "step": 2,
      "description": "Click 新規 to open blank form",
      "action": "click",
      "target": "button:新規"
    },
    {
      "step": 3,
      "description": "Select record type 01_ヘルプデスク",
      "action": "select-record-type",
      "value": "01_ヘルプデスク"
    },
    {
      "step": 4,
      "description": "Fill 件名 (subject)",
      "action": "fill",
      "field": "subject",
      "value": "テスト件名 TC-001"
    },
    {
      "step": 5,
      "description": "Fill 問合せ者 (partner_id) with first available partner",
      "action": "fill",
      "field": "partner_id",
      "value": "ADMIN-TEST"
    },
    {
      "step": 6,
      "description": "Save the ticket",
      "action": "save"
    }
  ],
  "expectedResults": [
    {
      "step": 6,
      "expect": "Ticket is saved successfully with an INC number assigned",
      "assertType": "title-contains",
      "assertValue": "INC"
    }
  ]
}
```

---

## Action types

| `action` | Meaning | Required extra keys |
|---|---|---|
| `navigate` | Go to a module/page | `target` (see targets below) |
| `click` | Click an element | `target` (button name or selector) |
| `fill` | Fill an Odoo field | `field` (Odoo name), `value` |
| `select-record-type` | Choose form variant | `value` (record type label) |
| `save` | Click Save button | — |
| `assert` | Check page state | `assertType`, `assertValue` |
| `workflow` | Click a workflow button (e.g. 承認) | `target` (button name) |
| `send-email` | Fill mail compose and send | `to`, `subject` (opt), `body` (opt) |
| `upload` | Upload a file | `field`, `filePath` |
| `screenshot` | Force a screenshot | `label` (used in filename) |

## Navigate targets

| `target` value | Goes to |
|---|---|
| `ticket-list` | Ticket list view |
| `release-list` | Release list view |
| `issue-list` | Issue list view |
| `home` | Odoo home / app switcher |
| `url:<full-url>` | Any arbitrary URL |

## Assert types

| `assertType` | Checks |
|---|---|
| `title-contains` | Page `<title>` contains `assertValue` |
| `no-validation-errors` | No `.o_field_invalid` elements present |
| `field-value` | Field `field` displays `assertValue` |
| `url-contains` | Current URL contains `assertValue` |
| `element-visible` | Element matching `assertValue` selector is visible |
| `element-not-visible` | Element matching `assertValue` selector is not visible |
| `toast-contains` | Success/info toast message contains `assertValue` |

---

## Parsing rules (for the parser agent)

When reading a .docx or .xlsx test case file:

1. Each row or section = one test case
2. Assign IDs sequentially: `TC-001`, `TC-002`, …
3. Map column headers / section labels to the schema above
4. If a column header is ambiguous, infer from context (e.g., "フィールド名" → `field`, "値" → `value`)
5. If a step description contains "確認" or "verify" or "assert" → create an `assert` action
6. If expected result is described → create an `expectedResults` entry
7. Missing optional fields → omit from JSON (do not set null)
8. If the file has multiple sheets/sections → each = separate test case group; add a `group` field

## Minimal test case (no explicit steps)

When the input document is less structured (e.g., just a list of scenarios), generate steps automatically:

```json
{
  "id": "TC-001",
  "title": "Tạo ticket ヘルプデスク",
  "module": "ticket",
  "action": "create",
  "recordType": "01_ヘルプデスク",
  "fields": {
    "subject": "テスト件名",
    "partner_id": "ADMIN-TEST",
    "stage_id": "起票"
  },
  "expectedResults": [
    {
      "expect": "Ticket created with INC number",
      "assertType": "title-contains",
      "assertValue": "INC"
    }
  ]
}
```

The execution agent will expand `fields` into individual fill steps automatically.
