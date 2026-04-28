# Enforcement Guidelines for odoo-e2e-test Skill

**Purpose:** Ensure AI agents strictly follow all rules when using this skill.

---

## How Enforcement Works

This skill contains **11 CRITICAL RULES** (in SKILL.md). When an agent violates any rule:

1. ⚠️ The violation is logged with timestamp
2. 🛑 The current step is BLOCKED
3. 📋 Agent must read the rule and explain why compliance failed
4. ✅ Agent must take corrective action before proceeding

---

## Rule Enforcement Matrix

| Rule # | Rule Name | Violation Detection | Consequence | Remedy |
|---|---|---|---|---|
| 1 | No hardcoded credentials | Password found in code, logs, or config files | Test FAIL; credentials exposed | Remove hardcoding; use ask_user only |
| 2 | Ask Q1-Q7 first | Browser started before ask_user Q1 | Test ABORT | Re-ask questions; restart |
| 3 | Create folder structure | Accessing test-runs/ before running Step 2 | Cannot write test output | Create ./test-runs/<RUN-ID>/ first |
| 4 | Wait for test-cases.json | Executing tests before file exists | No TCs to run; agents hang | Wait for Step 3 agent to complete |
| 5 | Correct session prefix | Using -s=odoo in background (or vice versa) | Browser conflict; test hangs | Use -s=odoo-visible (visible) or no -s (background) |
| 6 | Respect dependencies | Launching TC-002 before TC-001 completes | Data corruption; false failures | Build dependency graph; launch in waves |
| 7 | Write result.json | Moving to next TC without result.json | Missing test audit trail | Write ./test-runs/<RUN-ID>/<TC-ID>/result.json |
| 8 | Screenshot every step | Skipping screenshots on "simple" steps | No visual proof of execution | Screenshot after EVERY step (01-login.png, 02-navigate.png, etc.) |
| 9 | Never auto-send email | Sending email without test case instruction | Unintended emails to real users | Only send if test case explicitly has send-email step |
| 10 | Flow is example only | Executing baseline flow without per-TC adaptation | Wrong path/false failures | Always create `flow.adapted.json` and execute via runner/step engine |
| 11 | Log selector repair artifacts | Selector changed without `failed-steps`/patch log | No audit trail/reuse | Persist `failed-steps.json`, `selector-repair.patch.json`, `flow.repaired.json`, `healing-log.json` |

---

## Pre-Flight Validation Checklist

**Every agent MUST check these 11 items before starting any test execution:**

```
[PRE-FLIGHT VALIDATION]
✓ Q1-Q7 answered and stored in run-config.json
✓ run-config.json has masked password (not plaintext)
✓ run-config.json has reportFormat set (html|md|txt|all)
✓ ./test-runs/<RUN-ID>/ folder + run-config.json created
✓ test-cases.json exists with valid TC array
✓ Each TC has dependencies field (empty [] or populated)
✓ playwright-cli skill loaded (skill("playwright-cli"))
✓ browserMode is either "visible" or "background"
✓ email send actions are explicit in testcase steps
✓ flow source resolved and `flow.adapted.json` generated for current testcase
✓ selector-repair artifact paths prepared

[BLOCKING GATES]
✗ If browserMode=="visible" but test-cases.json has >1 TC → WARN user (sequential, will take time)
✗ If any email step without send-email action → SKIP (don't send)
✗ If TC dependencies form a cycle → ABORT (impossible to schedule)
✗ If test-cases.json malformed → ABORT (contact user)
✗ If flow/patch are passed as long inline JSON while files exist → WARN and switch to `--steps-file` / `--patch-file`

[EXECUTION CAN START ONLY AFTER ALL CHECKS PASS]
```

---

## Step-by-Step Enforcement

### Step 1: Runtime Config Gathering

**Validation:**
```
ask_user question 1 → Validate URL format (starts with http://)
ask_user question 2 → Validate username format (email or string)
ask_user question 3 → Validate password entered (non-empty)
ask_user question 4 → Validate file path exists (if provided) OR accept verbal description
ask_user question 5 → Validate browserMode is "Visible" or "Background"
ask_user question 6 → Accept freeform notes (can be empty)
ask_user question 7 → Validate reportFormat is one of: html | md | txt | all (default: html)
```

**Enforcement:**
```
If any answer is invalid:
  ⚠️ Warn user with specific error
  🔄 Re-ask that question ONLY
  Repeat until valid answer received

If user cancels (3 invalid attempts):
  🛑 ABORT: User cannot provide required input
```

---

### Step 2: Run ID & Folder Creation

