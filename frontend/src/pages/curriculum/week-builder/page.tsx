import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const curriculumNav = roleNavMap.curriculum;

interface WeekDay {
  day: string;
  date: string;
  components: { id: string; title: string; type: string; duration: string; ksb: string; delivery: string }[];
}

interface Week {
  id: string;
  label: string;
  theme: string;
  module: string;
  programme: string;
  status: 'published' | 'draft' | 'review';
  days: WeekDay[];
}

const WEEKS: Week[] = [
  {
    id: 'wk-01', label: 'Week 1', theme: 'Introduction to Business Communication', module: 'Business Communication', programme: 'Business Admin L3',
    status: 'published',
    days: [
      { day: 'Mon', date: '1 Sep', components: [{ id: 'c1', title: 'Welcome & Icebreaker', type: 'Live Session', duration: '60 min', ksb: 'B1, B2', delivery: 'Teams' }, { id: 'c2', title: 'Module Overview & Learning Outcomes', type: 'Self-study', duration: '30 min', ksb: 'K1', delivery: 'LMS' }] },
      { day: 'Tue', date: '2 Sep', components: [{ id: 'c3', title: 'Communication Models', type: 'Workshop', duration: '90 min', ksb: 'K1, K2', delivery: 'Teams' }, { id: 'c4', title: 'Reflective Journal', type: 'Assignment', duration: '45 min', ksb: 'S1, B2', delivery: 'LMS' }] },
      { day: 'Wed', date: '3 Sep', components: [{ id: 'c5', title: 'Barriers to Communication', type: 'Self-study', duration: '45 min', ksb: 'K2, K3', delivery: 'LMS' }] },
      { day: 'Thu', date: '4 Sep', components: [{ id: 'c6', title: 'Practical Communication Scenarios', type: 'Workshop', duration: '90 min', ksb: 'S1, S2', delivery: 'Teams' }, { id: 'c7', title: 'Quiz — Communication Basics', type: 'Quiz', duration: '20 min', ksb: 'K1, K2, K3', delivery: 'LMS' }] },
      { day: 'Fri', date: '5 Sep', components: [{ id: 'c8', title: 'Weekly Reflection & OTJH Log', type: 'OTJH', duration: '30 min', ksb: 'B1, B2', delivery: 'LMS' }, { id: 'c9', title: 'Group Discussion Board', type: 'Collaboration', duration: '30 min', ksb: 'S1, B2', delivery: 'LMS' }] },
    ],
  },
  {
    id: 'wk-02', label: 'Week 2', theme: 'Professional Written Communication', module: 'Business Communication', programme: 'Business Admin L3',
    status: 'published',
    days: [
      { day: 'Mon', date: '8 Sep', components: [{ id: 'c10', title: 'Email Etiquette & Best Practice', type: 'Live Session', duration: '60 min', ksb: 'K4, S3', delivery: 'Teams' }, { id: 'c11', title: 'Email Writing Exercise', type: 'Assignment', duration: '45 min', ksb: 'S3', delivery: 'LMS' }] },
      { day: 'Tue', date: '9 Sep', components: [{ id: 'c12', title: 'Report Structure & Formats', type: 'Workshop', duration: '90 min', ksb: 'K4, K5', delivery: 'Teams' }] },
      { day: 'Wed', date: '10 Sep', components: [{ id: 'c13', title: 'Business Report Drafting', type: 'Assignment', duration: '60 min', ksb: 'K4, S3, S4', delivery: 'LMS' }] },
      { day: 'Thu', date: '11 Sep', components: [{ id: 'c14', title: 'Peer Review Session', type: 'Collaboration', duration: '60 min', ksb: 'S3, B2', delivery: 'Teams' }, { id: 'c15', title: 'Proofreading Checklist', type: 'Self-study', duration: '20 min', ksb: 'K4', delivery: 'LMS' }] },
      { day: 'Fri', date: '12 Sep', components: [{ id: 'c16', title: 'Quiz — Written Communication', type: 'Quiz', duration: '25 min', ksb: 'K4, K5', delivery: 'LMS' }, { id: 'c17', title: 'OTJH Log Entry', type: 'OTJH', duration: '20 min', ksb: 'B1, B2', delivery: 'LMS' }] },
    ],
  },
  {
    id: 'wk-03', label: 'Week 3', theme: 'Verbal & Non-Verbal Communication', module: 'Business Communication', programme: 'Business Admin L3',
    status: 'draft',
    days: [
      { day: 'Mon', date: '15 Sep', components: [{ id: 'c18', title: 'Active Listening Techniques', type: 'Live Session', duration: '60 min', ksb: 'K6, S5', delivery: 'Teams' }] },
      { day: 'Tue', date: '16 Sep', components: [{ id: 'c19', title: 'Body Language & Non-verbal Cues', type: 'Workshop', duration: '90 min', ksb: 'K6, K7', delivery: 'Teams' }] },
      { day: 'Wed', date: '17 Sep', components: [{ id: 'c20', title: 'Role-play Scenarios', type: 'Workshop', duration: '90 min', ksb: 'S5, B2', delivery: 'Teams' }] },
      { day: 'Thu', date: '18 Sep', components: [{ id: 'c21', title: 'Presentation Skills Practice', type: 'Assignment', duration: '60 min', ksb: 'S5, S6', delivery: 'LMS' }] },
      { day: 'Fri', date: '19 Sep', components: [{ id: 'c22', title: 'Weekly Quiz & Reflection', type: 'Quiz', duration: '20 min', ksb: 'K6, K7', delivery: 'LMS' }] },
    ],
  },
  {
    id: 'wk-04', label: 'Week 4', theme: 'Data Presentation & Visuals', module: 'Data Visualisation', programme: 'Data Analyst L4',
    status: 'published',
    days: [
      { day: 'Mon', date: '22 Sep', components: [{ id: 'c23', title: 'Chart Selection Principles', type: 'Live Session', duration: '60 min', ksb: 'K10, S9', delivery: 'Teams' }, { id: 'c24', title: 'Data Storytelling Introduction', type: 'Self-study', duration: '30 min', ksb: 'K10', delivery: 'LMS' }] },
      { day: 'Tue', date: '23 Sep', components: [{ id: 'c25', title: 'Tableau Workshop — Basic Dashboards', type: 'Workshop', duration: '120 min', ksb: 'S9, S10', delivery: 'Teams' }] },
      { day: 'Wed', date: '24 Sep', components: [{ id: 'c26', title: 'Dashboard Build Exercise', type: 'Assignment', duration: '90 min', ksb: 'S9, S10', delivery: 'LMS' }] },
      { day: 'Thu', date: '25 Sep', components: [{ id: 'c27', title: 'Dashboard Peer Review', type: 'Collaboration', duration: '60 min', ksb: 'S10, B3', delivery: 'Teams' }] },
      { day: 'Fri', date: '26 Sep', components: [{ id: 'c28', title: 'Data Viz Quiz', type: 'Quiz', duration: '20 min', ksb: 'K10', delivery: 'LMS' }] },
    ],
  },
];

