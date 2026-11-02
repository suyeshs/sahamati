import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { streamSSE } from "hono/streaming";
import {
  createProject,
  getProjectBySlug,
  listProjectsForUser,
  listAllProjects,
  updateProject,
  archiveProject,
  deleteProject,
  getProjectPhases,
  updatePhaseStatus,
} from "../db/repositories/project-repo.js";
import { listMembers, addMember, updateMemberRole, removeMember } from "../db/repositories/member-repo.js";
import {
  createDocument,
  listDocuments,
  getDocument,
  deleteDocument,
} from "../db/repositories/document-repo.js";
import { getUserByEmail } from "../db/repositories/user-repo.js";
import { authMiddleware } from "../middleware/auth-middleware.js";
import { requireProjectPermission } from "../middleware/rbac-middleware.js";
import { runDirectAgent } from "../orchestrator.js";
import { getGitHubToken } from "../auth/github-store.js";
import { recordChange } from "../sync/sync-engine.js";
import { resolve, dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, unlinkSync, rmSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = process.env.__SAHAMATI_ROOT || resolve(__dirname, "../../..");
const DATA_DIR = join(PROJECT_ROOT, "data/projects");
const GENERATED_DIR = join(PROJECT_ROOT, "docs/generated");

const projects = new Hono<AppEnv>();

// --- Project CRUD ---

// List projects for current user
projects.get("/api/projects", authMiddleware, (c) => {
  const userRole = c.get("userRole");
  const userId = c.get("userId");

  const projectList =
    userRole === "admin" ? listAllProjects() : listProjectsForUser(userId);

  return c.json({ projects: projectList });
});

// Create project
projects.post("/api/projects", authMiddleware, async (c) => {
  const userId = c.get("userId");
  const { name, description, githubRepoUrl } = await c.req.json();

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }

  const project = createProject(name, userId, description, githubRepoUrl);

  // Create project data directory
  const projectDir = join(DATA_DIR, project.slug);
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
  }

  return c.json({ project }, 201);
});

// Get project details
projects.get(
  "/api/projects/:slug",
  authMiddleware,
  requireProjectPermission("view-project"),
  (c) => {
    const project = c.get("project");
    const phases = getProjectPhases(project.id);
    const members = listMembers(project.id);

    return c.json({ project, phases, members });
  }
);

// Update project
projects.put(
  "/api/projects/:slug",
  authMiddleware,
  requireProjectPermission("edit-project"),
  async (c) => {
    const slug = c.req.param("slug");
    const updates = await c.req.json();
    const project = updateProject(slug, updates);

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json({ project });
  }
);

// Archive project (soft delete — flips status to 'archived')
projects.delete(
  "/api/projects/:slug",
  authMiddleware,
  requireProjectPermission("delete-project"),
  (c) => {
    const slug = c.req.param("slug");
    archiveProject(slug);
    return c.json({ success: true });
  }
);

// Permanently delete project (hard delete — DB row + data/projects/{slug}/ folder)
projects.delete(
  "/api/projects/:slug/permanent",
  authMiddleware,
  requireProjectPermission("delete-project"),
  async (c) => {
    const slug = c.req.param("slug");
    const { confirmSlug } = await c.req.json().catch(() => ({ confirmSlug: undefined }));

    if (confirmSlug !== slug) {
      return c.json({ error: "confirmSlug must match the project slug" }, 400);
    }

    const deleted = deleteProject(slug);
    if (!deleted) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Remove on-disk project data (idempotent — won't fail if absent)
    const projectDir = join(DATA_DIR, slug);
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`Failed to remove project dir ${projectDir}:`, err);
    }

    return c.json({ success: true });
  }
);

// --- Phases ---

// List phases
projects.get(
  "/api/projects/:slug/phases",
  authMiddleware,
  requireProjectPermission("view-project"),
  (c) => {
    const projectId = c.get("projectId");
    const phases = getProjectPhases(projectId);
    return c.json({ phases });
  }
);

