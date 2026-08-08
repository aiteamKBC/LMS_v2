import { useState, useMemo } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface Milestone {
  label: string;
  date: string;
  type: 'start' | 'gateway' | 'assessment' | 'end' | 'holiday' | 'review';
}

interface ModuleBlock {
  name: string;
  weeks: number;
  startWeek: number;
  colour: 'primary' | 'accent' | 'secondary' | 'emerald' | 'amber' | 'rose' | 'indigo';
}

interface CohortTimeline {
  id: string;
  name: string;
  programme: string;
  level: number;
  startDate: string;
  endDate: string;
  totalWeeks: number;
  modules: ModuleBlock[];
  milestones: Milestone[];
}

const TIMELINES: CohortTimeline[] = [
  {
    id: 'co-a', name: 'Cohort A — BA L3', programme: 'Business Administrator', level: 3,
    startDate: '01 Sep 2025', endDate: '28 Feb 2027', totalWeeks: 78,
    modules: [
      { name: 'Induction', weeks: 2, startWeek: 1, colour: 'secondary' },
      { name: 'Module 1: Business Fundamentals', weeks: 8, startWeek: 3, colour: 'primary' },
      { name: 'Module 2: Communication & IT', weeks: 10, startWeek: 11, colour: 'accent' },
      { name: 'Module 3: Managing Relationships', weeks: 10, startWeek: 21, colour: 'emerald' },
      { name: 'Module 4: Project Management', weeks: 8, startWeek: 31, colour: 'amber' },
      { name: 'Module 5: Decision Making', weeks: 10, startWeek: 39, colour: 'primary' },
      { name: 'Module 6: HR & Finance', weeks: 10, startWeek: 49, colour: 'accent' },
      { name: 'Module 7: Strategy & Change', weeks: 8, startWeek: 59, colour: 'emerald' },
      { name: 'EPA Preparation', weeks: 10, startWeek: 67, colour: 'rose' },
    ],
    milestones: [
      { label: 'Onboarding Complete', date: '08 Sep 2025', type: 'start' },
      { label: 'Gateway 1', date: '17 Nov 2025', type: 'gateway' },
      { label: 'Mid-point Review', date: '08 Jun 2026', type: 'review' },
      { label: 'Gateway 2', date: '18 Jan 2027', type: 'gateway' },
      { label: 'EPA Start', date: '01 Feb 2027', type: 'assessment' },
      { label: 'End Date', date: '28 Feb 2027', type: 'end' },
    ],
  },
  {
    id: 'co-b', name: 'Cohort B — DM L3', programme: 'Digital Marketer', level: 3,
    startDate: '05 Jan 2026', endDate: '31 Jul 2027', totalWeeks: 78,
    modules: [
      { name: 'Induction', weeks: 2, startWeek: 1, colour: 'secondary' },
      { name: 'M1: Marketing Principles', weeks: 10, startWeek: 3, colour: 'primary' },
      { name: 'M2: Digital Channels', weeks: 10, startWeek: 13, colour: 'accent' },
      { name: 'M3: Content & SEO', weeks: 10, startWeek: 23, colour: 'emerald' },
      { name: 'M4: Analytics & Data', weeks: 10, startWeek: 33, colour: 'amber' },
      { name: 'M5: Campaign Strategy', weeks: 10, startWeek: 43, colour: 'primary' },
      { name: 'M6: Paid Media', weeks: 8, startWeek: 53, colour: 'accent' },
      { name: 'M7: Portfolio Build', weeks: 8, startWeek: 61, colour: 'emerald' },
      { name: 'EPA Prep', weeks: 8, startWeek: 69, colour: 'rose' },
    ],
    milestones: [
      { label: 'Onboarding', date: '12 Jan 2026', type: 'start' },
      { label: 'Gateway 1', date: '16 Mar 2026', type: 'gateway' },
      { label: 'Mid-point Review', date: '12 Oct 2026', type: 'review' },
      { label: 'Gateway 2', date: '21 Jun 2027', type: 'gateway' },
      { label: 'EPA Start', date: '05 Jul 2027', type: 'assessment' },
      { label: 'End Date', date: '31 Jul 2027', type: 'end' },
    ],
  },
  {
    id: 'co-d', name: 'Cohort D — DT L3', programme: 'Data Technician', level: 3,
    startDate: '01 May 2026', endDate: '30 Nov 2027', totalWeeks: 78,
    modules: [
      { name: 'Induction', weeks: 2, startWeek: 1, colour: 'secondary' },
      { name: 'M1: Data Fundamentals', weeks: 8, startWeek: 3, colour: 'primary' },
      { name: 'M2: SQL & Databases', weeks: 10, startWeek: 11, colour: 'accent' },
      { name: 'M3: Python for Data', weeks: 10, startWeek: 21, colour: 'emerald' },
      { name: 'M4: BI & Visualisation', weeks: 10, startWeek: 31, colour: 'amber' },
      { name: 'M5: Statistical Analysis', weeks: 8, startWeek: 41, colour: 'primary' },
      { name: 'M6: ML Basics', weeks: 10, startWeek: 49, colour: 'accent' },
      { name: 'M7: Portfolio Project', weeks: 10, startWeek: 59, colour: 'emerald' },
      { name: 'EPA Prep', weeks: 8, startWeek: 69, colour: 'rose' },
    ],
    milestones: [
      { label: 'Onboarding', date: '08 May 2026', type: 'start' },
      { label: 'Gateway 1', date: '29 Jun 2026', type: 'gateway' },
      { label: 'Mid-point Review', date: '25 Jan 2027', type: 'review' },
      { label: 'Gateway 2', date: '13 Sep 2027', type: 'gateway' },
      { label: 'EPA Start', date: '04 Oct 2027', type: 'assessment' },
      { label: 'End Date', date: '30 Nov 2027', type: 'end' },
    ],
  },
];

