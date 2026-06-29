import { COACH_RECOMMENDATIONS } from '@/mocks/gateway-readiness';

export function CoachRecommendations() {
  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-9 h-9 rounded-lg bg-accent-100 flex items-center justify-center shrink-0">
          <i className="ri-user-voice-line text-accent-700"></i>
        </span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">Coach Recommendations</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Personalised guidance from your coach to help you reach Gateway</p>
        </div>
      </div>

      <div className="space-y-2">
        {COACH_RECOMMENDATIONS.map(rec => (
          <div key={rec.id} className="flex items-start gap-3 p-3 bg-background-100/50 rounded-lg border border-background-200/30">
            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
              rec.priority === 'high' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
            }`}>
              <i className={`${rec.icon} text-sm`}></i>
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  rec.priority === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {rec.priority === 'high' ? 'High Priority' : 'Medium Priority'}
                </span>
              </div>
              <p className="text-sm text-foreground-700 leading-relaxed">{rec.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}