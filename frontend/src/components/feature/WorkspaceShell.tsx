import { useState, type ReactNode, useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Sidebar, type SidebarNavItem } from './Sidebar';
import { Header } from './Header';
import { GlobalSearch } from './GlobalSearch';
import { useAuth } from '@/hooks/useAuth';

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
}

interface BreadcrumbItem {
  label: string;
  href: string;
}

function buildBreadcrumbs(pathname: string, navItems: SidebarNavItem[], workspaceLabel: string, roleLabel: string): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [];

  // Always start with workspace root if applicable
  const isInWorkspace = pathname.startsWith('/workspace/');

  if (!isInWorkspace) {
    // Try to find matching nav item to build breadcrumb
    const allItems: SidebarNavItem[] = [];
    navItems.forEach(item => {
      allItems.push(item);
      if (item.children) item.children.forEach(c => allItems.push(c));
    });

    const dashboardItem = navItems.find(i => i.href.includes('/workspace/'));
    if (dashboardItem) {
      crumbs.push({ label: workspaceLabel, href: dashboardItem.href });
    }

    const matched = allItems.find(i => pathname === i.href || pathname.startsWith(i.href + '/'));
    if (matched && matched.href !== (dashboardItem?.href ?? '')) {
      crumbs.push({ label: matched.label, href: matched.href });
    } else if (!matched) {
      // Derive from path segments
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const parentLabel = segments[0].charAt(0).toUpperCase() + segments[0].slice(1).replace(/-/g, ' ');
        const childLabel = segments.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')).join(' — ');
        if (dashboardItem) {
          crumbs.push({ label: parentLabel, href: `/${segments[0]}` });
        }
        crumbs.push({ label: childLabel, href: pathname });
      }
    }
  } else {
    crumbs.push({ label: workspaceLabel, href: pathname });
  }

  return crumbs;
}

export function WorkspaceShell({
  children,
  role,
  roleLabel,
  navItems,
  pageTitle,
  pageSubtitle,
  userName,
  userRole,
  workspaceLabel,
}: WorkspaceShellProps) {
  const location = useLocation();
  const { auth } = useAuth();
  const [searchOpen, setSearchOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [displayKey, setDisplayKey] = useState(location.pathname);
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

  const breadcrumbs = buildBreadcrumbs(location.pathname, navItems, defaultWorkspaceLabel, roleLabel);

  const handleToggleMobileSidebar = () => {
    setMobileSidebarOpen(prev => !prev);
  };

  return (
    <div className="flex h-screen bg-background-200 overflow-hidden">
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
      <div className="flex-1 flex flex-col min-w-0 ml-0 bg-background-200 lg:ml-[56px] transition-[margin] duration-300 ease-out">
        <Header
          pageTitle={pageTitle}
          pageSubtitle={pageSubtitle}
          onOpenSearch={() => setSearchOpen(true)}
          userName={displayName}
          onToggleMobileSidebar={handleToggleMobileSidebar}
        />

        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <div className="h-8 bg-background-200 border-b border-background-300/40 flex items-center px-3 md:px-5 shrink-0">
            <nav className="flex items-center gap-1.5 text-xs" aria-label="Breadcrumb">
              <Link to="/" className="text-foreground-300 hover:text-foreground-500 transition-smooth">
                <i className="ri-home-3-line text-xs"></i>
              </Link>
              <i className="ri-arrow-right-s-line text-foreground-200 text-xs"></i>
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.href} className="flex items-center gap-1.5">
                  {index < breadcrumbs.length - 1 ? (
                    <>
                      <Link to={crumb.href} className="text-foreground-400 hover:text-foreground-600 transition-smooth whitespace-nowrap">
                        {crumb.label}
                      </Link>
                      <i className="ri-arrow-right-s-line text-foreground-200 text-xs"></i>
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
          className={`flex-1 overflow-y-auto bg-background-200 transition-opacity duration-200 ${isTransitioning ? 'opacity-0' : 'opacity-100'}`}
        >
          {children}
        </main>
      </div>

      {/* Global Search Modal */}
      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}