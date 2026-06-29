import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const engagementNav = roleNavMap.engagement;

interface AttendanceRisk {
  id: string;
  name: string;
  programme: string;
  cohort: string;
  coach: string;
  attendanceRate: number;
  sessionsMissed: number;
  totalSessions: number;
  consecutiveMissed: number;
  lastAttendance: string;
  riskLevel: 'critical' | 'high' | 'medium';
  trend: 'deteriorating' | 'declining' | 'stable' | 'improving';
  action: string;
  employerNotified: boolean;
  interventionDate: string | null;
}

const RISK_DATA: AttendanceRisk[] = [
  { id: 'ar-01', name: 'James Okonkwo', programme: 'Data Analyst L4', cohort: 'Cohort D', coach: 'Med Maher', attendanceRate: 68, sessionsMissed: 12, totalSessions: 20, consecutiveMissed: 4, lastAttendance: 'Missed 5 Jun', riskLevel: 'critical', trend: 'deteriorating', action: 'Immediate intervention call + employer notification', employerNotified: true, interventionDate: '9 Jun 2026' },
  { id: 'ar-02', name: 'Daniel Walsh', programme: 'Business Admin L3', cohort: 'Cohort A', coach: 'Sarah Chen', attendanceRate: 72, sessionsMissed: 10, totalSessions: 20, consecutiveMissed: 3, lastAttendance: 'Missed 9 Jun', riskLevel: 'critical', trend: 'deteriorating', action: 'Schedule catch-up session + wellbeing check', employerNotified: true, interventionDate: '10 Jun 2026' },
  { id: 'ar-03', name: 'Aisha Patel', programme: 'Accountancy L3', cohort: 'Cohort C', coach: 'Med Maher', attendanceRate: 83, sessionsMissed: 6, totalSessions: 20, consecutiveMissed: 2, lastAttendance: 'Attended 6 Jun', riskLevel: 'high', trend: 'declining', action: 'Monitor pattern — possible work commitment clash', employerNotified: false, interventionDate: null },
  { id: 'ar-04', name: 'Sophie Williams', programme: 'Marketing Executive L4', cohort: 'Cohort C', coach: 'Med Maher', attendanceRate: 86, sessionsMissed: 5, totalSessions: 20, consecutiveMissed: 1, lastAttendance: 'Attended 4 Jun', riskLevel: 'medium', trend: 'stable', action: 'Check work commitment clashes with session times', employerNotified: false, interventionDate: null },
  { id: 'ar-05', name: 'Maya Kapoor', programme: 'HR Consultant L5', cohort: 'Cohort E', coach: 'James Harrington', attendanceRate: 78, sessionsMissed: 8, totalSessions: 20, consecutiveMissed: 2, lastAttendance: 'Missed 7 Jun', riskLevel: 'high', trend: 'declining', action: 'Call learner — check for barriers to attendance', employerNotified: false, interventionDate: '11 Jun 2026' },
  { id: 'ar-06', name: 'Oliver Grant', programme: 'Project Manager L4', cohort: 'Cohort A', coach: 'Sarah Chen', attendanceRate: 85, sessionsMissed: 5, totalSessions: 20, consecutiveMissed: 2, lastAttendance: 'Attended 3 Jun', riskLevel: 'medium', trend: 'stable', action: 'Send reminder about next session', employerNotified: false, interventionDate: null },
  { id: 'ar-07', name: 'Priya Sharma', programme: 'Digital Marketer L3', cohort: 'Cohort B', coach: 'Med Maher', attendanceRate: 81, sessionsMissed: 7, totalSessions: 20, consecutiveMissed: 3, lastAttendance: 'Missed 8 Jun', riskLevel: 'high', trend: 'declining', action: 'Contact learner and employer — check barriers', employerNotified: true, interventionDate: '10 Jun 2026' },
  { id: 'ar-08', name: 'Lucas Nguyen', programme: 'Software Developer L4', cohort: 'Cohort F', coach: 'James Harrington', attendanceRate: 88, sessionsMissed: 4, totalSessions: 20, consecutiveMissed: 1, lastAttendance: 'Attended 5 Jun', riskLevel: 'medium', trend: 'improving', action: 'Continue monitoring — positive trend', employerNotified: false, interventionDate: null },
];

