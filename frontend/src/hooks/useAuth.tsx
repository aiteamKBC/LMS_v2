import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TenantUser } from '@/mocks/users';
import type { RoleDef, PermissionLevel, AccessScope } from '@/mocks/rbac';
import { ALL_ROLES, ALL_PERMISSIONS, PERMISSION_LEVELS, ROUTE_PERMISSIONS, NAV_PERMISSIONS } from '@/mocks/rbac';
import { kbcUsers } from '@/mocks/users';
import { kbcTenant, demoProviderTenant, type Tenant } from '@/mocks/tenant';
import { bootstrapChatSession, clearChatSession } from '@/api/chat';

// ============================================================
// Types
// ============================================================

export interface AuthState {
  user: TenantUser | null;
  tenant: Tenant | null;
  roles: RoleDef[];
  isAuthenticated: boolean;
}

export interface RbacContextValue {
  auth: AuthState;
  login: (email: string) => void;
  logout: () => void;
  switchTenant: (tenantId: string) => void;
  switchRole: (roleSlug: string) => void;
  /** Check if current user has a specific permission at the given level */
  hasPermission: (permissionSlug: string, minLevel?: PermissionLevel, scope?: AccessScope) => boolean;
  /** Check if current user can access a given route */
  canAccessRoute: (path: string) => boolean;
  /** Check if current user can see a navigation item */
  canSeeNavItem: (navId: string) => boolean;
  /** Get the effective permission level for a given permission slug */
  getPermissionLevel: (permissionSlug: string) => PermissionLevel;
  /** Get the effective scope for a given permission slug */
  getPermissionScope: (permissionSlug: string) => AccessScope | null;
  /** Check if user has admin bypass (tenant admin or super admin) */
  isAdmin: boolean;
};

// ============================================================
// Context
// ============================================================

const AuthContext = createContext<RbacContextValue | null>(null);

// ============================================================
// Helpers
// ============================================================

const AUTH_STORAGE_KEY = 'kbc_auth_email';
const CHAT_DEMO_EMAILS = new Set(['coach@kbc.test', 'learner@kbc.test']);

function getLevelRank(level: PermissionLevel): number {
  const found = PERMISSION_LEVELS.find(l => l.value === level);
  return found?.rank ?? 0;
}

function buildPermissionMap(roles: RoleDef[]): Map<string, { level: PermissionLevel; scope: AccessScope; isAdminBypass: boolean }> {
  const map = new Map<string, { level: PermissionLevel; scope: AccessScope; isAdminBypass: boolean }>();

  for (const role of roles) {
    for (const perm of role.permissions) {
      const existing = map.get(perm.permissionSlug);
      const permDef = ALL_PERMISSIONS.find(p => p.slug === perm.permissionSlug);

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
          isAdminBypass: permDef?.isAdminBypass ?? false,
        });
      }
    }
  }

  return map;
}

function hasWildcardAccess(roles: RoleDef[]): boolean {
  return roles.some(r => r.slug === 'super-admin' || r.slug === 'tenant-admin');
}

// ============================================================
// Synchronous localStorage hydration — no loading spinner on refresh
// ============================================================

function readAuthFromStorage(): AuthState {
  const storedEmail = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!storedEmail) {
    return { user: null, tenant: null, roles: [], isAuthenticated: false };
  }
  const foundUser = kbcUsers.find(u => u.email === storedEmail);
  if (!foundUser) {
    return { user: null, tenant: null, roles: [], isAuthenticated: false };
  }
  const userRoles = foundUser.roles
    .map(rId => ALL_ROLES.find(r => r.id === rId))
    .filter((r): r is RoleDef => r !== undefined);
  const tenant = foundUser.tenantId === 't_kbc_001' ? kbcTenant : demoProviderTenant;
  return {
    user: foundUser,
    tenant,
    roles: userRoles,
    isAuthenticated: true,
  };
}

