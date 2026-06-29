import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { useAuth } from '@/hooks/useAuth';
import { roleNavMap } from '@/mocks/navigation';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleTasks, type RoleTask } from '@/mocks/role-tasks';

const priorityConfig = {
  high: { color: 'bg-red-50 text-red-700 border-red-200/50', dot: 'bg-red-500' },
  medium: { color: 'bg-amber-50 text-amber-700 border-amber-200/50', dot: 'bg-amber-500' },
  low: { color: 'bg-emerald-50 text-emerald-700 border-emerald-200/50', dot: 'bg-emerald-500' },
};

const statusConfig = {
  pending: { label: 'Pending', icon: 'ri-time-line', color: 'text-foreground-500' },
  'in-progress': { label: 'In Progress', icon: 'ri-loader-4-line', color: 'text-primary-600' },
  completed: { label: 'Completed', icon: 'ri-check-double-line', color: 'text-emerald-600' },
};

const categoryIcons: Record<string, string> = {
  OTJH: 'ri-time-line',
  'Progress Review': 'ri-file-chart-line',
  Evidence: 'ri-folder-upload-line',
  ILR: 'ri-database-2-line',
  Compliance: 'ri-shield-check-line',
  QA: 'ri-search-eye-line',
  Gateway: 'ri-flag-line',
  Ofsted: 'ri-government-line',
  'AI Marking': 'ri-robot-line',
  Admin: 'ri-settings-3-line',
  Learning: 'ri-book-open-line',
  Assessment: 'ri-questionnaire-line',
  Coaching: 'ri-chat-smile-2-line',
  Marking: 'ri-edit-line',
  Resources: 'ri-folder-line',
  Feedback: 'ri-chat-3-line',
  Employer: 'ri-building-2-line',
  Meeting: 'ri-calendar-check-line',
  Review: 'ri-file-chart-line',
  Contracting: 'ri-file-text-line',
  Finance: 'ri-money-pound-circle-line',
  Audit: 'ri-history-line',
  Security: 'ri-shield-user-line',
  Permissions: 'ri-key-2-line',
  Automations: 'ri-settings-4-line',
  'At-Risk': 'ri-alert-line',
  Leadership: 'ri-award-line',
  Reports: 'ri-bar-chart-box-line',
  'Monthly Cycle': 'ri-loop-left-line',
  KSB: 'ri-bar-chart-2-line',
  Setup: 'ri-settings-3-line',
  Onboarding: 'ri-road-map-line',
  Eligibility: 'ri-checkbox-circle-line',
  'Funding Risk': 'ri-alert-line',
  RPL: 'ri-file-search-line',
  Signatures: 'ri-pen-nib-line',
  Sampling: 'ri-pie-chart-2-line',
  Dashboard: 'ri-dashboard-line',
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

export default function TasksPage() {
  const { auth } = useAuth();
  const role = auth.roles[0]?.slug || 'learner';
  const nav = roleNavMap[role] || roleNavMap.learner;
  const meta = getRoleMeta(role);
  const roleKey = getRoleKey(role);

  const initialTasks = roleTasks[roleKey] || roleTasks.default;
  const [items, setItems] = useState<RoleTask[]>(initialTasks);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [expandedTask, setExpandedTask] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const pendingCount = items.filter(t => t.status === 'pending').length;
  const inProgressCount = items.filter(t => t.status === 'in-progress').length;
  const completedCount = items.filter(t => t.status === 'completed').length;
  const highPriorityCount = items.filter(t => t.priority === 'high' && t.status !== 'completed').length;

  const filtered = items.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    if (searchQuery && !t.text.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const toggleStatus = (id: number) => {
    setItems(prev => prev.map(t => {
      if (t.id !== id) return t;
      const next: RoleTask['status'] = t.status === 'pending' ? 'in-progress' : t.status === 'in-progress' ? 'completed' : 'pending';
      return { ...t, status: next };
    }));
  };

  const deleteTask = (id: number) => {
    setItems(prev => prev.filter(t => t.id !== id));
  };

  return (
    <WorkspaceShell
      role={role}
      roleLabel={nav.label}
      navItems={nav.items}
      workspaceLabel={nav.workspaceLabel || 'Tasks'}
      pageTitle="Tasks"
      pageSubtitle="Your personal task list — manage work items, track progress, and meet deadlines"
      userName={meta.userName}
      userRole={meta.userRole}
    >
      <div className="min-h-[calc(100vh-56px)] bg-background-50 animate-in fade-in duration-500">
        {/* Hero Banner */}
        <div className="px-6 pt-4 pb-2">
          <WorkspaceHeroBanner
            title="My Tasks"
            description={`Your personal task list for the ${nav.label} workspace — track progress and stay on top of deadlines`}
            icon="ri-task-line"
            imageUrl="https://readdy.ai/api/search-image?query=Professional%20organised%20workspace%20desk%20with%20task%20checklist%20clipboard%20and%20modern%20laptop%2C%20clean%20minimalist%20office%20setting%2C%20warm%20neutral%20tones%2C%20editorial%20photography%20with%20soft%20natural%20lighting&width=400&height=160&seq=tasks-hero-role-01&orientation=landscape"
            imageAlt="Tasks"
            stats={[
              { label: 'Pending', value: String(pendingCount) },
              { label: 'In Progress', value: String(inProgressCount) },
              { label: 'Completed', value: String(completedCount) },
            ]}
          />
        </div>

        {/* Role indicator */}
        <div className="px-6 py-2 flex items-center gap-2">
          <div className="flex items-center gap-2 bg-primary-50 border border-primary-200/50 px-3 py-1.5 rounded-xl">
            <i className="ri-user-line text-primary-500 text-xs"></i>
            <span className="text-xs font-semibold text-primary-700">Tasks for {nav.label}</span>
          </div>
          <div className="flex items-center gap-2 bg-background-100 border border-foreground-200/60 px-3 py-1.5 rounded-xl">
            <i className="ri-lock-line text-foreground-400 text-xs"></i>
            <span className="text-xs text-foreground-500">Personal — visible only to you</span>
          </div>
        </div>

        {/* Stats + Filters */}
        <div className="px-6 py-4 border-b border-background-200/40 bg-background-50">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-foreground-700">All</span>
                <span className="text-[11px] font-semibold text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{items.length}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-foreground-400"></span>
                <span className="text-[13px] font-medium text-foreground-700">Pending</span>
                <span className="text-[11px] font-semibold text-white bg-foreground-500 px-2 py-0.5 rounded-full">{pendingCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary-500"></span>
                <span className="text-[13px] font-medium text-primary-700">In Progress</span>
                <span className="text-[11px] font-semibold text-white bg-primary-500 px-2 py-0.5 rounded-full">{inProgressCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span className="text-[13px] font-medium text-emerald-700">Completed</span>
                <span className="text-[11px] font-semibold text-white bg-emerald-500 px-2 py-0.5 rounded-full">{completedCount}</span>
              </div>
              {highPriorityCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="text-[13px] font-medium text-red-700">High Priority</span>
                  <span className="text-[11px] font-semibold text-white bg-red-500 px-2 py-0.5 rounded-full">{highPriorityCount}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-300"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search tasks..."
                  className="pl-9 pr-4 py-2 rounded-lg border border-foreground-200 bg-background-100/60 text-[13px] text-foreground-900 placeholder:text-foreground-300 outline-none focus:border-primary-400 w-56 transition-smooth"
                />
              </div>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-foreground-200 bg-background-100/60 text-foreground-700 outline-none focus:border-primary-400 cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="in-progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
              <select
                value={priorityFilter}
                onChange={e => setPriorityFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-foreground-200 bg-background-100/60 text-foreground-700 outline-none focus:border-primary-400 cursor-pointer"
              >
                <option value="all">All Priority</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>
        </div>

        {/* Tasks List */}
        <div className="px-6 py-4 max-w-4xl">
          {filtered.length === 0 ? (
            <div className="text-center py-16 animate-in fade-in duration-500">
              <div className="w-14 h-14 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-4">
                <i className="ri-task-line text-2xl text-foreground-300"></i>
              </div>
              <p className="text-sm text-foreground-500 font-medium">No tasks found</p>
              <p className="text-xs text-foreground-300 mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((t, i) => {
                const isExpanded = expandedTask === t.id;
                const priority = priorityConfig[t.priority];
                const status = statusConfig[t.status];
                return (
                  <div
                    key={t.id}
                    className={`group rounded-xl border transition-smooth overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300 ${
                      t.status === 'completed'
                        ? 'bg-background-50 border-background-200/30 opacity-60'
                        : t.priority === 'high'
                        ? 'bg-red-50/10 border-red-200/30 hover:border-red-300/40'
                        : 'bg-background-50 border-background-200/40 hover:border-background-300/60'
                    }`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="flex items-center gap-3 p-4">
                      <button
                        onClick={() => toggleStatus(t.id)}
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-smooth cursor-pointer shrink-0 ${
                          t.status === 'completed'
                            ? 'bg-emerald-500 border-emerald-500'
                            : t.status === 'in-progress'
                            ? 'bg-primary-500 border-primary-500'
                            : 'border-background-300 hover:border-primary-400'
                        }`}
                      >
                        {t.status === 'completed' && <i className="ri-check-line text-white text-[10px]"></i>}
                        {t.status === 'in-progress' && <i className="ri-loader-4-line text-white text-[10px] animate-spin"></i>}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${priority.color}`}>
                            {t.priority.charAt(0).toUpperCase() + t.priority.slice(1)}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500 border border-foreground-200/60">
                            <i className={`${categoryIcons[t.category] || 'ri-task-line'} text-[9px] mr-1`}></i>
                            {t.category}
                          </span>
                          <span className={`text-[10px] font-medium ${status.color}`}>
                            <i className={`${status.icon} text-[9px] mr-0.5`}></i>
                            {status.label}
                          </span>
                        </div>
                        <p className={`text-[14px] leading-snug ${t.status === 'completed' ? 'line-through text-foreground-400' : 'text-foreground-800 font-medium'}`}>
                          {t.text}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-2 text-[11px] text-foreground-400">
                          <i className="ri-calendar-line text-xs"></i>
                          {t.due}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center">
                            <span className="text-[10px] font-semibold text-primary-700">{t.assigneeAvatar}</span>
                          </div>
                          <span className="text-[11px] text-foreground-500 hidden sm:block">{t.assignee}</span>
                        </div>
                        <button
                          onClick={() => setExpandedTask(isExpanded ? null : t.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-300 hover:text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer"
                        >
                          <i className={`${isExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-sm`}></i>
                        </button>
                        <button
                          onClick={() => deleteTask(t.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground-300 hover:text-red-600 hover:bg-red-50 transition-smooth cursor-pointer opacity-0 group-hover:opacity-100"
                        >
                          <i className="ri-delete-bin-line text-sm"></i>
                        </button>
                      </div>
                    </div>

                    {isExpanded && t.description && (
                      <div className="px-4 pb-4 ml-8 animate-in fade-in duration-200">
                        <p className="text-[13px] text-foreground-600 leading-relaxed mb-2">{t.description}</p>
                        {t.relatedTo && (
                          <span className="text-[11px] text-foreground-400 bg-background-100 px-2 py-1 rounded-md border border-foreground-200/60">
                            Related: {t.relatedTo}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}