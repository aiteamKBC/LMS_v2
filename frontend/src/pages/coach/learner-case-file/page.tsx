import { useState, useEffect } from 'react';
<<<<<<< HEAD
import { useNavigate } from 'react-router-dom';
=======
import { useNavigate, useSearchParams } from 'react-router-dom';
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { LEARNER_PROFILE } from '@/mocks/learner-profile';
import OverviewTab from './components/OverviewTab';
import AttendanceTab from './components/AttendanceTab';
import OTJHTab from './components/OTJHTab';
import KSBsTab from './components/KSBsTab';
import EvidenceTab from './components/EvidenceTab';
import ActivityTab from './components/ActivityTab';
import DocumentsTab from './components/DocumentsTab';
import MessagesTab from './components/MessagesTab';
import NetworkTab from './components/NetworkTab';

const coachNav = roleNavMap.coach;
const p = LEARNER_PROFILE;

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'ri-dashboard-line' },
  { id: 'attendance', label: 'Attendance', icon: 'ri-calendar-check-line' },
  { id: 'otjh', label: 'OTJH', icon: 'ri-time-line' },
  { id: 'ksbs', label: 'KSBs', icon: 'ri-award-line' },
  { id: 'evidence', label: 'Evidence', icon: 'ri-folder-upload-line' },
  { id: 'activity', label: 'Activity', icon: 'ri-history-line' },
  { id: 'network', label: 'Network', icon: 'ri-user-heart-line' },
  { id: 'documents', label: 'Documents', icon: 'ri-folder-line' },
  { id: 'messages', label: 'Messages', icon: 'ri-mail-line' },
] as const;

type TabId = typeof TABS[number]['id'];

const getStatusClass = (status: string) => {
  if (status === 'Validated' || status === 'Accepted' || status === 'Complete' || status === 'Attended') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'In Progress' || status === 'Submitted' || status === 'Scheduled') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'Absent' || status === 'Referred') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-background-100 text-foreground-500 border-background-200';
};

export default function LearnerCaseFile() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [stickyVisible, setStickyVisible] = useState(false);
  const navigate = useNavigate();
