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

export interface PhaseTemplate {
  title: string;
  filename: string;
  path: string;
  description: string;
}

const TEMPLATE: Record<string, PhaseTemplate> = {
  BRD: {
    title: "Business Requirements (BRD)",
    filename: "BRD_TEMPLATE.md",
    path: "docs/templates/BRD_TEMPLATE.md",
    description: "Captures business objectives, stakeholders, scope, and success criteria.",
  },
  INTENT: {
    title: "Intent Document",
    filename: "INTENT_DOCUMENT_TEMPLATE.md",
    path: "docs/templates/INTENT_DOCUMENT_TEMPLATE.md",
    description: "AI-native alternative to a BRD — declares outcome, constraints, and signals.",
  },
  USER_STORY: {
    title: "User Story",
    filename: "USER_STORY_TEMPLATE.md",
    path: "docs/templates/USER_STORY_TEMPLATE.md",
    description: "User-facing requirements with acceptance criteria.",
  },
  ARCHITECTURE: {
    title: "Architecture",
    filename: "ARCHITECTURE_TEMPLATE.md",
    path: "docs/templates/ARCHITECTURE_TEMPLATE.md",
    description: "System architecture, components, data flows, and tech decisions.",
  },
  SECURITY: {
    title: "Security Assessment",
    filename: "SECURITY_ASSESSMENT_TEMPLATE.md",
    path: "docs/templates/SECURITY_ASSESSMENT_TEMPLATE.md",
    description: "Threat model, controls, residual risk, and compliance posture.",
  },
};

export const PHASE_TEMPLATES: Record<string, PhaseTemplate[]> = {
  Discovery: [TEMPLATE.BRD, TEMPLATE.INTENT],
  Requirements: [TEMPLATE.USER_STORY],
  Design: [TEMPLATE.ARCHITECTURE],
  Development: [],
  Testing: [TEMPLATE.SECURITY],
  Deployment: [],
};
