import { useState } from 'react';

export type ProfileData = {
  programme: string;
  programmeLevel: string;
  programmeType: string;
  standardCode: string;
  qualification: string;
  registrationStatus: string;
  learningProvider: string;
  startDate: string;
  plannedEndDate: string;
  practicalPeriodStart: string;
  practicalPeriodEnd: string;
  plannedHours: number;
  minimumRequiredHours: number;
  currentModule: string;
  expectedGateway: string;
  epaTargetDate: string;
  fullName: string;
  username: string;
  pronouns: string;
  dateOfBirth: string;
  referenceNumber: string;
  groups: string;
  linkedInProfile: string;
  email: string;
  mobile: string;
  landline: string;
  address: string;
  postcode: string;
  country: string;
  employer: string;
  employerAddress: string;
  lineManager: { name: string; email: string; phone: string };
  mentor: { name: string; email: string; phone: string };
  coach: { name: string; email: string; phone: string };
  tutor: { name: string; email: string; phone: string };
  referrer: { name: string; address: string; contact: string };
  markers: string;
  hasDisability: string;
  functionalSkillsMaths: { level: string; date: string };
  functionalSkillsEnglish: { level: string; date: string };
  additionalSupportRequirements: string;
  learningPreferences: string;
  reasonableAdjustments: string;
  supportNotes: string;
  epaStatus: string;
  epaOrganisation: string;
  gatewayDate: string;
  epaPreparationProgress: number;
  mockAssessmentStatus: string;
  portfolioReadiness: string;
  professionalDiscussionReadiness: string;
  interviewReadiness: string;
  onboardingProgress: number;
  onboardingSteps: { label: string; status: 'completed' | 'pending' }[];
  virtualAssistantHistory: { date: string; topic: string; summary: string; status: string }[];
  programmeProgress: number;
  attendanceRate: number;
  sessionsAttended: number;
  sessionsMissed: number;
  otjhCompleted: number;
  otjhTarget: number;
  evidenceSubmitted: number;
  evidenceApproved: number;
  ksbProgress: number;
  ksbTotal: number;
  ksbValidated: number;
  coachingAttendance: number;
  coachingScheduled: number;
  portfolioCompletion: number;
  checkpointProgress: number;
  checkpointsCompleted: number;
  checkpointsTotal: number;
  latestCoachingDate: string;
  latestCoachingTopic: string;
  nextReviewDate: string;
  nextReviewFocus: string;
  status: string;
};

const TABS = [
  'Overview',
  'Programme',
  'Personal',
  'Learning Support',
  'EPA',
  'Onboarding',
  'History',
];

/* ── Info Row ── */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-2.5 border-b border-background-200/50 last:border-b-0">
      <p className="text-[11px] text-foreground-400 font-medium uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-medium text-foreground-800">{value || '—'}</p>
    </div>
  );
}

/* ── Progress Bar ── */
function ProgressBar({ value, max, color = 'primary' }: { value: number; max: number; color?: 'primary' | 'accent' | 'secondary' | 'emerald' | 'amber' | 'red' }) {
  const pct = Math.min((value / max) * 100, 100);
  const colorClass = color === 'emerald' ? 'bg-emerald-500' : color === 'amber' ? 'bg-amber-500' : color === 'red' ? 'bg-red-500' : color === 'accent' ? 'bg-accent-500' : color === 'secondary' ? 'bg-secondary-500' : 'bg-primary-500';
  return (
    <div className="w-full">
      <div className="h-2 rounded-full bg-background-200 overflow-hidden">
        <div className={`h-full rounded-full ${colorClass} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── Status Pill ── */
function StatusPill({ status, color }: { status: string; color: 'green' | 'amber' | 'red' | 'neutral' }) {
  const map = {
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    red: 'bg-red-50 text-red-700 border-red-200',
    neutral: 'bg-background-100 text-foreground-500 border-background-200',
  };
  const dotMap = {
    green: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    neutral: 'bg-foreground-300',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${map[color]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotMap[color]}`} />
      {status}
    </span>
  );
}

