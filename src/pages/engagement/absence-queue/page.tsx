import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface AbsenceReport {
  id: string;
  learner: string;
  programme: string;
  cohort: string;
  date: string;
  session: string;
  reason: string;
  reported: string;
  status: 'pending' | 'approved' | 'rejected' | 'unreported';
  risk: 'low' | 'medium' | 'high';
  coach: string;
  evidence: string | null;
  followUpRequired: boolean;
}

const ABSENCE_REPORTS: AbsenceReport[] = [
  { id: 'ab-01', learner: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort D', date: '5 Jun 2026', session: 'Data Visualisation', reason: 'Illness', reported: 'Late (2 days)', status: 'pending', risk: 'high', coach: 'Med Maher', evidence: null, followUpRequired: true },
  { id: 'ab-02', learner: 'Aisha Patel', programme: 'Accountancy L3', cohort: 'Cohort C', date: '1 Jun 2026', session: 'Taxation Module', reason: 'Annual leave', reported: 'On time', status: 'pending', risk: 'medium', coach: 'Med Maher', evidence: 'Leave approval email', followUpRequired: false },
  { id: 'ab-03', learner: 'Daniel Walsh', programme: 'Business Admin L3', cohort: 'Cohort A', date: '9 Jun 2026', session: 'Business Communication', reason: 'Not reported', reported: 'Not reported', status: 'unreported', risk: 'high', coach: 'Sarah Chen', evidence: null, followUpRequired: true },
  { id: 'ab-04', learner: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E', date: '7 Jun 2026', session: 'HR Policy Workshop', reason: 'IT issues', reported: 'Late (1 day)', status: 'pending', risk: 'medium', coach: 'James Harrington', evidence: 'IT support ticket', followUpRequired: false },
  { id: 'ab-05', learner: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C', date: '2 Jun 2026', session: 'Marketing Environment', reason: 'Work commitment', reported: 'On time', status: 'approved', risk: 'low', coach: 'Med Maher', evidence: 'Employer email', followUpRequired: false },
  { id: 'ab-06', learner: 'Liam Foster', programme: 'Project Manager L4', cohort: 'Cohort A', date: '28 May 2026', session: 'Project Planning', reason: 'Medical appointment', reported: 'On time', status: 'approved', risk: 'low', coach: 'Sarah Chen', evidence: 'Appointment card', followUpRequired: false },
  { id: 'ab-07', learner: 'David Chen', programme: 'Software Developer L4', cohort: 'Cohort F', date: '3 Jun 2026', session: 'Code Review', reason: 'Family emergency', reported: 'On time', status: 'approved', risk: 'low', coach: 'James Harrington', evidence: 'Emergency documentation', followUpRequired: true },
  { id: 'ab-08', learner: 'Oliver Grant', programme: 'Project Manager L4', cohort: 'Cohort A', date: '8 Jun 2026', session: 'Stakeholder Management', reason: 'Car breakdown', reported: 'Late (3 hours)', status: 'pending', risk: 'medium', coach: 'Sarah Chen', evidence: 'Garage receipt', followUpRequired: false },
];

export default function AbsenceQueuePage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'unreported'>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const filtered = statusFilter === 'all' ? ABSENCE_REPORTS : ABSENCE_REPORTS.filter(a => a.status === statusFilter);
  const pendingCount = ABSENCE_REPORTS.filter(a => a.status === 'pending').length;
  const unreportedCount = ABSENCE_REPORTS.filter(a => a.status === 'unreported').length;

  function toggleSelect(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
  }

  function toggleAll() {
    if (selected.length === filtered.length) {
      setSelected([]);
    } else {
      setSelected(filtered.map(a => a.id));
    }
  }

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Absence Reporting Queue" pageSubtitle="Review and process learner absence reports requiring follow-up action"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Absence Reporting Queue"
          description={`${pendingCount} reports pending review, ${unreportedCount} unreported absences. ${ABSENCE_REPORTS.length} total reports in the queue. Average processing time: 1.2 days.`}
          icon="ri-error-warning-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20office%20absence%20reporting%20queue%20management%20professional%20desk%20warm%20lighting%20modern%20workspace&width=400&height=160&seq=absence-queue-01&orientation=landscape"
          imageAlt="Absence Queue"
          stats={[{ label: 'Pending', value: String(pendingCount) }, { label: 'Unreported', value: String(unreportedCount), variant: 'danger' }, { label: 'Resolved', value: String(ABSENCE_REPORTS.filter(a => a.status === 'approved').length) }]}
        />

        {/* Related Pages Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/attendance-risk')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-alert-line text-sm"></i> Attendance Risk
          </button>
          <button onClick={() => navigate('/engagement/catchup-overdue')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-timer-line text-sm"></i> Catch-up Overdue
          </button>
          <button onClick={() => navigate('/engagement/call-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-phone-line text-sm"></i> Call Logs
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {(['all', 'pending', 'unreported', 'approved', 'rejected'] as const).map(f => (
            <button key={f} onClick={() => setStatusFilter(f)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${statusFilter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <i className={`${f === 'pending' ? 'ri-time-line' : f === 'unreported' ? 'ri-close-circle-line' : f === 'approved' ? 'ri-check-line' : f === 'rejected' ? 'ri-close-line' : 'ri-list-check'} text-sm`}></i>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'pending' && pendingCount > 0 && <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{pendingCount}</span>}
              {f === 'unreported' && unreportedCount > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{unreportedCount}</span>}
            </button>
          ))}
        </div>

        {/* Bulk Actions */}
        {selected.length > 0 && (
          <div className="flex items-center gap-2 bg-accent-50 rounded-lg border border-accent-100/50 p-3">
            <span className="text-[11px] text-accent-700 font-medium">{selected.length} selected</span>
            <div className="flex-1"></div>
            <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">Approve All</button>
            <button className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">Reject All</button>
            <button onClick={() => setSelected([])} className="px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Clear</button>
          </div>
        )}

        {/* Absence List */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
          <div className="p-4 border-b border-foreground-400/50 flex items-center gap-3">
            <input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleAll} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer" />
            <span className="text-sm font-heading font-semibold text-foreground-900">{filtered.length} reports</span>
          </div>
          <div className="divide-y divide-background-200/30">
            {filtered.map(report => (
              <div key={report.id} className={`p-4 flex items-center gap-4 ${report.risk === 'high' ? 'bg-red-50/20' : report.risk === 'medium' ? 'bg-amber-50/20' : ''}`}>
                <input type="checkbox" checked={selected.includes(report.id)} onChange={() => toggleSelect(report.id)} className="w-4 h-4 rounded border-background-300 accent-primary-500 cursor-pointer shrink-0" />
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${report.status === 'approved' ? 'bg-emerald-100 text-emerald-600' : report.status === 'unreported' ? 'bg-red-100 text-red-600' : report.status === 'rejected' ? 'bg-foreground-100 text-foreground-500' : 'bg-amber-100 text-amber-600'}`}>
                    <i className={`${report.status === 'approved' ? 'ri-check-line' : report.status === 'unreported' ? 'ri-close-circle-line' : report.status === 'rejected' ? 'ri-close-line' : 'ri-time-line'} text-sm`}></i>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900">{report.learner}</p>
                    <p className="text-[10px] text-foreground-400">{report.programme} &middot; {report.cohort} &middot; Coach: {report.coach}</p>
                    <p className="text-[10px] text-foreground-400 mt-0.5">{report.date} &mdash; {report.session}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                  <span className="text-foreground-400">Reason: <span className="text-foreground-700 font-medium">{report.reason}</span></span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${report.reported === 'Not reported' || report.reported.startsWith('Late') ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{report.reported}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${report.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : report.status === 'unreported' ? 'bg-red-100 text-red-700' : report.status === 'rejected' ? 'bg-foreground-100 text-foreground-500' : 'bg-amber-100 text-amber-700'}`}>{report.status}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${report.risk === 'high' ? 'bg-red-100 text-red-700' : report.risk === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{report.risk}</span>
                  {report.status === 'pending' && (
                    <>
                      <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">Approve</button>
                      <button className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-[10px] font-semibold hover:bg-red-700 transition-smooth cursor-pointer whitespace-nowrap">Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}