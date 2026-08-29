import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TenantUser } from '@/mocks/users';
import type { RoleDef, PermissionLevel, AccessScope } from '@/mocks/rbac';
import { ALL_ROLES, ALL_PERMISSIONS, PERMISSION_LEVELS, ROUTE_PERMISSIONS, NAV_PERMISSIONS } from '@/mocks/rbac';
import { kbcUsers } from '@/mocks/users';
import { kbcTenant, demoProviderTenant, type Tenant } from '@/mocks/tenant';
import { clearChatSession } from '@/api/chat';
import { apiLogin, apiLogout, apiMe, type AuthUser, type Role } from '@/api/auth';
import { rememberSignedInLearner } from '@/hooks/useMyLearner';
import { clearCoachViewAs, syncCoachViewAsAccount } from '@/lib/coachViewAs';
import { clearTutorViewAs, syncTutorViewAsAccount } from '@/lib/tutorViewAs';
import { installSessionExpiryHandler, resetSessionExpiryNotice } from '@/lib/sessionExpiry';
import { useToastOptional } from '@/hooks/useToast';

// ============================================================
// Types
// ============================================================

export interface AuthState {
  user: TenantUser | null;
  tenant: Tenant | null;
  roles: RoleDef[];
  isAuthenticated: boolean;
  /** The server's account record — the authoritative identity. */
  account: AuthUser | null;
}

export interface RbacContextValue {
  auth: AuthState;
  /**
   * Sign in against the backend. Rejects with an `AuthError` carrying the
   * server's message and code (`locked`, `throttled`, …) — callers should
   * await it and surface `err.message`.
   */
  login: (email: string, password: string, remember?: boolean) => Promise<AuthUser>;
  logout: () => void;
  /** False until the initial `/login_api/me/` call has settled. */
  isInitialized: boolean;
  /**
   * Enter a workspace as one of the mock demo accounts, with no server session.
   *
   * This is the landing page's "explore this section" shortcut and is exactly
   * as authoritative as it sounds: it sets local UI state only. Any request to
   * a protected endpoint will still 401, because no cookie is issued. Real
   * sign-in is `login`.
   */
  previewAs: (email: string) => void;
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

/**
 * Backend role -> RBAC role ids in `@/mocks/rbac`.
 *
 * The server knows four coarse roles (see login/models.py); this UI's RBAC
 * layer has fifteen finer ones. Mapping happens here so the rest of the app
 * keeps using the permission slugs it already uses.
 *
 * `admin` maps to tenant-admin, which `hasWildcardAccess` treats as a bypass —
 * matching the server, where role='admin' carries every permission.
 */
const ROLE_TO_RBAC_IDS: Record<Role, string[]> = {
  admin: ['role_tenant_admin'],
  staff: ['role_compliance'],
  employer: ['role_employer'],
  learner: ['role_learner'],
};

/** Build the local AuthState from a server account record. */
function stateFromAccount(account: AuthUser): AuthState {
  // A learner's own pages (/workspace/learner and the paramless /learner/*
  // routes) resolve through the "remembered learner". Pin it to the account
  // that just signed in — otherwise a learner is shown whichever record was
  // last in localStorage, or the hardcoded demo learner on a fresh browser.
  // Single funnel: every sign-in, session restore and refresh lands here.
  rememberSignedInLearner(account.subjectType, account.subjectId, account.learnerType);

  // Same reasoning for the coach workspace: an admin's "view as coach" choice
  // is stored per browser, so it has to be dropped here when the account that
  // resolves is not the admin who made it — otherwise a coach signing in on
  // that browser would request somebody else's caseload and be refused.
  syncCoachViewAsAccount(account);
  // The tutor workspace's picker stores its choice the same way, so it needs the
  // same guard — see lib/tutorViewAs.
  syncTutorViewAsAccount(account);

  const roles = (ROLE_TO_RBAC_IDS[account.role] ?? [])
    .map(id => ALL_ROLES.find(r => r.id === id))
    .filter((r): r is RoleDef => r !== undefined);

  // The app's components read a TenantUser. Project the server account onto
  // that shape rather than looking one up in the mock list — a real account
  // will not be in it.
  const user: TenantUser = {
    id: `acct_${account.id}`,
    tenantId: kbcTenant.id,
    email: account.email,
    fullName: account.displayName || account.email,
    roles: ROLE_TO_RBAC_IDS[account.role] ?? [],
    organisationId: account.organisationIds?.[0] != null ? `org_${account.organisationIds[0]}` : '',
    status: 'active',
    lastLogin: account.lastLoginAt || new Date().toISOString(),
  };

  return { user, tenant: kbcTenant, roles, isAuthenticated: true, account };
}

const SIGNED_OUT: AuthState = {
  user: null,
  tenant: null,
  roles: [],
  isAuthenticated: false,
  account: null,
};

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
// Provider
// ============================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  // Optional on purpose: ToastProvider sits above this one in App.tsx, but
  // signing someone out must not depend on a toast being available.
  const toast = useToastOptional();

