import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface CatchupItem {
  id: string;
  learner: string;
  programme: string;
  cohort: string;
  coach: string;
  missedSessions: string[];
  totalHours: number;
  overdueDays: number;
  reason: string;
  scheduledDate: string | null;
  status: 'overdue' | 'scheduled' | 'completed';
  priority: 'urgent' | 'high' | 'normal';
  lastContact: string;
}

const CATCHUP_DATA: CatchupItem[] = [
  { id: 'cu-01', learner: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort D', coach: 'Med Maher', missedSessions: ['Data Visualisation', 'SQL Basics', 'Analytics Workshop'], totalHours: 6, overdueDays: 12, reason: 'Multiple absences', scheduledDate: null, status: 'overdue', priority: 'urgent', lastContact: '5 days ago' },
  { id: 'cu-02', learner: 'Daniel Walsh', programme: 'Business Admin L3', cohort: 'Cohort A', coach: 'Sarah Chen', missedSessions: ['Business Communication', 'Admin Skills'], totalHours: 4, overdueDays: 8, reason: 'Attendance issues', scheduledDate: null, status: 'overdue', priority: 'urgent', lastContact: '3 days ago' },
  { id: 'cu-03', learner: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E', coach: 'James Harrington', missedSessions: ['HR Policy Workshop'], totalHours: 2, overdueDays: 5, reason: 'IT issues', scheduledDate: '14 Jun 2026', status: 'scheduled', priority: 'high', lastContact: '1 day ago' },
  { id: 'cu-04', learner: 'Aisha Patel', programme: 'Accountancy L3', cohort: 'Cohort C', coach: 'Med Maher', missedSessions: ['Taxation Module', 'Accounting Basics'], totalHours: 5, overdueDays: 7, reason: 'Annual leave', scheduledDate: '15 Jun 2026', status: 'scheduled', priority: 'high', lastContact: '2 days ago' },
  { id: 'cu-05', learner: 'Oliver Grant', programme: 'Project Manager L4', cohort: 'Cohort A', coach: 'Sarah Chen', missedSessions: ['Stakeholder Management'], totalHours: 2, overdueDays: 3, reason: 'Car breakdown', scheduledDate: '12 Jun 2026', status: 'scheduled', priority: 'normal', lastContact: 'Yesterday' },
  { id: 'cu-06', learner: 'Priya Sharma', programme: 'Digital Marketer L3', cohort: 'Cohort B', coach: 'Med Maher', missedSessions: ['SEO Workshop', 'Content Strategy'], totalHours: 4, overdueDays: 6, reason: 'Missed sessions', scheduledDate: null, status: 'overdue', priority: 'high', lastContact: '4 days ago' },
  { id: 'cu-07', learner: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C', coach: 'Med Maher', missedSessions: ['Marketing Environment'], totalHours: 2, overdueDays: 2, reason: 'Work commitment', scheduledDate: '11 Jun 2026', status: 'scheduled', priority: 'normal', lastContact: 'Today' },
  { id: 'cu-08', learner: 'Lucas Nguyen', programme: 'Software Developer L4', cohort: 'Cohort F', coach: 'James Harrington', missedSessions: ['Code Review', 'Agile Workshop'], totalHours: 3, overdueDays: 4, reason: 'Sick leave', scheduledDate: '13 Jun 2026', status: 'scheduled', priority: 'normal', lastContact: '1 day ago' },
  { id: 'cu-09', learner: 'Emma Clarke', programme: 'HR Consultant L5', cohort: 'Cohort E', coach: 'James Harrington', missedSessions: ['Employment Law'], totalHours: 2, overdueDays: 10, reason: 'No show', scheduledDate: null, status: 'overdue', priority: 'urgent', lastContact: '6 days ago' },
];

export default function CatchupOverduePage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'all' | 'overdue' | 'scheduled' | 'completed'>('all');
  const filtered = statusFilter === 'all' ? CATCHUP_DATA : CATCHUP_DATA.filter(c => c.status === statusFilter);
  const overdueCount = CATCHUP_DATA.filter(c => c.status === 'overdue').length;
  const scheduledCount = CATCHUP_DATA.filter(c => c.status === 'scheduled').length;
  const totalHours = CATCHUP_DATA.reduce((s, c) => s + c.totalHours, 0);

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Catch-up Overdue" pageSubtitle="Monitor overdue catch-up sessions and send automated reminders to learners"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Catch-up Overdue Tracking"
          description={`${overdueCount} learners overdue for catch-up, ${scheduledCount} scheduled. ${totalHours} total hours need to be recovered. Average overdue: ${Math.round(CATCHUP_DATA.reduce((s, c) => s + c.overdueDays, 0) / CATCHUP_DATA.length)} days.`}
          icon="ri-timer-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20professional%20catchup%20session%20learning%20schedule%20calendar%20modern%20office%20warm%20lighting&width=400&height=160&seq=catchup-01&orientation=landscape"
          imageAlt="Catch-up Overdue"
          stats={[{ label: 'Overdue', value: String(overdueCount), variant: 'danger' }, { label: 'Scheduled', value: String(scheduledCount) }, { label: 'Hours', value: String(totalHours) }]}
        />

        {/* Related Pages Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/attendance-risk')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-alert-line text-sm"></i> Attendance Risk
          </button>
          <button onClick={() => navigate('/engagement/absence-queue')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-error-warning-line text-sm"></i> Absence Queue
          </button>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {(['all', 'overdue', 'scheduled', 'completed'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <i className={`${f === 'overdue' ? 'ri-time-line' : f === 'scheduled' ? 'ri-calendar-check-line' : f === 'completed' ? 'ri-check-double-line' : 'ri-list-check'} text-sm`}></i>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'overdue' && overdueCount > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{overdueCount}</span>}
            </button>
          ))}
        </div>

        {/* Catch-up List */}
        <div className="space-y-3">
          {filtered.map(item => (
            <div key={item.id} className={`bg-background-50 rounded-xl border p-4 card-premium ${item.status === 'overdue' ? 'border-red-200/50' : item.status === 'scheduled' ? 'border-primary-200/50' : 'border-emerald-200/50'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${item.priority === 'urgent' ? 'bg-red-100 text-red-700' : item.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{item.learner.charAt(0)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground-900">{item.learner}</p>
                    <p className="text-[10px] text-foreground-400">{item.programme} &middot; {item.cohort} &middot; Coach: {item.coach}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                  <span className="text-foreground-400">{item.totalHours}h missed</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${item.overdueDays >= 10 ? 'bg-red-100 text-red-700' : item.overdueDays >= 5 ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{item.overdueDays} days overdue</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${item.status === 'overdue' ? 'bg-red-100 text-red-700' : item.status === 'scheduled' ? 'bg-primary-100 text-primary-700' : 'bg-emerald-100 text-emerald-700'}`}>{item.status}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${item.priority === 'urgent' ? 'bg-red-100 text-red-700' : item.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{item.priority}</span>
                </div>
              </div>
              <div className="mt-3 bg-background-100/50 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <i className="ri-information-line text-foreground-400 text-sm mt-0.5"></i>
                  <div className="flex-1">
                    <p className="text-[11px] text-foreground-600"><strong className="text-foreground-800">Reason:</strong> {item.reason}</p>
                    <p className="text-[10px] text-foreground-400 mt-0.5">Missed: {item.missedSessions.join(', ')}</p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-foreground-400">Last contact: {item.lastContact}</span>
                      {item.scheduledDate && <span className="text-[10px] text-primary-600 font-medium">Scheduled: {item.scheduledDate}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'overdue' && (
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                        <i className="ri-calendar-line mr-1"></i> Schedule
                      </button>
                    )}
                    <button className="px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <i className="ri-notification-3-line mr-1"></i> Remind
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}