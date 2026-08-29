import { type ReactNode } from 'react';
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
// Route protection lives elsewhere
// ============================================================
//
// A `RouteGuard` used to sit here. It was imported by nothing — every one of the
// 266 routes in router/config.tsx rendered unguarded, so a signed-out visitor
// pasting any path got the page — and it would not have been safe to wire up as
// written: it tested `auth.isAuthenticated`, which `previewAs` satisfies with no
// server session, and it redirected before `isInitialized`, which would have
// bounced a genuinely signed-in user to /login on every refresh.
//
// Both are fixed in `RequireAuth`, which the router applies to everything not
// listed in PUBLIC_PATHS. Use that; there is nothing to opt a route into.
//
// Nothing in this file is a security boundary either. It decides what this
// browser draws, and drawing is not access: the boundary is the session gate in
// front of the API (backend `login/api_gate.py`) plus the per-view decorators in
// `login/permissions.py`. Hiding a button that calls an ungated endpoint hides
// nothing.

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