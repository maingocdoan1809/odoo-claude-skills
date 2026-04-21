# HTML Dashboard Template

Generate a **single self-contained HTML file** (`report.html`) with no external dependencies (all CSS/JS inline).

---

## Generation logic

After all test cases complete, read all `result.json` files and produce the dashboard using this template.
Replace all `{{PLACEHOLDERS}}` with real data.

---

## Full HTML template

```html
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Test Report — {{RUN_ID}}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #1a1a2e; }

  /* Header */
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 24px 32px; }
  .header h1 { font-size: 22px; font-weight: 600; letter-spacing: 0.5px; }
  .header .meta { font-size: 13px; opacity: 0.65; margin-top: 4px; }

  /* Cards */
  .cards { display: flex; gap: 16px; padding: 24px 32px 0; flex-wrap: wrap; }
  .card { flex: 1; min-width: 160px; background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .card .num { font-size: 36px; font-weight: 700; line-height: 1; }
  .card .label { font-size: 13px; color: #666; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card.total .num  { color: #1a1a2e; }
  .card.pass  .num  { color: #22c55e; }
  .card.bug   .num  { color: #ef4444; }
  .card.fail  .num  { color: #f97316; }
  .card.skip  .num  { color: #94a3b8; }

  /* Progress bar */
  .progress-bar { margin: 20px 32px 0; height: 8px; border-radius: 8px; background: #e2e8f0; overflow: hidden; display: flex; }
  .progress-bar .seg { height: 100%; transition: width .3s; }
  .seg-pass { background: #22c55e; }
  .seg-bug  { background: #ef4444; }
  .seg-fail { background: #f97316; }
  .seg-skip { background: #94a3b8; }

  /* Run info */
  .run-info { margin: 12px 32px 0; font-size: 12px; color: #888; }

  /* Section titles */
  .section-title { margin: 28px 32px 12px; font-size: 16px; font-weight: 600; color: #1a1a2e; border-left: 3px solid #6366f1; padding-left: 10px; }

  /* Test case table */
  .tc-table { margin: 0 32px; background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }
  .tc-table table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tc-table th { background: #f8fafc; padding: 10px 16px; text-align: left; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; }
  .tc-table td { padding: 10px 16px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  .tc-table tr:last-child td { border-bottom: none; }
  .tc-table tr:hover td { background: #fafafa; }
  .status-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .s-PASS { background: #dcfce7; color: #15803d; }
  .s-BUG  { background: #fee2e2; color: #dc2626; }
  .s-FAIL { background: #ffedd5; color: #c2410c; }
  .s-SKIP { background: #f1f5f9; color: #64748b; }

  /* Findings box (shown when all/most TCs pass — summarises observed behaviour) */
  .finding-box { margin: 0 32px 12px; background: #f0fdf4; border-radius: 10px; padding: 16px 20px; border-left: 4px solid #22c55e; font-size: 13px; }
  .finding-box.has-issues { background: #fff7ed; border-color: #f97316; }
  .finding-box h3 { font-size: 14px; color: #15803d; margin-bottom: 8px; }
  .finding-box.has-issues h3 { color: #c2410c; }
  .finding-box ul { padding-left: 18px; }
  .finding-box li { margin-bottom: 4px; color: #166534; }
  .finding-box.has-issues li { color: #9a3412; }

  /* Bug cards */
  .bug-list { margin: 0 32px; display: flex; flex-direction: column; gap: 12px; }
  .bug-card { background: #fff; border-radius: 12px; border-left: 4px solid #ef4444; padding: 16px 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .bug-card.sev-medium { border-color: #f97316; }
  .bug-card.sev-low    { border-color: #facc15; }
  .bug-card .bug-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .bug-card .bug-id  { font-size: 11px; font-weight: 700; color: #6366f1; background: #eef2ff; padding: 2px 8px; border-radius: 4px; }
  .bug-card .bug-sev { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }
  .sev-high   { background: #fee2e2; color: #dc2626; }
  .sev-medium { background: #ffedd5; color: #c2410c; }
  .sev-low    { background: #fef9c3; color: #854d0e; }
  .bug-card .bug-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
  .bug-card .row { display: flex; gap: 8px; margin-bottom: 4px; font-size: 12px; }
  .bug-card .lbl { min-width: 90px; color: #64748b; font-weight: 600; }
  .bug-card .val { color: #1a1a2e; }
  .bug-card .rec { margin-top: 8px; background: #f0fdf4; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #166534; }
  .bug-card .rec-ux { margin-top: 4px; background: #eff6ff; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #1e40af; }

  /* Screenshot grid */
  .ss-grid { margin: 0 32px; display: flex; flex-wrap: wrap; gap: 10px; }
  .ss-item { width: calc(25% - 8px); background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); font-size: 11px; }
  .ss-item img { width: 100%; display: block; cursor: zoom-in; }
  .ss-item .ss-label { padding: 4px 8px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Healing log */
  .heal-item { margin: 0 32px 8px; background: #fefce8; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #713f12; border-left: 3px solid #facc15; }

  /* Lightbox (click-to-zoom screenshots) */
  .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 1000; align-items: center; justify-content: center; }
  .lightbox.active { display: flex; }
  .lightbox img { max-width: 95vw; max-height: 95vh; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.5); }
  .lightbox-close { position: fixed; top: 16px; right: 20px; color: #fff; font-size: 28px; cursor: pointer; line-height: 1; }

  /* Footer */
  .footer { margin: 40px 32px 24px; font-size: 12px; color: #94a3b8; text-align: center; }
</style>
</head>
<body>

<div class="header">
  <h1>🧪 Odoo E2E Test Report — {{RUN_ID}}</h1>
  <div class="meta">
    {{BASE_URL}} &nbsp;·&nbsp; {{USERNAME}} &nbsp;·&nbsp;
    Started: {{STARTED_AT}} &nbsp;·&nbsp; Duration: {{TOTAL_DURATION}}
  </div>
</div>

<!-- Summary cards -->
<div class="cards">
  <div class="card total"><div class="num">{{TOTAL}}</div><div class="label">Total</div></div>
  <div class="card pass"> <div class="num">{{PASS_COUNT}}</div><div class="label">Passed</div></div>
  <div class="card bug">  <div class="num">{{BUG_COUNT}}</div><div class="label">Bugs</div></div>
  <div class="card fail"> <div class="num">{{FAIL_COUNT}}</div><div class="label">Failed</div></div>
  <div class="card skip"> <div class="num">{{SKIP_COUNT}}</div><div class="label">Skipped</div></div>
</div>

<!-- Progress bar -->
<div class="progress-bar">
  <div class="seg seg-pass" style="width:{{PASS_PCT}}%"></div>
  <div class="seg seg-bug"  style="width:{{BUG_PCT}}%"></div>
  <div class="seg seg-fail" style="width:{{FAIL_PCT}}%"></div>
  <div class="seg seg-skip" style="width:{{SKIP_PCT}}%"></div>
</div>
<div class="run-info">Input file: {{INPUT_FILE}} &nbsp;·&nbsp; {{PASS_COUNT}} passed / {{BUG_COUNT}} bugs / {{FAIL_COUNT}} failed / {{SKIP_COUNT}} skipped</div>

<!-- Test case overview table -->
<div class="section-title">📋 Test Cases</div>
<div class="tc-table">
  <table>
    <thead>
      <tr>
        <th>ID</th><th>Title</th><th>Scenario</th><th>Action</th>
        <th>Status</th><th>Key Assert</th><th>Bugs</th>
      </tr>
    </thead>
    <tbody>
      {{#EACH_TC}}
      <tr>
        <td><strong>{{TC_ID}}</strong></td>
        <td>{{TC_TITLE}}</td>
        <td>{{TC_SCENARIO}}</td>
        <td>{{TC_ACTION}}</td>
        <td><span class="status-badge s-{{TC_STATUS}}">{{TC_STATUS}}</span></td>
        <td>{{TC_KEY_ASSERT}}</td>
        <td>{{TC_BUG_COUNT}}</td>
      </tr>
      {{/EACH_TC}}
    </tbody>
  </table>
</div>

<!-- Test Findings (always present — green when all pass, orange when issues exist) -->
<div class="section-title">✅ Test Findings</div>
<div class="finding-box {{#IF_HAS_ISSUES}}has-issues{{/IF_HAS_ISSUES}}">
  <h3>{{FINDINGS_HEADLINE}}</h3>
  <ul>
    {{#EACH_FINDING}}
    <li>{{FINDING_TEXT}}</li>
    {{/EACH_FINDING}}
  </ul>
</div>

<!-- Bug details -->
{{#IF_BUGS}}
<div class="section-title">🐛 Bug Details</div>
<div class="bug-list">
  {{#EACH_BUG}}
  <div class="bug-card sev-{{BUG_SEVERITY}}">
    <div class="bug-header">
      <span class="bug-id">{{BUG_TC_ID}}</span>
      <span class="bug-sev sev-{{BUG_SEVERITY}}">{{BUG_SEVERITY}}</span>
    </div>
    <div class="bug-title">{{BUG_TITLE}}</div>
    <div class="row"><span class="lbl">Expected:</span><span class="val">{{BUG_EXPECTED}}</span></div>
    <div class="row"><span class="lbl">Actual:</span><span class="val">{{BUG_ACTUAL}}</span></div>
    <div class="row"><span class="lbl">Step:</span><span class="val">{{BUG_STEP}}</span></div>
    {{#IF_SCREENSHOT}}<div class="row"><span class="lbl">Screenshot:</span><span class="val"><a href="{{BUG_TC_ID}}/{{BUG_SCREENSHOT}}">{{BUG_SCREENSHOT}}</a></span></div>{{/IF_SCREENSHOT}}
    <div class="rec">💡 Fix: {{BUG_RECOMMEND_FIX}}</div>
    {{#IF_UX_FIX}}<div class="rec-ux">🎨 UX/UI: {{BUG_RECOMMEND_UX}}</div>{{/IF_UX_FIX}}
  </div>
  {{/EACH_BUG}}
</div>
{{/IF_BUGS}}

<!-- Self-healing log -->
{{#IF_HEALING}}
<div class="section-title">🔧 Self-Healing Log</div>
{{#EACH_HEAL}}
<div class="heal-item"><strong>{{HEAL_TC_ID}} Step {{HEAL_STEP}}:</strong> {{HEAL_ISSUE}} → {{HEAL_ACTION}}</div>
{{/EACH_HEAL}}
{{/IF_HEALING}}

<!-- Screenshots by test case (click any image to zoom) -->
<div class="section-title">📸 Screenshots</div>
{{#EACH_TC_SS}}
<div class="section-title" style="font-size:13px;margin-left:48px;border-color:#cbd5e1;">{{TC_ID}} — {{TC_TITLE}}</div>
<div class="ss-grid">
  {{#EACH_SS}}
  <div class="ss-item">
    <img src="{{TC_ID}}/{{SS_PATH}}" alt="{{SS_LABEL}}" loading="lazy" onclick="zoomImg(this)">
    <div class="ss-label">{{SS_LABEL}}</div>
  </div>
  {{/EACH_SS}}
</div>
{{/EACH_TC_SS}}

<div class="footer">Generated by Odoo E2E Test Framework · {{RUN_ID}}</div>

<!-- Lightbox overlay -->
<div class="lightbox" id="lb" onclick="this.classList.remove('active')">
  <span class="lightbox-close" onclick="document.getElementById('lb').classList.remove('active')">✕</span>
  <img id="lb-img" src="" alt="">
</div>

<script>
function zoomImg(el) {
  document.getElementById('lb-img').src = el.src;
  document.getElementById('lb').classList.add('active');
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') document.getElementById('lb').classList.remove('active');
});
</script>

</body>
</html>
```

