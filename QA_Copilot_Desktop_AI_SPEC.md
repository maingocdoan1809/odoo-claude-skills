# QA Copilot Desktop — AI Agent Specification

> **Purpose of this file**: Feed this to any AI agent (GitHub Copilot, Claude, GPT-4) working on this codebase. This file is the single source of truth for architecture, data schemas, execution logic, and coding conventions.

---

## 1. What This App Does

A desktop app (Electron) that helps non-technical QA testers run automated regression tests by combining:
- **Playwright** for browser automation (deterministic, fast)
- **GitHub Copilot CLI** (`gh copilot --autopilot`) for AI decision-making at dynamic steps

QA records a flow once → app stores it → AI replays it with different test data automatically.

**Target user**: Manual QA tester. No coding knowledge. Should never see a terminal or JSON.

---

## 2. Core Concept: Hybrid Execution Model

Every flow step is classified as one of two modes:

```
FIXED    → Playwright executes directly, no AI involved
DECISION → AI (Copilot CLI) reasons about the DOM, then Playwright acts
```

### Classification Rules

| Step type | Mode | Reason |
|-----------|------|--------|
| navigate_menu | FIXED | Menu path never changes |
| click action button (Save, New, Confirm, Cancel) | FIXED | Not data-dependent |
| fill text/number field | DECISION | Value varies per testcase |
| many2one field | DECISION | AI extracts DOM options, picks best fit |
| many2many field | DECISION | Same as many2one |
| file upload | DECISION | File varies per testcase |
| checkbox / radio | ASK_USER at record time | Could be either |

**Performance implication**: FIXED steps run at Playwright speed (~100ms each). DECISION steps invoke Copilot CLI (~2–5s each). Minimize DECISION steps — only use when value truly varies.

---

## 3. Data Schemas

### 3.1 Project Profile

```typescript
interface ProjectProfile {
  id: string;                    // uuid
  name: string;                  // "Astralink", "ProjectX"
  base_url: string;              // "https://erp.example.com"
  app_type: "odoo" | "web" | "custom";
  test_accounts: TestAccount[];
  env_vars: Record<string, string>;
  skill_path?: string;           // path to custom .md skill file for Copilot
  created_at: string;            // ISO datetime
}

interface TestAccount {
  role: string;                  // "admin", "user", "manager"
  username: string;
  password: string;              // AES-256 encrypted at rest
}
```

### 3.2 Flow Skeleton (core schema)

```typescript
interface FlowSkeleton {
  flow_id: string;               // "helpdesk_create_ticket"
  flow_name: string;             // "Tạo ticket trong Helpdesk"
  module: string;                // "Helpdesk", "Sales", "Purchase"
  app_type: "odoo" | "web";
  source: "recorded" | "ai_learned";
  reviewed: boolean;             // false = ai_learned, not yet approved by Dev
  tags: string[];                // for fuzzy matching: ["ticket", "create", "helpdesk"]
  created_at: string;
  updated_at: string;
  steps: FlowStep[];
  parameters: string[];          // ["subject", "customer", "priority"]
}

interface FlowStep {
  step_id: number;
  type: StepType;
  mode: "FIXED" | "DECISION";
  action: StepAction;
  param?: string;                // parameter name this step fills (DECISION only)
  hint?: string;                 // natural language hint for AI (DECISION only)
}

type StepType =
  | "navigate_menu"
  | "click"
  | "fill_field"
  | "many2one"
  | "many2many"
  | "file_upload"
  | "wait"
  | "assert";

interface StepAction {
  // navigate_menu
  path?: string[];               // ["Helpdesk", "Tickets"]

  // click / fill_field
  selector?: string;             // always use stable selectors (see Section 6)

  // many2one / many2many
  field?: string;                // Odoo field name, e.g. "partner_id"

  // fill_field
  value?: string;                // only for FIXED fill steps

  // wait
  timeout?: number;              // ms

  // assert
  expected?: string;
}
```

### 3.3 Testcase

```typescript
interface Testcase {
  tc_id: string;                 // "TC001"
  module: string;
  title: string;
  description: string;           // free-form natural language — this is what AI reads
  priority: "High" | "Medium" | "Low";
  expected_result?: string;
  status: "pending" | "passed" | "failed" | "skipped";
  source_file: string;           // original Excel filename
}
```

### 3.4 Test Run

