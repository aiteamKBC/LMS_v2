import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface Assignment {
  id: string;
  learner: string;
  title: string;
  module: string;
  programme: string;
  submitted: string;
  type: string;
  wordCount: number;
  status: 'pending' | 'marked' | 'returned' | 'appealed';
  grade?: string;
  score?: number;
  feedback?: string;
  ksbRefs: string[];
  aiScore?: number;
}

const ASSIGNMENTS: Assignment[] = [
  { id: 'am-01', learner: 'Sophie Williams', title: 'Campaign Segmentation Worksheet', module: 'Marketing Planning', programme: 'Marketing Exec L4', submitted: '8 Jun 2026', type: 'Assignment', wordCount: 1200, status: 'pending', ksbRefs: ['K5', 'S8', 'S9'], aiScore: 72 },
  { id: 'am-02', learner: 'James Okonkwo', title: 'Data Visualisation Report', module: 'Data Visualisation', programme: 'Data Analyst L4', submitted: '7 Jun 2026', type: 'Report', wordCount: 1800, status: 'pending', ksbRefs: ['K10', 'S9', 'S10'], aiScore: 65 },
  { id: 'am-03', learner: 'Aisha Patel', title: 'Financial Statement Analysis', module: 'Financial Accounting', programme: 'Business Admin L3', submitted: '6 Jun 2026', type: 'Assignment', wordCount: 950, status: 'pending', ksbRefs: ['K8', 'S6', 'S7'], aiScore: 58 },
  { id: 'am-04', learner: 'Sarah Mitchell', title: 'Board Meeting Minutes & Reflection', module: 'Business Admin Practice', programme: 'Business Admin L3', submitted: '5 Jun 2026', type: 'Workplace Evidence', wordCount: 1500, status: 'pending', ksbRefs: ['K3', 'S4', 'B2'], aiScore: 80 },
  { id: 'am-05', learner: 'Liam Foster', title: 'Risk Register & Mitigation Plan', module: 'Risk Management', programme: 'Project Manager L4', submitted: '4 Jun 2026', type: 'Project Evidence', wordCount: 2100, status: 'pending', ksbRefs: ['K14', 'S18', 'S19'], aiScore: 68 },
  { id: 'am-06', learner: 'David Chen', title: 'Code Review & Documentation', module: 'Software Development', programme: 'Software Dev L4', submitted: '3 Jun 2026', type: 'Documentation', wordCount: 800, status: 'pending', ksbRefs: ['K18', 'S22'], aiScore: 85 },
  { id: 'am-07', learner: 'Emily Watson', title: 'Social Media Strategy Proposal', module: 'Digital Channels', programme: 'Digital Marketer L3', submitted: '2 Jun 2026', type: 'Report', wordCount: 1600, status: 'marked', score: 82, grade: 'Merit', feedback: 'Strong strategy, creative approach. Lacking competitor analysis depth.', ksbRefs: ['K7', 'S10', 'S11'] },
  { id: 'am-08', learner: 'Maya Kapoor', title: 'HR Policy Review Reflection', module: 'HR Induction', programme: 'HR Consultant L5', submitted: '1 Jun 2026', type: 'Reflection', wordCount: 600, status: 'pending', ksbRefs: ['K22', 'S26', 'B8'], aiScore: 45 },
  { id: 'am-09', learner: 'Sarah Mitchell', title: 'Business Communication — Final Report', module: 'Business Communication', programme: 'Business Admin L3', submitted: '28 May 2026', type: 'Report', wordCount: 2200, status: 'marked', score: 94, grade: 'Distinction', feedback: 'Outstanding depth. Excellent KSB linkage throughout.', ksbRefs: ['K1', 'K2', 'S1', 'S2', 'B1'] },
  { id: 'am-10', learner: 'Sophie Williams', title: 'Marketing Mix Analysis', module: 'Marketing Planning', programme: 'Marketing Exec L4', submitted: '25 May 2026', type: 'Assignment', wordCount: 1400, status: 'returned', feedback: 'Please revise section 3 — insufficient data on pricing strategy.', ksbRefs: ['K5', 'S8'] },
];

