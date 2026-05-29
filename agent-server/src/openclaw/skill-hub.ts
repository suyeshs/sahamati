const CLAWHUB_API = "https://hub.openclaw.ai/api/v1";

export interface ClawHubSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  tags: string[];
  version: string;
}

export interface ClawHubSkillDetail extends ClawHubSkill {
  content: string;
  readme: string;
}

// Built-in skill catalog used as fallback when ClawHub API is unreachable
const BUILT_IN_SKILLS: ClawHubSkillDetail[] = [
  {
    id: "builtin-code-review",
    name: "code-review",
    description: "Review code for bugs, style issues, and suggest improvements",
    author: "openclaw",
    downloads: 0,
    tags: ["code", "review", "quality"],
    version: "1.0.0",
    content: `---\nname: "code-review"\ndescription: "Review code for bugs, style issues, and suggest improvements"\n---\n\n# Code Review\n\nWhen asked to review code, follow these steps:\n\n1. **Read the target files** thoroughly before commenting\n2. **Check for bugs** - logic errors, off-by-one, null/undefined risks\n3. **Check for security issues** - injection, XSS, exposed secrets\n4. **Check style** - naming conventions, consistent formatting\n5. **Suggest improvements** - performance, readability, maintainability\n\nProvide feedback as a structured list with severity (critical/warning/suggestion) and file:line references.\n`,
    readme: "A skill that enables structured code review with severity-based feedback.",
  },
  {
    id: "builtin-test-writer",
    name: "test-writer",
    description: "Generate unit and integration tests for existing code",
    author: "openclaw",
    downloads: 0,
    tags: ["testing", "unit-test", "code"],
    version: "1.0.0",
    content: `---\nname: "test-writer"\ndescription: "Generate unit and integration tests for existing code"\n---\n\n# Test Writer\n\nWhen asked to write tests:\n\n1. **Read the source code** to understand the function/module behavior\n2. **Identify edge cases** - empty inputs, boundary values, error conditions\n3. **Write tests** using the project's existing test framework\n4. **Cover happy path and error paths**\n5. **Use descriptive test names** that explain the expected behavior\n\nAlways run the tests after writing them to verify they pass.\n`,
    readme: "A skill for generating comprehensive test suites.",
  },
  {
    id: "builtin-doc-writer",
    name: "doc-writer",
    description: "Generate documentation from code - READMEs, API docs, and inline comments",
    author: "openclaw",
    downloads: 0,
    tags: ["documentation", "readme", "api-docs"],
    version: "1.0.0",
    content: `---\nname: "doc-writer"\ndescription: "Generate documentation from code"\n---\n\n# Documentation Writer\n\nWhen asked to document code:\n\n1. **Read the codebase** to understand architecture and key modules\n2. **Identify public APIs** - exported functions, classes, endpoints\n3. **Write clear descriptions** with usage examples\n4. **Include setup instructions** if documenting a project\n5. **Keep docs concise** - focus on what users need to know\n\nUse the project's existing documentation style and format.\n`,
    readme: "A skill for generating project and API documentation.",
  },
  {
    id: "builtin-refactor",
    name: "refactor",
    description: "Refactor code to improve structure, reduce duplication, and enhance readability",
    author: "openclaw",
    downloads: 0,
    tags: ["refactor", "clean-code", "quality"],
    version: "1.0.0",
    content: `---\nname: "refactor"\ndescription: "Refactor code to improve structure and readability"\n---\n\n# Refactoring\n\nWhen asked to refactor:\n\n1. **Understand the current code** before making changes\n2. **Identify code smells** - duplication, long functions, deep nesting\n3. **Apply small, incremental changes** - one refactoring at a time\n4. **Preserve behavior** - refactoring should not change functionality\n5. **Run tests** after each change to verify nothing broke\n\nExplain each refactoring step and why it improves the code.\n`,
    readme: "A skill for systematic code refactoring.",
  },
  {
    id: "builtin-git-workflow",
    name: "git-workflow",
    description: "Manage git operations - branching, commits, PRs, and conflict resolution",
    author: "openclaw",
    downloads: 0,
    tags: ["git", "workflow", "version-control"],
    version: "1.0.0",
    content: `---\nname: "git-workflow"\ndescription: "Manage git operations and workflows"\n---\n\n# Git Workflow\n\nWhen managing git operations:\n\n1. **Always check status first** with git status and git log\n2. **Create descriptive branch names** following the project convention\n3. **Write meaningful commit messages** - explain why, not just what\n4. **Keep commits focused** - one logical change per commit\n5. **Review changes before committing** - use git diff\n\nNever force push to shared branches. Always confirm destructive operations with the user.\n`,
    readme: "A skill for managing git workflows and best practices.",
  },
  {
    id: "builtin-api-builder",
    name: "api-builder",
    description: "Design and implement REST APIs with proper error handling and validation",
    author: "openclaw",
    downloads: 0,
    tags: ["api", "rest", "backend"],
    version: "1.0.0",
    content: `---\nname: "api-builder"\ndescription: "Design and implement REST APIs"\n---\n\n# API Builder\n\nWhen building APIs:\n\n1. **Follow REST conventions** - proper HTTP methods, status codes, URL patterns\n2. **Validate inputs** at the boundary - request body, query params, path params\n3. **Handle errors gracefully** - return structured error responses\n4. **Add proper types** for request/response schemas\n5. **Consider authentication** and authorization requirements\n\nUse the project's existing patterns for middleware, routing, and error handling.\n`,
    readme: "A skill for building well-structured REST APIs.",
  },
  {
    id: "builtin-debug",
    name: "debug",
    description: "Systematic debugging - trace errors, analyze logs, and identify root causes",
    author: "openclaw",
    downloads: 0,
    tags: ["debug", "troubleshoot", "errors"],
    version: "1.0.0",
    content: `---\nname: "debug"\ndescription: "Systematic debugging and error tracing"\n---\n\n# Debugging\n\nWhen debugging issues:\n\n1. **Reproduce the problem** - understand the exact steps and expected vs actual behavior\n2. **Read error messages carefully** - stack traces, error codes, log output\n3. **Trace the data flow** - follow the execution path from input to error\n4. **Check recent changes** - use git log/diff to find what changed\n5. **Test hypotheses** - make one change at a time and verify\n\nNever guess at fixes. Always understand the root cause before making changes.\n`,
    readme: "A skill for systematic debugging and root cause analysis.",
  },
];

