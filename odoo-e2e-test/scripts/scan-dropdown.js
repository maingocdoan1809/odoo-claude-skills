/**
 * scan-dropdown.js
 *
 * Scans the currently open many2one autocomplete dropdown in Odoo 17.
 *
 * Call this AFTER:
 *   1. playwright-cli click <many2one input selector>
 *   2. playwright-cli type "<search value>"
 *   3. playwright-cli eval $scanDropdown
 *
 * Returns compact JSON with dropdown items and their text selectors.
 * AI picks the matching item label and uses "text=<label>" to click it.
 *
 * USAGE (PowerShell):
 *   $scanDropdown = Get-Content "$env:USERPROFILE\.agents\skills\odoo-e2e-test\scripts\scan-dropdown-iife.js" -Raw
 *   playwright-cli -s=odoo-visible eval $scanDropdown
 *
 * Returns: JSON string → DropdownSummary
 *
 * {
 *   "open": true,
 *   "items": [
 *     { "label": "Azure Interior", "selector": "text=Azure Interior" },
 *     { "label": "Basic / Furniture", "selector": "text=Basic / Furniture" }
 *   ],
 *   "createOption": { "label": "Create and edit...", "selector": "css=.o_m2o_dropdown_option_create_edit" },
 *   "searchMore": { "label": "Search More...", "selector": "css=.o_m2o_dropdown_option_search_more" }
 * }
 *
 * If no dropdown is open:
 * { "open": false, "items": [] }
 */

function scanDropdown() {
  const dropdown = document.querySelector(
    '.o-autocomplete--dropdown-menu.show, ' +
    '.o-autocomplete--dropdown-menu[style*="display: block"], ' +
    '.ui-autocomplete:not([style*="display: none"])'
  );

  if (!dropdown) {
    return JSON.stringify({ open: false, items: [] });
  }

  const items = [];

  Array.from(dropdown.querySelectorAll('li.o-autocomplete--dropdown-item')).forEach(li => {
    const label = li.textContent.trim();
    if (!label) return;

    // Skip special option items — they are returned separately
    const isSpecial = (
      li.classList.contains('o_m2o_dropdown_option_create') ||
      li.classList.contains('o_m2o_dropdown_option_create_edit') ||
      li.classList.contains('o_m2o_dropdown_option_search_more')
    );
    if (isSpecial) return;

    items.push({ label, selector: 'text=' + label });
  });

  const result = { open: true, items };

  const create = dropdown.querySelector(
    '.o_m2o_dropdown_option_create, .o_m2o_dropdown_option_create_edit'
  );
  if (create) {
    result.createOption = {
      label: create.textContent.trim(),
      selector: 'css=.o_m2o_dropdown_option_create_edit, css=.o_m2o_dropdown_option_create',
    };
  }

  const more = dropdown.querySelector('.o_m2o_dropdown_option_search_more');
  if (more) {
    result.searchMore = {
      label: more.textContent.trim(),
      selector: 'css=.o_m2o_dropdown_option_search_more',
    };
  }

  return JSON.stringify(result);
}
