#!/usr/bin/env python3
"""Collect source markdown across the Sahamati repo into the MkDocs tree.

Reads ``docs/portal/sources.yml`` and for every matched markdown file:

1. Copies it into ``docs/portal/docs/<category-id>/<slug>.md``.
2. Prepends an H1 derived from the configured title if one is missing.
3. Delegates to ``enhance_saans_brd`` for any entry flagged ``showcase: true``.
4. Builds a nav tree and writes a complete ``mkdocs.yml`` by concatenating
   ``mkdocs.base.yml`` with the generated ``nav:`` block.

The output directory and ``mkdocs.yml`` are gitignored — the collector is
idempotent and the source markdown stays put in its canonical location.
"""
from __future__ import annotations

import os
import re
import shutil
import sqlite3
import sys
from glob import glob
from pathlib import Path
from typing import Any

import yaml

SCRIPT_DIR = Path(__file__).resolve().parent
PORTAL_DIR = SCRIPT_DIR.parent
SOURCES_YML = PORTAL_DIR / "sources.yml"
MKDOCS_BASE = PORTAL_DIR / "mkdocs.base.yml"
MKDOCS_OUT = PORTAL_DIR / "mkdocs.yml"
DOCS_OUT = PORTAL_DIR / "docs"
OVERRIDES_ASSETS = PORTAL_DIR / "overrides" / "assets"

# Registry: source absolute path -> portal destination path (relative to DOCS_OUT).
# Populated during the copy pass and consulted during link rewriting.
PATH_REGISTRY: dict[Path, Path] = {}

sys.path.insert(0, str(SCRIPT_DIR))

# Heading used as the first H1 when the source file doesn't start with one.
SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    return SLUG_RE.sub("-", value.lower()).strip("-") or "doc"


def humanize_filename(stem: str) -> str:
    cleaned = stem.replace("_", " ").replace("-", " ").strip()
    return re.sub(r"\s+", " ", cleaned).title()


def read_first_h1(content: str) -> str | None:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
        if stripped and not stripped.startswith("#"):
            # Hit non-heading content before any H1 — stop scanning.
            return None
    return None


def ensure_h1(content: str, title: str) -> str:
    if read_first_h1(content) is not None:
        return content
    return f"# {title}\n\n{content.lstrip()}"


def strip_front_matter(content: str) -> str:
    """Remove a leading YAML front-matter block so it doesn't print as raw text."""
    if not content.startswith("---"):
        return content
    end = content.find("\n---", 3)
    if end == -1:
        return content
    return content[end + 4 :].lstrip("\n")


def resolve(path_str: str) -> Path:
    return (PORTAL_DIR / path_str).resolve()


def write_doc(
    category_id: str,
    slug: str,
    title: str,
    content: str,
) -> Path:
    out_path = DOCS_OUT / category_id / f"{slug}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(content, encoding="utf-8")
    return out_path


def process_single(
    category_id: str,
    src_path: Path,
    entry: dict[str, Any],
) -> tuple[str, str] | None:
    if not src_path.exists():
        print(f"  skip: {src_path} (not found)", file=sys.stderr)
        return None

    raw = src_path.read_text(encoding="utf-8")
    raw = strip_front_matter(raw)

    title = entry.get("title")
    if not title:
        title = read_first_h1(raw) or humanize_filename(src_path.stem)
    slug = slugify(entry.get("slug") or src_path.stem)
    content = ensure_h1(raw, title)

    out = write_doc(category_id, slug, title, content)
    rel = out.relative_to(DOCS_OUT)
    PATH_REGISTRY[src_path.resolve()] = rel
    print(f"  copied: {src_path.name:<60}  ->  {rel.as_posix()}")
    return title, rel.as_posix()


UNASSIGNED_PHASE = "__unassigned__"
PHASE_STATUS_LABELS = {
    "not-started": "not started",
    "in-progress": "in progress",
    "complete": "complete",
    "blocked": "blocked",
}


def _project_backlink(project: sqlite3.Row) -> str:
    """One-line markdown banner linking back to the project's portal dashboard."""
    return (
        f'[← Back to **{project["name"]}** project dashboard]'
        f'(/portal/projects/{project["slug"]})'
        '{: .project-backlink }'
    )


def _phase_status(phase: sqlite3.Row) -> str:
    raw = (phase["status"] or "").strip()
    return PHASE_STATUS_LABELS.get(raw, raw) if raw else ""