// Update phase status
projects.put(
  "/api/projects/:slug/phases/:phaseId",
  authMiddleware,
  requireProjectPermission("edit-project"),
  async (c) => {
    const { phaseId } = c.req.param();
    const { status } = await c.req.json();

    const validStatuses = ["not-started", "in-progress", "completed", "skipped"];
    if (!validStatuses.includes(status)) {
      return c.json({ error: `Invalid status. Must be: ${validStatuses.join(", ")}` }, 400);
    }

    updatePhaseStatus(phaseId, status);
    return c.json({ success: true });
  }
);

// --- Members ---

// List members
projects.get(
  "/api/projects/:slug/members",
  authMiddleware,
  requireProjectPermission("view-project"),
  (c) => {
    const projectId = c.get("projectId");
    const members = listMembers(projectId);
    return c.json({ members });
  }
);

// Add member
projects.post(
  "/api/projects/:slug/members",
  authMiddleware,
  requireProjectPermission("add-members"),
  async (c) => {
    const projectId = c.get("projectId");
    const { email, role } = await c.req.json();

    if (!email) {
      return c.json({ error: "email is required" }, 400);
    }

    const user = getUserByEmail(email);
    if (!user) {
      return c.json({ error: "User not found. They must log in first." }, 404);
    }

    const validRoles = ["owner", "lead", "member", "viewer"];
    addMember(projectId, user.id, validRoles.includes(role) ? role : "member");
    return c.json({ success: true }, 201);
  }
);

// Update member role
projects.put(
  "/api/projects/:slug/members/:userId",
  authMiddleware,
  requireProjectPermission("add-members"),
  async (c) => {
    const projectId = c.get("projectId");
    const { userId } = c.req.param();
    const { role } = await c.req.json();

    const updated = updateMemberRole(projectId, userId, role);
    if (!updated) {
      return c.json({ error: "Member not found" }, 404);
    }

    return c.json({ success: true });
  }
);

// Remove member
projects.delete(
  "/api/projects/:slug/members/:userId",
  authMiddleware,
  requireProjectPermission("add-members"),
  (c) => {
    const projectId = c.get("projectId");
    const { userId } = c.req.param();

    removeMember(projectId, userId);
    return c.json({ success: true });
  }
);

// --- Documents ---

// List documents — auto-links any unlinked generated docs on first access
projects.get(
  "/api/projects/:slug/documents",
  authMiddleware,
  requireProjectPermission("view-documents"),
  (c) => {
    const projectId = c.get("projectId");
    const userId = c.get("userId");
    const slug = c.req.param("slug");
    const phaseId = c.req.query("phaseId");

    // Ingest any new .md files this project wrote into its own folder.
    // Generation is project-scoped (see buildAgentContext) so we never sweep
    // the shared docs/generated/ dir here — that path is opt-in via the
    // explicit link-generated endpoint, used only to migrate legacy output.
    ingestProjectPhaseDocs(projectId, slug, userId);

    const docs = listDocuments(projectId, phaseId || undefined);
    return c.json({ documents: docs });
  }
);

// Get document content
projects.get(
  "/api/projects/:slug/documents/:docId",
  authMiddleware,
  requireProjectPermission("view-documents"),
  (c) => {
    const { docId } = c.req.param();
    const projectId = c.get("projectId");
    const doc = getDocument(docId, projectId);

    if (!doc) {
      return c.json({ error: "Document not found" }, 404);
    }

    // Read file content
    const fullPath = join(DATA_DIR, c.req.param("slug"), doc.file_path);
    let content = "";
    if (existsSync(fullPath)) {
      content = readFileSync(fullPath, "utf-8");
    }

    return c.json({ document: doc, content });
  }
);