const colourMap: Record<ModuleBlock['colour'], string> = {
  primary: 'bg-primary-500',
  accent: 'bg-accent-500',
  secondary: 'bg-secondary-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  indigo: 'bg-indigo-500',
};

const colourTextMap: Record<ModuleBlock['colour'], string> = {
  primary: 'text-primary-600',
  accent: 'text-accent-700',
  secondary: 'text-secondary-600',
  emerald: 'text-emerald-600',
  amber: 'text-amber-600',
  rose: 'text-rose-600',
  indigo: 'text-indigo-600',
};

const milestoneColour = (t: Milestone['type']) => {
  switch (t) {
    case 'start': return 'border-emerald-400 bg-emerald-50 text-emerald-700';
    case 'gateway': return 'border-primary-400 bg-primary-50 text-primary-600';
    case 'review': return 'border-secondary-400 bg-secondary-50 text-secondary-600';
    case 'assessment': return 'border-accent-400 bg-accent-50 text-accent-700';
    case 'end': return 'border-rose-400 bg-rose-50 text-rose-700';
    case 'holiday': return 'border-amber-400 bg-amber-50 text-amber-700';
    default: return 'border-foreground-400 bg-foreground-50 text-foreground-600';
  }
};

type ViewMode = 'gantt' | 'list';

