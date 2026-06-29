import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const tutorNav = roleNavMap.tutor;

interface AIMarkingItem {
  id: string;
  learner: string;
  assignment: string;
  type: string;
  submittedDate: string;
  wordCount: number;
  aiScore: number | null;
  aiFeedback: string | null;
  confidence: number | null;
  status: 'Queued' | 'Analysing' | 'Ready' | 'Reviewed';
}

const AI_MARKING_ITEMS: AIMarkingItem[] = [
  { id: 'ai-01', learner: 'Sophie Williams', assignment: 'Campaign Segmentation Worksheet', type: 'Assignment', submittedDate: '8 Jun', wordCount: 1200, aiScore: 72, aiFeedback: 'Good segmentation logic but missing competitor analysis depth. K5 criteria partially met — suggest adding 2 more competitor profiles.', confidence: 88, status: 'Ready' },
  { id: 'ai-02', learner: 'James Okonkwo', assignment: 'Data Visualisation Report', type: 'Report', submittedDate: '7 Jun', wordCount: 1800, aiScore: 58, aiFeedback: 'Visualisations are clear but analysis lacks statistical depth. S12 criteria not fully met — recommend additional regression analysis section.', confidence: 91, status: 'Ready' },
  { id: 'ai-03', learner: 'Aisha Patel', assignment: 'Financial Statement Analysis', type: 'Assignment', submittedDate: '6 Jun', wordCount: 950, aiScore: 65, aiFeedback: 'Basic financial ratios calculated correctly but interpretation needs expansion. K8 criteria partially met.', confidence: 85, status: 'Ready' },
  { id: 'ai-04', learner: 'Liam Foster', assignment: 'Risk Register & Mitigation Plan', type: 'Project Evidence', submittedDate: '4 Jun', wordCount: 2100, aiScore: 81, aiFeedback: 'Comprehensive risk register with well-structured mitigation strategies. S18 criteria fully demonstrated.', confidence: 93, status: 'Ready' },
  { id: 'ai-05', learner: 'David Chen', assignment: 'Code Review & Documentation', type: 'Documentation', submittedDate: '3 Jun', wordCount: 800, aiScore: null, aiFeedback: null, confidence: null, status: 'Analysing' },
  { id: 'ai-06', learner: 'Maya Kapoor', assignment: 'HR Policy Review Reflection', type: 'Reflection', submittedDate: '1 Jun', wordCount: 600, aiScore: 45, aiFeedback: 'Reflection is surface-level. B2 criteria not demonstrated — suggest requesting resubmission with deeper ethical analysis.', confidence: 90, status: 'Reviewed' },
  { id: 'ai-07', learner: 'Chloe Evans', assignment: 'Email Campaign Analysis', type: 'Report', submittedDate: '9 Jun', wordCount: 1400, aiScore: null, aiFeedback: null, confidence: null, status: 'Queued' },
  { id: 'ai-08', learner: 'Omar Hassan', assignment: 'Office Procedures Manual Review', type: 'Reflection', submittedDate: '9 Jun', wordCount: 750, aiScore: null, aiFeedback: null, confidence: null, status: 'Queued' },
];

