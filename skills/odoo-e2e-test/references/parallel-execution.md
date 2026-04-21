# Parallel Execution & Dependency Management

**⚠️ CRITICAL: This section is ENFORCEMENT. Violating dependency rules will corrupt test data.**

For `background` mode, test cases execute in parallel with intelligent dependency awareness.

---

## Dependency Graph

Each test case MAY declare dependencies:

```json
{
  "id": "TC-002",
  "title": "Update ticket with new category",
  "dependencies": ["TC-001"],  // ← TC-001 must PASS before TC-002 starts
  "steps": [...]
}
```

Examples of valid dependencies:
- **TC-002 depends on TC-001**: "Create ticket" → "Edit ticket" workflow
- **TC-003 depends on TC-001, TC-002**: Multi-step workflow requiring prior setup
- **No dependencies**: Test case can run immediately in parallel with all others

---

## Execution Strategy

### Build the dependency graph:

```python
# Pseudocode — the main agent does this:

ready_group = []      # TCs with no dependencies
pending_group = {}    # TC -> list of parent TCs they depend on

for tc in test_cases:
    if not tc.dependencies:
        ready_group.append(tc)
    else:
        pending_group[tc.id] = tc.dependencies

# Execution rounds:
# Round 1: Launch all agents from ready_group in parallel
# Wait for all Round 1 agents to complete
# Check pending_group: which TCs are now ready (all parents PASS)?
# Round N: Launch next batch, repeat until all complete
```

---

## Launch agents in waves

### Wave 1: No dependencies

```
Launch agents for:  [TC-001, TC-003, TC-005]  (all in parallel)
Each agent:
  - Opens its own headless browser (no -s, no --headed)
  - Executes all steps from test-cases.json[TC-ID]
  - Writes result to ./test-runs/<RUN-ID>/<TC-ID>/result.json
  - Exits when done

Wait for all 3 agents to complete
```

### Check Round 1 results

For each TC that completed:
- If `status: "PASS"` → mark as available for dependent TCs
- If `status: "BUG" | "FAIL" | "SKIP"` → dependent TCs may still proceed (they can test alternative flows)

### Wave 2: Dependencies satisfied

```
Pending: [TC-002, TC-004, TC-006]
- TC-002 depends on [TC-001] → TC-001 completed ✓ → READY
- TC-004 depends on [TC-003] → TC-003 completed ✓ → READY
- TC-006 depends on [TC-005] → TC-005 completed ✓ → READY

Launch agents for: [TC-002, TC-004, TC-006]  (all in parallel)

Wait for all 3 agents to complete
```

### Repeat until all TCs finish

---

## Handling failed dependencies

If a TC depends on another TC that failed:

**Still proceed with the dependent TC:**
- The dependent TC may test error handling or alternative flows
- It documents that the primary flow is broken
- This is valuable data for QA

Example:
```json
{
  "id": "TC-004",
  "title": "Handle validation error when creating duplicate",
  "dependencies": ["TC-003"],  // TC-003 failed to create initial record
  "notes": "This TC documents expected error behavior even if TC-003 fails"
}
```

If you want a TC to **truly block** on parent failure:
- Add a check at the start of the TC execution:
  ```bash
  # If TC's parents all have status != "PASS", mark this TC as SKIP
  ```
- Update result.json: `status: "SKIP"`, reason: "Parent TC-003 did not pass"

---

## test-cases.json schema with dependencies

```json
[
  {
    "id": "TC-001",
    "title": "Create ticket",
    "module": "ticket",
    "action": "create",
    "steps": [...],
    "dependencies": []  // or omit if empty
  },
  {
    "id": "TC-002",
    "title": "Update ticket",
    "module": "ticket",
    "action": "update",
    "steps": [...],
    "dependencies": ["TC-001"]  // ← This TC waits for TC-001 to complete
  }
]
```

---

## Max parallel agents

For background mode, the number of parallel agents depends on system resources:

- **Typical safe limit**: 5-10 agents in parallel
- **Per agent resource**: ~300MB RAM (headless browser + Node.js)
- If your system has 16GB RAM, you can safely run ~15-20 agents in parallel

**Monitor and adjust:**
- If agents are timing out or failing mysteriously → reduce parallel count
- If system has spare capacity → increase parallel count (all agents run faster)

---

## Visible mode (no parallel)

Visible mode (`browserMode: "visible"`) **DOES NOT use parallel agents.**

- Single `--headed` browser window
- Sequential TC execution in the main agent
- User watches each step on screen
- No dependency tracking needed (implicit serial order)

---

## Tracking parallel execution

Main agent maintains a status board:

```
Wave 1: [TC-001 ✓ PASS, TC-003 ✓ PASS, TC-005 🐛 BUG]
Wave 2: [TC-002 ✓ PASS, TC-004 ⏱️ RUNNING, TC-006 ⏱️ RUNNING]
Wave 3: Waiting for Wave 2 to complete...
```

Print this board in the final report for visibility into execution order.