/* ── Card Wrapper ── */
function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-background-50 rounded-xl border border-background-200/50 p-5 ${className}`}>
      <h3 className="text-xs font-semibold text-foreground-400 uppercase tracking-wider mb-4 pb-3 border-b border-background-200/50">
        {title}
      </h3>
      {children}
    </div>
  );
}

/* ── Contact Card ── */
function ContactCard({ role, name, email, phone, icon }: { role: string; name: string; email: string; phone: string; icon: string }) {
  return (
    <div className="bg-background-100/60 rounded-xl p-4 border border-background-200/40">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center shrink-0">
          <i className={`${icon} text-base`} />
        </div>
        <div>
          <p className="text-xs text-foreground-400">{role}</p>
          <p className="text-sm font-semibold text-foreground-900">{name}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-foreground-500">
          <i className="ri-mail-line text-foreground-300" />
          <span className="truncate">{email}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-foreground-500">
          <i className="ri-phone-line text-foreground-300" />
          <span>{phone}</span>
        </div>
      </div>
    </div>
  );
}

export function ProfileTabs({ profile: p }: { profile: ProfileData }) {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      {/* Tab Navigation — Modern underline style */}
      <div className="border-b border-background-200/70 px-2 md:px-4">
        <div className="flex items-center gap-0 overflow-x-auto">
          {TABS.map((tab, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-all cursor-pointer relative border-b-2 ${
                activeTab === i
                  ? 'text-primary-600 border-primary-500'
                  : 'text-foreground-400 border-transparent hover:text-foreground-700 hover:border-background-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-4 md:p-6 print:p-2">
        {activeTab === 0 && <OverviewTab p={p} />}
        {activeTab === 1 && <ProgrammeTab p={p} />}
        {activeTab === 2 && <PersonalTab p={p} />}
        {activeTab === 3 && <LearningSupportTab p={p} />}
        {activeTab === 4 && <EPATab p={p} />}
        {activeTab === 5 && <OnboardingTab p={p} />}
        {activeTab === 6 && <HistoryTab p={p} />}
      </div>
    </section>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TAB 0 — OVERVIEW
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function OverviewTab({ p }: { p: ProfileData }) {
  return (
    <div className="space-y-5">
      {/* Key Dates */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-primary-50/60 rounded-xl p-4 border border-primary-200/30">
          <p className="text-xs text-primary-600 font-medium mb-1">Start Date</p>
          <p className="text-sm font-semibold text-foreground-900">{p.startDate}</p>
        </div>
        <div className="bg-accent-50/60 rounded-xl p-4 border border-accent-200/30">
          <p className="text-xs text-accent-600 font-medium mb-1">Planned End</p>
          <p className="text-sm font-semibold text-foreground-900">{p.plannedEndDate}</p>
        </div>
        <div className="bg-secondary-50/60 rounded-xl p-4 border border-secondary-200/30">
          <p className="text-xs text-secondary-600 font-medium mb-1">Expected Gateway</p>
          <p className="text-sm font-semibold text-foreground-900">{p.expectedGateway}</p>
        </div>
        <div className="bg-emerald-50/60 rounded-xl p-4 border border-emerald-200/30">
          <p className="text-xs text-emerald-600 font-medium mb-1">EPA Target</p>
          <p className="text-sm font-semibold text-foreground-900">{p.epaTargetDate}</p>
        </div>
      </div>

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left column */}
        <div className="space-y-5">
          <Card title="Current Status">
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-foreground-700">Programme Progress</span>
                  <span className="text-sm font-semibold text-primary-600">{p.programmeProgress}%</span>
                </div>
                <ProgressBar value={p.programmeProgress} max={100} color="primary" />
                <p className="text-[11px] text-foreground-400 mt-1">{p.currentModule}</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-foreground-700">KSB Progress</span>
                  <span className="text-sm font-semibold text-emerald-600">{p.ksbProgress}%</span>
                </div>
                <ProgressBar value={p.ksbProgress} max={100} color="emerald" />
                <p className="text-[11px] text-foreground-400 mt-1">{p.ksbValidated} of {p.ksbTotal} validated</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-foreground-700">Portfolio Completion</span>
                  <span className="text-sm font-semibold text-accent-600">{p.portfolioCompletion}%</span>
                </div>
                <ProgressBar value={p.portfolioCompletion} max={100} color="accent" />
                <p className="text-[11px] text-foreground-400 mt-1">In progress</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-foreground-700">Onboarding</span>
                  <span className="text-sm font-semibold text-secondary-600">{p.onboardingProgress}%</span>
                </div>
                <ProgressBar value={p.onboardingProgress} max={100} color="secondary" />
                <p className="text-[11px] text-foreground-400 mt-1">{p.onboardingSteps.filter(s => s.status === 'completed').length} of {p.onboardingSteps.length} steps</p>
              </div>
            </div>
          </Card>

          <Card title="Functional Skills">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-background-100/60 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                    <i className="ri-calculator-line text-sm" />
                  </div>
                  <span className="text-sm font-semibold text-foreground-900">Maths</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground-400">Level</span>
                    <span className="text-xs font-semibold text-foreground-800 bg-background-50 px-2 py-0.5 rounded">{p.functionalSkillsMaths.level}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground-400">Date</span>
                    <span className="text-xs text-foreground-600">{p.functionalSkillsMaths.date}</span>
                  </div>
                </div>
              </div>
              <div className="bg-background-100/60 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-accent-100 text-accent-600 flex items-center justify-center">
                    <i className="ri-english-input text-sm" />
                  </div>
                  <span className="text-sm font-semibold text-foreground-900">English</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground-400">Level</span>
                    <span className="text-xs font-semibold text-foreground-800 bg-background-50 px-2 py-0.5 rounded">{p.functionalSkillsEnglish.level}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-foreground-400">Date</span>
                    <span className="text-xs text-foreground-600">{p.functionalSkillsEnglish.date}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <Card title="Your Team">
            <div className="space-y-3">
              <ContactCard role="Coach" name={p.coach.name} email={p.coach.email} phone={p.coach.phone} icon="ri-user-star-line" />
              <ContactCard role="Tutor" name={p.tutor.name} email={p.tutor.email} phone={p.tutor.phone} icon="ri-graduation-cap-line" />
              <ContactCard role="Line Manager" name={p.lineManager.name} email={p.lineManager.email} phone={p.lineManager.phone} icon="ri-briefcase-line" />
              <ContactCard role="Mentor" name={p.mentor.name} email={p.mentor.email} phone={p.mentor.phone} icon="ri-user-heart-line" />
            </div>
          </Card>

          <Card title="Learning Support">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground-700">Learning Difficulties / Disabilities</span>
                <StatusPill status={p.hasDisability} color={p.hasDisability === 'Yes' ? 'amber' : 'green'} />
              </div>
              <InfoRow label="Learning Preferences" value={p.learningPreferences} />
              <InfoRow label="Reasonable Adjustments" value={p.reasonableAdjustments} />
              <div className="bg-background-100/60 rounded-lg p-3 mt-2">
                <p className="text-xs text-foreground-400 mb-1">Support Notes</p>
                <p className="text-sm text-foreground-600 leading-relaxed">{p.supportNotes}</p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TAB 1 — PROGRAMME DETAILS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function ProgrammeTab({ p }: { p: ProfileData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Programme Information">
          <div className="space-y-1">
            <InfoRow label="Programme Type" value={p.programmeType} />
            <InfoRow label="Programme Name" value={`${p.programme} — ${p.programmeLevel}`} />
            <InfoRow label="Standard Code" value={p.standardCode} />
            <InfoRow label="Registration Status" value={p.registrationStatus} />
            <InfoRow label="Learning Provider" value={p.learningProvider} />
            <InfoRow label="Qualification" value={p.qualification} />
          </div>
        </Card>

        <Card title="Dates & Hours">
          <div className="space-y-1">
            <InfoRow label="Start Date" value={p.startDate} />
            <InfoRow label="Planned End Date" value={p.plannedEndDate} />
            <InfoRow label="Practical Period Start" value={p.practicalPeriodStart} />
            <InfoRow label="Practical Period End" value={p.practicalPeriodEnd} />
            <InfoRow label="Planned Hours" value={p.plannedHours.toString()} />
            <InfoRow label="Minimum Required Hours" value={p.minimumRequiredHours.toString()} />
          </div>
        </Card>
      </div>

      <Card title="Gateway & EPA">
        <div className="space-y-1">
          <InfoRow label="Expected Gateway" value={p.expectedGateway} />
          <InfoRow label="EPA Target Date" value={p.epaTargetDate} />
          <InfoRow label="Current Module" value={p.currentModule} />
        </div>
      </Card>

      <Card title="Progress Summary">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="text-center p-3">
            <p className="text-2xl font-heading font-bold text-primary-600">{p.programmeProgress}%</p>
            <p className="text-xs text-foreground-400 mt-1">Programme Progress</p>
          </div>
          <div className="text-center p-3">
            <p className="text-2xl font-heading font-bold text-emerald-600">{p.ksbProgress}%</p>
            <p className="text-xs text-foreground-400 mt-1">KSB Progress</p>
          </div>
          <div className="text-center p-3">
            <p className="text-2xl font-heading font-bold text-accent-600">{p.evidenceSubmitted}</p>
            <p className="text-xs text-foreground-400 mt-1">Evidence Submitted</p>
          </div>
          <div className="text-center p-3">
            <p className="text-2xl font-heading font-bold text-secondary-600">{p.portfolioCompletion}%</p>
            <p className="text-xs text-foreground-400 mt-1">Portfolio Completion</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TAB 2 — LEARNER DETAILS
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function PersonalTab({ p }: { p: ProfileData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Personal Details">
          <div className="space-y-1">
            <InfoRow label="Full Name" value={p.fullName} />
            <InfoRow label="Username" value={p.username} />
            <InfoRow label="Pronouns" value={p.pronouns} />
            <InfoRow label="Date of Birth" value={p.dateOfBirth} />
            <InfoRow label="Reference Number" value={p.referenceNumber} />
            <InfoRow label="Groups" value={p.groups} />
          </div>
        </Card>

        <Card title="Contact Information">
          <div className="space-y-1">
            <InfoRow label="Email" value={p.email} />
            <InfoRow label="Mobile" value={p.mobile} />
            <InfoRow label="Landline" value={p.landline} />
            <InfoRow label="Address" value={p.address} />
            <InfoRow label="Postcode" value={p.postcode} />
            <InfoRow label="Country" value={p.country} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card title="Employer Information">
          <div className="space-y-1">
            <InfoRow label="Employer" value={p.employer} />
            <InfoRow label="Employer Address" value={p.employerAddress} />
          </div>
        </Card>

        <Card title="Additional Information">
          <div className="space-y-1">
            <InfoRow label="LinkedIn Profile" value={p.linkedInProfile} />
            <InfoRow label="Markers" value={p.markers} />
          </div>
        </Card>
      </div>

      <Card title="Your Team">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ContactCard role="Coach" name={p.coach.name} email={p.coach.email} phone={p.coach.phone} icon="ri-user-star-line" />
          <ContactCard role="Tutor" name={p.tutor.name} email={p.tutor.email} phone={p.tutor.phone} icon="ri-graduation-cap-line" />
          <ContactCard role="Line Manager" name={p.lineManager.name} email={p.lineManager.email} phone={p.lineManager.phone} icon="ri-briefcase-line" />
          <ContactCard role="Mentor" name={p.mentor.name} email={p.mentor.email} phone={p.mentor.phone} icon="ri-user-heart-line" />
        </div>
      </Card>

      <Card title="Referrer">
        <div className="space-y-1">
          <InfoRow label="Referrer" value={p.referrer.name} />
          <InfoRow label="Referrer Address" value={p.referrer.address} />
          <InfoRow label="Referrer Contact" value={p.referrer.contact} />
        </div>
      </Card>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TAB 3 — LEARNING SUPPORT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function LearningSupportTab({ p }: { p: ProfileData }) {
  return (
    <div className="space-y-5">
      <Card title="Learning Difficulties, Disabilities & Health Problems">
        <div className="space-y-3">
          <p className="text-sm text-foreground-600">Does the learner consider themselves to have a long-term disability, health problem and/or learning difficulties?</p>
          <StatusPill status={p.hasDisability} color={p.hasDisability === 'Yes' ? 'amber' : 'green'} />
        </div>
      </Card>

      <Card title="Initial Assessments — Functional Skills">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-background-100/60 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center">
                <i className="ri-calculator-line text-base" />
              </div>
              <p className="text-sm font-semibold text-foreground-900">Maths</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1.5 border-b border-background-200/40">
                <span className="text-xs text-foreground-400">Level</span>
                <span className="text-sm font-semibold text-foreground-800 bg-background-50 px-2 py-0.5 rounded">{p.functionalSkillsMaths.level}</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-foreground-400">Assessment Date</span>
                <span className="text-sm text-foreground-700">{p.functionalSkillsMaths.date}</span>
              </div>
            </div>
          </div>
          <div className="bg-background-100/60 rounded-lg p-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-accent-100 text-accent-600 flex items-center justify-center">
                <i className="ri-english-input text-base" />
              </div>
              <p className="text-sm font-semibold text-foreground-900">English</p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-1.5 border-b border-background-200/40">
                <span className="text-xs text-foreground-400">Level</span>
                <span className="text-sm font-semibold text-foreground-800 bg-background-50 px-2 py-0.5 rounded">{p.functionalSkillsEnglish.level}</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-xs text-foreground-400">Assessment Date</span>
                <span className="text-sm text-foreground-700">{p.functionalSkillsEnglish.date}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Additional Support Requirements">
        <div className="space-y-1">
          <InfoRow label="Learning Preferences" value={p.learningPreferences} />
          <InfoRow label="Reasonable Adjustments" value={p.reasonableAdjustments} />
        </div>
      </Card>

      <Card title="Support Notes">
        <p className="text-sm text-foreground-600 leading-relaxed">{p.supportNotes}</p>
      </Card>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TAB 4 — END-POINT ASSESSMENT
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function EPATab({ p }: { p: ProfileData }) {
  const readinessColor = (status: string): 'green' | 'amber' | 'red' => {
    if (status === 'Ready' || status === 'Completed') return 'green';
    if (status === 'Developing' || status === 'In Progress') return 'amber';
    return 'red';
  };

  return (
    <div className="space-y-5">
      <Card title="EPA Status">
        <div className="space-y-1">
          <InfoRow label="EPA Status" value={p.epaStatus} />
          <InfoRow label="EPA Organisation" value={p.epaOrganisation} />
          <InfoRow label="Gateway Date" value={p.gatewayDate} />
          <InfoRow label="EPA Target Date" value={p.epaTargetDate} />
        </div>
      </Card>

      <Card title="Readiness Indicators">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-foreground-700">EPA Preparation Progress</span>
              <span className="text-sm font-semibold text-accent-600">{p.epaPreparationProgress}%</span>
            </div>
            <ProgressBar value={p.epaPreparationProgress} max={100} color="accent" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-background-100/60 rounded-lg p-4">
              <p className="text-xs text-foreground-400 font-medium uppercase tracking-wider mb-2">Portfolio Readiness</p>
              <StatusPill status={p.portfolioReadiness} color={readinessColor(p.portfolioReadiness)} />
            </div>
            <div className="bg-background-100/60 rounded-lg p-4">
              <p className="text-xs text-foreground-400 font-medium uppercase tracking-wider mb-2">Professional Discussion</p>
              <StatusPill status={p.professionalDiscussionReadiness} color={readinessColor(p.professionalDiscussionReadiness)} />
            </div>
            <div className="bg-background-100/60 rounded-lg p-4">
              <p className="text-xs text-foreground-400 font-medium uppercase tracking-wider mb-2">Interview Readiness</p>
              <StatusPill status={p.interviewReadiness} color={readinessColor(p.interviewReadiness)} />
            </div>
          </div>

          <div className="bg-background-100/60 rounded-lg p-4">
            <p className="text-xs text-foreground-400 font-medium uppercase tracking-wider mb-1">Mock Assessment Status</p>
            <p className="text-sm font-medium text-foreground-700">{p.mockAssessmentStatus}</p>
          </div>
        </div>
      </Card>

      <div className="bg-primary-50/40 rounded-xl border border-primary-200/40 p-4">
        <div className="flex items-start gap-3">
          <i className="ri-information-line text-primary-500 text-lg mt-0.5" />
          <p className="text-sm text-foreground-600 leading-relaxed">EPA information will become available as the learner approaches gateway.</p>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TAB 5 — ONBOARDING
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function OnboardingTab({ p }: { p: ProfileData }) {
  return (
    <div className="space-y-5">
      <Card title="Onboarding Progress" className="max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Overall Progress</h3>
          <span className="text-2xl font-heading font-bold text-accent-600">{p.onboardingProgress}%</span>
        </div>

        <div className="h-2.5 rounded-full bg-background-200 overflow-hidden mb-6">
          <div className="h-full rounded-full bg-accent-500 transition-all duration-700" style={{ width: `${p.onboardingProgress}%` }} />
        </div>

        <div className="relative">
          <div className="absolute left-[17px] top-3 bottom-3 w-px bg-background-200" />
          <div className="space-y-0">
            {p.onboardingSteps.map((step, i) => (
              <div key={i} className="relative flex items-center gap-3.5 py-3">
                <div className={`relative z-10 w-3.5 h-3.5 rounded-full shrink-0 ${
                  step.status === 'completed'
                    ? 'bg-emerald-500 ring-4 ring-emerald-100'
                    : 'bg-background-300 ring-2 ring-background-100'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${step.status === 'completed' ? 'text-foreground-900' : 'text-foreground-400'}`}>
                    {step.label}
                  </p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                  step.status === 'completed'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-background-100 text-foreground-400'
                }`}>
                  {step.status === 'completed' ? (
                    <span className="flex items-center gap-1">
                      <i className="ri-check-line text-xs" /> Complete
                    </span>
                  ) : (
                    'Pending'
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   TAB 6 — VIRTUAL ASSISTANT HISTORY
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function HistoryTab({ p }: { p: ProfileData }) {
  if (p.virtualAssistantHistory.length === 0) {
    return (
      <div className="bg-background-50 rounded-xl border border-background-200/50 p-8">
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-14 h-14 rounded-full bg-background-100 flex items-center justify-center mb-4">
            <i className="ri-robot-line text-foreground-300 text-2xl" />
          </div>
          <p className="text-sm font-semibold text-foreground-500 mb-1">No virtual assistant history available yet.</p>
          <p className="text-sm text-foreground-400">Conversations with the virtual assistant will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-background-200">
              <th className="pb-3 text-xs font-semibold text-foreground-400 font-label uppercase tracking-wider px-4">Date</th>
              <th className="pb-3 text-xs font-semibold text-foreground-400 font-label uppercase tracking-wider px-4">Topic</th>
              <th className="pb-3 text-xs font-semibold text-foreground-400 font-label uppercase tracking-wider px-4">Summary</th>
              <th className="pb-3 text-xs font-semibold text-foreground-400 font-label uppercase tracking-wider px-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {p.virtualAssistantHistory.map((row, i) => (
              <tr key={i} className="border-b border-background-100">
                <td className="py-3 px-4 text-sm text-foreground-600 whitespace-nowrap">{row.date}</td>
                <td className="py-3 px-4 text-sm font-medium text-foreground-900 whitespace-nowrap">{row.topic}</td>
                <td className="py-3 px-4 text-sm text-foreground-500">{row.summary}</td>
                <td className="py-3 px-4 whitespace-nowrap">
                  <StatusPill
                    status={row.status}
                    color={row.status === 'Resolved' ? 'green' : row.status === 'Active' ? 'amber' : 'neutral'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}