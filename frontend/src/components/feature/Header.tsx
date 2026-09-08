import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Moon, Sun } from 'lucide-react';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { BrandLockup } from '@/components/BrandLockup';
import { WorkspaceSwitcher } from '@/components/feature/WorkspaceSwitcher';

interface HeaderProps {
  pageTitle: string;
  pageSubtitle?: string;
  onOpenSearch: () => void;
  userName?: string;
  onToggleMobileSidebar?: () => void;
  mobileSidebarOpen?: boolean;
  onToggleDesktopSidebar?: () => void;
  sidebarPinned?: boolean;
  role?: string;
}

/** "Demo Admin" -> "DA". A single word falls back to its first two letters. */
function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const MONOCHROME_STORAGE_KEY = 'accessibility-monochrome';

function readMonochromePreference() {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(MONOCHROME_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/** The same avatar in the trigger, the menu and the dialog, so the three read
    as one object being carried between them. */
function AccountAvatar({ initials, className = '', textClassName = 'text-[11px]' }: { initials: string; className?: string; textClassName?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-400 via-primary-500 to-primary-700 font-bold uppercase tracking-tight text-white ring-1 ring-inset ring-white/25 ${className}`}
      aria-hidden="true"
    >
      <span className={textClassName}>{initials}</span>
    </span>
  );
}

function AccessibilityBadge({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="10.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="6.8" r="1.5" fill="currentColor" />
      <path d="M5.6 9.4 12 10.2l6.4-.8" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 10.3v4.8m0 0-3.2 5m3.2-5 3.2 5" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SignOutConfirmModal({
  displayName,
  email,
  onClose,
  onConfirm,
}: {
  displayName: string;
  email: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const initials = initialsOf(displayName);

  // Escape closes, the confirm button takes focus on open and hands it back to
  // whatever opened the dialog on close, and the page behind cannot scroll.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    confirmRef.current?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="signout-title">
      <div className="dialog-backdrop-in absolute inset-0 bg-foreground-950/45 backdrop-blur-[3px]" onClick={onClose}></div>

      <div className="dialog-card-in relative w-full max-w-[26rem] overflow-hidden rounded-2xl bg-background-50 ring-1 ring-foreground-100 shadow-[0_28px_70px_-28px_oklch(var(--foreground-950)/0.45)]">
        {/* A hairline of danger colour along the top edge carries the tone of the
            action without turning the whole card into an error state. */}
        <div className="h-1 w-full bg-gradient-to-r from-red-400 via-red-500 to-red-400"></div>

        <div className="px-6 pt-5">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 ring-1 ring-red-100">
              <AppIcon className="ri-logout-box-line text-xl text-red-500"></AppIcon>
            </span>
            <div className="min-w-0 pt-0.5">
              <h2 id="signout-title" className="font-heading text-lg font-bold leading-tight text-foreground-900">Sign out?</h2>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-foreground-400">
                You will need to sign in again to get back to your workspace, and anything unsaved will be lost.
              </p>
            </div>
          </div>

          {/* Which account is about to be signed out — the one thing the old
              dialog left the user to remember. */}
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-background-100 px-3 py-2.5 ring-1 ring-background-200/80">
            <AccountAvatar initials={initials} className="h-8 w-8" />
            <div className="min-w-0">
              <p className="truncate text-[0.8125rem] font-semibold leading-tight text-foreground-800">{displayName}</p>
              <p className="truncate text-[0.75rem] leading-tight text-foreground-400">{email}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 border-t border-background-200/70 bg-background-100/40 px-6 py-4 sm:flex-row sm:justify-end">
          <button
            onClick={onClose}
            className="cursor-pointer whitespace-nowrap rounded-xl bg-background-50 px-4 py-2.5 text-[0.8125rem] font-semibold text-foreground-600 ring-1 ring-background-300 transition-smooth hover:bg-background-100 hover:text-foreground-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            Stay signed in
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-red-500 px-4 py-2.5 text-[0.8125rem] font-semibold text-white shadow-lg shadow-red-500/25 transition-smooth hover:bg-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
          >
            <AppIcon className="ri-logout-box-line text-base"></AppIcon> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// Notification sound
export function Header({ pageTitle, pageSubtitle, onOpenSearch, userName = 'Sarah Mitchell', onToggleMobileSidebar, mobileSidebarOpen = false, onToggleDesktopSidebar, sidebarPinned = false, role }: HeaderProps) {
  const { auth, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  // Profile is the only dropdown left in the header, so the state that used to
  // coordinate six of them is gone along with them — as are the hard-coded
  // notification, task and message lists that fed their badge counts.
  const [profileOpen, setProfileOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [monochrome, setMonochrome] = useState(readMonochromePreference);

  const profileRef = useRef<HTMLDivElement>(null);

  // Black-and-white mode is deliberately scoped to Light Mode. The preference
  // is kept while Dark Mode is active so returning to Light Mode restores the
  // user's choice without altering the dark palette.
  useLayoutEffect(() => {
    const shouldApplyMonochrome = theme === 'light' && monochrome;
    if (shouldApplyMonochrome) {
      document.documentElement.dataset.accessibility = 'monochrome';
    } else {
      delete document.documentElement.dataset.accessibility;
    }

    try {
      window.localStorage.setItem(MONOCHROME_STORAGE_KEY, String(monochrome));
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, [monochrome, theme]);

  // Kept as a no-arg close so the Profile button's handler reads the same as
  // before; there is no longer anything else to close.
  const closeOthers = useCallback((_except: string) => {}, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Escape closes the menu — it opens from a button, so the keyboard has to be
  // able to get back out of it.
  useEffect(() => {
    if (!profileOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setProfileOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [profileOpen]);

  const displayName = auth.user?.fullName || userName;
  const email = auth.user?.email || '';
  // Same source the sidebar labels the account with; `account` is the server
  // record, so a real staff Position wins over the coarse RBAC role name.
  const roleLabel = auth.account?.position || auth.roles[0]?.name || '';
  const initials = initialsOf(displayName);

  return (
    <>
    {/* Height and border deliberately match the sidebar's brand row, so the two
        read as one continuous bar across the top of the workspace. */}
    <header className={`kbc-workspace-topbar workspace-topbar flex shrink-0 items-center gap-2 border-b border-foreground-100 bg-background-50 px-2 sm:px-3 md:gap-3 md:px-4 ${role === 'admin' ? 'h-[60px]' : role === 'curriculum' ? 'h-[70px]' : 'h-14'}`}>
      {/* Labelled navigation controls, with the action matching the screen size. */}
      {onToggleMobileSidebar && (
        <div className="shrink-0 lg:hidden">
        <button
          type="button"
          onClick={onToggleMobileSidebar}
          className="kbc-navigation-menu"
          title={mobileSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-label={mobileSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={mobileSidebarOpen}
        >
          <Menu size={18} aria-hidden="true" /><span>Menu</span>
        </button>
        </div>
      )}
      {onToggleDesktopSidebar && (
        <div className="hidden shrink-0 lg:block">
          <button type="button" className="kbc-navigation-menu" onClick={onToggleDesktopSidebar}
            title={sidebarPinned ? 'Collapse navigation menu' : 'Expand navigation menu'}
            aria-label={sidebarPinned ? 'Collapse navigation menu' : 'Expand navigation menu'} aria-expanded={sidebarPinned}>
            {sidebarPinned ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}<span>Menu</span>
          </button>
        </div>
      )}

      {/* Provider logo — below lg only. From lg up the sidebar carries the
          brand, and showing it twice was the duplication that read as clutter. */}
      <Link to="/" className="flex shrink-0 lg:hidden" aria-label="Kent Business College home">
        <BrandLockup size="compact" />
      </Link>

      {/* Where the page says what it is. These props were being passed by every
          page and thrown away, which is what left the bar looking empty. */}
      <div className={`hidden min-w-0 lg:block ${role === 'admin' ? 'w-[22rem] shrink-0' : 'flex-1'}`}>
        <div className="flex min-w-0 items-center gap-3">
          <p className="kbc-topbar-title truncate font-heading text-[14px] font-bold leading-tight text-foreground-900">{pageTitle}</p>
        </div>
        {role !== 'admin' && pageSubtitle && (
          <p className="kbc-topbar-subtitle truncate text-[11.5px] leading-tight text-foreground-400">{pageSubtitle}</p>
        )}
      </div>

      {/* Below lg the title has no room, so the actions simply push right. */}
      <div className="flex-1 lg:hidden"></div>

      {/* The shared workspace controls stay visible on every desktop page so
          the dashboard and its child pages have the same navigation chrome. */}

      {/* Keep the workspace switcher available in the shared top bar so
          administrators can return to the workspace list from any page. */}
      <WorkspaceSwitcher />

      {/* Profile — kept: it is the only route to Sign Out. */}
      <div className="flex items-center gap-0.5">
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => { closeOthers('profile'); setProfileOpen(!profileOpen); }}
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            aria-label="Account menu"
            className={`kbc-topbar-profile flex cursor-pointer items-center gap-1.5 rounded-full p-1 ring-1 transition-smooth sm:pr-2 ${
              profileOpen
                ? 'bg-primary-50 ring-primary-200'
                : 'ring-transparent hover:bg-primary-50/60 hover:ring-primary-100'
            }`}
          >
            <AccountAvatar initials={initials} className="h-7 w-7 shadow-sm shadow-primary-900/25" />
            {role === 'admin' && <span className="kbc-topbar-user-name hidden max-w-[5rem] truncate text-[11px] font-semibold text-white xl:inline">Super Admin</span>}
            <AppIcon
              className={`ri-arrow-down-s-line hidden text-xs text-foreground-400 transition-transform duration-200 sm:inline ${profileOpen ? 'rotate-180' : ''}`}
            ></AppIcon>
          </button>
          {profileOpen && (
            <div
              role="menu"
              className="account-menu-pop absolute right-0 top-full z-50 mt-2 w-[16.5rem] overflow-hidden rounded-2xl bg-background-50 ring-1 ring-foreground-100 shadow-[0_20px_44px_-20px_oklch(var(--foreground-950)/0.32)]"
            >
              {/* Identity block. The tinted panel gives the name and email a
                  surface of their own instead of floating on bare white. */}
              <div className="flex items-center gap-3 bg-gradient-to-br from-primary-50 to-background-50 px-4 py-3.5">
                <AccountAvatar initials={initials} className="h-10 w-10" textClassName="text-[0.8125rem]" />
                <div className="min-w-0">
                  <p className="truncate text-[0.875rem] font-semibold leading-tight text-foreground-900">{displayName}</p>
                  {email && <p className="truncate text-[0.75rem] leading-tight text-foreground-400">{email}</p>}
                  {roleLabel && (
                    <span className="mt-1.5 inline-flex items-center rounded-full bg-primary-100/70 px-2 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-primary-700">
                      {roleLabel}
                    </span>
                  )}
                </div>
              </div>

              {/* Appearance is kept next to the existing account action so the
                  preference is available anywhere the profile menu is available. */}
              <div className="border-t border-background-200/70 p-1.5">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-label="Toggle dark mode"
                  aria-checked={theme === 'dark'}
                  onClick={toggleTheme}
                  className="account-theme-row group flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-smooth hover:bg-background-100 focus:outline-none focus-visible:bg-background-100"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-500 transition-smooth group-hover:bg-background-200 group-hover:text-foreground-700" aria-hidden="true">
                    {theme === 'dark' ? <Sun size={15} strokeWidth={2.2} /> : <Moon size={15} strokeWidth={2.2} />}
                  </span>
                  <span className="flex-1 text-[0.8125rem] font-semibold text-foreground-700 transition-smooth group-hover:text-foreground-900">Dark mode</span>
                  <span className={`account-theme-switch relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-200 ${theme === 'dark' ? 'bg-primary-500' : 'bg-background-300'}`} aria-hidden="true">
                    <span className={`block h-4 w-4 rounded-full bg-background-50 shadow-sm transition-transform duration-200 ${theme === 'dark' ? 'translate-x-4' : 'translate-x-0'}`}></span>
                  </span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  aria-expanded={accessibilityOpen}
                  onClick={() => setAccessibilityOpen((open) => !open)}
                  className="account-theme-row group mt-1 flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-smooth hover:bg-background-100 focus:outline-none focus-visible:bg-background-100"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-black transition-smooth group-hover:bg-background-50" aria-hidden="true">
                    <AccessibilityBadge className="h-5 w-5" />
                  </span>
                  <span className="flex-1 text-[0.8125rem] font-semibold text-foreground-700 transition-smooth group-hover:text-foreground-900">Accessibility</span>
                  <AppIcon className={`ri-arrow-down-s-line text-xs text-foreground-400 transition-transform duration-200 ${accessibilityOpen ? 'rotate-180' : ''}`} aria-hidden="true"></AppIcon>
                </button>

                {accessibilityOpen && (
                  <div className="mx-1 mb-1 rounded-xl bg-background-100/70 p-2 ring-1 ring-background-200/70" role="group" aria-label="Accessibility settings">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-50 text-foreground-500" aria-hidden="true">
                        <AppIcon className="ri-contrast-2-line text-base"></AppIcon>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.75rem] font-semibold text-foreground-800">Black and white</p>
                        <p className="text-[0.6875rem] leading-snug text-foreground-400">
                          {theme === 'dark' ? 'Available in Light Mode only' : 'Remove colour from the interface'}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Toggle black and white mode"
                        aria-checked={theme === 'light' && monochrome}
                        disabled={theme === 'dark'}
                        title={theme === 'dark' ? 'Switch to Light Mode to use black and white mode' : 'Toggle black and white mode'}
                        onClick={() => setMonochrome((enabled) => !enabled)}
                        className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ${
                          theme === 'dark'
                            ? 'cursor-not-allowed bg-background-200 opacity-50'
                            : monochrome
                              ? 'bg-foreground-900'
                              : 'bg-background-300'
                        }`}
                      >
                        <span className={`block h-4 w-4 rounded-full bg-background-50 shadow-sm transition-transform duration-200 ${theme === 'light' && monochrome ? 'translate-x-4' : 'translate-x-0'}`}></span>
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setProfileOpen(false); setSignOutOpen(true); }}
                  className="group mt-1 flex w-full cursor-pointer items-center gap-3 rounded-xl border-t border-background-200/70 px-2.5 pb-2 pt-2 text-left transition-smooth hover:bg-red-50 focus:outline-none focus-visible:bg-red-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background-100 text-foreground-400 transition-smooth group-hover:bg-red-100 group-hover:text-red-600">
                    <AppIcon className="ri-logout-box-line text-base"></AppIcon>
                  </span>
                  <span className="flex-1 text-[0.8125rem] font-semibold text-foreground-700 transition-smooth group-hover:text-red-600">Sign out</span>
                  <AppIcon className="ri-arrow-right-s-line text-sm text-foreground-200 transition-smooth group-hover:text-red-400"></AppIcon>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>

    {/* Sign Out Confirmation Modal — portalled to the body so no ancestor of the
        header can clip it or outrank it in the stacking order. */}
    {signOutOpen && createPortal(
      <SignOutConfirmModal
        displayName={displayName}
        email={email || 'Signed in'}
        onClose={() => setSignOutOpen(false)}
        onConfirm={() => { setSignOutOpen(false); logout(); }}
      />,
      document.body,
    )}
    </>
  );
}

// Reusable dropdown panel wrapper
