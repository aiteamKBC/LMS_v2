import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect, type RefObject } from 'react';
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
  MessageSquare,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
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

// ============================================================================
// Workspace navigation.
//
// Every workspace uses the same desktop icon rail and secondary panel. The
// current role supplies its own permission-filtered destinations. On mobile,
// those destinations appear as full rows in an off-canvas drawer.
//
// Presentation lives here in Tailwind classes keyed to the theme tokens —
// there is deliberately no accompanying stylesheet. The `kbc-sb-*` class names
// are hooks for the few things Tailwind cannot express (the flyout animation),
// not a second styling system.
// ============================================================================

/** Rail and expanded widths. WorkspaceShell reserves the same numbers, so they
 *  are exported rather than duplicated as magic numbers in two files. */
export const SIDEBAR_RAIL_WIDTH = 88;
export const SIDEBAR_EXPANDED_WIDTH = 338;
/** Outer inset plus the gap between navigation and page content. */
export const SIDEBAR_CONTENT_GAP = 24;

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: string;
  /** Leaf destination. Navigation groups intentionally omit it. */
  href?: string;
  /**
   * Existing routes that belong to this destination without changing their
   * public URL. Hub-style navigation uses these aliases to keep one of the five
   * primary destinations highlighted while a person works in a deeper tool.
   */
  matchPaths?: string[];
  badge?: number;
  comingSoon?: boolean;
  /**
   * A short status label shown beside the item, such as "Under review".
   * Distinct from `comingSoon`, which means the destination does not work yet:
   * a tagged item is one a person can open and use, with a caveat. `comingSoon`
   * wins when both are set, because "not built" is the stronger claim.
   */
  tag?: string;
  statusDot?: 'red' | 'amber' | 'blue' | 'green';
  children?: SidebarNavItem[];
}

interface SidebarProps {
  role: string;
  roleLabel: string;
  navItems: SidebarNavItem[];
  userName?: string;
  userRole?: string;
  /** Secondary panel visibility; the shell reserves its expanded width. */
  pinned?: boolean;
  onPinChange?: (pinned: boolean) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onHoverChange?: (hovered: boolean) => void;
}

/**
 * Resolve navigation icons from the meaning of the item instead of the old
 * icon-font class. The navigation data remains unchanged; this is only a
 * presentation adapter for the sidebar's renderers.
 */
