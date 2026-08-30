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
// Two widths, one renderer. The rail (RAIL_WIDTH) shows an icon above its
// label, so nothing is ever icon-only guesswork; the expanded panel
// (EXPANDED_WIDTH) shows full rows and is used for hover-preview, the pinned
// state and the mobile drawer alike.
//
// Presentation lives here in Tailwind classes keyed to the theme tokens —
// there is deliberately no accompanying stylesheet. The `kbc-sb-*` class names
// are hooks for the few things Tailwind cannot express (the flyout animation),
// not a second styling system.
// ============================================================================

/** Rail and expanded widths. WorkspaceShell reserves the same numbers, so they
 *  are exported rather than duplicated as magic numbers in two files. */
export const SIDEBAR_RAIL_WIDTH = 92;
export const SIDEBAR_EXPANDED_WIDTH = 268;

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
  statusDot?: 'red' | 'amber' | 'blue' | 'green';
  children?: SidebarNavItem[];
}

interface SidebarProps {
  role: string;
  roleLabel: string;
  navItems: SidebarNavItem[];
  userName?: string;
  userRole?: string;
  /** Pinned open: the panel stays expanded and the shell makes room for it. */
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

/* ═══════════════════════════════════════════════════════
   SHARED ROW STYLES
   One source of truth for how a navigation row reads in
   each of its three states, so the rail, the expanded
   panel and the flyout can never drift apart.
   ═══════════════════════════════════════════════════════ */

const ROW_BASE =
  'relative group flex items-center rounded-xl transition-colors duration-150 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300';
const ROW_IDLE = 'text-foreground-500 hover:bg-primary-50/70 hover:text-foreground-800';
const ROW_ACTIVE = 'bg-primary-50 text-primary-700 font-semibold';

/** The accent bar that marks the current page. */
function ActiveMarker() {
  return (
    <span
      aria-hidden="true"
      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary-600"
    />
  );
}

/* ═══════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════ */

export function Sidebar({
  roleLabel,
  navItems,
  pinned = false,
  onPinChange,
  mobileOpen,
  onCloseMobile,
  onHoverChange,
}: SidebarProps) {
  const location = useLocation();
  const { canSeeNavItem } = useAuth();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
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
    <div className="flex h-screen w-full flex-col border-r border-foreground-100 bg-background-50">
      {/* Header — brand, and the pin control on desktop */}
      <div className={`flex h-14 shrink-0 items-center gap-2 border-b border-foreground-100/70 ${variant === 'rail' ? 'justify-center px-2' : 'px-3'}`}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-600 font-heading text-[12px] font-bold text-white">
          KBC
        </span>
        {variant === 'expanded' && (
          <>
            <span className="min-w-0 flex-1 truncate font-heading text-[13px] font-bold text-foreground-800">
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
      <nav aria-label={`${roleLabel} navigation`} className={`flex-1 overflow-y-auto overflow-x-hidden py-2.5 ${variant === 'rail' ? 'px-1.5' : 'px-2'}`}>
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
      {/* Desktop — a labelled rail that previews the full panel on hover, or
          stays expanded when pinned. Only the hover preview overlays content;
          the pinned width is reserved by WorkspaceShell. */}
      <div
        className="fixed left-0 top-0 z-40 hidden h-screen overflow-hidden shadow-sm transition-[width] duration-300 ease-out lg:block"
        style={{ width: desktopExpanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {desktopExpanded ? panel('expanded', { showPin: true }) : panel('rail')}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground-950/40 backdrop-blur-sm animate-in fade-in duration-200 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile drawer — the same expanded panel */}
      <div
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
      <span className="relative flex h-5 w-5 items-center justify-center">
        <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={compact ? 16 : 18} />
        {item.badge ? <RailDot className="bg-primary-500" /> : null}
        {item.statusDot && !item.badge ? <RailDot className="bg-red-500" /> : null}
        {item.comingSoon && !item.badge && !item.statusDot ? <RailDot className="bg-amber-400" /> : null}
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
        <span className="relative flex h-5 w-5 items-center justify-center">
          <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={18} />
          {item.badge ? <RailDot className="bg-primary-500" /> : null}
          {item.comingSoon && !item.badge ? <RailDot className="bg-amber-400" /> : null}
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

function ExpandedLink({ item, isActive, onNavigate, compact }: {
  item: SidebarNavItem;
  isActive: (href?: string, matchPaths?: string[]) => boolean;
  onNavigate?: () => void;
  compact?: boolean;
}) {
  const active = isActive(item.href, item.matchPaths);
  return (
    <Link
      to={item.href ?? '#'}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`${ROW_BASE} ${active ? ROW_ACTIVE : ROW_IDLE} gap-2.5 px-2.5 ${compact ? 'py-1.5 text-[12px]' : 'py-2 text-[13px]'}`}
    >
      {active && <ActiveMarker />}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={compact ? 16 : 18} />
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {item.comingSoon && <SoonBadge />}
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
function ExpandedGroup({ item, isActive, isExpanded, onToggle, onNavigate }: {
  item: SidebarNavItem;
  isActive: (href?: string, matchPaths?: string[]) => boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const anyChildActive = item.children?.some(child => isActive(child.href, child.matchPaths)) ?? false;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className={`${ROW_BASE} ${anyChildActive && !isExpanded ? ROW_ACTIVE : ROW_IDLE} w-full cursor-pointer gap-2.5 px-2.5 py-2 text-[13px]`}
      >
        {anyChildActive && !isExpanded && <ActiveMarker />}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <SidebarIcon id={item.id} label={item.label} sourceIcon={item.icon} size={18} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {item.comingSoon && <SoonBadge />}
          {item.badge ? <NavBadge count={item.badge} /> : null}
          {isExpanded
            ? <ChevronUp size={14} strokeWidth={1.8} className="text-foreground-300" aria-hidden="true" />
            : <ChevronDown size={14} strokeWidth={1.8} className="text-foreground-300" aria-hidden="true" />}
        </span>
      </button>

      {isExpanded && item.children && (
        <div className="ml-[19px] mt-0.5 space-y-0.5 border-l border-foreground-100 pl-2">
          {item.children.map(child => {
            const childActive = isActive(child.href, child.matchPaths);
            return (
              <Link
                key={child.id}
                to={child.href ?? '#'}
                aria-current={childActive ? 'page' : undefined}
                onClick={onNavigate}
                className={`${ROW_BASE} ${childActive ? ROW_ACTIVE : ROW_IDLE} gap-2 px-2.5 py-1.5 text-[12.5px]`}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <SidebarIcon id={child.id} label={child.label} sourceIcon={child.icon} size={15} />
                </span>
                <span className="min-w-0 flex-1 truncate">{child.label}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {child.comingSoon && <SoonBadge />}
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
      className="kbc-sb-flyout fixed z-[100] w-[252px] rounded-xl border border-foreground-100 bg-background-50 p-1.5 shadow-xl"
      style={{ top: style.top, left: style.left }}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
        <span className="truncate font-heading text-[12px] font-bold text-foreground-800">{item.label}</span>
        {item.comingSoon && <SoonBadge />}
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
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <SidebarIcon id={child.id} label={child.label} sourceIcon={child.icon} size={15} />
              </span>
              <span className="min-w-0 flex-1 truncate">{child.label}</span>
              {child.comingSoon && <SoonBadge />}
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

function SoonBadge() {
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
      Soon
    </span>
  );
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
