import { useCallback, useMemo } from 'react';
import type { RoleDef, PermissionLevel, AccessScope } from '@/mocks/rbac';
import { PERMISSION_LEVELS, ROUTE_PERMISSIONS, NAV_PERMISSIONS } from '@/mocks/rbac';

function getLevelRank(level: PermissionLevel): number {
  const found = PERMISSION_LEVELS.find(l => l.value === level);
  return found?.rank ?? 0;
}

function buildPermissionMap(roles: RoleDef[]): Map<string, { level: PermissionLevel; scope: AccessScope }> {
  const map = new Map<string, { level: PermissionLevel; scope: AccessScope }>();

  for (const role of roles) {
    for (const perm of role.permissions) {
      const existing = map.get(perm.permissionSlug);

      if (existing) {
        const newRank = getLevelRank(perm.level);
        const existingRank = getLevelRank(existing.level);
        if (newRank > existingRank) {
          existing.level = perm.level;
        }
        if (perm.scope === 'global' || (perm.scope === 'tenant' && existing.scope !== 'global')) {
          existing.scope = perm.scope;
        }
      } else {
        map.set(perm.permissionSlug, {
          level: perm.level,
          scope: perm.scope,
        });
      }
    }
  }

  return map;
}

function hasWildcardAccess(roles: RoleDef[]): boolean {
  return roles.some(r => r.slug === 'super-admin' || r.slug === 'tenant-admin');
}

/** Existing UI permission projection; server authorization remains authoritative. */
export function useAuthPermissions(roles: RoleDef[], isAuthenticated: boolean) {
  // Build permission map from current roles
  const permissionMap = useMemo(() => buildPermissionMap(roles), [roles]);
  const isWildcard = useMemo(() => hasWildcardAccess(roles), [roles]);

  const hasPermission = useCallback((permissionSlug: string, minLevel: PermissionLevel = 'view', _scope?: AccessScope): boolean => {
    if (!isAuthenticated) return false;
    if (isWildcard) return true;

    const perm = permissionMap.get(permissionSlug);
    if (!perm) return false;

    const requiredRank = getLevelRank(minLevel);
    const actualRank = getLevelRank(perm.level);
    return actualRank >= requiredRank;
  }, [isAuthenticated, isWildcard, permissionMap]);

  const getPermissionLevel = useCallback((permissionSlug: string): PermissionLevel => {
    if (isWildcard) return 'full_admin';
    return permissionMap.get(permissionSlug)?.level ?? 'none';
  }, [isWildcard, permissionMap]);

  const getPermissionScope = useCallback((permissionSlug: string): AccessScope | null => {
    if (isWildcard) return 'global';
    return permissionMap.get(permissionSlug)?.scope ?? null;
  }, [isWildcard, permissionMap]);

  const canAccessRoute = useCallback((path: string): boolean => {
    if (!isAuthenticated) return path === '/' || path === '/login';

    let bestMatch = ROUTE_PERMISSIONS.find(r => r.path === path);
    if (!bestMatch) {
      bestMatch = ROUTE_PERMISSIONS
        .filter(r => path.startsWith(r.path))
        .sort((a, b) => b.path.length - a.path.length)[0];
    }

    if (!bestMatch) return false;

    if (bestMatch.allowedRoles?.includes('*')) return true;

    if (bestMatch.allowedRoles) {
      const userSlugs = roles.map(r => r.slug);
      return bestMatch.allowedRoles.some(r => userSlugs.includes(r));
    }

    return false;
  }, [isAuthenticated, roles]);

  const canSeeNavItem = useCallback((navId: string): boolean => {
    if (!isAuthenticated) return false;

    const navPerm = NAV_PERMISSIONS.find(n => n.navId === navId);
    if (!navPerm) return true;

    if (navPerm.allowedRoles?.includes('*')) return true;

    if (navPerm.allowedRoles) {
      const userSlugs = roles.map(r => r.slug);
      return navPerm.allowedRoles.some(r => userSlugs.includes(r));
    }

    return true;
  }, [isAuthenticated, roles]);

  return { hasPermission, canAccessRoute, canSeeNavItem, getPermissionLevel, getPermissionScope, isAdmin: isWildcard };
}