// Create/upload document
projects.post(
  "/api/projects/:slug/documents",
  authMiddleware,
  requireProjectPermission("manage-documents"),
  async (c) => {
    const projectId = c.get("projectId");
    const userId = c.get("userId");
    const slug = c.req.param("slug");
    const { title, phaseId, category, content, filename } = await c.req.json();

    if (!title || !content) {
      return c.json({ error: "title and content are required" }, 400);
    }

    // basename + charset allowlist: the filename comes from the client and is
    // joined into a filesystem path — never let it traverse out of the project dir.
    const safeName = basename(String(filename || "")).replace(/[^a-zA-Z0-9._-]+/g, "-");
    const docFilename =
      safeName && safeName !== "." && safeName !== ".."
        ? safeName
        : `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    const phaseName = phaseId ? "phase" : "general";
    const relPath = join(phaseName, docFilename);
    const fullPath = join(DATA_DIR, slug, relPath);

    // Ensure directory exists
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(fullPath, content, "utf-8");

    const doc = createDocument({
      projectId,
      phaseId,
      title,
      filename: docFilename,
      category: category || "general",
      filePath: relPath,
      createdBy: userId,
    });

    // Track for sync — include content for cloud portal
    recordChange("documents", doc.id, "INSERT", { ...(doc as unknown as Record<string, unknown>), content });

    return c.json({ document: doc }, 201);
  }
);

// Delete document
projects.delete(
  "/api/projects/:slug/documents/:docId",
  authMiddleware,
  requireProjectPermission("manage-documents"),
  (c) => {
    const { docId } = c.req.param();
    const projectId = c.get("projectId");
    const doc = getDocument(docId, projectId);
    if (!doc) {
      return c.json({ error: "Document not found" }, 404);
    }
    deleteDocument(docId, projectId);
    if (doc) {
      recordChange("documents", docId, "DELETE", doc as unknown as Record<string, unknown>);
    }
    return c.json({ success: true });
  }
);

// --- Project-scoped Agent Run ---

projects.post(
  "/api/projects/:slug/agent/run",
  authMiddleware,
  requireProjectPermission("run-agents"),
  async (c) => {
    const projectId = c.get("projectId");
    const userId = c.get("userId");
    const userEmail = c.get("userEmail");
    const slug = c.req.param("slug");
    const { prompt, agentType, phaseId } = await c.req.json();

    if (!prompt) {
      return c.json({ error: "prompt is required" }, 400);
    }

    // Set up project-scoped working directory
    const projectDir = join(DATA_DIR, slug);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }

    // Inject GitHub token if needed
    const prevGhToken = process.env.GH_TOKEN;
    const prevGithubToken = process.env.GITHUB_TOKEN;
    if (agentType === "process-docs" && userEmail) {
      const ghConn = getGitHubToken(userEmail);
      if (ghConn) {
        process.env.GH_TOKEN = ghConn.accessToken;
        process.env.GITHUB_TOKEN = ghConn.accessToken;
      }
    }

    return streamSSE(c, async (stream) => {
      let id = 0;

      const onMessage = async (msg: unknown) => {
        await stream.writeSSE({
          id: String(id++),
          event: "message",
          data: JSON.stringify(msg),
        });
      };

      try {
        const agentKey = agentType
          ? (`${agentType}-agent` as any)
          : "discovery-agent";

        const contextualPrompt = buildAgentContext(slug) + prompt;

        await runDirectAgent(agentKey, contextualPrompt, {
          cwd: PROJECT_ROOT,
          onMessage,
        });

        // Ingest any new docs the agent wrote into data/projects/{slug}/.
        const linked = ingestProjectPhaseDocs(projectId, slug, userId, phaseId);

        await stream.writeSSE({
          id: String(id++),
          event: "done",
          data: JSON.stringify({ status: "completed", projectId, phaseId, linkedDocs: linked.length }),
        });
      } catch (error) {
        await stream.writeSSE({
          id: String(id++),
          event: "error",
          data: JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        });
      } finally {
        if (prevGhToken !== undefined) process.env.GH_TOKEN = prevGhToken;
        else delete process.env.GH_TOKEN;
        if (prevGithubToken !== undefined)
          process.env.GITHUB_TOKEN = prevGithubToken;
        else delete process.env.GITHUB_TOKEN;
      }
    });
  }
);

// --- Bridge: Link generated docs into a project ---

// Map generated doc categories to project phase names
const CATEGORY_TO_PHASE: Record<string, string> = {
  business: "Discovery",
  requirements: "Requirements",
  knowledge: "Design",
  process: "Development",
  security: "Testing",
};

/**
 * Context prefix prepended to every agent user-prompt for a project run.
 * Tells the agent exactly where to read from and write to, overriding
 * any hard-coded `docs/generated/...` paths baked into skill files.
 */
function buildAgentContext(slug: string): string {
  const projectDir = join(DATA_DIR, slug);
  const outputDir = join(projectDir, "phase");
  return [
    "# Project Context",
    "",
    `- \`PROJECT_DIR\`: ${projectDir}`,
    `- \`OUTPUT_DIR\` (write all generated markdown here): ${outputDir}`,
    "",
    "`OUTPUT_DIR` is authoritative for this run. If your skill's workflow",
    "references `docs/generated/<category>/`, treat `OUTPUT_DIR` as the",
    "replacement — every Write should target a file inside `OUTPUT_DIR`.",
    "Read existing project files from `PROJECT_DIR` (not `docs/generated/`).",
    "",
    "---",
    "",
  ].join("\n");
}

function parseFrontMatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  const meta: Record<string, string> = {};
  if (!match) return meta;
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    meta[line.slice(0, idx).trim()] = line
      .slice(idx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return meta;
}

function inferCategoryFromFilename(filename: string): string | undefined {
  const upper = filename.toUpperCase();
  if (upper.startsWith("BRD-")) return "business";
  if (
    upper.startsWith("FRD-") ||
    upper.startsWith("US-") ||
    upper.startsWith("USER-STORIES-") ||
    upper.startsWith("USER-STORY-")
  ) {
    return "requirements";
  }
  if (upper.startsWith("HEALTH-REPORT-") || upper.startsWith("KB-")) return "knowledge";
  if (
    upper.startsWith("ARCH-") ||
    upper.startsWith("DEV-STANDARDS-") ||
    upper.startsWith("DEPLOY-RUNBOOK-") ||
    upper.startsWith("OPS-GUIDE-") ||
    upper.startsWith("API-DOCS-") ||
    upper.startsWith("SETUP-GUIDE-")
  ) {
    return "process";
  }
  if (upper.startsWith("SECURITY-ASSESSMENT-")) return "security";
  return undefined;
}

/**
 * Scan `data/projects/<slug>/{phase,general}/` for .md files that aren't yet
 * in the `documents` table and create DB rows for them.  Intended as the
 * post-hook for agent runs after they write directly into the project dir
 * via the `OUTPUT_DIR` directive.  Unlike `linkGeneratedDocsToProject`,
 * this function only touches the current project's own files — there is no
 * shared-folder sweep, so orphaned generation from other projects cannot
 * leak in.
 */
export function ingestProjectPhaseDocs(
  projectId: string,
  slug: string,
  userId: string,
  fallbackPhaseId?: string,
): Array<{ filename: string; category: string; docId: string }> {
  const linked: Array<{ filename: string; category: string; docId: string }> = [];
  const existingDocs = listDocuments(projectId);
  const existingFilenames = new Set(existingDocs.map((d) => d.filename));
  const phases = getProjectPhases(projectId);

  for (const subDir of ["phase", "general"] as const) {
    const dirPath = join(DATA_DIR, slug, subDir);
    if (!existsSync(dirPath)) continue;

    const files = readdirSync(dirPath).filter((f) => f.endsWith(".md"));
    for (const filename of files) {
      if (existingFilenames.has(filename)) continue;

      const fullPath = join(dirPath, filename);
      const content = readFileSync(fullPath, "utf-8");
      const meta = parseFrontMatter(content);

      const category = (
        meta.category ||
        inferCategoryFromFilename(filename) ||
        "general"
      ).toLowerCase();
      const phaseName = CATEGORY_TO_PHASE[category];
      const inferredPhase = phaseName
        ? phases.find((p) => p.name === phaseName)
        : undefined;
      const phaseForDoc =
        inferredPhase ?? (fallbackPhaseId ? phases.find((p) => p.id === fallbackPhaseId) : undefined);

      const doc = createDocument({
        projectId,
        phaseId: phaseForDoc?.id,
        title: meta.title || filename.replace(/\.md$/, ""),
        filename,
        category,
        filePath: join(subDir, filename),
        generatedBy: meta.generated_by || "documentation-agent",
        requiresReview: meta.requires_review === "true",
        confidence: meta.confidence ? parseFloat(meta.confidence) : undefined,
        createdBy: userId,
      });

      recordChange("documents", doc.id, "INSERT", {
        ...(doc as unknown as Record<string, unknown>),
        content,
      });
      linked.push({ filename, category, docId: doc.id });
    }
  }

  return linked;
}

