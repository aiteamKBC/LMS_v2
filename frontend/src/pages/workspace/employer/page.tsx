import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { formatHoursMinutes } from '@/lib/format';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';

const employerNav = roleNavMap.employer;

type ViewMode = 'dashboard' | 'otjh' | 'attendance' | 'evidence';

interface OTJHEntry {
  id: string;
  date: string;
  activity: string;
  hours: number;
  module: string;
  learnerSubmitted: boolean;
  employerConfirmed: boolean;
  coachValidated: boolean;
}

const OTJH_ENTRIES: OTJHEntry[] = [
  { id: 'ot-01', date: '4 Jun 2026', activity: 'Live Session: Customer Segmentation', hours: 2.5, module: 'Marketing Planning', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
  { id: 'ot-02', date: '2 Jun 2026', activity: 'Workplace project: Customer persona for breakfast campaign', hours: 3.0, module: 'Marketing Planning', learnerSubmitted: true, employerConfirmed: true, coachValidated: false },
  { id: 'ot-03', date: '28 May 2026', activity: 'Reading: STP marketing theory', hours: 1.5, module: 'Marketing Principles', learnerSubmitted: true, employerConfirmed: false, coachValidated: false },
  { id: 'ot-04', date: '26 May 2026', activity: 'Assignment research: Marketing environment', hours: 2.0, module: 'Marketing Principles', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
  { id: 'ot-05', date: '23 May 2026', activity: 'Live Session: Marketing Environment PESTLE', hours: 2.5, module: 'Marketing Principles', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
  { id: 'ot-06', date: '20 May 2026', activity: 'Coaching meeting with Med Maher', hours: 1.0, module: 'Professional Practice', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
  { id: 'ot-07', date: '19 May 2026', activity: 'Induction and onboarding session', hours: 3.0, module: 'Apprenticeship Induction', learnerSubmitted: true, employerConfirmed: true, coachValidated: true },
];

const ATTENDANCE_RECORDS = [
  { date: '4 Jun 2026', session: 'Customer Segmentation', module: 'Marketing Planning', status: 'Attended' as const, catchUp: null },
  { date: '2 Jun 2026', session: 'Marketing Environment', module: 'Marketing Principles', status: 'Absent' as const, catchUp: 'Submitted' as const },
  { date: '28 May 2026', session: 'Marketing Environment PESTLE', module: 'Marketing Principles', status: 'Attended' as const, catchUp: null },
  { date: '26 May 2026', session: 'Consumer Behaviour', module: 'Marketing Principles', status: 'Late' as const, catchUp: null },
  { date: '23 May 2026', session: 'Customer Insight', module: 'Marketing Principles', status: 'Attended' as const, catchUp: null },
  { date: '21 May 2026', session: 'Professional Practice', module: 'Induction', status: 'Attended' as const, catchUp: null },
  { date: '19 May 2026', session: 'Apprenticeship Induction', module: 'Induction', status: 'Attended' as const, catchUp: null },
];

const EVIDENCE_ITEMS = [
  { id: 'ev-01', title: 'Customer Persona for Tim Hortons Breakfast Campaign', type: 'Workplace Project', module: 'Marketing Planning', submitted: '8 Jun 2026', ksbCount: 3, learnerStatus: 'Submitted', employerAction: 'validate' as const },
  { id: 'ev-02', title: 'Workplace Reflection: Applying Segmentation at Work', type: 'Reflection', module: 'Marketing Planning', submitted: '6 Jun 2026', ksbCount: 2, learnerStatus: 'Submitted', employerAction: 'confirm' as const },
  { id: 'ev-03', title: 'STP Model Worksheet — Tim Hortons Product Lines', type: 'Assignment', module: 'Marketing Principles', submitted: '30 May 2026', ksbCount: 4, learnerStatus: 'Accepted', employerAction: 'done' as const },
  { id: 'ev-04', title: 'PESTLE Analysis of UK Quick-Service Restaurant Market', type: 'Report', module: 'Marketing Principles', submitted: '25 May 2026', ksbCount: 3, learnerStatus: 'Accepted', employerAction: 'done' as const },
  { id: 'ev-05', title: 'Meeting Notes: Marketing Team Campaign Planning', type: 'Meeting Notes', module: 'Marketing Planning', submitted: '22 May 2026', ksbCount: 1, learnerStatus: 'Accepted', employerAction: 'done' as const },
  { id: 'ev-06', title: 'Initial Skills Assessment and Learning Plan', type: 'Document', module: 'Induction', submitted: '19 May 2026', ksbCount: 6, learnerStatus: 'Accepted', employerAction: 'done' as const },
];

const REVIEWS_TO_SIGN = [
  { id: 'rv-01', date: '25 Jun 2026', type: 'Monthly Progress Review', period: 'June 2026', coach: 'Med Maher', status: 'Scheduled' as const, actions: 'Prepare' },
  { id: 'rv-02', date: '28 May 2026', type: 'Monthly Progress Review', period: 'May 2026', coach: 'Med Maher', status: 'Awaiting Employer' as const, actions: 'Sign Now' },
];

export default function EmployerDashboard() {
  const p = LEARNER_PROFILE;
  const [activeView, setActiveView] = useState<ViewMode>('dashboard');
  const pendingOTJH = OTJH_ENTRIES.filter(e => !e.employerConfirmed).length;
  const pendingEvidence = EVIDENCE_ITEMS.filter(e => e.employerAction !== 'done').length;
  const pendingSignatures = REVIEWS_TO_SIGN.filter(r => r.status === 'Awaiting Employer').length;

  return (
    <WorkspaceShell
      role="employer" roleLabel={employerNav.label} navItems={employerNav.items} workspaceLabel={employerNav.workspaceLabel}
      pageTitle="Employer Dashboard" pageSubtitle="Monitor Sophie Williams' apprenticeship progress at Tim Hortons UK"
      userName="Lauren Mitchell" userRole="Line Manager — Tim Hortons UK"
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title={`${p.fullName} — ${p.programme} L${p.programmeLevel}`}
          description={`Cohort ${p.cohort} · Started ${p.startDate} · Overall Progress ${p.overallProgress}% · Risk Status: ${p.riskStatus}`}
          icon="ri-building-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20employer%20workplace%20professional%20office%20building%20exterior%20modern%20business%20district%20purple%20gold%20accent%20editorial%20photography%20clean%20warm%20corporate%20atmosphere&width=400&height=160&seq=employer-hero-01&orientation=landscape"
          imageAlt="Employer workspace"
          stats={[
            { label: 'Progress', value: `${p.overallProgress}%` },
            { label: 'Actions', value: String(pendingOTJH + pendingEvidence + pendingSignatures), variant: pendingOTJH + pendingEvidence + pendingSignatures > 0 ? 'danger' : 'success' },
          ]}
        />

        {/* Action Required Alert */}
        {(pendingOTJH > 0 || pendingEvidence > 0 || pendingSignatures > 0) && (
          <div className="bg-amber-50 border border-amber-200/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <span className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <AppIcon className="ri-alert-line text-amber-600 text-base"></AppIcon>
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Action Required: {pendingOTJH + pendingEvidence + pendingSignatures} items need your attention</p>
              <p className="text-[12px] text-amber-600 mt-0.5">
                {pendingOTJH > 0 && <span>{pendingOTJH} OTJH entries to confirm · </span>}
                {pendingEvidence > 0 && <span>{pendingEvidence} evidence items to validate · </span>}
                {pendingSignatures > 0 && <span>{pendingSignatures} progress review to sign</span>}
              </p>
            </div>
            <button className="px-4 py-2 bg-amber-600 text-white rounded-lg text-[12px] font-semibold hover:bg-amber-700 transition-smooth cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-check-double-line mr-1"></AppIcon> Review All
            </button>
          </div>
        )}

        {/* View Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: 'dashboard' as ViewMode, label: 'Overview', icon: 'ri-dashboard-line' },
            { key: 'otjh' as ViewMode, label: 'OTJH Confirmation', icon: 'ri-time-line', badge: pendingOTJH },
            { key: 'attendance' as ViewMode, label: 'Attendance Review', icon: 'ri-calendar-check-line' },
            { key: 'evidence' as ViewMode, label: 'Evidence Validation', icon: 'ri-shield-check-line', badge: pendingEvidence },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeView === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <AppIcon className={`${tab.icon} text-sm`}></AppIcon>
              {tab.label}
              {tab.badge && tab.badge > 0 && (
                <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Dashboard Overview */}
        {activeView === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <EmployerStatCard label="Overall Progress" value={`${p.overallProgress}%`} sub={`Week ${p.currentWeek} of 72`} icon="ri-pie-chart-line" color="primary" progress={p.overallProgress} />
              <EmployerStatCard label="Attendance Rate" value={`${p.attendanceRate}%`} sub={`${p.sessionsAttended}/${p.sessionsAttended + p.sessionsMissed} sessions`} icon="ri-calendar-check-line" color="accent" progress={p.attendanceRate} />
              <EmployerStatCard label="OTJH Hours" value={formatHoursMinutes(p.otjhCompleted)} sub={`Target: ${formatHoursMinutes(p.otjhTarget)}`} icon="ri-time-line" color="secondary" progress={Math.round((p.otjhCompleted / p.otjhTarget) * 100)} />
              <EmployerStatCard label="KSB Progress" value={`${p.ksbProgress}%`} sub={`${p.ksbValidated} of ${p.ksbTotal} validated`} icon="ri-bar-chart-2-line" color="primary" progress={p.ksbProgress} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* OTJH Summary */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH Summary</h3>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${pendingOTJH > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {pendingOTJH > 0 ? `${pendingOTJH} to confirm` : 'All confirmed'}
                  </span>
                </div>
                <div className="space-y-2">
                  {OTJH_ENTRIES.slice(0, 4).map(entry => (
                    <div key={entry.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-background-100/50 transition-smooth cursor-pointer">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${entry.employerConfirmed ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-foreground-900 truncate">{entry.activity}</p>
                        <p className="text-[10px] text-foreground-400">{entry.date} · {entry.hours}h</p>
                      </div>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${entry.employerConfirmed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {entry.employerConfirmed ? 'Confirmed' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setActiveView('otjh')}
                  className="mt-3 w-full text-[11px] font-medium text-primary-600 hover:text-primary-700 transition-smooth cursor-pointer text-center"
                >
                  View all OTJH entries →
                </button>
              </div>

              {/* Attendance Summary */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Summary</h3>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${p.attendanceRate >= 90 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {p.attendanceRate}%
                  </span>
                </div>
                <div className="space-y-2">
                  {ATTENDANCE_RECORDS.slice(0, 5).map(rec => (
                    <div key={rec.date} className="flex items-center gap-2 p-2 rounded-lg hover:bg-background-100/50 transition-smooth">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${rec.status === 'Attended' ? 'bg-emerald-500' : rec.status === 'Late' ? 'bg-amber-500' : 'bg-red-500'}`}></span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-medium text-foreground-900 truncate">{rec.session}</p>
                        <p className="text-[10px] text-foreground-400">{rec.date}</p>
                      </div>
                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                        rec.status === 'Attended' ? 'bg-emerald-100 text-emerald-700' :
                        rec.status === 'Late' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>{rec.status}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setActiveView('attendance')}
                  className="mt-3 w-full text-[11px] font-medium text-primary-600 hover:text-primary-700 transition-smooth cursor-pointer text-center"
                >
                  View full attendance record →
                </button>
              </div>

              {/* Reviews & Signatures */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-heading font-semibold text-foreground-900">Reviews to Sign</h3>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${pendingSignatures > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {pendingSignatures > 0 ? `${pendingSignatures} pending` : 'Up to date'}
                  </span>
                </div>
                <div className="space-y-2">
                  {REVIEWS_TO_SIGN.map(review => (
                    <div key={review.id} className="p-3 rounded-lg bg-background-100/50">
                      <div className="flex items-start justify-between mb-1">
                        <p className="text-[12px] font-semibold text-foreground-900">{review.type}</p>
                        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                          review.status === 'Awaiting Employer' ? 'bg-red-100 text-red-700' : 'bg-primary-100 text-primary-700'
                        }`}>{review.status}</span>
                      </div>
                      <p className="text-[10px] text-foreground-400">Period: {review.period} · Coach: {review.coach}</p>
                      {review.status === 'Awaiting Employer' && (
                        <button className="mt-2 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap w-full">
                          <AppIcon className="ri-pen-nib-line mr-1"></AppIcon> Sign Now
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Key People & Contacts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium text-center">
                <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center mx-auto mb-3 text-sm font-bold">{p.coach.avatar}</div>
                <p className="text-sm font-semibold text-foreground-900">{p.coach.name}</p>
                <p className="text-[11px] text-foreground-400">{p.coach.role}</p>
                <p className="text-[10px] text-foreground-300 mt-1">{p.coach.email}</p>
                <button className="mt-2 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap w-full">
                  <AppIcon className="ri-mail-line mr-1"></AppIcon> Message Coach
                </button>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium text-center">
                <div className="w-12 h-12 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center mx-auto mb-3 text-sm font-bold">{p.tutor.avatar}</div>
                <p className="text-sm font-semibold text-foreground-900">{p.tutor.name}</p>
                <p className="text-[11px] text-foreground-400">{p.tutor.role}</p>
                <p className="text-[10px] text-foreground-300 mt-1">{p.tutor.email}</p>
                <button className="mt-2 px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap w-full">
                  <AppIcon className="ri-mail-line mr-1"></AppIcon> Message Tutor
                </button>
              </div>
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium text-center">
                <div className="w-12 h-12 rounded-full bg-secondary-100 text-secondary-600 flex items-center justify-center mx-auto mb-3 text-sm font-bold">{p.lineManager.avatar}</div>
                <p className="text-sm font-semibold text-foreground-900">{p.lineManager.name}</p>
                <p className="text-[11px] text-foreground-400">{p.lineManager.role}</p>
                <p className="text-[10px] text-foreground-300 mt-1">{p.lineManager.email}</p>
                <button className="mt-2 px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap w-full">
                  <AppIcon className="ri-calendar-check-line mr-1"></AppIcon> Meeting Notes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* OTJH Confirmation View */}
        {activeView === 'otjh' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH Confirmation</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Confirm that Sophie completed these off-the-job training activities during paid working hours at Tim Hortons UK</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{OTJH_ENTRIES.filter(e => e.employerConfirmed).length}/{OTJH_ENTRIES.length} confirmed</span>
                <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{OTJH_ENTRIES.reduce((sum, e) => sum + e.hours, 0)}h total</span>
              </div>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {OTJH_ENTRIES.map(entry => (
                  <div key={entry.id} className={`p-4 flex flex-col sm:flex-row sm:items-center gap-4 ${!entry.employerConfirmed ? 'bg-amber-50/40' : ''}`}>
                    <div className={`rounded-xl px-3 py-2 text-center shrink-0 min-w-[64px] ${entry.employerConfirmed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                      <p className="text-xs font-bold">{entry.hours}h</p>
                      <p className="text-[9px] font-medium">OTJH</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900">{entry.activity}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                        <span className="text-[11px] text-foreground-400">{entry.date}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{entry.module}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${entry.coachValidated ? 'bg-emerald-100 text-emerald-700' : 'bg-background-100 text-foreground-500'}`}>
                          Coach: {entry.coachValidated ? 'Validated' : 'Pending'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {entry.employerConfirmed ? (
                        <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                          <AppIcon className="ri-check-line"></AppIcon> Confirmed
                        </span>
                      ) : (
                        <>
                          <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[11px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap">
                            <AppIcon className="ri-check-line mr-1"></AppIcon> Confirm
                          </button>
                          <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                            <AppIcon className="ri-close-line mr-1"></AppIcon> Decline
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 bg-background-100/50 rounded-xl border border-background-200/30 p-4">
              <div className="flex items-center gap-3">
                <AppIcon className="ri-information-line text-foreground-400"></AppIcon>
                <div>
                  <p className="text-[12px] font-medium text-foreground-700">Employer Confirmation Policy</p>
                  <p className="text-[11px] text-foreground-400">By confirming OTJH, you verify that Sophie undertook these learning activities during her normal paid working hours at Tim Hortons UK, in line with the apprenticeship funding rules. False declarations may result in funding clawback.</p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Attendance Review */}
        {activeView === 'attendance' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance Review</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Review Sophie's session attendance and catch-up status</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{p.attendanceRate}% attendance</span>
                <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">{p.sessionsMissed} missed</span>
              </div>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {ATTENDANCE_RECORDS.map(rec => (
                  <div key={rec.date} className="p-3.5 flex items-center gap-4">
                    <span className="text-[11px] text-foreground-400 shrink-0 w-20">{rec.date}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground-900">{rec.session}</p>
                      <p className="text-[11px] text-foreground-400">{rec.module}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${
                      rec.status === 'Attended' ? 'bg-emerald-100 text-emerald-700' :
                      rec.status === 'Late' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-700'
                    }`}>{rec.status}</span>
                    {rec.catchUp && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700">{rec.catchUp}</span>
                    )}
                    {rec.status === 'Absent' && !rec.catchUp && (
                      <button className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-semibold hover:bg-amber-600 transition-smooth cursor-pointer whitespace-nowrap">
                        Flag for Catch-up
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Evidence Validation */}
        {activeView === 'evidence' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Evidence Validation</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Confirm that Sophie's evidence reflects genuine workplace activity at Tim Hortons UK</p>
              </div>
              <span className="text-[10px] text-foreground-400 bg-background-100 px-2 py-0.5 rounded-full">
                {EVIDENCE_ITEMS.filter(e => e.employerAction === 'done').length}/{EVIDENCE_ITEMS.length} validated
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {EVIDENCE_ITEMS.map(item => (
                <div key={item.id} className={`bg-background-50 rounded-xl border p-4 card-premium ${item.employerAction !== 'done' ? 'border-amber-200/50 bg-amber-50/20' : 'border-foreground-200/60'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                      item.learnerStatus === 'Accepted' ? 'bg-emerald-100 text-emerald-700' :
                      item.learnerStatus === 'Submitted' ? 'bg-primary-100 text-primary-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>{item.learnerStatus}</span>
                    <span className="text-[10px] text-foreground-400">{item.submitted}</span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground-900 mb-2 leading-snug">{item.title}</h4>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-3">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-background-100 text-foreground-500">{item.type}</span>
                    <span className="text-[10px] text-foreground-400">{item.module}</span>
                    <span className="text-[10px] text-foreground-400">{item.ksbCount} KSBs</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.employerAction === 'done' ? (
                      <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 flex items-center gap-1">
                        <AppIcon className="ri-check-double-line text-xs"></AppIcon> Validated
                      </span>
                    ) : (
                      <>
                        <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-check-line mr-1"></AppIcon> {item.employerAction === 'validate' ? 'Validate' : 'Confirm'}
                        </button>
                        <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[11px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                          <AppIcon className="ri-file-search-line mr-1"></AppIcon> View Detail
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </WorkspaceShell>
  );
}

function EmployerStatCard({ label, value, sub, icon, color, progress }: {
  label: string; value: string; sub: string; icon: string; color: string; progress: number;
}) {
  const iconBg = color === 'primary' ? 'bg-primary-100 text-primary-600'
    : color === 'accent' ? 'bg-accent-50 text-accent-700'
    : 'bg-secondary-100 text-secondary-600';

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
      <div className="flex items-start justify-between mb-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
          <AppIcon className={`${icon} text-sm`}></AppIcon>
        </span>
      </div>
      <p className="text-[11px] text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <div className="w-full bg-background-200 rounded-full h-1.5 mt-2 mb-1">
        <div className={`h-1.5 rounded-full ${progress >= 90 ? 'bg-emerald-500' : progress >= 70 ? 'bg-accent-500' : progress >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${progress}%` }}></div>
      </div>
      <p className="text-[10px] text-foreground-400">{sub}</p>
    </div>
  );
}
