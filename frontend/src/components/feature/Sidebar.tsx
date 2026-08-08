import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowUpCircle,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Building2,
  Calendar,
  CalendarCheck,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Compass,
  Database,
  ExternalLink,
  FileSearch,
  FileText,
  Flag,
  Folder,
  FolderOpen,
  FolderUp,
  Gift,
  GitBranch,
  HandHeart,
  Heart,
  HeartPulse,
  History,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  LockKeyhole,
  Menu,
  MessageSquare,
  Phone,
  PieChart,
  Plug,
  Presentation,
  Receipt,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Star,
  ThumbsUp,
  Trophy,
  Upload,
  UserCog,
  UserPlus,
  Users,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: string;
  /** Leaf destination. Navigation groups intentionally omit it. */
  href?: string;
  badge?: number;
  comingSoon?: boolean;
  statusDot?: 'red' | 'amber' | 'blue' | 'green';
  children?: SidebarNavItem[];
}

interface SidebarProps {
  role: string;
  roleLabel: string;
  navItems: SidebarNavItem[];
  userName?: string;
  userRole?: string;
  collapsed?: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onHoverChange?: (hovered: boolean) => void;
  onPinChange?: (pinned: boolean) => void;
}

/**
 * Resolve navigation icons from the meaning of the item instead of the old
 * icon-font class. The navigation data remains unchanged; this is only a
 * presentation adapter for the sidebar's desktop and mobile renderers.
 */
function resolveSidebarIcon(id = '', label = '', sourceIcon = ''): LucideIcon {
  const key = `${id} ${label} ${sourceIcon}`.toLowerCase();

  if (/dashboard|overview/.test(key)) return LayoutDashboard;
  // Curriculum workspace groups get distinct icons so the sidebar is scannable.
  if (/programme\s*-?\s*design|programme-design/.test(key)) return Presentation;
  if (/curriculum\s*-?\s*builder|curriculum-builder/.test(key)) return Workflow;
  if (/assessment\s*-?\s*design|assessment-design/.test(key)) return ClipboardList;
  if (/delivery\s*-?\s*planning|delivery-planning/.test(key)) return CalendarDays;
  if (/quality\s*&?\s*publishing|quality.*publish/.test(key)) return ShieldCheck;
  if (/^reports?$|\breports?\b/.test(key)) return FileText;
  if (/message|communication|feedback/.test(key)) return MessageSquare;
  if (/support|ticket|knowledge-base|help/.test(key)) return LifeBuoy;
  if (/permission|access|role|key/.test(key)) return KeyRound;
  if (/setting|configuration|automation|manual-mode|system/.test(key)) return Settings2;
  if (/integration|plug/.test(key)) return Plug;
  if (/notification|what's new/.test(key)) return Bell;
  if (/audit|history|log|governance/.test(key)) return History;
  if (/safeguard|wellbeing|welfare|heart|prevent|concern/.test(key)) return HeartPulse;
  if (/risk|escalat|urgent|warning|absence|rejected|error/.test(key)) return AlertTriangle;
  if (/finance|funding|payment|budget|invoice|invoic|money/.test(key)) return CircleDollarSign;
  if (/document|file|form|policy|record|contract|report|review/.test(key)) {
    return /review|audit|search/.test(key) ? FileSearch : FileText;
  }
  if (/evidence|folder|library|storage|resource/.test(key)) return FolderOpen;
  if (/quiz|question|assessment|test|checkpoint/.test(key)) return ClipboardList;
  if (/attendance|calendar|timetable|meeting|event|session|schedule/.test(key)) {
    return /attendance/.test(key) ? CalendarCheck : CalendarDays;
  }
  if (/training|learning|module|programme|curriculum|knowledge|plan|week/.test(key)) return BookOpen;
  if (/journey|readiness|gateway|epa/.test(key)) return Compass;
  if (/progress|intelligence|performance|trend|impact|quality|insight|sampling/.test(key)) return BarChart3;
  if (/employer|tenant|organisation|building|workplace/.test(key)) return Building2;
  if (/learner|apprentice|cohort|staff|user|team|club|group/.test(key)) return Users;
  if (/allocation|assignment/.test(key)) return UserPlus;
  if (/coach|tutor/.test(key)) return UserCog;
  if (/upload|import/.test(key)) return Upload;
  if (/link|mapping/.test(key)) return Link2;
  if (/version|branch/.test(key)) return GitBranch;
  if (/archive/.test(key)) return Archive;
  if (/reward|recognition|achievement|trophy|award/.test(key)) return Trophy;
  if (/gift|voucher|claim|points/.test(key)) return Gift;
  if (/shopping|shop/.test(key)) return ShoppingBag;
  if (/flash|ai|robot/.test(key)) return Bot;
  if (/phone|contact/.test(key)) return Phone;
  if (/external/.test(key)) return ExternalLink;
  if (/secure|lock/.test(key)) return LockKeyhole;
  if (/starred|star/.test(key)) return Star;
  if (/thumb|recognition/.test(key)) return ThumbsUp;
  if (/flag|pipeline/.test(key)) return Flag;
  if (/arrow-up|internal/.test(key)) return ArrowUpCircle;
  if (/shield|compliance|quality/.test(key)) return ShieldCheck;
  if (/database|data/.test(key)) return Database;
  if (/receipt|invoice|bill/.test(key)) return Receipt;
  if (/pie/.test(key)) return PieChart;
  if (/refresh|cycle/.test(key)) return RefreshCw;
  if (/activity|engagement/.test(key)) return Activity;
  if (/heart/.test(key)) return Heart;
  if (/hand-heart/.test(key)) return HandHeart;
  if (/presentation|teaching|delivery/.test(key)) return Presentation;
  if (/clock|time|otjh|hours/.test(key)) return Clock;
  if (/folder/.test(key)) return Folder;
  if (/open-cases/.test(key)) return FolderUp;
  if (/open/.test(key)) return FolderOpen;
  if (/calendar/.test(key)) return Calendar;
  if (/search|find|qa/.test(key)) return Search;
  if (/workflow|automation/.test(key)) return Workflow;
  if (/zap|flash/.test(key)) return Zap;

  return Circle;
}

function SidebarIcon({ id, label, sourceIcon, size = 18, className }: {
  id?: string;
  label: string;
  sourceIcon?: string;
  size?: number;
  className?: string;
}) {
  const Icon = resolveSidebarIcon(id, label, sourceIcon);
  return <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} className={className} />;
}

