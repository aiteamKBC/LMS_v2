import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const leadershipNav = roleNavMap.leadership;

// ── Core learner counts ──
const LEARNER_COUNTS = { total: 42, active: 28, onboarding: 8, atRisk: 4, gatewayReady: 6, epaActive: 4, achieved: 2, withdrew: 0 };

// ── Cohorts ──
const COHORTS = [
  { name: 'ME-L4 May 2026', learners: 8, completion: 42, attendance: 90, otjh: 62, ksb: 38, risk: 'medium' as const, programme: 'Management L4' },
  { name: 'BA-L3 June 2026', learners: 6, completion: 11, attendance: 96, otjh: 16, ksb: 13, risk: 'low' as const, programme: 'Business Admin L3' },
  { name: 'DA-L4 April 2026', learners: 5, completion: 0, attendance: 0, otjh: 0, ksb: 0, risk: 'high' as const, programme: 'Data Analyst L4' },
  { name: 'OM-L5 Jan 2025', learners: 4, completion: 94, attendance: 97, otjh: 98, ksb: 96, risk: 'low' as const, programme: 'Ops Manager L5' },
  { name: 'HR-L5 March 2025', learners: 3, completion: 71, attendance: 93, otjh: 74, ksb: 68, risk: 'low' as const, programme: 'HR Consultant L5' },
  { name: 'PM-L4 Feb 2026', learners: 5, completion: 22, attendance: 71, otjh: 20, ksb: 18, risk: 'high' as const, programme: 'Project Manager L4' },
  { name: 'SD-L4 Sep 2024', learners: 6, completion: 100, attendance: 98, otjh: 100, ksb: 100, risk: 'low' as const, programme: 'Software Dev L4' },
];

// ── Programmes ──
const PROGRAMMES = [
  { name: 'Business Admin L3', code: 'ST0070', learners: 12, completion: 65, achievement: 82, engagement: 88, employerRating: 4.6 },
  { name: 'Management L4', code: 'ST0384', learners: 8, completion: 42, achievement: 60, engagement: 78, employerRating: 4.3 },
  { name: 'Data Analyst L4', code: 'ST0118', learners: 5, completion: 0, achievement: 0, engagement: 65, employerRating: 3.8 },
  { name: 'Ops Manager L5', code: 'ST0385', learners: 4, completion: 94, achievement: 100, engagement: 95, employerRating: 5.0 },
  { name: 'HR Consultant L5', code: 'ST0696', learners: 3, completion: 71, achievement: 85, engagement: 82, employerRating: 4.5 },
  { name: 'Project Manager L4', code: 'ST0411', learners: 5, completion: 22, achievement: 45, engagement: 70, employerRating: 4.0 },
  { name: 'Software Dev L4', code: 'ST1357', learners: 6, completion: 100, achievement: 100, engagement: 94, employerRating: 4.9 },
];

// ── Monthly attendance + engagement trends ──
const MONTHLY_TRENDS = [
  { month: 'Jan', attendance: 88, engagement: 76, otjhClaimed: 68, otjhValidated: 60 },
  { month: 'Feb', attendance: 90, engagement: 72, otjhClaimed: 72, otjhValidated: 65 },
  { month: 'Mar', attendance: 87, engagement: 80, otjhClaimed: 75, otjhValidated: 70 },
  { month: 'Apr', attendance: 91, engagement: 78, otjhClaimed: 80, otjhValidated: 74 },
  { month: 'May', attendance: 89, engagement: 82, otjhClaimed: 85, otjhValidated: 79 },
  { month: 'Jun', attendance: 93, engagement: 85, otjhClaimed: 88, otjhValidated: 82 },
  { month: 'Jul', attendance: 92, engagement: 84, otjhClaimed: 90, otjhValidated: 85 },
  { month: 'Aug', attendance: 90, engagement: 80, otjhClaimed: 87, otjhValidated: 83 },
  { month: 'Sep', attendance: 94, engagement: 88, otjhClaimed: 92, otjhValidated: 88 },
  { month: 'Oct', attendance: 95, engagement: 90, otjhClaimed: 94, otjhValidated: 91 },
  { month: 'Nov', attendance: 93, engagement: 87, otjhClaimed: 93, otjhValidated: 90 },
  { month: 'Dec', attendance: 96, engagement: 92, otjhClaimed: 96, otjhValidated: 93 },
];

