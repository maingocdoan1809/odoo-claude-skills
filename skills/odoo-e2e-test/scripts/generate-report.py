#!/usr/bin/env python3
"""
Odoo E2E Test Report Generator

Reads result.json files from a test run directory and generates
a report in HTML, Markdown, plain text, or all formats.

Usage:
  python3 generate-report.py <run-dir> [--format html|md|txt|all] [--relative-images]

Arguments:
  run-dir              Path to test run directory
                       e.g.  ./test-runs/RUN-20260421-082500-ticket

Options:
  --format FORMAT      Output format: html, md, txt, or all  (default: html)
  --relative-images    Use relative image paths in HTML instead of base64 embedding.
                       Base64 embedding (default) produces a fully self-contained file
                       that can be emailed directly to management.
  --output-dir DIR     Write report files to this directory (default: run-dir)

Exit codes:
  0  All reports generated successfully
  1  Critical error — run directory not found
  2  Partial success — reports generated but warnings were raised

Error messages are written to stderr; progress messages to stdout.
All error messages include the exact file path so the AI can locate
and fix the problematic input.
"""

import os
import sys
import json
import base64
import re
import argparse
from datetime import datetime
from pathlib import Path

# ─────────────────────────────────────────────
#  Logging helpers
# ─────────────────────────────────────────────

_warnings: list[str] = []
_errors: list[str] = []


def warn(msg: str) -> None:
    _warnings.append(msg)
    print(f"  ⚠  {msg}", file=sys.stderr)


def err(msg: str) -> None:
    _errors.append(msg)
    print(f"  ✗  {msg}", file=sys.stderr)


def info(msg: str) -> None:
    print(f"  →  {msg}")


# ─────────────────────────────────────────────
#  JSON loading
# ─────────────────────────────────────────────