---

## Filling the template

When generating the dashboard, replace all `{{PLACEHOLDERS}}` by reading the `result.json` files:

```
{{RUN_ID}}           ← from run-config.json
{{BASE_URL}}         ← from run-config.json
{{USERNAME}}         ← from run-config.json
{{STARTED_AT}}       ← from run-config.json
{{TOTAL_DURATION}}   ← calculate from min(startedAt) to max(finishedAt) across all result.json
{{TOTAL}}            ← count of all test cases
{{PASS_COUNT}}       ← count where status == "PASS"
{{BUG_COUNT}}        ← count where status == "BUG" or has bugs[]
{{FAIL_COUNT}}       ← count where status == "FAIL"
{{SKIP_COUNT}}       ← count where status == "SKIP"
{{PASS_PCT}}         ← PASS_COUNT / TOTAL * 100
{{BUG_PCT}}          ← BUG_COUNT / TOTAL * 100
...etc
{{INPUT_FILE}}       ← from run-config.json

For each TC row:
{{TC_ID}}            ← result.id
{{TC_TITLE}}         ← result.title
{{TC_SCENARIO}}      ← one-line description of the input conditions (e.g. "sequence=9999, unique")
{{TC_ACTION}}        ← short action summary (e.g. "Create → Save → Cancel dialog")
{{TC_STATUS}}        ← result.status
{{TC_KEY_ASSERT}}    ← result.keyAssert (one-line summary of what was verified)
{{TC_BUG_COUNT}}     ← result.bugs.length

For Test Findings section:
{{FINDINGS_HEADLINE}}    ← e.g. "Tất cả X test case PASS — <feature> hoạt động đúng"
                            or "X/Y test case PASS — phát hiện Y bug"
{{#IF_HAS_ISSUES}}       ← add class "has-issues" to finding-box when BUG_COUNT > 0 or FAIL_COUNT > 0
{{#EACH_FINDING}}        ← loop over result.findings[] collected from all result.json files
{{FINDING_TEXT}}         ← each finding bullet point (concise, factual observation)

For each bug:
{{BUG_TC_ID}}           ← parent TC id
{{BUG_SEVERITY}}        ← bug.severity
{{BUG_TITLE}}           ← bug.title
{{BUG_EXPECTED}}        ← bug.expected
{{BUG_ACTUAL}}          ← bug.actual
{{BUG_STEP}}            ← bug.stepRef
{{BUG_SCREENSHOT}}      ← bug.screenshot (relative path)
{{BUG_RECOMMEND_FIX}}   ← bug.recommendFix
{{BUG_RECOMMEND_UX}}    ← bug.recommendUXFix (omit block if empty)

Screenshots: list all .png files in each TC's screenshots/ folder.
```

