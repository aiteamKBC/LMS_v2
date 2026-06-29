import { type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { PermissionLevel, AccessScope } from '@/mocks/rbac';

// ============================================================
// PermissionGate — conditionally render children based on permission
// ============================================================

interface PermissionGateProps {
  permission: string;
  minLevel?: PermissionLevel;
  scope?: AccessScope;
  children: ReactNode;
  /** Content to show when permission is denied */
  fallback?: ReactNode;
}

export function PermissionGate({
  permission,
  minLevel = 'view',
  scope,
  children,
  fallback = null,
}: PermissionGateProps) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission, minLevel, scope)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// ============================================================
// RouteGuard — protect routes, redirect to login or 403
// ============================================================

interface RouteGuardProps {
  children: ReactNode;
  /** Optional: specific permission required */
  permission?: string;
  minLevel?: PermissionLevel;
  /** Fallback path if unauthorized */
  fallbackPath?: string;
}

export function RouteGuard({
  children,
  permission,
  minLevel = 'view',
  fallbackPath = '/login',
}: RouteGuardProps) {
  const { auth, hasPermission } = useAuth();

  // Not authenticated — redirect to login
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Permission check
  if (permission && !hasPermission(permission, minLevel)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return <>{children}</>;
}

// ============================================================
// RoleGate — conditionally render children based on role slug
// ============================================================

interface RoleGateProps {
  roles: string | string[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function RoleGate({ roles, children, fallback = null }: RoleGateProps) {
  const { auth } = useAuth();
  const allowedRoles = Array.isArray(roles) ? roles : [roles];
  const userSlugs = auth.roles.map(r => r.slug);

  const hasAccess = allowedRoles.some(r => userSlugs.includes(r) || r === '*');

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// ============================================================
// AdminGate — only render for admin roles (tenant admin, super admin)
// ============================================================

interface AdminGateProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AdminGate({ children, fallback = null }: AdminGateProps) {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}