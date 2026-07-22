import { useState, useEffect } from 'react';
import type { GeneratedReport } from '../types';

interface ReportGeneratorModalProps {
  report: GeneratedReport | null;
  onClose: () => void;
}

function MiniChart({ chart }: { chart: GeneratedReport['sections'][0]['chart'] }) {
  if (!chart) return null;
  const maxVal = Math.max(1, ...chart.datasets.flatMap(d => d.values));
  return (
    <div className="space-y-4">
      {chart.datasets.map((ds, di) => (
        <div key={di} className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-foreground-600">
            <span className="font-medium">{ds.label}</span>
          </div>
          <div className="space-y-1">
            {chart.labels.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-500 w-10 shrink-0 text-right">{label}</span>
                <div className="flex-1 h-5 bg-background-100 rounded-md overflow-hidden flex">
                  <div className="h-full rounded-md flex items-center justify-end px-1" style={{ width: `${Math.max(4, (ds.values[i] / maxVal) * 100)}%`, backgroundColor: ds.color }}>
                    <span className="text-[9px] font-bold text-white">{ds.values[i]}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ReportGeneratorModal({ report, onClose }: ReportGeneratorModalProps) {
  const [phase, setPhase] = useState<'generating' | 'preview'>('generating');
  const [progress, setProgress] = useState(0);
  const [downloadAnim, setDownloadAnim] = useState(false);

  useEffect(() => {
    if (!report) return;
    setPhase('generating');
    setProgress(0);
    let p = 0;
    const interval = setInterval(() => {
      p += Math.random() * 15 + 5;
      if (p >= 100) {
        p = 100;
        clearInterval(interval);
        setTimeout(() => setPhase('preview'), 400);
      }
      setProgress(Math.min(100, p));
    }, 200);
    return () => clearInterval(interval);
  }, [report]);

  if (!report) return null;

  const handleDownload = () => {
    setDownloadAnim(true);
    setTimeout(() => {
      const blob = new Blob(
        [`${report.title}\nGenerated: ${report.generatedAt}\nCoach: ${report.coach}\nPeriod: ${report.period}\n\n${report.sections.map(s => `=== ${s.title} ===\n${s.content || ''}\n${s.metrics?.map(m => `${m.label}: ${m.value}`).join('\n') || ''}\n${s.findings?.map(f => `• ${f}`).join('\n') || ''}\n${s.recommendations?.map(r => `• ${r}`).join('\n') || ''}`).join('\n\n')}`],
        { type: 'text/plain' }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.title.replace(/\s+/g, '_')}_${report.generatedAt.replace(/\s/g, '')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      setDownloadAnim(false);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-foreground-950/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background-50 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="relative p-6 border-b border-foreground-200/60 flex items-center justify-between shrink-0" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-900)) 0%, oklch(var(--primary-800)) 100%)' }}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center"><i className="ri-file-chart-line text-white text-lg"></i></span>
            <div>
              <h3 className="text-sm font-bold text-white">{report.title}</h3>
              <p className="text-[11px] text-white/70">{report.subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/80 hover:text-white transition-smooth cursor-pointer">
            <i className="ri-close-line text-lg"></i>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {phase === 'generating' && (
            <div className="flex flex-col items-center justify-center py-16 space-y-6">
              <div className="relative w-20 h-20">
                <div className="absolute inset-0 rounded-full border-4 border-background-200" />
                <div className="absolute inset-0 rounded-full border-4 border-primary-400 border-t-transparent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-primary-600">{Math.round(progress)}%</span>
                </div>
              </div>
              <div className="text-center space-y-2">
                <p className="text-sm font-semibold text-foreground-900">Generating your report...</p>
                <p className="text-[12px] text-foreground-500">
                  {progress < 30 ? 'Collecting data from learner records...' : progress < 60 ? 'Analysing metrics and trends...' : progress < 85 ? 'Compiling findings and recommendations...' : 'Finalising report layout...'}
                </p>
              </div>
              <div className="w-64 h-1.5 bg-background-200 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {phase === 'preview' && (
            <div className="space-y-6">
              {/* Report Meta */}
              <div className="bg-background-100 rounded-xl p-4 flex flex-wrap items-center gap-4 text-[11px] text-foreground-600">
                <span className="flex items-center gap-1"><i className="ri-user-line text-primary-500"></i> Coach: <strong className="text-foreground-900">{report.coach}</strong></span>
                <span className="flex items-center gap-1"><i className="ri-calendar-line text-primary-500"></i> Period: <strong className="text-foreground-900">{report.period}</strong></span>
                <span className="flex items-center gap-1"><i className="ri-time-line text-primary-500"></i> Generated: <strong className="text-foreground-900">{report.generatedAt}</strong></span>
              </div>

              {/* Sections */}
              {report.sections.map((section, si) => (
                <div key={si} className="bg-background-50 rounded-xl border border-foreground-200/60 p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-primary-100 text-primary-600 flex items-center justify-center text-[11px] font-bold">{si + 1}</span>
                    <h4 className="text-sm font-bold text-foreground-900">{section.title}</h4>
                  </div>

                  {section.content && <p className="text-[12px] text-foreground-600 leading-relaxed">{section.content}</p>}

                  {section.metrics && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {section.metrics.map((m, mi) => (
                        <div key={mi} className="bg-background-100 rounded-lg p-3 space-y-1">
                          <p className="text-[10px] text-foreground-500 uppercase tracking-wide">{m.label}</p>
                          <p className="text-lg font-bold text-foreground-900">{m.value}</p>
                          {m.change && (
                            <p className={`text-[10px] font-medium ${m.trend === 'up' ? 'text-green-600' : m.trend === 'down' ? 'text-red-500' : 'text-foreground-500'}`}>
                              <i className={`mr-0.5 ${m.trend === 'up' ? 'ri-arrow-up-line' : m.trend === 'down' ? 'ri-arrow-down-line' : 'ri-subtract-line'}`}></i>
                              {m.change}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {section.table && (
                    <div className="overflow-x-auto rounded-lg border border-foreground-200/40">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-background-100">
                            {section.table.headers.map((h, hi) => (
                              <th key={hi} className="px-3 py-2 text-left font-semibold text-foreground-700 whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.table.rows.map((row, ri) => (
                            <tr key={ri} className={ri % 2 === 1 ? 'bg-background-100/50' : ''}>
                              {row.map((cell, ci) => (
                                <td key={ci} className={`px-3 py-2 text-foreground-700 whitespace-nowrap ${cell === 'At Risk' ? 'text-red-600 font-semibold' : cell === 'On Track' ? 'text-green-600 font-semibold' : cell === 'Pending' ? 'text-amber-600 font-semibold' : cell === 'Done' ? 'text-green-600 font-semibold' : cell === 'Closed' ? 'text-green-600 font-semibold' : cell === 'Open' ? 'text-amber-600 font-semibold' : cell === 'High' ? 'text-green-600 font-semibold' : cell === 'Low' ? 'text-red-600 font-semibold' : cell === 'Not Ready' ? 'text-red-600 font-semibold' : cell === 'Excellent' ? 'text-green-600 font-semibold' : cell === 'Good' ? 'text-green-600 font-semibold' : cell === 'Needs work' ? 'text-red-600 font-semibold' : ''}`}>
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {section.chart && (
                    <div className="bg-background-100 rounded-lg p-4">
                      <MiniChart chart={section.chart} />
                    </div>
                  )}

                  {section.findings && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-foreground-700 uppercase tracking-wide">Key Findings</p>
                      <ul className="space-y-1.5">
                        {section.findings.map((f, fi) => (
                          <li key={fi} className="flex items-start gap-2 text-[12px] text-foreground-600">
                            <span className="w-4 h-4 rounded-full bg-accent-100 text-accent-600 flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold">{fi + 1}</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {section.recommendations && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold text-foreground-700 uppercase tracking-wide">Recommendations</p>
                      <ul className="space-y-1.5">
                        {section.recommendations.map((r, ri) => (
                          <li key={ri} className="flex items-start gap-2 text-[12px] text-foreground-600">
                            <span className="w-4 h-4 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold">{ri + 1}</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === 'preview' && (
          <div className="p-4 border-t border-foreground-200/60 bg-background-100 flex items-center justify-between shrink-0">
            <p className="text-[11px] text-foreground-500">
              <i className="ri-information-line mr-1"></i>
              Report generated by LearningOS for {report.coach}
            </p>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-[12px] font-semibold text-foreground-600 hover:text-foreground-900 transition-smooth cursor-pointer whitespace-nowrap">
                Close
              </button>
              <button onClick={handleDownload} disabled={downloadAnim} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-[12px] font-semibold hover:bg-primary-600 transition-smooth cursor-pointer whitespace-nowrap flex items-center gap-1.5 disabled:opacity-60">
                {downloadAnim ? (
                  <>
                    <i className="ri-loader-4-line animate-spin"></i>
                    Preparing...
                  </>
                ) : (
                  <>
                    <i className="ri-download-line"></i>
                    Download Report
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