## TC table columns — when to use each

| Column | Content |
|---|---|
| **Scenario** | Input condition: what data / state was set up (e.g. `sequence=9999, unique`) |
| **Action** | The flow taken: verb chain (e.g. `Create → Save → Cancel dialog`) |
| **Key Assert** | The decisive check that determined PASS/BUG (e.g. `No dialog · sequence=9,999`) |

These three columns replace the old `Module / Record Type / Duration` columns, which are less useful for QA readers.

## Test Findings — how to write good bullets

Each finding bullet should be:
- **Factual** — describe what the system actually did, not opinions
- **Concise** — one line per finding
- **Linked to a TC** — prefix with TC id if specific (e.g. `TC-003: ...`)
- **Emoji prefix** for quick scanning: ✅ for correct behaviour, ⚠️ for unexpected but not a bug, 🐛 for confirmed bugs

Examples:
```
✅ TC-001: Bản ghi với sequence không trùng → lưu thành công, không hiện dialog
✅ TC-002: Dialog "Warning" xuất hiện đúng khi sequence bị trùng; Cancel không lưu bản ghi
✅ TC-003: Sau khi chọn Ok, bản ghi mới giữ sequence gốc; bản ghi cũ tự động +1
✅ TC-004: Cascade dây chuyền hoạt động đến hết chuỗi, không dừng giữa chừng
⚠️ Dialog message bằng tiếng Anh — xem xét localise nếu hệ thống chạy cho người dùng Nhật/Việt
```

## Notes

- Use relative paths for screenshots (simpler, works when opening from the test-runs folder).
- The dashboard must open correctly with `file://` protocol in a browser — no CDN links.
- Lightbox (click-to-zoom) is built-in via inline JS — no external libraries needed.
- Press `Escape` or click outside the image to close the lightbox.
