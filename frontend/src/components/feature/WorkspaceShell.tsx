import { useState, useRef, useCallback, type CSSProperties, type ReactNode, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Sidebar, SidebarIcon, SIDEBAR_RAIL_WIDTH, SIDEBAR_EXPANDED_WIDTH, SIDEBAR_CONTENT_GAP, type SidebarNavItem } from './Sidebar';
import { LEARNER_SIDEBAR_COLLAPSED_WIDTH, LEARNER_SIDEBAR_WIDTH } from './learnerShellAssets';
import { CoachViewAsBar } from './CoachViewAsBar';
import { CoachSidebar } from './CoachSidebar';
import { Header } from './Header';
import { AppIcon } from './AppIcon';
import { GlobalSearch } from './GlobalSearch';
import { useAuth } from '@/hooks/useAuth';
import { isOwnLearnerRecord } from '@/api/auth';
import { useLearnerNavGate } from '@/hooks/useLearnerNavGate';
import { getRememberedLearner } from '@/hooks/useMyLearner';
import { ArrowLeft } from 'lucide-react';
import design from './WorkspaceDesign.module.css';
import { activePersonalLearning } from '@/lib/personalLearning';
import { PersonalLearningBanner } from './PersonalLearningBanner';
import { learnerHref, learnerIdentityFromPath, type LearnerRoutePage } from '@/lib/learnerRoutes';

interface WorkspaceShellProps {
  children: ReactNode;
  role: string;
  roleLabel: string;
  navItems: SidebarNavItem[];
  pageTitle: string;
  pageSubtitle?: string;
  /** Optional page-specific actions rendered inside the shared header. */
  headerExtras?: ReactNode;
  userName?: string;
  userRole?: string;
  workspaceLabel?: string;
  showBackButton?: boolean;
  /** Destination for a direct visit with no previous in-app history entry. */
  backFallbackHref?: string;
  /** Replaces the route-derived final breadcrumb (which may contain a raw id). */
  breadcrumbCurrentLabel?: string;
  /** Removes the workspace title and breadcrumbs for focused, content-first pages. */
  hidePageChrome?: boolean;
  /** Removes only the breadcrumb row while keeping the top header. */
  hideBreadcrumbs?: boolean;
  /** The transition portal has its own menu before programme delivery starts. */
  filterLearnerNavigation?: boolean;
}

interface BreadcrumbItem {
  label: string;
  href: string;
  isLink: boolean;
}

const ROUTE_HISTORY_KEY = 'lmsRouteHistory';
const SIDEBAR_PINNED_KEY = 'kbc_sidebar_pinned';
const COACH_SIDEBAR_COLLAPSED_KEY = 'kbc_coach_sidebar_collapsed';
const LEARNER_SIDEBAR_COLLAPSED_KEY = 'kbc_learner_sidebar_collapsed';
const COACH_SIDEBAR_WIDTH = 240;
const COACH_SIDEBAR_COLLAPSED_WIDTH = 76;

/**
 * Whether the sidebar's secondary navigation is open.
 *
 * Held here rather than inside the sidebar because the shell has to reserve the
 * matching width, including the outer inset and content gap.
 */
function readPinnedPreference() {
  try {
    return localStorage.getItem(SIDEBAR_PINNED_KEY) === 'true';
  } catch {
    return false;
  }
}

