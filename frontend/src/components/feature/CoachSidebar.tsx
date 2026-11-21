import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, X } from 'lucide-react';
import { useAuth } from "@/hooks/useAuth";
import { SidebarIcon, type SidebarNavItem } from './Sidebar';
import { LEARNER_LOGO_URL, LEARNER_SIDEBAR_PATTERN_URL } from './learnerShellAssets';
import styles from './CoachSidebar.module.css';

interface CoachSidebarProps {
  navItems: SidebarNavItem[];
  userName: string;
  userRole: string;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenAccount: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function CoachSidebar({ navItems, mobileOpen, onCloseMobile }: CoachSidebarProps) {
  const { canSeeNavItem } = useAuth();
  const location = useLocation();
  const drawerRef = useRef<HTMLDivElement>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const items = navItems.filter(item => canSeeNavItem(item.id))
    .map(item => ({ ...item, children: item.children?.filter(child => canSeeNavItem(child.id)) }))
    .filter(item => item.href || item.children?.length);
  const destinations = items.flatMap(item => [item, ...(item.children ?? [])]);
  const active = (item: SidebarNavItem) => {
    const current = `${location.pathname}${location.search}`;
    if (item.href.includes('?')) return item.href === current;
    if (item.matchPaths?.some(path => location.pathname === path || location.pathname.startsWith(`${path}/`))) return true;
    return Boolean(item.href) && (location.pathname === item.href || location.pathname.startsWith(`${item.href}/`))
      && !destinations.some(other => other.href.length > item.href.length
        && (other.href === current || location.pathname.startsWith(`${other.href}/`)));
  };

  useEffect(() => {
    if (!mobileOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>('button, a')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseMobile();
      if (event.key !== 'Tab' || !drawer) return;
      const controls = Array.from(drawer.querySelectorAll<HTMLElement>('a[href], button, summary'))
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); opener?.focus(); };
  }, [mobileOpen, onCloseMobile]);

  const panel = (mobile: boolean) => {
    return <>
    <div className={`kbc-sidebar-theme-pattern ${styles.pattern}`} aria-hidden="true" style={{ backgroundImage: `url(${LEARNER_SIDEBAR_PATTERN_URL})` }} />
    <div className={`kbc-sidebar-theme-brand ${styles.brand}`}><img src={LEARNER_LOGO_URL} alt="Kent Business College" />
      {mobile && <button type="button" className={styles.close} aria-label="Close navigation" onClick={onCloseMobile}><X size={18} /></button>}
    </div>
    <nav className={`kbc-sidebar-theme-nav ${styles.nav}`} aria-label={`Coach ${mobile ? 'mobile menu' : 'primary navigation'}`}>
      {items.map(item => item.children?.length ? <div key={item.id}>
        <button type="button" className={styles.row} aria-expanded={openGroups[item.id] ?? item.children.some(active)}
          aria-controls={`${mobile ? 'mobile-' : ''}${item.id}-links`} data-active={item.children.some(active)}
          onClick={() => {
            setOpenGroups(current => ({ ...current, [item.id]: !(current[item.id] ?? item.children.some(active)) }));
          }}>
          <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} /><span className={styles.label}>{item.label}</span><ChevronDown className={styles.chevron} size={14} />
        </button>
        {(openGroups[item.id] ?? item.children.some(active)) && <div className={styles.children} id={`${mobile ? 'mobile-' : ''}${item.id}-links`}>
          {item.children.map(child => <Link key={child.id} to={child.href} className={styles.row} aria-current={active(child) ? 'page' : undefined} onClick={onCloseMobile}>
            <SidebarIcon id={child.id} label={child.label} sourceIcon={child.icon} size={15} /><span className={styles.label}>{child.label}</span>
          </Link>)}
        </div>}
      </div> : item.external ? <a key={item.id} href={item.href} target="_blank" rel="noopener noreferrer" className={styles.row} onClick={onCloseMobile}>
        <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} /><span className={styles.label}>{item.label}</span>
      </a> : <Link key={item.id} to={item.href} className={styles.row} aria-current={active(item) ? 'page' : undefined} onClick={onCloseMobile}>
        <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} /><span className={styles.label}>{item.label}</span>
      </Link>)}
    </nav>
  </>;
  };

  return <>
    <aside className={`kbc-workspace-sidebar kbc-sidebar-surface kbc-sidebar-coach ${styles.desktop}`} aria-label="Coach sidebar" data-workspace-role="coach" data-collapsed="false">
      {panel(false)}
    </aside>
    {mobileOpen && <div className={styles.backdrop} onClick={onCloseMobile} aria-hidden="true" />}
    <div ref={drawerRef} id="coach-mobile-navigation" className={`kbc-workspace-sidebar kbc-sidebar-surface kbc-sidebar-coach ${styles.mobile}`} data-open={mobileOpen} aria-label="Coach mobile navigation"
      role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen ? true : undefined} aria-hidden={!mobileOpen} inert={!mobileOpen}>{panel(true)}</div>
  </>;
}
