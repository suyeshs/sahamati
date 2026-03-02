export interface DocEntry {
  title: string;
  path: string;
  category: string;
}

export const DOC_MANIFEST: DocEntry[] = [
  { title: "README", path: "README.md", category: "Overview" },
  { title: "Quick Reference", path: "QUICK_REFERENCE.md", category: "Overview" },
  { title: "Software Development Process", path: "SOFTWARE_DEVELOPMENT_PROCESS.md", category: "Process Frameworks" },
  { title: "AI-Native Development Process", path: "AI_NATIVE_DEVELOPMENT_PROCESS.md", category: "Process Frameworks" },
  { title: "Process Comparison Guide", path: "PROCESS_COMPARISON_GUIDE.md", category: "Process Frameworks" },
  { title: "Agentic Documentation Framework", path: "AGENTIC_DOCUMENTATION_FRAMEWORK.md", category: "Automation" },
  { title: "Architecture Template", path: "docs/templates/ARCHITECTURE_TEMPLATE.md", category: "Templates" },
  { title: "BRD Template", path: "docs/templates/BRD_TEMPLATE.md", category: "Templates" },
  { title: "Intent Document Template", path: "docs/templates/INTENT_DOCUMENT_TEMPLATE.md", category: "Templates" },
  { title: "User Story Template", path: "docs/templates/USER_STORY_TEMPLATE.md", category: "Templates" },
];

export function groupByCategory(docs: DocEntry[]): Record<string, DocEntry[]> {
  return docs.reduce(
    (acc, doc) => {
      if (!acc[doc.category]) acc[doc.category] = [];
      acc[doc.category].push(doc);
      return acc;
    },
    {} as Record<string, DocEntry[]>
  );
}