```typescript
interface TestRun {
  run_id: string;
  project_id: string;
  tc_id: string;
  flow_id: string;
  param_set: Record<string, string>;  // { subject: "...", customer: "..." }
  started_at: string;
  finished_at: string;
  status: "passed" | "failed" | "error";
  step_results: StepResult[];
}

interface StepResult {
  step_id: number;
  status: "passed" | "failed" | "skipped";
  screenshot_path?: string;      // only captured on failure or verbose mode
  error?: string;                // plain Vietnamese error message for QA
  duration_ms: number;
}
```

---

## 4. Execution Engine Logic

### 4.1 Main Execution Flow

```
function executeTestcase(testcase, project, paramSet):
  1. flow = matchFlow(testcase, project)
     if not found:
       flow = aiSelfExplore(testcase, project)  // see 4.3
       saveFlow(flow, reviewed=false)
       notifyDevToReview(flow)

  2. for each step in flow.steps:
       if step.mode == FIXED:
         playwright.execute(step.action)
       
       if step.mode == DECISION:
         value = copilotDecide(step, testcase, paramSet, currentScreenshot)
         playwright.execute(step.action, value)
       
       captureResult(step)
       if failed: break (or continue if soft-assert)

  3. return TestRun result
```

### 4.2 Flow Matching

```
function matchFlow(testcase, project):
  // Step 1: exact match by module + keywords in flow tags
  candidates = db.query(
    "SELECT * FROM flows WHERE module = ? AND app_type = ?",
    [testcase.module, project.app_type]
  )
  
  // Step 2: rank by keyword overlap between testcase.description and flow.tags
  ranked = rankByKeywordOverlap(candidates, testcase.description)
  
  // Step 3: return top match if score > threshold (0.4), else null
  return ranked[0]?.score > 0.4 ? ranked[0] : null
```

### 4.3 AI Self-Explore (when no flow found)

```
function aiSelfExplore(testcase, project):
  prompt = buildExplorePrompt(testcase, project)
  // prompt includes: testcase description, base_url, app_type, current screenshot
  
  spawn: gh copilot --autopilot -p "{prompt}"
  // Copilot navigates, interacts, completes the testcase
  
  // Meanwhile, app intercepts all Playwright actions via CDP
  capturedActions = interceptCDPEvents()
  
  // Convert captured actions to FlowSkeleton
  flow = parseActionsToSkeleton(capturedActions)
  flow.source = "ai_learned"
  flow.reviewed = false
  
  return flow
```

### 4.4 Copilot DECISION Prompt Template

```
System context (injected once per run):
  You are a QA automation assistant testing {project.name} ({project.app_type}).
  Base URL: {project.base_url}
  Current user: {account.role} — {account.username}
  
  Rules:
  - For many2one/many2many fields: use Playwright to extract available options from DOM first, then choose the most appropriate one
  - For text fields: generate realistic Vietnamese test data matching the hint
  - Always return a single Playwright CLI command
  - Never hallucinate selectors — extract from DOM first

Per-step prompt:
  Testcase: {testcase.title}
  Description: {testcase.description}
  Current step: Fill "{step.param}" — Hint: {step.hint}
  Known param values so far: {JSON.stringify(paramSet)}
  
  What Playwright command should I run for this step?
```

---

## 5. AI Testcase Generator

When QA wants to run a testcase N times with different data:

```
Input:
  - testcase.description (free-form)
  - flow.parameters (list of param names needed)
  - count (how many sets to generate, default 5)

Prompt to Copilot/AI:
  Generate {count} realistic test data sets for this testcase.
  Testcase: {description}
  Required parameters: {parameters}
  Rules:
    - Use realistic Vietnamese names, company names, addresses
    - Cover edge cases: short input, long input, special characters
    - Vary the values meaningfully — don't just change one word
    - Return ONLY a JSON array, no explanation
  
  Output format:
  [
    { "param1": "value1", "param2": "value2" },
    ...
  ]

Post-process:
  - Parse JSON
  - Display as editable table for QA review
  - QA unchecks rows they don't want
  - Run checked rows sequentially
```

---

## 6. Odoo-Specific Playwright Conventions

When `project.app_type === "odoo"`, always follow these rules:

### Selector Priority (most stable → least stable)

