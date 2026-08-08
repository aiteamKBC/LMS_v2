import { useState, type ReactNode, useEffect, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Sidebar, type SidebarNavItem } from './Sidebar';
import { Header } from './Header';
import { GlobalSearch } from './GlobalSearch';
import { useAuth } from '@/hooks/useAuth';
import { useLearnerNavGate } from '@/hooks/useLearnerNavGate';

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
}

interface BreadcrumbItem {
  label: string;
  href: string;
  isLink: boolean;
}

const ROUTE_HISTORY_KEY = 'lmsRouteHistory';

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
        crumbs.push({ label: matchedParent.label, href: '', isLink: false });
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
    crumbs.push({ label: workspaceLabel, href: pathname, isLink: true });
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
}: WorkspaceShellProps) {
  // A learner who is still onboarding, or who has finished enrolment but is not
  // yet being taught, gets a reduced sidebar — most of the workspace needs a
  // running training plan. Applied here so every learner page inherits it.
  const navItems = useLearnerNavGate(role, navItemsProp);
  const location = useLocation();
  const navigate = useNavigate();
  const { auth } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayKey, setDisplayKey] = useState(location.pathname);
  const [previousRoute, setPreviousRoute] = useState('');
  const prevPathRef = useRef(location.pathname);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const displayName = userName || auth.user?.fullName || 'User';
  const displayRole = userRole || auth.roles[0]?.name || roleLabel;
  const defaultWorkspaceLabel = workspaceLabel || roleLabel + ' Workspace';

  // Page transition on route change
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      setIsTransitioning(true);
      const timer = setTimeout(() => {
        setDisplayKey(location.pathname);
        setIsTransitioning(false);
        prevPathRef.current = location.pathname;
      }, 120);
      return () => clearTimeout(timer);
    }
  }, [location.pathname]);

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

  const breadcrumbs = buildBreadcrumbs(location.pathname, location.search, navItems, defaultWorkspaceLabel, roleLabel);

  const handleToggleMobileSidebar = () => {
    setMobileSidebarOpen(prev => !prev);
  };

  const handleReturnToPreviousWindow = () => {
    const currentRoute = `${location.pathname}${location.search}${location.hash}`;
    const history = readRouteHistory();
    while (history.length && history.at(-1) === currentRoute) history.pop();
    const targetRoute = history.pop() || previousRoute;
    if (targetRoute) {
      writeRouteHistory(history);
      navigate(targetRoute);
      return;
    }
    const fallbackRoute = breadcrumbs.find(crumb => crumb.isLink && crumb.href && crumb.href !== `${location.pathname}${location.search}`)?.href || '/';
    navigate(fallbackRoute);
  };

  return (
    <div className="dashboard-theme workspace-shell flex h-screen bg-background-200 overflow-hidden">
      <Sidebar
        role={role}
        roleLabel={roleLabel}
        navItems={navItems}
        userName={displayName}
        userRole={displayRole}
        collapsed={true}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />
      <div className="workspace-viewport flex-1 flex flex-col min-w-0 ml-0 bg-background-200 lg:ml-[56px] transition-[margin] duration-500 ease-out">
        <Header
          pageTitle={pageTitle}
          pageSubtitle={pageSubtitle}
          onOpenSearch={() => setSearchOpen(true)}
          userName={displayName}
          onToggleMobileSidebar={handleToggleMobileSidebar}
        />

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <div className="workspace-breadcrumbs flex h-8 shrink-0 items-center overflow-hidden border-b border-background-300/40 bg-background-200 px-3 md:px-5">
            <nav className="flex min-w-0 items-center gap-1.5 overflow-x-auto text-xs [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Breadcrumb">
              <Link to="/" className="text-foreground-300 hover:text-foreground-500 transition-smooth">
                <AppIcon className="ri-home-3-line text-base"></AppIcon>
              </Link>
              <AppIcon className="ri-arrow-right-s-line text-foreground-200 text-xs"></AppIcon>
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb.href}-${index}`} className="flex items-center gap-1.5">
                  {index < breadcrumbs.length - 1 ? (
                    <>
                      {crumb.isLink ? (
                        <Link to={crumb.href} className="text-foreground-400 hover:text-foreground-600 transition-smooth whitespace-nowrap">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className="text-foreground-400 whitespace-nowrap">{crumb.label}</span>
                      )}
                      <AppIcon className="ri-arrow-right-s-line text-foreground-200 text-xs"></AppIcon>
                    </>
                  ) : (
                    <span className="text-foreground-700 font-medium whitespace-nowrap">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          </div>
        )}

        {/* Main content with page transition */}
        <main
          key={displayKey}
          className={`workspace-main flex-1 overflow-y-auto bg-background-200 transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
        >
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
