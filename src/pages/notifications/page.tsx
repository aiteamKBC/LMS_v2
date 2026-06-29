import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNotifications, type RoleNotification } from '@/mocks/role-notifications';

const typeColors: Record<string, string> = {
  otjh: 'bg-primary-50 text-primary-700 border-primary-200/50',
  assessment: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  review: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  module: 'bg-amber-50 text-amber-700 border-amber-200/50',
  qa: 'bg-accent-50 text-accent-700 border-accent-200/50',
  evidence: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  meeting: 'bg-primary-50 text-primary-700 border-primary-200/50',
  gateway: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  finance: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  employer: 'bg-accent-50 text-accent-700 border-accent-200/50',
  data: 'bg-foreground-50 text-foreground-700 border-foreground-200/50',
  reward: 'bg-accent-50 text-accent-700 border-accent-200/50',
  security: 'bg-red-50 text-red-700 border-red-200/50',
  compliance: 'bg-primary-50 text-primary-700 border-primary-200/50',
  tenant: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  automation: 'bg-accent-50 text-accent-700 border-accent-200/50',
  curriculum: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  users: 'bg-primary-50 text-primary-700 border-primary-200/50',
  system: 'bg-foreground-50 text-foreground-600 border-foreground-200/50',
  marking: 'bg-accent-50 text-accent-700 border-accent-200/50',
  attendance: 'bg-amber-50 text-amber-700 border-amber-200/50',
  message: 'bg-primary-50 text-primary-700 border-primary-200/50',
  assignment: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  cycle: 'bg-primary-50 text-primary-700 border-primary-200/50',
  ksb: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  resource: 'bg-accent-50 text-accent-700 border-accent-200/50',
  quiz: 'bg-amber-50 text-amber-700 border-amber-200/50',
  session: 'bg-primary-50 text-primary-700 border-primary-200/50',
  otjh_confirm: 'bg-primary-50 text-primary-700 border-primary-200/50',
  community: 'bg-accent-50 text-accent-700 border-accent-200/50',
  event: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  signature: 'bg-accent-50 text-accent-700 border-accent-200/50',
  rpl: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
  risk: 'bg-red-50 text-red-700 border-red-200/50',
  sync: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
  ofsted: 'bg-red-50 text-red-700 border-red-200/50',
  sampling: 'bg-accent-50 text-accent-700 border-accent-200/50',
  dashboard: 'bg-primary-50 text-primary-700 border-primary-200/50',
  eligibility: 'bg-secondary-50 text-secondary-700 border-secondary-200/50',
};

const typeIcons: Record<string, string> = {
  otjh: 'ri-time-line',
  assessment: 'ri-questionnaire-line',
  review: 'ri-file-chart-line',
  module: 'ri-stack-line',
  qa: 'ri-shield-check-line',
  evidence: 'ri-folder-upload-line',
  meeting: 'ri-calendar-check-line',
  gateway: 'ri-flag-line',
  finance: 'ri-money-pound-circle-line',
  employer: 'ri-building-line',
  data: 'ri-database-2-line',
  reward: 'ri-trophy-line',
  security: 'ri-shield-user-line',
  compliance: 'ri-shield-check-line',
  tenant: 'ri-building-4-line',
  automation: 'ri-settings-4-line',
  curriculum: 'ri-stack-line',
  users: 'ri-user-settings-line',
  system: 'ri-settings-3-line',
  marking: 'ri-edit-line',
  attendance: 'ri-calendar-check-line',
  message: 'ri-mail-line',
  assignment: 'ri-user-add-line',
  cycle: 'ri-loop-left-line',
  ksb: 'ri-bar-chart-2-line',
  resource: 'ri-folder-line',
  quiz: 'ri-questionnaire-line',
  session: 'ri-presentation-line',
  community: 'ri-team-line',
  event: 'ri-calendar-event-line',
  signature: 'ri-pen-nib-line',
  rpl: 'ri-file-search-line',
  risk: 'ri-alert-line',
  sync: 'ri-refresh-line',
  ofsted: 'ri-government-line',
  sampling: 'ri-pie-chart-2-line',
  dashboard: 'ri-dashboard-line',
  eligibility: 'ri-checkbox-circle-line',
};

function getRoleKey(slug: string): string {
  const known = ['learner', 'coach', 'admin', 'tutor', 'employer', 'compliance', 'qa', 'leadership', 'mis', 'finance', 'auditor'];
  return known.includes(slug) ? slug : 'default';
}