export function Sidebar({ roleLabel, navItems, mobileOpen, onCloseMobile, onHoverChange }: SidebarProps) {
  const location = useLocation();
  const { canSeeNavItem } = useAuth();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [, setSubmenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('kbc_sidebar_expanded');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    try {
      localStorage.setItem('kbc_sidebar_expanded', JSON.stringify([...expandedGroups]));
    } catch { /* Ignore unavailable browser storage. */ }
  }, [expandedGroups]);

  // Close dropdown on route change
  useEffect(() => {
    setActiveDropdown(null);
  }, [location.pathname]);

  // Click outside to close dropdown
  useEffect(() => {
    if (!activeDropdown) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const dropdown = document.getElementById(`dropdown-${activeDropdown}`);
      const button = document.getElementById(`nav-btn-${activeDropdown}`);
      if (dropdown && !dropdown.contains(target) && button && !button.contains(target)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [activeDropdown]);

  const filteredNavItems = useMemo(() => {
    return navItems
      .filter(item => canSeeNavItem(item.id))
      .map(item => ({
        ...item,
        children: item.children?.filter(child => canSeeNavItem(child.id)),
      }))
      .filter(item => Boolean(item.href || item.children?.length));
  }, [navItems, canSeeNavItem]);

  const queryMatchedHref = useMemo(() => {
    const current = `${location.pathname}${location.search}`;
    const items = filteredNavItems.flatMap(item => [item, ...(item.children ?? [])]);
    return items.find(item => item.href?.includes('?') && item.href === current)?.href ?? '';
  }, [filteredNavItems, location.pathname, location.search]);

  const openGroup = useCallback((id: string) => {
    setActiveDropdown(id);
    setSubmenuOpen(true);
  }, []);

  const closeGroup = useCallback((id: string) => {
    setActiveDropdown(prev => prev === id ? null : prev);
    setSubmenuOpen(false);
  }, []);

  const navHrefs = useMemo(
    () => filteredNavItems.flatMap(item => [
      item.href,
      ...(item.children?.map(child => child.href) ?? []),
    ]).filter(Boolean),
    [filteredNavItems],
  );

  const isActive = (href?: string) => {
    if (!href) return false;
    const [hrefPath] = href.split('?');
    const current = `${location.pathname}${location.search}`;
    if (href.includes('?')) return current === href;
    if (queryMatchedHref && hrefPath === queryMatchedHref.split('?')[0]) return false;
    const matches = location.pathname === href || location.pathname.startsWith(href + '/');
    if (!matches) return false;

    // Nested sibling routes can share a prefix (for example /learner/clubs
    // and /learner/clubs/events). Only the most specific matching item should
    // receive the active style.
    return !navHrefs.some(candidate =>
      candidate.length > href.length
      && (location.pathname === candidate || location.pathname.startsWith(candidate + '/'))
    );
  };

  // Keep the section containing the current route open when navigation is
  // supplied dynamically by the active role/configuration.
  useEffect(() => {
    const activeGroupIds = filteredNavItems
      .filter(item => item.children?.some(child => isActive(child.href)))
      .map(item => item.id);
    if (activeGroupIds.length === 0) return;
    setExpandedGroups(prev => {
      const next = new Set(prev);
      activeGroupIds.forEach(id => next.add(id));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredNavItems, location.pathname, location.search]);

  const hasChildren = (item: SidebarNavItem) => item.children && item.children.length > 0;

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    onHoverChange?.(true);
  }, [onHoverChange]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setSubmenuOpen(false);
    setActiveDropdown(null);
    onHoverChange?.(false);
  }, [onHoverChange]);

  const sidebarExpanded = isHovering;

  // Desktop sidebar (collapsed)
  const desktopSidebar = (
    <aside
      className="workspace-sidebar-panel w-full flex flex-col h-screen text-white relative overflow-visible"
      style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
    >
      {/* Liquid blob decorations */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute animate-liquid-blob-1 opacity-25"
          style={{
            width: '65%',
            height: '28%',
            left: '-15%',
            top: '-8%',
            background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, oklch(var(--accent-600) / 0.1) 45%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-2 opacity-20"
          style={{
            width: '75%',
            height: '35%',
            right: '-20%',
            top: '20%',
            background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.25) 0%, oklch(var(--primary-600) / 0.08) 45%, transparent 70%)',
            filter: 'blur(55px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-3 opacity-15"
          style={{
            width: '55%',
            height: '22%',
            left: '-5%',
            bottom: '10%',
            background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, oklch(var(--secondary-500) / 0.06) 45%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-4 opacity-10"
          style={{
            width: '50%',
            height: '25%',
            right: '-10%',
            bottom: '-5%',
            background: 'radial-gradient(ellipse at center, oklch(var(--accent-400) / 0.18) 0%, oklch(var(--primary-400) / 0.06) 50%, transparent 70%)',
            filter: 'blur(55px)',
          }}
        />
      </div>

      {/* Logo */}
      <div className="workspace-sidebar-menu-toggle relative z-10 flex items-center justify-start h-14 px-4 shrink-0">
        <Menu className={`workspace-sidebar-menu-icon ${isHovering || mobileOpen ? 'workspace-sidebar-menu-icon-expanded' : ''}`} size={22} strokeWidth={2} aria-hidden="true" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex-1 overflow-y-auto py-2 px-1.5">
        <div className="space-y-1">
          {filteredNavItems.map((item, index) => (
            <div key={item.id} className="animate-in slide-in-from-right-2 duration-300" style={{ animationDelay: `${index * 40}ms` }}>
              {hasChildren(item) ? (
                <NavGroup
                  item={item}
                  isActive={isActive}
                  isDropdownOpen={activeDropdown === item.id}
                  onOpen={() => openGroup(item.id)}
                  onClose={() => closeGroup(item.id)}
                />
              ) : (
                <NavLink item={item} isActive={isActive} />
              )}
            </div>
          ))}
        </div>
      </nav>

      {/* Bottom links */}
      <div className="relative z-10 px-2 py-3 border-t border-white/10 shrink-0">
        <div className="space-y-0.5">
          <SidebarBottomLink href="/support/knowledge-base" icon="ri-book-read-line" label="Knowledge Base" isActive={isActive} />
          <SidebarBottomLink href="/user-guide" icon="ri-guide-line" label="User Guides" isActive={isActive} />
          <SidebarBottomLink href="/support/ticket-queue" icon="ri-customer-service-2-line" label="Contact Support" isActive={isActive} />
          <SidebarBottomLink href="/notifications" icon="ri-bell-line" label="What's New" isActive={isActive} />
        </div>
      </div>
    </aside>
  );

  // Expanded sidebar (used for mobile drawer and desktop hover-expand)
  const mobileSidebar = (
    <aside
      className="workspace-sidebar-panel w-full flex flex-col h-screen text-white relative overflow-hidden"
      style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}
    >
      {/* Liquid blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute animate-liquid-blob-1 opacity-25"
          style={{
            width: '65%',
            height: '28%',
            left: '-15%',
            top: '-8%',
            background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, oklch(var(--accent-600) / 0.1) 45%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-2 opacity-20"
          style={{
            width: '75%',
            height: '35%',
            right: '-20%',
            top: '20%',
            background: 'radial-gradient(ellipse at center, oklch(var(--primary-500) / 0.25) 0%, oklch(var(--primary-600) / 0.08) 45%, transparent 70%)',
            filter: 'blur(55px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-3 opacity-15"
          style={{
            width: '55%',
            height: '22%',
            left: '-5%',
            bottom: '10%',
            background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, oklch(var(--secondary-500) / 0.06) 45%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />
        <div
          className="absolute animate-liquid-blob-4 opacity-10"
          style={{
            width: '50%',
            height: '25%',
            right: '-10%',
            bottom: '-5%',
            background: 'radial-gradient(ellipse at center, oklch(var(--accent-400) / 0.18) 0%, oklch(var(--primary-400) / 0.06) 50%, transparent 70%)',
            filter: 'blur(55px)',
          }}
        />
      </div>

      {/* Sidebar control */}
      <div className="workspace-sidebar-menu-toggle relative z-10 flex items-center justify-start h-14 px-4 shrink-0">
        <Menu className={`workspace-sidebar-menu-icon ${isHovering || mobileOpen ? 'workspace-sidebar-menu-icon-expanded' : ''}`} size={22} strokeWidth={2} aria-hidden="true" />
      </div>

      {/* Mobile navigation */}
      <nav className="relative z-10 flex-1 overflow-y-auto py-2 px-1.5">
        <div className="space-y-1">
          {filteredNavItems.map((item, index) => (
            <div key={item.id} className="animate-in slide-in-from-right-2 duration-300" style={{ animationDelay: `${index * 40}ms` }}>
              {hasChildren(item) ? (
                <MobileNavGroup
                  item={item}
                  isActive={isActive}
                  isExpanded={mobileOpen ? expandedGroups.has(item.id) : false}
                  onSubmenuChange={setSubmenuOpen}
                  onToggle={() => {
                    setExpandedGroups(prev => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    });
                  }}
                />
              ) : (
                <MobileNavLink item={item} isActive={isActive} />
              )}
            </div>
          ))}
        </div>
      </nav>

      {/* Mobile bottom */}
      <div className="relative z-10 px-2 py-3 border-t border-white/10 shrink-0">
        <div className="px-2 mb-1">
          <span className="text-[10px] font-semibold text-white/25 uppercase tracking-widest">Help &amp; Support</span>
        </div>
        <div className="space-y-0.5">
          <MobileSidebarBottomLink href="/support/knowledge-base" icon="ri-book-read-line" label="Knowledge Base" isActive={isActive} />
          <MobileSidebarBottomLink href="/user-guide" icon="ri-guide-line" label="User Guides" isActive={isActive} />
          <MobileSidebarBottomLink href="/support/ticket-queue" icon="ri-customer-service-2-line" label="Contact Support" isActive={isActive} />
          <MobileSidebarBottomLink href="/notifications" icon="ri-bell-line" label="What's New" isActive={isActive} />
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar — pinned open or expanded temporarily on hover */}
      <div
        className={`workspace-sidebar-desktop hidden lg:block fixed left-0 top-0 z-40 h-screen overflow-hidden transition-[width] duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] ${sidebarExpanded ? 'w-[300px] shadow-2xl' : 'w-[88px]'}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {sidebarExpanded ? mobileSidebar : desktopSidebar}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile sidebar */}
      <div className={`workspace-sidebar-mobile lg:hidden fixed left-0 top-0 z-50 h-screen w-[264px] transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {mobileSidebar}
        <button
          onClick={onCloseMobile}
          className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-smooth cursor-pointer lg:hidden"
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

// ---------- Desktop components (collapsed) ----------

function NavGroup({ item, isActive, isDropdownOpen, onOpen, onClose }: {
  item: SidebarNavItem;
  isActive: (href?: string) => boolean;
  isDropdownOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const anyChildActive = item.children?.some(child => isActive(child.href)) ?? false;
  const childCount = item.children?.length ?? 0;
  const needsSearch = childCount > 5;

  const openHover = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (!isDropdownOpen) setSearchQuery('');
    onOpen();
  };

  const scheduleClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(onClose, 120);
  };

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  const filteredChildren = useMemo(() => {
    if (!searchQuery.trim()) return item.children ?? [];
    return (item.children ?? []).filter(child =>
      child.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [item.children, searchQuery]);

  useLayoutEffect(() => {
    if (isDropdownOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownHeight = Math.min(childCount * 40 + 60, 400);
      let top = rect.top;
      if (rect.top + dropdownHeight > window.innerHeight - 16) {
        top = Math.max(8, window.innerHeight - dropdownHeight - 8);
      }
      setDropdownStyle({ top, left: rect.right });
    } else {
      setDropdownStyle(null);
    }
  }, [childCount, isDropdownOpen]);

  return (
    <div className="relative w-full" onMouseEnter={openHover} onMouseLeave={scheduleClose}>
      <button
        ref={buttonRef}
        id={`nav-btn-${item.id}`}
        onClick={event => event.preventDefault()}
        onFocus={openHover}
        onBlur={scheduleClose}
        className={`workspace-sidebar-hover-row workspace-sidebar-nav-item w-full flex items-center justify-center px-2 py-2 rounded-lg text-sm transition-all duration-200 group relative ${anyChildActive ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white/90 hover:bg-white/7'}`}
      >
        <span className="workspace-sidebar-nav-icon w-5 h-5 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110">
          <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={17} />
        </span>
        {item.badge && (
          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-accent-500 rounded-full animate-pulse-slow"></span>
        )}
        {item.comingSoon && <SoonDot />}
        {anyChildActive && !isDropdownOpen && (
          <span className="workspace-sidebar-active-marker absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400"></span>
        )}
      </button>
      {isDropdownOpen && dropdownStyle && createPortal(
        <div
          id={`dropdown-${item.id}`}
          className="workspace-sidebar-submenu workspace-sidebar-flyout fixed z-[100] w-[296px] rounded-2xl border p-2 shadow-2xl"
          style={{ 
            top: dropdownStyle.top, 
            left: dropdownStyle.left,
            background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)',
          }}
          onMouseEnter={openHover}
          onMouseLeave={scheduleClose}
        >
          <div className="p-1 max-h-[calc(100vh-24px)] overflow-y-auto">
            <div className="workspace-sidebar-flyout-title px-3 py-2 text-sm font-semibold text-white/90 border-b border-white/10 flex items-center justify-between">
              <span>{item.label}</span>
              {item.comingSoon ? <SoonBadge /> : <ChevronRight size={14} strokeWidth={1.8} className="text-white/40" aria-hidden="true" />}
            </div>
            {needsSearch && (
              <div className="relative px-2 py-2">
                <Search size={14} strokeWidth={1.8} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" aria-hidden="true" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="dropdown-search py-1.5 pr-2 rounded-md bg-white/5 hover:bg-white/10 focus:bg-white/10 transition-colors"
                  autoFocus
                />
              </div>
            )}
            <div className="dropdown-stagger">
              {filteredChildren.map(child => {
                const childActive = isActive(child.href);
                return (
                  <Link
                    key={child.id}
                    to={child.href}
                    aria-current={childActive ? 'page' : undefined}
                    className={`workspace-sidebar-flyout-link flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${childActive ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                    onClick={onClose}
                  >
                    <SidebarIcon id={child.id} label={child.label} sourceIcon={child.icon} size={20} />
                    <span className="flex-1">{child.label}</span>
                    {child.comingSoon ? <SoonBadge /> : <ChevronRight size={14} strokeWidth={1.8} className="workspace-sidebar-flyout-chevron text-white/40" aria-hidden="true" />}
                  </Link>
                );
              })}
            </div>
            {filteredChildren.length === 0 && (
              <div className="px-3 py-4 text-xs text-white/30 text-center">No items found</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function NavLink({ item, isActive }: {
  item: SidebarNavItem;
  isActive: (href?: string) => boolean;
}) {
  const active = isActive(item.href);

  const content = (
    <>
      <span data-sidebar-icon={/dashboard|overview/i.test(item.id + ' ' + item.label) ? 'dashboard' : undefined} className="workspace-sidebar-nav-icon w-5 h-5 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110">
        <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={17} />
      </span>
      {active && <span className="workspace-sidebar-active-marker absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400"></span>}
      {item.statusDot && !active && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500"></span>
      )}
      {item.badge && (
        <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-accent-500 rounded-full animate-pulse-slow"></span>
      )}
      {item.comingSoon && <SoonDot />}
    </>
  );

  return (
    <Link
      to={item.href ?? '#'}
      aria-current={active ? 'page' : undefined}
      className={`workspace-sidebar-hover-row workspace-sidebar-nav-item relative flex items-center justify-center px-2 py-2 rounded-lg text-sm transition-all duration-200 group ${active ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white/90 hover:bg-white/7'}`}
    >
      {content}
    </Link>
  );
}

function SidebarBottomLink({ href, icon, label, isActive }: {
  href: string;
  icon: string;
  label: string;
  isActive: (href?: string) => boolean;
}) {
  const active = isActive(href);

  return (
    <Link
      to={href}
      aria-current={active ? 'page' : undefined}
      className={`workspace-sidebar-hover-row workspace-sidebar-bottom-link relative flex items-center justify-center px-2 py-2 rounded-lg text-xs transition-all duration-200 group ${active ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80 hover:bg-white/7'}`}
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0">
        <SidebarIcon id={icon} label={label} sourceIcon={icon} size={15} />
      </span>
      {active && <span className="workspace-sidebar-active-marker absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400"></span>}
    </Link>
  );
}

// ---------- Mobile components (expanded) ----------

function MobileNavGroupInline({ item, isActive, isExpanded, onToggle }: {
  item: SidebarNavItem;
  isActive: (href?: string) => boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const anyChildActive = item.children?.some(child => isActive(child.href)) ?? false;
  return (
    <div>
      <button
        onClick={onToggle}
        className={`workspace-sidebar-hover-row workspace-sidebar-nav-item w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-200 ease-out group relative ${anyChildActive ? 'bg-white/10 text-white shadow-sm' : 'text-white/55 hover:text-white/90 hover:bg-white/7 hover:translate-x-0.5'}`}
      >
        <span className="workspace-sidebar-nav-icon w-5 h-5 flex items-center justify-center shrink-0">
          <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={18} />
        </span>
        <span className="workspace-sidebar-nav-label flex-1 text-left whitespace-nowrap text-sm font-medium">{item.label}</span>
        <span className="flex items-center gap-1 shrink-0">
          {item.comingSoon && <SoonBadge />}
          {item.badge && <NavBadge count={item.badge} />}
          {isExpanded ? <ChevronUp size={14} strokeWidth={1.8} className="text-white/30" aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={1.8} className="text-white/30" aria-hidden="true" />}
        </span>
      </button>
      {isExpanded && item.children && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-2 overflow-hidden">
          {item.children.map((child, idx) => {
            const childActive = isActive(child.href);
            return (
              <Link
                key={child.id}
                to={child.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200 ease-out group ${childActive ? 'bg-white/10 text-white shadow-sm' : 'text-white/45 hover:text-white/80 hover:bg-white/7 hover:translate-x-0.5'}`}
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                <SidebarIcon id={child.id} label={child.label} sourceIcon={child.icon} size={15} />
                <span className="whitespace-nowrap text-sm">{child.label}</span>
                <span className="flex items-center gap-1 ml-auto">
                  {child.comingSoon && <SoonBadge />}
                  {child.statusDot && <StatusDot color={child.statusDot} />}
                  {child.badge && <NavBadge count={child.badge} />}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MobileNavGroup({ item, isActive, isExpanded, onToggle, onSubmenuChange }: {
  item: SidebarNavItem;
  isActive: (href?: string) => boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onSubmenuChange?: (open: boolean) => void;
}) {
  const anyChildActive = item.children?.some(child => isActive(child.href)) ?? false;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [submenuStyle, setSubmenuStyle] = useState<{ top: number; left: number } | null>(null);

  const openHoverMenu = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    setHovered(true);
    onSubmenuChange?.(true);
  };

  const scheduleClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setHovered(false);
      onSubmenuChange?.(false);
    }, 80);
  };

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!hovered || !buttonRef.current) {
      setSubmenuStyle(null);
      return;
    }

    const rect = buttonRef.current.getBoundingClientRect();
    const menuHeight = Math.min((item.children?.length ?? 0) * 42 + 16, 460);
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - menuHeight - 8));
    setSubmenuStyle({ top, left: rect.right });
  }, [hovered, item.children?.length]);

  return (
    <div className="workspace-sidebar-flyout-trigger relative" onMouseEnter={openHoverMenu} onMouseLeave={scheduleClose}>
      <button
        ref={buttonRef}
        onClick={() => {
          if (window.matchMedia('(min-width: 1024px)').matches) return;
          onSubmenuChange?.(false);
          onToggle();
        }}
        aria-expanded={isExpanded || hovered}
        className={'workspace-sidebar-hover-row workspace-sidebar-nav-item w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-200 ease-out group relative ' + (anyChildActive ? 'bg-white/10 text-white shadow-sm' : 'text-white/55 hover:text-white/90 hover:bg-white/7 hover:translate-x-0.5')}
      >
        <span className="workspace-sidebar-nav-icon w-5 h-5 flex items-center justify-center shrink-0">
          <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={18} />
        </span>
        <span className="workspace-sidebar-nav-label flex-1 text-left whitespace-nowrap text-sm font-medium">{item.label}</span>
        <span className="flex items-center gap-1 shrink-0">
          {item.comingSoon && <SoonBadge />}
          {item.badge && <NavBadge count={item.badge} />}
          {isExpanded ? <ChevronUp size={14} strokeWidth={1.8} className="text-white/30" aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={1.8} className="text-white/30" aria-hidden="true" />}
        </span>
      </button>

      {hovered && submenuStyle && item.children && createPortal(
        <div
          className="workspace-sidebar-submenu workspace-sidebar-flyout fixed z-[100] w-[296px] rounded-2xl border p-2 shadow-2xl"
          style={{ top: submenuStyle.top, left: submenuStyle.left }}
          onMouseEnter={openHoverMenu}
          onMouseLeave={scheduleClose}
        >
          {item.children.map(child => (
            <Link
              key={child.id}
              to={child.href}
              onClick={() => {
                setHovered(false);
                onSubmenuChange?.(false);
              }}
              aria-current={isActive(child.href) ? 'page' : undefined}
              className={'workspace-sidebar-flyout-link flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ' + (isActive(child.href) ? 'bg-primary-700 text-white' : 'text-white/75 hover:bg-primary-700/70 hover:text-white')}
            >
              <SidebarIcon id={child.id} label={child.label} sourceIcon={child.icon} size={20} />
              <span className="min-w-0 flex-1 truncate">{child.label}</span>
              {child.comingSoon && <SoonBadge />}
              {child.statusDot && <StatusDot color={child.statusDot} />}
              {child.badge && <NavBadge count={child.badge} />}
            </Link>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}


function MobileNavLink({ item, isActive }: {
  item: SidebarNavItem;
  isActive: (href: string) => boolean;
}) {
  const active = isActive(item.href);
  const content = (
    <>
      {active && <span className="workspace-sidebar-active-marker absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400 shadow-[0_0_6px_rgba(0,0,0,0.3)]"></span>}
      <span data-sidebar-icon={/dashboard|overview/i.test(item.id + ' ' + item.label) ? 'dashboard' : undefined} className="workspace-sidebar-nav-icon w-5 h-5 flex items-center justify-center shrink-0">
        <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={18} />
      </span>
      <span className="workspace-sidebar-nav-label flex-1 whitespace-nowrap text-sm font-medium">{item.label}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        {item.comingSoon && <SoonBadge />}
        {item.statusDot && <StatusDot color={item.statusDot} />}
        {item.badge && <NavBadge count={item.badge} />}
      </span>
    </>
  );

  return (
    <Link
      to={item.href ?? '#'}
      aria-current={active ? 'page' : undefined}
      className={`workspace-sidebar-hover-row workspace-sidebar-nav-item flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-200 ease-out group relative ${active ? 'bg-white/10 text-white shadow-sm' : 'text-white/55 hover:text-white/90 hover:bg-white/7 hover:translate-x-0.5'}`}
    >
      {content}
    </Link>
  );
}

function SoonBadge() {
  return (
    <span className="workspace-sidebar-flyout-badge workspace-sidebar-soon-badge rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
      Soon
    </span>
  );
}

function SoonDot() {
  return (
    <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-300/80"></span>
  );
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="bg-accent-500/90 text-foreground-950 text-[8px] font-bold min-w-[14px] h-3.5 px-0.5 rounded-full flex items-center justify-center leading-none animate-pulse-slow">
      {count}
    </span>
  );
}

function MobileSidebarBottomLink({ href, icon, label, isActive }: {
  href: string;
  icon: string;
  label: string;
  isActive: (href: string) => boolean;
}) {
  const active = isActive(href);
  return (
    <Link
      to={href}
      aria-current={active ? 'page' : undefined}
      className={`workspace-sidebar-hover-row workspace-sidebar-bottom-link flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-all duration-200 ease-out group relative ${active ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80 hover:bg-white/7'}`}
    >
      {active && <span className="workspace-sidebar-active-marker absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400"></span>}
      <span className="w-5 h-5 flex items-center justify-center shrink-0">
        <SidebarIcon id={icon} label={label} sourceIcon={icon} size={15} />
      </span>
      <span className="flex-1 whitespace-nowrap">{label}</span>
    </Link>
  );
}

function StatusDot({ color }: { color: 'red' | 'amber' | 'blue' | 'green' }) {
  const colorMap = { red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-blue-500', green: 'bg-emerald-500' };
  return (
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorMap[color]}`}></span>
  );
}