function searchBuiltInSkills(queryStr: string): ClawHubSkill[] {
  const q = queryStr.toLowerCase();
  return BUILT_IN_SKILLS.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.tags.some((t) => t.toLowerCase().includes(q))
  );
}

export async function searchSkills(queryStr: string): Promise<ClawHubSkill[]> {
  // Try remote ClawHub API first
  try {
    const res = await fetch(
      `${CLAWHUB_API}/skills/search?q=${encodeURIComponent(queryStr)}&limit=20`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const data = (await res.json()) as { skills?: ClawHubSkill[] };
      const remote = data.skills ?? [];
      if (remote.length > 0) return remote;
    }
  } catch {
    // ClawHub API unreachable - fall through to built-in catalog
  }

  // Fallback to built-in skill catalog
  return searchBuiltInSkills(queryStr);
}

export async function getSkillDetail(skillId: string): Promise<ClawHubSkillDetail | null> {
  // Check built-in catalog first
  const builtIn = BUILT_IN_SKILLS.find((s) => s.id === skillId);
  if (builtIn) return builtIn;

  // Try remote ClawHub API
  try {
    const res = await fetch(`${CLAWHUB_API}/skills/${encodeURIComponent(skillId)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ClawHubSkillDetail;
  } catch {
    return null;
  }
}
