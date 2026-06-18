# sahamati

Welcome to the documentation portal for **sahamati**.

## Generating docs

This portal is fed by markdown files written into `docs/` by the `sahamati`
CLI. Run any of these from the repo root:

```bash
sahamati doc brd "build a payments system for X"
sahamati doc intent "introduce feature Y"
sahamati doc architecture "service Z high-level design"
sahamati doc security "assess service Z for OWASP top 10"
sahamati doc story "user can do W in interface V"
```

Each command writes a **draft** into `docs/.drafts/`. Drafts are excluded
from the published site. Publish a reviewed draft with:

```bash
sahamati status                  # see what's pending
sahamati publish <filename>      # move to docs/projects/<slug>/<phase>/ and commit
git push                         # triggers the docs workflow → GitHub Pages
```

## Sections

- **Projects** — generated documents grouped by phase (discovery, design, …)
