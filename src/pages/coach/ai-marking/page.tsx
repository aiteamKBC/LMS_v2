import { useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';

const coachNav = roleNavMap.coach;

const AI_MARKING_ITEMS = [
  { id: 'ai-1', learner: 'Sophie Williams', initials: 'SW', programme: 'Marketing Executive L4', title: 'Workplace Reflection — Segmentation', type: 'Reflection', submitted: '8 Jun 2026', aiScore: 78, aiFeedback: 'Good analysis of segmentation approaches. Could strengthen with more data-driven examples. K3, K4 partially met.', confidence: 'high' as const, status: 'ready' as const },
  { id: 'ai-2', learner: 'James Okonkwo', initials: 'JO', programme: 'Data Analyst L4', title: 'Data Cleaning Report', type: 'Report', submitted: '7 Jun 2026', aiScore: 65, aiFeedback: 'Methodology section requires expansion. Missing references to data quality frameworks. K2, S3 not fully evidenced.', confidence: 'medium' as const, status: 'ready' as const },
  { id: 'ai-3', learner: 'Emily Watson', initials: 'EW', programme: 'Digital Marketer L3', title: 'Social Media Campaign Results', type: 'Campaign Evidence', submitted: '5 Jun 2026', aiScore: 92, aiFeedback: 'Excellent campaign analysis with clear metrics. ROI calculations well presented. All KSBs strongly evidenced.', confidence: 'high' as const, status: 'ready' as const },
  { id: 'ai-4', learner: 'Sarah Mitchell', initials: 'SM', programme: 'Business Administrator L3', title: 'Meeting Minutes — Board Prep', type: 'Workplace Evidence', submitted: '3 Jun 2026', aiScore: 85, aiFeedback: 'Professional standard minutes. Action items clearly tracked. B1, B2 demonstrated effectively.', confidence: 'high' as const, status: 'ready' as const },
  { id: 'ai-5', learner: 'David Chen', initials: 'DC', programme: 'Software Developer L4', title: 'Code Review Documentation', type: 'Documentation', submitted: '2 Jun 2026', aiScore: 88, aiFeedback: 'Thorough code review with good practices identified. Could add peer review feedback. S4, S5 well evidenced.', confidence: 'high' as const, status: 'ready' as const },
  { id: 'ai-6', learner: 'Liam Foster', initials: 'LF', programme: 'Project Manager L4', title: 'Project Risk Register', type: 'Project Evidence', submitted: '4 Jun 2026', aiScore: 72, aiFeedback: 'Risk register covers basic requirements. Mitigation strategies need more detail. K6 partially met.', confidence: 'medium' as const, status: 'ready' as const },
];

export default function CoachAiMarking() {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [humanScores, setHumanScores] = useState<Record<string, number>>({});

  const avgAiScore = Math.round(AI_MARKING_ITEMS.reduce((a, b) => a + b.aiScore, 0) / AI_MARKING_ITEMS.length);
  const highConfidence = AI_MARKING_ITEMS.filter(i => i.confidence === 'high').length;

  return (
    <WorkspaceShell role="coach" roleLabel={coachNav.label} navItems={coachNav.items} workspaceLabel={coachNav.workspaceLabel} pageTitle="AI-assisted Marking" pageSubtitle="Review AI-generated assessments and provide final scores" userName="Med Maher" userRole="Progress Coach">
      <div className="p-6 space-y-6">
        {/* Hero Banner */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 50%, oklch(var(--primary-800)) 100%)' }}>
          <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-white/5" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <span className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <i className="ri-robot-line text-white text-2xl"></i>
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-heading font-bold text-white mb-1">AI-assisted Marking</h2>
              <p className="text-[13px] text-white/80 leading-relaxed">
                <strong>{AI_MARKING_ITEMS.length} items</strong> ready for AI-assisted review. Average AI score: {avgAiScore}%. {highConfidence} high confidence assessments.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{AI_MARKING_ITEMS.length}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Ready</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{avgAiScore}%</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">Avg AI Score</p>
              </div>
              <div className="bg-white/15 backdrop-blur-sm rounded-xl px-4 py-3 text-center">
                <p className="text-2xl font-bold text-white">{highConfidence}</p>
                <p className="text-[10px] text-white/70 uppercase tracking-wide">High Confidence</p>
              </div>
            </div>
          </div>
        </div>

        {/* AI Marking Cards */}
        <div className="space-y-3">
          {AI_MARKING_ITEMS.map(item => {
            const isOpen = selectedItem === item.id;
            const humanScore = humanScores[item.id] ?? item.aiScore;
            return (
              <div key={item.id} className={`bg-background-50 rounded-xl border p-4 transition-smooth cursor-pointer ${isOpen ? 'border-primary-300 ring-1 ring-primary-200/50' : 'border-foreground-200/60'}`} onClick={() => setSelectedItem(isOpen ? null : item.id)}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-accent-100 text-accent-700 flex items-center justify-center ring-2 ring-accent-200 shrink-0">
                    <span className="text-sm font-bold">{item.initials}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground-900">{item.learner}</p>
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-accent-100 text-accent-700">{item.confidence} confidence</span>
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary-100 text-primary-700">AI Score: {item.aiScore}%</span>
                    </div>
                    <p className="text-[11px] text-foreground-400 mt-0.5">{item.title} · {item.type}</p>
                  </div>
                  <div className="hidden lg:flex items-center gap-4 text-[11px] text-foreground-500 shrink-0">
                    <span>{item.programme}</span>
                    <span>Submitted: {item.submitted}</span>
                  </div>
                  <i className={`${isOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-foreground-300`}></i>
                </div>
                {isOpen && (
                  <div className="mt-4 ml-14 pt-3 border-t border-background-200/30 space-y-4">
                    <div className="bg-accent-50 rounded-lg p-4 border border-accent-200/30">
                      <div className="flex items-center gap-2 mb-2">
                        <i className="ri-robot-line text-accent-600 text-sm"></i>
                        <span className="text-[12px] font-semibold text-accent-900">AI Feedback</span>
                      </div>
                      <p className="text-[12px] text-foreground-700 leading-relaxed">{item.aiFeedback}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <label className="text-[11px] font-semibold text-foreground-700 mb-1 block">Final Score Override</label>
                        <div className="flex items-center gap-3">
                          <input type="range" min="0" max="100" value={humanScore} onChange={e => setHumanScores(prev => ({ ...prev, [item.id]: parseInt(e.target.value) }))} className="flex-1 h-2 bg-background-200 rounded-full appearance-none cursor-pointer" onClick={e => e.stopPropagation()} />
                          <span className="text-lg font-bold text-foreground-900 w-12 text-center">{humanScore}%</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="px-4 py-2 bg-accent-500 text-white rounded-lg text-[12px] font-semibold hover:bg-accent-600 transition-smooth cursor-pointer whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <i className="ri-check-line mr-1"></i> Accept AI Score
                      </button>
                      <button className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <i className="ri-pencil-line mr-1"></i> Apply Final Score
                      </button>
                      <button className="px-4 py-2 bg-background-50 border border-background-200 rounded-lg text-[12px] font-medium text-foreground-600 hover:bg-background-100 transition-smooth cursor-pointer whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <i className="ri-file-search-line mr-1"></i> View Evidence
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </WorkspaceShell>
  );
}