export default function WeekBuilderPage() {
  const [selectedWeek, setSelectedWeek] = useState<Week>(WEEKS[0]);
  const [selectedDay, setSelectedDay] = useState<number>(0);
  const [filterProgramme, setFilterProgramme] = useState<string>('all');

  const filtered = filterProgramme === 'all' ? WEEKS : WEEKS.filter(w => w.programme.includes(filterProgramme));
  const publishedWeeks = WEEKS.filter(w => w.status === 'published').length;
  const draftWeeks = WEEKS.filter(w => w.status === 'draft').length;

  const totalComponents = selectedWeek.days.reduce((s, d) => s + d.components.length, 0);
  const day = selectedWeek.days[selectedDay];

  const typeColors: Record<string, string> = {
    'Live Session': 'bg-primary-100 text-primary-700',
    'Workshop': 'bg-accent-100 text-accent-700',
    'Self-study': 'bg-secondary-100 text-secondary-700',
    'Assignment': 'bg-amber-100 text-amber-700',
    'Quiz': 'bg-rose-100 text-rose-700',
    'OTJH': 'bg-emerald-100 text-emerald-700',
    'Collaboration': 'bg-violet-100 text-violet-700',
  };

  return (
    <WorkspaceShell role="curriculum" roleLabel={curriculumNav.label} navItems={curriculumNav.items} workspaceLabel={curriculumNav.workspaceLabel} pageTitle="Week Builder" pageSubtitle="Build weekly schedules — assign components, lessons, quizzes and OTJH per day" userName="Rachel Myers" userRole="Curriculum Designer">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-calendar-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Week Builder</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{WEEKS.length} weeks</strong> configured — {publishedWeeks} published, {draftWeeks} in draft. Build daily schedules with components and KSB mapping.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{WEEKS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Weeks</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{totalComponents}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Components</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{publishedWeeks}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Published</p></div>
            </div>
          </div>
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {['all', 'Business Admin', 'Data Analyst'].map(f => (
              <button key={f} onClick={() => { setFilterProgramme(f); setSelectedWeek(filtered[0] || WEEKS[0]); }} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterProgramme === f ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{f === 'all' ? 'All Programmes' : f}</button>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> New Week</button>
        </div>

        <div className="flex gap-6">
          {/* Week List Sidebar */}
          <div className="w-[320px] shrink-0 space-y-2">
            <h4 className="text-[11px] font-semibold text-foreground-400 uppercase tracking-wider px-1">Weeks</h4>
            {filtered.map(w => (
              <button key={w.id} onClick={() => { setSelectedWeek(w); setSelectedDay(0); }} className={`w-full text-left p-3 rounded-xl border transition-smooth cursor-pointer ${selectedWeek.id === w.id ? 'border-primary-300 bg-primary-50/50' : 'border-foreground-200/60 bg-background-50 hover:bg-background-100/50'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-semibold text-foreground-900">{w.label}: {w.theme}</span>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${w.status === 'published' ? 'bg-emerald-100 text-emerald-700' : w.status === 'review' ? 'bg-amber-100 text-amber-700' : 'bg-foreground-100 text-foreground-500'}`}>{w.status}</span>
                </div>
                <p className="text-[11px] text-foreground-400">{w.module} · {w.programme}</p>
                <p className="text-[10px] text-foreground-300 mt-1">{w.days.reduce((s, d) => s + d.components.length, 0)} components across {w.days.length} days</p>
              </button>
            ))}
          </div>

          {/* Week Detail */}
          <div className="flex-1 min-w-0">
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="flex items-center gap-1 p-2 bg-background-100/50 border-b border-foreground-300/50 overflow-x-auto">
                {selectedWeek.days.map((d, i) => (
                  <button key={d.day} onClick={() => setSelectedDay(i)} className={`flex flex-col items-center px-3 py-2 rounded-lg text-center min-w-[64px] transition-smooth cursor-pointer whitespace-nowrap ${selectedDay === i ? 'bg-primary-500 text-white shadow-sm' : 'bg-transparent text-foreground-500 hover:bg-background-50'}`}>
                    <span className={`text-[9px] font-semibold uppercase ${selectedDay === i ? 'text-white/80' : 'text-foreground-400'}`}>{d.day}</span>
                    <span className={`text-[11px] font-bold ${selectedDay === i ? 'text-white' : 'text-foreground-700'}`}>{d.date}</span>
                    <span className={`text-[8px] mt-0.5 ${selectedDay === i ? 'text-white/70' : 'text-foreground-300'}`}>{d.components.length} items</span>
                  </button>
                ))}
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h4 className="text-sm font-heading font-semibold text-foreground-900">{day.day} {day.date} — {selectedWeek.theme}</h4>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{day.components.length} components scheduled</p>
                  </div>
                  <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-add-line mr-1"></i> Add Component</button>
                </div>
                <div className="space-y-2">
                  {day.components.map((comp, j) => (
                    <div key={comp.id} className="flex items-center gap-3 p-3 bg-background-50 border border-foreground-200/60 rounded-lg hover:border-primary-200/50 transition-smooth cursor-pointer">
                      <span className="text-[10px] font-semibold text-foreground-300 w-5">{j + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-foreground-900">{comp.title}</p>
                        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-1">
                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${typeColors[comp.type] || 'bg-foreground-100 text-foreground-500'}`}>{comp.type}</span>
                          <span className="text-[10px] text-foreground-400"><i className="ri-time-line mr-0.5 text-[9px]"></i>{comp.duration}</span>
                          <span className="text-[10px] text-foreground-400"><i className="ri-link mr-0.5 text-[9px]"></i>{comp.ksb}</span>
                          <span className="text-[10px] text-foreground-400"><i className="ri-video-line mr-0.5 text-[9px]"></i>{comp.delivery}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-primary-100 hover:text-primary-600 transition-smooth cursor-pointer"><i className="ri-edit-line text-xs"></i></button>
                        <button className="w-7 h-7 rounded-lg bg-background-100 flex items-center justify-center hover:bg-red-100 hover:text-red-600 transition-smooth cursor-pointer"><i className="ri-delete-bin-line text-xs"></i></button>
                      </div>
                    </div>
                  ))}
                </div>
                {day.components.length === 0 && (
                  <div className="text-center py-10 text-foreground-400">
                    <i className="ri-calendar-line text-3xl mb-2 block"></i>
                    <p className="text-[12px]">No components scheduled for this day</p>
                    <p className="text-[10px] mt-1">Click "Add Component" to begin building this day</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}