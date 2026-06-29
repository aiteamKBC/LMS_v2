import type { LearningStyleProfile, SupportRequirement } from '@/mocks/initial-assessment';

interface LearningStylePanelProps {
  profile: LearningStyleProfile;
  supportRequirements: SupportRequirement[];
  diagnosticSummary: string;
  assessorRecommendation: string;
}

export function LearningStylePanel({ profile, supportRequirements, diagnosticSummary, assessorRecommendation }: LearningStylePanelProps) {
  const total = profile.visual + profile.auditory + profile.readingWriting + profile.kinaesthetic;
  const visualPct = Math.round((profile.visual / total) * 100);
  const auditoryPct = Math.round((profile.auditory / total) * 100);
  const readingPct = Math.round((profile.readingWriting / total) * 100);
  const kinaestheticPct = Math.round((profile.kinaesthetic / total) * 100);

  if (!profile.dateAssessed) {
    return (
      <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 text-center">
        <p className="text-[13px] text-foreground-400 py-8">Learning style assessment not yet completed</p>
      </section>
    );
  }

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 overflow-hidden">
      <div className="px-5 py-4 border-b border-foreground-400/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-heading font-semibold text-foreground-900">Learning Style & Support</h3>
            <p className="text-[12px] text-foreground-400 mt-0.5">VARK profile, diagnostic summary, and support requirements</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-foreground-400">Assessed: {formatDate(profile.dateAssessed)}</span>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* VARK bars */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Visual', value: profile.visual, pct: visualPct, color: 'bg-primary-500' },
            { label: 'Auditory', value: profile.auditory, pct: auditoryPct, color: 'bg-accent-500' },
            { label: 'Reading/Writing', value: profile.readingWriting, pct: readingPct, color: 'bg-emerald-500' },
            { label: 'Kinaesthetic', value: profile.kinaesthetic, pct: kinaestheticPct, color: 'bg-amber-500' },
          ].map(item => (
            <div key={item.label} className="px-3 py-3 rounded-lg bg-background-50 border border-background-200/40 text-center">
              <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-2">{item.label}</p>
              <div className="w-full h-2.5 bg-background-200 rounded-full overflow-hidden mb-2">
                <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.pct}%` }}></div>
              </div>
              <p className="text-[13px] font-semibold text-foreground-800">{item.pct}%</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 px-4 py-3 rounded-lg border border-background-200/50">
            <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">Primary Style</p>
            <p className="text-[14px] font-semibold text-foreground-800">{profile.primaryStyle}</p>
          </div>
          {profile.secondaryStyle && (
            <div className="flex-1 px-4 py-3 rounded-lg border border-background-200/50">
              <p className="text-[10px] text-foreground-400 uppercase tracking-wider mb-1">Secondary</p>
              <p className="text-[14px] font-semibold text-foreground-800">{profile.secondaryStyle}</p>
            </div>
          )}
        </div>

        {/* Recommendations */}
        {profile.recommendations.length > 0 && (
          <div>
            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-2">Learning Recommendations</p>
            <div className="space-y-1.5">
              {profile.recommendations.map((rec, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px] text-foreground-600">
                  <i className="ri-lightbulb-line text-amber-500 text-sm shrink-0 mt-0.5"></i>
                  <span>{rec}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Diagnostic summary */}
        {diagnosticSummary && (
          <div className="px-4 py-3 rounded-lg border border-background-200/50 bg-background-50">
            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-1.5">Diagnostic Summary</p>
            <p className="text-[13px] text-foreground-600 leading-relaxed">{diagnosticSummary}</p>
          </div>
        )}

        {/* Assessor recommendation */}
        {assessorRecommendation && (
          <div className="px-4 py-3 rounded-lg border border-primary-200/50 bg-primary-50/30">
            <p className="text-[11px] text-primary-600 uppercase tracking-wider font-medium mb-1.5">Assessor Recommendation</p>
            <p className="text-[13px] text-foreground-700 leading-relaxed">{assessorRecommendation}</p>
          </div>
        )}

        {/* Support requirements */}
        {supportRequirements.length > 0 && (
          <div>
            <p className="text-[11px] text-foreground-400 uppercase tracking-wider font-medium mb-2">Support Requirements ({supportRequirements.length})</p>
            <div className="space-y-2">
              {supportRequirements.map((sr, i) => {
                const urgencyConfig = sr.urgency === 'critical' ? 'bg-red-50 border-red-200/50'
                  : sr.urgency === 'priority' ? 'bg-amber-50 border-amber-200/50'
                  : 'bg-background-50 border-background-200/50';
                return (
                  <div key={i} className={`px-4 py-3 rounded-lg border ${urgencyConfig}`}>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <p className="text-[13px] font-semibold text-foreground-800">{sr.type}</p>
                      <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
                        sr.urgency === 'critical' ? 'bg-red-100 text-red-700'
                        : sr.urgency === 'priority' ? 'bg-amber-100 text-amber-700'
                        : 'bg-background-100 text-foreground-500'
                      }`}>{sr.urgency}</span>
                      {sr.recommended && (
                        <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 whitespace-nowrap">Recommended</span>
                      )}
                    </div>
                    <p className="text-[12px] text-foreground-600">{sr.detail}</p>
                    <p className="text-[11px] text-foreground-400 mt-1">{sr.costImplication}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}