export default function AssignmentMarkingPage() {
  const [selectedAm, setSelectedAm] = useState<Assignment | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('pending');
  const [markingMode, setMarkingMode] = useState<'review' | 'grade'>('review');

  const filtered = filterStatus === 'all' ? ASSIGNMENTS : ASSIGNMENTS.filter(a => a.status === filterStatus);
  const pending = ASSIGNMENTS.filter(a => a.status === 'pending').length;
  const marked = ASSIGNMENTS.filter(a => a.status === 'marked').length;
  const aiAvg = Math.round(ASSIGNMENTS.reduce((s, a) => s + (a.aiScore || 0), 0) / ASSIGNMENTS.filter(a => a.aiScore).length);

  const statusColors: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    marked: 'bg-emerald-100 text-emerald-700',
    returned: 'bg-red-100 text-red-700',
    appealed: 'bg-rose-100 text-rose-700',
  };

  const gradeColors: Record<string, string> = {
    'Distinction': 'bg-accent-100 text-accent-700',
    'Merit': 'bg-primary-100 text-primary-700',
    'Pass': 'bg-emerald-100 text-emerald-700',
    'Refer': 'bg-red-100 text-red-700',
  };

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="Assignment Marking" pageSubtitle="Mark assignments, provide feedback and track grading progress" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        {/* Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><AppIcon className="ri-edit-line text-white text-2xl"></AppIcon></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">Assignment Marking</h2>
              <p className="text-[13px] text-white/80 leading-relaxed"><strong>{ASSIGNMENTS.length} assignments</strong> — {pending} pending, {marked} marked. AI-assisted scoring avg {aiAvg}%.</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{ASSIGNMENTS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{pending}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">To Mark</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{marked}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Marked</p></div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1">
            {(['all', 'pending', 'marked', 'returned'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${filterStatus === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
          <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-robot-line mr-1"></AppIcon> AI Batch Mark</button>
        </div>

        <div className="flex gap-6">
          {/* List */}
          <div className="flex-1 min-w-0">
            <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div className="grid grid-cols-[2fr_1fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 bg-background-100/50 border-b border-foreground-300/50 text-[10px] font-semibold text-foreground-400 uppercase tracking-wider">
                <span>Assignment</span>
                <span>Learner</span>
                <span className="text-center">Type</span>
                <span className="text-center">AI Score</span>
                <span className="text-center">Status</span>
                <span className="text-center">Action</span>
              </div>
              <div className="divide-y divide-background-200/30">
                {filtered.map(a => (
                  <div key={a.id} onClick={() => setSelectedAm(a)} className={`grid grid-cols-[2fr_1fr_0.8fr_0.8fr_0.8fr_1fr] gap-3 px-4 py-3 items-center cursor-pointer transition-smooth ${selectedAm?.id === a.id ? 'bg-primary-50/40 border-l-2 border-l-primary-400' : 'hover:bg-background-100/30'}`}>
                    <div className="min-w-0">
                      <span className="text-[12px] font-medium text-foreground-900 block truncate">{a.title}</span>
                      <span className="text-[10px] text-foreground-400">{a.module} · {a.wordCount} words</span>
                    </div>
                    <span className="text-[11px] text-foreground-600">{a.learner}</span>
                    <span className="text-[10px] text-foreground-400 text-center">{a.type}</span>
                    <div className="flex justify-center">
                      {a.aiScore != null && (
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${a.aiScore >= 70 ? 'bg-emerald-100 text-emerald-700' : a.aiScore >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{a.aiScore}%</span>
                      )}
                    </div>
                    <div className="flex justify-center">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColors[a.status]}`}>{a.status}</span>
                    </div>
                    <div className="flex justify-center">
                      {a.status === 'pending' && <button className="px-2 py-1 bg-primary-500 text-white rounded-md text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap">Mark</button>}
                      {a.status === 'marked' && <button className="px-2 py-1 bg-background-50 border border-background-200 rounded-md text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">View</button>}
                      {a.status === 'returned' && <button className="px-2 py-1 bg-background-50 border border-background-200 rounded-md text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap">Review</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Marking Panel */}
          {selectedAm && (
            <div className="w-[380px] shrink-0">
              <div className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 card-premium sticky top-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-heading font-bold text-foreground-900">{selectedAm.title}</h4>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${statusColors[selectedAm.status]}`}>{selectedAm.status}</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { l: 'Learner', v: selectedAm.learner },
                    { l: 'Module', v: selectedAm.module },
                    { l: 'Type', v: selectedAm.type },
                    { l: 'Words', v: String(selectedAm.wordCount) },
                    { l: 'Submitted', v: selectedAm.submitted },
                    { l: 'Programme', v: selectedAm.programme },
                  ].map(s => (
                    <div key={s.l} className="bg-background-100/50 rounded-lg p-2.5"><p className="text-[9px] text-foreground-400 uppercase tracking-wider">{s.l}</p><p className="text-[12px] font-medium text-foreground-900 truncate">{s.v}</p></div>
                  ))}
                </div>

                <div className="mb-3">
                  <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">KSB References</p>
                  <div className="flex items-center gap-1 flex-wrap">
                    {selectedAm.ksbRefs.map(k => <span key={k} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-secondary-100 text-secondary-700">{k}</span>)}
                  </div>
                </div>

                {selectedAm.aiScore != null && (
                  <div className="mb-3 p-3 bg-foreground-50 rounded-lg border border-background-200">
                    <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">AI Assisted Score</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-background-200 rounded-full h-2">
                        <div className={`h-2 rounded-full ${selectedAm.aiScore >= 70 ? 'bg-emerald-500' : selectedAm.aiScore >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${selectedAm.aiScore}%` }}></div>
                      </div>
                      <span className={`text-sm font-bold ${selectedAm.aiScore >= 70 ? 'text-emerald-600' : selectedAm.aiScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{selectedAm.aiScore}%</span>
                    </div>
                  </div>
                )}

                {selectedAm.status === 'marked' && selectedAm.grade && (
                  <div className="mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${gradeColors[selectedAm.grade]}`}>{selectedAm.grade}</span>
                      <span className="text-sm font-bold text-foreground-900">{selectedAm.score}%</span>
                    </div>
                    {selectedAm.feedback && <p className="text-[11px] text-foreground-400 mt-1">{selectedAm.feedback}</p>}
                  </div>
                )}

                {selectedAm.status === 'pending' && (
                  <div>
                    <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 mb-3 w-fit">
                      <button onClick={() => setMarkingMode('review')} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${markingMode === 'review' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>Mark</button>
                      <button onClick={() => setMarkingMode('grade')} className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${markingMode === 'grade' ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500'}`}>Grades</button>
                    </div>
                    {markingMode === 'review' ? (
                      <div className="space-y-2">
                        <textarea placeholder="Write feedback..." className="w-full p-2.5 rounded-lg border border-background-200 bg-background-50 text-[11px] text-foreground-700 placeholder:text-foreground-300 resize-none h-20 focus:outline-none focus:border-primary-300" />
                        <div className="flex items-center gap-2">
                          <button className="flex-1 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-check-line mr-1"></AppIcon> Submit Mark</button>
                          <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-close-line mr-1"></AppIcon> Return</button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <select className="w-full p-2 rounded-lg border border-background-200 bg-background-50 text-[11px] text-foreground-700 cursor-pointer">
                          <option>Distinction (90-100%)</option>
                          <option>Merit (70-89%)</option>
                          <option selected>Pass (50-69%)</option>
                          <option>Refer (&lt;50%)</option>
                        </select>
                        <input type="number" placeholder="Score (%)" className="w-full p-2 rounded-lg border border-background-200 bg-background-50 text-[11px] text-foreground-700 placeholder:text-foreground-300 focus:outline-none focus:border-primary-300" />
                        <button className="w-full px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-check-line mr-1"></AppIcon> Apply Grade</button>
                      </div>
                    )}
                  </div>
                )}

                <button className="w-full mt-3 px-3 py-1.5 bg-background-50 border border-background-200 rounded-lg text-[10px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap"><AppIcon className="ri-download-line mr-1"></AppIcon> Download Submission</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}