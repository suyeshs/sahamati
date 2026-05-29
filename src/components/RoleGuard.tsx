import type { ReactNode } from "react";
import { usePermissions } from "../hooks/usePermissions";

interface RoleGuardProps {
  children: ReactNode;
  permission: keyof ReturnType<typeof usePermissions>;
  fallback?: ReactNode;
}

export default function RoleGuard({ children, permission, fallback = null }: RoleGuardProps) {
  const permissions = usePermissions();

  if (!permissions[permission]) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
