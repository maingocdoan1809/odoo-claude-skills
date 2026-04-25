#!/usr/bin/env node
// generate-report.js — QA Test Execution report generator
// Usage: node generate-report.js <run-folder-path>
//
// Reads:   <run-folder>/_session.json + <run-folder>/<TC>/result.json + screenshots/
// Writes:  <run-folder>/report.html  +  <run-folder>/report.md
//
// Exit codes:
//   0 — success
//   1 — fatal error (bad path, IO failure)
//   2 — validation failure: one or more result.json malformed; AI must self-heal then re-run.
//       Structured error JSON is printed to stdout (stderr also logs human-readable summary).

const fs = require('fs');
const path = require('path');

const VALID_STATUS = ['passed', 'failed', 'skipped', 'error'];
const VALID_SEVERITY = ['high', 'medium', 'low'];

function main() {
  const runFolder = process.argv[2];
  if (!runFolder) {
    console.error('Usage: node generate-report.js <run-folder-path>');
    process.exit(1);
  }
  if (!fs.existsSync(runFolder) || !fs.statSync(runFolder).isDirectory()) {
    console.error(`Not a directory: ${runFolder}`);
    process.exit(1);
  }

  const sessionPath = path.join(runFolder, '_session.json');
  const session = fs.existsSync(sessionPath)
    ? safeReadJSON(sessionPath, { preflight: {}, started_at: null })
    : { preflight: {}, started_at: null };

  const tcFolders = fs.readdirSync(runFolder, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
    .map(d => d.name)
    .sort();

  // === Phase 1: Read + validate ===
  const validationFailures = [];
  const results = [];

  for (const tc of tcFolders) {
    const resultPath = path.join(runFolder, tc, 'result.json');
    const ssDir = path.join(runFolder, tc, 'screenshots');
    const screenshotsOnDisk = fs.existsSync(ssDir)
      ? fs.readdirSync(ssDir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).sort()
      : [];

    if (!fs.existsSync(resultPath)) {
      // Missing result.json is itself a healing target
      validationFailures.push({
        tc_folder: tc,
        result_path: resultPath,
        kind: 'missing_file',
        errors: [{ field: '*', issue: 'result.json does not exist' }],
        evidence: { screenshots: screenshotsOnDisk, tc_id_from_folder: tc },
        raw_content: null,
      });
      continue;
    }

    let raw, parsed;
    try {
      raw = fs.readFileSync(resultPath, 'utf-8');
    } catch (e) {
      validationFailures.push({
        tc_folder: tc,
        result_path: resultPath,
        kind: 'io_error',
        errors: [{ field: '*', issue: `cannot read file: ${e.message}` }],
        evidence: { screenshots: screenshotsOnDisk, tc_id_from_folder: tc },
        raw_content: null,
      });
      continue;
    }

    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      validationFailures.push({
        tc_folder: tc,
        result_path: resultPath,
        kind: 'parse_error',
        errors: [{ field: '*', issue: `invalid JSON: ${e.message}` }],
        evidence: { screenshots: screenshotsOnDisk, tc_id_from_folder: tc },
        raw_content: raw.length > 4000 ? raw.slice(0, 4000) + '\n...[truncated]' : raw,
      });
      continue;
    }

    const { valid, errors } = validateResult(parsed, tc);
    if (!valid) {
      validationFailures.push({
        tc_folder: tc,
        result_path: resultPath,
        kind: 'schema_invalid',
        errors,
        evidence: { screenshots: screenshotsOnDisk, tc_id_from_folder: tc, parsed_preview: previewObject(parsed) },
        raw_content: null,
      });
      continue;
    }

    parsed._tc_folder = tc;
    parsed._screenshots_b64 = embedScreenshots(ssDir);
    results.push(parsed);
  }

  // === Phase 2: If validation failed, abort with structured errors ===
  if (validationFailures.length > 0) {
    const payload = {
      ok: false,
      reason: 'validation_failed',
      message: `${validationFailures.length} result.json file(s) are malformed. Self-heal and re-run.`,
      failures: validationFailures,
      heal_protocol: [
        '1. For each failure, inspect kind, errors, and evidence.',
        '2. Backup the broken file: rename result.json -> result.json.broken',
        '3. Reconstruct result.json from evidence (screenshots, _session.json, agent memory).',
        '4. Set _healed: true and _heal_notes: "<short reason>" in the new file.',
        '5. Never fabricate test outcomes. If unrecoverable, set status="error" + actual_result describing the gap.',
        '6. Re-run this script. Heal at most once per file; second failure means mark TC as error and proceed.',
      ],
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    console.error(`\n✗ Validation failed: ${validationFailures.length} file(s) need healing. See JSON above.`);
    for (const f of validationFailures) {
      console.error(`  - ${f.tc_folder}/result.json [${f.kind}]: ${f.errors.map(e => e.field + '=' + e.issue).join('; ')}`);
    }
    process.exit(2);
  }

  // === Phase 3: Render reports ===
  const summary = aggregate(results, session);

  fs.writeFileSync(path.join(runFolder, 'report.html'), renderHTML(summary, results, session), 'utf-8');
  fs.writeFileSync(path.join(runFolder, 'report.md'), renderMD(summary, results, session), 'utf-8');

  console.log(`Reports generated:`);
  console.log(`  ${path.join(runFolder, 'report.html')}`);
  console.log(`  ${path.join(runFolder, 'report.md')}`);
  if (results.some(r => r._healed)) {
    const healed = results.filter(r => r._healed).map(r => r.tc_id);
    console.log(`  Note: ${healed.length} testcase(s) were self-healed: ${healed.join(', ')}`);
  }
}

// ---------- Validation ----------

function validateResult(r, tcFolder) {
  const errors = [];
  const required = ['tc_id', 'title', 'status', 'started_at', 'finished_at'];
  for (const f of required) {
    if (r[f] === undefined || r[f] === null || r[f] === '') {
      errors.push({ field: f, issue: 'missing required field' });
    }
  }

  if (r.status && !VALID_STATUS.includes(r.status)) {
    errors.push({ field: 'status', issue: `invalid value "${r.status}"; must be one of ${VALID_STATUS.join(', ')}` });
  }

  for (const f of ['started_at', 'finished_at']) {
    if (r[f] && isNaN(Date.parse(r[f]))) {
      errors.push({ field: f, issue: `not a parseable ISO 8601 datetime: "${r[f]}"` });
    }
  }

  if (r.tc_id && r.tc_id !== tcFolder) {
    errors.push({ field: 'tc_id', issue: `mismatch with folder name: "${r.tc_id}" vs folder "${tcFolder}"` });
  }

  if (r.duration_ms !== undefined && typeof r.duration_ms !== 'number') {
    errors.push({ field: 'duration_ms', issue: 'must be a number' });
  }

  if (r.steps !== undefined && !Array.isArray(r.steps)) {
    errors.push({ field: 'steps', issue: 'must be an array' });
  }

  if (r.bugs !== undefined && !Array.isArray(r.bugs)) {
    errors.push({ field: 'bugs', issue: 'must be an array' });
  }

  if (Array.isArray(r.bugs)) {
    r.bugs.forEach((b, i) => {
      if (!b || typeof b !== 'object') {
        errors.push({ field: `bugs[${i}]`, issue: 'must be an object' });
        return;
      }
      if (!b.description) errors.push({ field: `bugs[${i}].description`, issue: 'missing required field' });
      if (b.severity && !VALID_SEVERITY.includes(b.severity)) {
        errors.push({ field: `bugs[${i}].severity`, issue: `invalid value "${b.severity}"; must be one of ${VALID_SEVERITY.join(', ')}` });
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

function previewObject(o) {
  // Compact preview for error reports — keys + scalar values only
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      out[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '...' : v;
    } else if (Array.isArray(v)) {
      out[k] = `<array len=${v.length}>`;
    } else if (typeof v === 'object') {
      out[k] = `<object keys=${Object.keys(v).length}>`;
    }
  }
  return out;
}

function safeReadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}

// ---------- Data prep ----------

function embedScreenshots(dir) {
  const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const file of fs.readdirSync(dir).sort()) {
    const fp = path.join(dir, file);
    if (!fs.statSync(fp).isFile()) continue;
    const ext = path.extname(file).slice(1).toLowerCase() || 'png';
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    out[file] = `data:${mime};base64,${fs.readFileSync(fp).toString('base64')}`;
  }
  return out;
}

function aggregate(results, session) {
  const byStatus = (s) => results.filter(r => r.status === s).length;
  const allBugs = results.flatMap(r => (r.bugs || []).map(b => ({ ...b, tc_id: r.tc_id, tc_title: r.title })));
  return {
    total: results.length,
    passed: byStatus('passed'),
    failed: byStatus('failed'),
    skipped: byStatus('skipped'),
    error: byStatus('error'),
    bugs: allBugs.length,
    bugsHigh: allBugs.filter(b => b.severity === 'high').length,
    bugsMedium: allBugs.filter(b => b.severity === 'medium').length,
    bugsLow: allBugs.filter(b => b.severity === 'low').length,
    allBugs,
    started: session.started_at || (results[0] && results[0].started_at) || null,
    finished: new Date().toISOString(),
    url: (session.preflight && session.preflight.url) || null,
    mode: (session.preflight && session.preflight.mode) || null,
  };
}

function escapeHTML(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function collectAllScreenshots(results) {
  const shots = [];
  for (const r of results) {
    r._shot_index = {};
    const push = (relPath, caption) => {
      if (!relPath) return;
      const filename = path.basename(relPath);
      if (filename in r._shot_index) return;
      const src = r._screenshots_b64[filename];
      if (!src) return;
      r._shot_index[filename] = shots.length;
      shots.push({ tc: r.tc_id, title: caption, src });
    };
    for (const step of (r.steps || [])) {
      if (step.screenshot) push(step.screenshot, step.description || step.type || `Step ${step.step_id}`);
    }
    for (const bug of (r.bugs || [])) {
      if (bug.screenshot) push(bug.screenshot, `BUG [${bug.severity}]: ${bug.description}`);
    }
    for (const fn of Object.keys(r._screenshots_b64)) {
      if (!(fn in r._shot_index)) {
        r._shot_index[fn] = shots.length;
        shots.push({ tc: r.tc_id, title: fn, src: r._screenshots_b64[fn] });
      }
    }
  }
  return shots;
}

// ---------- HTML rendering ----------

function renderHTML(summary, results, session) {
  const allShots = collectAllScreenshots(results);
  const tcSections = results.map((r, i) => renderTC(r, i)).join('\n');
  const bugSummaryHTML = renderBugSummary(summary);
  const filterHTML = renderFilters(summary);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>QA Test Report — ${escapeHTML(summary.url || 'Unknown')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f5f5f7; color: #1d1d1f; }
  header { background: #fff; padding: 24px 32px; border-bottom: 1px solid #e0e0e5; }
  header h1 { margin: 0; font-size: 22px; font-weight: 600; }
  header .meta { color: #6e6e73; font-size: 13px; margin-top: 6px; }
  .container { max-width: 1280px; margin: 24px auto; padding: 0 24px; }

  /* Card groups */
  .card-group { margin-bottom: 16px; }
  .card-group-label { font-size: 11px; text-transform: uppercase; color: #6e6e73; letter-spacing: 0.6px; font-weight: 600; margin: 0 4px 10px; }
  .cards { display: grid; gap: 12px; }
  .cards.outcomes { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .cards.bugs { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  @media (max-width: 900px) {
    .cards.outcomes, .cards.bugs { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  }
  .card {
    background: #fff; padding: 18px; border-radius: 12px; border: 1px solid #e0e0e5;
    transition: transform 0.18s cubic-bezier(0.4,0,0.2,1), box-shadow 0.18s, border-color 0.18s;
    opacity: 0; animation: fadeInUp 0.45s cubic-bezier(0.4,0,0.2,1) forwards;
  }
  .card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.06); }
  .card .label { font-size: 11px; color: #6e6e73; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  .card .value { font-size: 32px; font-weight: 600; margin-top: 6px; line-height: 1; }
  .card.passed .value { color: #34c759; }
  .card.failed .value { color: #ff3b30; }
  .card.skipped .value { color: #ff9500; }
  .card.error .value { color: #af52de; }
  .card.bug .value { color: #ff3b30; }
  .card.bug.high { border-color: #ff3b30; }
  .card.bug.medium { border-color: #ff9500; }
  .card.bug.low { border-color: #ffd60a; }
  .card.zero .value { color: #c7c7cc; }
  @keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  .card:nth-child(1) { animation-delay: 0.00s; }
  .card:nth-child(2) { animation-delay: 0.05s; }
  .card:nth-child(3) { animation-delay: 0.10s; }
  .card:nth-child(4) { animation-delay: 0.15s; }
  .card:nth-child(5) { animation-delay: 0.20s; }

  h2 { font-size: 18px; font-weight: 600; margin: 32px 0 12px; }

  /* Filter toolbar */
  .filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 14px; }
  .filter {
    background: #fff; border: 1px solid #e0e0e5; padding: 7px 14px; border-radius: 999px;
    font-size: 13px; cursor: pointer; color: #1d1d1f; transition: all 0.12s; font-weight: 500;
  }
  .filter:hover { background: #f0f0f3; }
  .filter.active { background: #1d1d1f; color: #fff; border-color: #1d1d1f; }
  .filter .count { display: inline-block; margin-left: 6px; font-size: 11px; color: #6e6e73; font-weight: 600; }
  .filter.active .count { color: #c7c7cc; }

  /* Bug summary */
  .bug-summary { background: #fff; border: 1px solid #e0e0e5; border-radius: 12px; padding: 4px 0; margin-bottom: 8px; }
  .bug-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 16px; border-bottom: 1px solid #f5f5f7; font-size: 13px; }
  .bug-row:last-child { border: 0; }
  .bug-row a.tc-link { color: #007aff; text-decoration: none; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; flex-shrink: 0; padding-top: 1px; }
  .bug-row a.tc-link:hover { text-decoration: underline; }
  .bug-row .desc { flex: 1; }
  .bug-empty { padding: 14px 16px; color: #6e6e73; font-size: 13px; font-style: italic; }
  details.sev-group { margin: 0; }
  details.sev-group > summary { list-style: none; cursor: pointer; padding: 10px 16px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #6e6e73; font-weight: 600; user-select: none; border-bottom: 1px solid #f5f5f7; }
  details.sev-group > summary::-webkit-details-marker { display: none; }
  details.sev-group > summary::before { content: '▶'; display: inline-block; margin-right: 8px; transition: transform 0.15s; font-size: 9px; }
  details.sev-group[open] > summary::before { transform: rotate(90deg); }
  details.sev-group:last-child > summary { border-bottom: 0; }
  details.sev-group[open] > summary { border-bottom: 1px solid #f5f5f7; }

  /* Testcases */
  .tc { background: #fff; border: 1px solid #e0e0e5; border-radius: 12px; margin-bottom: 12px; overflow: hidden; transition: box-shadow 0.15s; scroll-margin-top: 16px; }
  .tc.flash { animation: flash 1.2s ease-out; }
  @keyframes flash { 0% { box-shadow: 0 0 0 0 rgba(0,122,255,0.5); } 100% { box-shadow: 0 0 0 8px rgba(0,122,255,0); } }
  .tc-header { padding: 14px 18px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 12px; user-select: none; }
  .tc-header:hover { background: #fafafa; }
  .tc-title { font-weight: 500; }
  .tc-id { color: #6e6e73; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; margin-right: 8px; }
  .tc-meta { color: #6e6e73; font-size: 12px; }
  .tc-status { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; }
  .tc-status.passed { background: #d1f7d6; color: #1f7a30; }
  .tc-status.failed { background: #ffd9d6; color: #b3251c; }
  .tc-status.skipped { background: #ffe9c2; color: #8a5a00; }
  .tc-status.error { background: #efd9ff; color: #6b1fa3; }
  .tc-bugcount { display: inline-block; margin-left: 6px; padding: 2px 8px; border-radius: 999px; background: #ff3b30; color: #fff; font-size: 10px; font-weight: 700; }
  .tc-body { padding: 0 18px 18px; display: none; border-top: 1px solid #f0f0f3; }
  .tc-body.open { display: block; }
  .tc.healed { border-style: dashed; }
  .heal-banner { background: #fff8e1; border-left: 3px solid #ff9500; padding: 8px 12px; margin: 12px 0; border-radius: 4px; font-size: 12px; color: #6e4f00; }

  .section-title { font-size: 12px; text-transform: uppercase; color: #6e6e73; letter-spacing: 0.5px; margin: 16px 0 8px; font-weight: 600; }

  /* Steps */
  .step { padding: 10px 0; border-bottom: 1px solid #f5f5f7; font-size: 13px; display: flex; gap: 10px; align-items: flex-start; }
  .step:last-child { border: 0; }
  .step .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 6px; }
  .step .dot.passed { background: #34c759; }
  .step .dot.failed { background: #ff3b30; }
  .step .dot.skipped { background: #ff9500; }
  .step .desc { flex: 1; min-width: 0; }
  .step .dur { color: #6e6e73; font-size: 11px; flex-shrink: 0; }
  .step .err { color: #b3251c; font-size: 12px; margin-top: 3px; }
  .step .inline-thumb { display: inline-block; margin-left: 8px; vertical-align: middle; border-radius: 4px; overflow: hidden; cursor: pointer; border: 1px solid #e0e0e5; transition: transform 0.1s; }
  .step .inline-thumb:hover { transform: scale(1.06); }
  .step .inline-thumb img { width: 80px; height: 50px; object-fit: cover; display: block; }

  /* Bugs in TC body */
  .bug { background: #fff5f5; padding: 10px 12px; border-left: 3px solid #ff3b30; margin: 8px 0; border-radius: 4px; font-size: 13px; }
  .bug .sev { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; margin-right: 6px; }
  .sev.high { background: #ff3b30; color: #fff; }
  .sev.medium { background: #ff9500; color: #fff; }
  .sev.low { background: #ffd60a; color: #1d1d1f; }
  .bug .ex { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #6e6e73; margin-top: 6px; white-space: pre-wrap; background: #fff; padding: 6px 8px; border-radius: 4px; }

  .thumbs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .thumb { display: inline-block; border-radius: 6px; overflow: hidden; cursor: pointer; border: 1px solid #e0e0e5; transition: transform 0.1s; }
  .thumb:hover { transform: scale(1.04); }
  .thumb img { width: 140px; height: 90px; object-fit: cover; display: block; }
  .params { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f5f5f7; padding: 8px 12px; border-radius: 6px; white-space: pre-wrap; }

  /* Lightbox */
  .lb { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.94); z-index: 1000; align-items: center; justify-content: center; }
  .lb.open { display: flex; }
  .lb img { max-width: 92vw; max-height: 84vh; object-fit: contain; box-shadow: 0 4px 32px rgba(0,0,0,0.5); }
  .lb-nav { position: absolute; top: 50%; transform: translateY(-50%); background: rgba(255,255,255,0.1); color: #fff; border: 0; font-size: 32px; padding: 12px 20px; cursor: pointer; border-radius: 8px; }
  .lb-nav:hover { background: rgba(255,255,255,0.25); }
  .lb-prev { left: 24px; }
  .lb-next { right: 24px; }
  .lb-close { position: absolute; top: 24px; right: 24px; background: rgba(255,255,255,0.1); color: #fff; border: 0; font-size: 14px; padding: 10px 16px; cursor: pointer; border-radius: 8px; }
  .lb-close:hover { background: rgba(255,255,255,0.25); }
  .lb-caption { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); color: #fff; font-size: 13px; background: rgba(0,0,0,0.6); padding: 8px 16px; border-radius: 8px; max-width: 80vw; text-align: center; }
  .lb-counter { position: absolute; top: 24px; left: 24px; color: #fff; font-size: 13px; background: rgba(0,0,0,0.6); padding: 8px 14px; border-radius: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
</style>
</head>
<body>
<header>
  <h1>QA Test Execution Report</h1>
  <div class="meta">
    ${summary.url ? `<strong>${escapeHTML(summary.url)}</strong> &bull; ` : ''}
    ${summary.mode ? `Mode: ${escapeHTML(summary.mode)} &bull; ` : ''}
    Started: ${escapeHTML(summary.started || 'N/A')} &bull;
    Finished: ${escapeHTML(summary.finished)}
  </div>
</header>
<div class="container">

  <div class="card-group">
    <div class="card-group-label">Outcomes</div>
    <div class="cards outcomes">
      <div class="card"><div class="label">Total</div><div class="value">${summary.total}</div></div>
      <div class="card passed ${summary.passed === 0 ? 'zero' : ''}"><div class="label">Passed</div><div class="value">${summary.passed}</div></div>
      <div class="card failed ${summary.failed === 0 ? 'zero' : ''}"><div class="label">Failed</div><div class="value">${summary.failed}</div></div>
      <div class="card skipped ${summary.skipped === 0 ? 'zero' : ''}"><div class="label">Skipped</div><div class="value">${summary.skipped}</div></div>
      <div class="card error ${summary.error === 0 ? 'zero' : ''}"><div class="label">Error</div><div class="value">${summary.error}</div></div>
    </div>
  </div>

  <div class="card-group">
    <div class="card-group-label">Bugs</div>
    <div class="cards bugs">
      <div class="card bug ${summary.bugs === 0 ? 'zero' : ''}"><div class="label">Bugs</div><div class="value">${summary.bugs}</div></div>
      <div class="card bug high ${summary.bugsHigh === 0 ? 'zero' : ''}"><div class="label">High</div><div class="value">${summary.bugsHigh}</div></div>
      <div class="card bug medium ${summary.bugsMedium === 0 ? 'zero' : ''}"><div class="label">Medium</div><div class="value">${summary.bugsMedium}</div></div>
      <div class="card bug low ${summary.bugsLow === 0 ? 'zero' : ''}"><div class="label">Low</div><div class="value">${summary.bugsLow}</div></div>
    </div>
  </div>

  ${bugSummaryHTML}

  <h2>Testcases</h2>
  ${filterHTML}
  <div id="tc-list">
    ${tcSections}
  </div>
</div>

<div class="lb" id="lb">
  <div class="lb-counter" id="lb-counter"></div>
  <button class="lb-close" onclick="closeLB()">Close ✕</button>
  <button class="lb-nav lb-prev" onclick="navLB(-1)">‹</button>
  <img id="lb-img" src="" alt="">
  <button class="lb-nav lb-next" onclick="navLB(1)">›</button>
  <div class="lb-caption" id="lb-cap"></div>
</div>

<script>
const SHOTS = ${JSON.stringify(allShots)};
let lbIdx = 0;
function openLB(i) { lbIdx = i; show(); document.getElementById('lb').classList.add('open'); }
function closeLB() { document.getElementById('lb').classList.remove('open'); }
function navLB(d) { if (!SHOTS.length) return; lbIdx = (lbIdx + d + SHOTS.length) % SHOTS.length; show(); }
function show() {
  const s = SHOTS[lbIdx];
  document.getElementById('lb-img').src = s.src;
  document.getElementById('lb-cap').textContent = s.tc + ' — ' + s.title;
  document.getElementById('lb-counter').textContent = (lbIdx + 1) + ' / ' + SHOTS.length;
}
document.addEventListener('keydown', e => {
  if (!document.getElementById('lb').classList.contains('open')) return;
  if (e.key === 'ArrowLeft') navLB(-1);
  else if (e.key === 'ArrowRight') navLB(1);
  else if (e.key === 'Escape') closeLB();
});
document.getElementById('lb').addEventListener('click', e => {
  if (e.target.id === 'lb') closeLB();
});
function toggleTC(idx, ev) {
  if (ev) ev.stopPropagation();
  document.getElementById('tc-body-' + idx).classList.toggle('open');
}
function applyFilter(filter, btn) {
  document.querySelectorAll('.filter').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('.tc').forEach(tc => {
    const status = tc.dataset.status;
    const bugs = parseInt(tc.dataset.bugs || '0', 10);
    let show = true;
    if (filter === 'all') show = true;
    else if (filter === 'bugs') show = bugs > 0;
    else show = status === filter;
    tc.style.display = show ? '' : 'none';
  });
}
function jumpToTC(tcId, ev) {
  if (ev) ev.preventDefault();
  const el = document.getElementById('tc-' + tcId);
  if (!el) return;
  // Reset filter to all so target is visible
  const allBtn = document.querySelector('.filter[data-filter="all"]');
  if (allBtn) applyFilter('all', allBtn);
  // Expand
  const idx = el.dataset.idx;
  const body = document.getElementById('tc-body-' + idx);
  if (body && !body.classList.contains('open')) body.classList.add('open');
  // Scroll + flash
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth; // restart animation
  el.classList.add('flash');
}
</script>
</body>
</html>`;
}

function renderFilters(summary) {
  const buttons = [
    { f: 'all',     label: 'All',     count: summary.total },
    { f: 'passed',  label: 'Passed',  count: summary.passed },
    { f: 'failed',  label: 'Failed',  count: summary.failed },
    { f: 'skipped', label: 'Skipped', count: summary.skipped },
    { f: 'error',   label: 'Error',   count: summary.error },
    { f: 'bugs',    label: 'Bugs only', count: summary.bugs },
  ];
  return `<div class="filters">${buttons.map(b =>
    `<button class="filter${b.f === 'all' ? ' active' : ''}" data-filter="${b.f}" onclick="applyFilter('${b.f}', this)">${b.label}<span class="count">${b.count}</span></button>`
  ).join('')}</div>`;
}

function renderBugSummary(summary) {
  const groups = [
    { sev: 'high',   bugs: summary.allBugs.filter(b => b.severity === 'high') },
    { sev: 'medium', bugs: summary.allBugs.filter(b => b.severity === 'medium') },
    { sev: 'low',    bugs: summary.allBugs.filter(b => b.severity === 'low') },
  ];

  if (summary.bugs === 0) {
    return `<h2>Bugs</h2><div class="bug-summary"><div class="bug-empty">Không có bug nào được phát hiện trong session này.</div></div>`;
  }

  const inner = groups.filter(g => g.bugs.length > 0).map(g => `
    <details class="sev-group" open>
      <summary><span class="sev ${g.sev}" style="margin-right:8px;padding:2px 8px;font-size:10px;border-radius:4px;">${g.sev.toUpperCase()}</span>${g.bugs.length} bug${g.bugs.length > 1 ? 's' : ''}</summary>
      ${g.bugs.map(b => `
        <div class="bug-row">
          <a class="tc-link" href="#tc-${escapeHTML(b.tc_id)}" onclick="jumpToTC('${escapeHTML(b.tc_id)}', event)">${escapeHTML(b.tc_id)}</a>
          <div class="desc">${escapeHTML(b.description || '')}<div style="color:#6e6e73;font-size:12px;margin-top:2px;">${escapeHTML(b.tc_title || '')}</div></div>
        </div>
      `).join('')}
    </details>
  `).join('');

  return `<h2>Bugs (${summary.bugs})</h2><div class="bug-summary">${inner}</div>`;
}

function renderTC(r, idx) {
  const status = r.status || 'unknown';
  const dur = typeof r.duration_ms === 'number' ? `${(r.duration_ms / 1000).toFixed(1)}s` : 'N/A';
  const bugCount = (r.bugs || []).length;
  const isOpen = status !== 'passed' || bugCount > 0;
  const isHealed = !!r._healed;

  const stepsHTML = (r.steps || []).map(s => {
    const inlineThumb = s.screenshot && r._shot_index && (path.basename(s.screenshot) in r._shot_index)
      ? `<a class="inline-thumb" onclick="openLB(${r._shot_index[path.basename(s.screenshot)]})"><img src="${r._screenshots_b64[path.basename(s.screenshot)] || ''}" alt=""></a>`
      : '';
    return `
    <div class="step">
      <div class="dot ${s.status || ''}"></div>
      <div class="desc">
        <div>${escapeHTML(s.description || s.type || `Step ${s.step_id}`)}${inlineThumb}</div>
        ${s.error ? `<div class="err">${escapeHTML(s.error)}</div>` : ''}
      </div>
      <div class="dur">${typeof s.duration_ms === 'number' ? s.duration_ms + 'ms' : ''}</div>
    </div>`;
  }).join('');

  const bugsHTML = (r.bugs || []).map(b => {
    const inlineThumb = b.screenshot && r._shot_index && (path.basename(b.screenshot) in r._shot_index)
      ? `<a class="inline-thumb" onclick="openLB(${r._shot_index[path.basename(b.screenshot)]})"><img src="${r._screenshots_b64[path.basename(b.screenshot)] || ''}" alt=""></a>`
      : '';
    return `
    <div class="bug">
      <span class="sev ${b.severity || 'low'}">${escapeHTML(b.severity || 'low')}</span>
      ${escapeHTML(b.description || '')}${inlineThumb}
      ${b.exception ? `<div class="ex">${escapeHTML(b.exception)}</div>` : ''}
    </div>`;
  }).join('');

  const thumbsHTML = renderThumbs(r);

  const paramHTML = r.param_set && Object.keys(r.param_set).length
    ? `<div class="section-title">Parameters</div><div class="params">${escapeHTML(JSON.stringify(r.param_set, null, 2))}</div>`
    : '';

  const expectedHTML = r.expected_result || r.actual_result
    ? `<div class="section-title">Expected vs Actual</div>
       <div style="font-size: 13px;">
         ${r.expected_result ? `<div><strong>Expected:</strong> ${escapeHTML(r.expected_result)}</div>` : ''}
         ${r.actual_result ? `<div style="margin-top: 4px;"><strong>Actual:</strong> ${escapeHTML(r.actual_result)}</div>` : ''}
       </div>`
    : '';

  const healBanner = isHealed
    ? `<div class="heal-banner"><strong>⚠ Self-healed:</strong> ${escapeHTML(r._heal_notes || 'kết quả được tái dựng từ evidence vì result.json gốc bị lỗi')}</div>`
    : '';

  return `
<div class="tc${isHealed ? ' healed' : ''}" id="tc-${escapeHTML(r.tc_id || '')}" data-status="${escapeHTML(status)}" data-bugs="${bugCount}" data-idx="${idx}">
  <div class="tc-header" onclick="toggleTC(${idx}, event)">
    <div>
      <span class="tc-id">${escapeHTML(r.tc_id || '')}</span>
      <span class="tc-title">${escapeHTML(r.title || '')}</span>
      ${r.module ? `<span class="tc-meta"> &bull; ${escapeHTML(r.module)}</span>` : ''}
    </div>
    <div>
      ${bugCount > 0 ? `<span class="tc-bugcount">${bugCount} bug${bugCount > 1 ? 's' : ''}</span>` : ''}
      <span class="tc-meta" style="margin-left:8px;">${dur}</span>
      <span class="tc-status ${status}" style="margin-left:8px;">${escapeHTML(status)}</span>
    </div>
  </div>
  <div class="tc-body${isOpen ? ' open' : ''}" id="tc-body-${idx}">
    ${healBanner}
    ${paramHTML}
    ${(r.steps || []).length ? `<div class="section-title">Steps</div>${stepsHTML}` : ''}
    ${(r.bugs || []).length ? `<div class="section-title">Bugs</div>${bugsHTML}` : ''}
    ${expectedHTML}
    ${thumbsHTML}
  </div>
</div>`;
}

function renderThumbs(r) {
  const entries = Object.entries(r._shot_index || {});
  if (!entries.length) return '';
  entries.sort((a, b) => a[1] - b[1]);
  const html = entries.map(([fn, idx]) =>
    `<a class="thumb" onclick="openLB(${idx})"><img src="${r._screenshots_b64[fn]}" alt="${escapeHTML(fn)}"></a>`
  ).join('');
  return `<div class="section-title">All Screenshots</div><div class="thumbs">${html}</div>`;
}

// ---------- Markdown rendering ----------

function renderMD(summary, results, session) {
  const lines = [];
  lines.push(`# QA Test Report`);
  lines.push('');
  if (summary.url) lines.push(`**URL:** ${summary.url}  `);
  if (summary.mode) lines.push(`**Mode:** ${summary.mode}  `);
  if (summary.started) lines.push(`**Started:** ${summary.started}  `);
  lines.push(`**Finished:** ${summary.finished}`);
  lines.push('');

  // Summary
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Total | ${summary.total} |`);
  lines.push(`| ✅ Passed | ${summary.passed} |`);
  lines.push(`| ❌ Failed | ${summary.failed} |`);
  lines.push(`| ⏭️ Skipped | ${summary.skipped} |`);
  lines.push(`| ⚠️ Error | ${summary.error} |`);
  lines.push(`| 🐛 Bugs | ${summary.bugs} (${summary.bugsHigh} high / ${summary.bugsMedium} medium / ${summary.bugsLow} low) |`);
  lines.push('');

  // Bugs Found section — grouped by severity, with TC + params
  if (summary.bugs > 0) {
    lines.push(`## Bugs Found`);
    lines.push('');
    for (const sev of ['high', 'medium', 'low']) {
      const bugsAtSev = summary.allBugs.filter(b => b.severity === sev);
      if (!bugsAtSev.length) continue;
      const label = { high: '🔴 High', medium: '🟠 Medium', low: '🟡 Low' }[sev];
      lines.push(`### ${label} (${bugsAtSev.length})`);
      lines.push('');
      for (const b of bugsAtSev) {
        const r = results.find(rr => rr.tc_id === b.tc_id);
        lines.push(`- **${b.tc_id}** — ${b.description || ''}`);
        lines.push(`  - Title: ${b.tc_title || ''}`);
        if (r && r.param_set && Object.keys(r.param_set).length) {
          lines.push(`  - Params: \`${JSON.stringify(r.param_set)}\``);
        }
        if (b.exception) {
          const ex = String(b.exception).split('\n')[0].slice(0, 200);
          lines.push(`  - Exception: \`${ex}\``);
        }
      }
      lines.push('');
    }
  }

  // Failures & Errors detail
  const failed = results.filter(r => r.status === 'failed' || r.status === 'error');
  if (failed.length) {
    lines.push(`## Failures & Errors`);
    lines.push('');
    for (const r of failed) {
      lines.push(`### ${r.tc_id} — ${r.title}  \`${r.status}\``);
      if (r.module) lines.push(`- Module: ${r.module}`);
      if (typeof r.duration_ms === 'number') lines.push(`- Duration: ${r.duration_ms}ms`);
      if (r.param_set && Object.keys(r.param_set).length) {
        lines.push(`- Params: \`${JSON.stringify(r.param_set)}\``);
      }
      if (r.expected_result) lines.push(`- Expected: ${r.expected_result}`);
      if (r.actual_result) lines.push(`- Actual: ${r.actual_result}`);
      if ((r.bugs || []).length) {
        lines.push(`- Bugs:`);
        for (const b of r.bugs) {
          lines.push(`  - **[${b.severity || 'low'}]** ${b.description || ''}`);
        }
      }
      if (r._healed) lines.push(`- ⚠ Self-healed: ${r._heal_notes || ''}`);
      lines.push('');
    }
  }

  // All testcases compact table
  lines.push(`## All Testcases`);
  lines.push('');
  lines.push(`| TC | Title | Module | Status | Duration | Bugs |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of results) {
    const icon = { passed: '✅', failed: '❌', skipped: '⏭️', error: '⚠️' }[r.status] || '';
    const dur = typeof r.duration_ms === 'number' ? `${(r.duration_ms / 1000).toFixed(1)}s` : '-';
    const bugCount = (r.bugs || []).length;
    const healMark = r._healed ? ' 🔧' : '';
    lines.push(`| ${r.tc_id || ''}${healMark} | ${(r.title || '').replace(/\|/g, '\\|')} | ${r.module || ''} | ${icon} ${r.status || ''} | ${dur} | ${bugCount || ''} |`);
  }
  lines.push('');

  return lines.join('\n');
}

main();
