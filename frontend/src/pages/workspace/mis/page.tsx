import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { WorkspaceHeroBanner } from '@/components/feature/WorkspaceHeroBanner';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

type TabKey = 'cohorts' | 'timetable' | 'teams' | 'assignment';

interface CohortRecord {
  id: string;
  name: string;
  programme: string;
  level: number;
  learners: number;
  startDate: string;
  endDate: string;
  status: string;
  coach: string;
  tutor: string;
  sessionsPerWeek: number;
}

const COHORTS: CohortRecord[] = [
  { id: 'co-a', name: 'Cohort A — BA', programme: 'Business Administrator', level: 3, learners: 14, startDate: 'Sep 2025', endDate: 'Mar 2027', status: 'Active', coach: 'Med Maher', tutor: 'Rachel Myers', sessionsPerWeek: 2 },
  { id: 'co-b', name: 'Cohort B — DM', programme: 'Digital Marketer', level: 3, learners: 10, startDate: 'Jan 2026', endDate: 'Jul 2027', status: 'Active', coach: 'Sarah Chen', tutor: 'Dr. Helen Park', sessionsPerWeek: 1 },
  { id: 'co-c', name: 'Cohort C — BA', programme: 'Business Administrator', level: 3, learners: 8, startDate: 'Mar 2026', endDate: 'Sep 2027', status: 'Active', coach: 'Med Maher', tutor: 'Crispin Jones', sessionsPerWeek: 2 },
  { id: 'co-d', name: 'Cohort D — DT', programme: 'Data Technician', level: 3, learners: 12, startDate: 'May 2026', endDate: 'Nov 2027', status: 'Active', coach: 'James Porter', tutor: 'Dr. Helen Park', sessionsPerWeek: 1 },
  { id: 'co-e', name: 'Cohort E — EYE', programme: 'Early Years Educator', level: 3, learners: 9, startDate: 'Jun 2026', endDate: 'Dec 2027', status: 'Starting', coach: 'Aisha Khan', tutor: 'Louise Baker', sessionsPerWeek: 2 },
  { id: 'co-f', name: 'Cohort F — SWE', programme: 'Software Developer', level: 4, learners: 6, startDate: 'Sep 2026', endDate: 'Mar 2028', status: 'Scheduled', coach: 'Tom Briggs', tutor: 'Mike Harrison', sessionsPerWeek: 1 },
];

