import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { BrandLockup } from '@/components/BrandLockup';

interface HeaderProps {
  pageTitle: string;
  pageSubtitle?: string;
  onOpenSearch: () => void;
  userName?: string;
  onToggleMobileSidebar?: () => void;
}

function SignOutConfirmModal({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative w-full max-w-xs bg-background-50 rounded-2xl border border-foreground-200 shadow-2xl shadow-foreground-950/15 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-5 text-center">
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mx-auto mb-3">
            <AppIcon className="ri-logout-box-line text-red-600 text-xl"></AppIcon>
          </div>
          <h3 className="text-sm font-bold text-foreground-900 mb-1">Sign Out?</h3>
          <p className="text-sm text-foreground-500 mb-5">Are you sure you want to sign out of your account? Any unsaved changes will be lost.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-3 py-2.5 border border-background-200 rounded-lg text-sm font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Cancel</button>
            <button onClick={onConfirm} className="flex-1 px-3 py-2.5 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-logout-box-line mr-1"></AppIcon> Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Notification sound
export function Header({ pageTitle, pageSubtitle, onOpenSearch, userName = 'Sarah Mitchell', onToggleMobileSidebar }: HeaderProps) {
  const { auth, logout } = useAuth();
  // Profile is the only dropdown left in the header, so the state that used to
  // coordinate six of them is gone along with them — as are the hard-coded
  // notification, task and message lists that fed their badge counts.
  const [profileOpen, setProfileOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const profileRef = useRef<HTMLDivElement>(null);

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

  const displayName = auth.user?.fullName || userName;
  return (
    <>
    {/* Height and border deliberately match the sidebar's brand row, so the two
        read as one continuous bar across the top of the workspace. */}
    <header className="workspace-topbar flex h-14 shrink-0 items-center gap-2 border-b border-foreground-100 bg-background-50 px-2 sm:px-3 md:gap-3 md:px-4">
      {/* Hamburger — mobile only */}
      <button
        onClick={onToggleMobileSidebar}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-500 transition-smooth hover:bg-primary-50/70 hover:text-primary-700 lg:hidden"
        title="Toggle menu"
        aria-label="Toggle menu"
      >
        <AppIcon className="ri-menu-line text-lg"></AppIcon>
      </button>

      {/* Provider logo — below lg only. From lg up the sidebar carries the
          brand, and showing it twice was the duplication that read as clutter. */}
      <a href="/" className="flex shrink-0 lg:hidden" aria-label="Kent Business College home">
        <BrandLockup size="compact" />
      </a>

      {/* Where the page says what it is. These props were being passed by every
          page and thrown away, which is what left the bar looking empty. */}
      <div className="hidden min-w-0 flex-1 lg:block">
        <p className="truncate font-heading text-[14px] font-bold leading-tight text-foreground-900">{pageTitle}</p>
        {pageSubtitle && (
          <p className="truncate text-[11.5px] leading-tight text-foreground-400">{pageSubtitle}</p>
        )}
      </div>

      {/* Below lg the title has no room, so the actions simply push right. */}
      <div className="flex-1 lg:hidden"></div>

      {/* The global search trigger and the Messages / Tasks / Notifications /
          Quick Create / Help / Settings icons were removed from the header.
          Their destinations are still routed and still reachable from the
          sidebar, so this removes the header entry points, not the features. */}

      {/* Profile — kept: it is the only route to Sign Out. */}
      <div className="flex items-center gap-0.5">
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => { closeOthers('profile'); setProfileOpen(!profileOpen); }}
            className="flex cursor-pointer items-center gap-1 rounded-lg p-1 transition-smooth hover:bg-primary-50/70 sm:gap-2 sm:pl-2"
          >
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center ring-1 ring-primary-200/50">
              <span className="text-primary-700 text-xs font-semibold">{displayName.charAt(0)}</span>
            </div>
            <AppIcon className="ri-arrow-down-s-line hidden text-xs text-foreground-300 sm:inline"></AppIcon>
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-background-50 rounded-xl border border-foreground-100 shadow-xl shadow-foreground-950/5 z-50 py-1 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-background-100">
                <p className="text-sm font-semibold text-foreground-900">{displayName}</p>
                <p className="text-xs text-foreground-400">{auth.user?.email || 'User'}</p>
              </div>
              {/* My Profile and Preferences removed; the separator went with
                  them, since Sign Out no longer follows anything. The name and
                  email above stay — they are what identifies the session. */}
              <button
                onClick={() => { setProfileOpen(false); setSignOutOpen(true); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50/50 transition-smooth text-left cursor-pointer"
              >
                <AppIcon className="ri-logout-box-line"></AppIcon> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>

    {/* Sign Out Confirmation Modal */}
    {signOutOpen && (
      <SignOutConfirmModal
        onClose={() => setSignOutOpen(false)}
        onConfirm={() => { setSignOutOpen(false); logout(); }}
      />
    )}
    </>
  );
}

// Reusable dropdown panel wrapper