**Validation:**
```
Run ID format: RUN-YYYYMMDD-HHMMSS-<screen-slug>
  ✓ Must match pattern: RUN-[8 digits]-[6 digits]-[slug]
  ✓ Date segment must be valid (not 20261332)
  ✓ Time segment must be valid (not 256199)
  ✓ Screen slug ≤40 chars, kebab-case only (may contain multiple hyphens)

Folder creation:
  ✓ ./test-runs/ exists (create if not)
  ✓ ./test-runs/<RUN-ID>/ created fresh (no overwrite)
  ✓ run-config.json written with masked password
```

**Enforcement:**
```
If Run ID invalid:
  ❌ FAIL: Run ID format violation
  📝 Generate new valid Run ID (agent decides screen-slug)

If folder cannot be created:
  ❌ FAIL: Permission error or invalid path
  📋 Report to user; ask for alternate path (if allowed)
```

---

### Step 3: Parse Test Cases

**Validation:**
```
test-cases.json schema:
  ✓ Root is array []
  ✓ Each TC has: id, title, module, action, steps, expectedResults
  ✓ Each TC id is sequential: TC-001, TC-002, ...
  ✓ Each step has: step (number), description, action, (+ action-specific fields)
  ✓ dependencies field present (even if empty [])
  
Dependency graph:
  ✓ No cycles (TC-001 → TC-002 → TC-001 is INVALID)
  ✓ All referenced dependencies exist (no dangling refs)
  ✓ No duplicate TC ids
```

**Enforcement:**
```
If parsing agent returns invalid JSON:
  ❌ ABORT: Malformed test-cases.json
  🛠️ Request agent re-parse with error details
  
If dependencies have cycles:
  ❌ BLOCK: Cannot schedule TC execution
  📋 Report cycle to user (e.g., "TC-001 → TC-002 → TC-001")
  
If TCs reference missing dependencies:
  ⚠️ WARN: TC-005 depends on TC-999 (doesn't exist)
  🛑 SKIP TC-005 with reason
```

---

### Step 4: Execute Test Cases (Visible Mode)

**Validation:**
```
Before launching browser:
  ✓ Only ONE browser window opened
  ✓ TCs will run sequentially (in order)
  ✓ MUST include --headed in open command → ❌ VIOLATION if missing (browser invisible)
  ✓ MUST use -s=odoo-visible in ALL commands → ❌ VIOLATION if absent or different

During execution:
  ✓ Screenshot after EVERY step (not just failures)
  ✓ result.json written to ./test-runs/<RUN-ID>/<TC-ID>/result.json
  ✓ Password NEVER appears in screenshots or logs
```

**Enforcement:**
```
If --headed missing from open command:
  🛑 BLOCK: Browser will be invisible to user
  ⚠️ Command must be: playwright-cli -s=odoo-visible open --headed "<URL>"
  
If using -s=odoo instead of -s=odoo-visible:
  ⚠️ WARN: Session name incorrect (minor issue, not blocking)
  🔧 Correct to -s=odoo-visible for consistency
  
If screenshot missing after step:
  ❌ BLOCK: Audit trail incomplete
  📸 Take screenshot before moving to next step
  
If result.json not written:
  ❌ BLOCK: Test results lost
  📝 Write result.json to specified path immediately
```

---

### Step 4: Execute Test Cases (Background Mode)

**Validation:**
```
Dependency graph:
  ✓ Identify all TCs with no dependencies → Wave 1
  ✓ Identify TCs whose dependencies all have results → Wave N
  ✓ No cycles detected
  ✓ No missing dependencies

Session management:
  ✓ NO -s flag (each agent uses anonymous session)
  ✓ NO --headed flag (headless for parallel safety)
  ✓ Each agent gets isolated browser instance
  
Parallelization:
  ✓ Max 5-10 agents per wave (adjust per system resources)
  ✓ Wait for ALL agents in wave to complete before launching next wave
  ✓ If parent TC fails, dependent TC can still launch (it documents alternative flows)
```

**Enforcement:**
```
If using -s flag in background mode:
  ❌ BLOCK: Agents will conflict on shared session
  ❌ Command violation: No -s flag allowed
  
If using --headed in background mode:
  ❌ BLOCK: Defeats parallelization purpose
  ❌ Command violation: NO --headed flag
  
If launching TC-002 without TC-001 completing:
  ❌ BLOCK: Dependency violation
  🛑 Wait for TC-001 result.json to exist first
  
If result.json not written after TC completes:
  ❌ BLOCK: Status unknown
  📝 Agent must write result.json before exiting
  
If agent doesn't respect timeout:
  ⏱️ WARN: Agent running >30min (likely hung)
  🛑 Terminate agent; mark TC as FAIL/TIMEOUT
```