const TIMETABLE_SESSIONS = [
  { day: 'Mon', time: '09:00–11:00', module: 'Business Communication', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', platform: 'Teams Live' as const, learners: 14 },
  { day: 'Mon', time: '11:00–13:00', module: 'Data Analysis & Visualisation', cohort: 'Cohort D — DT', tutor: 'Dr. Helen Park', platform: 'Teams Live' as const, learners: 12 },
  { day: 'Tue', time: '09:00–11:00', module: 'Child Development', cohort: 'Cohort E — EYE', tutor: 'Louise Baker', platform: 'Teams Live' as const, learners: 9 },
  { day: 'Tue', time: '14:00–16:00', module: 'Marketing Principles', cohort: 'Cohort B — DM', tutor: 'Dr. Helen Park', platform: 'Teams Live' as const, learners: 10 },
  { day: 'Wed', time: '09:00–11:00', module: 'Customer Segmentation', cohort: 'Cohort C — BA', tutor: 'Crispin Jones', platform: 'Teams Live' as const, learners: 8 },
  { day: 'Wed', time: '11:00–12:00', module: 'Coaching (1:1)', cohort: 'Mixed', tutor: '—', platform: 'Teams 1:1' as const, learners: 24 },
  { day: 'Thu', time: '09:00–11:00', module: 'Programming Fundamentals', cohort: 'Cohort F — SWE', tutor: 'Mike Harrison', platform: 'Teams Live' as const, learners: 6 },
  { day: 'Thu', time: '14:00–16:00', module: 'Digital Channels', cohort: 'Cohort B — DM', tutor: 'Dr. Helen Park', platform: 'Teams Live' as const, learners: 10 },
  { day: 'Fri', time: '09:00–11:00', module: 'Business Admin Practice', cohort: 'Cohort A — BA', tutor: 'Rachel Myers', platform: 'Teams Live' as const, learners: 14 },
  { day: 'Fri', time: '14:00–16:00', module: 'Marketing Planning', cohort: 'Cohort C — BA', tutor: 'Crispin Jones', platform: 'Teams Live' as const, learners: 8 },
];

const COACH_ASSIGNMENTS = [
  { coach: 'Med Maher', caseload: 24, cohorts: ['Cohort A — BA', 'Cohort C — BA'], learners: 22, availability: 2, status: 'At capacity' as const },
  { coach: 'Sarah Chen', caseload: 18, cohorts: ['Cohort B — DM'], learners: 10, availability: 8, status: 'Available' as const },
  { coach: 'James Porter', caseload: 16, cohorts: ['Cohort D — DT'], learners: 12, availability: 4, status: 'Available' as const },
  { coach: 'Aisha Khan', caseload: 15, cohorts: ['Cohort E — EYE'], learners: 9, availability: 6, status: 'Available' as const },
  { coach: 'Tom Briggs', caseload: 10, cohorts: ['Cohort F — SWE'], learners: 6, availability: 12, status: 'Available' as const },
];

const TUTOR_ASSIGNMENTS = [
  { tutor: 'Rachel Myers', sessionsPerWeek: 4, cohorts: ['Cohort A — BA'], learners: 14, specialism: 'Business Admin', status: 'Active' as const },
  { tutor: 'Dr. Helen Park', sessionsPerWeek: 6, cohorts: ['Cohort B — DM', 'Cohort D — DT'], learners: 22, specialism: 'Marketing & Data', status: 'Heavy load' as const },
  { tutor: 'Crispin Jones', sessionsPerWeek: 4, cohorts: ['Cohort C — BA'], learners: 8, specialism: 'Marketing Planning', status: 'Active' as const },
  { tutor: 'Louise Baker', sessionsPerWeek: 2, cohorts: ['Cohort E — EYE'], learners: 9, specialism: 'Early Years', status: 'Active' as const },
  { tutor: 'Mike Harrison', sessionsPerWeek: 2, cohorts: ['Cohort F — SWE'], learners: 6, specialism: 'Software Development', status: 'Active' as const },
];

export default function MISDashboard() {
  const [activeTab, setActiveTab] = useState<TabKey>('cohorts');

  const totalLearners = COHORTS.reduce((s, c) => s + c.learners, 0);
  const activeCohorts = COHORTS.filter(c => c.status === 'Active').length;
  const totalSessions = TIMETABLE_SESSIONS.length;

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="MIS Operations Centre" pageSubtitle="Cohort allocation, timetable scheduling, Teams sessions management, coach/tutor assignment"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <WorkspaceHeroBanner
          title="MIS Operations Centre"
          description={`${activeCohorts} active cohorts with ${totalLearners} learners across 5 programmes. ${totalSessions} Teams sessions scheduled this week. ${COACH_ASSIGNMENTS.filter(c => c.status === 'At capacity').length} coach at capacity.`}
          icon="ri-database-2-line"
          imageUrl="https://readdy.ai/api/search-image?query=UK%20England%20map%20outline%20counties%20regions%20education%20apprenticeship%20provider%20professional%20gold%20purple%20accent%20editorial%20photography%20dark%20background%20minimalist&width=400&height=160&seq=mis-cohort-map-01&orientation=landscape"
          imageAlt="MIS cohort map UK"
          stats={[
            { label: 'Cohorts', value: String(COHORTS.length) },
            { label: 'Learners', value: String(totalLearners) },
            { label: 'Sessions', value: String(totalSessions) },
          ]}
        />

        {/* Stat Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MisStatCard label="Active Cohorts" value={String(activeCohorts)} sub={`${COHORTS.length} total`} icon="ri-group-line" color="primary" />
          <MisStatCard label="Weekly Sessions" value={String(totalSessions)} sub="Across 5 programmes" icon="ri-calendar-line" color="accent" />
          <MisStatCard label="Coaches" value="5" sub={`${COACH_ASSIGNMENTS.filter(c => c.status === 'At capacity').length} at capacity`} icon="ri-heart-line" color="secondary" />
          <MisStatCard label="Tutors" value="5" sub={`${TUTOR_ASSIGNMENTS.filter(t => t.status === 'Heavy load').length} heavy load`} icon="ri-user-settings-line" color="primary" />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {([
            { key: 'cohorts' as TabKey, label: 'Cohort Allocation', icon: 'ri-group-line', badge: COHORTS.length },
            { key: 'timetable' as TabKey, label: 'Weekly Timetable', icon: 'ri-calendar-line', badge: totalSessions },
            { key: 'teams' as TabKey, label: 'Teams Sessions', icon: 'ri-video-line' },
            { key: 'assignment' as TabKey, label: 'Coach/Tutor Assignment', icon: 'ri-user-settings-line' },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
                activeTab === tab.key ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
              }`}
            >
              <AppIcon className={`${tab.icon} text-sm`}></AppIcon>
              {tab.label}
              {tab.badge != null && (
                <span className="bg-primary-100 text-primary-700 text-[10px] px-1.5 py-0.5 rounded-full leading-none">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Cohorts */}
        {activeTab === 'cohorts' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Cohort Allocation Overview</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">All cohorts with learner counts, programme details, and delivery status</p>
              </div>
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-add-line mr-1"></AppIcon> New Cohort
              </button>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {COHORTS.map(cohort => (
                  <div key={cohort.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className={`rounded-lg px-3 py-2 text-center shrink-0 min-w-[70px] ${
                      cohort.status === 'Active' ? 'bg-emerald-100 text-emerald-700' :
                      cohort.status === 'Starting' ? 'bg-primary-100 text-primary-700' :
                      'bg-foreground-100 text-foreground-500'
                    }`}>
                      <p className="text-xs font-bold">{cohort.learners}</p>
                      <p className="text-[9px] font-medium">learners</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground-900">{cohort.name}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                        <span className="text-[11px] text-foreground-400">{cohort.programme} L{cohort.level}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{cohort.startDate} — {cohort.endDate}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap">
                      <span className="text-foreground-400">Coach: <strong>{cohort.coach}</strong></span>
                      <span className="text-foreground-400">Tutor: <strong>{cohort.tutor}</strong></span>
                      <span className="text-foreground-400">{cohort.sessionsPerWeek} sessions/wk</span>
                      <span className={`font-semibold px-2 py-0.5 rounded-full ${
                        cohort.status === 'Active' ? 'bg-emerald-100 text-emerald-700' :
                        cohort.status === 'Starting' ? 'bg-primary-100 text-primary-700' :
                        'bg-foreground-100 text-foreground-500'
                      }`}>{cohort.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Timetable */}
        {activeTab === 'timetable' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Weekly Timetable</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">All scheduled sessions across cohorts — Week 24, June 2026</p>
              </div>
              <button className="text-[12px] text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap">
                <AppIcon className="ri-calendar-2-line mr-1"></AppIcon> Full Calendar
              </button>
            </div>
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="divide-y divide-background-200/30">
                {TIMETABLE_SESSIONS.map((s, i) => (
                  <div key={i} className="p-3.5 flex items-center gap-4">
                    <div className="text-center shrink-0 w-14">
                      <p className="text-[10px] text-foreground-400 uppercase font-semibold tracking-wider">{s.day}</p>
                      <p className="text-[11px] text-foreground-600 font-medium">{s.time}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-foreground-900">{s.module}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-foreground-400">{s.cohort}</span>
                        <span className="text-[8px] text-foreground-300">&middot;</span>
                        <span className="text-[11px] text-foreground-400">{s.tutor !== '—' ? `Tutor: ${s.tutor}` : s.tutor}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">{s.platform}</span>
                      <span className="text-[11px] text-foreground-400">{s.learners} learners</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Teams Sessions */}
        {activeTab === 'teams' && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-heading font-semibold text-foreground-900">Microsoft Teams Sessions</h3>
                <p className="text-[11px] text-foreground-400 mt-0.5">Live and 1:1 sessions running this week across all cohorts</p>
              </div>
              <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                <AppIcon className="ri-add-line mr-1"></AppIcon> Schedule Session
              </button>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {TIMETABLE_SESSIONS.map((s, i) => (
                <div key={i} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium">
                  <div className="flex items-start justify-between mb-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      s.platform === 'Teams Live' ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-700'
                    }`}>{s.platform}</span>
                    <span className="text-[10px] text-foreground-400">{s.day} {s.time}</span>
                  </div>
                  <h4 className="text-sm font-semibold text-foreground-900 mb-2">{s.module}</h4>
                  <div className="space-y-1 text-[11px] text-foreground-400">
                    <p><AppIcon className="ri-group-line mr-1 text-[10px]"></AppIcon> {s.cohort} — {s.learners} learners</p>
                    {s.tutor !== '—' && <p><AppIcon className="ri-user-settings-line mr-1 text-[10px]"></AppIcon> Tutor: {s.tutor}</p>}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-video-line mr-1"></AppIcon> Join
                    </button>
                    <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">
                      <AppIcon className="ri-settings-3-line mr-1"></AppIcon> Settings
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Coach/Tutor Assignment */}
        {activeTab === 'assignment' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Coach Assignment */}
            <section>
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Coach Assignment</h3>
              <div className="space-y-2">
                {COACH_ASSIGNMENTS.map((c, i) => (
                  <div key={i} className={`bg-background-50 rounded-xl border p-4 card-premium ${c.status === 'At capacity' ? 'border-amber-200/50 bg-amber-50/20' : 'border-foreground-200/60'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                          c.status === 'At capacity' ? 'bg-amber-100 text-amber-700' : 'bg-primary-100 text-primary-700'
                        }`}>{c.coach.charAt(0)}</div>
                        <div>
                          <p className="text-sm font-semibold text-foreground-900">{c.coach}</p>
                          <p className="text-[11px] text-foreground-400">{c.cohorts.join(', ')}</p>
                        </div>
                      </div>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        c.status === 'At capacity' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>{c.status}</span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-foreground-400">
                      <span>Caseload: <strong className="text-foreground-700">{c.caseload}</strong></span>
                      <span>Learners: <strong className="text-foreground-700">{c.learners}</strong></span>
                      <span>Available: <strong className="text-foreground-700">{c.availability} slots</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Tutor Assignment */}
            <section>
              <h3 className="text-sm font-heading font-semibold text-foreground-900 mb-4">Tutor Assignment</h3>
              <div className="space-y-2">
                {TUTOR_ASSIGNMENTS.map((t, i) => (
                  <div key={i} className={`bg-background-50 rounded-xl border p-4 card-premium ${t.status === 'Heavy load' ? 'border-amber-200/50 bg-amber-50/20' : 'border-foreground-200/60'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                          t.status === 'Heavy load' ? 'bg-amber-100 text-amber-700' : 'bg-secondary-100 text-secondary-700'
                        }`}>{t.tutor.charAt(0)}</div>
                        <div>
                          <p className="text-sm font-semibold text-foreground-900">{t.tutor}</p>
                          <p className="text-[11px] text-foreground-400">{t.specialism}</p>
                        </div>
                      </div>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                        t.status === 'Heavy load' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>{t.status}</span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-foreground-400">
                      <span>Sessions: <strong className="text-foreground-700">{t.sessionsPerWeek}/wk</strong></span>
                      <span>Learners: <strong className="text-foreground-700">{t.learners}</strong></span>
                      <span>Cohorts: <strong className="text-foreground-700">{t.cohorts.length}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function MisStatCard({ label, value, sub, icon, color }: { label: string; value: string; sub: string; icon: string; color: string }) {
  const iconBg = color === 'primary' ? 'bg-primary-100 text-primary-600'
    : color === 'accent' ? 'bg-accent-50 text-accent-700'
    : 'bg-secondary-100 text-secondary-600';

  return (
    <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 card-premium cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${iconBg}`}>
          <AppIcon className={`${icon} text-sm`}></AppIcon>
        </span>
      </div>
      <p className="text-[11px] text-foreground-400 mb-1">{label}</p>
      <p className="text-2xl font-heading font-semibold text-foreground-900">{value}</p>
      <p className="text-[11px] text-foreground-400 mt-1">{sub}</p>
    </div>
  );
}