def _landing_for_project(
    project: sqlite3.Row,
    phases: list[sqlite3.Row],
    docs_by_phase: dict[str, list[tuple[sqlite3.Row, str]]],
) -> str:
    """Project landing: description + phase roadmap with links to each phase's docs."""
    lines: list[str] = [_project_backlink(project), "", f"# {project['name']}", ""]
    description = (project["description"] or "").strip()
    if description:
        lines.append(description)
        lines.append("")

    meta_bits = [f"**Status:** `{project['status']}`"]
    github = project["github_repo_url"]
    if github:
        meta_bits.append(f"**Repo:** [{github}]({github})")
    lines.append(" · ".join(meta_bits))
    lines.append("")

    any_docs = any(docs_by_phase.values())
    if not any_docs:
        lines.append("*No documents have been added to this project yet.*")
        return "\n".join(lines).rstrip() + "\n"

    for phase in phases:
        status = _phase_status(phase)
        suffix = f" _(in progress)_" if status == "in progress" else (
            f" _({status})_" if status else ""
        )
        lines.append(f"## {phase['name']}{suffix}")
        lines.append("")
        entries = docs_by_phase.get(phase["id"], [])
        if entries:
            for doc, slug in entries:
                lines.append(f"- [{doc['title']}]({slug}.md)")
        else:
            lines.append("*No documents yet.*")
        lines.append("")

    unassigned = docs_by_phase.get(UNASSIGNED_PHASE, [])
    if unassigned:
        lines.append("## Unassigned")
        lines.append("")
        for doc, slug in unassigned:
            lines.append(f"- [{doc['title']}]({slug}.md)")
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def process_sqlite_projects(
    category_id: str,
    category: dict[str, Any],
) -> tuple[list[Any], list[dict[str, Any]]]:
    """Walk the Sahamati app's SQLite DB and emit per-project pages.

    Returns (nav_entries, project_cards) — nav_entries is inserted under the
    category tab, project_cards powers the home-page project grid.
    """
    db_path = resolve(category["database"])
    data_dir = resolve(category["data_dir"])

    if not db_path.exists():
        print(f"  skip: database not found at {db_path}")
        return [], []
    if not data_dir.exists():
        print(f"  skip: project data dir not found at {data_dir}")
        return [], []

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    try:
        projects = conn.execute(
            """
            SELECT id, name, slug, description, status, github_repo_url
            FROM projects
            WHERE COALESCE(status, '') != 'archived'
            ORDER BY name COLLATE NOCASE
            """
        ).fetchall()
    except sqlite3.OperationalError as exc:
        print(f"  skip: projects table unreadable — {exc}")
        conn.close()
        return [], []

    nav: list[Any] = []
    cards: list[dict[str, Any]] = []

    for project in projects:
        slug = project["slug"]
        phases = conn.execute(
            """
            SELECT id, project_id, name, display_order, status
            FROM project_phases
            WHERE project_id = ?
            ORDER BY display_order
            """,
            (project["id"],),
        ).fetchall()
        docs = conn.execute(
            """
            SELECT id, title, filename, category, file_path, phase_id, created_at
            FROM documents
            WHERE project_id = ?
            ORDER BY created_at
            """,
            (project["id"],),
        ).fetchall()

        valid_phase_ids = {p["id"] for p in phases}
        proj_dir = DOCS_OUT / category_id / slug
        proj_dir.mkdir(parents=True, exist_ok=True)

        # Copy each document file into the project folder, tracking which phase it belongs to.
        docs_by_phase: dict[str, list[tuple[sqlite3.Row, str]]] = {}
        ingested_count = 0
        for doc in docs:
            src = data_dir / slug / doc["file_path"]
            if not src.exists():
                print(f"  warn: {slug}/{doc['filename']} missing at {src}")
                continue
            content = strip_front_matter(src.read_text(encoding="utf-8"))
            content = ensure_h1(content, doc["title"])
            content = f"{_project_backlink(project)}\n\n{content}"

            doc_slug = slugify(Path(doc["filename"]).stem)
            out = proj_dir / f"{doc_slug}.md"
            out.write_text(content, encoding="utf-8")
            PATH_REGISTRY[src.resolve()] = out.relative_to(DOCS_OUT)

            phase_key = doc["phase_id"] if doc["phase_id"] in valid_phase_ids else UNASSIGNED_PHASE
            docs_by_phase.setdefault(phase_key, []).append((doc, doc_slug))
            ingested_count += 1

        # Landing page uses the full phase roadmap (including empty phases).
        (proj_dir / "index.md").write_text(
            _landing_for_project(project, phases, docs_by_phase),
            encoding="utf-8",
        )

        # Nav: Overview + one section per phase that actually has docs, in display_order.
        proj_subnav: list[Any] = [
            {"Overview": f"{category_id}/{slug}/index.md"},
        ]
        for phase in phases:
            entries = docs_by_phase.get(phase["id"], [])
            if not entries:
                continue
            proj_subnav.append(
                {
                    phase["name"]: [
                        {doc["title"]: f"{category_id}/{slug}/{doc_slug}.md"}
                        for doc, doc_slug in entries
                    ]
                }
            )
        unassigned = docs_by_phase.get(UNASSIGNED_PHASE, [])
        if unassigned:
            proj_subnav.append(
                {
                    "Unassigned": [
                        {doc["title"]: f"{category_id}/{slug}/{doc_slug}.md"}
                        for doc, doc_slug in unassigned
                    ]
                }
            )

        nav.append({project["name"]: proj_subnav})

        # Home-page card: find the currently-active phase (in-progress) for the meta line.
        active_phase = next(
            (p["name"] for p in phases if (p["status"] or "") == "in-progress"),
            None,
        )
        cards.append(
            {
                "name": project["name"],
                "slug": slug,
                "description": (project["description"] or "").strip(),
                "status": project["status"] or "unknown",
                "active_phase": active_phase,
                "doc_count": ingested_count,
                "landing": f"{category_id}/{slug}/index.md",
            }
        )
        print(
            f"  project: {project['name']:<32}  "
            f"({ingested_count} docs across {sum(1 for p in phases if docs_by_phase.get(p['id']))} "
            f"phase(s) -> {category_id}/{slug}/)"
        )

    conn.close()
    return nav, cards


