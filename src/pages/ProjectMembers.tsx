import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useProject } from "../context/ProjectContext";
import { usePermissions } from "../hooks/usePermissions";
import { addMember, updateMemberRole, removeMember } from "../lib/project-api";

const PROJECT_ROLES = ["owner", "lead", "member", "viewer"];

export default function ProjectMembers() {
  const { user } = useAuth();
  const { project, members, refresh } = useProject();
  const permissions = usePermissions();
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!project) return null;

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email || !newEmail.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await addMember(user.email, project.slug, newEmail.trim(), newRole);
      setNewEmail("");
      setNewRole("member");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    if (!user?.email) return;
    try {
      await updateMemberRole(user.email, project.slug, userId, role);
      refresh();
    } catch (err) {
      console.error("Failed to update role:", err);
    }
  };

  const handleRemove = async (userId: string, memberName: string) => {
    if (!user?.email) return;
    if (!confirm(`Remove ${memberName} from the project?`)) return;
    try {
      await removeMember(user.email, project.slug, userId);
      refresh();
    } catch (err) {
      console.error("Failed to remove member:", err);
    }
  };

  return (
    <div className="project-members">
      <h1>Team Members</h1>

      {permissions.canAddMembers && (
        <form onSubmit={handleAddMember} className="add-member-form">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email address (must have logged in before)"
            required
          />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {PROJECT_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Adding..." : "Add Member"}
          </button>
        </form>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="members-list">
        {members.map((member) => (
          <div key={member.user_id} className="member-row">
            <div className="member-info">
              {member.picture && (
                <img src={member.picture} alt={member.name} className="member-avatar" />
              )}
              <div>
                <span className="member-name">{member.name || member.email}</span>
                <span className="member-email">{member.email}</span>
              </div>
            </div>
            <div className="member-actions">
              {permissions.canAddMembers && member.email !== user?.email ? (
                <>
                  <select
                    value={member.role}
                    onChange={(e) => handleRoleChange(member.user_id, e.target.value)}
                  >
                    {PROJECT_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-danger-small"
                    onClick={() => handleRemove(member.user_id, member.name || member.email || "")}
                    type="button"
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="member-role-badge">{member.role}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
