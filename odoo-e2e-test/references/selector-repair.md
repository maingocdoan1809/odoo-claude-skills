# Selector Repair Protocol

Use this protocol when execution failed because a selector could not be used.

---

## Scope

Allowed to modify only selector-related fields in flow step objects:

- `selector`
- `playwrightSel`
- `xpath`
- `fallback`

Not allowed:
- changing business action (`click`, `fill`, `save`, etc.)
- changing testcase intent
- mutating expected assertion semantics

---

## Input object

`failed-steps.json` must be created before repair:

```json
{
  "tcId": "TC-001",
  "flowPath": "flow.adapted.json",
  "failedSteps": [
    {
      "stepId": "step-03",
      "action": "click",
      "selector": "css=.old-selector",
      "error": "Timeout waiting for selector",
      "url": "http://172.20.108.223/web#...",
      "scanPage": {
        "actions": [
          { "label": "Save manually", "selector": "css=button[name=save_manually]" }
        ]
      }
    }
  ]
}
```

---

## Repair algorithm

1. For each failed step, gather fresh page state (`scan-page` output).
2. Generate candidate selectors from:
   - actions list (`actions[].selector`)
   - field selectors (`fields[].inputSelector`)
   - stable attribute patterns (`name`, `data-testid`, `data-menu-xmlid`)
3. Validate candidates with strict checks:
   - unique match preferred
   - visible and actionable
4. Apply best candidate and record patch.

---

## Outputs

- `selector-repair.patch.json`
- `flow.repaired.json`
- append entries to `healing-log.json`

Patch example:

```json
[
  {
    "stepId": "step-03",
    "from": { "selector": "css=.old-selector" },
    "to": { "selector": "css=button[name=save_manually]" },
    "confidence": 0.93,
    "reason": "Matched action label 'Save manually' in scan-page output"
  }
]
```

---

## Post-repair decision

AI decides per testcase:

- `patched-in-place`: update current flow file directly
- `created-new-flow-version`: save new flow variant
- `not-needed`: no selector change required

Record decision and rationale in `healing-log.json`.
