# Odoo Widget Filling Guide

Use `playwright-cli` commands to fill each Odoo widget type.

## Detection approach

Take a snapshot of the field widget container first:
```bash
playwright-cli snapshot "css=.o_field_widget[name=<fieldName>]"
```

Look at the element classes to determine widget type, then follow the matching strategy below.

---

## Boolean (checkbox)

**Classes**: `o_field_boolean`, `o_checkbox`

```bash
# Check current state
playwright-cli eval "document.querySelector('.o_field_widget[name=<field>] input[type=checkbox]').checked"

# To set TRUE (check):
playwright-cli check "css=.o_field_widget[name=<field>] input[type=checkbox]"

# To set FALSE (uncheck):
playwright-cli uncheck "css=.o_field_widget[name=<field>] input[type=checkbox]"
```

---

## Many2one (autocomplete)

**Classes**: `o_field_many2one`

```bash
# 1. Snapshot to get the input ref
playwright-cli snapshot "css=.o_field_widget[name=<field>]"

# 2. Click the input field (ref from snapshot)
playwright-cli click <input-ref>

# 3. Type the search value (CRITICAL: use 'type' not 'fill')
playwright-cli type "<search-value>"

# 4. Snapshot to see dropdown
playwright-cli snapshot --depth=3

# 5. Click the matching dropdown item
playwright-cli click <dropdown-item-ref>
```

**Why `type` and not `fill`**: `fill` bypasses keyboard events; Odoo's autocomplete requires
`keydown`/`input` events to trigger the search query.

---

## Many2many (tags)

**Classes**: `o_field_many2many`

Same as Many2one. Each call adds one tag. Repeat for multiple tags:
```bash
playwright-cli click <tag-input-ref>
playwright-cli type "Tag1"
playwright-cli click <dropdown-item-ref>
playwright-cli click <tag-input-ref>
playwright-cli type "Tag2"
playwright-cli click <dropdown-item-ref>
```

---

## HTML Rich Text Editor

**Classes**: `o_field_html`

```bash
# Snapshot to find the contenteditable element
playwright-cli snapshot "css=.o_field_widget[name=<field>]"

# Click it to focus
playwright-cli click <editor-ref>

# Select all existing content and replace
playwright-cli press "Control+a"
playwright-cli type "<your text here>"
```

---

## Select (dropdown)

**HTML element**: `<select>` inside the widget

```bash
# Snapshot to get select ref
playwright-cli snapshot "css=.o_field_widget[name=<field>]"

# Select by visible label text
playwright-cli select <select-ref> "<option label>"
```

If the exact label fails, check available options:
```bash
playwright-cli eval "[...document.querySelector('.o_field_widget[name=<field>] select').options].map(o => o.text)"
```

---

## Plain input / Char / Integer / Float

**HTML element**: `<input type="text|number">` inside the widget

```bash
playwright-cli snapshot "css=.o_field_widget[name=<field>]"
playwright-cli fill <input-ref> "<value>"
playwright-cli press Escape
```

---

## Date field

**HTML element**: `<input>` that opens a datepicker on focus

```bash
playwright-cli fill <input-ref> "2026/04/21"
playwright-cli press Escape   # IMPORTANT: close datepicker
```

---

## Datetime field

```bash
playwright-cli fill <input-ref> "2026/04/21 09:00"
playwright-cli press Escape
```

---

## Textarea (long text)

```bash
playwright-cli snapshot "css=.o_field_widget[name=<field>]"
playwright-cli fill <textarea-ref> "<multiline text>"
```

---

## Readonly fields (don't try to fill)

If a field renders as `<span>` with no `<input>` or `<select>`, it's readonly.
To verify its value:
```bash
playwright-cli eval "document.querySelector('.o_field_widget[name=<field>]')?.textContent?.trim()"
```

---

## Timing rules

| After action | Why | How |
|---|---|---|
| Select record type | Form re-renders entirely | Snapshot again before filling |
| Fill a select field | Dependent fields may change | Wait ~400ms (happens automatically between playwright-cli commands) |
| Many2one selection | Related fields may load data | Take fresh snapshot before next field |
| Open a new form | Page load + Odoo render | Snapshot should show stable state |

playwright-cli commands execute sequentially with built-in waits, so explicit waits are
rarely needed. If a field isn't found after record type selection, just take a new snapshot first.
