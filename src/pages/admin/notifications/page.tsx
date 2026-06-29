import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const adminNav = roleNavMap.admin;

const NOTIFICATIONS_DATA = [
  { id: 'n1', name: 'New Evidence Submitted', channel: 'In-app', recipients: 'Coach, Tutor', sent: 210, openRate: 78, status: 'active' as const, category: 'Evidence' },
  { id: 'n2', name: 'Monthly Coaching Due', channel: 'Email + In-app', recipients: 'Coach, Learner', sent: 86, openRate: 92, status: 'active' as const, category: 'Coaching' },
  { id: 'n3', name: 'Progress Review Signed', channel: 'Email', recipients: 'Learner, Employer', sent: 42, openRate: 85, status: 'active' as const, category: 'Reviews' },
  { id: 'n4', name: 'Absence Reported', channel: 'In-app + WhatsApp', recipients: 'Coach, Engagement', sent: 34, openRate: 95, status: 'active' as const, category: 'Attendance' },
  { id: 'n5', name: 'OTJH Claim Validated', channel: 'Email', recipients: 'Learner', sent: 156, openRate: 72, status: 'active' as const, category: 'OTJH' },
  { id: 'n6', name: 'KSB Status Change', channel: 'In-app', recipients: 'Learner, Coach', sent: 67, openRate: 65, status: 'active' as const, category: 'KSB' },
  { id: 'n7', name: 'Gateway Milestone', channel: 'Email + In-app', recipients: 'Learner, Coach, Employer', sent: 12, openRate: 88, status: 'active' as const, category: 'Gateway' },
  { id: 'n8', name: 'New Course Content', channel: 'In-app', recipients: 'Learner', sent: 340, openRate: 45, status: 'active' as const, category: 'Learning' },
  { id: 'n9', name: 'Employer Action Required', channel: 'Email', recipients: 'Employer', sent: 28, openRate: 80, status: 'active' as const, category: 'Employer' },
  { id: 'n10', name: 'System Maintenance', channel: 'Email + In-app', recipients: 'All Users', sent: 2, openRate: 60, status: 'active' as const, category: 'System' },
];

export default function AdminNotificationsPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [selectedNotification, setSelectedNotification] = useState<string | null>(null);

  const activeCount = NOTIFICATIONS_DATA.filter(n => n.status === 'active').length;
  const totalSent = NOTIFICATIONS_DATA.reduce((a, b) => a + b.sent, 0);
  const avgOpenRate = Math.round(NOTIFICATIONS_DATA.reduce((a, b) => a + b.openRate, 0) / NOTIFICATIONS_DATA.length);

  const filtered = NOTIFICATIONS_DATA.filter(n => {
    const matchSearch = n.name.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || n.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const notif = selectedNotification ? NOTIFICATIONS_DATA.find(n => n.id === selectedNotification) : null;

  return (
    <WorkspaceShell role="admin" roleLabel={adminNav.label} navItems={adminNav.items} workspaceLabel={adminNav.workspaceLabel} pageTitle="Notifications" pageSubtitle="Notification rules, channels, delivery metrics" userName="Admin User" userRole="Tenant Administrator">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-notification-3-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Notification Centre</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{NOTIFICATIONS_DATA.length} rules</strong> — {activeCount} active. {totalSent} notifications sent. {avgOpenRate}% avg open rate.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{NOTIFICATIONS_DATA.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Rules</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{totalSent}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Sent</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgOpenRate}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Open Rate</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center gap-3">
          <div className="relative flex-1 w-full lg:w-auto">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-300 text-sm"></i>
            <input type="text" placeholder="Search notifications..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 placeholder:text-foreground-300 focus:border-primary-400 outline-none transition-smooth" />
          </div>
          <div className="flex items-center gap-2">
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-background-200 bg-background-50 text-sm text-foreground-900 outline-none focus:border-primary-400 transition-smooth cursor-pointer">
              <option value="all">All Categories</option>
              <option value="Evidence">Evidence</option>
              <option value="Coaching">Coaching</option>
              <option value="Reviews">Reviews</option>
              <option value="Attendance">Attendance</option>
              <option value="OTJH">OTJH</option>
              <option value="KSB">KSB</option>
              <option value="Gateway">Gateway</option>
              <option value="Learning">Learning</option>
              <option value="Employer">Employer</option>
              <option value="System">System</option>
            </select>
            <button className="px-4 py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1.5"></i> New Rule
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Notifications List */}
          <div className="lg:col-span-2 space-y-3">
            {filtered.map(n => {
              const statusColors = {
                active: 'bg-emerald-50 text-emerald-700 border-emerald-200/50',
                paused: 'bg-accent-50 text-accent-700 border-accent-200/50',
                draft: 'bg-background-100 text-foreground-500 border-foreground-200/60',
              };
              return (
                <div key={n.id} onClick={() => setSelectedNotification(n.id)} className={`flex items-center gap-4 bg-background-50 rounded-xl border p-4 cursor-pointer transition-smooth ${selectedNotification === n.id ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60 hover:border-background-300/60'}`}>
                  <div className="w-10 h-10 rounded-lg bg-secondary-100 flex items-center justify-center shrink-0">
                    <i className="ri-notification-3-line text-secondary-600 text-sm"></i>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{n.name}</p>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700 border border-secondary-200/50">{n.category}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColors[n.status]}`}>{n.status}</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{n.channel} · {n.recipients}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-foreground-500 shrink-0">
                    <span><i className="ri-send-plane-line mr-1"></i>{n.sent}</span>
                    <div className="flex items-center gap-1">
                      <div className="w-10 h-1.5 bg-background-200 rounded-full overflow-hidden">
                        <div className="h-full bg-accent-500 rounded-full" style={{ width: `${n.openRate}%` }}></div>
                      </div>
                      <span className="text-[10px]">{n.openRate}%</span>
                    </div>
                  </div>
                  <i className={`ri-arrow-right-s-line text-foreground-300 ${selectedNotification === n.id ? 'text-primary-500' : ''}`}></i>
                </div>
              );
            })}
          </div>

          {/* Notification Detail */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 h-fit">
            {notif ? (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">{notif.name}</h3>
                  <p className="text-[12px] text-foreground-500 mt-1">{notif.category} · {notif.channel}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{notif.sent}</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Sent</p>
                  </div>
                  <div className="bg-background-100 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-foreground-900">{notif.openRate}%</p>
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wide">Open Rate</p>
                  </div>
                </div>
                <div className="space-y-2 pt-2 border-t border-foreground-200/60">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Recipients</span>
                    <span className="text-foreground-700 font-medium">{notif.recipients}</span>
                  </div>
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-foreground-500">Status</span>
                    <span className="text-foreground-700 font-medium capitalize">{notif.status}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Edit Rule</button>
                  <button className="flex-1 px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-200 transition-smooth cursor-pointer whitespace-nowrap">Test Send</button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-3">
                  <i className="ri-notification-3-line text-foreground-300 text-xl"></i>
                </div>
                <p className="text-sm text-foreground-500">Select a notification rule to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}