import { useState } from 'react';
import type { BKSBResult } from '@/mocks/initial-assessment';

interface BKSBPanelProps {
  results: BKSBResult[];
}

export function BKSBPanel({ results }: BKSBPanelProps) {
  const [activeSubject, setActiveSubject] = useState<'English' | 'Maths'>(results[0]?.subject || 'English');
  const current = results.find(r => r.subject === activeSubject);

  if (!current) {
    return (
      <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 text-center">
        <p className="text-[13px] text-foreground-400 py-8">No BKSB assessment data available</p>
      </section>
    );
  }

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-heading font-semibold text-foreground-900">BKSB Assessment Results</h3>
          <div className="flex gap-1 p-1 bg-background-100 rounded-full">
            {results.map(r => (
              <button
                key={r.subject}
                onClick={() => setActiveSubject(r.subject)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium transition-smooth cursor-pointer whitespace-nowrap ${
                  activeSubject === r.subject ? 'bg-background-50 text-foreground-900 shadow-sm' : 'text-foreground-400 hover:text-foreground-600'
                }`}
              >
                {r.subject}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="px-3 py-2.5 rounded-lg bg-background-50 border border-background-200/40">
            <p className="text-[10px] text-foreground-400 uppercase tracking-wider">Initial Level</p>
            <p className="text-[15px] font-semibold text-foreground-800 mt-0.5">{current.initialLevel}</p>
          </div>
          <div className="px-3 py-2.5 rounded-lg bg-background-50 border border-background-200/40">
            <p className="text-[10px] text-foreground-400 uppercase tracking-wider">Diagnostic Level</p>
            <p className="text-[15px] font-semibold text-foreground-800 mt-0.5">{current.diagnosticLevel}</p>
          </div>
          <div className="px-3 py-2.5 rounded-lg bg-background-50 border border-background-200/40">
            <p className="text-[10px] text-foreground-400 uppercase tracking-wider">Score</p>
            <p className="text-[15px] font-semibold text-foreground-800 mt-0.5">{current.diagnosticScore}/{current.maxScore}</p>
          </div>
          <div className="px-3 py-2.5 rounded-lg bg-background-50 border border-background-200/40">
            <p className="text-[10px] text-foreground-400 uppercase tracking-wider">Time</p>
            <p className="text-[15px] font-semibold text-foreground-800 mt-0.5">{current.timeTaken}</p>
          </div>
        </div>

        {/* Assessment info */}
        <div className="flex items-center gap-4 text-[11px] text-foreground-400 flex-wrap">
          <span>Date: {formatDate(current.dateTaken)}</span>
          <span>&middot;</span>
          <span>Proctored: {current.proctored ? 'Yes' : 'No'}</span>
          {current.proctorNote && (
            <>
              <span>&middot;</span>
              <span className="text-foreground-500 italic">{current.proctorNote}</span>
            </>
          )}
        </div>

        {/* Area breakdown */}
        <div>
          <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-3">Diagnostic Skill Areas</p>
          <div className="space-y-2.5">
            {current.areas.map(area => {
              const barColor = area.status === 'above' ? 'bg-emerald-500'
                : area.status === 'at' ? 'bg-primary-500'
                : area.status === 'below' ? 'bg-amber-500'
                : 'bg-red-500';
              const textColor = area.status === 'above' ? 'text-emerald-600'
                : area.status === 'at' ? 'text-primary-600'
                : area.status === 'below' ? 'text-amber-600'
                : 'text-red-600';
              return (
                <div key={area.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] text-foreground-700 font-medium">{area.name}</span>
                    <span className={`text-[11px] font-semibold ${textColor}`}>{area.percentage}%</span>
                  </div>
                  <div className="w-full h-2 bg-background-200 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-smooth ${barColor}`} style={{ width: `${area.percentage}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}