export default function AttendanceRiskPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'medium'>('all');
  const filtered = filter === 'all' ? RISK_DATA : RISK_DATA.filter(r => r.riskLevel === filter);
  const criticalCount = RISK_DATA.filter(r => r.riskLevel === 'critical').length;
  const highCount = RISK_DATA.filter(r => r.riskLevel === 'high').length;
  const mediumCount = RISK_DATA.filter(r => r.riskLevel === 'medium').length;

  return (
    <WorkspaceShell
      role="engagement" roleLabel={engagementNav.label} navItems={engagementNav.items} workspaceLabel={engagementNav.workspaceLabel}
      pageTitle="Attendance Risk" pageSubtitle="Track learners with attendance below 90% and trigger early intervention workflows"
      userName="Tom Harrington" userRole="Engagement Manager"
    >
      <div className="p-6 space-y-6">
        <WorkspaceHeroBanner
          title="Attendance Risk Monitoring"
          description={`${criticalCount} critical, ${highCount} high, ${mediumCount} medium risk learners. Interventions scheduled for ${criticalCount} learners. Average attendance rate: ${Math.round(RISK_DATA.reduce((s, r) => s + r.attendanceRate, 0) / RISK_DATA.length)}%.`}
          icon="ri-alert-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20workplace%20attendance%20monitoring%20dashboard%20professional%20office%20setting%20warm%20neutral%20lighting%20modern&width=400&height=160&seq=attendance-risk-01&orientation=landscape"
          imageAlt="Attendance Risk"
          stats={[{ label: 'Critical', value: String(criticalCount), variant: 'danger' }, { label: 'High', value: String(highCount) }, { label: 'Medium', value: String(mediumCount) }]}
        />

        {/* Related Pages Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-foreground-500 mr-1">Quick access:</span>
          <button onClick={() => navigate('/engagement/learner-engagement')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-secondary-50 hover:text-secondary-600 hover:border-secondary-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-heart-line text-sm"></i> Learner Engagement
          </button>
          <button onClick={() => navigate('/engagement/absence-queue')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-error-warning-line text-sm"></i> Absence Queue
          </button>
          <button onClick={() => navigate('/engagement/catchup-overdue')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-timer-line text-sm"></i> Catch-up Overdue
          </button>
          <button onClick={() => navigate('/engagement/call-logs')} className="flex items-center gap-1.5 px-3 py-1.5 bg-background-50 border border-foreground-200/60 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200/50 transition-smooth cursor-pointer whitespace-nowrap">
            <i className="ri-phone-line text-sm"></i> Call Logs
          </button>
        </div>

        {/* Risk Filters */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {(['all', 'critical', 'high', 'medium'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filter === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>
              <i className={`${f === 'critical' ? 'ri-error-warning-line' : f === 'high' ? 'ri-alert-line' : f === 'medium' ? 'ri-information-line' : 'ri-list-check'} text-sm`}></i>
              {f === 'all' ? 'All Risks' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Risk List */}
        <div className="space-y-3">
          {filtered.map(risk => (
            <div key={risk.id} className={`bg-background-50 rounded-xl border p-4 card-premium ${risk.riskLevel === 'critical' ? 'border-red-200/50 bg-red-50/20' : risk.riskLevel === 'high' ? 'border-amber-200/50 bg-amber-50/20' : 'border-foreground-200/60'}`}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${risk.riskLevel === 'critical' ? 'bg-red-100 text-red-700' : risk.riskLevel === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{risk.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground-900">{risk.name}</p>
                    <p className="text-[10px] text-foreground-400">{risk.programme} &middot; {risk.cohort} &middot; Coach: {risk.coach}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                  <span className={`text-lg font-bold ${risk.attendanceRate < 70 ? 'text-red-600' : risk.attendanceRate < 80 ? 'text-amber-600' : 'text-primary-600'}`}>{risk.attendanceRate}%</span>
                  <span className="text-foreground-400">{risk.sessionsMissed} missed</span>
                  <span className="text-foreground-400">{risk.consecutiveMissed} consecutive</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${risk.riskLevel === 'critical' ? 'bg-red-100 text-red-700' : risk.riskLevel === 'high' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'}`}>{risk.riskLevel.toUpperCase()}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${risk.trend === 'deteriorating' ? 'bg-red-100 text-red-700' : risk.trend === 'declining' ? 'bg-amber-100 text-amber-700' : risk.trend === 'improving' ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-500'}`}>{risk.trend}</span>
                </div>
              </div>
              <div className="mt-3 bg-background-100/50 rounded-lg p-3 flex items-start gap-2">
                <i className={`text-sm mt-0.5 ${risk.riskLevel === 'critical' ? 'ri-error-warning-line text-red-600' : 'ri-alert-line text-amber-600'}`}></i>
                <div className="flex-1">
                  <p className="text-[11px] font-medium text-foreground-700">{risk.action}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[10px] text-foreground-400">{risk.lastAttendance}</span>
                    <span className="text-[10px] text-foreground-400">{risk.employerNotified ? 'Employer notified' : 'Employer not notified'}</span>
                    {risk.interventionDate && <span className="text-[10px] text-primary-600 font-medium">Intervention: {risk.interventionDate}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-phone-line mr-1"></i> Call
                  </button>
                  <button className="px-3 py-1.5 bg-background-50 border border-foreground-200/60 text-foreground-600 rounded-lg text-[10px] font-medium hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                    <i className="ri-mail-line mr-1"></i> Email
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}