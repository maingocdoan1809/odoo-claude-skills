/**
 * scan-required-fields.js
 *
 * Scans the current Odoo 17 form page for required fields that are empty
 * or have failed validation (o_field_invalid).
 *
 * Usage with playwright-cli:
 *
 *   playwright-cli run-code "async page => {
 *     return await page.evaluate(() => { <paste minified version below> });
 *   }"
 *
 * Or use the run-code wrapper in required-fields-strategy.md for convenience.
 *
 * Returns: JSON string → array of FieldDescriptor objects
 *
 * FieldDescriptor {
 *   name:      string   — Odoo field name (e.g. "partner_id")
 *   label:     string   — Human-readable label from DOM
 *   type:      string   — "many2one" | "many2many" | "selection" | "boolean" |
 *                         "date" | "datetime" | "html" | "input"
 *   isEmpty:   boolean  — Field has no value filled
 *   isInvalid: boolean  — Field has .o_field_invalid (server or client validation)
 *   selector:  string   — CSS selector usable with playwright-cli snapshot
 * }
 */

// ─── FULL READABLE VERSION ────────────────────────────────────────────────────
// Used for documentation / reference. For playwright-cli, use the minified
// one-liner at the bottom of this file.

function scanRequiredFields() {
  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Resolve human-readable label for a widget. */
  function getLabel(widget, name) {
    // Strategy 1: find the actual interactive element's id → label[for=id]
    const input = widget.querySelector('input:not([type=hidden]), select, textarea');
    if (input && input.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (lbl) return lbl.textContent.trim();
    }

    // Strategy 2: climb to table row → find label cell (Odoo group layout).
    // In Odoo 17 groups, the label <td class="o_wrap_label"> is a sibling of the
    // widget <td>, not an ancestor — so we must climb to <tr> first.
    const rowEl = widget.closest('tr');
    if (rowEl) {
      const labelCell = rowEl.querySelector('td.o_wrap_label, td.o_td_label');
      if (labelCell) {
        const lbl = labelCell.querySelector('.o_form_label, label') || labelCell;
        return lbl.textContent.trim();
      }
    }

    // Strategy 3: settings pages have .o_setting_box containing both label and field
    const settingBox = widget.closest('.o_setting_box');
    if (settingBox) {
      const lbl = settingBox.querySelector('.o_form_label, label');
      if (lbl) return lbl.textContent.trim();
    }

    // Fallback: field name itself
    return name;
  }

  /**
   * Returns true if the widget is currently visible to the user.
   * Invisible modifier, hidden notebook tabs, and display:none are all "not visible".
   */
  function isVisible(el) {
    if (!el) return false;
    if (el.classList.contains('o_invisible_modifier')) return false;

    // Check CSS visibility (handles display:none / visibility:hidden)
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    // Widget inside an inactive notebook tab (Odoo Bootstrap tab-pane)
    const tabPane = el.closest('.tab-pane');
    if (tabPane && !tabPane.classList.contains('active')) return false;

    return true;
  }

  /** Returns true if the widget is effectively read-only. */
  function isReadonly(widget) {
    if (widget.classList.contains('o_readonly_modifier')) return true;
    if (widget.classList.contains('o_field_readonly')) return true;

    // No interactive element inside → rendered as plain text
    const interactive = widget.querySelector(
      'input:not([type=hidden]), select, textarea, [contenteditable="true"]'
    );
    if (!interactive) return true;

    if (interactive.readOnly || interactive.disabled) return true;
    return false;
  }

  /** Determine field type and whether it is empty. */
  function analyzeWidget(widget) {
    const cl = widget.classList;

    // Boolean: always has a value (true/false), never "empty"
    if (cl.contains('o_field_boolean')) {
      return { type: 'boolean', isEmpty: false };
    }

    // Priority: always has a default value ("0" = Normal), never DOM-empty.
    // If the server truly requires a non-default value, the post-save rescan
    // will catch it via o_field_invalid.
    if (cl.contains('o_field_priority')) {
      return { type: 'selection', isEmpty: false };
    }

    // Many2one / barcode many2one.
    // Use input.value as the "filled" signal — reliable across all many2one configs
    // including those with no_open set (where .o_external_button is hidden even when filled).
    // Note: if the AI typed text without selecting a record, the field value is still
    // considered "not empty" here; a post-save rescan will catch it via o_field_invalid.
    if (cl.contains('o_field_many2one') || cl.contains('o_field_many2one_barcode')) {
      const input = widget.querySelector('input');
      return { type: 'many2one', isEmpty: !(input && input.value.trim()) };
    }

    // Many2many tags
    if (cl.contains('o_field_many2many') || cl.contains('o_field_many2many_tags')) {
      const hasTags = widget.querySelectorAll('.badge, .o_tag, .o_selected_badge').length > 0;
      return { type: 'many2many', isEmpty: !hasTags };
    }

    // Selection (select element or radio buttons). Priority is handled separately above.
    if (cl.contains('o_field_selection')) {
      const sel = widget.querySelector('select');
      if (sel) {
        // Standard Odoo selection: empty = "" (empty string)
        // Many2one-as-select (e.g. o_field_x_selection_lazy): empty = "false" (the string "false")
        const isEmpty = !sel.value || sel.value === 'false';
        return { type: 'selection', isEmpty };
      }
      const checked = widget.querySelector('input[type=radio]:checked');
      return { type: 'selection', isEmpty: !checked };
    }

    // HTML rich text editor
    if (cl.contains('o_field_html')) {
      const editor = widget.querySelector('.odoo-editor-editable, [contenteditable="true"]');
      const html = editor ? editor.innerHTML.trim() : '';
      const empty = !html || html === '<br>' || html === '<p><br></p>' || html === '<p></p>';
      return { type: 'html', isEmpty: empty };
    }

    // Datetime (check before date — datetime widget also has o_field_date in some versions)
    if (cl.contains('o_field_datetime')) {
      const input = widget.querySelector('input');
      return { type: 'datetime', isEmpty: !(input && input.value.trim()) };
    }

    // Date
    if (cl.contains('o_field_date')) {
      const input = widget.querySelector('input');
      return { type: 'date', isEmpty: !(input && input.value.trim()) };
    }

    // Default: char, integer, float, text, monetary, phone, email, url
    const input = widget.querySelector('input:not([type=hidden]), textarea');
    return { type: 'input', isEmpty: !(input && input.value.trim()) };
  }

  // ── Main scan ─────────────────────────────────────────────────────────────

  const results = [];
  const seen = new Set();

  const candidates = document.querySelectorAll(
    '.o_field_widget.o_required_modifier, .o_field_widget.o_field_invalid'
  );

  candidates.forEach(widget => {
    const name = widget.getAttribute('name');
    if (!name || seen.has(name)) return;
    if (!isVisible(widget)) return;
    if (isReadonly(widget)) return;

    const { type, isEmpty } = analyzeWidget(widget);
    const isInvalid = widget.classList.contains('o_field_invalid');

    // Boolean is never empty; skip unless invalid
    if (type === 'boolean' && !isInvalid) return;

    // Only report if there is something actionable
    if (!isEmpty && !isInvalid) return;

    seen.add(name);
    results.push({
      name,
      label: getLabel(widget, name),
      type,
      isEmpty,
      isInvalid,
      selector: `.o_field_widget[name="${name}"]`,
    });
  });

  return JSON.stringify(results);
}

