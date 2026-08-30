import { useState, type CSSProperties, type ReactNode, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Sidebar, SIDEBAR_RAIL_WIDTH, SIDEBAR_EXPANDED_WIDTH, type SidebarNavItem } from './Sidebar';
import { CoachViewAsBar } from './CoachViewAsBar';
import { Header } from './Header';
import { GlobalSearch } from './GlobalSearch';
import { useAuth } from '@/hooks/useAuth';
import { useLearnerNavGate } from '@/hooks/useLearnerNavGate';
import { isLearnerFlowAccount } from '@/lib/learnerFlowAccess';

interface WorkspaceShellProps {
  children: ReactNode;
  role: string;
  roleLabel: string;
  navItems: SidebarNavItem[];
  pageTitle: string;
  pageSubtitle?: string;
  userName?: string;
  userRole?: string;
  workspaceLabel?: string;
  showBackButton?: boolean;
  /** Replaces the route-derived final breadcrumb (which may contain a raw id). */
  breadcrumbCurrentLabel?: string;
  hidePageChrome?: boolean;
  hideBreadcrumbs?: boolean;
}

interface BreadcrumbItem {
  label: string;
  href: string;
  isLink: boolean;
}

const ROUTE_HISTORY_KEY = 'lmsRouteHistory';
const SIDEBAR_PINNED_KEY = 'kbc_sidebar_pinned';

/**
 * Whether the sidebar is pinned open.
 *
 * Held here rather than inside the sidebar because the shell has to reserve the
 * matching width — a pinned sidebar pushes the content across, while the hover
 * preview only floats above it.
 */
function readPinnedPreference() {
  try {
    return localStorage.getItem(SIDEBAR_PINNED_KEY) === 'true';
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
  userName,
  userRole,
  workspaceLabel,
  showBackButton = false,
  breadcrumbCurrentLabel,
  hidePageChrome = false,
  hideBreadcrumbs = false,
}: WorkspaceShellProps) {
  // A learner who is still onboarding, or who has finished enrolment but is not
  // yet being taught, gets a reduced sidebar — most of the workspace needs a
  // running training plan. Applied here so every learner page inherits it.
  const { auth } = useAuth();
  const signedInEmail = auth.account?.email || auth.user?.email;
  const hideFocusedLearnerSidebar = role === 'learner' && isLearnerFlowAccount(signedInEmail);
  const navItems = useLearnerNavGate(role, navItemsProp, signedInEmail);
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [previousRoute, setPreviousRoute] = useState('');

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(readPinnedPreference);

  const handlePinChange = (pinned: boolean) => {
    setSidebarPinned(pinned);
    try {
      localStorage.setItem(SIDEBAR_PINNED_KEY, String(pinned));
    } catch { /* Ignore unavailable browser storage. */ }
  };

  const displayName = userName || auth.user?.fullName || 'User';
  const displayRole = userRole || auth.roles[0]?.name || roleLabel;
  const defaultWorkspaceLabel = workspaceLabel || roleLabel + ' Workspace';

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

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

  const handleReturnToPreviousWindow = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    const fallbackRoute = breadcrumbs.find(crumb => crumb.isLink && crumb.href && crumb.href !== `${location.pathname}${location.search}`)?.href || '/';
    navigate(fallbackRoute);
  };

  return (
    <div
      className="dashboard-theme workspace-shell flex h-screen bg-background-200 overflow-hidden"
      data-workspace-role={role}
      // The offset itself is applied under a `lg` media query in index.css —
      // below that breakpoint the sidebar is an off-canvas drawer and must
      // reserve nothing.
      style={{ '--kbc-sidebar-width': `${hideFocusedLearnerSidebar ? 0 : sidebarPinned ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH}px` } as CSSProperties}
    >
      {!hideFocusedLearnerSidebar && (
        <Sidebar
          role={role}
          roleLabel={roleLabel}
          navItems={navItems}
          userName={displayName}
          userRole={displayRole}
          pinned={sidebarPinned}
          onPinChange={handlePinChange}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
      )}
      {/* Reserve exactly the sidebar's own width — the two numbers come from the
          same constants, so the content can never sit under the rail. The hover
          preview is deliberately not reserved: it floats above the page. */}
      <div
        className="workspace-content flex-1 flex flex-col min-w-0 bg-background-200 transition-[margin] duration-300 ease-out"
        style={{ marginLeft: hideFocusedLearnerSidebar ? 0 : `var(--kbc-sidebar-offset, 0px)` }}
      >
        {!hidePageChrome && (
          <Header
            pageTitle={pageTitle}
            pageSubtitle={pageSubtitle}
            onOpenSearch={() => setSearchOpen(true)}
            userName={displayName}
            onToggleMobileSidebar={hideFocusedLearnerSidebar ? undefined : handleToggleMobileSidebar}
            role={role}
          />
        )}

        {/* Breadcrumbs */}
        {!hidePageChrome && !hideBreadcrumbs && breadcrumbs.length > 0 && (
          <div className="workspace-breadcrumbs flex h-8 shrink-0 items-center overflow-hidden border-b border-background-300/40 bg-background-200 px-3 md:px-5">
            <nav className="flex min-w-0 items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Breadcrumb">
              {roleLabel !== 'Super Admin' && (
                <>
                  <Link to="/" className="text-foreground-300 hover:text-foreground-500 transition-smooth">
                    <AppIcon className="ri-home-3-line text-base"></AppIcon>
                  </Link>
                  <AppIcon className="ri-arrow-right-s-line text-foreground-200 text-xs"></AppIcon>
                </>
              )}
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb.href}-${index}`} className="flex items-center gap-1.5">
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
            </nav>
          </div>
        )}

        {/* Main content with page transition */}
        {/* No fade or key here: the whole shell is remounted on every route
            change (router/index.ts keys the boundary by pathname), so a
            transition owned by this component could never run. It used to hold
            an opacity-0 state behind a 120ms timer that nothing ever set. */}
        <main className="workspace-main flex-1 overflow-y-auto bg-background-200">
          {/* An administrator reading a coach's workspace: shown on every coach
              page, since the sidebar reaches most of them without passing the
              dashboard that chose the coach. */}
          {role === 'coach' && <CoachViewAsBar />}
          {children}
        </main>
      </div>

      {showBackButton && (
        <button
          type="button"
          onClick={handleReturnToPreviousWindow}
          className="fixed right-4 top-20 z-50 hidden h-10 items-center gap-2 rounded-xl border border-primary-200 bg-background-50 px-3 text-[12px] font-bold text-primary-700 shadow-lg shadow-primary-950/10 transition-smooth hover:-translate-y-0.5 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300 sm:inline-flex"
          title={previousRoute ? 'Back to the previous screen' : 'Back'}
        >
          <AppIcon className="ri-arrow-go-back-line text-base"></AppIcon>
          <span className="hidden sm:inline">Back</span>
        </button>
      )}

      {/* Global Search Modal */}
      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
