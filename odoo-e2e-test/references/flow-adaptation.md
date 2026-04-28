# Flow Adaptation Strategy

Baseline flow is an **example**. Always adapt it to each testcase.

---

## Inputs

- `flow-resolution.json` (selected baseline flow)
- testcase object from `test-cases.json`
- runtime config (`url`, user, browser mode, notes)

---

## Adaptation rules

1. Keep business intent, not exact selectors.
2. Replace placeholders with testcase values.
3. Insert missing steps required by testcase assertions.
4. Remove irrelevant steps that contradict testcase scope.
5. Reorder only when needed to satisfy dependencies and expected outcomes.
6. Keep step IDs stable when possible for easier repair diff.

---

## Required outputs per TC

- `flow.original.json`
- `flow.adapted.json`

### `flow.adapted.json` minimum schema

```json
{
  "tcId": "TC-001",
  "sourceFlowId": "ticket-form",
  "adaptedAt": "2026-04-24T13:35:00+07:00",
  "changes": [
    { "type": "replace-value", "stepId": "step-02", "field": "subject" },
    { "type": "insert-step", "afterStepId": "step-05", "action": "assert" }
  ],
  "steps": [
    { "id": "step-01", "action": "navigate", "url": "http://.../web#..." },
    { "id": "step-02", "action": "fill", "selector": "css=...", "value": "TC-specific value" }
  ]
}
```

---

## Guardrails

- Never execute `flow.original.json` directly.
- If adaptation changes more than 40% of steps, log high-drift warning in `healing-log.json`.
- If adapted flow cannot satisfy testcase assertions, mark testcase as `SKIP` with reason.