// ── KSB Progress ──
const KSB_OVERVIEW = [
  { area: 'Knowledge', current: 68, validated: 42, inProgress: 26, gap: 32 },
  { area: 'Skills', current: 56, validated: 34, inProgress: 22, gap: 44 },
  { area: 'Behaviours', current: 72, validated: 48, inProgress: 24, gap: 28 },
];

// ── Employer Engagement ──
const EMPLOYERS = [
  { name: 'Tim Hortons UK', apprentices: 3, satisfaction: 88, reviewsDone: 4, otjhConfirmed: 74, risk: 'low' as const },
  { name: 'Pret A Manger', apprentices: 2, satisfaction: 94, reviewsDone: 4, otjhConfirmed: 94, risk: 'low' as const },
  { name: 'Boots UK', apprentices: 2, satisfaction: 90, reviewsDone: 2, otjhConfirmed: 91, risk: 'low' as const },
  { name: 'Costa Coffee', apprentices: 1, satisfaction: 65, reviewsDone: 0, otjhConfirmed: 0, risk: 'high' as const },
  { name: 'Marks & Spencer', apprentices: 2, satisfaction: 98, reviewsDone: 8, otjhConfirmed: 97, risk: 'low' as const },
  { name: 'Next PLC', apprentices: 1, satisfaction: 92, reviewsDone: 5, otjhConfirmed: 93, risk: 'low' as const },
  { name: 'Tesco', apprentices: 2, satisfaction: 58, reviewsDone: 2, otjhConfirmed: 71, risk: 'high' as const },
  { name: 'Barclays Bank PLC', apprentices: 1, satisfaction: 96, reviewsDone: 6, otjhConfirmed: 100, risk: 'low' as const },
];

// ── Tutor SLA ──
const TUTORS = [
  { name: 'Helen Curtis', cohorts: 'ME-L4 May 2026', markingTAT: 1.8, feedbackQuality: 4.9, sessionRating: 4.8, responseHrs: 3, slaMet: true, overdueItems: 0 },
  { name: 'Crispin Jones', cohorts: 'BA-L3 / HR-L5 / PM-L4', markingTAT: 2.2, feedbackQuality: 4.7, sessionRating: 4.7, responseHrs: 5, slaMet: true, overdueItems: 1 },
  { name: 'Rachel Oduya', cohorts: 'DA-L4 / SD-L4', markingTAT: 3.5, feedbackQuality: 4.4, sessionRating: 4.5, responseHrs: 9, slaMet: true, overdueItems: 3 },
];

// ── Coach Workload ──
const COACHES = [
  { name: 'Martin Reeves', learners: 5, sessionsWeek: 8, markingBacklog: 6, atRiskLearners: 3, utilisation: 88, meetingsOverdue: 2 },
  { name: 'Sarah Collins', learners: 3, sessionsWeek: 5, markingBacklog: 2, atRiskLearners: 0, utilisation: 62, meetingsOverdue: 0 },
  { name: 'Daniel Foster', learners: 2, sessionsWeek: 4, markingBacklog: 3, atRiskLearners: 0, utilisation: 55, meetingsOverdue: 0 },
];

// ── Compliance Risk ──
const COMPLIANCE_ALERTS = [
  { area: 'Onboarding Risk', level: 'high' as const, count: 2, detail: '2 learners with expired right-to-work evidence' },
  { area: 'Eligibility Risk', level: 'medium' as const, count: 1, detail: '1 learner with unconfirmed residency status' },
  { area: 'DAS/ILR Risk', level: 'high' as const, count: 3, detail: '3 learners with DAS-ILR data mismatch' },
  { area: 'Funding Risk', level: 'medium' as const, count: 2, detail: '2 learners with potential duplicate funding flags' },
  { area: 'Evidence Pack Risk', level: 'low' as const, count: 0, detail: 'All evidence packs verified' },
  { area: 'Signature Risk', level: 'medium' as const, count: 1, detail: '1 employer declaration pending' },
];