// ============================================================
// Provider
// ============================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  // Read auth from localStorage synchronously — zero flash, zero loading spinner
  const [auth, setAuth] = useState<AuthState>(readAuthFromStorage);
  const [isInitialized, setIsInitialized] = useState(true);

  // Effect only needed for edge-case re-sync (e.g. another tab changed localStorage)
  // Not for initial hydration — that's done synchronously above.
  useEffect(() => {
    const syncFromStorage = () => {
      const restored = readAuthFromStorage();
      setAuth(prev => {
        if (prev.isAuthenticated !== restored.isAuthenticated || prev.user?.email !== restored.user?.email) {
          return restored;
        }
        return prev;
      });
    };

    // Listen for storage changes from other tabs
    const handleStorage = (e: StorageEvent) => {
      if (e.key === AUTH_STORAGE_KEY) {
        syncFromStorage();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Keep the Django chat session aligned with the local demo login. The chat
  // API uses the participant email to scope conversations in PostgreSQL.
  useEffect(() => {
    if (!auth.isAuthenticated || !auth.user?.email) return;
    if (!CHAT_DEMO_EMAILS.has(auth.user.email.toLowerCase())) return;
    void bootstrapChatSession(auth.user.email).catch(() => {
      // Non-chat demo roles do not have a chat identity; their normal app
      // session should continue to work without showing a global error.
    });
  }, [auth.isAuthenticated, auth.user?.email]);

  const login = useCallback((email: string) => {
    const foundUser = kbcUsers.find(u => u.email === email);
    if (!foundUser) return;

    const userRoles = foundUser.roles
      .map(rId => ALL_ROLES.find(r => r.id === rId))
      .filter((r): r is RoleDef => r !== undefined);

    const tenant = foundUser.tenantId === 't_kbc_001' ? kbcTenant : demoProviderTenant;

    // Persist to localStorage so it survives refresh
    localStorage.setItem(AUTH_STORAGE_KEY, email);

    setAuth({
      user: foundUser,
      tenant,
      roles: userRoles,
      isAuthenticated: true,
    });
  }, []);

  const logout = useCallback(() => {
    void clearChatSession();
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuth({
      user: null,
      tenant: null,
      roles: [],
      isAuthenticated: false,
    });
    navigate('/login');
  }, [navigate]);

  const switchTenant = useCallback((tenantId: string) => {
    setAuth(prev => ({
      ...prev,
      tenant: tenantId === 't_kbc_001' ? kbcTenant : demoProviderTenant,
    }));
  }, []);

  // Role switcher — switch the current user's primary role for demo/testing
  const switchRole = useCallback((roleSlug: string) => {
    setAuth(prev => {
      if (!prev.user) return prev;

      // Find the role definition
      const targetRole = ALL_ROLES.find(r => r.slug === roleSlug);
      if (!targetRole) return prev;

      // Find the demo user that matches this role
      const roleEmailMap: Record<string, string> = {
        learner: 'learner@kbc.test',
        coach: 'coach@kbc.test',
        tutor: 'tutor@kbc.test',
        employer: 'employer@kbc.test',
        compliance: 'compliance@kbc.test',
        qa: 'qa@kbc.test',
        mis: 'mis@kbc.test',
        'tenant-admin': 'admin@kbc.test',
        leadership: 'leadership@kbc.test',
        finance: 'finance@kbc.test',
        auditor: 'auditor@kbc.test',
        'programme-manager': 'admin@kbc.test',
        engagement: 'compliance@kbc.test',
        curriculum: 'tutor@kbc.test',
        'super-admin': 'admin@kbc.test',
      };

      const targetEmail = roleEmailMap[roleSlug] || 'admin@kbc.test';
      const targetUser = kbcUsers.find(u => u.email === targetEmail);

      if (!targetUser) return prev;

      const userRoles = targetUser.roles
        .map(rId => ALL_ROLES.find(r => r.id === rId))
        .filter((r): r is RoleDef => r !== undefined);

      // Persist the new email
      localStorage.setItem(AUTH_STORAGE_KEY, targetEmail);

      return {
        ...prev,
        user: targetUser,
        roles: userRoles,
      };
    });
  }, []);

  // Build permission map from current roles
  const permissionMap = useMemo(() => buildPermissionMap(auth.roles), [auth.roles]);
  const isWildcard = useMemo(() => hasWildcardAccess(auth.roles), [auth.roles]);
  const isAdminVal = useMemo(() => auth.roles.some(r => r.slug === 'super-admin' || r.slug === 'tenant-admin'), [auth.roles]);

  const hasPermission = useCallback((permissionSlug: string, minLevel: PermissionLevel = 'view', _scope?: AccessScope): boolean => {
    if (!auth.isAuthenticated) return false;
    if (isWildcard) return true;

    const perm = permissionMap.get(permissionSlug);
    if (!perm) return false;

    const requiredRank = getLevelRank(minLevel);
    const actualRank = getLevelRank(perm.level);
    return actualRank >= requiredRank;
  }, [auth.isAuthenticated, isWildcard, permissionMap]);

  const getPermissionLevel = useCallback((permissionSlug: string): PermissionLevel => {
    if (isWildcard) return 'full_admin';
    return permissionMap.get(permissionSlug)?.level ?? 'none';
  }, [isWildcard, permissionMap]);

  const getPermissionScope = useCallback((permissionSlug: string): AccessScope | null => {
    if (isWildcard) return 'global';
    return permissionMap.get(permissionSlug)?.scope ?? null;
  }, [isWildcard, permissionMap]);

  const canAccessRoute = useCallback((path: string): boolean => {
    if (!auth.isAuthenticated) return path === '/' || path === '/login';

    let bestMatch = ROUTE_PERMISSIONS.find(r => r.path === path);
    if (!bestMatch) {
      bestMatch = ROUTE_PERMISSIONS
        .filter(r => path.startsWith(r.path))
        .sort((a, b) => b.path.length - a.path.length)[0];
    }

    if (!bestMatch) return false;

    if (bestMatch.allowedRoles?.includes('*')) return true;

    if (bestMatch.allowedRoles) {
      const userSlugs = auth.roles.map(r => r.slug);
      return bestMatch.allowedRoles.some(r => userSlugs.includes(r));
    }

    return false;
  }, [auth.isAuthenticated, auth.roles]);

  const canSeeNavItem = useCallback((navId: string): boolean => {
    if (!auth.isAuthenticated) return false;

    const navPerm = NAV_PERMISSIONS.find(n => n.navId === navId);
    if (!navPerm) return true;

    if (navPerm.allowedRoles?.includes('*')) return true;

    if (navPerm.allowedRoles) {
      const userSlugs = auth.roles.map(r => r.slug);
      return navPerm.allowedRoles.some(r => userSlugs.includes(r));
    }

    return true;
  }, [auth.isAuthenticated, auth.roles]);

  const value = useMemo<RbacContextValue>(() => ({
    auth,
    login,
    logout,
    switchTenant,
    switchRole,
    hasPermission,
    canAccessRoute,
    canSeeNavItem,
    getPermissionLevel,
    getPermissionScope,
    isAdmin: isAdminVal,
  }), [auth, login, logout, switchTenant, switchRole, hasPermission, canAccessRoute, canSeeNavItem, getPermissionLevel, getPermissionScope, isAdminVal]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================
// Hook
// ============================================================

export function useAuth(): RbacContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
