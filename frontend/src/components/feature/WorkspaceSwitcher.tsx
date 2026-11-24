import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppIcon } from '@/components/feature/AppIcon';
import { useAuth } from '@/hooks/useAuth';
import { activeWorkspace, grantedWorkspacesFor, workspacesFor, type PortalWorkspace } from '@/lib/portalWorkspaces';
import styles from './WorkspaceSwitcher.module.css';

/* ═══════════════════════════════════════════════════════
   WORKSPACE SWITCHER — how an administrator changes section.

   It replaced a five-card panel on the Super Admin dashboard.
   The panel's problem was not how it looked but where it was:
   only on the dashboard, so changing section meant navigating
   home and then out again. In the header it is one click from
   every page.

   Five sections, so there is no filter box and no group headings:
   both were in an earlier draft of this component and both were
   chrome over a list you can read at a glance. What is left is
   the list, where you are in it, and a way in.

   Navigation only. An administrator already has access to every
   section, so there is no role to assume and nothing here touches
   RBAC state. (The retired RoleSwitcher did call switchRole; that
   was the demo-account concept, not this.)
   ═══════════════════════════════════════════════════════ */

/** Administrators keep their launcher; other accounts switch between their grants. */
export function WorkspaceSwitcher({ label }: { label?: string } = {}) {
  const { auth, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Keep the same array while navigating the menu with the keyboard. Staff
  // destinations come from their session payload, never the admin launcher.
  const account = auth.account;
  const workspaces = useMemo(
    () => isAdmin ? workspacesFor(account ?? null) : grantedWorkspacesFor(account),
    [isAdmin, account],
  );
  const current = activeWorkspace(pathname, workspaces);

  const toggleMenu = () => {
    if (!open) {
      // Initialise before mounting the scrolling list, so reopening cannot
      // briefly scroll to the previous keyboard selection.
      const index = current ? workspaces.findIndex((w) => w.slug === current.slug) : 0;
      setHighlighted(index < 0 ? 0 : index);
    }
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    // There is no search field to take focus now, so the menu takes it itself —
    // otherwise the arrow keys would still be talking to the trigger button.
    menuRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open) {
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[highlighted]
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [open, highlighted]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const go = (workspace: PortalWorkspace) => {
    setOpen(false);
    navigate(workspace.path);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlighted((index) => (index + step + workspaces.length) % workspaces.length);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const target = workspaces[highlighted];
      if (!open || !target) return;
      event.preventDefault();
      go(target);
    }
  };

  if (!auth.isAuthenticated || (!isAdmin && workspaces.length <= 1)) return null;

  return (
    <div className="kbc-workspace-switcher relative shrink-0" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        onClick={toggleMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`kbc-workspace-switcher-button group flex h-9 cursor-pointer items-center gap-2 rounded-xl border pl-1.5 pr-2 font-bold shadow-sm transition-smooth ${
          open
            ? 'border-primary-300 bg-primary-50 shadow-sm'
            : 'border-foreground-200/70 hover:border-primary-300 hover:bg-primary-50/50'
        }`}
        title="Switch workspace"
      >
        {/* The current section's own icon, so the control reads as "you are
            here" and not just as a menu. */}
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-smooth ${
            open ? 'bg-primary-500 text-white' : 'bg-white/20 text-white group-hover:bg-white/30'
          }`}
        >
          <AppIcon className={`${current ? current.icon : 'ri-dashboard-line'} text-[11px]`} />
        </span>
        <span className="hidden max-w-[9rem] truncate text-[12.5px] font-bold !text-white sm:inline">
          {label ? <span className="kbc-workspace-label"><small>Workspace</small><span>{label}</span></span> : 'Workspaces'}
        </span>
        <AppIcon
          className={`ri-arrow-down-s-line text-[11px] !text-white transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label="Switch workspace"
          className={styles.menu}
        >
          <p className={styles.heading}>
            Switch workspace
          </p>

          <div className={styles.list}>
            {workspaces.map((workspace, index) => {
              const isCurrent = current?.slug === workspace.slug;
              const isHighlighted = index === highlighted;
              return (
                <button
                  key={workspace.slug}
                  role="menuitem"
                  onClick={() => go(workspace)}
                  onMouseEnter={() => setHighlighted(index)}
                  aria-current={isCurrent ? 'true' : undefined}
                  data-highlighted={isHighlighted || undefined}
                  className={styles.item}
                >
                  <span className={styles.icon}>
                    <AppIcon className={workspace.icon} />
                  </span>
                  <span className={styles.copy}>
                    <span className={styles.label}>
                      {workspace.label}
                    </span>
                    <span className={styles.description}>
                      {workspace.blurb}
                    </span>
                  </span>
                  {isCurrent ? (
                    <AppIcon className={`ri-check-line ${styles.indicator}`} />
                  ) : (
                    // Appears on the active row only, so the list stays quiet
                    // until you are actually pointing at something.
                    <AppIcon
                      className={`ri-arrow-right-line ${styles.indicator} ${isHighlighted ? '' : styles.hiddenIndicator}`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