const getRoleMeta = (role: string): { userName: string; userRole: string } => {
  const metas: Record<string, { userName: string; userRole: string }> = {
    coach: { userName: 'Med Maher', userRole: 'Progress Coach' },
    learner: { userName: 'Sarah Mitchell', userRole: 'Marketing Executive L4 Apprentice' },
    tutor: { userName: 'Crispin Jones', userRole: 'Tutor' },
    compliance: { userName: 'Rebecca Holmes', userRole: 'Compliance Officer' },
    mis: { userName: 'Priya Sharma', userRole: 'MIS Operations Lead' },
    qa: { userName: 'Tom Bradley', userRole: 'QA Officer' },
    leadership: { userName: 'Dr. Karen Ashby', userRole: 'Principal / CEO' },
    admin: { userName: 'Alex Carter', userRole: 'System Administrator' },
    employer: { userName: 'Lauren Mitchell', userRole: 'Line Manager' },
    curriculum: { userName: 'Rachel Myers', userRole: 'Curriculum Designer' },
    engagement: { userName: 'Rebecca Holmes', userRole: 'Engagement Manager' },
    finance: { userName: 'Lisa Nguyen', userRole: 'Finance Officer' },
    auditor: { userName: 'Tom Bradley', userRole: 'QA & Audit Director' },
  };
  return metas[role] || { userName: 'User', userRole: 'Team Member' };
};

