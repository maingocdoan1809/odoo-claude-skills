/**
 * scan-page.js
 *
 * Page Inspector for Odoo 17 E2E tests.
 *
 * Scans the current page and returns a compact JSON summary with:
 *  - Available action buttons (with ready-to-use CSS/text selectors)
 *  - All visible form fields on the ACTIVE TAB ONLY (type, value, inputSelector)
 *  - Statusbar stages
 *  - Notebook tabs (plus which inactive tabs have unfilled required fields)
 *  - Open dialogs and their buttons
 *  - Page state: loading / dirty / editable
 *  - Validation errors (objects with name + selector)
 *  - Toast notifications
 *
 * USAGE (PowerShell):
 *   $scan = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-page-iife.js" -Raw
 *   playwright-cli -s=odoo-visible eval $scan        # visible mode
 *   playwright-cli eval $scan                         # background mode
 *
 * Returns: JSON string → PageSummary
 *
 * AI WORKFLOW:
 *   1. Call scan-page ONCE after every navigation / major action (save, workflow)
 *   2. Use actions[].selector to click buttons directly — no snapshot needed
 *   3. Use fields[].inputSelector to fill inputs directly — no snapshot needed
 *   4. Use scan-dropdown-iife.js for many2one dropdown items (after typing)
 *   5. Only fall back to playwright-cli snapshot for rare complex elements
 *
 * IMPORTANT:
 *   - Fields from INACTIVE tabs are NOT returned (they are not interactable).
 *     Check hiddenRequiredTabs to know if a tab switch + rescan is needed before Save.
 *   - Selectors are scoped to the active root (modal OR main page, not both).
 *   - one2many inline lists are excluded from fields[] (too complex; handle manually).
 */

// ─── Full readable version ────────────────────────────────────────────────────
// For playwright-cli, use scan-page-iife.js (IIFE, no backticks).

