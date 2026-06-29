import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface ReviewAction {
  id: string;
  apprentice: string;
  initials: string;
  type: 'sign-review' | 'confirm-attendance' | 'validate-evidence' | 'schedule-meeting' | 'provide-feedback';
  title: string;
  description: string;
  dueDate: string;
  priority: 'urgent' | 'high' | 'normal';
  programme: string;
}

const REVIEW_ACTIONS: ReviewAction[] = [
  { id: 'ra-01', apprentice: 'Sophie Williams', initials: 'SW', type: 'sign-review', title: 'Sign May 2026 Monthly Progress Review', description: 'Monthly review covering initial modules and workplace integration. Employer sign-off required to confirm progress.', dueDate: '15 Jun 2026', priority: 'urgent', programme: 'Marketing Executive L4' },
  { id: 'ra-02', apprentice: 'Mark Jensen', initials: 'MJ', type: 'sign-review', title: 'Sign May 2026 Monthly Progress Review', description: 'Review covers Digital Channels module progress. Mark is approaching gateway — employer validation of KSB portfolio needed.', dueDate: '15 Jun 2026', priority: 'urgent', programme: 'Digital Marketer L3' },
  { id: 'ra-03', apprentice: 'Tom Richards', initials: 'TR', type: 'validate-evidence', title: 'Validate Campaign Research Evidence', description: 'Tom submitted research evidence for his seasonal menu campaign project. Employer validation required.', dueDate: '12 Jun 2026', priority: 'high', programme: 'Marketing Executive L4' },
  { id: 'ra-04', apprentice: 'Sophie Williams', initials: 'SW', type: 'validate-evidence', title: 'Validate Customer Persona Project', description: 'Workplace project evidence for Tim Hortons breakfast campaign. Employer confirmation of workplace authenticity needed.', dueDate: '14 Jun 2026', priority: 'high', programme: 'Marketing Executive L4' },
  { id: 'ra-05', apprentice: 'Daniel Clarke', initials: 'DC', type: 'schedule-meeting', title: 'Schedule Q3 Coaching Meeting', description: 'Quarterly coaching meeting with Med Maher to discuss Daniel\'s progress and upcoming gateway preparation.', dueDate: '20 Jun 2026', priority: 'normal', programme: 'Business Administrator L3' },
  { id: 'ra-06', apprentice: 'Mark Jensen', initials: 'MJ', type: 'provide-feedback', title: 'Provide Employer Feedback for Gateway', description: 'Complete employer reference and workplace feedback form as part of gateway readiness assessment.', dueDate: '25 Jun 2026', priority: 'high', programme: 'Digital Marketer L3' },
  { id: 'ra-07', apprentice: 'Lucy Barnes', initials: 'LB', type: 'confirm-attendance', title: 'Confirm Workplace Attendance for May', description: 'Confirm Lucy attended all scheduled workplace training sessions during May 2026.', dueDate: '18 Jun 2026', priority: 'normal', programme: 'HR Consultant L5' },
  { id: 'ra-08', apprentice: 'Tom Richards', initials: 'TR', type: 'schedule-meeting', title: 'Arrange Attendance Improvement Meeting', description: 'Coach has requested a joint meeting to discuss Tom\'s attendance concerns and agree an improvement plan.', dueDate: '16 Jun 2026', priority: 'high', programme: 'Marketing Executive L4' },
];

export default function EmployerReviewActions() {
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const filtered = REVIEW_ACTIONS.filter(a => {
    if (priorityFilter !== 'all' && a.priority !== priorityFilter) return false;
    if (typeFilter !== 'all' && a.type !== typeFilter) return false;
    return true;
  });

  const urgent = REVIEW_ACTIONS.filter(a => a.priority === 'urgent').length;
  const high = REVIEW_ACTIONS.filter(a => a.priority === 'high').length;

  const typeLabels: Record<string, string> = {
    'sign-review': 'Sign Review',
    'confirm-attendance': 'Confirm Attendance',
    'validate-evidence': 'Validate Evidence',
    'schedule-meeting': 'Schedule Meeting',
    'provide-feedback': 'Provide Feedback',
  };

  const typeIcons: Record<string, string> = {
    'sign-review': 'ri-pen-nib-line',
    'confirm-attendance': 'ri-calendar-check-line',
    'validate-evidence': 'ri-shield-check-line',
    'schedule-meeting': 'ri-calendar-schedule-line',
    'provide-feedback': 'ri-chat-1-line',
  };

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Review Actions" pageSubtitle="Actions requiring your review, sign-off, or feedback" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-file-chart-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Review Actions</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{REVIEW_ACTIONS.length} actions</strong> · {urgent} urgent · {high} high priority
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-red-200">{urgent}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Urgent</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-amber-200">{high}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">High</p>
              </div>
            </div>
          </div>
        </div>

        {urgent > 0 && (
          <div className="bg-red-50 border border-red-200/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0"><i className="ri-alert-line text-red-600 text-base"></i></span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-800">{urgent} urgent actions need your attention</p>
              <p className="text-[12px] text-red-600 mt-0.5">Overdue or approaching deadline — complete these as soon as possible</p>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' },{ key: 'urgent', label: 'Urgent' },{ key: 'high', label: 'High' },{ key: 'normal', label: 'Normal' }].map(f => (
              <button key={f.key} onClick={() => setPriorityFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${priorityFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 flex-wrap">
            {[{ key: 'all', label: 'All Types' },{ key: 'sign-review', label: 'Sign' },{ key: 'validate-evidence', label: 'Validate' },{ key: 'confirm-attendance', label: 'Confirm' },{ key: 'schedule-meeting', label: 'Schedule' },{ key: 'provide-feedback', label: 'Feedback' }].map(f => (
              <button key={f.key} onClick={() => setTypeFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${typeFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {filtered.map(action => (
            <div key={action.id} className={`bg-background-50 rounded-xl border p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${action.priority === 'urgent' ? 'border-red-200/50 bg-red-50/10' : action.priority === 'high' ? 'border-amber-200/50 bg-amber-50/10' : 'border-foreground-200/60'}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${action.priority === 'urgent' ? 'bg-red-100 text-red-600' : action.priority === 'high' ? 'bg-amber-100 text-amber-600' : 'bg-background-100 text-foreground-400'}`}>
                <i className={`${typeIcons[action.type]} text-sm`}></i>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <p className="text-sm font-semibold text-foreground-900">{action.title}</p>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${action.priority === 'urgent' ? 'bg-red-100 text-red-700' : action.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-background-100 text-foreground-500'}`}>{action.priority}</span>
                </div>
                <p className="text-[12px] text-foreground-500 mb-1">{action.description}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-400">
                  <span className="font-medium text-foreground-600">{action.apprentice}</span>
                  <span>{action.programme}</span>
                  <span className="flex items-center gap-1"><i className="ri-calendar-line text-[10px]"></i> Due: {action.dueDate}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{typeLabels[action.type]}</span>
                <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                  <i className="ri-check-line mr-1"></i> {action.type === 'sign-review' ? 'Review' : action.type === 'validate-evidence' ? 'Validate' : action.type === 'confirm-attendance' ? 'Confirm' : action.type === 'schedule-meeting' ? 'Schedule' : 'Respond'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}