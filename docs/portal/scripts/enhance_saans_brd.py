#!/usr/bin/env python3
"""Split the SaaNs v2 BRD into sub-pages for the showcase section.

This module is imported by ``collect_docs.py`` when ``sources.yml`` marks
a BRD entry as ``showcase: true``.  It parses the source BRD into numbered
sections, writes them into ``docs/brds/<slug>/``, and injects three Mermaid
diagrams plus two admonitions highlighting load-bearing subsections.

Return value is a nested-dict/list structure suitable for insertion directly
into an MkDocs ``nav:`` subtree.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# --- Parsing -----------------------------------------------------------------


HEADING_PATTERNS = [
    (2, re.compile(r"^##\s+(?:(\d+)\.\s+)?(.+?)\s*$")),
    (3, re.compile(r"^###\s+(\d+\.\d+)\s+(.+?)\s*$")),
    (4, re.compile(r"^####\s+(\d+\.\d+\.\d+)\s+(.+?)\s*$")),
    (5, re.compile(r"^#####\s+(\d+\.\d+\.\d+\.\d+)\s+(.+?)\s*$")),
]


@dataclass
class Section:
    sid: str
    level: int
    title: str
    start: int  # line index of the heading
    end: int = 0  # exclusive; filled after parse
    first_child: int | None = None

    @property
    def body_start(self) -> int:
        """Line index of the first body line, after the heading."""
        return self.start + 1


def _match_heading(line: str) -> tuple[int, str, str] | None:
    for level, pat in HEADING_PATTERNS:
        m = pat.match(line)
        if not m:
            continue
        if level == 2:
            num, title = m.group(1), m.group(2).strip()
            sid = num if num else _slug(title)
        else:
            sid, title = m.group(1), m.group(2).strip()
        return level, sid, title
    return None


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "section"


def parse_brd(source: str) -> tuple[list[str], dict[str, Section]]:
    lines = source.splitlines()
    sections: list[Section] = []

    for idx, line in enumerate(lines):
        hit = _match_heading(line)
        if not hit:
            continue
        level, sid, title = hit
        sections.append(Section(sid=sid, level=level, title=title, start=idx))

    # Resolve end boundaries: a section runs until the next heading of
    # equal-or-shallower level.
    for i, sec in enumerate(sections):
        sec.end = len(lines)
        for j in range(i + 1, len(sections)):
            if sections[j].level <= sec.level:
                sec.end = sections[j].start
                break
        # First child = next section with a deeper level, before sec.end.
        for j in range(i + 1, len(sections)):
            if sections[j].start >= sec.end:
                break
            if sections[j].level > sec.level:
                sec.first_child = sections[j].start
                break

    return lines, {s.sid: s for s in sections}


# --- Extraction --------------------------------------------------------------


def _extract_range(lines: list[str], start: int, end: int) -> str:
    return "\n".join(lines[start:end]).rstrip() + "\n"


def _strip_leading_heading(text: str) -> str:
    stripped = text.lstrip("\n")
    if stripped.startswith("#"):
        idx = stripped.find("\n")
        if idx == -1:
            return ""
        stripped = stripped[idx + 1 :]
    return stripped.lstrip("\n")


def _shift_headings(text: str, delta: int) -> str:
    if delta == 0:
        return text
    out = []
    for line in text.splitlines():
        m = re.match(r"^(#{1,6})(\s|$)", line)
        if m:
            depth = len(m.group(1)) + delta
            depth = max(1, min(6, depth))
            line = "#" * depth + line[len(m.group(1)) :]
        out.append(line)
    return "\n".join(out)


def _section_body(lines: list[str], sections: dict[str, Section], sid: str) -> str:
    """Return the body of a section (everything after the heading, excluding sub-headings)."""
    sec = sections[sid]
    end = sec.first_child if sec.first_child is not None else sec.end
    return _extract_range(lines, sec.body_start, end).strip() + "\n"


def _section_full(lines: list[str], sections: dict[str, Section], sid: str) -> str:
    """Return the section with all children intact, but without its own heading line."""
    sec = sections[sid]
    body = _extract_range(lines, sec.body_start, sec.end).rstrip() + "\n"
    return body


# --- Mermaid blocks ----------------------------------------------------------


ARCHITECTURE_DIAGRAM = """
```mermaid
graph TB
  A[Sahamati Analyst] -->|HTTPS| CF[Cloudflare Pages<br/>React 19 SPA]
  CF -->|JSON + JWT cookie| API[FastAPI Backend<br/>async, on GCP VM]
  API --> OAuth[Google OAuth<br/>@sahamati.org.in]
  API --> LLM[Gemini<br/>structured intent extraction]
  LLM --> PB[Pipeline Builder<br/>deterministic]
  PB --> Motor[Motor async driver]
  Motor --> Mongo[(MongoDB)]
  Mongo --> Raw[anveshan<br/>raw events]
  Mongo --> Daily[saans_daily_stats]
  Mongo --> Monthly[monthly_stats]
  Mongo --> Last24h[saans_last_24h_stats]
```
""".strip()


PIPELINE_DIAGRAM = """
```mermaid
flowchart LR
  Raw[anveshan<br/>raw events] -->|Scheduled daily job<br/>IST-aligned day boundary| Daily[saans_daily_stats<br/>date × fip × aa × event]
  Daily -->|Monthly roll-up| Monthly[monthly_stats<br/>year × month × fip × aa × event]
  Raw -->|Rolling 24h window<br/>recomputed independently| Last24h[saans_last_24h_stats<br/>fip × aa × event]
  Daily -.-> Dash[Dashboard queries<br/>weighted mean per entity]
  Monthly -.-> Dash
  Last24h -.-> Dash
  TS[anveshan_ts<br/>Time-Series collection] -.->|Operating-hours<br/>filter fallback| Dash
```
""".strip()


TREND_DIAGRAM = """
```mermaid
flowchart TD
  Start[Trend chart request] --> G{Granularity}
  G -->|Monthly| M[monthly_stats]
  G -->|Daily or Weekly| OH{Operating<br/>hours}
  OH -->|all| D[saans_daily_stats]
  OH -->|business<br/>or non-business| W{Within last<br/>6 months}
  W -->|yes| TS[anveshan_ts<br/>Time-Series]
  W -->|no| RAW[anveshan<br/>raw collection]
```
""".strip()


# --- Page assembly -----------------------------------------------------------


@dataclass
class PageBuild:
    path: Path  # path relative to the out_dir
    title: str
    content: str
    # MkDocs nav entry — either {title: path} or {title: [subentries]}
    nav_label: str = ""


def _admonition(kind: str, title: str, body: str) -> str:
    indented = "\n".join("    " + line if line else "" for line in body.strip().splitlines())
    return f'!!! {kind} "{title}"\n\n{indented}\n'


def _make_index_page(lines: list[str], sections: dict[str, Section]) -> str:
    """Landing: doc preamble + Executive Summary + §§1-3, with architecture diagram up top."""
    exec_sid = "executive-summary"
    first_h2 = sections.get(exec_sid) or next(
        iter(s for s in sections.values() if s.level == 2), None
    )
    preamble_end = first_h2.start if first_h2 else 0
    preamble_lines = lines[:preamble_end]
    # Strip the original H1 line if present — the page uses a fresh one.
    preamble_text = "\n".join(
        line for line in preamble_lines if not line.lstrip().startswith("# ")
    ).strip()

    exec_body = (
        _section_body(lines, sections, exec_sid).rstrip()
        if exec_sid in sections
        else ""
    )

    body_parts = [
        "# SaaNs v2 — Business Requirements",
        "",
        preamble_text,
        "",
        "## Platform Overview",
        "",
        ARCHITECTURE_DIAGRAM,
        "",
        "## Executive Summary",
        "",
        exec_body,
        "",
    ]

    for sid in ("1", "2", "3"):
        if sid not in sections:
            continue
        sec = sections[sid]
        body_parts.append(f"## {sid}. {sec.title}")
        body_parts.append("")
        body_parts.append(_shift_headings(_section_full(lines, sections, sid), 0).rstrip())
        body_parts.append("")

    return "\n".join(body_parts).rstrip() + "\n"


def _make_solution_page(lines: list[str], sections: dict[str, Section]) -> str:
    parts = ["# Proposed Solution", ""]
    for sid in ("4.1", "4.2", "4.3"):
        if sid not in sections:
            continue
        sec = sections[sid]
        parts.append(f"## {sid} {sec.title}")
        parts.append("")
        parts.append(_shift_headings(_section_full(lines, sections, sid), 0).rstrip())
        parts.append("")
    parts.append(
        "> **See also:** the [Real-Time Dashboard](dashboard/index.md) section "
        "expands §4.4 across multiple sub-pages."
    )
    return "\n".join(parts).rstrip() + "\n"


def _make_dashboard_intro(lines: list[str], sections: dict[str, Section]) -> str:
    """§4.4 intro paragraph + architecture diagram."""
    intro = _section_body(lines, sections, "4.4") if "4.4" in sections else ""
    parts = [
        "# Real-Time Dashboard",
        "",
        ARCHITECTURE_DIAGRAM,
        "",
        intro.rstrip(),
        "",
        "## Subsections",
        "",
        "- [Dashboard Views](views.md) — the analytical hierarchy",
        "- [KPI Cards](kpis.md) — per-entity headline metrics",
        "- [How Metrics Are Calculated](calculation.md) — pre-computation pipeline and weighting rules",
        "- [Filters & Time Controls](filters.md)",
        "- [Trend Chart](trend-chart.md) — automatic data-source selection",
        "- [Per-Entity Analysis](per-entity.md) — rankings, drill-down, comparison",
        "- [AI-Generated Summary](ai-summary.md)",
        "- [Data Freshness & Auto-Refresh](freshness.md)",
        "- [Performance Targets](performance.md)",
        "- [Security & Access Controls](security.md)",
    ]
    return "\n".join(parts).rstrip() + "\n"


def _make_simple_subpage(
    lines: list[str],
    sections: dict[str, Section],
    sid: str,
    title: str,
) -> str:
    if sid not in sections:
        return f"# {title}\n\n*Section not found in source BRD.*\n"
    body = _section_full(lines, sections, sid)
    body = _shift_headings(body, -2)  # level 4 in source -> level 2 here
    return f"# {title}\n\n{body.rstrip()}\n"


def _make_calculation_page(lines: list[str], sections: dict[str, Section]) -> str:
    """§4.4.3 + all 4.4.3.x, with pipeline Mermaid after the intro and two admonitions."""
    if "4.4.3" not in sections:
        return "# How Metrics Are Calculated\n\n*Section not found.*\n"
    sec = sections["4.4.3"]
    intro_text = _section_body(lines, sections, "4.4.3").rstrip()

    parts = [
        "# How Metrics Are Calculated",
        "",
        intro_text,
        "",
        PIPELINE_DIAGRAM,
        "",
    ]

    # Sub-subsections 4.4.3.1 .. 4.4.3.N in source order
    sub_ids = sorted(
        (s for s in sections if s.startswith("4.4.3.")),
        key=lambda x: int(x.rsplit(".", 1)[-1]),
    )

    for sub_sid in sub_ids:
        sub = sections[sub_sid]
        heading = f"## {sub_sid} {sub.title}"
        body = _section_body(lines, sections, sub_sid).rstrip()

        if sub_sid == "4.4.3.5":
            # UserDiscovery exclusion is load-bearing — wrap in a warning.
            parts.append(heading)
            parts.append("")
            parts.append(
                _admonition(
                    "warning",
                    "Load-bearing rule",
                    "The UserDiscovery exclusion is the reason ecosystem headline numbers "
                    "match the per-event breakdown below them. Do not silently include "
                    "UserDiscovery in KPI roll-ups — it dominates the count-weighted average "
                    "and makes the user-critical flows (ConsentPost, FIFetch, …) statistically "
                    "invisible.",
                )
            )
            parts.append("")
            parts.append(body)
            parts.append("")
        elif sub_sid == "4.4.3.8":
            # Operating-hours IST offset — worth highlighting.
            parts.append(heading)
            parts.append("")
            parts.append(
                _admonition(
                    "note",
                    "Timezone offset",
                    "Day and hour boundaries are IST-aligned (UTC + 5:30, i.e. 19,800,000 ms). "
                    "Analysts perceive a \"day\" in IST, so all aggregation boundaries match.",
                )
            )
            parts.append("")
            parts.append(body)
            parts.append("")
        else:
            parts.append(heading)
            parts.append("")
            parts.append(body)
            parts.append("")

    return "\n".join(parts).rstrip() + "\n"


def _make_trend_chart_page(lines: list[str], sections: dict[str, Section]) -> str:
    if "4.4.5" not in sections:
        return "# Trend Chart\n\n*Section not found.*\n"
    body = _section_body(lines, sections, "4.4.5").rstrip()
    return (
        "# Trend Chart\n\n"
        f"{body}\n\n"
        "## Data-Source Selection Flow\n\n"
        f"{TREND_DIAGRAM}\n\n"
        "The chart transparently picks the fastest accurate source based on "
        "granularity, operating-hours filter, and time window.\n"
    )


def _make_combined_page(
    lines: list[str],
    sections: dict[str, Section],
    h1: str,
    ids: list[str],
) -> str:
    parts = [f"# {h1}", ""]
    for sid in ids:
        if sid not in sections:
            continue
        sec = sections[sid]
        parts.append(f"## {sid}. {sec.title}")
        parts.append("")
        parts.append(_shift_headings(_section_full(lines, sections, sid), 0).rstrip())
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


# --- Public entry point ------------------------------------------------------


def explode_brd(src: Path, out_dir: Path, docs_root: Path | None = None) -> list[Any]:
    """Split ``src`` (root BRD.md) into sub-pages under ``out_dir``.

    ``docs_root`` is the MkDocs docs directory — all returned paths are relative
    to it.  Defaults to ``out_dir``'s two-levels-up parent for backward
    compatibility with callers that use the standard ``<docs>/<cat>/<slug>/``
    layout.

    Returns a nav subtree (list of dicts) suitable for insertion into MkDocs nav.
    """
    source = src.read_text(encoding="utf-8")
    lines, sections = parse_brd(source)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "dashboard").mkdir(parents=True, exist_ok=True)

    if docs_root is None:
        docs_root = out_dir.parent.parent
    rel_root = out_dir.relative_to(docs_root).as_posix()  # e.g. "brds/saans-v2"

    def write(rel: str, content: str) -> str:
        path = out_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return f"{rel_root}/{rel}"

    index_path = write("index.md", _make_index_page(lines, sections))
    solution_path = write("solution-overview.md", _make_solution_page(lines, sections))

    dashboard_pages = [
        ("Introduction", "dashboard/index.md", _make_dashboard_intro(lines, sections)),
        (
            "Views",
            "dashboard/views.md",
            _make_simple_subpage(lines, sections, "4.4.1", "Dashboard Views"),
        ),
        (
            "KPIs",
            "dashboard/kpis.md",
            _make_simple_subpage(lines, sections, "4.4.2", "Key Performance Indicators"),
        ),
        (
            "How Metrics Are Calculated",
            "dashboard/calculation.md",
            _make_calculation_page(lines, sections),
        ),
        (
            "Filters & Time Controls",
            "dashboard/filters.md",
            _make_simple_subpage(lines, sections, "4.4.4", "Filters & Time Controls"),
        ),
        (
            "Trend Chart",
            "dashboard/trend-chart.md",
            _make_trend_chart_page(lines, sections),
        ),
        (
            "Per-Entity Analysis",
            "dashboard/per-entity.md",
            _make_simple_subpage(lines, sections, "4.4.6", "Per-Entity Analysis"),
        ),
        (
            "AI Summary",
            "dashboard/ai-summary.md",
            _make_simple_subpage(lines, sections, "4.4.7", "AI-Generated Summary"),
        ),
        (
            "Data Freshness",
            "dashboard/freshness.md",
            _make_simple_subpage(lines, sections, "4.4.8", "Data Freshness & Auto-Refresh"),
        ),
        (
            "Performance Targets",
            "dashboard/performance.md",
            _make_simple_subpage(lines, sections, "4.4.9", "Performance Targets"),
        ),
        (
            "Security & Access",
            "dashboard/security.md",
            _make_simple_subpage(lines, sections, "4.4.10", "Security & Access Controls"),
        ),
    ]

    dashboard_nav: list[dict[str, str]] = []
    for label, rel, content in dashboard_pages:
        page_path = write(rel, content)
        dashboard_nav.append({label: page_path})

    scope_risks = write(
        "scope-risks.md",
        _make_combined_page(
            lines, sections, "Scope, Assumptions & Risks", ["5", "6", "7", "8"]
        ),
    )
    budget_timeline = write(
        "budget-timeline.md",
        _make_combined_page(lines, sections, "Budget & Timeline", ["9", "10"]),
    )
    compliance_competitive = write(
        "compliance-competitive.md",
        _make_combined_page(
            lines, sections, "Compliance & Competitive Analysis", ["11", "12"]
        ),
    )
    dependencies = write(
        "dependencies.md",
        _make_combined_page(lines, sections, "Dependencies", ["13"]),
    )
    approval = write(
        "approval.md",
        _make_combined_page(lines, sections, "Approval", ["14"]),
    )
    appendices = write(
        "appendices.md",
        _make_combined_page(lines, sections, "Appendices", ["15"]),
    )

    nav: list[Any] = [
        {"Overview": index_path},
        {"Proposed Solution": solution_path},
        {"Real-Time Dashboard": dashboard_nav},
        {"Scope, Assumptions & Risks": scope_risks},
        {"Budget & Timeline": budget_timeline},
        {"Compliance & Competitive Analysis": compliance_competitive},
        {"Dependencies": dependencies},
        {"Approval": approval},
        {"Appendices": appendices},
    ]

    return nav


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        print("usage: enhance_saans_brd.py <BRD.md> <out_dir>", file=sys.stderr)
        raise SystemExit(2)
    src = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    nav = explode_brd(src, out)
    import json

    print(json.dumps(nav, indent=2))