def process_showcase_brd(
    category_id: str,
    src_path: Path,
    entry: dict[str, Any],
) -> tuple[str, list[Any]] | None:
    """Delegate to enhance_saans_brd.py for the BRD showcase split."""
    if not src_path.exists():
        print(f"  skip showcase: {src_path} (not found)", file=sys.stderr)
        return None

    from enhance_saans_brd import explode_brd

    slug_root = entry.get("slug", "saans-v2")
    target_dir = DOCS_OUT / category_id / slug_root
    nav_subtree = explode_brd(src_path, target_dir, docs_root=DOCS_OUT)
    title = entry.get("title") or "SaaNs v2 BRD"
    print(f"  showcase: {src_path.name} -> {target_dir.relative_to(DOCS_OUT)} ({len(nav_subtree)} pages)")
    return title, nav_subtree


MD_LINK_RE = re.compile(r"(!?)\[([^\]]*)\]\(([^)#?]+?)(#[^)]*)?\)")


def rewrite_links_in_file(portal_path: Path, source_abs: Path) -> int:
    """Rewrite links in a copied portal file. Returns count of rewrites."""
    if not portal_path.exists():
        return 0
    content = portal_path.read_text(encoding="utf-8")
    source_dir = source_abs.parent
    changes = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal changes
        bang, text, href, anchor = match.group(1), match.group(2), match.group(3), match.group(4) or ""
        # Skip absolute URLs, anchors, and non-markdown relative links.
        if href.startswith(("http://", "https://", "mailto:", "//", "/")):
            return match.group(0)
        if not href.lower().endswith(".md"):
            return match.group(0)
        try:
            target_abs = (source_dir / href).resolve()
        except (OSError, RuntimeError):
            return match.group(0)
        portal_target_rel = PATH_REGISTRY.get(target_abs)
        if portal_target_rel is None:
            # Unresolvable — drop the link, keep the text.
            changes += 1
            return f"{bang}{text}"
        # Compute relative path from this portal file to the target.
        this_rel = portal_path.relative_to(DOCS_OUT)
        new_href = os.path.relpath(portal_target_rel, start=this_rel.parent).replace(os.sep, "/")
        changes += 1
        return f"{bang}[{text}]({new_href}{anchor})"

    new_content = MD_LINK_RE.sub(replace, content)
    if changes:
        portal_path.write_text(new_content, encoding="utf-8")
    return changes


