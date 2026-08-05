import { CHECKPOINT_QUIZ_RULES } from '@/mocks/monthly-cycle';

export default function CheckpointQuizRules() {
  const d = CHECKPOINT_QUIZ_RULES;

  return (
    <div className="bg-background-50 rounded-xl border border-background-200/50 p-5">
      <div className="flex items-center gap-2 mb-2">
        <AppIcon className="ri-questionnaire-line text-foreground-600 text-sm"></AppIcon>
        <h3 className="text-sm font-heading font-semibold text-foreground-900">Checkpoint Quiz</h3>
      </div>
      <p className="text-xs mb-3"><span className="text-red-600 font-semibold bg-red-50 px-1.5 py-0.5 rounded">Not open yet</span></p>
      <p className="text-sm text-foreground-600 mb-3">
        Tests this month&apos;s main and secondary KSBs, EPA cross-reference and learning outcomes.{' '}
        Complete this before your coaching meeting.
      </p>

      {/* Unlock Rules */}
      <div className="bg-amber-50/50 border border-amber-200/50 rounded-lg p-3 mb-3">
        <p className="text-xs font-semibold text-amber-800 mb-2 flex items-center gap-1.5">
          <AppIcon className="ri-lock-line text-sm"></AppIcon>
          Available When
        </p>
        <div className="space-y-2">
          {d.unlockConditions.map((cond) => (
            <div key={cond.label} className="flex items-center gap-2">
              <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${cond.met ? 'bg-emerald-500 border-emerald-500' : 'border-foreground-300'}`}>
                {cond.met ? <AppIcon className="ri-check-line text-white text-[8px]"></AppIcon> : null}
              </span>
              <span className={`text-xs ${cond.met ? 'text-emerald-700' : 'text-foreground-500'}`}>
                <AppIcon className={`${cond.icon} mr-1`}></AppIcon>
                {cond.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* KSB Coverage */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[10px] font-semibold text-foreground-400">KSBs tested:</span>
        {d.ksbCoverage.map(k => (
          <span key={k} className="text-xs font-semibold bg-foreground-100 text-foreground-600 px-2 py-0.5 rounded">{k}</span>
        ))}
      </div>

      <div className="flex items-center gap-4 mb-3">
        <span className="text-xs text-foreground-400"><AppIcon className="ri-time-line mr-1"></AppIcon>{d.estimatedTime}</span>
        <span className="text-xs text-foreground-400"><AppIcon className="ri-check-double-line mr-1"></AppIcon>{d.passingScore}% to pass</span>
      </div>

      <button disabled className="px-4 py-2 bg-foreground-900 text-white rounded-lg text-sm font-semibold opacity-50 cursor-not-allowed whitespace-nowrap">
        Start Checkpoint
      </button>
    </div>
  );
}