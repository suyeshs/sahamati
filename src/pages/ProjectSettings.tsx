import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useProject } from "../context/ProjectContext";
import { usePermissions } from "../hooks/usePermissions";
import { updateProject, archiveProject, deleteProject } from "../lib/project-api";

export default function ProjectSettings() {
  const { user } = useAuth();
  const { project, refresh } = useProject();
  const permissions = usePermissions();
  const navigate = useNavigate();

  const [name, setName] = useState(project?.name || "");
  const [description, setDescription] = useState(project?.description || "");
  const [githubRepoUrl, setGithubRepoUrl] = useState(project?.github_repo_url || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (!project) return null;

  if (!permissions.canEditProject) {
    return (
      <div className="project-settings">
        <h1>Project Settings</h1>
        <p className="text-muted">You don't have permission to edit this project.</p>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;

    setSaving(true);
    setMessage(null);
    try {
      await updateProject(user.email, project.slug, {
        name: name.trim(),
        description: description.trim() || null,
        github_repo_url: githubRepoUrl.trim() || null,
      } as any);
      setMessage("Settings saved.");
      refresh();
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : "Failed to save"}`);
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!user?.email) return;
    if (!confirm("Are you sure you want to archive this project? It will be hidden from the project list.")) return;

    try {
      await archiveProject(user.email, project.slug);
      navigate("/");
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : "Failed to archive"}`);
    }
  };

  const handleDelete = async () => {
    if (!user?.email) return;
    if (deleteConfirmText !== project.slug) return;

    setDeleting(true);
    try {
      await deleteProject(user.email, project.slug);
      navigate("/");
    } catch (err) {
      setMessage(`Error: ${err instanceof Error ? err.message : "Failed to delete"}`);
      setDeleting(false);
    }
  };

  return (
    <div className="project-settings">
      <h1>Project Settings</h1>

      <form onSubmit={handleSave} className="settings-form">
        <div className="form-group">
          <label htmlFor="settings-name">Project Name</label>
          <input
            id="settings-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="settings-desc">Description</label>
          <textarea
            id="settings-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <div className="form-group">
          <label htmlFor="settings-github">GitHub Repository URL</label>
          <input
            id="settings-github"
            type="url"
            value={githubRepoUrl}
            onChange={(e) => setGithubRepoUrl(e.target.value)}
            placeholder="https://github.com/..."
          />
        </div>

        {message && <p className={message.startsWith("Error") ? "error-text" : "success-text"}>{message}</p>}

        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </form>

      {permissions.canDeleteProject && (
        <div className="danger-zone">
          <h3>Danger Zone</h3>
          <p>Archiving a project hides it from the project list. This can be undone by an admin.</p>
          <button type="button" className="btn btn-danger" onClick={handleArchive}>
            Archive Project
          </button>

          <hr style={{ margin: "1.5rem 0", border: 0, borderTop: "1px solid var(--border, #ddd)" }} />

          <p>
            <strong>Permanently delete this project.</strong> This removes the project, all members,
            phases, documents, and on-disk files. This cannot be undone.
          </p>

          {!showDeleteConfirm ? (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete Project Permanently
            </button>
          ) : (
            <div className="form-group">
              <label htmlFor="delete-confirm">
                Type <code>{project.slug}</code> to confirm:
              </label>
              <input
                id="delete-confirm"
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDelete}
                  disabled={deleteConfirmText !== project.slug || deleting}
                >
                  {deleting ? "Deleting..." : "I understand, delete permanently"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText("");
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
