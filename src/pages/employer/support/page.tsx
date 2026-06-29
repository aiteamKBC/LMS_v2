import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const employerNav = roleNavMap.employer;

interface SupportRequest {
  id: string;
  title: string;
  category: string;
  priority: 'urgent' | 'high' | 'normal';
  status: 'open' | 'in-progress' | 'resolved';
  submittedDate: string;
  lastUpdate: string;
  assignedTo: string;
  description: string;
  relatedApprentice: string;
}

const SUPPORT_REQUESTS: SupportRequest[] = [
  { id: 'sr-01', title: 'OTJH recording process clarification', category: 'Funding & Compliance', priority: 'normal', status: 'open', submittedDate: '5 Jun 2026', lastUpdate: '5 Jun 2026', assignedTo: 'Med Maher (Coach)', description: 'Need clarification on how to properly record off-the-job training hours when an apprentice attends a company-wide training day that is partially relevant to their apprenticeship.', relatedApprentice: 'Sophie Williams' },
  { id: 'sr-02', title: 'Access issue — cannot view Tom Richards attendance records', category: 'Technical Support', priority: 'high', status: 'in-progress', submittedDate: '3 Jun 2026', lastUpdate: '6 Jun 2026', assignedTo: 'IT Support Team', description: 'When trying to view Tom\'s attendance records, the page shows a loading error. Other apprentices display correctly.', relatedApprentice: 'Tom Richards' },
  { id: 'sr-03', title: 'Request: Additional coaching support for Tom Richards', category: 'Learner Support', priority: 'high', status: 'open', submittedDate: '2 Jun 2026', lastUpdate: '2 Jun 2026', assignedTo: 'Med Maher (Coach)', description: 'Tom has been struggling with attendance and engagement. Requesting additional coaching check-ins and a joint meeting to discuss improvement strategies.', relatedApprentice: 'Tom Richards' },
  { id: 'sr-04', title: 'Gateway timeline query for Mark Jensen', category: 'Gateway & EPA', priority: 'normal', status: 'open', submittedDate: '1 Jun 2026', lastUpdate: '1 Jun 2026', assignedTo: 'EPA Coordinator', description: 'Mark is approaching gateway. Requesting a timeline review to understand the EPA process, expected dates and employer responsibilities.', relatedApprentice: 'Mark Jensen' },
  { id: 'sr-05', title: 'Workplace project approval for Daniel Clarke', category: 'Curriculum & Learning', priority: 'normal', status: 'resolved', submittedDate: '28 May 2026', lastUpdate: '2 Jun 2026', assignedTo: 'Med Maher (Coach)', description: 'Requesting approval for Daniel to use a real workplace project as part of his Business Communication module assessment.', relatedApprentice: 'Daniel Clarke' },
  { id: 'sr-06', title: 'Employer portal feedback and suggestions', category: 'Feedback', priority: 'normal', status: 'open', submittedDate: '30 May 2026', lastUpdate: '30 May 2026', assignedTo: 'Product Team', description: 'Suggestions for improving the employer dashboard: add a bulk OTJH confirmation feature and a calendar view for apprentice reviews.', relatedApprentice: '—' },
];

export default function EmployerSupportRequests() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');

  const filtered = SUPPORT_REQUESTS.filter(s => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && s.priority !== priorityFilter) return false;
    return true;
  });

  const open = SUPPORT_REQUESTS.filter(s => s.status === 'open').length;
  const inProgress = SUPPORT_REQUESTS.filter(s => s.status === 'in-progress').length;

  return (
    <WorkspaceShell role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel} pageTitle="Support Requests" pageSubtitle="Submit and track support requests, queries and feedback" userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-question-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Support Requests</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{SUPPORT_REQUESTS.length} requests</strong> · {open} open · {inProgress} in progress</p>
            </div>
            <button className="px-4 py-2.5 bg-white text-accent-700 rounded-lg text-[12px] font-semibold hover:bg-white/90 transition-smooth cursor-pointer whitespace-nowrap">
              <i className="ri-add-line mr-1"></i> New Request
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All' },{ key: 'open', label: 'Open' },{ key: 'in-progress', label: 'In Progress' },{ key: 'resolved', label: 'Resolved' }].map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {[{ key: 'all', label: 'All Priority' },{ key: 'urgent', label: 'Urgent' },{ key: 'high', label: 'High' },{ key: 'normal', label: 'Normal' }].map(f => (
              <button key={f.key} onClick={() => setPriorityFilter(f.key)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${priorityFilter === f.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f.label}</button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filtered.map(sr => (
            <div key={sr.id} className={`bg-background-50 rounded-xl border p-4 ${sr.priority === 'urgent' ? 'border-red-200/50 bg-red-50/10' : sr.status === 'open' ? 'border-foreground-200/60' : 'border-foreground-200/60'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-foreground-900">{sr.title}</h3>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sr.status === 'open' ? 'bg-amber-100 text-amber-700' : sr.status === 'in-progress' ? 'bg-primary-100 text-primary-700' : 'bg-emerald-100 text-emerald-700'}`}>{sr.status === 'open' ? 'Open' : sr.status === 'in-progress' ? 'In Progress' : 'Resolved'}</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${sr.priority === 'urgent' ? 'bg-red-100 text-red-700' : sr.priority === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-background-100 text-foreground-500'}`}>{sr.priority}</span>
                  </div>
                  <p className="text-[12px] text-foreground-500 mb-2">{sr.description}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-foreground-400">
                    <span className="font-medium px-2 py-0.5 rounded-full bg-background-100 text-foreground-500">{sr.category}</span>
                    {sr.relatedApprentice !== '—' && <span><i className="ri-user-line mr-0.5"></i> {sr.relatedApprentice}</span>}
                    <span><i className="ri-calendar-line mr-0.5"></i> {sr.submittedDate}</span>
                    <span><i className="ri-user-settings-line mr-0.5"></i> {sr.assignedTo}</span>
                  </div>
                </div>
                <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap shrink-0">
                  <i className="ri-eye-line mr-1"></i> View
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}