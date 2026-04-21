# odoo-claude-skills

Claude Code skills for Odoo development and E2E testing.

## Skills included

### `odoo-e2e-test`

Self-healing E2E test framework for Odoo. Give it a test spec file (`.html`, `.docx`, `.xlsx`) and it will:

- Parse test cases automatically
- Execute each test in a Playwright browser (headed or headless)
- Self-heal when selectors change
- Generate a single-file HTML dashboard with Bug/Pass/Total counts and fix recommendations

**Supports**: Odoo 14–19, any module, any language spec file (JP/VN/EN)

## Installation

```bash
claude plugin install https://github.com/your-org/odoo-claude-skills
```

## Prerequisites

`playwright-cli` must be available. Install it once:

```bash
npm install -g @playwright/cli@latest
```

Or if you prefer, install the official Playwright plugin for Claude Code first:

```bash
claude plugin install playwright
```

## Usage

Once installed, activate the skill in your Claude Code session:

```
Use the odoo-e2e-test skill to run tests from my spec file at ./testcase/Phase2.3/D0076.html
```

Claude will ask for:
- Target URL (e.g. `http://your-odoo-server/web`)
- Login credentials
- Test case range (e.g. TC-001 to TC-014)
- Browser mode: **visible** (you watch) or **background** (parallel, faster)

Results are saved under `./test-runs/<RUN-ID>/` with per-TC screenshots and a `report.html` dashboard.

## Key features

| Feature | Details |
|---|---|
| **Self-healing** | Retries with alternative selectors when elements move |
| **Visible mode** | `--headed` browser so you can watch every action |
| **Parallel mode** | Runs multiple TCs simultaneously in background |
| **HTML report** | Single-file dashboard, shareable without a server |
| **Spec agnostic** | Parses Japanese/Vietnamese/English HTML spec tables |

## Notes

- Browser is **headless by default** — visible mode explicitly uses `--headed`
- Each test run gets a unique `RUN-ID` so results never overwrite each other
- Screenshots are saved after every step for debugging

## License

MIT
