import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, ChevronDown, CircleHelp, Compass, LogOut, MessageSquare, Settings, UserRound } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { Modal } from '@/pages/users/components/Modal';
import type { HomeEvent } from './homeData';
import styles from './studentHome.module.css';

function readSeen(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch { return []; }
}
const notificationKey = (event: HomeEvent) => JSON.stringify([event.id, event.date, event.title, event.detail]);

function AccountSettings() {
  const { theme, setTheme } = useTheme();
  return <div className={styles.headerDialogBody}>
    <label className={styles.settingLabel}>Learning workspace appearance
      <select value={theme} onChange={event => setTheme(event.target.value as 'light' | 'dark')}>
        <option value="light">Light</option><option value="dark">Dark</option>
      </select>
    </label>
    <p>Your display preference is saved on this device.</p>
    <Link className={styles.headerDialogLink} to="/forgot-password">Reset your password<ArrowRight aria-hidden="true"/></Link>
  </div>;
}

export function StudentHomeHeader({ name, homeHref, identity, events, loading, error, onRetry }: {
  name: string; homeHref: string; identity: string; events: HomeEvent[];
  loading: boolean; error: boolean; onRetry: () => void;
}) {
  const { logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [panel, setPanel] = useState<'notifications' | 'help' | 'settings' | null>(null);
  const profile = useRef<HTMLDivElement>(null);
  const profileButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const panelTrigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const storageKey = `student-home-notifications:${identity}`;
  const [seen, setSeen] = useState(() => readSeen(storageKey));
  // These are reminders from the learner's actual schedule, not the general
  // notifications screen's demonstration inbox. Read state is local to this account/device.
  const notifications = events.filter(event => event.date);
  const unread = notifications.filter(event => !seen.includes(notificationKey(event))).length;
  const versions = notifications.map(notificationKey).join('\n');

  useEffect(() => {
    if (panel !== 'notifications' || !unread) return;
    setSeen(previous => {
      const next = [...new Set([...previous, ...versions.split('\n').filter(Boolean)])].slice(-100);
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* The in-memory read state still works. */ }
      return next;
    });
  }, [panel, unread, versions, storageKey]);

  useEffect(() => {
    if (!profileOpen) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: MouseEvent) => {
      if (!profile.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [profileOpen]);

  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!profileOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault(); setProfileOpen(false); profileButton.current?.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };
  const openPanel = (next: typeof panel, trigger: HTMLButtonElement | null) => {
    panelTrigger.current = trigger;
    setProfileOpen(false); setPanel(next);
  };

  return <>
    <header className={styles.header}>
      <Link to={homeHref} className={styles.headerBrand} aria-label="Kent Business College learner home">
        <svg className={styles.headerLogo} viewBox="0 0 225 201" role="img" aria-label="Kent Business College logo">
          <image href="/assets/kbc-logo.png" width="438" height="201"/>
        </svg>
        <strong>Kent Business College</strong><span className={styles.brandDivider} aria-hidden="true">|</span><span className={styles.portalLabel}>Learner Portal</span>
      </Link>
      <svg className={styles.headerOrnament} viewBox="0 0 280 36" fill="none" stroke="currentColor" aria-hidden="true" focusable="false">
        <path d="M1 18H104 M176 18H279" strokeLinecap="round"/>
        <g transform="translate(113.12 -1.53) scale(.07)" fill="currentColor" stroke="none">
          <path d="M509 110H519V151H509Z M507 165C505 174 500 183 500 192C500 207 528 207 528 192C528 183 523 174 521 165Z"/>
          <circle cx="514" cy="160" r="11"/>
          <path d="M236 105L384 36L532 105L460 136V196Q384 120 308 196V136Z"/>
          <circle cx="384" cy="226" r="57"/>
          <circle cx="223" cy="254" r="42"/>
          <circle cx="545" cy="254" r="42"/>
          <path d="M279 389C279 331 325 287 384 287C443 287 489 331 489 389C439 415 403 450 384 479C365 450 329 415 279 389Z M148 352C174 298 239 283 283 327C272 342 265 359 262 381C222 366 185 357 148 352Z M620 352C594 298 529 283 485 327C496 342 503 359 506 381C546 366 583 357 620 352Z"/>
          <path d="M61 437L102 367C208 360 340 414 381 513C290 445 139 405 61 437Z M37 513L56 460C192 420 310 465 381 521C243 474 120 470 37 513Z M707 437L666 367C560 360 428 414 387 513C478 445 629 405 707 437Z M731 513L712 460C576 420 458 465 387 521C525 474 648 470 731 513Z"/>
        </g>
      </svg>
      <div className={styles.headerActions}>
        <button type="button" className={styles.headerAction} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
          aria-haspopup="dialog" aria-expanded={panel === 'notifications'} onClick={event => openPanel('notifications', event.currentTarget)}>
          <span className={styles.notificationBell}><Bell aria-hidden="true"/>{unread > 0 && <span className={styles.notificationDot} aria-hidden="true"/>}</span>
          <span className={styles.headerControlLabel}>Notifications</span>
        </button>
        <a className={`${styles.headerAction} ${styles.headerResource}`} href="https://kentbusinesscollege.com/learners/career-planner/">
          <Compass aria-hidden="true"/><span>Career Planner</span>
        </a>
        <button type="button" className={`${styles.headerAction} ${styles.headerResource}`} aria-label="Feedback — coming soon" disabled>
          <MessageSquare aria-hidden="true"/><span className={styles.headerResourceLabel}>Feedback<span className={styles.comingSoon}>Coming soon</span></span>
        </button>
        <button type="button" className={styles.headerAction} aria-label="Help & Support" aria-haspopup="dialog"
          aria-expanded={panel === 'help'} onClick={event => openPanel('help', event.currentTarget)}>
          <CircleHelp aria-hidden="true"/><span className={styles.headerControlLabel}>Help &amp; Support</span>
        </button>
        <div ref={profile} className={styles.headerProfile} onKeyDown={menuKeys}
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setProfileOpen(false); }}>
          <button ref={profileButton} type="button" className={styles.headerAction} aria-label={`${name}, account menu`}
            aria-haspopup="menu" aria-controls={menuId} aria-expanded={profileOpen} onClick={() => setProfileOpen(value => !value)}
            onKeyDown={event => { if (!profileOpen && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setProfileOpen(true); } }}>
            <UserRound className={styles.headerAvatar} aria-hidden="true"/><span className={styles.headerName}>{name}</span><ChevronDown className={styles.profileChevron} aria-hidden="true"/>
          </button>
          {profileOpen && <div ref={menu} id={menuId} role="menu" aria-label="Account" className={styles.profileMenu}>
            <Link role="menuitem" to="/learner/profile" onClick={() => setProfileOpen(false)}><UserRound aria-hidden="true"/>My Profile</Link>
            <button type="button" role="menuitem" onClick={() => openPanel('settings', profileButton.current)}><Settings aria-hidden="true"/>Settings</button>
            <button type="button" role="menuitem" onClick={() => { setProfileOpen(false); logout(); }}><LogOut aria-hidden="true"/>Sign out</button>
          </div>}
        </div>
      </div>
    </header>
    {panel && <Modal title={panel === 'notifications' ? 'Notifications' : panel === 'help' ? 'Help & Support' : 'Settings'}
      onClose={() => setPanel(null)} size="max-w-lg" className={styles.headerDialog} returnFocusRef={panelTrigger}>
      {panel === 'notifications' ? <div className={styles.headerDialogBody}>
        <p>Reminders from your learning schedule.</p>
        {notifications.length > 0 && <ul className={styles.headerNotifications}>{notifications.map(event => <li key={event.id}>
          <Link to={event.href} onClick={() => setPanel(null)}><strong>{event.title}</strong><span>{event.detail}</span>
            <time dateTime={event.date!}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(event.date!))}</time>
          </Link>
        </li>)}</ul>}
        {loading && <p role="status">Loading notifications…</p>}
        {error ? <div role="alert"><p>Some reminders could not be loaded.</p><button className={styles.headerDialogLink} onClick={onRetry}>Try again</button></div>
          : !loading && !notifications.length && <p>You’re all caught up. No upcoming reminders.</p>}
      </div> : panel === 'settings' ? <AccountSettings/> : <div className={styles.headerDialogBody}>
        <p>Use Continue Learning to open this week’s material, and Dashboard to explore your progress and learning tools.</p>
        <Link className={styles.headerDialogLink} to="/user-guide">Open the learner guide<ArrowRight aria-hidden="true"/></Link>
        <Link className={styles.headerDialogLink} to="/learner/monthly-coaching">Get learning support from your coach<ArrowRight aria-hidden="true"/></Link>
      </div>}
    </Modal>}
  </>;
}