def rewrite_all_links() -> None:
    total = 0
    # Invert the registry: portal_path -> source_abs
    inverse = {(DOCS_OUT / rel).resolve(): src for src, rel in PATH_REGISTRY.items()}
    for portal_path, source_abs in inverse.items():
        total += rewrite_links_in_file(portal_path, source_abs)
    if total:
        print(f"\nlink rewriter: touched {total} links across {len(inverse)} files")


def build_index_page(
    config: dict[str, Any],
    project_cards: list[dict[str, Any]],
) -> str:
    lines: list[str] = [
        "# Sahamati Documentation",
        "",
        "Portal for Sahamati's internal and project documentation. Use the tabs",
        "above, the sidebar, or full-text search to navigate.",
        "",
        "## Your Projects",
        "",
    ]

    if project_cards:
        lines.append('<div class="grid cards" markdown>')
        lines.append("")
        for card in project_cards:
            lines.append(f"- **{card['name']}**")
            lines.append("")
            lines.append("    ---")
            lines.append("")
            if card["description"]:
                lines.append(f"    {card['description']}")
                lines.append("")
            meta_bits = [f"_Status:_ `{card['status']}`"]
            if card.get("active_phase"):
                meta_bits.append(f"_Phase:_ **{card['active_phase']}**")
            meta_bits.append(f"_{card['doc_count']} documents_")
            lines.append("    " + " &nbsp;·&nbsp; ".join(meta_bits))
            lines.append("")
            lines.append(f"    [→ Open project]({card['landing']})")
            lines.append("")
        lines.append("</div>")
        lines.append("")
    else:
        lines.append(
            "*No projects found in `data/sahamati.db`. Add a project via the "
            "Sahamati app and rebuild to see it here.*"
        )
        lines.append("")

    lines.append("## Reference")
    lines.append("")
    for cat in config["categories"]:
        if cat.get("source") == "sqlite":
            continue
        title = cat["title"]
        desc = cat.get("description", "").strip()
        lines.append(f"- **{title}** — {desc}" if desc else f"- **{title}**")
    return "\n".join(lines).rstrip() + "\n"


def collect() -> None:
    if DOCS_OUT.exists():
        shutil.rmtree(DOCS_OUT)
    DOCS_OUT.mkdir(parents=True)

    if OVERRIDES_ASSETS.exists():
        shutil.copytree(OVERRIDES_ASSETS, DOCS_OUT / "assets")

    config = yaml.safe_load(SOURCES_YML.read_text(encoding="utf-8"))

    nav: list[Any] = [{"Home": "index.md"}]
    project_cards: list[dict[str, Any]] = []

    for cat in config.get("categories", []):
        cat_id = cat["id"]
        cat_tab = cat["tab"]
        print(f"\n[{cat_tab}]")
        entries: list[Any] = []

        if cat.get("source") == "sqlite":
            sqlite_nav, sqlite_cards = process_sqlite_projects(cat_id, cat)
            entries.extend(sqlite_nav)
            project_cards.extend(sqlite_cards)
        else:
            for pattern in cat.get("patterns", []):
                if "from" in pattern:
                    src = resolve(pattern["from"])
                    if pattern.get("showcase"):
                        result = process_showcase_brd(cat_id, src, pattern)
                        if result:
                            title, subtree = result
                            entries.append({title: subtree})
                    else:
                        result = process_single(cat_id, src, pattern)
                        if result:
                            title, rel = result
                            entries.append({title: rel})
                elif "glob" in pattern:
                    glob_pattern = str(resolve(pattern["glob"]))
                    for fp in sorted(glob(glob_pattern)):
                        result = process_single(cat_id, Path(fp), pattern)
                        if result:
                            title, rel = result
                            entries.append({title: rel})

        if entries:
            nav.append({cat_tab: entries})
        else:
            print(f"  (no entries — tab omitted)")

    (DOCS_OUT / "index.md").write_text(
        build_index_page(config, project_cards), encoding="utf-8"
    )

    rewrite_all_links()

    base_cfg = MKDOCS_BASE.read_text(encoding="utf-8").rstrip() + "\n\n"
    nav_yaml = yaml.dump({"nav": nav}, sort_keys=False, allow_unicode=True)
    MKDOCS_OUT.write_text(base_cfg + nav_yaml, encoding="utf-8")
    print(f"\nwrote {MKDOCS_OUT.relative_to(PORTAL_DIR)}")


if __name__ == "__main__":
    collect()
