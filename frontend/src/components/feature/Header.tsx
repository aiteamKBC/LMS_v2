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
function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch { /* AudioContext not available */ }
}

export function Header({ pageTitle, pageSubtitle, onOpenSearch, userName = 'Sarah Mitchell', onToggleMobileSidebar }: HeaderProps) {
  const { auth, hasPermission, logout } = useAuth();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  // Track if new message notification came from external page
  const [newMsgFlashed, setNewMsgFlashed] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const tasksRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const createRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);

  const closeOthers = useCallback((except: string) => {
    if (except !== 'notif') setNotificationsOpen(false);
    if (except !== 'tasks') setTasksOpen(false);
    if (except !== 'messages') setMessagesOpen(false);
    if (except !== 'create') setQuickCreateOpen(false);
    if (except !== 'profile') setProfileOpen(false);
    if (except !== 'help') setHelpOpen(false);
  }, []);

  // Listen for new-message events from messages pages
  useEffect(() => {
    const handler = () => {
      playNotificationSound();
      setNewMsgFlashed(true);
      setTimeout(() => setNewMsgFlashed(false), 2000);
    };
    window.addEventListener('new-message-received', handler);
    return () => window.removeEventListener('new-message-received', handler);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) setNotificationsOpen(false);
      if (tasksRef.current && !tasksRef.current.contains(target)) setTasksOpen(false);
      if (messagesRef.current && !messagesRef.current.contains(target)) setMessagesOpen(false);
      if (createRef.current && !createRef.current.contains(target)) setQuickCreateOpen(false);
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
      if (helpRef.current && !helpRef.current.contains(target)) setHelpOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const canAccessSettings = hasPermission('settings.view');

  const notifications = [
    { id: 1, text: 'Coach Martin confirmed your OTJH entry', time: '2m ago', unread: true, type: 'otjh' },
    { id: 2, text: 'Monthly checkpoint assessment is ready', time: '1h ago', unread: true, type: 'assessment' },
    { id: 3, text: 'Employer signed your progress review', time: '3h ago', unread: false, type: 'review' },
    { id: 4, text: 'New module available: Data Analysis', time: 'Yesterday', unread: false, type: 'module' },
    { id: 5, text: 'QA spot check scheduled for Cohort B', time: 'Yesterday', unread: false, type: 'qa' },
  ];

  const tasks = [
    { id: 1, text: 'Validate OTJH entries — Cohort A', due: '14 Jun', priority: 'high' as const, assignee: 'Helen Curtis' },
    { id: 2, text: 'Complete Q2 progress reports', due: '20 Jun', priority: 'medium' as const, assignee: 'You' },
    { id: 3, text: 'Review evidence submissions', due: '12 Jun', priority: 'high' as const, assignee: 'You' },
    { id: 4, text: 'Update ILR data for May', due: '15 Jun', priority: 'low' as const, assignee: 'Lisa Nguyen' },
  ];

  const messages_data = [
    { id: 1, sender: 'Martin Reeves', subject: 'RE: Monthly Check-in Preparation', preview: 'Hi Sarah, I\'ve reviewed your latest evidence and...', time: '2h ago', unread: true, href: '/learner/messages' },
    { id: 2, sender: 'Helen Curtis', subject: 'Assignment feedback ready', preview: 'Your Module 7 assignment has been marked...', time: '5h ago', unread: true, href: '/messages' },
    { id: 3, sender: 'Mark Davies', subject: 'Employer Review Scheduling', preview: 'Would next Thursday work for the quarterly...', time: 'Yesterday', unread: false, href: '/messages' },
    { id: 4, sender: 'Sophie Williams', subject: 'Coaching Session Reschedule', preview: 'Need to reschedule our session on the 18th...', time: '3h ago', unread: true, href: '/coach/messages' },
  ];

  const quickCreateItems = [
    { label: 'New Learner Record', icon: 'ri-user-add-line', permission: 'users.manage' },
    { label: 'New Cohort', icon: 'ri-group-line', permission: 'cohorts.create' },
    { label: 'New Programme', icon: 'ri-stack-line', permission: 'programmes.manage' },
    { label: 'New Employer', icon: 'ri-building-line', permission: 'employer.manage' },
    { label: 'Log OTJH Entry', icon: 'ri-time-line', permission: 'otjh.claim' },
    { label: 'Upload Evidence', icon: 'ri-upload-cloud-line', permission: 'evidence.create' },
    { label: 'Schedule Progress Review', icon: 'ri-calendar-check-line', permission: 'reviews.create' },
    { label: 'New Document Template', icon: 'ri-file-text-line', permission: 'compliance.manage' },
  ];

  const unreadNotifs = notifications.filter(n => n.unread).length;
  const highPriorityTasks = tasks.filter(t => t.priority === 'high' && t.assignee === 'You').length;
  const unreadMessages = messages_data.filter(m => m.unread).length;

  const displayName = auth.user?.fullName || userName;
  const roleSlug = auth.roles[0]?.slug || 'learner';
  const roleMessagesPath = roleSlug === 'learner' ? '/learner/messages' : roleSlug === 'coach' ? '/coach/messages' : roleSlug === 'admin' ? '/admin/messages' : '/messages';

  return (
    <>
    <header className="workspace-topbar flex h-14 shrink-0 items-center gap-1.5 border-b border-background-300/70 bg-background-200 px-2 shadow-sm shadow-foreground-950/5 sm:px-3 md:gap-3 md:px-4">
      {/* Hamburger — mobile only */}
      <button
        onClick={onToggleMobileSidebar}
        className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-500 transition-smooth hover:bg-background-100 hover:text-foreground-700 lg:hidden"
        title="Toggle menu"
      >
        <AppIcon className="ri-menu-line text-lg"></AppIcon>
      </button>

      {/* Provider Logo */}
      <a href="/" className="hidden shrink-0 sm:flex">
        <BrandLockup size="compact" />
      </a>

      {/* Spacer */}
      <div className="flex-1 min-w-0"></div>

      {/* Global Search trigger */}
      <button
        onClick={onOpenSearch}
        className="hidden md:flex items-center gap-2.5 px-3.5 py-2 rounded-xl border border-foreground-200 bg-background-100/80 hover:border-primary-300/50 hover:bg-primary-50/40 hover:shadow-sm hover:shadow-primary-500/5 transition-smooth min-w-[200px] lg:min-w-[280px] max-w-[400px] cursor-pointer group"
      >
        <span className="w-6 h-6 rounded-md bg-primary-100 flex items-center justify-center">
          <AppIcon className="ri-search-line text-sm text-primary-600"></AppIcon>
        </span>
        <span className="flex-1 text-left text-sm text-foreground-400 group-hover:text-foreground-600 transition-smooth">Search anything...</span>
        <span className="text-xs text-foreground-300 bg-background-200/60 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">⌘K</span>
      </button>

      {/* Mobile search icon */}
      <button
        onClick={onOpenSearch}
        className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer shrink-0"
        title="Search"
      >
        <AppIcon className="ri-search-line text-lg"></AppIcon>
      </button>

      {/* Spacer */}
      <div className="w-4 hidden lg:block"></div>

      {/* Action icons */}
      <div className="flex items-center gap-0.5">
        {/* Messages */}
        <div className="relative" ref={messagesRef}>
          <button
            onClick={() => { closeOthers('messages'); setMessagesOpen(!messagesOpen); }}
            className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-smooth cursor-pointer ${
              newMsgFlashed ? 'text-primary-500 bg-primary-50/60' : 'text-foreground-400 hover:text-foreground-700 hover:bg-background-100'
            }`}
            title="Messages"
          >
            <AppIcon className={`${newMsgFlashed ? 'ri-mail-unread-line' : 'ri-mail-line'} text-lg`}></AppIcon>
            {unreadMessages > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 rounded-full bg-primary-500 text-white text-[8px] font-bold flex items-center justify-center px-0.5 leading-none">{unreadMessages}</span>
            )}
          </button>
          {messagesOpen && (
            <DropdownPanel title="Messages" count={unreadMessages} countLabel="unread" viewAllHref={roleMessagesPath}>
              {messages_data.map(m => (
                <a key={m.id} href={m.href} className="block px-4 py-2.5 hover:bg-background-50 transition-smooth border-b border-background-100 last:border-0">
                  <div className="flex items-start gap-2.5">
                    <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${m.unread ? 'bg-primary-500' : 'bg-transparent'}`}></span>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground-900 truncate">{m.sender}</span>
                        <span className="text-xs text-foreground-300 whitespace-nowrap">{m.time}</span>
                      </div>
                      <p className="text-sm text-foreground-700 font-medium truncate mt-0.5">{m.subject}</p>
                      <p className="text-xs text-foreground-400 truncate">{m.preview}</p>
                    </div>
                  </div>
                </a>
              ))}
            </DropdownPanel>
          )}
        </div>

        {/* Tasks */}
        <div className="relative hidden sm:block" ref={tasksRef}>
          <button
            onClick={() => { closeOthers('tasks'); setTasksOpen(!tasksOpen); }}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
            title="Tasks"
          >
            <AppIcon className="ri-task-line text-lg"></AppIcon>
            {highPriorityTasks > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center px-0.5 leading-none">{highPriorityTasks}</span>
            )}
          </button>
          {tasksOpen && (
            <DropdownPanel title="Tasks" count={tasks.length} countLabel="total" viewAllHref="/tasks">
              {tasks.map(t => (
                <a key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-background-50 transition-smooth border-b border-background-100 last:border-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    t.priority === 'high' ? 'bg-red-500' : t.priority === 'medium' ? 'bg-amber-500' : 'bg-foreground-300'
                  }`}></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground-800 truncate">{t.text}</p>
                    <p className="text-xs text-foreground-400">Due {t.due} · {t.assignee}</p>
                  </div>
                  {t.priority === 'high' && (
                    <span className="text-xs font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded whitespace-nowrap">High</span>
                  )}
                </a>
              ))}
            </DropdownPanel>
          )}
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { closeOthers('notif'); setNotificationsOpen(!notificationsOpen); }}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
            title="Notifications"
          >
            <AppIcon className="ri-notification-3-line text-lg"></AppIcon>
            {unreadNotifs > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-3.5 rounded-full bg-amber-500 text-white text-[8px] font-bold flex items-center justify-center px-0.5 leading-none">{unreadNotifs}</span>
            )}
          </button>
          {notificationsOpen && (
            <DropdownPanel title="Notifications" count={unreadNotifs} countLabel="unread" viewAllHref="/notifications" onMarkAllRead={() => {}}>
              {notifications.map(n => (
                <a
                  key={n.id}
                  href={`/notifications/${n.id}`}
                  className={`flex items-start gap-3 px-4 py-2.5 hover:bg-background-50 transition-smooth border-b border-background-100 last:border-0 ${
                    n.unread ? 'bg-primary-50/30' : ''
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${n.unread ? 'bg-primary-500' : 'bg-transparent'}`}></span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-snug ${n.unread ? 'text-foreground-900 font-medium' : 'text-foreground-600'}`}>
                      {n.text}
                    </p>
                    <p className="text-xs text-foreground-400 mt-0.5">{n.time}</p>
                  </div>
                </a>
              ))}
            </DropdownPanel>
          )}
        </div>

        {/* Divider */}
        <div className="mx-1 hidden h-5 w-px bg-background-200/60 sm:block"></div>

        {/* Quick Create */}
        <div className="relative hidden md:block" ref={createRef}>
          <button
            onClick={() => { closeOthers('create'); setQuickCreateOpen(!quickCreateOpen); }}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-primary-600 hover:bg-primary-50 transition-smooth cursor-pointer"
            title="Quick Create"
          >
            <AppIcon className="ri-add-circle-line text-lg"></AppIcon>
          </button>
          {quickCreateOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-background-50 rounded-xl border border-background-200 shadow-lg shadow-foreground-950/5 z-50 py-1 overflow-hidden">
              <div className="px-4 py-2 border-b border-background-100">
                <span className="text-xs font-semibold text-foreground-400 uppercase tracking-wider">Quick Create</span>
              </div>
              {quickCreateItems.filter(item => hasPermission(item.permission)).map((item, i) => (
                <a
                  key={i}
                  href="#"
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-700 hover:bg-background-50 transition-smooth cursor-pointer"
                  onClick={e => { e.preventDefault(); setQuickCreateOpen(false); }}
                >
                  <AppIcon className={`${item.icon} text-foreground-400`}></AppIcon>
                  {item.label}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Help */}
        <div className="relative hidden md:block" ref={helpRef}>
          <button
            onClick={() => { closeOthers('help'); setHelpOpen(!helpOpen); }}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
            title="Help & Support"
          >
            <AppIcon className="ri-question-line text-lg"></AppIcon>
          </button>
          {helpOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-48 bg-background-50 rounded-xl border border-background-200 shadow-lg shadow-foreground-950/5 z-50 py-1 overflow-hidden">
              <a href="/help" className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-700 hover:bg-background-50 transition-smooth">
                <AppIcon className="ri-book-open-line text-foreground-400"></AppIcon> Knowledge Base
              </a>
              <a href="/help/guides" className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-700 hover:bg-background-50 transition-smooth">
                <AppIcon className="ri-guide-line text-foreground-400"></AppIcon> User Guides
              </a>
              <a href="/help/support" className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-700 hover:bg-background-50 transition-smooth">
                <AppIcon className="ri-customer-service-line text-foreground-400"></AppIcon> Contact Support
              </a>
              <div className="border-t border-background-100 my-1"></div>
              <a href="/help/release-notes" className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-700 hover:bg-background-50 transition-smooth">
                <AppIcon className="ri-rocket-line text-foreground-400"></AppIcon> What's New
              </a>
            </div>
          )}
        </div>

        {/* Settings (permission-based) */}
        {canAccessSettings && (
          <a
            href="/admin/settings"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
            title="Settings"
          >
            <AppIcon className="ri-settings-3-line text-lg"></AppIcon>
          </a>
        )}

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => { closeOthers('profile'); setProfileOpen(!profileOpen); }}
            className="flex cursor-pointer items-center gap-1 rounded-lg p-1 transition-smooth hover:bg-background-100 sm:gap-2 sm:pl-2"
          >
            <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center ring-1 ring-primary-200/50">
              <span className="text-primary-700 text-xs font-semibold">{displayName.charAt(0)}</span>
            </div>
            <AppIcon className="ri-arrow-down-s-line hidden text-xs text-foreground-300 sm:inline"></AppIcon>
          </button>
          {profileOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-52 bg-background-50 rounded-xl border border-background-200 shadow-lg shadow-foreground-950/5 z-50 py-1 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-background-100">
                <p className="text-sm font-semibold text-foreground-900">{displayName}</p>
                <p className="text-xs text-foreground-400">{auth.user?.email || 'User'}</p>
              </div>
              <a href="/profile" className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-700 hover:bg-background-50 transition-smooth">
                <AppIcon className="ri-user-line text-foreground-400"></AppIcon> My Profile
              </a>
              <a href="/profile/preferences" className="flex items-center gap-3 px-4 py-2.5 text-sm text-foreground-700 hover:bg-background-50 transition-smooth">
                <AppIcon className="ri-equalizer-line text-foreground-400"></AppIcon> Preferences
              </a>
              <div className="border-t border-background-100 my-1"></div>
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
function DropdownPanel({
  title,
  count,
  countLabel,
  viewAllHref,
  onMarkAllRead,
  children,
}: {
  title: string;
  count: number;
  countLabel: string;
  viewAllHref: string;
  onMarkAllRead?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute right-0 top-full z-50 mt-1.5 w-[min(20rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-background-200 bg-background-50 shadow-lg shadow-foreground-950/5">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-background-100">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground-900 font-heading">{title}</span>
          {count > 0 && (
            <span className="text-xs font-medium text-foreground-400 bg-background-100 px-1.5 py-0.5 rounded-full">
              {count} {countLabel}
            </span>
          )}
        </div>
        {onMarkAllRead && (
          <button onClick={onMarkAllRead} className="text-xs text-primary-600 hover:text-primary-700 font-medium cursor-pointer">
            Mark all read
          </button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto">
        {children}
      </div>
      <div className="px-4 py-2.5 border-t border-background-100 bg-background-50">
        <a href={viewAllHref} className="text-sm text-primary-600 hover:text-primary-700 font-medium">
          View all {title.toLowerCase()}
        </a>
      </div>
    </div>
  );
}
