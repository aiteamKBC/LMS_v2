import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: string;
  lastGenerated: string | null;
  format: string;
  category: string;
}

const REPORTS: ReportCard[] = [
  { id: 'rp-01', title: 'Learner Progress Summary', description: 'Overview of all learners with progress %, attendance, evidence counts, and risk flags', icon: 'ri-line-chart-line', lastGenerated: '9 Jun 2026', format: 'PDF / Excel', category: 'Progress' },
  { id: 'rp-02', title: 'Session Attendance Report', description: 'Detailed attendance log across all teaching sessions with per-learner breakdown', icon: 'ri-calendar-check-line', lastGenerated: '8 Jun 2026', format: 'PDF / Excel', category: 'Attendance' },
  { id: 'rp-03', title: 'Assignment Marking Completion', description: 'Status of all assignments: submitted, marked, pending feedback with turnaround times', icon: 'ri-edit-line', lastGenerated: '7 Jun 2026', format: 'PDF', category: 'Marking' },
  { id: 'rp-04', title: 'KSB Validation Status', description: 'KSB claim validation progress by learner, type (K/S/B), and overall completion rate', icon: 'ri-checkbox-circle-line', lastGenerated: '5 Jun 2026', format: 'PDF / Excel', category: 'Progress' },
  { id: 'rp-05', title: 'OTJH Compliance Report', description: 'Off-the-job training hour tracking with target vs actual and funding compliance status', icon: 'ri-time-line', lastGenerated: null, format: 'PDF', category: 'Compliance' },
  { id: 'rp-06', title: 'Learner Engagement Summary', description: 'Engagement metrics including logins, submissions, session attendance, and activity scores', icon: 'ri-heart-line', lastGenerated: '1 Jun 2026', format: 'PDF / Excel', category: 'Engagement' },
  { id: 'rp-07', title: 'Feedback Turnaround Report', description: 'Average feedback turnaround time by assignment type and learner cohort', icon: 'ri-chat-3-line', lastGenerated: null, format: 'Excel', category: 'Marking' },
  { id: 'rp-08', title: 'Gateway Readiness Forecast', description: 'Projected gateway readiness dates with KSB completion and OTJH trajectories', icon: 'ri-flag-line', lastGenerated: null, format: 'PDF', category: 'Progress' },
  { id: 'rp-09', title: 'Cohort Comparison Report', description: 'Side-by-side comparison of cohorts on progress, attendance, and achievement metrics', icon: 'ri-bar-chart-grouped-line', lastGenerated: '28 May 2026', format: 'PDF / Excel', category: 'Performance' },
  { id: 'rp-10', title: 'AI Marking Audit Log', description: 'Complete log of AI-assisted marking decisions with human validation status', icon: 'ri-robot-line', lastGenerated: '3 Jun 2026', format: 'Excel', category: 'Quality' },
  { id: 'rp-11', title: 'Resource Usage Report', description: 'Resource download statistics, most-used materials, and resource gaps identified', icon: 'ri-folder-line', lastGenerated: null, format: 'PDF', category: 'Resources' },
  { id: 'rp-12', title: 'Monthly Tutor Summary', description: 'Consolidated monthly report covering all teaching activity for management review', icon: 'ri-file-chart-line', lastGenerated: '31 May 2026', format: 'PDF', category: 'Performance' },
];

export default function TutorReportsPage() {
  const [category, setCategory] = useState<string>('all');
  const [generating, setGenerating] = useState<string | null>(null);

  const categories = ['all', ...new Set(REPORTS.map(r => r.category))];
  const filtered = category === 'all' ? REPORTS : REPORTS.filter(r => r.category === category);
  const generatedCount = REPORTS.filter(r => r.lastGenerated != null).length;

  const handleGenerate = (id: string) => {
    setGenerating(id);
    setTimeout(() => setGenerating(null), 2000);
  };

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="Reports" pageSubtitle="Generate reports on learner progress, session attendance, marking completion and more" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-bar-chart-box-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Tutor Reports</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{REPORTS.length} report templates available · {generatedCount} recently generated · Export to PDF or Excel</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{REPORTS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Templates</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-emerald-300">{generatedCount}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Generated</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">PDF</p><p className="text-[10px] text-white/70 uppercase tracking-wide">+ Excel</p></div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${category === c ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{c === 'all' ? 'All Reports' : c}</button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(r => (
            <div key={r.id} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <span className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center"><i className={`${r.icon} text-lg`}></i></span>
                {r.lastGenerated != null ? (
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Generated</span>
                ) : (
                  <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-foreground-100 text-foreground-500">Not generated</span>
                )}
              </div>
              <h4 className="text-sm font-semibold text-foreground-900 mb-1.5">{r.title}</h4>
              <p className="text-[11px] text-foreground-400 leading-relaxed mb-4 flex-1">{r.description}</p>
              <div className="flex items-center gap-2 mb-3 text-[10px] text-foreground-400">
                <span className="bg-background-100 rounded-lg px-2 py-0.5">{r.format}</span>
                <span className="bg-background-100 rounded-lg px-2 py-0.5">{r.category}</span>
              </div>
              {r.lastGenerated != null && (
                <p className="text-[10px] text-foreground-400 mb-3">Last generated: {r.lastGenerated}</p>
              )}
              <div className="flex items-center gap-2 mt-auto">
                <button
                  onClick={() => handleGenerate(r.id)}
                  disabled={generating === r.id}
                  className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex-1 disabled:opacity-50"
                >
                  {generating === r.id ? (
                    <><i className="ri-loader-4-line animate-spin mr-1"></i> Generating...</>
                  ) : (
                    <><i className="ri-download-line mr-1"></i> {r.lastGenerated ? 'Regenerate' : 'Generate'}</>
                  )}
                </button>
                {r.lastGenerated != null && (
                  <button className="px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-eye-line mr-1"></i> View</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}