```javascript
// 1. BEST — Odoo field name attribute
page.locator('[name="partner_id"]')
page.locator('[name="order_line"]')

// 2. GOOD — Odoo semantic classes
page.locator('.o_form_button_save')
page.locator('.o_list_button_add')
page.locator('.o_statusbar_status button:has-text("Confirm")')

// 3. OK — text-based for menus
page.locator('.o_menu_sections a:has-text("Helpdesk")')
page.locator('button:has-text("New")')

// 4. AVOID — dynamic ids, nth-child, positional selectors
page.locator('#o_field_widget_42')   // BAD — changes every session
page.locator('tr:nth-child(3) td')   // BAD — breaks on data change
```

### Required Waits for Odoo

```javascript
// After any navigation or form action, always wait for Odoo spinner
await page.waitForSelector('.o_loading', { state: 'hidden', timeout: 10000 })

// Before interacting with many2one
await page.locator('[name="partner_id"] input').click()
await page.waitForSelector('.o_field_many2one_selection .dropdown-menu', { state: 'visible' })
// NOW extract options and click

// After Save
await page.waitForSelector('.o_form_status_indicator', { state: 'hidden' })
```

### Many2one Interaction Pattern

```javascript
// CORRECT pattern for Odoo many2one
async function fillMany2one(page, fieldName, valueHint) {
  const field = page.locator(`[name="${fieldName}"] input`)
  await field.click()
  await field.fill('')  // clear first
  
  // Wait for dropdown
  const dropdown = page.locator('.o_field_many2one_selection .dropdown-menu')
  await dropdown.waitFor({ state: 'visible' })
  
  // Extract available options — pass this list to AI for selection
  const options = await dropdown.locator('li').allTextContents()
  // AI picks from `options` based on valueHint
  // Then:
  await dropdown.locator(`li:has-text("${selectedOption}")`).click()
}
```

---

## 7. File Structure

```
qa-copilot-desktop/
├── electron/
│   ├── main.ts                  # Electron main process
│   ├── preload.ts               # IPC bridge (contextBridge)
│   └── ipc/
│       ├── profiles.ts          # Profile CRUD handlers
│       ├── flows.ts             # Flow Library handlers
│       ├── execution.ts         # Run engine handlers
│       └── excel.ts             # Excel import handlers
├── src/                         # React renderer
│   ├── pages/
│   │   ├── Projects.tsx
│   │   ├── Testcases.tsx
│   │   ├── Run.tsx
│   │   ├── Results.tsx
│   │   └── FlowLibrary.tsx
│   ├── components/
│   │   ├── Terminal.tsx         # xterm.js wrapper
│   │   ├── StepList.tsx         # Visual flow step display
│   │   ├── ParamTable.tsx       # Editable testcase param grid
│   │   └── StatusBadge.tsx
│   └── store/                   # Zustand state
├── engine/
│   ├── executor.ts              # Hybrid execution engine
│   ├── matcher.ts               # Flow matching logic
│   ├── recorder.ts              # Playwright codegen wrapper
│   ├── copilot.ts               # Copilot CLI spawner
│   └── odoo.ts                  # Odoo-specific helpers
├── db/
│   ├── schema.sql               # SQLite schema
│   └── db.ts                    # better-sqlite3 wrapper
└── skills/
    └── qa-testcase.md           # Custom Copilot skill (inject into prompt)
```

---

## 8. SQLite Schema

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  app_type TEXT NOT NULL CHECK(app_type IN ('odoo', 'web', 'custom')),
  config_json TEXT NOT NULL,   -- JSON: test_accounts, env_vars, skill_path
  created_at TEXT NOT NULL
);

CREATE TABLE flows (
  flow_id TEXT PRIMARY KEY,
  flow_name TEXT NOT NULL,
  module TEXT NOT NULL,
  app_type TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('recorded', 'ai_learned')),
  reviewed INTEGER NOT NULL DEFAULT 0,  -- 0=false, 1=true
  tags TEXT NOT NULL,          -- JSON array of strings
  skeleton_json TEXT NOT NULL, -- full FlowSkeleton JSON
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- FTS index for flow matching
CREATE VIRTUAL TABLE flows_fts USING fts5(
  flow_id UNINDEXED,
  flow_name,
  module,
  tags,
  content='flows',
  content_rowid='rowid'
);

CREATE TABLE testcases (
  tc_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  module TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT,
  expected_result TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  source_file TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tc_id, project_id)
);

CREATE TABLE test_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  tc_id TEXT NOT NULL,
  flow_id TEXT NOT NULL,
  param_set_json TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  step_results_json TEXT        -- JSON array of StepResult
);

CREATE INDEX idx_runs_project ON test_runs(project_id);
CREATE INDEX idx_runs_status ON test_runs(status);
```

---

## 9. IPC API (Main ↔ Renderer)

```typescript
// All IPC calls follow: ipcRenderer.invoke(channel, ...args) → Promise<Result>