  const [auth, setAuth] = useState<AuthState>(SIGNED_OUT);
  // Starts false: the session lives in an HttpOnly cookie, which JS cannot
  // read, so the only way to know whether we are signed in is to ask the
  // server. Routes must wait for this rather than briefly rendering as
  // signed-out and bouncing an authenticated user to /login.
  const [isInitialized, setIsInitialized] = useState(false);

  // Resolve the session cookie into an identity on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const account = await apiMe();
        if (!cancelled) setAuth(account ? stateFromAccount(account) : SIGNED_OUT);
      } catch {
        // A network/server failure is not proof of being signed out, but it is
        // the only safe assumption to render on: protected data will 401 anyway.
        if (!cancelled) setAuth(SIGNED_OUT);
      } finally {
        if (!cancelled) setIsInitialized(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // A 401 from a gated API means the session this browser holds is gone —
  // expired, revoked, the account deactivated, or signed out elsewhere. Before
  // the API gate existed those requests were answered anyway and a lapsed
  // session went unnoticed; now every panel on the page fails at once, so
  // something has to say why rather than leaving a screen of broken cards.
  //
  // Installed here rather than at a call site because roughly forty modules
  // under api/ and lib/ each own their own fetch. See lib/sessionExpiry.
  useEffect(() => {
    return installSessionExpiryHandler(() => {
      // `navigate` rather than a reload: it keeps the SPA mounted, and the
      // `from` state is what returns the person to the page they were on once
      // they sign in again.
      const from = `${window.location.pathname}${window.location.search}`;
      localStorage.removeItem(AUTH_STORAGE_KEY);
      clearCoachViewAs();
      clearTutorViewAs();
      setAuth(SIGNED_OUT);
      toast?.warning(
        'Your session has ended',
        'Please sign in again to continue where you left off.',
      );
      navigate('/login', { state: { from }, replace: true });
    });
  }, [navigate, toast]);

  // Sign-out in another tab should not leave this one showing a console it can
  // no longer load data for. The flag is a same-origin broadcast only — the
  // authority is always the cookie and /me.
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_STORAGE_KEY) return;
      if (e.newValue === null) {
        setAuth(SIGNED_OUT);
        return;
      }
      void apiMe()
        .then(account => setAuth(account ? stateFromAccount(account) : SIGNED_OUT))
        .catch(() => undefined);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const login = useCallback(async (email: string, password: string, remember = false) => {
    // Throws AuthError on failure; the caller renders err.message.
    const account = await apiLogin(email, password, remember);
    // Re-arm the expiry notice: this browser has a live session again.
    resetSessionExpiryNotice();
    setAuth(stateFromAccount(account));
    localStorage.setItem(AUTH_STORAGE_KEY, account.email);
    return account;
  }, []);

  // Local-only demo preview — see `previewAs` in RbacContextValue.
  const previewAs = useCallback((email: string) => {
    const foundUser = kbcUsers.find(u => u.email === email);
    if (!foundUser) return;

    const userRoles = foundUser.roles
      .map(rId => ALL_ROLES.find(r => r.id === rId))
      .filter((r): r is RoleDef => r !== undefined);

    setAuth({
      user: foundUser,
      tenant: foundUser.tenantId === 't_kbc_001' ? kbcTenant : demoProviderTenant,
      roles: userRoles,
      isAuthenticated: true,
      // No server account: nothing here is backed by a session.
      account: null,
    });
  }, []);

  const logout = useCallback(() => {
    void clearChatSession();
    // Revoke server-side first so the session dies even if this tab is closed
    // before navigation completes; the local state is cleared regardless.
    void apiLogout().catch(() => undefined);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    clearCoachViewAs();
    clearTutorViewAs();
    setAuth(SIGNED_OUT);
    navigate('/login');
  }, [navigate]);

  const switchTenant = useCallback((tenantId: string) => {
    setAuth(prev => ({
      ...prev,
      tenant: tenantId === 't_kbc_001' ? kbcTenant : demoProviderTenant,
    }));
  }, []);

  // Role switcher — a demo/testing affordance only. It changes what this
  // browser renders; it does not change the server's view of the account, so
  // any API call still runs with the real role. Kept for the existing
  // role-preview UI.
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
    isInitialized,
    previewAs,
    switchTenant,
    switchRole,
    hasPermission,
    canAccessRoute,
    canSeeNavItem,
    getPermissionLevel,
    getPermissionScope,
    isAdmin: isAdminVal,
  }), [auth, login, logout, isInitialized, previewAs, switchTenant, switchRole, hasPermission, canAccessRoute, canSeeNavItem, getPermissionLevel, getPermissionScope, isAdminVal]);

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