// ── QA Sampling ──
const QA_SUMMARY = { samplesPlanned: 40, samplesCompleted: 32, findingsTotal: 14, rejected: 3, severityBreakdown: { critical: 0, major: 4, minor: 7, advisory: 3 }, closureRate: 78 };

// ── Achievement Pipeline ──
const PIPELINE = { onboarding: 8, activeLearning: 28, approachingGateway: 6, gatewayReady: 6, epaActive: 4, achieved: 2, resit: 0, completed: 2 };

// ── Strategic Alerts ──
const STRATEGIC_ALERTS = [
  { id: 'sa-1', level: 'red' as const, text: 'DA-L4 April 2026 cohort has not started delivery — programme commencement overdue by 8 weeks', detail: '5 learners allocated, no sessions delivered, 0% OTJH claimed. Coach unassigned.' },
  { id: 'sa-2', level: 'red' as const, text: 'PM-L4 Feb 2026 cohort — 71% attendance rate below 85% threshold', detail: '2 learners with persistent non-attendance. Catch-up plans overdue.' },
  { id: 'sa-3', level: 'amber' as const, text: 'Martin Reeves caseload at 88% utilisation — at-risk learner load above threshold', detail: '3 at-risk learners, 2 meetings overdue, 6 marking items in backlog.' },
  { id: 'sa-4', level: 'amber' as const, text: '3 learners with DAS-ILR data mismatch — funding at risk', detail: 'Employer reservation status not matching ILR programme aim. Requires MIS intervention.' },
];