function scanPage() {

  // ── Helpers ──────────────────────────────────────────────────────────────

  function isLoading() {
    return !!document.querySelector('.o_loading, .o_loading_indicator');
  }

  function isDirty() {
    return !!document.querySelector('.o_form_view.o_form_dirty');
  }

  function isEditable() {
    const form = document.querySelector('.o_form_view');
    return form ? !form.classList.contains('o_form_readonly') : false;
  }

  function getActiveModal() {
    return document.querySelector('.modal.show, .o_dialog:not(.o_inactive_modal)') || null;
  }

  /**
   * Returns the best container to scope field queries to.
   * Prefers the active modal body; falls back to the main form/content area.
   */
  function getScope(modal) {
    if (modal) {
      return modal.querySelector('.modal-body, .o_dialog_container') || modal;
    }
    return (
      document.querySelector('.o_form_view') ||
      document.querySelector('.o_content, .o_action_manager') ||
      document
    );
  }

  function getLabel(widget, name) {
    const inp = widget.querySelector('input:not([type=hidden]), select, textarea');
    if (inp && inp.id) {
      const lbl = document.querySelector('label[for="' + CSS.escape(inp.id) + '"]');
      if (lbl) return lbl.textContent.trim();
    }
    const row = widget.closest('tr');
    if (row) {
      const lc = row.querySelector('td.o_wrap_label, td.o_td_label');
      if (lc) return ((lc.querySelector('.o_form_label, label') || lc)).textContent.trim();
    }
    const box = widget.closest('.o_setting_box');
    if (box) {
      const l = box.querySelector('.o_form_label, label');
      if (l) return l.textContent.trim();
    }
    return name;
  }

  function getFieldType(cl) {
    if (cl.contains('o_field_boolean')) return 'boolean';
    if (cl.contains('o_field_priority')) return 'selection';
    if (cl.contains('o_field_many2one') || cl.contains('o_field_many2one_barcode')) return 'many2one';
    if (cl.contains('o_field_many2many') || cl.contains('o_field_many2many_tags')) return 'many2many';
    if (cl.contains('o_field_selection')) return 'selection';
    if (cl.contains('o_field_html')) return 'html';
    if (cl.contains('o_field_datetime')) return 'datetime';  // ← check BEFORE o_field_date
    if (cl.contains('o_field_date')) return 'date';
    if (cl.contains('o_field_one2many')) return 'one2many';
    if (cl.contains('o_field_binary') || cl.contains('o_field_image')) return 'binary';
    return 'input';
  }

  /**
   * Returns the CSS selector for the interactable child element inside a field widget.
   * AI uses this selector directly with playwright-cli fill / click / check.
   */
  function getInputSelector(name, type) {
    const base = '.o_field_widget[name="' + name + '"]';
    switch (type) {
      case 'many2one':
      case 'many2many':   return 'css=' + base + ' input';
      case 'selection':   return 'css=' + base + ' select';
      case 'boolean':     return 'css=' + base + ' input[type="checkbox"]';
      case 'html':        return 'css=' + base + ' .odoo-editor-editable';
      case 'date':
      case 'datetime':    return 'css=' + base + ' input';
      default:            return 'css=' + base + ' input:not([type=hidden])';
    }
  }

  function getFieldValue(widget, type, readonly) {
    if (readonly) {
      return widget.textContent.replace(/\s+/g, ' ').trim().substring(0, 100);
    }
    switch (type) {
      case 'many2one': {
        const i = widget.querySelector('input');
        return i ? i.value.trim() : '';
      }
      case 'many2many': {
        return Array.from(widget.querySelectorAll('.badge, .o_tag, .o_selected_badge'))
          .map(t => t.textContent.trim()).join(', ');
      }
      case 'selection': {
        const s = widget.querySelector('select');
        if (s && s.selectedIndex >= 0) return (s.options[s.selectedIndex] || {}).text || '';
        const r = widget.querySelector('input[type=radio]:checked');
        return r ? (r.closest('label') || r).textContent.trim() : '';
      }
      case 'html': {
        const ed = widget.querySelector('.odoo-editor-editable, [contenteditable="true"]');
        if (!ed) return '';
        const html = ed.innerHTML.trim();
        if (!html || html === '<br>' || html === '<p><br></p>' || html === '<p></p>') return '';
        return ed.textContent.trim().substring(0, 80);
      }
      case 'boolean': {
        const cb = widget.querySelector('input[type="checkbox"]');
        return cb ? String(cb.checked) : 'false';
      }
      case 'one2many':
      case 'binary':
        return '(complex)';
      default: {
        const i = widget.querySelector('input:not([type=hidden]), textarea');
        return i ? i.value.trim() : '';
      }
    }
  }

  function isFieldVisible(el) {
    if (!el) return false;
    if (el.classList.contains('o_invisible_modifier')) return false;
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const tabPane = el.closest('.tab-pane');
    if (tabPane && !tabPane.classList.contains('active')) return false;
    return true;
  }

  function isReadonly(widget) {
    if (widget.classList.contains('o_readonly_modifier') ||
        widget.classList.contains('o_field_readonly')) return true;
    const i = widget.querySelector(
      'input:not([type=hidden]), select, textarea, [contenteditable="true"]'
    );
    if (!i) return true;
    if (i.readOnly || i.disabled) return true;
    return false;
  }

  // ── Build result ──────────────────────────────────────────────────────────

  const result = {
    url: location.href,
    title: document.title,
  };

  const modal = getActiveModal();
  result.root = modal ? 'modal' : 'main';

  // Page state flags
  if (isLoading()) result.loading = true;
  if (isDirty()) result.dirty = true;

  // View mode
  if (document.querySelector('.o_form_view')) {
    result.view = 'form';
    result.editable = isEditable();
  } else if (document.querySelector('.o_list_view')) {
    result.view = 'list';
  } else if (document.querySelector('.o_kanban_view')) {
    result.view = 'kanban';
  } else {
    result.view = 'other';
  }

  // Breadcrumbs
  result.breadcrumbs = Array.from(
    document.querySelectorAll('.o_breadcrumb .breadcrumb-item, .o_breadcrumb .o_back_button')
  ).map(el => el.textContent.trim()).filter(Boolean);

  // Status bar
  const sb = document.querySelector('.o_statusbar_status');
  if (sb) {
    result.statusbar = {
      current: (document.querySelector('.o_arrow_button_current') || { textContent: '' }).textContent.trim(),
      stages: Array.from(sb.querySelectorAll('button')).map(b => {
        const lbl = b.textContent.trim();
        return {
          label: lbl,
          current: b.classList.contains('o_arrow_button_current'),
          selector: 'text=' + lbl,
        };
      }),
    };
  }

  // Action buttons (control panel + form header + statusbar action buttons)
  const actionSeen = new Set();
  result.actions = [];
  document.querySelectorAll(
    '.o_cp_buttons button, .o_form_buttons_view button, .o_statusbar_buttons button'
  ).forEach(btn => {
    const text = btn.textContent.trim();
    if (!text || btn.disabled || !btn.offsetParent || actionSeen.has(text)) return;
    actionSeen.add(text);
    const name = btn.getAttribute('name');
    result.actions.push({
      label: text,
      selector: name ? 'css=button[name="' + name + '"]' : 'text=' + text,
      primary: btn.classList.contains('btn-primary'),
    });
  });

  // Notebook tabs
  result.tabs = Array.from(
    document.querySelectorAll('.o_notebook .nav-link')
  ).map(t => {
    const lbl = t.textContent.trim();
    return { label: lbl, active: t.classList.contains('active'), selector: 'text=' + lbl };
  });

  // Inactive tabs that contain unfilled required fields (warning for pre-save check)
  const hiddenRequiredTabs = [];
  document.querySelectorAll('.o_notebook .tab-pane:not(.active)').forEach(pane => {
    const hasEmpty = Array.from(
      pane.querySelectorAll('.o_field_widget.o_required_modifier')
    ).some(w => {
      if (w.classList.contains('o_invisible_modifier') ||
          w.classList.contains('o_readonly_modifier')) return false;
      const inp = w.querySelector('input:not([type=hidden]), select, textarea');
      return inp && !inp.value.trim();
    });
    if (!hasEmpty) return;
    const paneId = pane.id;
    const navLink = document.querySelector(
      '.o_notebook .nav-link[data-bs-target="#' + paneId + '"],' +
      '.o_notebook .nav-link[href="#' + paneId + '"]'
    );
    hiddenRequiredTabs.push(navLink ? navLink.textContent.trim() : paneId);
  });
  if (hiddenRequiredTabs.length > 0) result.hiddenRequiredTabs = hiddenRequiredTabs;

  // Form fields — ACTIVE TAB ONLY, scoped to the active root container
  if (result.view === 'form' || result.root === 'modal') {
    const scope = getScope(modal);
    const fieldsSeen = new Set();
    result.fields = [];

    scope.querySelectorAll('.o_field_widget').forEach(widget => {
      const name = widget.getAttribute('name');
      if (!name || fieldsSeen.has(name)) return;
      if (!isFieldVisible(widget)) return;

      const type = getFieldType(widget.classList);
      if (type === 'one2many') return; // handled separately if needed

      fieldsSeen.add(name);

      const ro = isReadonly(widget);
      const value = getFieldValue(widget, type, ro);
      const label = getLabel(widget, name);

      const field = {
        name,
        label,
        type,
        selector: 'css=.o_field_widget[name="' + name + '"]',
      };
      if (!ro) field.inputSelector = getInputSelector(name, type);
      if (value) field.value = value;
      if (widget.classList.contains('o_required_modifier')) field.required = true;
      if (ro) field.readonly = true;
      if (widget.classList.contains('o_field_invalid')) field.invalid = true;

      result.fields.push(field);
    });
  }

  // List view summary
  if (result.view === 'list') {
    result.list = {
      columns: Array.from(document.querySelectorAll('.o_list_view thead th'))
        .map(h => h.textContent.trim()).filter(Boolean),
      rowCount: document.querySelectorAll('.o_list_view tbody tr.o_data_row').length,
      hasPager: !!document.querySelector('.o_pager'),
    };
  }

  // Open dialogs and their buttons
  result.dialogs = Array.from(
    document.querySelectorAll('.modal.show, .o_dialog:not(.o_inactive_modal)')
  ).map(d => ({
    title: (d.querySelector('.modal-title, .o_dialog_title') || { textContent: '' }).textContent.trim() || 'Dialog',
    buttons: Array.from(
      d.querySelectorAll('footer button, .modal-footer button')
    ).map(b => {
      const lbl = b.textContent.trim();
      return { label: lbl, selector: 'text=' + lbl, primary: b.classList.contains('btn-primary') };
    }),
  }));

  // Toast notifications
  result.notifications = Array.from(document.querySelectorAll('.o_notification')).map(n => ({
    type: n.classList.contains('o_notification_danger') ? 'error' :
          n.classList.contains('o_notification_warning') ? 'warning' : 'success',
    message: (n.querySelector('.o_notification_content') || n).textContent.trim().substring(0, 150),
  }));

  // Validation errors (objects with name + selector)
  const invalidWidgets = Array.from(document.querySelectorAll('.o_field_invalid'));
  if (invalidWidgets.length > 0) {
    result.validationErrors = invalidWidgets.map(w => {
      const n = w.getAttribute('name') || '?';
      return { name: n, selector: 'css=.o_field_invalid[name="' + n + '"]' };
    });
  }

  return JSON.stringify(result);
}