export default function NotificationsPage() {
  const { auth } = useAuth();
  const role = auth.roles[0]?.slug || 'learner';
  const nav = roleNavMap[role] || roleNavMap.learner;
  const meta = getRoleMeta(role);
  const roleKey = getRoleKey(role);

  const initialNotifs = roleNotifications[roleKey] || roleNotifications.default;
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [items, setItems] = useState<RoleNotification[]>(initialNotifs);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

  const unreadCount = items.filter(n => n.unread).length;
  const readCount = items.filter(n => !n.unread).length;

  const filtered = activeFilter === 'all'
    ? items
    : activeFilter === 'unread'
    ? items.filter(n => n.unread)
    : items.filter(n => !n.unread);

  const markAsRead = (id: number) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, unread: false } : n));
  };

  const markAllAsRead = () => {
    setItems(prev => prev.map(n => ({ ...n, unread: false })));
  };

  const deleteNotification = (id: number) => {
    setItems(prev => prev.filter(n => n.id !== id));
  };

  const toggleSelect = (id: number) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkMarkAsRead = () => {
    setItems(prev => prev.map(n => selectedItems.has(n.id) ? { ...n, unread: false } : n));
    setSelectedItems(new Set());
  };

  const bulkDelete = () => {
    setItems(prev => prev.filter(n => !selectedItems.has(n.id)));
    setSelectedItems(new Set());
  };

  return (
    <WorkspaceShell
      role={role}
      roleLabel={nav.label}
      navItems={nav.items}
      workspaceLabel={nav.workspaceLabel || 'Notifications'}
      pageTitle="Notifications"
      pageSubtitle="Stay updated with your latest activity, alerts, and system messages"
      userName={meta.userName}
      userRole={meta.userRole}
    >
      <div className="min-h-[calc(100vh-56px)] bg-background-50 animate-in fade-in duration-500">
        {/* Hero Banner */}
        <div className="px-6 pt-4 pb-2">
          <WorkspaceHeroBanner
            title="Notifications"
            description="Stay updated with your latest activity, alerts, and system messages"
            icon="ri-notification-3-line"
            imageUrl="https://readdy.ai/api/search-image?query=Professional%20notification%20alert%20system%20dashboard%20with%20clean%20minimal%20interface%2C%20warm%20neutral%20workspace%20background%2C%20modern%20editorial%20photography%20with%20soft%20focused%20lighting&width=400&height=160&seq=notifications-hero-role-01&orientation=landscape"
            imageAlt="Notifications"
            stats={[
              { label: 'Total', value: String(items.length) },
              { label: 'Unread', value: String(unreadCount) },
              { label: 'Read', value: String(readCount) },
            ]}
          />
        </div>

        {/* Role indicator */}
        <div className="px-6 py-2 flex items-center gap-2">
          <div className="flex items-center gap-2 bg-primary-50 border border-primary-200/50 px-3 py-1.5 rounded-xl">
            <i className="ri-user-line text-primary-500 text-xs"></i>
            <span className="text-xs font-semibold text-primary-700">Notifications for {nav.label}</span>
          </div>
          <div className="flex items-center gap-2 bg-background-100 border border-foreground-200/60 px-3 py-1.5 rounded-xl">
            <i className="ri-lock-line text-foreground-400 text-xs"></i>
            <span className="text-xs text-foreground-500">Personal — visible only to you</span>
          </div>
        </div>

        {/* Stats + Filters */}
        <div className="px-6 py-4 border-b border-background-200/40 bg-background-50">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground-700">All</span>
              <span className="text-[11px] font-semibold text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{items.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-primary-700">Unread</span>
              <span className="text-[11px] font-semibold text-white bg-primary-500 px-2 py-0.5 rounded-full">{unreadCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground-700">Read</span>
              <span className="text-[11px] font-semibold text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{readCount}</span>
            </div>
            <div className="w-px h-4 bg-background-300/60"></div>
            <div className="flex items-center gap-1.5">
              {['all', 'unread', 'read'].map(f => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-[12px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${
                    activeFilter === f
                      ? 'bg-primary-500 text-white'
                      : 'bg-background-100 text-foreground-500 hover:bg-background-200'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : 'Read'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Bulk Actions + Header */}
        <div className="px-6 py-3 border-b border-background-200/40 bg-background-50 flex items-center justify-between">
          <h2 className="text-base font-heading font-semibold text-foreground-900">All Notifications</h2>
          <div className="flex items-center gap-2">
            {selectedItems.size > 0 && (
              <>
                <button
                  onClick={bulkMarkAsRead}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200/50 transition-smooth cursor-pointer"
                >
                  <i className="ri-check-double-line text-xs"></i>
                  Mark read
                </button>
                <button
                  onClick={bulkDelete}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-red-700 bg-red-50 hover:bg-red-100 border border-red-200/50 transition-smooth cursor-pointer"
                >
                  <i className="ri-delete-bin-line text-xs"></i>
                  Delete
                </button>
              </>
            )}
            <button
              onClick={markAllAsRead}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-foreground-700 bg-background-100 hover:bg-background-200 border border-foreground-200/60 transition-smooth cursor-pointer"
            >
              <i className="ri-check-double-line text-xs"></i>
              Mark all as read
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="px-6 py-4 max-w-4xl">
          {filtered.length === 0 ? (
            <div className="text-center py-16 animate-in fade-in duration-500">
              <div className="w-14 h-14 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-4">
                <i className="ri-notification-off-line text-2xl text-foreground-300"></i>
              </div>
              <p className="text-sm text-foreground-500 font-medium">No notifications</p>
              <p className="text-xs text-foreground-300 mt-1">You are all caught up!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((n, i) => (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 p-4 rounded-xl border transition-smooth animate-in fade-in slide-in-from-bottom-2 duration-300 ${
                    n.unread
                      ? 'bg-primary-50/30 border-primary-200/40 hover:bg-primary-50/50'
                      : 'bg-background-50 border-background-200/40 hover:bg-background-100/50'
                  }`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div className="pt-0.5">
                    <input
                      type="checkbox"
                      checked={selectedItems.has(n.id)}
                      onChange={() => toggleSelect(n.id)}
                      className="w-4 h-4 rounded border-background-300 text-primary-500 focus:ring-primary-400 cursor-pointer"
                    />
                  </div>

                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${n.unread ? 'bg-primary-500' : 'bg-transparent'}`}></div>

                  <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-background-100">
                    <i className={`${typeIcons[n.type] || 'ri-notification-3-line'} text-sm text-foreground-400`}></i>
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${typeColors[n.type] || 'bg-background-100 text-foreground-500 border-background-200'}`}>
                        {n.category}
                      </span>
                      <span className="text-[11px] text-foreground-300">{n.time}</span>
                    </div>
                    <p className={`text-[14px] leading-relaxed ${n.unread ? 'text-foreground-900 font-medium' : 'text-foreground-600'}`}>
                      {n.text}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-smooth shrink-0">
                    {n.unread && (
                      <button
                        onClick={() => markAsRead(n.id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-400 hover:text-primary-600 hover:bg-primary-50 transition-smooth cursor-pointer"
                        title="Mark as read"
                      >
                        <i className="ri-check-line text-sm"></i>
                      </button>
                    )}
                    <button
                      onClick={() => deleteNotification(n.id)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-400 hover:text-red-600 hover:bg-red-50 transition-smooth cursor-pointer"
                      title="Delete"
                    >
                      <i className="ri-delete-bin-line text-sm"></i>
                    </button>
                    {n.link && (
                      <a
                        href={n.link}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-400 hover:text-foreground-700 hover:bg-background-100 transition-smooth cursor-pointer"
                        title="Go to"
                      >
                        <i className="ri-arrow-right-line text-sm"></i>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}