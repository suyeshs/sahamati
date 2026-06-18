import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import GitHubRepoPicker from "../components/GitHubRepoPicker";
import { createProject } from "../lib/project-api";

export default function CreateProject() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email || !name.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const { project } = await createProject(user.email, {
        name: name.trim(),
        description: description.trim() || undefined,
        githubRepoUrl: githubRepoUrl.trim() || undefined,
      });
      navigate(`/projects/${project.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-project-page">
      <h1>Create New Project</h1>

      <form onSubmit={handleSubmit} className="create-project-form">
        <div className="form-group">
          <label htmlFor="project-name">Project Name *</label>
          <input
            id="project-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., AA Ecosystem Portal"
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="project-description">Description</label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of the project..."
            rows={3}
          />
        </div>

        <div className="form-group">
          <label>GitHub Repository (optional)</label>
          <GitHubRepoPicker value={githubRepoUrl} onChange={setGithubRepoUrl} />
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn" onClick={() => navigate("/")}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading || !name.trim()}>
            {loading ? "Creating..." : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  );
}
