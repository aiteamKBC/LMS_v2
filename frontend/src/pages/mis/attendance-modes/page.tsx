import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const misNav = roleNavMap.mis;

interface AttendanceMode {
  id: string;
  name: string;
  type: 'Virtual' | 'Classroom' | 'Blended' | 'Workplace' | 'Self-study';
  description: string;
  requiresRegister: boolean;
  requiresConfirmation: boolean;
  autoMarkThreshold: number;
  lateThresholdMinutes: number;
  absentThresholdMinutes: number;
  cohorts: string[];
  sessionsPerWeek: number;
  learners: number;
  status: 'Active' | 'Draft';
  rules: string[];
}

const MODES: AttendanceMode[] = [
  {
    id: 'am-1', name: 'Virtual Teams Live', type: 'Virtual', description: 'Learners join via Microsoft Teams live session. Attendance auto-marked when joining within threshold. Tutor takes register for late learners.', requiresRegister: true, requiresConfirmation: false, autoMarkThreshold: 15, lateThresholdMinutes: 15, absentThresholdMinutes: 30, cohorts: ['Cohort B — DM', 'Cohort D — DT', 'Cohort F — SWE'], sessionsPerWeek: 5, learners: 28, status: 'Active',
    rules: ['Auto-mark present when joining within 15 min', 'Late after 15 min, absent after 30 min', 'Recording access requires attendance confirmation'],
  },
  {
    id: 'am-2', name: 'Blended Classroom', type: 'Blended', description: 'Mix of classroom and virtual sessions. Physical register taken for classroom, Teams for virtual. Employer workplace confirms practical hours.', requiresRegister: true, requiresConfirmation: true, autoMarkThreshold: 0, lateThresholdMinutes: 10, absentThresholdMinutes: 20, cohorts: ['Cohort A — BA', 'Cohort C — BA'], sessionsPerWeek: 4, learners: 22, status: 'Active',
    rules: ['Physical register required for classroom', 'Virtual sessions follow Teams attendance rules', 'Employer confirms workplace hours monthly'],
  },
  {
    id: 'am-3', name: 'Workplace On-site', type: 'Workplace', description: 'Learner attends at employer workplace. Employer supervisor confirms attendance daily. Workplace mentor signs weekly attendance sheet.', requiresRegister: false, requiresConfirmation: true, autoMarkThreshold: 0, lateThresholdMinutes: 0, absentThresholdMinutes: 0, cohorts: ['Cohort E — EYE'], sessionsPerWeek: 4, learners: 9, status: 'Active',
    rules: ['Employer supervisor confirms daily attendance', 'Weekly mentor signature required', 'Absence must be reported via platform within 24h'],
  },
  {
    id: 'am-4', name: 'Self-study Check-in', type: 'Self-study', description: 'Learner completes self-study modules with timed check-ins. Platform tracks progress and auto-marks attendance based on module completion milestones.', requiresRegister: false, requiresConfirmation: false, autoMarkThreshold: 0, lateThresholdMinutes: 0, absentThresholdMinutes: 0, cohorts: ['Cohort A — BA', 'Cohort B — DM', 'Cohort C — BA', 'Cohort D — DT', 'Cohort E — EYE', 'Cohort F — SWE'], sessionsPerWeek: 2, learners: 59, status: 'Active',
    rules: ['Auto-marked on module completion', 'Must complete within scheduled week', 'Late completion triggers catch-up workflow'],
  },
  {
    id: 'am-5', name: 'Hybrid with QR Check-in', type: 'Blended', description: 'Learner scans QR code at physical location. Biometric backup for authentication. QR code changes every 5 minutes for security.', requiresRegister: true, requiresConfirmation: false, autoMarkThreshold: 10, lateThresholdMinutes: 10, absentThresholdMinutes: 30, cohorts: [], sessionsPerWeek: 0, learners: 0, status: 'Draft',
    rules: ['QR code rotates every 5 minutes', 'Biometric backup authentication', 'Late after 10 min, absent after 30 min'],
  },
];

const typeColour = (t: AttendanceMode['type']) => {
  switch (t) {
    case 'Virtual': return 'bg-primary-100 text-primary-700';
    case 'Classroom': return 'bg-secondary-100 text-secondary-700';
    case 'Blended': return 'bg-accent-100 text-accent-700';
    case 'Workplace': return 'bg-emerald-100 text-emerald-700';
    case 'Self-study': return 'bg-foreground-100 text-foreground-500';
    default: return '';
  }
};

