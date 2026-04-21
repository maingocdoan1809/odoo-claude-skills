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
  "dependencies": ["TC-001"],
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
    ...
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

### Key fields

| Field | Required | Description |
|---|---|---|
| `id` | ✓ | TC-001, TC-002, etc. (assigned by parser) |
| `title` | ✓ | Test case name |
| `module` | ✓ | ticket, release, issue, etc. |
| `action` | ✓ | create, update, delete, workflow, navigate |
| `recordType` | | Form variant (e.g., "01_ヘルプデスク") |
| `priority` | | high / medium / low (defaults to medium) |
| `tags` | | smoke, regression, happy-path, edge-case, etc. |
| `dependencies` | | Array of TC IDs this TC depends on (e.g., ["TC-001", "TC-003"]) |
| `preconditions` | | List of setup requirements |
| `steps` | ✓ | Array of step objects (see below) |
| `expectedResults` | | Array of assertion objects |

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

## Dependencies

The `dependencies` field declares which other test cases must complete successfully before this TC can run:

```json
{
  "id": "TC-002",
  "dependencies": ["TC-001"],
  ...
}
```

**Execution rules:**
- `TC-001` runs first → result.json is written
- `TC-002` waits for TC-001 to complete
- If TC-001 `status: "PASS"` → TC-002 launches
- If TC-001 `status: "BUG" | "FAIL"` → TC-002 may still run (it documents alternative flows)
- If TC-002 has multiple dependencies (e.g., `["TC-001", "TC-003"]`) → ALL must complete before TC-002 starts

**When to use:**
- Multi-step workflows: Create → Update → Verify state change
- Data dependencies: Test A creates data that Test B validates
- Sequential validation: Test B tests what Test A set up

For background mode, dependencies enable efficient parallel scheduling (see [parallel-execution.md](parallel-execution.md)).

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