/**
 * Scan docs/generated/ for new files and link them into a project.
 * Copies files to data/projects/{slug}/, creates DB records, and logs for sync.
 */
function linkGeneratedDocsToProject(
  projectId: string,
  slug: string,
  userId: string,
  category?: string
): Array<{ filename: string; category: string; docId: string }> {
  const linked: Array<{ filename: string; category: string; docId: string }> = [];
  const categories = category ? [category] : ["business", "requirements", "knowledge", "process"];

  // Get existing docs for this project to avoid duplicates
  const existingDocs = listDocuments(projectId);
  const existingFilenames = new Set(existingDocs.map((d) => d.filename));

  // Get project phases for mapping
  const phases = getProjectPhases(projectId);

  for (const cat of categories) {
    const catDir = join(GENERATED_DIR, cat);
    if (!existsSync(catDir)) continue;

    const files = readdirSync(catDir).filter((f) => f.endsWith(".md"));
    for (const filename of files) {
      if (existingFilenames.has(filename)) continue;

      const srcPath = join(catDir, filename);
      const content = readFileSync(srcPath, "utf-8");

      // Parse frontmatter
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const meta: Record<string, string> = {};
      if (fmMatch) {
        for (const line of fmMatch[1].split("\n")) {
          const idx = line.indexOf(":");
          if (idx > 0) {
            meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
          }
        }
      }

      // Copy file to project directory
      const phaseName = CATEGORY_TO_PHASE[cat] || "general";
      const phase = phases.find((p) => p.name === phaseName);
      const subDir = phase ? "phase" : "general";
      const relPath = join(subDir, filename);
      const destPath = join(DATA_DIR, slug, relPath);

      const destDir = dirname(destPath);
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      copyFileSync(srcPath, destPath);

      // Remove from shared generated dir so it won't be linked to other projects
      try { unlinkSync(srcPath); } catch { /* ignore if already removed */ }

      // Create DB record
      const doc = createDocument({
        projectId,
        phaseId: phase?.id,
        title: meta.title || filename.replace(/\.md$/, ""),
        filename,
        category: cat,
        filePath: relPath,
        generatedBy: meta.generated_by || "documentation-agent",
        requiresReview: meta.requires_review === "true",
        confidence: meta.confidence ? parseFloat(meta.confidence) : undefined,
        createdBy: userId,
      });

      // Record for sync — include content for cloud portal
      recordChange("documents", doc.id, "INSERT", { ...(doc as unknown as Record<string, unknown>), content });

      linked.push({ filename, category: cat, docId: doc.id });
    }
  }

  return linked;
}

// POST /api/projects/:slug/documents/link-generated
// Links all unlinked generated docs into this project
projects.post(
  "/api/projects/:slug/documents/link-generated",
  authMiddleware,
  requireProjectPermission("manage-documents"),
  async (c) => {
    const projectId = c.get("projectId");
    const userId = c.get("userId");
    const slug = c.req.param("slug");
    const body = await c.req.json().catch(() => ({}));
    const category = (body as { category?: string }).category;

    const linked = linkGeneratedDocsToProject(projectId, slug, userId, category);

    return c.json({
      linked: linked.length,
      documents: linked,
    });
  }
);

export default projects;
