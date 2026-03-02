import { useState } from "react";
import MarkdownViewer from "../components/MarkdownViewer";

const TEMPLATES = [
  {
    name: "Business Requirements Document",
    path: "docs/templates/BRD_TEMPLATE.md",
  },
  {
    name: "Intent Document",
    path: "docs/templates/INTENT_DOCUMENT_TEMPLATE.md",
  },
  {
    name: "Architecture Document",
    path: "docs/templates/ARCHITECTURE_TEMPLATE.md",
  },
  { name: "User Story", path: "docs/templates/USER_STORY_TEMPLATE.md" },
];

export default function TemplateGenerator() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="page templates">
      <h2>Template Generator</h2>
      <p>Select a template to preview. Copy and customize for your project.</p>
      <div className="template-selector">
        {TEMPLATES.map((t) => (
          <button
            key={t.path}
            className={`template-btn ${selected === t.path ? "active" : ""}`}
            onClick={() => setSelected(t.path)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div className="template-preview">
        <MarkdownViewer filePath={selected} />
      </div>
    </div>
  );
}
