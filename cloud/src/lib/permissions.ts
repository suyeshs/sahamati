/**
 * Granular Access Control for Sahamati
 *
 * Project Visibility:
 *   - private:  only explicit members can see it
 *   - internal: all @sahamati.org.in users can view, only members can edit
 *   - public:   all authenticated users can view (read-only unless member)
 *
 * Project Member Roles (ordered by privilege):
 *   - owner:  full control — delete project, transfer ownership, manage all members
 *   - admin:  manage members (except owner), manage settings, edit everything
 *   - editor: create/edit documents and phases
 *   - viewer: read-only access to project content
 */

export type ProjectVisibility = "private" | "internal" | "public";
export type ProjectRole = "owner" | "admin" | "editor" | "viewer";

export interface Permission {
  canView: boolean;
  canEdit: boolean;          // edit documents, update phases
  canManageMembers: boolean; // add/remove members (except owner)
  canManageSettings: boolean; // edit project name, description, visibility
  canDelete: boolean;        // delete the project entirely
  role: ProjectRole | null;  // null = not a member (viewing via visibility)
}

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

/**
 * Resolve permissions for a user on a project.
 *
 * @param memberRole - The user's role in project_members (null if not a member)
 * @param visibility - The project's visibility setting
 * @param isOrgUser  - Whether the user belongs to @sahamati.org.in
 */
export function resolvePermissions(
  memberRole: ProjectRole | null,
  visibility: ProjectVisibility,
  isOrgUser: boolean = true
): Permission {
  // Explicit members always get their role-based permissions
  if (memberRole) {
    return {
      canView: true,
      canEdit: memberRole !== "viewer",
      canManageMembers: ROLE_HIERARCHY[memberRole] >= ROLE_HIERARCHY.admin,
      canManageSettings: ROLE_HIERARCHY[memberRole] >= ROLE_HIERARCHY.admin,
      canDelete: memberRole === "owner",
      role: memberRole,
    };
  }

  // Not a member — check visibility
  if (visibility === "internal" && isOrgUser) {
    return {
      canView: true,
      canEdit: false,
      canManageMembers: false,
      canManageSettings: false,
      canDelete: false,
      role: null,
    };
  }

  if (visibility === "public") {
    return {
      canView: true,
      canEdit: false,
      canManageMembers: false,
      canManageSettings: false,
      canDelete: false,
      role: null,
    };
  }

  // Private and not a member
  return {
    canView: false,
    canEdit: false,
    canManageMembers: false,
    canManageSettings: false,
    canDelete: false,
    role: null,
  };
}

/**
 * Check if a role can manage (add/remove/change) another role.
 * Owners can manage anyone. Admins can manage editors and viewers.
 * No one can add/remove/change an owner except another owner.
 */
export function canManageRole(actorRole: ProjectRole, targetRole: ProjectRole): boolean {
  if (actorRole === "owner") return true;
  if (actorRole === "admin" && targetRole !== "owner" && targetRole !== "admin") return true;
  return false;
}

/**
 * Roles that a given actor can assign to members.
 */
export function assignableRoles(actorRole: ProjectRole): ProjectRole[] {
  if (actorRole === "owner") return ["admin", "editor", "viewer"];
  if (actorRole === "admin") return ["editor", "viewer"];
  return [];
}

export function isValidRole(role: string): role is ProjectRole {
  return ["owner", "admin", "editor", "viewer"].includes(role);
}

export function isValidVisibility(v: string): v is ProjectVisibility {
  return ["private", "internal", "public"].includes(v);
}
