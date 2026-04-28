# Flow Resolution Strategy

Resolve a baseline flow for each run before testcase execution.

---

## Priority order

1. **Prompt flow**: user provides JSON object with `steps[]`.
2. **Library flow**: choose best candidate from local flow library.
3. **Bootstrap flow**: derive minimal flow from testcase steps if no good candidate exists.

---

## Input signals for matching

- `testCase.module`
- `testCase.action`
- `testCase.title` keywords
- target URL / menu hints
- step intent verbs (`create`, `edit`, `approve`, `send-email`, etc.)

---

## Candidate scoring (suggested)

Use weighted score in `[0..1]`:

- URL similarity: `0.35`
- module/action match: `0.30`
- title/keyword overlap: `0.20`
- step-intent overlap: `0.15`

Reject candidates below `0.55`.

---

## Required artifacts

Save to run root:

- `flow-resolution.json`
- `candidate-flows.json`

### `flow-resolution.json` example

```json
{
  "runId": "RUN-20260424-132433-ticket",
  "source": "prompt",
  "selectedFlowId": "ticket-form",
  "selectedFlowSlug": "ticket-form",
  "selectedFlowVersion": "2026-04-24T05:46:09.248Z",
  "reason": "Prompt flow provided and passed schema validation",
  "resolvedAt": "2026-04-24T13:30:00+07:00"
}
```

### `candidate-flows.json` example

```json
[
  { "flowId": "ticket-form", "score": 0.91, "reason": "module+url+action matched" },
  { "flowId": "ticket-list", "score": 0.63, "reason": "module matched, action partial" }
]
```

---

## Validation

The selected baseline flow must contain:

- `id` or `slug`
- `name`
- `steps[]` with at least one executable step

If invalid, fallback to next source in priority order.