export default function TutorAiMarkingPage() {
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');

  const filtered = filter === 'all' ? AI_MARKING_ITEMS : AI_MARKING_ITEMS.filter(i => i.status.toLowerCase() === filter.toLowerCase());
  const readyCount = AI_MARKING_ITEMS.filter(i => i.status === 'Ready').length;
  const reviewedCount = AI_MARKING_ITEMS.filter(i => i.status === 'Reviewed').length;
  const avgScore = AI_MARKING_ITEMS.filter(i => i.aiScore != null).reduce((s, i) => s + (i.aiScore || 0), 0) / AI_MARKING_ITEMS.filter(i => i.aiScore != null).length;

  return (
    <WorkspaceShell role="tutor" roleLabel={tutorNav.label} navItems={tutorNav.items} workspaceLabel={tutorNav.workspaceLabel} pageTitle="AI Marking" pageSubtitle="AI-assisted marking and feedback generation — review, adjust and approve AI suggestions" userName="Rachel Myers" userRole="Business Admin Tutor">
      <div className="p-6 space-y-6">
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"><i className="ri-robot-line text-white text-2xl"></i></span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">AI-Assisted Marking</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">{readyCount} ready for your review · {reviewedCount} reviewed · Avg AI score: {avgScore.toFixed(0)}% · AI suggestions require human validation</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{AI_MARKING_ITEMS.length}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Total</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-emerald-300">{readyCount}</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Ready</p></div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center"><p className="text-2xl font-bold text-white">{avgScore.toFixed(0)}%</p><p className="text-[10px] text-white/70 uppercase tracking-wide">Avg Score</p></div>
            </div>
          </div>
        </div>

        <div className="bg-amber-50/50 border border-amber-200/50 rounded-xl p-4 flex items-start gap-3">
          <span className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><i className="ri-information-line"></i></span>
          <div>
            <p className="text-[12px] font-semibold text-amber-800 mb-0.5">AI suggestions require human validation</p>
            <p className="text-[11px] text-amber-600">All AI-generated scores and feedback must be reviewed by you before they are shared with learners. The AI is a marking assistant, not a replacement for professional judgement.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { l: 'Ready for Review', v: String(readyCount), i: 'ri-eye-line', c: 'emerald' },
            { l: 'Currently Analysing', v: String(AI_MARKING_ITEMS.filter(i => i.status === 'Analysing').length), i: 'ri-loader-4-line', c: 'amber' },
            { l: 'In Queue', v: String(AI_MARKING_ITEMS.filter(i => i.status === 'Queued').length), i: 'ri-hourglass-line', c: 'foreground' },
            { l: 'Reviewed & Sent', v: String(reviewedCount), i: 'ri-check-double-line', c: 'primary' },
          ].map(s => (
            <div key={s.l} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4 cursor-pointer">
              <span className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${s.c === 'emerald' ? 'bg-emerald-100 text-emerald-600' : s.c === 'amber' ? 'bg-amber-100 text-amber-600' : s.c === 'primary' ? 'bg-primary-100 text-primary-600' : 'bg-foreground-100 text-foreground-500'}`}><i className={`${s.i} text-sm`}></i></span>
              <p className="text-[11px] text-foreground-400 mb-1">{s.l}</p>
              <p className="text-2xl font-heading font-semibold text-foreground-900">{s.v}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto">
          {['all', 'ready', 'analysing', 'queued', 'reviewed'].map(s => (
            <button key={s} onClick={() => setFilter(s)} className={`px-4 py-1.5 rounded-lg text-[11px] font-semibold transition-smooth whitespace-nowrap cursor-pointer capitalize ${filter === s ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-500 hover:text-foreground-700'}`}>{s === 'all' ? 'All' : s}</button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.map(item => (
            <div key={item.id} className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
              <div onClick={() => setExpandedId(expandedId === item.id ? null : item.id)} className="p-4 flex items-center gap-4 cursor-pointer hover:bg-background-100/30 transition-smooth">
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[10px] font-bold ${
                  item.status === 'Ready' ? 'bg-emerald-100 text-emerald-700' :
                  item.status === 'Analysing' ? 'bg-amber-100 text-amber-700' :
                  item.status === 'Reviewed' ? 'bg-primary-100 text-primary-700' :
                  'bg-foreground-100 text-foreground-500'
                }`}>
                  {item.status === 'Ready' && item.aiScore != null ? `${item.aiScore}%` :
                   item.status === 'Analysing' ? <i className="ri-loader-4-line animate-spin text-sm"></i> :
                   item.status === 'Reviewed' ? <i className="ri-check-line"></i> :
                   <i className="ri-time-line"></i>}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-foreground-900 truncate">{item.assignment}</p>
                  <div className="flex items-center gap-x-2 gap-y-1 mt-0.5 flex-wrap text-[11px] text-foreground-400">
                    <span>{item.learner}</span>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span>{item.type}</span>
                    <span className="text-[8px] text-foreground-300">&middot;</span>
                    <span>{item.wordCount} words</span>
                    {item.confidence != null && (<><span className="text-[8px] text-foreground-300">&middot;</span><span>AI confidence {item.confidence}%</span></>)}
                  </div>
                </div>
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full ${
                  item.status === 'Ready' ? 'bg-emerald-100 text-emerald-700' :
                  item.status === 'Analysing' ? 'bg-amber-100 text-amber-700 animate-pulse' :
                  item.status === 'Reviewed' ? 'bg-primary-100 text-primary-700' :
                  'bg-foreground-100 text-foreground-500'
                }`}>{item.status}</span>
                <i className={expandedId === item.id ? 'ri-arrow-up-s-line text-foreground-300' : 'ri-arrow-down-s-line text-foreground-300'}></i>
              </div>
              {expandedId === item.id && (
                <div className="px-4 pb-4 border-t border-background-200/30 pt-3">
                  {item.aiFeedback && (
                    <div className="bg-primary-50/50 border border-primary-200/30 rounded-lg p-3 mb-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <i className="ri-robot-line text-primary-600 text-sm"></i>
                        <span className="text-[10px] font-semibold text-primary-700 uppercase">AI Feedback</span>
                        {item.aiScore != null && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-700 ml-auto">Score: {item.aiScore}%</span>}
                        {item.confidence != null && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-foreground-100 text-foreground-500">Confidence: {item.confidence}%</span>}
                      </div>
                      <p className="text-[11px] text-foreground-600 leading-relaxed">{item.aiFeedback}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    {[
                      { l: 'Learner', v: item.learner },
                      { l: 'Assignment', v: item.assignment },
                      { l: 'Type', v: item.type },
                      { l: 'Word Count', v: String(item.wordCount) },
                    ].map(st => (
                      <div key={st.l} className="bg-background-100/50 rounded-lg p-2.5"><p className="text-[9px] text-foreground-400 uppercase tracking-wider">{st.l}</p><p className="text-[12px] font-medium text-foreground-900 truncate">{st.v}</p></div>
                    ))}
                  </div>
                  <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Add your review notes or adjust AI feedback..." className="w-full px-3 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] text-foreground-900 placeholder-foreground-300 outline-none focus:border-primary-300 resize-none mb-3" rows={2} />
                  <div className="flex items-center gap-2">
                    {item.status === 'Ready' && (
                      <>
                        <button className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-semibold hover:bg-emerald-700 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-check-line mr-1"></i> Approve & Send</button>
                        <button className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-[10px] font-semibold hover:bg-amber-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-pencil-line mr-1"></i> Edit Before Sending</button>
                        <button className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[10px] font-semibold hover:bg-red-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-close-line mr-1"></i> Reject AI Marking</button>
                      </>
                    )}
                    {item.status === 'Queued' && (
                      <button className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[10px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap"><i className="ri-play-line mr-1"></i> Start AI Analysis</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </WorkspaceShell>
  );
}