export default function LeadershipDashboard() {
  const [alertsExpanded, setAlertsExpanded] = useState(true);
  const totalLearners = LEARNER_COUNTS.total;
  const avgAttendance = Math.round(COHORTS.filter(c => c.attendance > 0).reduce((s, c) => s + c.attendance, 0) / COHORTS.filter(c => c.attendance > 0).length);
  const avgCompletion = Math.round(COHORTS.reduce((s, c) => s + c.completion, 0) / COHORTS.length);
  const atRiskCohorts = COHORTS.filter(c => c.risk !== 'low').length;
  const redAlerts = STRATEGIC_ALERTS.filter(a => a.level === 'red').length;
  const amberAlerts = STRATEGIC_ALERTS.filter(a => a.level === 'amber').length;

  return (
    <WorkspaceShell role="leadership" roleLabel={leadershipNav.label} navItems={leadershipNav.items} workspaceLabel={leadershipNav.workspaceLabel} pageTitle="Leadership Intelligence Centre" pageSubtitle="Executive command centre — performance, quality, compliance and strategic oversight" userName="Dr. Helen Park" userRole="Director of Apprenticeships">
      <div className="p-6 space-y-5">

        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="Leadership Intelligence Centre"
          description={`${totalLearners} learners across ${COHORTS.length} cohorts · ${PROGRAMMES.length} programmes · ${COACHES.length} coaches · ${TUTORS.length} tutors · ${EMPLOYERS.length} employers`}
          icon="ri-bar-chart-box-line"
          imageUrl="https://readdy.ai/api/search-image?query=Modern%20executive%20dashboard%20with%20subtle%20gold%20and%20charcoal%20toned%20data%20visualization%20elements%2C%20minimal%20abstract%20geometric%20patterns%2C%20premium%20corporate%20aesthetic%2C%20dark%20background%20with%20thin%20golden%20accent%20lines%2C%20executive%20intelligence%20centre%20atmosphere&width=400&height=160&seq=leadership-hero-dash-01&orientation=landscape"
          imageAlt="Leadership Intelligence Centre"
          stats={[
            { label: 'Total Learners', value: String(totalLearners) },
            { label: 'Active Learners', value: String(LEARNER_COUNTS.active) },
            { label: 'Avg Attendance', value: `${avgAttendance}%` },
          ]}
        />

        {/* ── Strategic Alerts Bar ── */}
        {STRATEGIC_ALERTS.length > 0 && (
          <div className="rounded-xl border border-red-200/60 bg-red-50/40 overflow-hidden">
            <button onClick={() => setAlertsExpanded(!alertsExpanded)} className="w-full flex items-center justify-between px-5 py-3 cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg bg-red-500 flex items-center justify-center"><i className="ri-alert-fill text-white text-sm"></i></span>
                <div className="text-left">
                  <span className="text-sm font-heading font-semibold text-red-800">Strategic Alerts Requiring Leadership Attention</span>
                  <span className="text-[11px] text-red-600 ml-2">{redAlerts} critical · {amberAlerts} warning</span>
                </div>
              </div>
              <i className={`${alertsExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-red-400 text-sm`}></i>
            </button>
            {alertsExpanded && (
              <div className="px-5 pb-3 space-y-1.5">
                {STRATEGIC_ALERTS.map(alert => (
                  <div key={alert.id} className={`p-3 rounded-lg ${alert.level === 'red' ? 'bg-red-100/70 border border-red-200/50' : 'bg-amber-100/60 border border-amber-200/50'}`}>
                    <div className="flex items-start gap-2.5">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${alert.level === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}></span>
                      <div>
                        <p className="text-[12px] font-semibold text-foreground-900">{alert.text}</p>
                        <p className="text-[11px] text-foreground-500 mt-0.5">{alert.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── KPI Summary Row ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { l: 'Active Learners', v: String(LEARNER_COUNTS.active), sub: `of ${totalLearners} total`, i: 'ri-user-line', c: 'bg-primary-100 text-primary-600' },
            { l: 'Onboarding', v: String(LEARNER_COUNTS.onboarding), sub: 'in pipeline', i: 'ri-user-received-line', c: 'bg-accent-100 text-accent-600' },
            { l: 'At-Risk Learners', v: String(LEARNER_COUNTS.atRisk), sub: `${atRiskCohorts} cohorts`, i: 'ri-alert-line', c: LEARNER_COUNTS.atRisk > 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600' },
            { l: 'Gateway Ready', v: String(LEARNER_COUNTS.gatewayReady), sub: 'awaiting gateway', i: 'ri-flag-line', c: 'bg-secondary-100 text-secondary-600' },
            { l: 'In EPA', v: String(LEARNER_COUNTS.epaActive), sub: 'active assessments', i: 'ri-award-line', c: 'bg-emerald-100 text-emerald-600' },
            { l: 'Achieved', v: String(LEARNER_COUNTS.achieved), sub: `this AY`, i: 'ri-trophy-line', c: 'bg-emerald-100 text-emerald-600' },
          ].map(k => (
            <div key={k.l} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 cursor-pointer hover:border-background-300/70 transition-smooth">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${k.c} mb-3`}><i className={`${k.i} text-sm`}></i></span>
              <p className="text-2xl font-heading font-semibold text-foreground-900">{k.v}</p>
              <p className="text-[11px] text-foreground-500 mt-0.5">{k.l}</p>
              <p className="text-[9px] text-foreground-400">{k.sub}</p>
            </div>
          ))}
        </div>

        {/* ── Main Content Grid: Performance + Pipeline ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Cohort Performance Bars */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Cohort Completion Rates</h3>
              <a href="/leadership/cohort-performance" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">View all <i className="ri-arrow-right-line text-[9px]"></i></a>
            </div>
            <div className="space-y-3">
              {COHORTS.map(c => (
                <div key={c.name} className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-foreground-600 font-medium">{c.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-semibold ${c.completion >= 70 ? 'text-emerald-600' : c.completion >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{c.completion}%</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${c.risk === 'low' ? 'bg-emerald-500' : c.risk === 'medium' ? 'bg-amber-500' : 'bg-red-500'}`}></span>
                    </div>
                  </div>
                  <div className="w-full bg-background-200 rounded-full h-2">
                    <div className={`h-2 rounded-full transition-all duration-700 ${c.completion >= 70 ? 'bg-emerald-500' : c.completion >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${c.completion}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Achievement Pipeline */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Achievement Pipeline</h3>
              <a href="/leadership/achievement-pipeline" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">View all <i className="ri-arrow-right-line text-[9px]"></i></a>
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Onboarding', count: PIPELINE.onboarding, color: 'bg-accent-500', icon: 'ri-user-received-line' },
                { label: 'Active Learning', count: PIPELINE.activeLearning, color: 'bg-primary-500', icon: 'ri-book-open-line' },
                { label: 'Approaching Gateway', count: PIPELINE.approachingGateway, color: 'bg-secondary-500', icon: 'ri-flag-line' },
                { label: 'Gateway Ready', count: PIPELINE.gatewayReady, color: 'bg-amber-500', icon: 'ri-check-double-line' },
                { label: 'EPA Active', count: PIPELINE.epaActive, color: 'bg-emerald-500', icon: 'ri-award-line' },
                { label: 'Achieved', count: PIPELINE.achieved, color: 'bg-emerald-700', icon: 'ri-trophy-line' },
              ].map((s, i) => (
                <div key={s.label} className="flex items-center gap-3">
                  <span className={`w-7 h-7 rounded-lg ${s.color} flex items-center justify-center shrink-0`}><i className={`${s.icon} text-white text-xs`}></i></span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[11px] font-medium text-foreground-700">{s.label}</span>
                      <span className="text-[11px] font-semibold text-foreground-900">{s.count}</span>
                    </div>
                    <div className="w-full bg-background-200 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full transition-all duration-700 ${s.color}`} style={{ width: `${(s.count / totalLearners) * 100}%` }}></div>
                    </div>
                  </div>
                  {i < 5 && <span className="text-foreground-300 text-[10px]"><i className="ri-arrow-right-line"></i></span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Attendance & Engagement Trends ── */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Attendance & Engagement — 12-Month Trend</h3>
            <a href="/leadership/attendance-trends" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">Attendance <i className="ri-arrow-right-line text-[9px]"></i></a>
          </div>
          <div className="relative h-52">
            <div className="absolute inset-0 flex items-end justify-between px-1">
              {MONTHLY_TRENDS.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 group">
                  <div className="w-full flex flex-col items-center gap-px">
                    <div className="w-full bg-primary-500/70 rounded-t-sm transition-all group-hover:opacity-100 group-hover:scale-y-105 origin-bottom" style={{ height: `${m.engagement * 0.44}px` }}></div>
                    <div className="w-5/6 bg-emerald-500/70 rounded-t-sm transition-all group-hover:opacity-100 group-hover:scale-y-105 origin-bottom" style={{ height: `${m.attendance * 0.44}px` }}></div>
                  </div>
                  <span className="text-[8px] text-foreground-400 mt-1">{m.month}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-5 mt-3 text-[10px]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70"></span> Attendance</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary-500/70"></span> Engagement</span>
          </div>
        </div>

        {/* ── OTJH vs KSB Panel ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* OTJH Planned vs Validated */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">OTJH — Planned vs Validated</h3>
              <a href="/leadership/otjh-trends" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">Full report <i className="ri-arrow-right-line text-[9px]"></i></a>
            </div>
            <div className="relative h-48">
              <div className="absolute inset-0 flex items-end justify-between px-1">
                {MONTHLY_TRENDS.map(m => (
                  <div key={m.month} className="flex-1 flex flex-col items-center gap-px">
                    <div className="flex gap-[2px] items-end">
                      <div className="w-[6px] bg-amber-400/70 rounded-t-sm" style={{ height: `${m.otjhClaimed * 1.4}px` }}></div>
                      <div className="w-[6px] bg-emerald-500/80 rounded-t-sm" style={{ height: `${m.otjhValidated * 1.4}px` }}></div>
                    </div>
                    <span className="text-[7px] text-foreground-400 mt-1">{m.month}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-center gap-5 mt-2 text-[10px]">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400/70"></span> Claimed</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/80"></span> Validated</span>
            </div>
          </div>

          {/* KSB Progress */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">KSB Progress Overview</h3>
              <a href="/leadership/ksb-progress" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">Drill down <i className="ri-arrow-right-line text-[9px]"></i></a>
            </div>
            <div className="space-y-4">
              {KSB_OVERVIEW.map(k => (
                <div key={k.area} className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-foreground-700">{k.area}</span>
                    <span className="font-semibold text-foreground-900">{k.current}%</span>
                  </div>
                  <div className="w-full bg-background-200 rounded-full h-3 flex overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${k.validated}%` }} title={`Validated: ${k.validated}%`}></div>
                    <div className="h-full bg-amber-500" style={{ width: `${k.inProgress}%` }} title={`In Progress: ${k.inProgress}%`}></div>
                    <div className="h-full bg-red-200" style={{ width: `${k.gap}%` }} title={`Gap: ${k.gap}%`}></div>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-foreground-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Validated {k.validated}%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> In Progress {k.inProgress}%</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-200"></span> Gap {k.gap}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Staff & Delivery Row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Tutor SLA */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Tutor SLA Performance</h3>
              <a href="/leadership/tutor-sla" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">Full SLA <i className="ri-arrow-right-line text-[9px]"></i></a>
            </div>
            <div className="space-y-3">
              {TUTORS.map(t => (
                <div key={t.name} className="flex items-center justify-between p-3 rounded-lg border border-foreground-200 hover:border-background-300/70 transition-smooth">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-foreground-900">{t.name}</p>
                    <p className="text-[10px] text-foreground-400 truncate">{t.cohorts}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-center">
                      <p className="text-[12px] font-bold text-foreground-900">{t.markingTAT}d</p>
                      <p className="text-[8px] text-foreground-400">TAT</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[12px] font-bold text-foreground-900">{t.feedbackQuality}/5</p>
                      <p className="text-[8px] text-foreground-400">Feedback</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[12px] font-bold text-foreground-900">{t.sessionRating}/5</p>
                      <p className="text-[8px] text-foreground-400">Sessions</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-semibold ${t.slaMet ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{t.slaMet ? 'SLA Met' : 'Breach'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Coach Workload */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Coach Workload</h3>
              <a href="/leadership/coach-workload" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">Full analysis <i className="ri-arrow-right-line text-[9px]"></i></a>
            </div>
            <div className="space-y-3">
              {COACHES.map(c => (
                <div key={c.name} className="p-3 rounded-lg border border-foreground-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-semibold text-foreground-900">{c.name}</span>
                    <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${c.utilisation >= 90 ? 'bg-red-100 text-red-700' : c.utilisation >= 80 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>{c.utilisation}% utilised</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {[{ l: 'Learners', v: String(c.learners) }, { l: 'Sessions/wk', v: String(c.sessionsWeek) }, { l: 'Marking', v: String(c.markingBacklog) }, { l: 'At-Risk', v: String(c.atRiskLearners) }].map(m => (
                      <div key={m.l} className="bg-background-100/50 rounded-lg p-1.5 text-center">
                        <p className="text-[11px] font-bold text-foreground-900">{m.v}</p>
                        <p className="text-[8px] text-foreground-400">{m.l}</p>
                      </div>
                    ))}
                  </div>
                  <div className="w-full bg-background-200 rounded-full h-2">
                    <div className={`h-2 rounded-full ${c.utilisation >= 90 ? 'bg-red-500' : c.utilisation >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${c.utilisation}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Quality & Compliance Risk Panel ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Compliance Risk */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">Compliance Risk Matrix</h3>
              <a href="/leadership/compliance-risk" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">Full matrix <i className="ri-arrow-right-line text-[9px]"></i></a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {COMPLIANCE_ALERTS.map(ca => (
                <div key={ca.area} className={`p-3 rounded-lg border ${ca.level === 'high' ? 'border-red-200/70 bg-red-50/40' : ca.level === 'medium' ? 'border-amber-200/70 bg-amber-50/30' : 'border-emerald-200/60 bg-emerald-50/30'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-semibold text-foreground-800">{ca.area}</span>
                    <span className={`w-2 h-2 rounded-full ${ca.level === 'high' ? 'bg-red-500' : ca.level === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                  </div>
                  <p className={`text-lg font-heading font-bold ${ca.level === 'high' ? 'text-red-700' : ca.level === 'medium' ? 'text-amber-700' : 'text-emerald-700'}`}>{ca.count}</p>
                  <p className="text-[9px] text-foreground-400 leading-tight mt-0.5">{ca.detail}</p>
                </div>
              ))}
            </div>
          </div>

          {/* QA Sampling & Ofsted */}
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-heading font-semibold text-foreground-900">QA Sampling & Ofsted Evidence</h3>
              <a href="/leadership/qa-sampling" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">View QA <i className="ri-arrow-right-line text-[9px]"></i></a>
            </div>
            <div className="space-y-3">
              {/* QA Summary */}
              <div className="p-3 rounded-lg border border-foreground-200">
                <p className="text-[11px] font-semibold text-foreground-800 mb-2">QA Sampling Progress</p>
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[
                    { l: 'Planned', v: String(QA_SUMMARY.samplesPlanned) },
                    { l: 'Completed', v: String(QA_SUMMARY.samplesCompleted) },
                    { l: 'Findings', v: String(QA_SUMMARY.findingsTotal) },
                    { l: 'Closure', v: `${QA_SUMMARY.closureRate}%` },
                  ].map(s => (
                    <div key={s.l} className="bg-background-100/50 rounded-lg p-1.5 text-center">
                      <p className="text-[11px] font-bold text-foreground-900">{s.v}</p>
                      <p className="text-[8px] text-foreground-400">{s.l}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[9px] text-foreground-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500"></span> Major: {QA_SUMMARY.severityBreakdown.major}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Minor: {QA_SUMMARY.severityBreakdown.minor}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-accent-500"></span> Advisory: {QA_SUMMARY.severityBreakdown.advisory}</span>
                </div>
              </div>
              {/* Ofsted Evidence Strength */}
              <a href="/leadership/ofsted" className="block p-3 rounded-lg border border-foreground-200 hover:border-primary-200/60 transition-smooth cursor-pointer">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-foreground-800">Ofsted Evidence Readiness</p>
                  <span className="text-[9px] font-semibold text-primary-500">View pack <i className="ri-arrow-right-line text-[8px]"></i></span>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { area: 'Quality of Education', strength: 82 },
                    { area: 'Behaviour & Attitudes', strength: 88 },
                    { area: 'Personal Development', strength: 76 },
                    { area: 'Leadership & Mgmt', strength: 85 },
                    { area: 'Apprenticeship Progress', strength: 72 },
                    { area: 'Employer Involvement', strength: 80 },
                  ].map(o => (
                    <div key={o.area} className="text-center">
                      <div className="relative w-10 h-10 mx-auto mb-1">
                        <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15" fill="none" stroke="oklch(var(--background-200))" strokeWidth="3"></circle>
                          <circle cx="18" cy="18" r="15" fill="none" stroke={o.strength >= 80 ? '#10b981' : o.strength >= 70 ? '#f59e0b' : '#ef4444'} strokeWidth="3" strokeDasharray={`${(o.strength / 100) * 94.2} 94.2`} strokeLinecap="round"></circle>
                        </svg>
                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-foreground-800">{o.strength}%</span>
                      </div>
                      <p className="text-[7px] text-foreground-400 leading-tight">{o.area}</p>
                    </div>
                  ))}
                </div>
              </a>
            </div>
          </div>
        </div>

        {/* ── Employer Engagement Summary ── */}
        <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-heading font-semibold text-foreground-900">Employer Engagement Overview</h3>
            <a href="/leadership/employer-engagement" className="text-[10px] font-semibold text-primary-500 hover:text-primary-600 whitespace-nowrap">Full engagement <i className="ri-arrow-right-line text-[9px]"></i></a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {EMPLOYERS.map(emp => (
              <div key={emp.name} className={`p-3 rounded-lg border ${emp.risk === 'high' ? 'border-red-200/60 bg-red-50/20' : 'border-foreground-200'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-foreground-900 truncate">{emp.name}</span>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${emp.risk === 'high' ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { l: 'Satisfaction', v: `${emp.satisfaction}%` },
                    { l: 'Reviews', v: String(emp.reviewsDone) },
                    { l: 'OTJH Conf.', v: `${emp.otjhConfirmed}%` },
                    { l: 'Apprentices', v: String(emp.apprentices) },
                  ].map(m => (
                    <div key={m.l} className="bg-background-100/50 rounded-lg p-1.5 text-center">
                      <p className="text-[11px] font-bold text-foreground-900">{m.v}</p>
                      <p className="text-[7px] text-foreground-400">{m.l}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </WorkspaceShell>
  );
}