export default function MisDeliveryTimelinePage() {
  const [viewMode, setViewMode] = useState<ViewMode>('gantt');
  const [selectedCohort, setSelectedCohort] = useState<string>('all');
  const [hoveredModule, setHoveredModule] = useState<{ cohortId: string; moduleIdx: number } | null>(null);

  const filteredTimelines = selectedCohort === 'all'
    ? TIMELINES
    : TIMELINES.filter(t => t.id === selectedCohort);

  const maxWeeks = useMemo(() => Math.max(...TIMELINES.map(t => t.totalWeeks)), []);

  const monthMarkers = useMemo(() => {
    const markers: { label: string; week: number }[] = [];
    for (let w = 0; w <= maxWeeks; w += 4) {
      const monthIdx = Math.floor(w / 4) + 1;
      markers.push({ label: `M${monthIdx}`, week: w });
    }
    return markers;
  }, [maxWeeks]);

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Delivery Timeline" pageSubtitle="Visual overview of programme delivery schedules across all active cohorts"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <select
            value={selectedCohort}
            onChange={e => setSelectedCohort(e.target.value)}
            className="px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:border-primary-400 cursor-pointer"
          >
            <option value="all">All Cohorts</option>
            {TIMELINES.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <div className="flex items-center bg-background-100 rounded-lg p-0.5">
            {([
              { mode: 'gantt' as ViewMode, icon: 'ri-bar-chart-horizontal-line', label: 'Gantt' },
              { mode: 'list' as ViewMode, icon: 'ri-list-check', label: 'List' },
            ]).map(opt => (
              <button
                key={opt.mode}
                onClick={() => setViewMode(opt.mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${viewMode === opt.mode ? 'bg-background-50 text-foreground-800 shadow-sm' : 'text-foreground-400 hover:text-foreground-600'}`}
              >
                <AppIcon className={`${opt.icon} text-xs`}></AppIcon> {opt.label}
              </button>
            ))}
          </div>
          {viewMode === 'gantt' && (
            <div className="flex items-center gap-3 flex-wrap ml-auto">
              {(['primary', 'accent', 'secondary', 'emerald', 'amber', 'rose'] as ModuleBlock['colour'][]).map(c => (
                <div key={c} className="flex items-center gap-1">
                  <span className={`w-2.5 h-2.5 rounded-sm ${colourMap[c]}`}></span>
                  <span className="text-[10px] text-foreground-400">{c}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {viewMode === 'gantt' ? (
          /* Gantt View */
          <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
            {/* Legend row */}
            <div className="flex border-b border-background-200/70 bg-background-100/50">
              <div className="w-[220px] shrink-0 px-3 py-2 flex items-center">
                <span className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">Cohort</span>
              </div>
              <div className="flex-1 relative overflow-x-auto">
                <div className="flex min-w-max" style={{ minWidth: `${Math.max(800, maxWeeks * 13)}px` }}>
                  {monthMarkers.map((m, i) => (
                    <div
                      key={m.label}
                      className="text-[10px] text-foreground-400 text-center font-medium"
                      style={{
                        position: 'absolute',
                        left: `${(m.week / maxWeeks) * 100}%`,
                        top: '0px',
                        transform: 'translateX(-50%)',
                      }}
                    >
                      <div className="py-2">{m.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Cohort rows */}
            {filteredTimelines.map((timeline) => (
              <div key={timeline.id} className="border-b border-foreground-400/50 last:border-b-0">
                {/* Module bars row */}
                <div className="flex">
                  <div className="w-[220px] shrink-0 px-3 py-3 flex flex-col justify-center border-r border-foreground-200/60 bg-background-50">
                    <p className="text-[12px] font-semibold text-foreground-800 whitespace-nowrap">{timeline.name}</p>
                    <p className="text-[10px] text-foreground-400 mt-0.5">{timeline.programme} L{timeline.level}</p>
                    <p className="text-[10px] text-foreground-300">{timeline.startDate} — {timeline.endDate}</p>
                  </div>
                  <div className="flex-1 relative py-3 px-2">
                    <div className="relative h-14" style={{ minWidth: `${Math.max(800, maxWeeks * 13)}px` }}>
                      {timeline.modules.map((mod, idx) => {
                        const widthPct = (mod.weeks / timeline.totalWeeks) * 100;
                        const leftPct = ((mod.startWeek - 1) / timeline.totalWeeks) * 100;
                        const isHovered = hoveredModule?.cohortId === timeline.id && hoveredModule?.moduleIdx === idx;
                        return (
                          <div
                            key={idx}
                            onMouseEnter={() => setHoveredModule({ cohortId: timeline.id, moduleIdx: idx })}
                            onMouseLeave={() => setHoveredModule(null)}
                            className={`absolute top-0 h-14 rounded-md ${colourMap[mod.colour]} cursor-pointer transition-all duration-150 flex items-center px-2 ${isHovered ? 'brightness-90 scale-y-110 shadow-sm z-10' : 'opacity-85 hover:opacity-100'}`}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          >
                            <span className="text-[9px] text-white font-semibold truncate leading-tight">
                              {mod.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Milestones */}
                    <div className="relative h-5 mt-1" style={{ minWidth: `${Math.max(800, maxWeeks * 13)}px` }}>
                      {timeline.milestones.map((ms, idx) => {
                        const leftPct = (TIMELINES.indexOf(timeline) > 0 ? 0 : 0);
                        const msWeek = timeline.modules.findIndex(m => timeline.milestones.indexOf(ms) < timeline.modules.length) + 1;
                        const pos = idx / (timeline.milestones.length - 1 || 1);
                        return (
                          <div
                            key={idx}
                            className="absolute top-0 -translate-x-1/2"
                            style={{ left: `${pos * 100}%` }}
                          >
                            <div className={`w-1.5 h-1.5 rounded-full border ${milestoneColour(ms.type)}`} title={`${ms.label}: ${ms.date}`}></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Milestone labels row */}
                <div className="flex border-t border-background-200/30 bg-background-100/30">
                  <div className="w-[220px] shrink-0 px-3 py-2 flex items-center">
                    <span className="text-[10px] font-medium text-foreground-400">Milestones</span>
                  </div>
                  <div className="flex-1 py-1.5 px-2 overflow-x-auto">
                    <div className="flex items-center gap-2 flex-wrap" style={{ minWidth: `${Math.max(800, maxWeeks * 13)}px` }}>
                      {timeline.milestones.map((ms, idx) => (
                        <div key={idx} className={`flex items-center gap-1 px-2 py-1 rounded-full border text-[10px] font-medium ${milestoneColour(ms.type)}`}>
                          <AppIcon className={`text-[9px] ${ms.type === 'start' ? 'ri-play-circle-line' : ms.type === 'gateway' ? 'ri-flag-line' : ms.type === 'review' ? 'ri-search-eye-line' : ms.type === 'assessment' ? 'ri-clipboard-line' : 'ri-stop-circle-line'}`}></AppIcon>
                          <span>{ms.label}</span>
                          <span className="text-foreground-300 ml-1">{ms.date}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="space-y-4">
            {filteredTimelines.map((timeline) => (
              <div key={timeline.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="p-4 border-b border-foreground-400/50 bg-background-100/30">
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-sm font-semibold text-foreground-900">{timeline.name}</p>
                    <span className="text-[11px] text-foreground-400">{timeline.programme} L{timeline.level}</span>
                    <span className="text-foreground-200">|</span>
                    <span className="text-[11px] text-foreground-400">{timeline.startDate} — {timeline.endDate}</span>
                    <span className="text-foreground-200">|</span>
                    <span className="text-[11px] text-foreground-400">{timeline.totalWeeks} weeks &middot; {timeline.modules.length} modules</span>
                  </div>
                </div>
                <div className="p-4">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[700px] text-[12px]">
                      <thead>
                        <tr className="border-b border-foreground-400/50">
                          <th className="text-left px-3 py-2 text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">Week</th>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">Module</th>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">Duration</th>
                          <th className="text-left px-3 py-2 text-[10px] font-semibold text-foreground-400 uppercase tracking-wide">Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {timeline.modules.map((mod, idx) => (
                          <tr key={idx} className="border-b border-background-100/50 hover:bg-background-100/30 transition-colors">
                            <td className="px-3 py-2.5 text-foreground-400">W{mod.startWeek}–W{mod.startWeek + mod.weeks - 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${colourMap[mod.colour]}`}></span>
                                <span className="text-foreground-800 font-medium">{mod.name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-foreground-500">{mod.weeks} weeks</td>
                            <td className="px-3 py-2.5">
                              <span className={`text-[10px] font-medium ${colourTextMap[mod.colour]}`}>{mod.colour}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Milestones strip */}
                  <div className="mt-4 pt-3 border-t border-foreground-200/60">
                    <p className="text-[10px] font-semibold text-foreground-400 uppercase tracking-wide mb-2">Milestones</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {timeline.milestones.map((ms, idx) => (
                        <div key={idx} className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-[10px] font-medium ${milestoneColour(ms.type)}`}>
                          <AppIcon className={`text-[9px] ${ms.type === 'start' ? 'ri-play-circle-line' : ms.type === 'gateway' ? 'ri-flag-line' : ms.type === 'review' ? 'ri-search-eye-line' : ms.type === 'assessment' ? 'ri-clipboard-line' : 'ri-stop-circle-line'}`}></AppIcon>
                          <span>{ms.label}</span>
                          <span className="text-foreground-300 ml-1.5">{ms.date}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredTimelines.length === 0 && (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-background-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <AppIcon className="ri-timeline-view text-foreground-300 text-2xl"></AppIcon>
            </div>
            <p className="text-sm font-medium text-foreground-600">No timelines found</p>
            <p className="text-[12px] text-foreground-400 mt-1">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}