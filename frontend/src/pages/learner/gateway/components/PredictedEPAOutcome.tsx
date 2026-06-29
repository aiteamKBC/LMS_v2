import { useState } from 'react';
import { PREDICTED_EPA_OUTCOME } from '@/mocks/gateway-readiness';

export function PredictedEPAOutcome() {
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-4 card-premium">
      <div className="flex items-start justify-between mb-3">
        <span className="w-9 h-9 rounded-lg bg-accent-50 flex items-center justify-center">
          <i className="ri-medal-line text-accent-700"></i>
        </span>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-accent-100 text-accent-700">
          Prediction
        </span>
      </div>
      <p className="text-xs text-foreground-400 mb-1">Predicted EPA Outcome</p>
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-2xl font-heading font-bold text-accent-700">{PREDICTED_EPA_OUTCOME.grade}</p>
        <span className="text-xs text-foreground-500">Confidence: {PREDICTED_EPA_OUTCOME.confidence}%</span>
      </div>

      {/* Factor bars */}
      <div className="space-y-1.5 mt-3">
        {PREDICTED_EPA_OUTCOME.factors.map(factor => (
          <div key={factor.label}>
            <div className="flex items-center justify-between text-[9px] mb-0.5">
              <span className="text-foreground-500">{factor.label}</span>
              <span className="text-foreground-400">{factor.weight}</span>
            </div>
            <div className="h-1.5 rounded-full bg-background-200 overflow-hidden">
              <div
                className="h-1.5 rounded-full bg-accent-400 transition-all duration-700"
                style={{ width: `${factor.score}%` }}
              ></div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => setShowDisclaimer(!showDisclaimer)}
        className="mt-3 text-[9px] text-foreground-400 hover:text-foreground-600 transition-smooth cursor-pointer flex items-center gap-1"
      >
        <i className="ri-information-line"></i>
        {showDisclaimer ? 'Hide disclaimer' : 'Show disclaimer'}
      </button>
      {showDisclaimer && (
        <p className="mt-2 text-[9px] text-foreground-400 leading-relaxed bg-background-100 rounded-md p-2 animate-in fade-in duration-200">
          {PREDICTED_EPA_OUTCOME.disclaimer}
        </p>
      )}
    </div>
  );
}