function readCoachSidebarCollapsed() {
  try {
    return localStorage.getItem(COACH_SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function readLearnerSidebarCollapsed() {
  try {
    return localStorage.getItem(LEARNER_SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function readRouteHistory() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ROUTE_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(item => String(item || '')).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeRouteHistory(history: string[]) {
  sessionStorage.setItem(ROUTE_HISTORY_KEY, JSON.stringify(history.slice(-30)));
}

function buildBreadcrumbs(pathname: string, search: string, navItems: SidebarNavItem[], workspaceLabel: string, roleLabel: string): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [];

  // Always start with workspace root if applicable
  const isInWorkspace = pathname.startsWith('/workspace/');

  if (!isInWorkspace) {
    const dashboardItem = navItems.find(i => i.href && i.href.includes('/workspace/'));
    if (dashboardItem) {
      crumbs.push({ label: workspaceLabel, href: dashboardItem.href, isLink: true });
    }

    // Find the deepest matching item, tracking its parent group (if any).
    // Items with an empty href (group headers) are never matched directly —
    // pathname.startsWith('' + '/') would otherwise match every route.
    let matched: SidebarNavItem | undefined;
    let matchedParent: SidebarNavItem | undefined;
    const current = `${pathname}${search}`;
    for (const item of navItems) {
      if (item.href && item.href.includes('?') && item.href === current) {
        matched = item;
        break;
      }
      if (item.children) {
        const queryChild = item.children.find(c => c.href && c.href.includes('?') && c.href === current);
        if (queryChild) {
          matched = queryChild;
          matchedParent = item;
          break;
        }
      }
      if (item.href && !item.href.includes('?') && (pathname === item.href || pathname.startsWith(item.href + '/'))) {
        matched = item;
        break;
      }
      if (item.children) {
        const child = item.children.find(c => c.href && !c.href.includes('?') && (pathname === c.href || pathname.startsWith(c.href + '/')));
        if (child) {
          matched = child;
          matchedParent = item;
          break;
        }
      }
    }

    if (matched) {
      if (matchedParent && matchedParent.label) {
        // Group headers do not need a separate route in the sidebar, but a
        // breadcrumb for the group should still be useful. Link it to the
        // group's first available child rather than leaving plain text here.
        const parentHref = matchedParent.href || matchedParent.children?.find(child => child.href)?.href || '';
        crumbs.push({ label: matchedParent.label, href: parentHref, isLink: Boolean(parentHref) });
      }
      if (matched.href !== (dashboardItem?.href ?? '')) {
        crumbs.push({ label: matched.label, href: matched.href, isLink: true });
      }
    } else {
      // Derive from path segments
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const parentLabel = segments[0].charAt(0).toUpperCase() + segments[0].slice(1).replace(/-/g, ' ');
        const childLabel = segments.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')).join(' — ');
        if (dashboardItem) {
          crumbs.push({ label: parentLabel, href: `/${segments[0]}`, isLink: true });
        }
        crumbs.push({ label: childLabel, href: pathname, isLink: true });
      }
    }
  } else {
    if (roleLabel === 'Super Admin') {
      crumbs.push({ label: 'Dashboard', href: pathname, isLink: true });
      crumbs.push({ label: workspaceLabel, href: pathname, isLink: false });
    } else {
      crumbs.push({ label: workspaceLabel, href: pathname, isLink: true });
    }
  }

  return crumbs;
}

export function WorkspaceShell({
  children,
  role,
  roleLabel,
  navItems: navItemsProp,
  pageTitle,
  pageSubtitle,
  headerExtras,
  userName,
  userRole,
  workspaceLabel,
  showBackButton = false,
  backFallbackHref,
  breadcrumbCurrentLabel,
  hidePageChrome = false,
  hideBreadcrumbs = false,
  filterLearnerNavigation = true,
}: WorkspaceShellProps) {
  // A learner who is still onboarding, or who has finished enrolment but is not
  // yet being taught, gets a reduced sidebar — most of the workspace needs a
  // running training plan. Staff reviewing a learner get the same full menu on
  // every page, while learner-type and navigation permissions still apply.
  const { auth, isAdmin } = useAuth();
  const location = useLocation();
  const personalContext = activePersonalLearning(location.pathname);
  const personal = auth.account?.role === 'admin' && personalContext?.accountId === auth.account.id ? personalContext : null;
  // Keep the approved admin page styling in the shared directory, but let the
  // selected workspace supply its own menu, labels and breadcrumbs.
  const isAdminDirectory = isAdmin && /^\/(?:users|employers)(?:\/|$)/.test(location.pathname);
  const chromeRole = isAdminDirectory ? 'admin' : role;
  // "Reviewing" means staff looking at somebody ELSE's record, from the
  // enrolment workspace — full menu, no fresh/onboarding gating. A staff member
  // or administrator who is ALSO a learner (see login/learner_enrolment.py)
  // opens their own record the same way any learner does, and there they need
  // the ordinary reduced-menu behaviour, or the sidebar would offer pages a
  // not-yet-started learner has nothing behind. `getRememberedLearner()` here
  // is the same resolution `useLearnerNavGate` makes internally for `role`
  // "learner" — this workspace is only ever rendered with that role.
  const isStaffOrAdmin = auth.account?.role === 'admin' || auth.account?.role === 'staff';
  const currentLearner = role === 'learner' ? getRememberedLearner() : null;
  const reviewingLearner = isStaffOrAdmin
    && !isOwnLearnerRecord(auth.account, currentLearner?.kind, currentLearner?.id);
  const gatedNavItems = useLearnerNavGate(filterLearnerNavigation && !personal ? role : '', navItemsProp, reviewingLearner);
  const navItems = personal
    ? gatedNavItems.filter(item => ['learner-my-learning', 'learner-map'].includes(item.id))
    : gatedNavItems;
  const routeLearner = role === 'learner' ? learnerIdentityFromPath(location.pathname) : null;
  const learnerPageById: Record<string, LearnerRoutePage> = {
    'learner-overview': 'dashboard', 'learner-my-learning': 'my-learning',
    'learner-group-monthly': 'my-progress',
    'learner-monthly-submission': 'monthly-submission', 'learner-monthly-logs': 'monthly-logs',
    'learner-monthly-coaching': 'monthly-coaching', 'learner-progress-reviews': 'progress-reviews', 'learner-reviews': 'reviews',
    'learner-attendance': 'attendance', 'learner-evidence': 'evidence', 'learner-calendar': 'calendar',
  };
  const stableNavItems = routeLearner
    ? navItems.map(item => {
      const page = learnerPageById[item.id];
      const children = item.children?.map(child => {
        const childPage = learnerPageById[child.id];
        return childPage ? { ...child, href: learnerHref(childPage, routeLearner.kind, routeLearner.id) } : child;
      });
      return page ? { ...item, href: learnerHref(page, routeLearner.kind, routeLearner.id), children } : children ? { ...item, children } : item;
    })
    : navItems;
  const workspaceNavItems = auth.account?.role === 'admin' && !navItems.some(item => item.id === 'personal-courses')
    ? [...stableNavItems, { id: 'personal-courses', label: 'My Courses', icon: 'ri-graduation-cap-line', href: '/my-courses' }]
    : stableNavItems;
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [previousRoute, setPreviousRoute] = useState('');

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileFocusBeforeOpenRef = useRef<HTMLElement | null>(null);
  const mobileSidebarWasOpenRef = useRef(false);
  const mobileBodyOverflowRef = useRef<string | null>(null);
  const mobileFocusTimerRef = useRef<number | null>(null);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const [sidebarPinned, setSidebarPinned] = useState(readPinnedPreference);
  const [coachSidebarCollapsed, setCoachSidebarCollapsed] = useState(readCoachSidebarCollapsed);
  const [learnerSidebarCollapsed, setLearnerSidebarCollapsed] = useState(readLearnerSidebarCollapsed);

  const handlePinChange = (pinned: boolean) => {
    setSidebarPinned(pinned);
    try {
      localStorage.setItem(SIDEBAR_PINNED_KEY, String(pinned));
    } catch { /* Ignore unavailable browser storage. */ }
  };

  const handleCoachSidebarCollapsedChange = (collapsed: boolean) => {
    setCoachSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(COACH_SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch { /* Ignore unavailable browser storage. */ }
  };

  const handleLearnerSidebarCollapsedChange = (collapsed: boolean) => {
    setLearnerSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(LEARNER_SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch { /* Ignore unavailable browser storage. */ }
  };

  const displayName = (isAdminDirectory ? auth.account?.displayName || auth.user?.fullName : userName) || auth.user?.fullName || 'User';
  const displayRole = personal ? 'Admin · Learner' : userRole || auth.roles?.[0]?.name || roleLabel;
  const defaultWorkspaceLabel = workspaceLabel || roleLabel + ' Workspace';

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (role !== 'learner') return;
    if (mobileSidebarOpen) {
      if (!mobileSidebarWasOpenRef.current) {
        mobileSidebarWasOpenRef.current = true;
        mobileFocusBeforeOpenRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        mobileBodyOverflowRef.current = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      }
      if (mobileFocusTimerRef.current !== null) window.clearTimeout(mobileFocusTimerRef.current);
      mobileFocusTimerRef.current = window.setTimeout(() => {
        document.querySelector<HTMLButtonElement>(`#${role}-mobile-navigation button[aria-label="Close navigation"]`)?.focus();
      }, 0);
      return () => {
        if (mobileFocusTimerRef.current !== null) {
          window.clearTimeout(mobileFocusTimerRef.current);
          mobileFocusTimerRef.current = null;
        }
      };
    }

    if (mobileSidebarWasOpenRef.current) {
      document.body.style.overflow = mobileBodyOverflowRef.current ?? '';
      if (!document.body.style.overflow) document.body.style.removeProperty('overflow');
      if (mobileFocusBeforeOpenRef.current && document.body.contains(mobileFocusBeforeOpenRef.current)) {
        mobileFocusBeforeOpenRef.current.focus();
      } else {
        mobileMenuButtonRef.current?.focus();
      }
    }
    mobileSidebarWasOpenRef.current = false;
    mobileFocusBeforeOpenRef.current = null;
    mobileBodyOverflowRef.current = null;
    return () => {
      if (mobileFocusTimerRef.current !== null) window.clearTimeout(mobileFocusTimerRef.current);
    };
  }, [mobileSidebarOpen, role]);

  useEffect(() => {
    if (role !== 'learner' || !mobileSidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileSidebarOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const drawer = document.getElementById(`${role}-mobile-navigation`);
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => !element.hasAttribute('inert') && element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileSidebarOpen, role]);

  useEffect(() => () => {
    if (mobileBodyOverflowRef.current === null) return;
    document.body.style.overflow = mobileBodyOverflowRef.current;
    if (!document.body.style.overflow) document.body.style.removeProperty('overflow');
    mobileBodyOverflowRef.current = null;
    mobileSidebarWasOpenRef.current = false;
  }, []);

  useEffect(() => {
    if (role !== 'learner') return;
    const onResize = () => {
      if (window.innerWidth >= 1024) setMobileSidebarOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [role]);

  useEffect(() => {
    const currentRoute = `${location.pathname}${location.search}${location.hash}`;
    const storedHistory = readRouteHistory();
    const nextHistory = storedHistory.at(-1) === currentRoute ? storedHistory : [...storedHistory, currentRoute].slice(-30);
    const previous = [...nextHistory].reverse().find(route => route !== currentRoute) || '';
    setPreviousRoute(previous);
    writeRouteHistory(nextHistory);
  }, [location.hash, location.pathname, location.search]);

  const routeBreadcrumbs = buildBreadcrumbs(location.pathname, location.search, navItems, defaultWorkspaceLabel, roleLabel);
  const breadcrumbs = breadcrumbCurrentLabel && routeBreadcrumbs.length
    ? routeBreadcrumbs.map((crumb, index) => (
        index === routeBreadcrumbs.length - 1 ? { ...crumb, label: breadcrumbCurrentLabel } : crumb
      ))
    : routeBreadcrumbs;

  const handleToggleMobileSidebar = () => {
    setMobileSidebarOpen(prev => !prev);
  };

  // Reuse the breadcrumb's resolved destination for the header's visual icon.
  const headerNavItem = navItems.flatMap(item => [item, ...(item.children ?? [])])
    .find(item => item.href === [...breadcrumbs].reverse().find(crumb => crumb.isLink)?.href);

  const fallbackRoute = backFallbackHref || breadcrumbs.find(crumb => crumb.isLink && crumb.href && crumb.href !== `${location.pathname}${location.search}`)?.href || '/';
  const hasPreviousEntry = typeof window.history.state?.idx === 'number' && window.history.state.idx > 0;
  const canGoBack = hasPreviousEntry || fallbackRoute !== `${location.pathname}${location.search}${location.hash}`;
  const handleReturnToPreviousWindow = () => {
    if (hasPreviousEntry) {
      navigate(-1);
      return;
    }
    navigate(fallbackRoute, { replace: true });
  };

  return (
    <div
      className={`dashboard-theme workspace-shell flex h-screen overflow-hidden ${design.shell}`}
      data-workspace-role={chromeRole}
      // The offset itself is applied under a `lg` media query in index.css —
      // below that breakpoint the sidebar is an off-canvas drawer and must
      // reserve nothing.
      style={{ '--kbc-sidebar-width': role === 'learner'
        ? `${learnerSidebarCollapsed ? LEARNER_SIDEBAR_COLLAPSED_WIDTH : LEARNER_SIDEBAR_WIDTH}px`
        : role === 'coach'
        ? `${coachSidebarCollapsed ? COACH_SIDEBAR_COLLAPSED_WIDTH : COACH_SIDEBAR_WIDTH}px`
        : `${(sidebarPinned ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH) + SIDEBAR_CONTENT_GAP}px` } as CSSProperties}
    >
      {role === 'coach' ? <CoachSidebar navItems={navItems} userName={displayName} userRole={displayRole}
        mobileOpen={mobileSidebarOpen} onCloseMobile={closeMobileSidebar}
        collapsed={coachSidebarCollapsed} onCollapsedChange={handleCoachSidebarCollapsedChange}
        onOpenAccount={() => { accountButtonRef.current?.focus(); accountButtonRef.current?.click(); }} /> : <Sidebar
        role={role}
        roleLabel={roleLabel}
        navItems={workspaceNavItems}
        userName={displayName}
        userRole={displayRole}
        pinned={sidebarPinned}
        onPinChange={handlePinChange}
        learnerCollapsed={learnerSidebarCollapsed}
        onLearnerCollapsedChange={handleLearnerSidebarCollapsedChange}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />}
      {/* Reserve the shared sidebar width and gutters for every workspace. */}
      <div
        className="workspace-content flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ease-out motion-reduce:transition-none"
        aria-hidden={role === 'learner' && mobileSidebarOpen ? true : undefined}
        inert={role === 'learner' && mobileSidebarOpen ? true : undefined}
        style={{ marginLeft: 'var(--kbc-sidebar-offset, 0px)' }}
      >
        {personal && <PersonalLearningBanner context={personal} />}
        {!hidePageChrome && (
          <Header
            accountButtonRef={accountButtonRef}
            pageTitle={pageTitle}
            pageIcon={headerNavItem ? <SidebarIcon id={headerNavItem.id} label={headerNavItem.label} sourceIcon={headerNavItem.icon} className="h-5 w-5" /> : undefined}
            pageSubtitle={pageSubtitle}
            headerExtras={headerExtras}
            onOpenSearch={() => setSearchOpen(true)}
            userName={displayName}
            onToggleMobileSidebar={handleToggleMobileSidebar}
            mobileSidebarOpen={mobileSidebarOpen}
            mobileMenuButtonRef={mobileMenuButtonRef}
            role={chromeRole}
            workspaceLabel={personal ? 'Learner' : roleLabel}
            personalLearning={Boolean(personal)}
          />
        )}

        {/* Breadcrumbs */}
        {!hidePageChrome && (showBackButton || (!hideBreadcrumbs && breadcrumbs.length > 0)) && (
          <div className={`workspace-breadcrumbs mx-2 flex ${showBackButton ? 'min-h-12 gap-3 py-1.5' : 'h-8'} shrink-0 items-center overflow-hidden rounded-xl border-b border-background-300/40 bg-background-200 px-3 md:px-5 lg:ml-0 lg:mr-3`}>
            {showBackButton && <button type="button" onClick={handleReturnToPreviousWindow} disabled={!canGoBack}
              className="kbc-workspace-back" aria-label="Back to previous page"
              title={!canGoBack ? 'You are on the first page' : previousRoute ? 'Back to the previous page' : 'Back'}>
              <ArrowLeft size={16} aria-hidden="true" /><span>Back</span>
            </button>}
            {!hideBreadcrumbs && <nav className={`flex min-w-0 items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${role === 'learner' ? 'learner-step-breadcrumb' : ''}`} aria-label="Breadcrumb">
              {roleLabel !== 'Super Admin' && (
                <>
                  <Link to="/" className="workspace-breadcrumb-home text-foreground-300 hover:text-foreground-500 transition-smooth">
                    <AppIcon className="ri-home-3-line text-base"></AppIcon>
                  </Link>
                  <AppIcon className="workspace-breadcrumb-home-separator ri-arrow-right-s-line text-foreground-200 text-xs"></AppIcon>
                </>
              )}
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb.href}-${index}`} className={`workspace-breadcrumb-step flex items-center gap-1.5 ${index < breadcrumbs.length - 1 ? 'is-complete' : 'is-current'}`}>
                  {index < breadcrumbs.length - 1 ? (
                    <>
                      {crumb.isLink ? (
                        <Link to={crumb.href} className="whitespace-nowrap text-foreground-400 underline decoration-foreground-300/70 underline-offset-2 transition-smooth hover:text-primary-700 hover:decoration-primary-500">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className="text-foreground-400 whitespace-nowrap">{crumb.label}</span>
                      )}
                      <AppIcon className="ri-arrow-right-s-line text-foreground-200 text-xs"></AppIcon>
                    </>
                  ) : (
                    crumb.isLink && crumb.href ? (
                      <Link
                        to={crumb.href}
                        aria-current="page"
                        className="whitespace-nowrap font-medium text-foreground-700 underline decoration-foreground-300/70 underline-offset-2 transition-colors hover:text-primary-700 hover:decoration-primary-500"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="font-medium whitespace-nowrap text-foreground-700">{crumb.label}</span>
                    )
                  )}
                </span>
              ))}
            </nav>}
          </div>
        )}

        {/* Main content with page transition */}
        {/* No fade or key here: the whole shell is remounted on every route
            change (router/index.ts keys the boundary by pathname), so a
            transition owned by this component could never run. It used to hold
            an opacity-0 state behind a 120ms timer that nothing ever set. */}
        <main className="workspace-main min-h-0 flex-1 overflow-y-auto !bg-none">
          {/* An administrator reading a coach's workspace: shown on every coach
              page, since the sidebar reaches most of them without passing the
              dashboard that chose the coach. */}
          {role === 'coach' && <CoachViewAsBar />}
          {children}
        </main>
      </div>

      {/* Global Search Modal */}
      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
