# Troubleshooting

**⚠️ CRITICAL: Read the CRITICAL ENFORCEMENT RULES in SKILL.md FIRST before troubleshooting.**

Quick fixes for common issues encountered during Odoo E2E testing.

---

## Browser not visible / no window appears

**Cause**: `playwright-cli open` runs **headless by default** — no browser window is shown.

**Fix**: Always add `--headed` when running in `visible` mode:

```bash
# ✅ Correct — user sees browser window
playwright-cli -s=odoo-visible open --headed "http://172.20.108.223/web/login"

# ❌ Wrong — browser runs invisibly even though user expects to see it
playwright-cli -s=odoo-visible open "http://172.20.108.223/web/login"
```

**Rule of thumb:**
- `visible` mode → always `--headed`
- `background` mode / parallel agents → no `--headed` (headless is fine)

---

## Record type select disappears after first selection

**Cause**: Odoo replaces the entire form when a record type is chosen.
**Fix**: Always go to a fresh form (list → 新規) before selecting a different record type.

```bash
playwright-cli goto "<LIST_URL>"
playwright-cli click "getByRole('button', { name: '新規' })"
playwright-cli snapshot --depth=3
```

---

## Blocking "Unsaved changes" modal on navigation

**Fix**:
```bash
playwright-cli press Escape
playwright-cli snapshot --depth=2
# If 破棄 button visible:
playwright-cli click "getByRole('button', { name: '破棄' })"
```

---

## Many2one shows no dropdown after typing

**Possible causes:**
1. Used `fill` instead of `type` — always use `playwright-cli type`
2. Value has no match in the database — use a shorter prefix to test
3. Field is filtered by another field's value — fill the parent field first

---

## Select option not found

Check exact option labels:
```bash
playwright-cli eval "[...document.querySelector('.o_field_widget[name=<field>] select').options].map(o=>o.text)"
```
Use the exact label (including Japanese characters) in the test case JSON.

---

## Datepicker stays open blocking next field

**Fix**: Always press Escape after filling date/datetime fields.
```bash
playwright-cli fill <date-ref> "2026/04/21"
playwright-cli press Escape
```

---

## Cannot connect to Chrome (ECONNREFUSED :9222)

```powershell
# Start Chrome with debug port
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222","--user-data-dir=C:\Temp\chrome-debug-profile"
```

If port is already in use:
```powershell
netstat -ano | findstr :9222
Stop-Process -Id <PID>
```

---

## Session expired mid-test

**Symptom**: Page redirects to login during test execution.
**Self-healing action**: Re-login and retry (see self-healing Rule 4).

---

## Mail compose shows "受信者が見つかりません"

**Fix**: Type the email address and press Enter to commit it as a tag.
```bash
playwright-cli click <to-field-ref>
playwright-cli type "user@example.com"
playwright-cli press Enter
```

---

## 承認申請 dialog instead of direct send

This is an approval workflow dialog, not a bug. Two options:
1. Fill the approval form (コメント + 次の承認者) and submit
2. If direct send is needed, look for a "送信" button separate from "承認申請"

---

## Field not visible (inside a tab)

**Cause**: The field is inside a tab that hasn't been activated.
**Fix**: Find and click the tab before accessing those fields.
```bash
playwright-cli snapshot --depth=4
# Find the tab ref, e.g.:
playwright-cli click "getByRole('tab', { name: '詳細情報' })"
playwright-cli snapshot "css=.o_field_widget[name=<field>]"
```

---

## Save fails with validation errors on fields that were filled

This is a **BUG**. Check:
1. Was the value actually committed? (Many2one requires clicking the dropdown item)
2. Does the field have a dependency on another field that wasn't set?
3. Is the field marked as required only under certain conditions?

Report as BUG with `severity: high` and include the list of invalid fields.

---

## HTML report doesn't show screenshots

**Cause**: Screenshot paths in result.json use absolute paths instead of relative.
**Fix**: Always store screenshot paths relative to the TC folder:
```
"screenshot": "screenshots/05-save.png"   ✓
"screenshot": "C:\Users\...\screenshots\05-save.png"  ✗
```