// Profiles
'profile:list'     → ProjectProfile[]
'profile:get'      (id: string) → ProjectProfile
'profile:save'     (profile: ProjectProfile) → void
'profile:delete'   (id: string) → void

// Testcases
'tc:import'        (filePath: string, projectId: string) → Testcase[]
'tc:list'          (projectId: string) → Testcase[]
'tc:update'        (tc: Testcase) → void
'tc:delete'        (tcId: string) → void

// Flows
'flow:list'        (filter?: { module?: string, reviewed?: boolean }) → FlowSkeleton[]
'flow:get'         (flowId: string) → FlowSkeleton
'flow:save'        (flow: FlowSkeleton) → void
'flow:delete'      (flowId: string) → void
'flow:approve'     (flowId: string) → void

// Execution
'run:start'        (tcId: string, projectId: string, paramSet: Record<string,string>) → runId: string
'run:stop'         (runId: string) → void
'run:status'       (runId: string) → TestRun
'run:list'         (projectId: string) → TestRun[]

// AI Generator
'ai:generate-params' (description: string, parameters: string[], count: number) → Record<string,string>[]

// Recorder
'recorder:start'   (projectId: string) → void
'recorder:stop'    () → FlowSkeleton  // returns captured skeleton for review
```

---

## 10. UX Rules (enforce in code, not just design)

These are hard rules — enforce them in components, not just documented:

```
1. Never render raw JSON to QA-facing screens
2. Never show terminal by default — wrap in <Collapsible> closed by default
3. All error messages must be in plain Vietnamese, no stack traces
4. Every async operation needs a loading state — no blank screens > 1 second  
5. Flows with reviewed=false must show "Chưa được kiểm duyệt" badge in orange
6. Dangerous actions (delete flow, delete project) require confirmation dialog
7. "Run" button disabled until a project is selected AND at least one testcase is checked
```

---

## 11. Copilot Skill File (inject as context)

Save as `skills/qa-testcase.md` and reference via `project.skill_path`:

```markdown
# QA Test Execution Skill

You are executing automated tests for a web application using Playwright.

## Your responsibilities
- At DECISION steps: choose the most contextually appropriate value
- For many2one fields: always extract DOM options first, never guess
- For text fields: generate realistic, meaningful Vietnamese test data
- Never skip steps — if stuck, report the specific blocker

## Playwright commands available
- `playwright click <selector>`
- `playwright fill <selector> <value>`
- `playwright select-option <selector> <value>`
- `playwright screenshot`
- `playwright evaluate <expression>`  ← use this to extract DOM options

## When extracting many2one options
```
playwright evaluate "Array.from(document.querySelectorAll('.dropdown-menu li')).map(el => el.textContent.trim())"
```
Then pick the option that best matches the testcase context.

## Output format
Always respond with a single executable playwright-cli command.
```

---

## 12. Environment & Dependencies

```json
{
  "runtime": "Node.js 20+",
  "electron": "^28.0.0",
  "dependencies": {
    "react": "^18",
    "playwright": "^1.40",
    "better-sqlite3": "^9",
    "exceljs": "^4",
    "xterm": "^5",
    "node-pty": "^1",
    "zustand": "^4",
    "tailwindcss": "^3"
  },
  "external_tools": {
    "gh_copilot_cli": "gh extension install github/gh-copilot",
    "playwright_browsers": "npx playwright install chromium"
  },
  "encryption": "Node.js built-in crypto — AES-256-GCM for credentials"
}
```

---

## 13. Key Constraints & Gotchas

- **Copilot CLI is spawned as a child process** — use `node-pty` not `child_process.exec` (pty required for interactive mode)
- **Playwright runs in main process** — not renderer, never cross IPC with large DOM payloads
- **SQLite is synchronous** — use `better-sqlite3` (sync API), wrap in try/catch everywhere
- **Flow IDs are semantic** (`helpdesk_create_ticket`) not UUIDs — makes debugging readable
- **Screenshots are stored in `userData/screenshots/`** — use `app.getPath('userData')` from Electron
- **Never store decrypted passwords in Zustand state** — decrypt only at execution time in main process
- **Odoo sessions expire** — detect redirect to `/web/login` and re-authenticate automatically

---

*This file is intended to be fed directly to an AI coding assistant. Keep it updated as the codebase evolves.*
