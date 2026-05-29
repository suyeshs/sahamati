/**
 * Project detail page — tabbed dashboard with phases, category-filtered docs,
 * members, and settings. Tabs: Workflow (phases view) + Architecture, Security,
 * Testing, Code Review, Operations (filtered by document category).
 */
import { layout, escapeHtml, formatDate, statusBadge } from "./layout";
import type { Permission } from "../lib/permissions";

type User = { email: string; name: string; picture: string };
type Row = Record<string, unknown>;

const CATEGORY_TABS: Array<{ id: string; label: string; cats: string[] }> = [
  { id: "architecture", label: "Architecture", cats: ["knowledge", "process"] },
  { id: "security", label: "Security", cats: ["security"] },
  { id: "testing", label: "Testing", cats: ["testing"] },
  { id: "code-review", label: "Code Review", cats: ["code-review"] },
  { id: "operations", label: "Operations", cats: ["operations"] },
];

export function projectPage(
  user: User,
  project: Row,
  phases: Row[],
  documents: Row[],
  members: Row[],
  permissions: Permission
): string {
  const slug = String(project.slug);
  const visibility = String(project.visibility || "private");

  // Match docs/portal/scripts/collect_docs.py slugify(): lowercase, non-alnum → "-", trimmed.
  const docSlug = (filename: string) => {
    const stem = filename.replace(/\.md$/i, "");
    return stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "doc";
  };
  const docsUrl = (d: Row) =>
    `/docs/projects/${encodeURIComponent(slug)}/${encodeURIComponent(docSlug(String(d.filename)))}/`;

  const docCard = (d: Row) => `
    <a href="${docsUrl(d)}"
       class="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 rounded-lg transition-colors">
      <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
      </svg>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(String(d.title))}</p>
        <p class="text-xs text-gray-400">${escapeHtml(String(d.category))} &middot; ${formatDate(String(d.updated_at))}</p>
      </div>
      ${Number(d.requires_review) ? '<span class="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Review</span>' : ""}
      <svg class="w-3.5 h-3.5 text-gray-300 group-hover:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
    </a>`;

  // ─── Workflow tab: phases + unlinked general docs ─────────────────
  const docsByPhase = new Map<string, Row[]>();
  const unlinkedDocs: Row[] = [];
  for (const doc of documents) {
    if (doc.phase_id) {
      const key = String(doc.phase_id);
      if (!docsByPhase.has(key)) docsByPhase.set(key, []);
      docsByPhase.get(key)!.push(doc);
    } else {
      unlinkedDocs.push(doc);
    }
  }

  const phaseHtml = phases
    .map((phase) => {
      const phaseDocs = docsByPhase.get(String(phase.id)) || [];
      const docList = phaseDocs.length
        ? phaseDocs.map(docCard).join("")
        : '<p class="px-4 py-2 text-sm text-gray-400 italic">No documents yet</p>';

      return `
    <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center">
            <span class="text-indigo-600 font-semibold text-sm">${phase.display_order}</span>
          </div>
          <h3 class="font-semibold text-gray-900">${escapeHtml(String(phase.name))}</h3>
        </div>
        ${statusBadge(String(phase.status))}
      </div>
      <div class="p-2 space-y-0.5">${docList}</div>
    </div>`;
    })
    .join("");

  const unlinkedHtml = unlinkedDocs.length
    ? `<div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-100">
          <h3 class="font-semibold text-gray-900">General Documents</h3>
        </div>
        <div class="p-2 space-y-0.5">${unlinkedDocs.map(docCard).join("")}</div>
      </div>`
    : "";

  const workflowEmpty =
    !phases.length && !unlinkedDocs.length
      ? '<div class="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">No phases or documents synced yet.</div>'
      : "";

  // ─── Category tabs ───────────────────────────────────────────────
  const renderCategoryTab = (label: string, cats: string[]) => {
    const docs = documents.filter((d) => cats.includes(String(d.category)));
    if (!docs.length) {
      return `<div class="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p class="text-gray-400">No ${label.toLowerCase()} documents yet.</p>
        <p class="text-xs text-gray-300 mt-2">Documents tagged with category <code class="bg-gray-100 px-1.5 py-0.5 rounded">${cats.join(", ")}</code> will appear here.</p>
      </div>`;
    }
    return `<div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-100">
        <h3 class="font-semibold text-gray-900">${label}</h3>
        <p class="text-xs text-gray-400 mt-0.5">${docs.length} document${docs.length === 1 ? "" : "s"}</p>
      </div>
      <div class="p-2 space-y-0.5">${docs.map(docCard).join("")}</div>
    </div>`;
  };

  const tabButtons = [
    { id: "workflow", label: "Workflow" },
    ...CATEGORY_TABS.map((t) => ({ id: t.id, label: t.label })),
  ]
    .map(
      (t, i) => `
      <button type="button" data-tab="${t.id}"
        class="tab-btn px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
          i === 0 ? "tab-active text-indigo-600 border-indigo-600" : "text-gray-500 hover:text-gray-900 border-transparent"
        }">
        ${t.label}
      </button>`
    )
    .join("");

  const tabPanes =
    `<div data-tab-content="workflow" class="space-y-4">${phaseHtml}${unlinkedHtml}${workflowEmpty}</div>` +
    CATEGORY_TABS.map(
      (t) =>
        `<div data-tab-content="${t.id}" class="space-y-4" hidden>${renderCategoryTab(t.label, t.cats)}</div>`
    ).join("");

  // ─── Summary cards ───────────────────────────────────────────────
  const completedPhases = phases.filter((p) => String(p.status) === "completed").length;
  const progress = phases.length > 0 ? Math.round((completedPhases / phases.length) * 100) : 0;
  const summaryCards = `
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="bg-white rounded-xl border border-gray-200 px-4 py-3">
        <p class="text-xs text-gray-400 uppercase tracking-wide">Progress</p>
        <p class="text-2xl font-bold text-gray-900 mt-0.5">${progress}%</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 px-4 py-3">
        <p class="text-xs text-gray-400 uppercase tracking-wide">Phases</p>
        <p class="text-2xl font-bold text-gray-900 mt-0.5">${completedPhases}/${phases.length}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 px-4 py-3">
        <p class="text-xs text-gray-400 uppercase tracking-wide">Documents</p>
        <p class="text-2xl font-bold text-gray-900 mt-0.5">${documents.length}</p>
      </div>
      <div class="bg-white rounded-xl border border-gray-200 px-4 py-3">
        <p class="text-xs text-gray-400 uppercase tracking-wide">Members</p>
        <p class="text-2xl font-bold text-gray-900 mt-0.5">${members.length}</p>
      </div>
    </div>`;

  // ─── Sidebar pieces ──────────────────────────────────────────────
  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      owner: "bg-purple-100 text-purple-700",
      admin: "bg-blue-100 text-blue-700",
      editor: "bg-green-100 text-green-700",
      viewer: "bg-gray-100 text-gray-600",
    };
    const cls = colors[role] || "bg-gray-100 text-gray-600";
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${escapeHtml(role)}</span>`;
  };

  const visibilityBadge = (v: string) => {
    const map: Record<string, { cls: string; label: string; icon: string }> = {
      private: { cls: "bg-red-50 text-red-600 border-red-200", label: "Private", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
      internal: { cls: "bg-amber-50 text-amber-600 border-amber-200", label: "Internal", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
      public: { cls: "bg-green-50 text-green-600 border-green-200", label: "Public", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
    };
    const info = map[v] || map.private;
    return `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border ${info.cls}">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${info.icon}"/></svg>
      ${info.label}
    </span>`;
  };

  const memberRows = members
    .map(
      (m) => `
    <div class="flex items-center gap-3 px-3 py-2 group" data-user-id="${escapeHtml(String(m.id))}">
      ${
        m.picture
          ? `<img src="${escapeHtml(String(m.picture))}" alt="" class="w-8 h-8 rounded-full" referrerpolicy="no-referrer">`
          : `<div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center"><span class="text-indigo-600 text-xs font-medium">${escapeHtml(String(m.name || m.email || "?").charAt(0).toUpperCase())}</span></div>`
      }
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-gray-900 truncate">${escapeHtml(String(m.name || m.email || "Unknown"))}</p>
        <p class="text-xs text-gray-400 truncate">${escapeHtml(String(m.email || ""))}</p>
      </div>
      <div class="flex items-center gap-2">
        ${roleBadge(String(m.role))}
        ${permissions.canManageMembers && String(m.role) !== "owner" ? `<button onclick="removeMember('${escapeHtml(String(m.id))}')" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-all" title="Remove member">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>` : ""}
      </div>
    </div>`
    )
    .join("");

  const addMemberForm = permissions.canManageMembers
    ? `<div class="border-t border-gray-100 pt-3 mt-3">
        <p class="text-xs text-gray-400 mb-2">Add member</p>
        <div class="flex gap-2">
          <select id="newMemberSelect" class="flex-1 text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none">
            <option value="">Select user...</option>
          </select>
          <select id="newMemberRole" class="text-sm border border-gray-200 rounded-lg px-2 py-1.5">
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            ${permissions.role === "owner" ? '<option value="admin">Admin</option>' : ""}
          </select>
          <button onclick="addMember()" class="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">Add</button>
        </div>
      </div>`
    : "";

  const githubRepoUrl = project.github_repo_url ? String(project.github_repo_url) : "";
  const settingsPanel = permissions.canManageSettings
    ? `<div class="bg-white rounded-xl border border-gray-200 p-4">
        <h3 class="font-semibold text-gray-900 mb-3 text-sm">Settings</h3>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-gray-400 block mb-1">Visibility</label>
            <select id="visibilitySelect" onchange="updateVisibility()" class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none">
              <option value="private" ${visibility === "private" ? "selected" : ""}>Private — members only</option>
              <option value="internal" ${visibility === "internal" ? "selected" : ""}>Internal — all @sahamati.org.in</option>
              <option value="public" ${visibility === "public" ? "selected" : ""}>Public — all authenticated users</option>
            </select>
          </div>
          <div>
            <label class="text-xs text-gray-400 block mb-1">GitHub Repository</label>
            <div class="flex gap-2">
              <input id="githubRepoInput" type="text" value="${escapeHtml(githubRepoUrl)}"
                placeholder="owner/repo or https://github.com/owner/repo"
                class="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none" />
              <button type="button" onclick="saveGithubRepo()"
                class="px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap">
                ${githubRepoUrl ? "Update" : "Connect"}
              </button>
            </div>
            ${githubRepoUrl ? `<button type="button" onclick="clearGithubRepo()" class="mt-1.5 text-xs text-red-500 hover:text-red-700">Disconnect</button>` : ""}
            <p id="githubRepoStatus" class="text-xs mt-1.5 hidden"></p>
          </div>
        </div>
      </div>`
    : "";

  const accessNote = !permissions.role
    ? `<div class="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 mb-4">
        You're viewing this project as a ${visibility === "internal" ? "Sahamati org member" : "public viewer"}. Request access from a project admin to contribute.
      </div>`
    : "";

  const memberManagementScript = permissions.canManageMembers
    ? `
      const slug = "${escapeHtml(slug)}";
      const existingMemberIds = new Set(${JSON.stringify(members.map((m) => String(m.id)))});

      fetch("/api/portal/users")
        .then(r => r.json())
        .then(data => {
          const select = document.getElementById("newMemberSelect");
          // Sort: signed-in users first, then pending (no picture) in alphabetical groups.
          const list = data.users.filter(u => !existingMemberIds.has(u.id));
          list.sort((a, b) => {
            const ap = !a.picture ? 1 : 0, bp = !b.picture ? 1 : 0;
            if (ap !== bp) return ap - bp;
            return (a.name || "").localeCompare(b.name || "");
          });
          for (const u of list) {
            const opt = document.createElement("option");
            opt.value = u.id;
            const pending = !u.picture ? " — pending sign-in" : "";
            opt.textContent = u.name + " (" + u.email + ")" + pending;
            select.appendChild(opt);
          }
        });

      window.addMember = function() {
        const userId = document.getElementById("newMemberSelect").value;
        const role = document.getElementById("newMemberRole").value;
        if (!userId) return alert("Select a user first");
        fetch("/api/portal/projects/" + slug + "/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, role })
        })
        .then(r => r.json())
        .then(data => {
          if (data.success) location.reload();
          else alert(data.error || "Failed to add member");
        });
      }

      window.removeMember = function(userId) {
        if (!confirm("Remove this member from the project?")) return;
        fetch("/api/portal/projects/" + slug + "/members/" + userId, { method: "DELETE" })
        .then(r => r.json())
        .then(data => {
          if (data.success) location.reload();
          else alert(data.error || "Failed to remove member");
        });
      }

      window.updateVisibility = function() {
        const visibility = document.getElementById("visibilitySelect").value;
        fetch("/api/portal/projects/" + slug, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility })
        })
        .then(r => r.json())
        .then(data => {
          if (!data.success) alert(data.error || "Failed to update visibility");
        });
      }

      function showRepoStatus(msg, isError) {
        const el = document.getElementById("githubRepoStatus");
        if (!el) return;
        el.textContent = msg;
        el.className = "text-xs mt-1.5 " + (isError ? "text-red-600" : "text-green-600");
      }

      window.saveGithubRepo = function() {
        const value = document.getElementById("githubRepoInput").value.trim();
        if (!value) {
          showRepoStatus("Enter a repo URL or owner/repo, or use Disconnect.", true);
          return;
        }
        fetch("/api/portal/projects/" + slug, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ github_repo_url: value })
        })
        .then(r => r.json().then(d => ({ ok: r.ok, body: d })))
        .then(({ ok, body }) => {
          if (!ok || !body.success) {
            showRepoStatus(body.error || "Failed to save", true);
            return;
          }
          location.reload();
        });
      }

      window.clearGithubRepo = function() {
        if (!confirm("Disconnect GitHub repository from this project?")) return;
        fetch("/api/portal/projects/" + slug, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ github_repo_url: "" })
        })
        .then(r => r.json())
        .then(data => {
          if (!data.success) {
            showRepoStatus(data.error || "Failed to disconnect", true);
            return;
          }
          location.reload();
        });
      }
    `
    : "";

  const tabScript = `
    function setTab(id) {
      document.querySelectorAll('[data-tab-content]').forEach(el => {
        el.hidden = el.getAttribute('data-tab-content') !== id;
      });
      document.querySelectorAll('.tab-btn').forEach(btn => {
        const active = btn.getAttribute('data-tab') === id;
        btn.classList.toggle('tab-active', active);
        btn.classList.toggle('text-indigo-600', active);
        btn.classList.toggle('border-indigo-600', active);
        btn.classList.toggle('text-gray-500', !active);
        btn.classList.toggle('border-transparent', !active);
      });
      try { history.replaceState(null, '', '#tab=' + id); } catch (e) {}
    }
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => setTab(btn.getAttribute('data-tab')));
    });
    (function() {
      const m = (location.hash || '').match(/tab=([^&]+)/);
      if (m && document.querySelector('[data-tab-content="' + m[1] + '"]')) setTab(m[1]);
    })();
  `;

  return layout(
    String(project.name),
    user,
    `<main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="mb-6">
        <a href="/portal" class="text-sm text-indigo-600 hover:text-indigo-700 mb-2 inline-block">&larr; All Projects</a>
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div class="flex items-center gap-4 flex-wrap">
            <h1 class="text-2xl font-bold text-gray-900">${escapeHtml(String(project.name))}</h1>
            ${statusBadge(String(project.status))}
            ${visibilityBadge(visibility)}
            ${permissions.role ? roleBadge(permissions.role) : ""}
          </div>
          <a href="/docs/projects/${encodeURIComponent(slug)}/"
             class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
            Open in Docs Portal
          </a>
        </div>
        ${project.description ? `<p class="text-gray-500 mt-2">${escapeHtml(String(project.description))}</p>` : ""}
      </div>

      ${accessNote}

      ${summaryCards}

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div class="lg:col-span-3">
          <nav class="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto">
            ${tabButtons}
          </nav>
          ${tabPanes}
        </div>

        <div class="space-y-4">
          <div class="bg-white rounded-xl border border-gray-200 p-4">
            <h3 class="font-semibold text-gray-900 mb-3 text-sm">Team (${members.length})</h3>
            <div class="space-y-1">
              ${memberRows || '<p class="text-sm text-gray-400">No members</p>'}
            </div>
            ${addMemberForm}
          </div>

          ${settingsPanel}

          <div class="bg-white rounded-xl border border-gray-200 p-4">
            <h3 class="font-semibold text-gray-900 mb-3 text-sm">Details</h3>
            <dl class="space-y-2 text-sm">
              <div>
                <dt class="text-gray-400">Created</dt>
                <dd class="text-gray-700">${formatDate(String(project.created_at))}</dd>
              </div>
              <div>
                <dt class="text-gray-400">Updated</dt>
                <dd class="text-gray-700">${formatDate(String(project.updated_at))}</dd>
              </div>
              ${project.github_repo_url ? `<div><dt class="text-gray-400">GitHub</dt><dd><a href="${escapeHtml(String(project.github_repo_url))}" target="_blank" class="text-indigo-600 hover:underline truncate block">${escapeHtml(String(project.github_repo_url).replace(/https?:\/\/github\.com\//, ""))}</a></dd></div>` : ""}
            </dl>
          </div>
        </div>
      </div>
    </main>
    <script>${tabScript}${memberManagementScript}</script>`
  );
}
