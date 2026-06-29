import { useState } from 'react';
import { Link } from 'react-router-dom';

interface KSBData {
  code: string;
  label: string;
  type: string;
  quizCount: number;
  passedCount: number;
}

interface KSBHeatMapProps {
  knowledgeKsbs: KSBData[];
  skillKsbs: KSBData[];
  behaviourKsbs: KSBData[];
}

export function KSBHeatMap({ knowledgeKsbs, skillKsbs, behaviourKsbs }: KSBHeatMapProps) {
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const allKsbs = [
    { group: 'Knowledge', items: knowledgeKsbs, colorKey: 'primary' },
    { group: 'Skills', items: skillKsbs, colorKey: 'accent' },
    { group: 'Behaviours', items: behaviourKsbs, colorKey: 'emerald' },
  ];

  const heatIntensity = (progress: number) => {
    if (progress === 0) return 'bg-background-100';
    if (progress <= 25) return 'bg-primary-200';
    if (progress <= 50) return 'bg-primary-300';
    if (progress <= 75) return 'bg-primary-400';
    return 'bg-primary-500';
  };

  const heatText = (progress: number) => {
    if (progress === 0) return 'text-foreground-300';
    if (progress <= 50) return 'text-foreground-700';
    return 'text-white';
  };

  const heatBorder = (progress: number) => {
    if (progress === 0) return 'border-foreground-200/60';
    if (progress <= 50) return 'border-primary-200/60';
    return 'border-primary-500/30';
  };

  const totalK = knowledgeKsbs.length;
  const totalS = skillKsbs.length;
  const totalB = behaviourKsbs.length;
  const passedK = knowledgeKsbs.reduce((s, k) => s + k.passedCount, 0);
  const passedS = skillKsbs.reduce((s, k) => s + k.passedCount, 0);
  const passedB = behaviourKsbs.reduce((s, k) => s + k.passedCount, 0);
  const totalQuizzesK = knowledgeKsbs.reduce((s, k) => s + k.quizCount, 0);
  const totalQuizzesS = skillKsbs.reduce((s, k) => s + k.quizCount, 0);
  const totalQuizzesB = behaviourKsbs.reduce((s, k) => s + k.quizCount, 0);
  const pctK = totalQuizzesK > 0 ? Math.round((passedK / totalQuizzesK) * 100) : 0;
  const pctS = totalQuizzesS > 0 ? Math.round((passedS / totalQuizzesS) * 100) : 0;
  const pctB = totalQuizzesB > 0 ? Math.round((passedB / totalQuizzesB) * 100) : 0;

  const summaryCards = [
    { label: 'Knowledge', count: totalK, passed: passedK, totalQ: totalQuizzesK, pct: pctK, color: 'primary', icon: 'ri-book-open-line', bar: 'bg-primary-500' },
    { label: 'Skills', count: totalS, passed: passedS, totalQ: totalQuizzesS, pct: pctS, color: 'accent', icon: 'ri-tools-line', bar: 'bg-accent-500' },
    { label: 'Behaviours', count: totalB, passed: passedB, totalQ: totalQuizzesB, pct: pctB, color: 'emerald', icon: 'ri-heart-line', bar: 'bg-emerald-500' },
  ];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {summaryCards.map(cat => (
          <div key={cat.label} className="bg-background-50 rounded-xl border border-foreground-200/60 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${cat.color === 'primary' ? 'bg-primary-100' : cat.color === 'accent' ? 'bg-accent-100' : 'bg-emerald-100'}`}>
                <i className={`${cat.icon} ${cat.color === 'primary' ? 'text-primary-600' : cat.color === 'accent' ? 'text-accent-600' : 'text-emerald-600'} text-xs`}></i>
              </span>
              <span className="text-sm font-semibold text-foreground-900">{cat.label}</span>
              <span className="text-xs text-foreground-400 ml-auto">{cat.count} KSBs</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <div className="relative w-12 h-12 shrink-0">
                <svg width="48" height="48" className="-rotate-90">
                  <circle cx="24" cy="24" r="20" fill="none" className="stroke-background-200" strokeWidth="4" />
                  <circle cx="24" cy="24" r="20" fill="none" className={`${cat.color === 'primary' ? 'stroke-primary-500' : cat.color === 'accent' ? 'stroke-accent-500' : 'stroke-emerald-500'}`} strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 20}
                    strokeDashoffset={2 * Math.PI * 20 - (Math.min(cat.pct, 100) / 100) * 2 * Math.PI * 20}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={`text-xs font-bold ${cat.color === 'primary' ? 'text-primary-600' : cat.color === 'accent' ? 'text-accent-600' : 'text-emerald-600'}`}>{cat.pct}%</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs text-foreground-400 mb-1">
                  <span>{cat.passed}/{cat.totalQ} quizzes</span>
                </div>
                <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${cat.bar}`} style={{ width: `${cat.pct}%` }} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Heat Map Grid */}
      <div className="bg-background-50 rounded-xl border border-foreground-200/60 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-foreground-200/40">
          <span className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
            <i className="ri-fire-line text-primary-600 text-sm"></i>
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground-900">KSB Mastery Heat Map</h3>
            <p className="text-xs text-foreground-400">Colour intensity shows mastery level across Knowledge, Skills & Behaviours</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-[10px] text-foreground-400">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-background-100 border border-foreground-200/60"></span> 0%</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary-200"></span> 25%</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary-300"></span> 50%</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary-400"></span> 75%</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary-500"></span> 100%</span>
          </div>
        </div>

        <div className="p-5 space-y-6">
          {allKsbs.map(group => {
            if (group.items.length === 0) return null;
            return (
              <div key={group.group}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-5 h-5 rounded-md flex items-center justify-center ${group.colorKey === 'primary' ? 'bg-primary-100' : group.colorKey === 'accent' ? 'bg-accent-100' : 'bg-emerald-100'}`}>
                    <i className={`${group.group === 'Knowledge' ? 'ri-book-open-line' : group.group === 'Skills' ? 'ri-tools-line' : 'ri-heart-line'} ${group.colorKey === 'primary' ? 'text-primary-600' : group.colorKey === 'accent' ? 'text-accent-600' : 'text-emerald-600'} text-[10px]`}></i>
                  </span>
                  <span className="text-xs font-semibold text-foreground-500 uppercase tracking-wider">{group.group}</span>
                  <span className="text-xs text-foreground-400">{group.items.length} KSBs</span>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                  {group.items.map(k => {
                    const progress = k.quizCount > 0 ? Math.round((k.passedCount / k.quizCount) * 100) : 0;
                    const isComplete = progress === 100;
                    const cellId = `${group.group}-${k.code}`;
                    return (
                      <div
                        key={k.code}
                        className={`relative rounded-lg border p-3 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-200 hover:scale-105 hover:shadow-sm ${heatBorder(progress)} ${heatIntensity(progress)}`}
                        onMouseEnter={() => setHoveredCell(cellId)}
                        onMouseLeave={() => setHoveredCell(null)}
                      >
                        <span className={`text-xs font-bold ${heatText(progress)}`}>{k.code}</span>
                        <span className={`text-[10px] font-semibold ${heatText(progress)}`}>{progress}%</span>
                        {isComplete && (
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center">
                            <i className="ri-check-line text-white text-[8px]"></i>
                          </span>
                        )}

                        {/* Hover tooltip */}
                        {hoveredCell === cellId && (
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 w-48 pointer-events-none">
                            <div className="bg-foreground-900 text-white rounded-lg p-2.5 shadow-lg text-xs">
                              <p className="font-semibold mb-0.5">{k.code}</p>
                              <p className="text-white/70 mb-1.5 leading-tight">{k.label}</p>
                              <div className="flex items-center gap-2 text-white/60">
                                <span>{k.passedCount}/{k.quizCount} quizzes</span>
                                <span className="text-white font-semibold">{progress}%</span>
                              </div>
                            </div>
                            <div className="absolute left-1/2 -translate-x-1/2 top-full w-2 h-2 bg-foreground-900 rotate-45 -mt-1"></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="flex items-center justify-end">
        <Link
          to="/learner/ksbs"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-50 text-primary-700 rounded-lg text-sm font-medium hover:bg-primary-100 transition-smooth border border-primary-200/60 whitespace-nowrap cursor-pointer"
        >
          <i className="ri-bar-chart-2-line"></i> View Full KSBs Page
        </Link>
      </div>
    </div>
  );
}