<<<<<<< HEAD
=======
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');

  useEffect(() => {
    if (TABS.some(tab => tab.id === requestedTab)) {
      setActiveTab(requestedTab as TabId);
    }
  }, [requestedTab]);
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)

  useEffect(() => {
    const onScroll = () => {
      setStickyVisible(window.scrollY > 240);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const renderTab = () => {
    switch (activeTab) {
      case 'overview': return <OverviewTab />;
      case 'attendance': return <AttendanceTab />;
      case 'otjh': return <OTJHTab />;
      case 'ksbs': return <KSBsTab />;
      case 'evidence': return <EvidenceTab />;
      case 'activity': return <ActivityTab />;
      case 'network': return <NetworkTab />;
      case 'documents': return <DocumentsTab />;
      case 'messages': return <MessagesTab />;
      default: return <OverviewTab />;
    }
  };

  const progress = p.overallProgress;
  const ringRadius = 60;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDash = (progress / 100) * ringCircumference;
  const ringGap = ringCircumference - ringDash;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle={`${p.fullName}`} pageSubtitle={`${p.programme} ${p.programmeLevel} · ${p.employer}`} userName="Med Maher" userRole="Progress Coach">
      {/* ════════════════ STICKY QUICK ACTIONS BAR ════════════════ */}
      <div
        className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
          stickyVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
        }`}
      >
        <div className="bg-background-50/95 backdrop-blur-md border-b border-foreground-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center gap-3">
            {/* Mini avatar */}
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center shrink-0 text-xs font-bold text-white font-heading">
              {p.firstName.charAt(0)}{p.lastName.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-foreground-900 truncate">{p.fullName}</p>
              <p className="text-[10px] text-foreground-400 truncate">{p.programme} {p.programmeLevel} · {p.employer}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => navigate('/messages', { state: { openContact: 'sophie-williams' } })}
                className="px-3 py-1.5 rounded-full bg-primary-500 text-background-50 dark:text-foreground-950 text-[11px] font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1"
              >
                <i className="ri-message-3-line text-xs"></i> Message
              </button>
              <button className="px-3 py-1.5 rounded-full bg-background-100 text-foreground-700 text-[11px] font-semibold hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1">
                <i className="ri-calendar-check-line text-xs"></i> Book Session
              </button>
              <button className="px-3 py-1.5 rounded-full bg-background-100 text-foreground-700 text-[11px] font-semibold hover:bg-background-200 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1">
                <i className="ri-phone-line text-xs"></i> Call
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pb-8">
        {/* ════════════════ HERO — LinkedIn-Style Cover + Profile ════════════════ */}
        <section className="relative">
          {/* Cover Banner — same background as sidebar cards */}
          <div className="relative h-40 md:h-48 lg:h-52 rounded-b-lg overflow-hidden bg-background-50 border-b border-background-200">
            <div className="absolute inset-0 bg-gradient-to-br from-background-50 via-background-100 to-background-200"></div>
            {/* Subtle decorative accent */}
            <div className="absolute top-0 right-0 w-1/3 h-full opacity-30 bg-gradient-to-l from-primary-100 to-transparent"></div>
          </div>

          <div className="relative px-4 md:px-8">
            {/* Photo + Progress Ring + Name + Buttons — all in one row on desktop */}
            <div className="-mt-14 md:-mt-16 flex flex-col md:flex-row md:items-start gap-4 md:gap-6 pb-6">
              {/* Profile Photo + Progress Ring */}
              <div className="relative shrink-0 w-28 h-28 md:w-32 md:h-32">
                <svg className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] rotate-[-90deg]" viewBox="0 0 136 136">
                  <circle cx="68" cy="68" r={ringRadius} fill="none" stroke="oklch(var(--background-200))" strokeWidth="5" />
                  <circle cx="68" cy="68" r={ringRadius} fill="none" stroke="oklch(var(--primary-500))" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${ringDash} ${ringGap}`} />
                </svg>
                <div className="w-28 h-28 md:w-32 md:h-32 rounded-full ring-4 ring-background-50 bg-gradient-to-br from-primary-400 to-accent-400 flex items-center justify-center overflow-hidden shadow-lg relative z-10">
                  <span className="text-3xl md:text-4xl font-bold text-white font-heading">{p.firstName.charAt(0)}{p.lastName.charAt(0)}</span>
                </div>
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 ring-2 ring-background-50 flex items-center justify-center z-20">
                  <i className="ri-check-line text-white text-[10px]"></i>
                </div>
                {/* Progress % label on the ring */}
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 rounded-full bg-background-50 border border-background-200 shadow-sm text-[10px] font-bold text-foreground-700 whitespace-nowrap">
                  {progress}% progress
                </div>
              </div>

              {/* Right side: Name/Details + Buttons */}
              <div className="flex-1 min-w-0 flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
                {/* Name + Details — below the banner line */}
                <div className="flex-1 min-w-0 pt-1 md:pt-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1">
                    <h1 className="text-xl md:text-2xl font-heading font-bold text-foreground-900 tracking-tight">{p.fullName}</h1>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200 w-fit">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Active Learner
                    </span>
                  </div>
                  {/* Employer badge */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary-50 text-primary-700 text-[11px] font-medium border border-primary-200">
                      <i className="ri-building-2-line text-xs"></i>
                      {p.employer}
                    </span>
                    <p className="text-sm text-foreground-500">
                      {p.programme} {p.programmeLevel}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-foreground-400">
                    <span className="flex items-center gap-1"><i className="ri-map-pin-line text-foreground-300"></i>Sheffield, UK</span>
                    <span className="hidden sm:inline text-foreground-200">·</span>
                    <span className="flex items-center gap-1"><i className="ri-calendar-line text-foreground-300"></i>Started {p.startDate}</span>
                    <span className="hidden sm:inline text-foreground-200">·</span>
                    <span className="flex items-center gap-1"><i className="ri-group-line text-foreground-300"></i>Cohort {p.cohort}</span>
                    <span className="hidden sm:inline text-foreground-200">·</span>
                    <span className="flex items-center gap-1"><i className="ri-mail-line text-foreground-300"></i>{p.email}</span>
                  </div>
                </div>

                {/* Action Buttons — on the right */}
                <div className="flex items-center gap-2 shrink-0 md:pt-4">
                  <button
                    onClick={() => navigate('/messages', { state: { openContact: 'sophie-williams' } })}
                    className="px-4 py-2 rounded-full bg-primary-500 text-background-50 dark:text-foreground-950 text-[13px] font-semibold hover:bg-primary-600 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 shadow-sm"
                  >
                    <i className="ri-message-3-line text-sm"></i> Message
                  </button>
                  <div className="relative group">
                    <button className="w-9 h-9 rounded-full bg-background-50 text-foreground-500 flex items-center justify-center hover:bg-background-100 transition-all cursor-pointer border border-background-200">
                      <i className="ri-more-fill text-sm"></i>
                    </button>
                    <div className="absolute right-0 top-full mt-1 w-48 bg-background-50 rounded-xl border border-background-200 shadow-lg py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-20">
                      <button className="w-full text-left px-4 py-2 text-[13px] text-foreground-700 hover:bg-background-100 cursor-pointer flex items-center gap-2 whitespace-nowrap">
                        <i className="ri-flag-line text-amber-500"></i> Flag Concern
                      </button>
                      <button className="w-full text-left px-4 py-2 text-[13px] text-foreground-700 hover:bg-background-100 cursor-pointer flex items-center gap-2 whitespace-nowrap">
                        <i className="ri-download-line"></i> Export Profile
                      </button>
                      <button className="w-full text-left px-4 py-2 text-[13px] text-red-600 hover:bg-red-50 cursor-pointer flex items-center gap-2 whitespace-nowrap">
                        <i className="ri-alert-line"></i> Report Concern
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ════════════════ TAB SYSTEM ════════════════ */}
        <div className="px-4 md:px-8 mt-4">
          {/* Tabs Navigation */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-full text-[13px] font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === tab.id
                    ? 'bg-primary-500 text-background-50 dark:text-foreground-950 shadow-sm'
                    : 'text-foreground-500 hover:text-foreground-700 hover:bg-background-100'
                }`}
              >
                <i className={`${tab.icon} text-sm`}></i>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Two-Column Layout */}
          <div className="flex flex-col lg:flex-row gap-5 mt-4">
            {/* LEFT COLUMN — Tab Content */}
            <div className="flex-1 min-w-0">
              {renderTab()}
            </div>

            {/* RIGHT COLUMN — Sidebar */}
            <div className="w-full lg:w-[340px] shrink-0 space-y-4">
              {/* Risk Assessment */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h3 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">Risk Assessment</h3>
                <div className="space-y-2">
                  {[
                    { label: 'Attendance', status: 'Amber', detail: '86% — below 90% target' },
                    { label: 'OTJH Hours', status: 'Amber', detail: '74 of 120 hours at Week 4' },
                    { label: 'Evidence', status: 'Green', detail: '12 items, 9 validated' },
                    { label: 'KSB Progression', status: 'Amber', detail: '38% — needs acceleration' },
                  ].map((r, i) => (
                    <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-background-100/50">
                      <span className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${r.status === 'Green' ? 'bg-emerald-500' : r.status === 'Amber' ? 'bg-amber-500' : 'bg-red-500'}`}></span>
                      <div>
                        <p className="text-[12px] font-medium text-foreground-900">{r.label}</p>
                        <p className="text-[10px] text-foreground-400">{r.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Key People */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h3 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">Key People</h3>
                <div className="space-y-3">
                  {[
                    { name: p.coach.name, role: p.coach.role, email: p.coach.email, avatar: p.coach.avatar, color: 'primary' },
                    { name: p.tutor.name, role: p.tutor.role, email: p.tutor.email, avatar: p.tutor.avatar, color: 'accent' },
                    { name: p.lineManager.name, role: p.lineManager.role, email: p.lineManager.email, avatar: p.lineManager.avatar, color: 'secondary' },
                  ].map((person, i) => (
                    <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-background-100/50 hover:bg-background-100 transition-all cursor-pointer group">
                      <div className={`w-9 h-9 rounded-full bg-${person.color}-100 text-${person.color}-600 flex items-center justify-center text-xs font-bold shrink-0`}>{person.avatar}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-foreground-900 group-hover:text-primary-600 transition-colors">{person.name}</p>
                        <p className="text-[10px] text-foreground-400">{person.role}</p>
                      </div>
                      <i className="ri-arrow-right-s-line text-foreground-300 opacity-0 group-hover:opacity-100 transition-all"></i>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upcoming */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h3 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">Upcoming</h3>
                <div className="space-y-1.5">
                  {[
                    { d: '11 Jun', t: 'Week 4 Live Session', u: false },
                    { d: '13 Jun', t: 'Weekly Quiz: Segmentation', u: false },
                    { d: '14 Jun', t: 'Customer Persona Activity', u: true },
                    { d: '15 Jun', t: 'Workplace Reflection Due', u: true },
                    { d: '18 Jun', t: 'Monthly Coaching Meeting', u: false },
                    { d: '25 Jun', t: 'Progress Review June', u: false },
                  ].map((dl, i) => (
                    <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-background-100/50 hover:bg-background-100 transition-all cursor-pointer">
                      <span className="text-[11px] font-semibold text-foreground-600 w-14 shrink-0">{dl.d}</span>
                      <span className="text-[12px] text-foreground-900 flex-1">{dl.t}</span>
                      {dl.u && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">Due</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Programme Info */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h3 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">Programme Info</h3>
                <div className="space-y-2">
                  {[
                    { label: 'Standard Code', value: p.standardCode },
                    { label: 'Cohort', value: p.cohort },
                    { label: 'Duration', value: `${p.durationMonths} months` },
                    { label: 'Learning Style', value: `${p.learningStyle} / ${p.secondaryStyle}` },
                    { label: 'Gateway Target', value: p.gatewayTargetDate },
                    { label: 'EPA Target', value: p.epaTargetDate },
                    { label: 'Planned End', value: p.plannedEndDate },
                    { label: 'Recognition', value: p.recognitionLevel },
                  ].map((info, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-background-100 last:border-0">
                      <span className="text-[11px] text-foreground-400">{info.label}</span>
                      <span className="text-[12px] font-medium text-foreground-900 text-right">{info.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recognition */}
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5">
                <h3 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider mb-3">Recognition</h3>
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center mb-3 shadow-sm">
                    <i className="ri-star-fill text-white text-2xl"></i>
                  </div>
                  <p className="text-2xl font-heading font-bold text-foreground-900">{p.pointsBalance}</p>
                  <p className="text-[11px] text-foreground-400 mt-0.5">Points Balance</p>
                  <div className="mt-3 pt-3 border-t border-background-200">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-semibold border border-amber-200">
                      <i className="ri-medal-line text-sm"></i> {p.recognitionLevel}
                    </span>
                  </div>
                  <p className="text-[10px] text-foreground-400 mt-2">{p.streakWeeks} week streak</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeInUp { animation: fadeInUp 0.4s ease-out; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </WorkspaceShell>
  );
<<<<<<< HEAD
}
=======
}
>>>>>>> 7f82783 (ADD ATTENDANCE AND AI MARKIG)