---

## Email Safety Enforcement

**Critical for preventing unwanted email sends:**

```
[EMAIL SENDING RULES - NON-NEGOTIABLE]

Before any send-email step:
  1. Check test-cases.json for send-email action in that TC's steps[]
  2. Verify "to" field is explicitly provided in test case
  3. Check "to" address is safe (test@, localhost, or user-confirmed)
  4. Log what email will be sent to where (for audit)

During send-email:
  5. Do NOT auto-fill "to" address from system/previous TC
  6. Do NOT guess domain names (@example.com)
  7. Do NOT send to real user emails without explicit test case instruction
  8. Take screenshot showing full email before click Send

After send:
  9. Verify toast message shows "Email sent" (or similar)
  10. Log email destination in result.json

[VIOLATIONS - ALL BLOCKING]
❌ Sending without test case instruction → BLOCK step
❌ Sending to unconfirmed address → BLOCK step
❌ Auto-sending as cleanup → BLOCK step
```

---

## Violation Response Flowchart

```
Agent attempts action
  │
  ├─ Action violates CRITICAL RULE 1-11?
  │  ├─ YES → 🛑 BLOCK action immediately
  │  │         Log rule number + violation details
  │  │         Show rule text to agent
  │  │         Wait for agent to acknowledge + fix
  │  │
  │  └─ NO → ✅ Action allowed
  │          Log action with timestamp
  │          Continue execution
  │
Agent completes step
  │
  ├─ Required output (result.json, screenshot) exists?
  │  ├─ NO → ⚠️ WARN + create placeholder + continue
  │  └─ YES → ✅ Continue to next step
  │
Agent completes TC
  │
  ├─ result.json written with status (PASS/FAIL/BUG/SKIP)?
  │  ├─ NO → ❌ FAIL TC (audit trail broken)
  │  └─ YES → ✅ TC complete, move to next
  │
All TCs done
  │
  ├─ All result.json files exist + valid?
  │  ├─ NO → ⚠️ WARN — report generator handles missing files gracefully, still run it
  │  └─ YES → ✅ Run report generator script
  │
Report generation
  │
  python "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\generate-report.py" <run-dir> --format <reportFormat>
  │
  ├─ Exit code 0 → ✅ Report ready; tell user path
  ├─ Exit code 2 → ⚠️ Partial (warnings); report still usable; show warnings to user
  └─ Exit code 1 → ❌ Critical error; check stderr; fix path/config and retry
```

---

## Testing the Enforcement

**To verify enforcement is working:**

1. **Test Rule Violation:** Intentionally omit --headed in visible mode
   - Expected: Agent notices, blocks browser open, re-reads rule
   
2. **Test Dependency Blocking:** Try to launch TC-002 before TC-001 completes
   - Expected: Agent blocks; logs "TC-001 not complete"
   
3. **Test Email Safety:** Try to send email without test case defining it
   - Expected: Agent skips step; logs "No send-email instruction"

4. **Test Password Masking:** Try to log password from run-config.json
   - Expected: Password is "***" in output; full password NOT logged

---

## Escalation Path

If agent violates rule and doesn't correct after warning:

1. **First violation:** ⚠️ Warn, show rule, request fix
2. **Second violation:** ⚠️⚠️ Warn again, more emphatic language
3. **Third violation:** 🛑 ABORT test run, report to user

For **critical violations** (email to real user, password leak):
- Immediate ABORT regardless of count
- Report with full context to user
- Do NOT attempt to recover

---

## Summary for Agents

**When using this skill, ALWAYS:**

1. ✅ Read CRITICAL ENFORCEMENT RULES first (SKILL.md § "🚫 CRITICAL ENFORCEMENT RULES")
2. ✅ Run pre-flight checklist before executing anything
3. ✅ Ask Q1-Q7 (including report format) before any browser action
4. ✅ Respect all 11 rules (no exceptions)
5. ✅ Ask for clarification if a rule conflicts with user request
6. ✅ Log every rule check + result
7. ✅ BLOCK instead of proceed if uncertain
8. ✅ Execute `flow.adapted.json` with stable runner/step engine (no mandatory generated.spec.js)
9. ✅ Prefer `--steps-file` / `--patch-file` over inline JSON for flow operations
10. ✅ Run `generate-report.py` in Step 5 — do NOT manually write HTML/MD/TXT

**Key phrase to remember:** "Better to block once than allow one bad action."
