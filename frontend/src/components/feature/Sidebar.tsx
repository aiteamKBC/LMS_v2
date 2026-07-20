import { useState, useCallback, useMemo, useEffect, useRef, useLayoutEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useAuth } from '@/hooks/useAuth';

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: string;
  href: string;
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

export function Sidebar({ roleLabel, navItems, mobileOpen, onCloseMobile }: SidebarProps) {
  const location = useLocation();
  const { canSeeNavItem } = useAuth();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('kbc_sidebar_expanded');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    localStorage.setItem('kbc_sidebar_expanded', JSON.stringify([...expandedGroups]));
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
      }));
  }, [navItems, canSeeNavItem]);

  const toggleGroup = useCallback((id: string) => {
    setActiveDropdown(prev => prev === id ? null : id);
  }, []);

  const isActive = (href: string) => {
    if (!href) return false;
    return location.pathname === href || location.pathname.startsWith(href + '/');
  };

  const hasChildren = (item: SidebarNavItem) => item.children && item.children.length > 0;

  // Desktop sidebar (collapsed)
  const desktopSidebar = (
    <aside
      className="w-full flex flex-col h-screen text-white relative overflow-visible"
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
      <div className="relative z-10 flex items-center justify-center h-14 px-3 shrink-0">
        <div className="w-6 h-6 rounded-md bg-accent-400 flex items-center justify-center transition-transform duration-300 hover:scale-110">
          <span className="text-foreground-950 font-bold text-xs font-heading">K</span>
        </div>
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
                  onToggle={() => toggleGroup(item.id)}
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
      className="w-full flex flex-col h-screen text-white relative overflow-hidden"
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

      {/* Logo */}
      <div className="relative z-10 flex items-center h-14 px-3 shrink-0">
        <div className="flex items-center gap-3 overflow-hidden flex-1">
          <div className="w-7 h-7 rounded-md bg-accent-400 flex items-center justify-center shrink-0">
            <span className="text-foreground-950 font-bold text-xs font-heading">K</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold font-heading tracking-tight whitespace-nowrap">KBC LearningOS</p>
          </div>
        </div>
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
                  isExpanded={expandedGroups.has(item.id)}
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
      {/* Desktop sidebar — expands on hover */}
      <div
        className={`hidden lg:block fixed left-0 top-0 z-40 h-screen overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${hoverExpanded ? 'w-[264px] shadow-2xl' : 'w-[56px]'}`}
        onMouseEnter={() => setHoverExpanded(true)}
        onMouseLeave={() => {
          setHoverExpanded(false);
          setActiveDropdown(null);
        }}
      >
        {hoverExpanded ? mobileSidebar : desktopSidebar}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={onCloseMobile}
        />
      )}

      {/* Mobile sidebar */}
      <div className={`lg:hidden fixed left-0 top-0 z-50 h-screen w-[264px] transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {mobileSidebar}
        <button
          onClick={onCloseMobile}
          className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-smooth cursor-pointer lg:hidden"
        >
          <i className="ri-close-line text-lg"></i>
        </button>
      </div>
    </>
  );
}

// ---------- Desktop components (collapsed) ----------

function NavGroup({ item, isActive, isDropdownOpen, onToggle }: {
  item: SidebarNavItem;
  isActive: (href: string) => boolean;
  isDropdownOpen: boolean;
  onToggle: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number } | null>(null);
  const [hovered, setHovered] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<{ top: number; left: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const anyChildActive = item.children?.some(child => isActive(child.href)) ?? false;
  const needsSearch = (item.children?.length ?? 0) > 5;

  const filteredChildren = useMemo(() => {
    if (!searchQuery.trim()) return item.children ?? [];
    return (item.children ?? []).filter(child =>
      child.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [item.children, searchQuery]);

  useLayoutEffect(() => {
    if (isDropdownOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownHeight = Math.min((item.children?.length ?? 0) * 40 + 60, 400);
      let top = rect.top;
      if (rect.top + dropdownHeight > window.innerHeight - 16) {
        top = Math.max(8, window.innerHeight - dropdownHeight - 8);
      }
      setDropdownStyle({ top, left: rect.right + 8 });
    } else {
      setDropdownStyle(null);
    }
  }, [isDropdownOpen]);

  useLayoutEffect(() => {
    if (hovered && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setTooltipStyle({ top: rect.top + rect.height / 2, left: rect.right + 8 });
    } else {
      setTooltipStyle(null);
    }
  }, [hovered]);

  const handleToggle = () => {
    if (!isDropdownOpen) {
      setSearchQuery('');
    }
    onToggle();
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        id={`nav-btn-${item.id}`}
        onClick={handleToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`w-full flex items-center justify-center px-2 py-2 rounded-lg text-sm transition-all duration-200 group relative ${anyChildActive ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white/90 hover:bg-white/7'}`}
      >
        <span className="w-5 h-5 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110">
          <i className={`${item.icon} text-sm`}></i>
        </span>
        {item.badge && (
          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-accent-500 rounded-full animate-pulse-slow"></span>
        )}
        {item.comingSoon && <SoonDot />}
        {anyChildActive && !isDropdownOpen && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400"></span>
        )}
      </button>
      {hovered && tooltipStyle && !isDropdownOpen && createPortal(
        <div className="fixed z-[100] tooltip-fade-in px-2 py-1 tooltip-bg text-white text-xs rounded-md shadow-lg whitespace-nowrap pointer-events-none"
          style={{ top: tooltipStyle.top, left: tooltipStyle.left }}
        >
          {item.label}{item.comingSoon ? ' - Soon' : ''}
        </div>,
        document.body
      )}
      {isDropdownOpen && dropdownStyle && createPortal(
        <div
          id={`dropdown-${item.id}`}
          className="fixed z-[100] w-[220px] rounded-lg overflow-hidden shadow-2xl border border-white/10 dropdown-panel-in"
          style={{ 
            top: dropdownStyle.top, 
            left: dropdownStyle.left,
            background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)',
          }}
        >
          <div className="p-1 max-h-[calc(100vh-24px)] overflow-y-auto">
            <div className="px-3 py-2 text-sm font-semibold text-white/90 border-b border-white/10 flex items-center justify-between">
              <span>{item.label}</span>
              {item.comingSoon ? <SoonBadge /> : <i className="ri-arrow-right-s-line text-xs text-white/40"></i>}
            </div>
            {needsSearch && (
              <div className="relative px-2 py-2">
                <i className="ri-search-line absolute left-4 top-1/2 -translate-y-1/2 text-xs text-white/30"></i>
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
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all ${childActive ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                    onClick={onToggle}
                  >
                    <i className={`${child.icon} text-sm`}></i>
                    <span className="flex-1">{child.label}</span>
                    {child.comingSoon ? <SoonBadge /> : <i className="ri-arrow-right-s-line text-xs text-white/40"></i>}
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
  isActive: (href: string) => boolean;
}) {
  const active = isActive(item.href);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (hovered && spanRef.current) {
      const rect = spanRef.current.getBoundingClientRect();
      setTooltipStyle({ top: rect.top + rect.height / 2, left: rect.right + 8 });
    } else {
      setTooltipStyle(null);
    }
  }, [hovered]);

  const content = (
    <>
      <span ref={spanRef} className="w-5 h-5 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110">
        <i className={`${item.icon} text-sm`}></i>
      </span>
      {hovered && tooltipStyle && createPortal(
        <div className="fixed z-[100] tooltip-fade-in px-2 py-1 tooltip-bg text-white text-xs rounded-md shadow-lg whitespace-nowrap pointer-events-none"
          style={{ top: tooltipStyle.top, left: tooltipStyle.left }}
        >
          {item.label}{item.comingSoon ? ' - Soon' : ''}
        </div>,
        document.body
      )}
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400"></span>}
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
      to={item.href}
      className={`relative flex items-center justify-center px-2 py-2 rounded-lg text-sm transition-all duration-200 group ${active ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white/90 hover:bg-white/7'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {content}
    </Link>
  );
}

function SidebarBottomLink({ href, icon, label, isActive }: {
  href: string;
  icon: string;
  label: string;
  isActive: (href: string) => boolean;
}) {
  const active = isActive(href);
  const spanRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (hovered && spanRef.current) {
      const rect = spanRef.current.getBoundingClientRect();
      setTooltipStyle({ top: rect.top + rect.height / 2, left: rect.right + 8 });
    } else {
      setTooltipStyle(null);
    }
  }, [hovered]);

  return (
    <Link
      to={href}
      className={`relative flex items-center justify-center px-2 py-2 rounded-lg text-xs transition-all duration-200 group ${active ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80 hover:bg-white/7'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span ref={spanRef} className="w-5 h-5 flex items-center justify-center shrink-0">
        <i className={`${icon} text-xs`}></i>
      </span>
      {hovered && tooltipStyle && createPortal(
        <div className="fixed z-[100] tooltip-fade-in px-2 py-1 tooltip-bg text-white text-xs rounded-md shadow-lg whitespace-nowrap pointer-events-none"
          style={{ top: tooltipStyle.top, left: tooltipStyle.left }}
        >
          {label}
        </div>,
        document.body
      )}
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400"></span>}
    </Link>
  );
}

// ---------- Mobile components (expanded) ----------

function MobileNavGroup({ item, isActive, isExpanded, onToggle }: {
  item: SidebarNavItem;
  isActive: (href: string) => boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const anyChildActive = item.children?.some(child => isActive(child.href)) ?? false;
  return (
    <div>
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-200 ease-out group relative ${anyChildActive ? 'bg-white/10 text-white shadow-sm' : 'text-white/55 hover:text-white/90 hover:bg-white/7 hover:translate-x-0.5'}`}
      >
        <span className="w-5 h-5 flex items-center justify-center shrink-0">
          <i className={`${item.icon} text-base`}></i>
        </span>
        <span className="flex-1 text-left whitespace-nowrap text-sm font-medium">{item.label}</span>
        <span className="flex items-center gap-1 shrink-0">
          {item.comingSoon && <SoonBadge />}
          {item.badge && <NavBadge count={item.badge} />}
          <i className={`${isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-xs text-white/30`}></i>
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
                <i className={`${child.icon} text-xs`}></i>
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

function MobileNavLink({ item, isActive }: {
  item: SidebarNavItem;
  isActive: (href: string) => boolean;
}) {
  const active = isActive(item.href);
  const content = (
    <>
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400 shadow-[0_0_6px_rgba(0,0,0,0.3)]"></span>}
      <span className="w-5 h-5 flex items-center justify-center shrink-0">
        <i className={`${item.icon} text-base`}></i>
      </span>
      <span className="flex-1 whitespace-nowrap text-sm font-medium">{item.label}</span>
      <span className="flex items-center gap-1.5 shrink-0">
        {item.comingSoon && <SoonBadge />}
        {item.statusDot && <StatusDot color={item.statusDot} />}
        {item.badge && <NavBadge count={item.badge} />}
      </span>
    </>
  );

  return (
    <Link
      to={item.href}
      className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all duration-200 ease-out group relative ${active ? 'bg-white/10 text-white shadow-sm' : 'text-white/55 hover:text-white/90 hover:bg-white/7 hover:translate-x-0.5'}`}
    >
      {content}
    </Link>
  );
}

function SoonBadge() {
  return (
    <span className="rounded-full border border-white/10 bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/55">
      Soon
    </span>
  );
}

function SoonDot() {
  return (
    <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-amber-300/80"></span>
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
      className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-all duration-200 ease-out group relative ${active ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80 hover:bg-white/7'}`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent-400"></span>}
      <span className="w-5 h-5 flex items-center justify-center shrink-0">
        <i className={`${icon} text-xs`}></i>
      </span>
      <span className="flex-1 whitespace-nowrap">{label}</span>
    </Link>
  );
}

function NavBadge({ count }: { count: number }) {
  return (
    <span className="bg-accent-500/90 text-foreground-950 text-[8px] font-bold min-w-[14px] h-3.5 px-0.5 rounded-full flex items-center justify-center leading-none animate-pulse-slow">
      {count}
    </span>
  );
}

function StatusDot({ color }: { color: 'red' | 'amber' | 'blue' | 'green' }) {
  const colorMap = { red: 'bg-red-500', amber: 'bg-amber-500', blue: 'bg-blue-500', green: 'bg-emerald-500' };
  return (
    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colorMap[color]}`}></span>
  );
}