export default function MisAttendanceModesPage() {
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const filtered = MODES.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.type.toLowerCase().includes(search.toLowerCase()));

  return (
    <WorkspaceShell
      role="mis" roleLabel={misNav.label} navItems={misNav.items} workspaceLabel={misNav.workspaceLabel}
      pageTitle="Attendance Modes" pageSubtitle="Configure attendance recording modes, thresholds, and rules for all cohorts"
      userName="Priya Sharma" userRole="MIS Operations Lead"
    >
      <div className="p-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Modes', value: String(MODES.filter(m => m.status === 'Active').length), icon: 'ri-check-double-line', color: 'primary' },
            { label: 'Cohorts Covered', value: '6', icon: 'ri-group-line', color: 'accent' },
            { label: 'Learners Tracked', value: '59', icon: 'ri-user-line', color: 'secondary' },
            { label: 'Draft Modes', value: String(MODES.filter(m => m.status === 'Draft').length), icon: 'ri-draft-line', color: 'primary' },
          ].map(s => (
            <div key={s.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${s.color === 'primary' ? 'bg-primary-100 text-primary-600' : s.color === 'accent' ? 'bg-accent-100 text-accent-700' : 'bg-secondary-100 text-secondary-600'}`}>
                <AppIcon className={`${s.icon} text-sm`}></AppIcon>
              </div>
              <p className="text-[10px] text-foreground-400 uppercase tracking-wide font-medium">{s.label}</p>
              <p className="text-xl font-heading font-semibold text-foreground-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mode, type..." className="w-full pl-9 pr-3 py-2 bg-background-50 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-400 focus:outline-none focus:border-primary-400" />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowForm(true)} className="px-3 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-colors cursor-pointer whitespace-nowrap">
              <AppIcon className="ri-add-line mr-1"></AppIcon> New Mode
            </button>
          </div>
        </div>

        {/* Modes List */}
        <div className="space-y-2">
          {filtered.map(mode => {
            const isExpanded = expandedId === mode.id;
            return (
              <div key={mode.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${typeColour(mode.type)}`}>
                      <AppIcon className="ri-check-double-line text-sm"></AppIcon>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground-900">{mode.name}</p>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${typeColour(mode.type)}`}>{mode.type}</span>
                        <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${mode.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-primary-100 text-primary-700'}`}>{mode.status}</span>
                      </div>
                      <p className="text-[11px] text-foreground-400 mt-0.5">{mode.cohorts.length} cohort{mode.cohorts.length !== 1 ? 's' : ''} &middot; {mode.learners} learners &middot; {mode.sessionsPerWeek} sessions/wk</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-foreground-400">
                    <span>{mode.requiresRegister ? 'Register required' : 'Auto-marked'}</span>
                    <span className="text-foreground-300">|</span>
                    <span>{mode.requiresConfirmation ? 'Confirmation needed' : 'Direct entry'}</span>
                    <button onClick={() => setExpandedId(isExpanded ? null : mode.id)} className="w-7 h-7 flex items-center justify-center bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer">
                      <AppIcon className={isExpanded ? 'ri-arrow-up-s-line text-foreground-500' : 'ri-arrow-down-s-line text-foreground-500'}></AppIcon>
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t border-foreground-200/60 bg-background-100/50 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Configuration</p>
                      <div className="space-y-1 text-[12px]">
                        <p><span className="text-foreground-400">Requires register:</span> <strong className="text-foreground-800">{mode.requiresRegister ? 'Yes' : 'No'}</strong></p>
                        <p><span className="text-foreground-400">Requires confirmation:</span> <strong className="text-foreground-800">{mode.requiresConfirmation ? 'Yes' : 'No'}</strong></p>
                        <p><span className="text-foreground-400">Auto-mark threshold:</span> <strong className="text-foreground-800">{mode.autoMarkThreshold} min</strong></p>
                        <p><span className="text-foreground-400">Late threshold:</span> <strong className="text-foreground-800">{mode.lateThresholdMinutes} min</strong></p>
                        <p><span className="text-foreground-400">Absent threshold:</span> <strong className="text-foreground-800">{mode.absentThresholdMinutes} min</strong></p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Rules</p>
                      <div className="space-y-1">
                        {mode.rules.map((r, i) => (
                          <p key={i} className="text-[12px] text-foreground-600 flex items-start gap-1">
                            <AppIcon className="ri-check-line text-emerald-500 mt-0.5 text-[10px] shrink-0"></AppIcon>
                            {r}
                          </p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-foreground-400 mb-2 font-medium">Cohorts</p>
                      <div className="space-y-1">
                        {mode.cohorts.length > 0 ? mode.cohorts.map(c => (
                          <span key={c} className="inline-block text-[11px] bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full mr-1 mb-1">{c}</span>
                        )) : <span className="text-[12px] text-foreground-400">Not assigned to any cohort</span>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* New Mode Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background-50 rounded-2xl border border-background-200 w-full max-w-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-heading font-semibold text-foreground-900">Create New Attendance Mode</h2>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-background-100 hover:bg-background-200 cursor-pointer">
                <AppIcon className="ri-close-line text-foreground-500"></AppIcon>
              </button>
            </div>
            <div className="space-y-4 mb-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-foreground-600 mb-1">Mode Name</label>
                  <input placeholder="e.g. Virtual Classroom" className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-300 focus:outline-none focus:border-primary-400" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-foreground-600 mb-1">Type</label>
                  <select className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 cursor-pointer">
                    {['Virtual', 'Classroom', 'Blended', 'Workplace', 'Self-study'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-foreground-600 mb-1">Description</label>
                <textarea placeholder="Describe how this mode works..." className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 placeholder-foreground-300 focus:outline-none focus:border-primary-400" rows={3} maxLength={500}></textarea>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-medium text-foreground-600 mb-1">Late Threshold (min)</label>
                  <input type="number" placeholder="15" className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-primary-400" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-foreground-600 mb-1">Absent Threshold (min)</label>
                  <input type="number" placeholder="30" className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-primary-400" />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-foreground-600 mb-1">Auto-mark (min)</label>
                  <input type="number" placeholder="0" className="w-full px-3 py-2 bg-background-100 border border-background-200 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-primary-400" />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[12px] font-medium text-foreground-600 bg-background-100 rounded-lg hover:bg-background-200 cursor-pointer whitespace-nowrap">Cancel</button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-[12px] font-semibold text-white bg-primary-500 rounded-lg hover:bg-primary-600 cursor-pointer whitespace-nowrap">Create Mode</button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}