def load_json(path: Path, *, required: bool = False, default=None):
    """
    Load and parse a JSON file.

    On FileNotFoundError or JSONDecodeError the function prints an error/warning
    and returns `default`.  Calling code should treat a None return as
    "this file is missing or broken".
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        msg = f"File not found: {path}"
        err(msg) if required else warn(msg)
        return default
    except json.JSONDecodeError as exc:
        msg = f"Invalid JSON in {path} (line {exc.lineno}, col {exc.colno}): {exc.msg}"
        err(msg) if required else warn(f"{msg} — skipping file")
        return default
    except OSError as exc:
        msg = f"Cannot read {path}: {exc}"
        err(msg) if required else warn(msg)
        return default


# ─────────────────────────────────────────────
#  Image helpers
# ─────────────────────────────────────────────

_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}


def img_b64(path: Path) -> str:
    """Return a base64 data-URI for an image file, or '' on failure."""
    try:
        data = path.read_bytes()
        mime = _MIME.get(path.suffix.lower(), "image/png")
        return f"data:{mime};base64,{base64.b64encode(data).decode()}"
    except Exception as exc:
        warn(f"Cannot embed screenshot {path}: {exc}")
        return ""


# ─────────────────────────────────────────────
#  Data normalisation
# ─────────────────────────────────────────────

_VALID_STATUSES = {"PASS", "FAIL", "BUG", "SKIP", "UNKNOWN"}


def _normalise_bug(bug: dict) -> dict:
    bug.setdefault("severity", "medium")
    bug.setdefault("title", "Unnamed bug")
    bug.setdefault("expected", "")
    bug.setdefault("actual", "")
    bug.setdefault("stepRef", "")
    bug.setdefault("screenshot", "")
    bug.setdefault("recommendFix", "")
    bug.setdefault("recommendUXFix", "")
    sev = str(bug["severity"]).lower()
    if sev not in ("high", "medium", "low"):
        warn(f"Bug '{bug['title']}' has unrecognised severity '{bug['severity']}' — defaulting to medium")
        bug["severity"] = "medium"
    return bug


def normalise_result(raw: dict, tc_dir: Path) -> dict:
    """Fill missing keys with safe defaults and normalise enum values."""
    r = dict(raw)
    r.setdefault("id", tc_dir.name)
    r.setdefault("title", tc_dir.name)
    r.setdefault("status", "UNKNOWN")
    r.setdefault("scenario", "")
    r.setdefault("action", "")
    r.setdefault("keyAssert", "")
    r.setdefault("findings", [])
    r.setdefault("bugs", [])
    r.setdefault("healingLog", [])
    r.setdefault("steps", [])
    r.setdefault("startedAt", "")
    r.setdefault("finishedAt", "")
    r.setdefault("duration_ms", None)

    status = str(r["status"]).upper()
    if status not in _VALID_STATUSES:
        warn(f"{tc_dir.name}: unrecognised status '{r['status']}' — treating as UNKNOWN (will count as FAIL)")
        r["status"] = "UNKNOWN"
    else:
        r["status"] = status

    r["bugs"] = [_normalise_bug(b) for b in r["bugs"] if isinstance(b, dict)]
    r["healingLog"] = [h for h in r["healingLog"] if isinstance(h, dict)]
    r["findings"] = [f for f in r["findings"] if isinstance(f, str) and f.strip()]

    return r


# ─────────────────────────────────────────────
#  Data collection
# ─────────────────────────────────────────────

def collect_data(run_dir_arg: str):
    """
    Load all run data from *run_dir_arg*.

    Returns (config, test_cases, results, run_dir).
    Exits with code 1 if the directory does not exist.
    """
    run_dir = Path(run_dir_arg).resolve()

    if not run_dir.exists():
        err(f"Run directory not found: {run_dir}")
        err("  Fix: provide a valid path, e.g. ./test-runs/RUN-20260421-082500-ticket")
        sys.exit(1)
    if not run_dir.is_dir():
        err(f"Path is not a directory: {run_dir}")
        sys.exit(1)

    info(f"Loading run data from: {run_dir}")

    config = load_json(run_dir / "run-config.json", required=True, default={})
    if not config:
        warn("run-config.json missing or empty — report metadata will be incomplete")
        config = {
            "runId": run_dir.name,
            "url": "",
            "username": "",
            "inputFile": "",
            "startedAt": "",
            "notes": "",
        }

    test_cases = load_json(run_dir / "test-cases.json", required=False, default=[]) or []

    # Discover TC-* result directories
    tc_dirs = sorted(
        [d for d in run_dir.iterdir() if d.is_dir() and re.match(r"^TC-\d+", d.name)],
        key=lambda d: d.name,
    )

    if not tc_dirs:
        warn(f"No TC-* directories found in {run_dir} — report will show zero test cases")

    results = []
    for tc_dir in tc_dirs:
        raw = load_json(tc_dir / "result.json", required=False, default=None)
        if raw is None:
            warn(f"{tc_dir.name}/result.json not found — marking as UNKNOWN status")
            raw = {
                "id": tc_dir.name,
                "title": tc_dir.name,
                "status": "UNKNOWN",
                "scenario": "result.json missing",
                "action": "",
                "keyAssert": "",
                "findings": [],
                "bugs": [],
                "healingLog": [],
                "steps": [],
            }
        results.append(normalise_result(raw, tc_dir))

    info(f"Loaded {len(results)} test case result(s)")
    return config, test_cases, results, run_dir


# ─────────────────────────────────────────────
#  Statistics
# ─────────────────────────────────────────────

def compute_stats(results: list) -> dict:
    total = len(results)
    counts: dict[str, int] = {}
    for r in results:
        s = r.get("status", "UNKNOWN")
        counts[s] = counts.get(s, 0) + 1

    fail = counts.get("FAIL", 0) + counts.get("UNKNOWN", 0)

    def pct(n):
        return round(n / total * 100, 1) if total > 0 else 0.0

    return {
        "total": total,
        "pass": counts.get("PASS", 0),
        "bug": counts.get("BUG", 0),
        "fail": fail,
        "skip": counts.get("SKIP", 0),
        "pass_pct": pct(counts.get("PASS", 0)),
        "bug_pct": pct(counts.get("BUG", 0)),
        "fail_pct": pct(fail),
        "skip_pct": pct(counts.get("SKIP", 0)),
    }


# ─────────────────────────────────────────────
#  Duration helper
# ─────────────────────────────────────────────

def fmt_duration(start_iso: str, end_iso: str) -> str:
    """Return a human-readable duration from two ISO-8601 strings."""
    def parse(s: str):
        s = re.sub(r"[+-]\d{2}:\d{2}$", "", s.strip())
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f"):
            try:
                return datetime.strptime(s, fmt)
            except ValueError:
                pass
        return None

    try:
        t0, t1 = parse(start_iso), parse(end_iso)
        if t0 and t1:
            secs = max(0, int((t1 - t0).total_seconds()))
            m, s = divmod(secs, 60)
            h, m = divmod(m, 60)
            if h:
                return f"{h}h {m}m {s}s"
            if m:
                return f"{m}m {s}s"
            return f"{s}s"
    except Exception:
        pass
    return "N/A"


def total_duration(config: dict, results: list) -> str:
    starts = [r["startedAt"] for r in results if r.get("startedAt")]
    ends = [r["finishedAt"] for r in results if r.get("finishedAt")]
    start = min(starts) if starts else config.get("startedAt", "")
    end = max(ends) if ends else ""
    if start and end:
        return fmt_duration(start, end)
    return "N/A"


# ─────────────────────────────────────────────
#  HTML Generator
# ─────────────────────────────────────────────

def _esc(s) -> str:
    """Minimal HTML escaping."""
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _build_tc_rows(results: list) -> str:
    rows = []
    for r in results:
        s = r["status"]
        bug_count = len(r.get("bugs", []))
        rows.append(
            f"      <tr>\n"
            f"        <td><strong>{_esc(r['id'])}</strong></td>\n"
            f"        <td>{_esc(r['title'])}</td>\n"
            f"        <td>{_esc(r.get('scenario', ''))}</td>\n"
            f"        <td>{_esc(r.get('action', ''))}</td>\n"
            f"        <td><span class=\"status-badge s-{_esc(s)}\">{_esc(s)}</span></td>\n"
            f"        <td>{_esc(r.get('keyAssert', ''))}</td>\n"
            f"        <td>{bug_count}</td>\n"
            f"      </tr>"
        )
    return "\n".join(rows)


def _build_bug_cards(results: list, run_dir: Path, embed: bool) -> str:
    all_bugs = [(r["id"], b) for r in results for b in r.get("bugs", [])]
    if not all_bugs:
        return ""

    cards = []
    for tc_id, bug in all_bugs:
        sev = bug["severity"]
        sev_upper = sev.upper()

        ss_html = ""
        if bug.get("screenshot"):
            ss_path = run_dir / tc_id / bug["screenshot"]
            if ss_path.exists():
                src = img_b64(ss_path) if embed else _esc(f"{tc_id}/{bug['screenshot']}")
                if src:
                    ss_html = (
                        f'<div class="row"><span class="lbl">Screenshot:</span>'
                        f'<span class="val"><img src="{src}" '
                        f'style="max-width:200px;cursor:zoom-in" onclick="zoomImg(this)"></span></div>'
                    )
            else:
                warn(f"Screenshot not found: {ss_path}")

        ux_html = ""
        if bug.get("recommendUXFix"):
            ux_html = f'<div class="rec-ux">🎨 UX/UI: {_esc(bug["recommendUXFix"])}</div>'

        cards.append(
            f'  <div class="bug-card sev-{_esc(sev)}">\n'
            f'    <div class="bug-header">\n'
            f'      <span class="bug-id">{_esc(tc_id)}</span>\n'
            f'      <span class="bug-sev sev-{_esc(sev_upper)}">{_esc(sev_upper)}</span>\n'
            f'    </div>\n'
            f'    <div class="bug-title">{_esc(bug["title"])}</div>\n'
            f'    <div class="row"><span class="lbl">Expected:</span><span class="val">{_esc(bug["expected"])}</span></div>\n'
            f'    <div class="row"><span class="lbl">Actual:</span><span class="val">{_esc(bug["actual"])}</span></div>\n'
            f'    <div class="row"><span class="lbl">Step:</span><span class="val">{_esc(str(bug["stepRef"]))}</span></div>\n'
            f'    {ss_html}\n'
            f'    <div class="rec">💡 Fix: {_esc(bug["recommendFix"])}</div>\n'
            f'    {ux_html}\n'
            f'  </div>'
        )

    return (
        '\n<div class="section-title">🐛 Bug Details</div>\n'
        '<div class="bug-list">\n'
        + "\n".join(cards)
        + "\n</div>"
    )


def _build_healing(results: list) -> str:
    items = []
    for r in results:
        for h in r.get("healingLog", []):
            items.append(
                f'<div class="heal-item">'
                f'<strong>{_esc(r["id"])} Step {_esc(str(h.get("step", "?")))}: </strong>'
                f'{_esc(h.get("issue", ""))} → {_esc(h.get("action", ""))}'
                f'</div>'
            )
    if not items:
        return ""
    return '\n<div class="section-title">🔧 Self-Healing Log</div>\n' + "\n".join(items)


def _build_screenshots(results: list, run_dir: Path, embed: bool) -> str:
    sections = []
    for r in results:
        tc_id = r["id"]
        ss_dir = run_dir / tc_id / "screenshots"
        if not ss_dir.exists():
            continue
        files = sorted(
            [f for f in ss_dir.iterdir() if f.suffix.lower() in _MIME],
            key=lambda f: f.name,
        )
        if not files:
            continue
        items = []
        for f in files:
            label = f.stem.replace("-", " ").replace("_", " ")
            if embed:
                src = img_b64(f)
                if not src:
                    continue
            else:
                src = _esc(f"{tc_id}/screenshots/{f.name}")
            items.append(
                f'  <div class="ss-item">\n'
                f'    <img src="{src}" alt="{_esc(label)}" loading="lazy" onclick="zoomImg(this)">\n'
                f'    <div class="ss-label">{_esc(label)}</div>\n'
                f'  </div>'
            )
        if items:
            sections.append(
                f'<div class="section-title" style="font-size:13px;margin-left:48px;border-color:#cbd5e1;">'
                f'{_esc(tc_id)} — {_esc(r["title"])}</div>\n'
                f'<div class="ss-grid">\n'
                + "\n".join(items)
                + "\n</div>"
            )
    if not sections:
        return '<div style="margin:0 32px;color:#94a3b8;font-size:13px;padding-bottom:20px;">No screenshots found.</div>'
    return "\n".join(sections)


def generate_html(config: dict, results: list, run_dir: Path, *, embed_images: bool = True) -> str:
    """Generate a self-contained HTML dashboard report."""
    stats = compute_stats(results)
    dur = total_duration(config, results)

    run_id = _esc(config.get("runId", run_dir.name))
    base_url = _esc(config.get("url", ""))
    username = _esc(config.get("username", ""))
    started_at = _esc(config.get("startedAt", ""))
    input_file = _esc(config.get("inputFile", ""))
    gen_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    has_issues = stats["bug"] > 0 or stats["fail"] > 0
    findings_class = "finding-box has-issues" if has_issues else "finding-box"
    if has_issues:
        headline = f"{stats['pass']}/{stats['total']} test case PASS — phát hiện {stats['bug']} bug, {stats['fail']} fail"
    else:
        headline = f"Tất cả {stats['total']} test case PASS — hệ thống hoạt động đúng"

    all_findings = [f for r in results for f in r.get("findings", [])]
    if all_findings:
        findings_li = "\n    ".join(f"<li>{_esc(f)}</li>" for f in all_findings)
    else:
        findings_li = "<li>Không có ghi chú phát hiện thêm.</li>"

    progress = (
        f'<div class="seg seg-pass" style="width:{stats["pass_pct"]}%"></div>'
        f'<div class="seg seg-bug"  style="width:{stats["bug_pct"]}%"></div>'
        f'<div class="seg seg-fail" style="width:{stats["fail_pct"]}%"></div>'
        f'<div class="seg seg-skip" style="width:{stats["skip_pct"]}%"></div>'
    )

    tc_rows = _build_tc_rows(results)
    bug_cards = _build_bug_cards(results, run_dir, embed_images)
    healing = _build_healing(results)
    screenshots = _build_screenshots(results, run_dir, embed_images)

    # Note: CSS curly-braces are doubled to escape Python f-string interpolation.
    return f"""<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Test Report — {run_id}</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #1a1a2e; }}
  .header {{ background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 24px 32px; }}
  .header h1 {{ font-size: 22px; font-weight: 600; letter-spacing: 0.5px; }}
  .header .meta {{ font-size: 13px; opacity: 0.65; margin-top: 4px; }}
  .cards {{ display: flex; gap: 16px; padding: 24px 32px 0; flex-wrap: wrap; }}
  .card {{ flex: 1; min-width: 160px; background: #fff; border-radius: 12px; padding: 20px 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }}
  .card .num {{ font-size: 36px; font-weight: 700; line-height: 1; }}
  .card .label {{ font-size: 13px; color: #666; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px; }}
  .card.total .num {{ color: #1a1a2e; }}
  .card.pass  .num {{ color: #22c55e; }}
  .card.bug   .num {{ color: #ef4444; }}
  .card.fail  .num {{ color: #f97316; }}
  .card.skip  .num {{ color: #94a3b8; }}
  .progress-bar {{ margin: 20px 32px 0; height: 8px; border-radius: 8px; background: #e2e8f0; overflow: hidden; display: flex; }}
  .progress-bar .seg {{ height: 100%; transition: width .3s; }}
  .seg-pass {{ background: #22c55e; }}
  .seg-bug  {{ background: #ef4444; }}
  .seg-fail {{ background: #f97316; }}
  .seg-skip {{ background: #94a3b8; }}
  .run-info {{ margin: 12px 32px 0; font-size: 12px; color: #888; }}
  .section-title {{ margin: 28px 32px 12px; font-size: 16px; font-weight: 600; color: #1a1a2e; border-left: 3px solid #6366f1; padding-left: 10px; }}
  .tc-table {{ margin: 0 32px; background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.08); overflow: hidden; }}
  .tc-table table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  .tc-table th {{ background: #f8fafc; padding: 10px 16px; text-align: left; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; }}
  .tc-table td {{ padding: 10px 16px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }}
  .tc-table tr:last-child td {{ border-bottom: none; }}
  .tc-table tr:hover td {{ background: #fafafa; }}
  .status-badge {{ display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }}
  .s-PASS    {{ background: #dcfce7; color: #15803d; }}
  .s-BUG     {{ background: #fee2e2; color: #dc2626; }}
  .s-FAIL    {{ background: #ffedd5; color: #c2410c; }}
  .s-SKIP    {{ background: #f1f5f9; color: #64748b; }}
  .s-UNKNOWN {{ background: #f1f5f9; color: #64748b; }}
  .finding-box {{ margin: 0 32px 12px; background: #f0fdf4; border-radius: 10px; padding: 16px 20px; border-left: 4px solid #22c55e; font-size: 13px; }}
  .finding-box.has-issues {{ background: #fff7ed; border-color: #f97316; }}
  .finding-box h3 {{ font-size: 14px; color: #15803d; margin-bottom: 8px; }}
  .finding-box.has-issues h3 {{ color: #c2410c; }}
  .finding-box ul {{ padding-left: 18px; }}
  .finding-box li {{ margin-bottom: 4px; color: #166534; }}
  .finding-box.has-issues li {{ color: #9a3412; }}
  .bug-list {{ margin: 0 32px; display: flex; flex-direction: column; gap: 12px; }}
  .bug-card {{ background: #fff; border-radius: 12px; border-left: 4px solid #ef4444; padding: 16px 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }}
  .bug-card.sev-medium {{ border-color: #f97316; }}
  .bug-card.sev-low    {{ border-color: #facc15; }}
  .bug-card .bug-header {{ display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }}
  .bug-card .bug-id  {{ font-size: 11px; font-weight: 700; color: #6366f1; background: #eef2ff; padding: 2px 8px; border-radius: 4px; }}
  .bug-card .bug-sev {{ font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; }}
  .sev-HIGH   {{ background: #fee2e2; color: #dc2626; }}
  .sev-MEDIUM {{ background: #ffedd5; color: #c2410c; }}
  .sev-LOW    {{ background: #fef9c3; color: #854d0e; }}
  .bug-card .bug-title {{ font-size: 14px; font-weight: 600; margin-bottom: 8px; }}
  .bug-card .row {{ display: flex; gap: 8px; margin-bottom: 4px; font-size: 12px; }}
  .bug-card .lbl {{ min-width: 90px; color: #64748b; font-weight: 600; }}
  .bug-card .val {{ color: #1a1a2e; }}
  .bug-card .rec {{ margin-top: 8px; background: #f0fdf4; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #166534; }}
  .bug-card .rec-ux {{ margin-top: 4px; background: #eff6ff; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #1e40af; }}
  .ss-grid {{ margin: 0 32px; display: flex; flex-wrap: wrap; gap: 10px; }}
  .ss-item {{ width: calc(25% - 8px); background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); font-size: 11px; }}
  .ss-item img {{ width: 100%; display: block; cursor: zoom-in; }}
  .ss-item .ss-label {{ padding: 4px 8px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
  .heal-item {{ margin: 0 32px 8px; background: #fefce8; border-radius: 8px; padding: 10px 14px; font-size: 12px; color: #713f12; border-left: 3px solid #facc15; }}
  .lightbox {{ display: none; position: fixed; inset: 0; background: rgba(0,0,0,.85); z-index: 1000; align-items: center; justify-content: center; }}
  .lightbox.active {{ display: flex; }}
  .lightbox img {{ max-width: 95vw; max-height: 95vh; border-radius: 8px; box-shadow: 0 8px 32px rgba(0,0,0,.5); }}
  .lightbox-close {{ position: fixed; top: 16px; right: 20px; color: #fff; font-size: 28px; cursor: pointer; line-height: 1; }}
  .footer {{ margin: 40px 32px 24px; font-size: 12px; color: #94a3b8; text-align: center; }}
</style>
</head>
<body>

<div class="header">
  <h1>🧪 Odoo E2E Test Report — {run_id}</h1>
  <div class="meta">
    {base_url} &nbsp;·&nbsp; {username} &nbsp;·&nbsp;
    Started: {started_at} &nbsp;·&nbsp; Duration: {dur}
  </div>
</div>

<div class="cards">
  <div class="card total"><div class="num">{stats['total']}</div><div class="label">Total</div></div>
  <div class="card pass"> <div class="num">{stats['pass']}</div><div class="label">Passed</div></div>
  <div class="card bug">  <div class="num">{stats['bug']}</div><div class="label">Bugs</div></div>
  <div class="card fail"> <div class="num">{stats['fail']}</div><div class="label">Failed</div></div>
  <div class="card skip"> <div class="num">{stats['skip']}</div><div class="label">Skipped</div></div>
</div>

<div class="progress-bar">{progress}</div>
<div class="run-info">Input file: {input_file} &nbsp;·&nbsp; {stats['pass']} passed / {stats['bug']} bugs / {stats['fail']} failed / {stats['skip']} skipped</div>

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
{tc_rows}
    </tbody>
  </table>
</div>

<div class="section-title">✅ Test Findings</div>
<div class="{findings_class}">
  <h3>{_esc(headline)}</h3>
  <ul>
    {findings_li}
  </ul>
</div>
{bug_cards}
{healing}

<div class="section-title">📸 Screenshots</div>
{screenshots}

<div class="footer">Generated by Odoo E2E Test Framework &nbsp;·&nbsp; {run_id} &nbsp;·&nbsp; {gen_time}</div>

<div class="lightbox" id="lb" onclick="this.classList.remove('active')">
  <span class="lightbox-close" onclick="document.getElementById('lb').classList.remove('active')">✕</span>
  <img id="lb-img" src="" alt="">
</div>

<script>
function zoomImg(el) {{
  document.getElementById('lb-img').src = el.src;
  document.getElementById('lb').classList.add('active');
}}
document.addEventListener('keydown', function(e) {{
  if (e.key === 'Escape') document.getElementById('lb').classList.remove('active');
}});
</script>

</body>
</html>"""


# ─────────────────────────────────────────────
#  Markdown Generator
# ─────────────────────────────────────────────

def generate_md(config: dict, results: list, run_dir: Path) -> str:
    """Generate a Markdown report."""
    stats = compute_stats(results)
    run_id = config.get("runId", run_dir.name)
    lines = []

    lines += [
        f"# Odoo E2E Test Report — {run_id}",
        "",
        f"**URL:** {config.get('url', 'N/A')}  ",
        f"**User:** {config.get('username', 'N/A')}  ",
        f"**Started:** {config.get('startedAt', 'N/A')}  ",
        f"**Input:** {config.get('inputFile', 'N/A')}  ",
    ]
    notes = config.get("notes", "")
    if notes:
        lines.append(f"**Notes:** {notes}  ")
    lines += ["", "## Summary", ""]
    lines += [
        "| Total | Passed | Bugs | Failed | Skipped |",
        "|-------|--------|------|--------|---------|",
        f"| {stats['total']} | {stats['pass']} | {stats['bug']} | {stats['fail']} | {stats['skip']} |",
        "",
    ]

    _STATUS_EMOJI = {"PASS": "✅", "BUG": "🐛", "FAIL": "❌", "SKIP": "⏭️", "UNKNOWN": "❓"}

    lines += ["## Test Cases", ""]
    lines += [
        "| ID | Title | Scenario | Action | Status | Key Assert | Bugs |",
        "|----|-------|----------|--------|--------|------------|------|",
    ]
    for r in results:
        s = r["status"]
        emoji = _STATUS_EMOJI.get(s, "❓")
        title = r["title"].replace("|", "\\|")
        scenario = r.get("scenario", "").replace("|", "\\|")
        action = r.get("action", "").replace("|", "\\|")
        key_assert = r.get("keyAssert", "").replace("|", "\\|")
        bug_count = len(r.get("bugs", []))
        lines.append(f"| {r['id']} | {title} | {scenario} | {action} | {emoji} {s} | {key_assert} | {bug_count} |")
    lines.append("")

    # Findings
    all_findings = [f for r in results for f in r.get("findings", [])]
    if all_findings:
        lines += ["## Test Findings", ""]
        for f in all_findings:
            lines.append(f"- {f}")
        lines.append("")

    # Bug details
    all_bugs = [(r["id"], b) for r in results for b in r.get("bugs", [])]
    if all_bugs:
        lines += ["## Bugs Found", ""]
        for i, (tc_id, bug) in enumerate(all_bugs, 1):
            sev = bug["severity"].upper()
            lines += [
                f"### Bug {i} ({tc_id}) — {sev} Severity",
                "",
                f"**{bug['title']}**",
                "",
                f"- **Expected:** {bug['expected']}",
                f"- **Actual:** {bug['actual']}",
                f"- **Step:** {bug['stepRef']}",
            ]
            if bug.get("recommendFix"):
                lines.append(f"- **Fix:** {bug['recommendFix']}")
            if bug.get("recommendUXFix"):
                lines.append(f"- **UX Fix:** {bug['recommendUXFix']}")
            lines.append("")

    # Healing log
    healing = [(r["id"], h) for r in results for h in r.get("healingLog", [])]
    if healing:
        lines += ["## Self-Healing Log", ""]
        for tc_id, h in healing:
            lines.append(f"- **{tc_id} Step {h.get('step', '?')}:** {h.get('issue', '')} → {h.get('action', '')}")
        lines.append("")

    lines += [
        "---",
        f"*Generated by Odoo E2E Test Framework · {run_id} · {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*",
        "",
    ]
    return "\n".join(lines)


# ─────────────────────────────────────────────
#  Plain Text Generator
# ─────────────────────────────────────────────

def generate_txt(config: dict, results: list, run_dir: Path) -> str:
    """Generate a plain-text report."""
    stats = compute_stats(results)
    run_id = config.get("runId", run_dir.name)
    SEP = "=" * 60
    SEP2 = "-" * 60
    lines = []

    lines += [
        SEP,
        f"  ODOO E2E TEST REPORT — {run_id}",
        SEP,
        f"  URL     : {config.get('url', 'N/A')}",
        f"  User    : {config.get('username', 'N/A')}",
        f"  Started : {config.get('startedAt', 'N/A')}",
        f"  Input   : {config.get('inputFile', 'N/A')}",
    ]
    notes = config.get("notes", "")
    if notes:
        lines.append(f"  Notes   : {notes}")
    lines += [
        "",
        "SUMMARY",
        SEP2,
        f"  Total   : {stats['total']}",
        f"  Passed  : {stats['pass']}  ({stats['pass_pct']}%)",
        f"  Bugs    : {stats['bug']}  ({stats['bug_pct']}%)",
        f"  Failed  : {stats['fail']}  ({stats['fail_pct']}%)",
        f"  Skipped : {stats['skip']}  ({stats['skip_pct']}%)",
        "",
        "TEST CASES",
        SEP2,
    ]

    _ICON = {"PASS": "[PASS]", "BUG": "[BUG] ", "FAIL": "[FAIL]", "SKIP": "[SKIP]", "UNKNOWN": "[????]"}
    for r in results:
        icon = _ICON.get(r["status"], "[????]")
        bug_count = len(r.get("bugs", []))
        bug_note = f"  ({bug_count} bug{'s' if bug_count != 1 else ''})" if bug_count else ""
        lines.append(f"  {icon} {r['id']}: {r['title']}{bug_note}")
        if r.get("keyAssert"):
            lines.append(f"           Assert : {r['keyAssert']}")
    lines.append("")

    all_findings = [f for r in results for f in r.get("findings", [])]
    if all_findings:
        lines += ["TEST FINDINGS", SEP2]
        for f in all_findings:
            lines.append(f"  {f}")
        lines.append("")

    all_bugs = [(r["id"], b) for r in results for b in r.get("bugs", [])]
    if all_bugs:
        lines += ["BUGS FOUND", SEP2]
        for tc_id, bug in all_bugs:
            sev = bug["severity"].upper()
            lines += [
                f"  [{sev}] {tc_id}: {bug['title']}",
                f"    Expected : {bug['expected']}",
                f"    Actual   : {bug['actual']}",
            ]
            if bug.get("recommendFix"):
                lines.append(f"    Fix      : {bug['recommendFix']}")
            lines.append("")

    lines += [
        SEP,
        f"  Generated by Odoo E2E Test Framework",
        f"  {run_id} · {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        SEP,
        "",
    ]
    return "\n".join(lines)


# ─────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        prog="generate-report.py",
        description="Generate Odoo E2E test report from run data.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("run_dir", help="Path to test run directory")
    parser.add_argument(
        "--format",
        choices=["html", "md", "txt", "all"],
        default="html",
        help="Output format (default: html)",
    )
    parser.add_argument(
        "--relative-images",
        action="store_true",
        help="Use relative image paths in HTML instead of base64 embedding",
    )
    parser.add_argument(
        "--output-dir",
        help="Directory to write reports (default: same as run-dir)",
    )

    args = parser.parse_args()

    print(f"\n{'='*52}")
    print("   Odoo E2E Report Generator")
    print(f"{'='*52}")

    config, test_cases, results, run_dir = collect_data(args.run_dir)
    out_dir = Path(args.output_dir).resolve() if args.output_dir else run_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    embed = not args.relative_images
    formats = ["html", "md", "txt"] if args.format == "all" else [args.format]

    generated: list[Path] = []
    for fmt in formats:
        if fmt == "html":
            content = generate_html(config, results, run_dir, embed_images=embed)
            out_path = out_dir / "report.html"
        elif fmt == "md":
            content = generate_md(config, results, run_dir)
            out_path = out_dir / "report.md"
        else:
            content = generate_txt(config, results, run_dir)
            out_path = out_dir / "report.txt"

        try:
            out_path.write_text(content, encoding="utf-8")
            info(f"Generated: {out_path}")
            generated.append(out_path)
        except OSError as exc:
            err(f"Failed to write {out_path}: {exc}")

    stats = compute_stats(results)
    print(f"\n{'─'*52}")
    print(f"  Test cases : {stats['total']}")
    print(f"  Result     : {stats['pass']} pass / {stats['bug']} bug / {stats['fail']} fail / {stats['skip']} skip")

    if _warnings:
        print(f"\n  Warnings ({len(_warnings)}):")
        for w in _warnings:
            print(f"    ⚠  {w}")

    if _errors:
        print(f"\n  Errors ({len(_errors)}):")
        for e in _errors:
            print(f"    ✗  {e}")

    if generated:
        print(f"\n  Reports written:")
        for p in generated:
            print(f"    📄 {p}")

    print(f"{'='*52}\n")

    if not generated:
        sys.exit(1)
    if _errors or _warnings:
        sys.exit(2)
    sys.exit(0)


if __name__ == "__main__":
    main()