// ─── MINIFIED ONE-LINER ───────────────────────────────────────────────────────
// Paste this directly into playwright-cli run-code for inline usage.
// See required-fields-strategy.md for the full invocation pattern.

/*
(function(){const r=[],s=new Set();function L(w,n){const i=w.querySelector('input:not([type=hidden]),select,textarea');if(i&&i.id){const l=document.querySelector(`label[for="${CSS.escape(i.id)}"]`);if(l)return l.textContent.trim();}const tr=w.closest('tr');if(tr){const lc=tr.querySelector('td.o_wrap_label,td.o_td_label');if(lc){const l=lc.querySelector('.o_form_label,label')||lc;return l.textContent.trim();}}const sb=w.closest('.o_setting_box');if(sb){const l=sb.querySelector('.o_form_label,label');if(l)return l.textContent.trim();}return n;}function V(el){if(!el||el.classList.contains('o_invisible_modifier'))return false;const st=window.getComputedStyle(el);if(st.display==='none'||st.visibility==='hidden')return false;const tp=el.closest('.tab-pane');if(tp&&!tp.classList.contains('active'))return false;return true;}function R(w){if(w.classList.contains('o_readonly_modifier')||w.classList.contains('o_field_readonly'))return true;const i=w.querySelector('input:not([type=hidden]),select,textarea,[contenteditable="true"]');if(!i||i.readOnly||i.disabled)return true;return false;}function A(w){const cl=w.classList;if(cl.contains('o_field_boolean'))return{type:'boolean',isEmpty:false};if(cl.contains('o_field_priority'))return{type:'selection',isEmpty:false};if(cl.contains('o_field_many2one')||cl.contains('o_field_many2one_barcode')){const i=w.querySelector('input');return{type:'many2one',isEmpty:!(i&&i.value.trim())};}if(cl.contains('o_field_many2many')||cl.contains('o_field_many2many_tags'))return{type:'many2many',isEmpty:w.querySelectorAll('.badge,.o_tag,.o_selected_badge').length===0};if(cl.contains('o_field_selection')){const sl=w.querySelector('select');if(sl){const ev=sl.value;return{type:'selection',isEmpty:!ev||ev==='false';};}return{type:'selection',isEmpty:!w.querySelector('input[type=radio]:checked')};}if(cl.contains('o_field_html')){const ed=w.querySelector('.odoo-editor-editable,[contenteditable="true"]');const h=ed?ed.innerHTML.trim():'';return{type:'html',isEmpty:!h||h==='<br>'||h==='<p><br></p>'||h==='<p></p>'};}if(cl.contains('o_field_datetime')){const i=w.querySelector('input');return{type:'datetime',isEmpty:!(i&&i.value.trim())};}if(cl.contains('o_field_date')){const i=w.querySelector('input');return{type:'date',isEmpty:!(i&&i.value.trim())};}const i=w.querySelector('input:not([type=hidden]),textarea');return{type:'input',isEmpty:!(i&&i.value.trim())};}document.querySelectorAll('.o_field_widget.o_required_modifier,.o_field_widget.o_field_invalid').forEach(w=>{const n=w.getAttribute('name');if(!n||s.has(n))return;if(!V(w)||R(w))return;const{type,isEmpty}=A(w);const inv=w.classList.contains('o_field_invalid');if(type==='boolean'&&!inv)return;if(!isEmpty&&!inv)return;s.add(n);r.push({name:n,label:L(w,n),type,isEmpty,isInvalid:inv,selector:`.o_field_widget[name="${n}"]`});});return JSON.stringify(r);})()
*/
