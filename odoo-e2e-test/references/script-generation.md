# Flow Runner Execution (No-Codegen Default)

Default behavior is **not** to generate Playwright source files.
Use AI-resolved `flow.adapted.json` + stable runner/step engine execution.

---

## Default artifacts per TC (JSON/log oriented)

- `flow.adapted.json`
- `execution-log.json`
- `playwright/stdout.log`
- `playwright/stderr.log`

Selector-repair artifacts remain mandatory when healing is attempted:
- `failed-steps.json`
- `selector-repair.patch.json`
- `flow.repaired.json`
- `healing-log.json`

---

## Execution rules

1. AI resolves/adapts flow JSON per testcase before execution.
2. Runner maps each flow step to one stable action (`playwright-cli` / `executeStep`-like engine).
3. Screenshot after every step.
4. Emit structured per-step status to `execution-log.json`.
5. Exit non-zero when a critical step fails.

---

## Flow-ops argument reliability

Prefer file-based arguments instead of inline JSON:

- `--steps-file <TC-DIR>\flow.adapted.json`
- `--patch-file <TC-DIR>\selector-repair.patch.json`

This avoids escaping/quoting failures and keeps execution reproducible.

---

## Optional debug export

`playwright/generated.spec.js` may be exported for debugging only.
It is **optional** and must never be a hard prerequisite for execution.