function resolveSidebarIcon(id = '', label = '', sourceIcon = ''): LucideIcon {
  const key = `${id} ${label} ${sourceIcon}`.toLowerCase();

  if (/clipboard/.test(sourceIcon.toLowerCase())) return ClipboardList;
  if (/dashboard|overview|\bhome\b/.test(key)) return LayoutDashboard;
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

export function SidebarIcon({ id, label, sourceIcon, size = 18, className }: {
  id?: string;
  label: string;
  sourceIcon?: string;
  size?: number;
  className?: string;
}) {
  const Icon = resolveSidebarIcon(id, label, sourceIcon);
  return <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={1.8} className={className} />;
}

/* ═══════════════════════════════════════════════════════
   SHARED ROW STYLES
   One source of truth for how a navigation row reads in
   each of its three states, so the rail, the expanded
   panel and the flyout can never drift apart.
   ═══════════════════════════════════════════════════════ */

const ROW_BASE =
  'kbc-sidebar-row relative group flex items-center rounded-xl transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300';
const ROW_IDLE = 'text-foreground-500 hover:bg-primary-50/70 hover:text-foreground-800';
const ROW_ACTIVE = 'bg-primary-50 text-primary-700 font-semibold';

/** The accent bar that marks the current page. */
function ActiveMarker() {
  return (
    <span
      aria-hidden="true"
      className="kbc-sidebar-active-marker absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary-600"
    />
  );
}

/* ═══════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════ */

export function Sidebar({
  role,
  roleLabel,
  navItems,
  pinned = false,
  onPinChange,
  mobileOpen,
  onCloseMobile,
  onHoverChange,
}: SidebarProps) {
  const location = useLocation();
  const secondaryNavigationId = `${role}-secondary-navigation`;
  const { canSeeNavItem } = useAuth();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('kbc_sidebar_expanded');
      if (stored) return new Set(JSON.parse(stored));
    } catch { return new Set(); }
    return new Set(navItems.filter(item => item.children?.length).map(item => item.id));
  });

  useEffect(() => {
    try {
      localStorage.setItem('kbc_sidebar_expanded', JSON.stringify([...expandedGroups]));
    } catch { /* Ignore unavailable browser storage. */ }
  }, [expandedGroups]);

  // Close dropdown on route change
  useEffect(() => {
    setActiveDropdown(null);
    setPreviewId(null);
  }, [role, location.pathname, location.search]);

  // Click outside to close dropdown
  useEffect(() => {
    if (!activeDropdown) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const dropdown = document.getElementById(`dropdown-${activeDropdown}`);
      const button = document.getElementById(`nav-btn-${activeDropdown}`);
      // A missing element means its owner already unmounted (e.g. a rail/expanded
      // mode switch), not that the click landed inside it - treat that as outside
      // too, or a stale dropdown id could never be closed by clicking anywhere.
      const clickedInsideDropdown = dropdown?.contains(target) ?? false;
      const clickedInsideButton = button?.contains(target) ?? false;
      if (!clickedInsideDropdown && !clickedInsideButton) {
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

  // Opening a rail group's flyout always promotes the whole sidebar to its
  // expanded layout too. Mouse hover usually does this on its own (the enter
  // bubbles from the icon up to the container), but keyboard focus never
  // touches isHovering, and a slow/interrupted hover can register on the icon
  // without the container's own handler keeping up - leaving the flyout
  // floating by itself over a rail that never expanded. Driving both from one
  // place means that state can't happen: the flyout's anchor unmounts the
  // instant the panel switches, so only the full expanded panel is ever seen.
  const openGroup = useCallback((id: string) => {
    setActiveDropdown(id);
    setIsHovering(true);
    onHoverChange?.(true);
  }, [onHoverChange]);
  const closeGroup = useCallback((id: string) => {
    setActiveDropdown(prev => prev === id ? null : prev);
  }, []);

  const navHrefs = useMemo(
    () => filteredNavItems.flatMap(item => [
      item.href,
      ...(item.children?.map(child => child.href) ?? []),
    ]).filter(Boolean),
    [filteredNavItems],
  );

  const isActive = useCallback((href?: string, matchPaths: string[] = []) => {
    if (!href) return false;
    const [hrefPath] = href.split('?');
    const current = `${location.pathname}${location.search}`;
    if (href.includes('?')) return current === href;
    if (queryMatchedHref && hrefPath === queryMatchedHref.split('?')[0]) return false;
    const candidates = [hrefPath, ...matchPaths];
    const matches = candidates.some(candidate => (
      location.pathname === candidate || location.pathname.startsWith(candidate + '/')
    ));
    if (!matches) return false;

    // Nested sibling routes can share a prefix (for example /learner/clubs
    // and /learner/clubs/events). Only the most specific matching item should
    // receive the active style.
    return matchPaths.length > 0 || !navHrefs.some(candidate =>
      candidate.length > href.length
      && (location.pathname === candidate || location.pathname.startsWith(candidate + '/'))
    );
  }, [location.pathname, location.search, navHrefs, queryMatchedHref]);

  // Keep the section containing the current route open when navigation is
  // supplied dynamically by the active role/configuration.
  useEffect(() => {
    const activeGroupIds = filteredNavItems
      .filter(item => item.children?.some(child => isActive(child.href, child.matchPaths)))
      .map(item => item.id);
    if (activeGroupIds.length === 0) return;
    setExpandedGroups(prev => {
      const next = new Set(prev);
      activeGroupIds.forEach(id => next.add(id));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredNavItems, isActive]);

  const hasChildren = (item: SidebarNavItem) => item.children && item.children.length > 0;

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    onHoverChange?.(true);
  }, [onHoverChange]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setActiveDropdown(null);
    onHoverChange?.(false);
  }, [onHoverChange]);

  const toggleGroup = useCallback((id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Pinned wins over hover, so the panel does not flicker back to a rail when
  // the pointer leaves a sidebar the user deliberately kept open.
  const desktopExpanded = pinned || isHovering;

  // The workspace preview follows hover/focus without changing the current route.
  const previewItem = filteredNavItems.find(item => item.id === previewId)
    ?? filteredNavItems.find(item => isActive(item.href, item.matchPaths)
      || item.children?.some(child => isActive(child.href, child.matchPaths)))
    ?? filteredNavItems[0];

  const openPreview = (id: string) => {
    setPreviewId(id);
    onPinChange?.(true);
  };

  // Rail and expanded render different components for a grouped item (RailGroup's
  // flyout vs ExpandedGroup's inline disclosure), so a mode switch unmounts
  // whichever one was showing. If a flyout's close was still pending when that
  // happened, its 120ms timer is cancelled by the unmounting component's own
  // cleanup before it can clear activeDropdown - leaving it stuck open in state
  // with no live button/dropdown element for the outside-click handler to find.
  // Next time that item's RailGroup remounts, it reads the stale id and pops its
  // flyout open with no hover to justify it. Clearing on every mode switch closes
  // that gap: neither variant should ever inherit a dropdown intent from the other.
  useEffect(() => {
    setActiveDropdown(null);
  }, [desktopExpanded]);

  /** One panel, rendered either as the rail or expanded. */
  const panel = (variant: 'rail' | 'expanded', options?: { showPin?: boolean }) => (
    <div className={`kbc-sidebar-panel kbc-sidebar-${variant} flex h-screen w-full flex-col border-r border-foreground-100 bg-background-50`}>
      {/* Header — brand, and the pin control on desktop */}
      <div className={`kbc-sidebar-header flex h-14 shrink-0 items-center gap-2 border-b border-foreground-100/70 ${variant === 'rail' ? 'justify-center px-2' : 'px-3'}`}>
        <img
          src="https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/16480272afc94729b2911a62d1bbf85d.webp"
          alt="KENT logo"
          className="kbc-sidebar-brand-image block h-8 w-8 shrink-0 rounded-lg object-contain"
        />
        {variant === 'expanded' && (
          <>
            <span className="kbc-sidebar-role min-w-0 flex-1 truncate font-heading text-[13px] font-bold text-foreground-800">
              {roleLabel}
            </span>
            {options?.showPin && onPinChange && (
              <button
                type="button"
                onClick={() => onPinChange(!pinned)}
                aria-pressed={pinned}
                title={pinned ? 'Unpin the sidebar' : 'Keep the sidebar open'}
                className="hidden h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-400 transition-colors hover:bg-primary-50 hover:text-primary-700 lg:flex"
              >
                {pinned
                  ? <PanelLeftClose size={17} strokeWidth={1.8} aria-hidden="true" />
                  : <PanelLeftOpen size={17} strokeWidth={1.8} aria-hidden="true" />}
              </button>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <nav aria-label={`${roleLabel} navigation`} className={`kbc-sidebar-nav flex-1 overflow-y-auto overflow-x-hidden py-2.5 ${variant === 'rail' ? 'px-1.5' : 'px-2'}`}>
        <div className={variant === 'rail' ? 'space-y-1' : 'space-y-0.5'}>
          {filteredNavItems.map(item => (
            <div key={item.id}>
              {variant === 'rail' ? (
                hasChildren(item) ? (
                  <RailGroup
                    item={item}
                    isActive={isActive}
                    isDropdownOpen={activeDropdown === item.id}
                    onOpen={() => openGroup(item.id)}
                    onClose={() => closeGroup(item.id)}
                  />
                ) : (
                  <RailLink item={item} isActive={isActive} />
                )
              ) : (
                hasChildren(item) ? (
                  <ExpandedGroup
                    item={item}
                    isActive={isActive}
                    isExpanded={expandedGroups.has(item.id)}
                    onToggle={() => toggleGroup(item.id)}
                    onNavigate={onCloseMobile}
                  />
                ) : (
                  <ExpandedLink item={item} isActive={isActive} onNavigate={onCloseMobile} />
                )
              )}
            </div>
          ))}
        </div>
      </nav>

    </div>
  );

  return (
    <>
      <aside
          aria-label={`${roleLabel} sidebar`}
          className="fixed bottom-3 left-3 top-3 z-40 hidden overflow-hidden rounded-[24px] shadow-sm transition-[width] duration-300 ease-in-out motion-reduce:transition-none lg:flex"
          data-workspace-role={role}
          style={{ width: pinned ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => {
            handleMouseLeave();
            onPinChange?.(false);
          }}
        >
          <div className="flex h-full w-[88px] shrink-0 flex-col items-center border-r border-white/10 bg-brand-deep pb-24 pt-5">
            <img
              src="https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/16480272afc94729b2911a62d1bbf85d.webp"
              alt="KENT logo"
              className="h-10 w-10 shrink-0 rounded-xl object-contain"
            />
            {onPinChange && (
              <button
                type="button"
                onClick={() => {
                  if (!pinned) setPreviewId(null);
                  onPinChange(!pinned);
                }}
                aria-label={pinned ? 'Collapse navigation' : 'Expand navigation'}
                aria-expanded={pinned}
                aria-controls={secondaryNavigationId}
                title={pinned ? 'Collapse navigation' : 'Expand navigation'}
                className="mt-5 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white/90 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80"
              >
                <Menu className="h-6 w-6" aria-hidden="true" />
              </button>
            )}
            <nav aria-label={`${roleLabel} primary navigation`} className="mt-7 min-h-0 w-full flex-1 space-y-4 overflow-y-auto px-5 [scrollbar-width:none]">
              {filteredNavItems.map(item => (
                <div key={item.id} onMouseEnter={() => setPreviewId(item.id)} onFocus={() => setPreviewId(item.id)}>
                {hasChildren(item) ? (
                  <ExpandedGroup
                    item={item}
                    isActive={isActive}
                    isExpanded={pinned && previewItem?.id === item.id}
                    onToggle={() => openPreview(item.id)}
                    onNavigate={onCloseMobile}
                    presentation="rail"
                  />
                ) : (
                  <ExpandedLink item={item} isActive={isActive} onNavigate={() => { openPreview(item.id); onCloseMobile(); }} presentation="rail" />
                )}
                </div>
              ))}
            </nav>
          </div>
          <div
            id={secondaryNavigationId}
            aria-hidden={!pinned}
            inert={!pinned}
            className={`flex h-full shrink-0 flex-col overflow-hidden bg-[color-mix(in_srgb,var(--kbc-primary)_90%,transparent)] text-white backdrop-blur-md transition-[width,opacity,visibility] duration-300 ease-in-out motion-reduce:transition-none ${pinned ? 'visible w-[250px] opacity-100' : 'invisible w-0 opacity-0'}`}
          >
            <div className="w-[250px] shrink-0 px-6 pb-6 pt-7">
              <p className="font-heading text-xl font-bold tracking-tight">{roleLabel}</p>
              <p className="mt-1 text-[11px] text-white/65">Kent Business College</p>
            </div>
            <nav aria-label={`${roleLabel} secondary navigation`} className="min-h-0 w-[250px] flex-1 space-y-7 overflow-y-auto px-5 pb-8 [scrollbar-width:thin]">
              {previewItem && (
                hasChildren(previewItem) ? (
                  <ExpandedGroup
                    key={previewItem.id}
                    item={previewItem}
                    isActive={isActive}
                    isExpanded
                    onToggle={() => setPreviewId(previewItem.id)}
                    onNavigate={onCloseMobile}
                    presentation="tiles"
                  />
                ) : (
                  <ExpandedLink item={previewItem} isActive={isActive} onNavigate={onCloseMobile} presentation="tile" />
                )
              )}
            </nav>
          </div>
        </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground-950/40 backdrop-blur-sm animate-in fade-in duration-200 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile drawer — the same expanded panel */}
      <div
        aria-label={`${roleLabel} mobile navigation`}
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
        className={`fixed left-0 top-0 z-50 h-screen w-[268px] shadow-xl transition-transform duration-300 ease-out lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {panel('expanded')}
        <button
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="absolute right-2.5 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-foreground-400 transition-colors hover:bg-primary-50 hover:text-primary-700"
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════
   RAIL — icon above a label, so nothing is icon-only
   ═══════════════════════════════════════════════════════ */

/** Rail label: two lines at most, centred under the icon. */
function RailLabel({ children, compact }: { children: string; compact?: boolean }) {
  return (
    <span className={`w-full px-0.5 text-center leading-[1.15] ${compact ? 'text-[9.5px]' : 'text-[10px]'} line-clamp-2`}>
      {children}
    </span>
  );
}

function RailLink({ item, isActive, compact }: {
  item: SidebarNavItem;
  isActive: (href?: string, matchPaths?: string[]) => boolean;
  compact?: boolean;
}) {
  const active = isActive(item.href, item.matchPaths);
  return (
    <Link
      to={item.href ?? '#'}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      className={`${ROW_BASE} ${active ? ROW_ACTIVE : ROW_IDLE} w-full flex-col justify-center gap-1 ${compact ? 'py-1.5' : 'py-2'} px-1`}
    >
      {active && <ActiveMarker />}
      <span className="kbc-sidebar-icon-well relative flex h-5 w-5 items-center justify-center">
        <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={compact ? 16 : 18} />
        {item.badge ? <RailDot className="bg-primary-500" /> : null}
        {item.statusDot && !item.badge ? <RailDot className="bg-red-500" /> : null}
        {(item.comingSoon || item.tag) && !item.badge && !item.statusDot ? <RailDot className="bg-amber-400" /> : null}
      </span>
      <RailLabel compact={compact}>{item.label}</RailLabel>
    </Link>
  );
}

function RailDot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full ${className}`} />;
}

/**
 * A rail group: its children are unreachable at this width, so hovering opens
 * the same flyout the expanded panel uses.
 */
function RailGroup({ item, isActive, isDropdownOpen, onOpen, onClose }: {
  item: SidebarNavItem;
  isActive: (href?: string, matchPaths?: string[]) => boolean;
  isDropdownOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const anyChildActive = item.children?.some(child => isActive(child.href, child.matchPaths)) ?? false;
  const { hoverProps, flyout } = useFlyout({ item, isActive, isOpen: isDropdownOpen, onOpen, onClose, anchorRef: buttonRef });

  return (
    <div className="relative w-full" {...hoverProps}>
      <button
        ref={buttonRef}
        id={`nav-btn-${item.id}`}
        type="button"
        onClick={event => event.preventDefault()}
        aria-expanded={isDropdownOpen}
        title={item.label}
        className={`${ROW_BASE} ${anyChildActive ? ROW_ACTIVE : ROW_IDLE} w-full flex-col justify-center gap-1 px-1 py-2`}
      >
        {anyChildActive && <ActiveMarker />}
        <span className="kbc-sidebar-icon-well relative flex h-5 w-5 items-center justify-center">
          <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={18} />
          {item.badge ? <RailDot className="bg-primary-500" /> : null}
          {(item.comingSoon || item.tag) && !item.badge ? <RailDot className="bg-amber-400" /> : null}
        </span>
        <RailLabel>{item.label}</RailLabel>
      </button>
      {flyout}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   EXPANDED — full rows, used for hover-preview, pinned
   and the mobile drawer
   ═══════════════════════════════════════════════════════ */

function ExpandedLink({ item, isActive, onNavigate, compact, presentation }: {
  item: SidebarNavItem;
  isActive: (href?: string, matchPaths?: string[]) => boolean;
  onNavigate?: () => void;
  compact?: boolean;
  presentation?: 'rail' | 'tile';
}) {
  const active = isActive(item.href, item.matchPaths);
  return (
    <Link
      to={item.href ?? '#'}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      title={presentation === 'rail' ? item.label : undefined}
      className={presentation === 'rail' ? `relative flex h-12 w-12 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${active ? 'bg-brand-accent text-white shadow-sm' : 'bg-white/10 text-white/75 hover:bg-white/20 hover:text-white'}` : presentation === 'tile' ? 'group flex w-full flex-col items-center gap-3 rounded-xl px-3 py-4 text-center text-sm font-semibold text-white/90 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80' : `${ROW_BASE} ${active ? ROW_ACTIVE : ROW_IDLE} gap-2.5 px-2.5 ${compact ? 'py-1.5 text-[12px]' : 'py-2 text-[13px]'}`}
    >
      {active && <span className={presentation ? 'hidden' : 'contents'}><ActiveMarker /></span>}
      <span className={presentation === 'rail' ? 'flex h-5 w-5 items-center justify-center' : presentation === 'tile' ? `flex h-12 w-12 items-center justify-center rounded-xl ${active ? 'bg-white text-brand' : 'bg-white/15 text-white group-hover:bg-white/25'}` : 'kbc-sidebar-icon-well flex h-5 w-5 shrink-0 items-center justify-center'}>
        <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={compact ? 16 : 18} className={presentation ? 'h-5 w-5' : undefined} />
      </span>
      <span className={presentation === 'rail' ? 'sr-only' : presentation === 'tile' ? 'w-full break-words' : 'min-w-0 flex-1 truncate'}>{item.label}</span>
      <span className={presentation === 'rail' ? 'absolute -right-1 -top-1 flex items-center gap-1' : 'flex shrink-0 items-center gap-1.5'}>
        {item.comingSoon ? <SoonBadge /> : item.tag ? <NavTag label={item.tag} /> : null}
        {item.statusDot && <StatusDot color={item.statusDot} />}
        {item.badge ? <NavBadge count={item.badge} /> : null}
      </span>
    </Link>
  );
}

/**
 * An expanded group. Clicking discloses its children inline (remembered across
 * sessions); hovering opens the same flyout the rail uses, so a pointer user
 * can reach a child without disturbing their saved disclosure state.
 */
function ExpandedGroup({ item, isActive, isExpanded, onToggle, onNavigate, presentation }: {
  item: SidebarNavItem;
  isActive: (href?: string, matchPaths?: string[]) => boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  presentation?: 'rail' | 'tiles';
}) {
  const anyChildActive = item.children?.some(child => isActive(child.href, child.matchPaths)) ?? false;

  return (
    <div>
      {presentation === 'tiles' ? (
        <p className="mb-5 flex w-full items-center justify-center rounded-xl border border-white/30 bg-white/15 px-3 py-2 text-center text-[13px] font-bold leading-snug text-white shadow-sm">{item.label}</p>
      ) : (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-current={presentation === 'rail' && anyChildActive ? 'true' : undefined}
        title={presentation === 'rail' ? item.label : undefined}
        className={presentation === 'rail'
          ? `relative flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${anyChildActive ? 'bg-brand-accent text-white shadow-sm' : 'bg-white/10 text-white/75 hover:bg-white/20 hover:text-white'}`
          : `${ROW_BASE} ${anyChildActive && !isExpanded ? ROW_ACTIVE : ROW_IDLE} w-full cursor-pointer gap-2.5 px-2.5 py-2 text-[13px]`}
      >
        {anyChildActive && !isExpanded && <span className={presentation ? 'hidden' : 'contents'}><ActiveMarker /></span>}
        <span className={presentation === 'rail' ? 'flex h-5 w-5 items-center justify-center' : 'kbc-sidebar-icon-well flex h-5 w-5 shrink-0 items-center justify-center'}>
          <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={18} className={presentation === 'rail' ? 'h-5 w-5' : undefined} />
        </span>
        <span className={presentation === 'rail' ? 'sr-only' : 'min-w-0 flex-1 truncate text-left'}>{item.label}</span>
        <span className={presentation === 'rail' ? 'sr-only' : 'flex shrink-0 items-center gap-1.5'}>
          {item.comingSoon ? <SoonBadge /> : item.tag ? <NavTag label={item.tag} /> : null}
          {item.badge ? <NavBadge count={item.badge} /> : null}
          {isExpanded
            ? <ChevronUp size={14} strokeWidth={1.8} className="text-foreground-300" aria-hidden="true" />
            : <ChevronDown size={14} strokeWidth={1.8} className="text-foreground-300" aria-hidden="true" />}
        </span>
      </button>
      )}

      {presentation !== 'rail' && isExpanded && item.children && (
        <div className={presentation === 'tiles' ? 'grid grid-cols-2 gap-x-3 gap-y-5' : 'ml-[19px] mt-0.5 space-y-0.5 border-l border-foreground-100 pl-2'}>
          {item.children.map(child => {
            const childActive = isActive(child.href, child.matchPaths);
            return (
              <Link
                key={child.id}
                to={child.href ?? '#'}
                aria-current={childActive ? 'page' : undefined}
                onClick={onNavigate}
                className={presentation === 'tiles' ? `group flex min-w-0 flex-col items-center gap-2.5 rounded-xl px-1 py-1 text-center text-xs leading-snug transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${childActive ? 'font-semibold text-white' : 'text-white/75 hover:text-white'}` : `${ROW_BASE} ${childActive ? ROW_ACTIVE : ROW_IDLE} gap-2 px-2.5 py-1.5 text-[12.5px]`}
              >
                <span className={presentation === 'tiles' ? `flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors ${childActive ? 'bg-white text-brand shadow-sm' : 'bg-white/15 text-white/90 group-hover:bg-white/25'}` : 'kbc-sidebar-icon-well kbc-sidebar-child-icon-well flex h-4 w-4 shrink-0 items-center justify-center'}>
                  <SidebarIcon id={child.id} label={child.label} sourceIcon={child.icon} size={15} className={presentation === 'tiles' ? 'h-5 w-5' : undefined} />
                </span>
                <span className={presentation === 'tiles' ? 'w-full break-words' : 'min-w-0 flex-1 truncate'}>{child.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {child.comingSoon ? <SoonBadge /> : child.tag ? <NavTag label={child.tag} /> : null}
                  {child.statusDot && <StatusDot color={child.statusDot} />}
                  {child.badge ? <NavBadge count={child.badge} /> : null}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   FLYOUT — one implementation, shared by both variants
   ═══════════════════════════════════════════════════════ */

/**
 * The hover flyout listing a group's children.
 *
 * Portalled to the body so it is never clipped by the sidebar's own overflow,
 * and flipped upward when it would run past the bottom of the window. Long
 * groups (more than five children) get a filter box.
 */
function useFlyout({ item, isActive, isOpen, onOpen, onClose, anchorRef }: {
  item: SidebarNavItem;
  isActive: (href?: string, matchPaths?: string[]) => boolean;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const closeTimer = useRef<number | null>(null);
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const childCount = item.children?.length ?? 0;
  const needsSearch = childCount > 5;

  const open = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    if (!isOpen) setSearchQuery('');
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
    if (!isOpen || !anchorRef.current) {
      setStyle(null);
      return;
    }
    const rect = anchorRef.current.getBoundingClientRect();
    const height = Math.min(childCount * 38 + (needsSearch ? 96 : 56), 420);
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - height - 8));
    setStyle({ top, left: rect.right + 6 });
  }, [anchorRef, childCount, isOpen, needsSearch]);

  const flyout = isOpen && style ? createPortal(
    <div
      id={`dropdown-${item.id}`}
      className="kbc-sb-flyout kbc-sidebar-flyout fixed z-[100] w-[252px] rounded-xl border border-foreground-100 bg-background-50 p-1.5 shadow-xl"
      style={{ top: style.top, left: style.left }}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
        <span className="truncate font-heading text-[12px] font-bold text-foreground-800">{item.label}</span>
        {item.comingSoon ? <SoonBadge /> : item.tag ? <NavTag label={item.tag} /> : null}
      </div>

      {needsSearch && (
        <div className="relative px-1 pb-1.5">
          <Search size={13} strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300" aria-hidden="true" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filter…"
            aria-label={`Filter ${item.label}`}
            autoFocus
            className="w-full rounded-lg border border-foreground-100 bg-background-100/60 py-1.5 pl-7 pr-2 text-[12px] text-foreground-700 placeholder:text-foreground-300 focus:border-primary-300 focus:bg-background-50 focus:outline-none"
          />
        </div>
      )}

      <div className="max-h-[calc(100vh-96px)] space-y-0.5 overflow-y-auto">
        {filteredChildren.map(child => {
          const childActive = isActive(child.href, child.matchPaths);
          return (
            <Link
              key={child.id}
              to={child.href ?? '#'}
              aria-current={childActive ? 'page' : undefined}
              onClick={onClose}
              className={`${ROW_BASE} ${childActive ? ROW_ACTIVE : ROW_IDLE} gap-2.5 px-2.5 py-2 text-[12.5px]`}
            >
              <span className="kbc-sidebar-icon-well kbc-sidebar-child-icon-well flex h-4 w-4 shrink-0 items-center justify-center">
                <SidebarIcon id={child.id} label={child.label} sourceIcon={child.icon} size={15} />
              </span>
              <span className="min-w-0 flex-1 truncate">{child.label}</span>
              {child.comingSoon ? <SoonBadge /> : child.tag ? <NavTag label={child.tag} /> : null}
              {child.statusDot && <StatusDot color={child.statusDot} />}
              {child.badge ? <NavBadge count={child.badge} /> : null}
              <ChevronRight size={13} strokeWidth={1.8} className="shrink-0 text-foreground-200" aria-hidden="true" />
            </Link>
          );
        })}
        {filteredChildren.length === 0 && (
          <p className="px-3 py-4 text-center text-[11px] text-foreground-300">No items found</p>
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return {
    hoverProps: { onMouseEnter: open, onMouseLeave: scheduleClose, onFocus: open, onBlur: scheduleClose },
    flyout,
  };
}

/* ═══════════════════════════════════════════════════════
   BADGES
   ═══════════════════════════════════════════════════════ */

function NavTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
      {label}
    </span>
  );
}

function SoonBadge() {
  return <NavTag label="Soon" />;
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="flex h-4 min-w-[16px] shrink-0 items-center justify-center rounded-full bg-primary-600 px-1 text-[9px] font-bold leading-none text-white">
      {count}
    </span>
  );
}

function StatusDot({ color }: { color: 'red' | 'amber' | 'blue' | 'green' }) {
  const colorMap = { red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-blue-500', green: 'bg-emerald-500' };
  return <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${colorMap[color]}`} />;
}
