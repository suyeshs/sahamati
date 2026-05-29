import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useProject } from "../context/ProjectContext";

interface Permissions {
  canEditProject: boolean;
  canDeleteProject: boolean;
  canAddMembers: boolean;
  canRunAgents: boolean;
  canViewDocuments: boolean;
  canManageDocuments: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

export function usePermissions(): Permissions {
  const { user } = useAuth();
  const { members } = useProject();

  return useMemo(() => {
    const globalRole = (user as any)?.role || "member";
    const isAdmin = globalRole === "admin";

    // Find current user's project role
    const membership = members.find((m) => m.email === user?.email);
    const projectRole = membership?.role;

    const isOwner = projectRole === "owner";
    const isLead = projectRole === "lead";
    const isMember = projectRole === "member";

    return {
      canEditProject: isAdmin || isOwner || isLead,
      canDeleteProject: isAdmin || isOwner,
      canAddMembers: isAdmin || isOwner || isLead,
      canRunAgents: isAdmin || isOwner || isLead || isMember,
      canViewDocuments: true, // All project members can view
      canManageDocuments: isAdmin || isOwner || isLead || isMember,
      isOwner,
      isAdmin,
    };
  }, [user, members]);
}
