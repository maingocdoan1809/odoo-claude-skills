# Playwright test execution delegation

Claude writes the test spec, opencode drives the browser. Split the work:

1. **Claude** writes a concrete test spec — numbered steps + expected result
   per step, as a file (e.g. under the scratchpad dir).
2. **Claude** shows the spec to the user and gets confirmation before
   running it.
3. Delegate execution to opencode:
   ```bash
   ~/.claude/skills/opencode/playwright-test/playwright-test.sh <spec-file> <evidence-dir> [app-base-url] [dir]
   ```
   opencode's `playwright-tester` agent drives the real browser via
   `playwright-cli`, following the spec step by step, and must save a
   screenshot per step (`step-01.png`, `step-02.png`, ...) into
   `<evidence-dir>`.
4. **Claude** reads the screenshots back (`Read` tool) and checks them
   against expected results before telling the user it passed — opencode's
   own `RESULT: PASS/FAIL` line is a claim to verify, not a verdict to
   forward as-is. This mirrors the project's own verification standard: "it
   compiles" / "opencode said PASS" is not "it works".

## Safety — whitelist, not blocklist

`playwright-tester` (in `~/.config/opencode/opencode.jsonc`) has
`edit: deny`, `external_directory: deny`, and a `bash` permission map
limited to UI-driving/inspection `playwright-cli` subcommands: open, goto,
click, fill, type, select, hover, check/uncheck, drag/drop, upload,
screenshot, pdf, tab-*, console, requests and related inspectors,
network-state-set, resize, press, dialog-accept/dismiss, go-back/forward,
reload, state-load.

Deliberately excluded:
- `eval` / `run-code` — arbitrary JS execution, an escape hatch
- `route` / `unroute` — network mocking, could be used to fake a pass
- `state-save` — could write session/auth data anywhere
- `install`, `kill-all`, `close-all` — side effects outside the test itself

It cannot edit source and cannot run any non-`playwright-cli` shell command.

## Exit codes

- `0` — opencode reported `RESULT: PASS`. Still verify screenshots yourself.
- `1` — opencode reported `RESULT: FAIL`. Check screenshots to see what
  actually happened at the failing step.
- `3` — didn't answer in the expected `RESULT:`/`step-NN:` format. Go look
  at the evidence directory yourself; don't treat this as pass or fail.

## Status

Not yet live-tested end-to-end against a running app (unlike
`ship/ship.sh`, which has been). Try it on something low-stakes
first and read the screenshots critically before trusting it on anything
that matters.
