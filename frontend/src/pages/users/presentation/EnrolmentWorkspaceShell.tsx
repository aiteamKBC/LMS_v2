import { useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChevronRight, LogOut, UserRoundPlus, X } from 'lucide-react';
import type { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { Header, SignOutConfirmModal } from '@/components/feature/Header';
import { GlobalSearch } from '@/components/feature/GlobalSearch';
import { SidebarIcon, type SidebarNavItem } from '@/components/feature/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import styles from './EnrolmentWorkspace.module.css';

type Props = ComponentProps<typeof WorkspaceShell> & { directoryLayout?: boolean };
const navigationOrder = ['/users', '/users/first-sessions', '/users/coach-directory', '/users/progress-transfers', '/users/my-courses'];
const logoUrl = 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/16480272afc94729b2911a62d1bbf85d.webp';

/** Enrollment-only frame. Shared headers, search, routes and permission checks are reused. */
export function EnrolmentWorkspaceShell({ children, role, roleLabel, navItems, pageTitle, pageSubtitle,
  headerExtras, userName, workspaceLabel = 'Enrolment', showBackButton = true, backFallbackHref = '/users',
  breadcrumbCurrentLabel, hidePageChrome = false, hideBreadcrumbs = false, directoryLayout = false,
}: Props) {
  const { auth, isAdmin, canSeeNavItem, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const accountRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const permittedItems = useMemo(() => navItems
    .filter(item => canSeeNavItem(item.id))
    .map(item => ({ ...item, children: item.children?.filter(child => canSeeNavItem(child.id)) }))
    .filter(item => item.href || item.children?.length)
    .sort((left, right) => {
      const rank = (item: SidebarNavItem) => {
        const index = navigationOrder.indexOf(item.href ?? '');
        return index < 0 ? navigationOrder.length : index;
      };
      return rank(left) - rank(right);
    }), [navItems, canSeeNavItem]);
  const destinations = permittedItems.flatMap(item => [item, ...(item.children ?? [])]);
  const current = `${location.pathname}${location.search}`;
  const activeHref = destinations.filter(item => item.href && ((item.href.includes('?')
    ? item.href === current : location.pathname === item.href || location.pathname.startsWith(`${item.href}/`))
    || item.matchPaths?.some(path => location.pathname === path || location.pathname.startsWith(`${path}/`))))
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0]?.href;
  const displayName = userName || auth.account?.displayName || auth.user?.fullName || 'Account';
  const chromeRole = isAdmin && /^\/users(?:\/|$)/.test(location.pathname) ? 'admin' : role;

  useEffect(() => { setMobileOpen(false); }, [location.pathname, location.search]);
  useEffect(() => {
    const resize = () => { if (window.innerWidth >= 1024) setMobileOpen(false); };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menu = menuRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileOpen(false); return; }
      if (event.key !== 'Tab') return;
      const targets = Array.from(navigationRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? [])
        .filter(element => element.offsetParent !== null);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      if (previous?.isConnected) previous.focus(); else menu?.focus();
    };
  }, [mobileOpen]);

  const renderItem = (item: SidebarNavItem) => {
    const active = item.active ?? item.href === activeHref;
    const content = <>{item.id === 'enrolment-courses' ? <BookOpen size={18} /> : <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={18} />}
      <span className={styles.navLabel}>{item.label}</span>
      {item.statusDot && <span className={styles.statusDot} data-tone={item.statusDot} aria-hidden="true" />}
      {item.badge ? <span className={styles.count}>{item.badge}</span> : null}
      {item.tag && <small>{item.tag}</small>}
      {item.comingSoon && <small>Soon</small>}
      {item.locked && <small aria-label={item.lockedReason || 'Locked'}>Locked</small>}
    </>;
    return item.locked || item.comingSoon || !item.href
      ? <span className={styles.navItem} aria-disabled="true" title={item.lockedReason} key={item.id}>{content}</span>
      : <Link key={item.id} to={item.href} state={item.state} className={styles.navItem}
          aria-current={active ? 'page' : undefined}
          target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}
          onClick={() => setMobileOpen(false)}>{content}</Link>;
  };

  return <div className={`dashboard-theme workspace-shell ${styles.shell} ${directoryLayout ? styles.directoryShell : ''}`} data-workspace-role={chromeRole}
    data-collapsed="false" style={{ '--enrolment-sidebar-width': '16.5rem' } as CSSProperties}>
    {mobileOpen && <div className={styles.backdrop} aria-hidden="true" onClick={() => setMobileOpen(false)} />}
    <aside ref={navigationRef} id={`${chromeRole}-mobile-navigation`} className={styles.sidebar} data-mobile-open={mobileOpen}
      aria-label={`${workspaceLabel} navigation`} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined}>
      <div className={styles.brand}>
        <img src={logoUrl} alt="Kent Business College" width="36" height="40" />
        <div className={styles.brandText}><strong>Enrolment</strong><span>Kent Business College</span></div>
        {mobileOpen && <button ref={closeRef} className={styles.mobileClose} type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={19} /></button>}
      </div>
      <div className={styles.workspaceLabel}><UserRoundPlus size={19} aria-hidden="true" /><span><small>Workspace</small><strong>{workspaceLabel}</strong></span></div>
      <nav className={styles.navigation} aria-label={`${roleLabel} primary navigation`}>
        {permittedItems.map(item => <div key={item.id}>{renderItem(item)}{item.children?.map(renderItem)}</div>)}
      </nav>
      <div className={styles.sidebarFooter}>
        <button type="button" className={styles.signOut} aria-label="Sign out" title="Sign out" onClick={() => { setMobileOpen(false); setSignOutOpen(true); }}><LogOut size={18} /><span>Sign out</span></button>
      </div>
    </aside>
    <div className={`workspace-content ${styles.content}`} inert={mobileOpen || undefined} aria-hidden={mobileOpen || undefined}>
      {!hidePageChrome && <Header accountButtonRef={accountRef} pageTitle={pageTitle} pageSubtitle={pageSubtitle}
        headerExtras={headerExtras} userName={displayName} role={chromeRole} appearance={directoryLayout ? 'enrolment' : undefined} workspaceLabel={workspaceLabel} sidebarSignOut
        pageIcon={activeHref ? <SidebarIcon id={destinations.find(item => item.href === activeHref)?.id} label={pageTitle} /> : undefined}
        onToggleMobileSidebar={() => setMobileOpen(value => !value)} mobileSidebarOpen={mobileOpen} mobileMenuButtonRef={menuRef}
        onOpenSearch={() => setSearchOpen(true)} />}
      {!hidePageChrome && (!hideBreadcrumbs || showBackButton) && <div className={styles.breadcrumbs}>
        {showBackButton && <button type="button" aria-label="Back to previous page" onClick={() => {
          if (typeof window.history.state?.idx === 'number' && window.history.state.idx > 0) navigate(-1);
          else navigate(location.pathname === '/users' ? '/' : backFallbackHref, { replace: true });
        }}><ArrowLeft size={15} aria-hidden="true" />Back</button>}
        {!hideBreadcrumbs && <nav aria-label="Breadcrumb"><Link to="/users">{workspaceLabel}</Link><ChevronRight size={13} aria-hidden="true" /><span>{breadcrumbCurrentLabel || pageTitle}</span></nav>}
      </div>}
      <main className={`workspace-main ${styles.main}`}>{children}</main>
    </div>
    <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} appearance="enrolment" />
    {signOutOpen && createPortal(<SignOutConfirmModal displayName={displayName} email={auth.user?.email || auth.account?.email || ''}
      onClose={() => setSignOutOpen(false)} onConfirm={() => { setSignOutOpen(false); logout(); }} />, document.body)}
  </div>;
}
