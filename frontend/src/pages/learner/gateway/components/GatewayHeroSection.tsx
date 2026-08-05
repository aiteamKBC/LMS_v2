import { GATEWAY_READINESS_SCORE, getReadinessBand, GATEWAY_BLOCKERS, GATEWAY_COUNTDOWN, GATEWAY_PROGRESS_STATUS } from '@/mocks/gateway-readiness';

export function GatewayHeroSection() {
  const band = getReadinessBand(GATEWAY_READINESS_SCORE);

  return (
    <div className="space-y-4">
      {/* Hero Banner */}
      <div className="relative rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, oklch(var(--primary-950)) 0%, oklch(var(--primary-900)) 40%, oklch(var(--primary-800)) 100%)' }}>
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute animate-liquid-blob-1 opacity-25" style={{ width: '60%', height: '30%', left: '-10%', top: '-10%', background: 'radial-gradient(ellipse at center, oklch(var(--accent-500) / 0.3) 0%, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="absolute animate-liquid-blob-2 opacity-15" style={{ width: '70%', height: '35%', right: '-15%', top: '15%', background: 'radial-gradient(ellipse at center, oklch(var(--secondary-400) / 0.2) 0%, transparent 70%)', filter: 'blur(55px)' }} />
        </div>
        <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
          <span className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur-sm flex items-center justify-center shrink-0">
            <AppIcon className="ri-flag-line text-white text-2xl"></AppIcon>
          </span>
          <div className="flex-1">
            <h2 className="text-lg font-heading font-bold text-white mb-1">Gateway Readiness Dashboard</h2>
            <p className="text-sm text-white/80 leading-relaxed max-w-2xl">
              Your Gateway target date is <strong>October 2027</strong>. You are currently at Week 4 of your programme.
              The Gateway is your formal checkpoint before entering the End-Point Assessment (EPA) phase.
            </p>
          </div>
          {/* Readiness Score */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-white/15 backdrop-blur-sm rounded-xl px-5 py-4 text-center min-w-[140px]">
              <p className="text-3xl font-bold text-white">{GATEWAY_READINESS_SCORE}%</p>
              <p className="text-xs text-white/70 font-medium uppercase tracking-wide mt-1">Gateway Ready</p>
              <span className={`inline-block mt-2 text-[9px] font-bold px-2 py-0.5 rounded-full ${band.bg} ${band.text}`}>
                {band.label}
              </span>
            </div>
          </div>
        </div>
        {/* Readiness Band Bar */}
        <div className="relative px-6 sm:px-8 pb-5">
          <div className="flex items-center gap-1 text-[9px] font-semibold text-white/60 uppercase tracking-wide mb-1.5">
            <span>Getting Started</span>
            <span className="flex-1 text-center">Developing</span>
            <span className="flex-1 text-center">On Track</span>
            <span>Gateway Ready</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden flex">
            <div className="flex-1 bg-red-400/60"></div>
            <div className="flex-1 bg-amber-400/60"></div>
            <div className="flex-1 bg-emerald-400/60"></div>
            <div className="flex-1 bg-emerald-500/80"></div>
          </div>
          {/* Score marker */}
          <div
            className="absolute top-5 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[8px] border-b-white transition-all duration-700"
            style={{ left: `calc(${GATEWAY_READINESS_SCORE}% - 6px)` }}
          ></div>
        </div>
      </div>

      {/* What's Blocking Me */}
      <div className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
        <div className="flex items-start gap-3 mb-4">
          <span className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
            <AppIcon className="ri-alert-line text-red-600"></AppIcon>
          </span>
          <div>
            <h3 className="text-sm font-heading font-semibold text-foreground-900">What&apos;s Preventing Gateway Approval?</h3>
            <p className="text-xs text-foreground-400 mt-0.5">You are currently not Gateway ready because the following items remain incomplete.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {GATEWAY_BLOCKERS.map(blocker => (
            <div key={blocker.id} className="bg-background-100/50 rounded-lg p-3.5 border border-background-200/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-7 h-7 rounded-md bg-background-100 flex items-center justify-center">
                  <AppIcon className={`${blocker.icon} text-foreground-500 text-xs`}></AppIcon>
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                  blocker.severity === 'high' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {blocker.severity === 'high' ? 'Blocking' : 'Required'}
                </span>
              </div>
              <p className="text-sm font-semibold text-foreground-900">{blocker.item}</p>
              <p className="text-xs text-foreground-400 mt-1 leading-relaxed">{blocker.detail}</p>
            </div>
          ))}
        </div>
        {/* Countdown */}
        <div className="mt-4 flex items-center gap-3 bg-primary-50 rounded-lg p-3 border border-primary-200/50">
          <AppIcon className="ri-hourglass-line text-primary-500"></AppIcon>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-semibold text-primary-900">{GATEWAY_COUNTDOWN.monthsRemaining} Months</span>
            <span className="text-foreground-400">remaining</span>
            <span className="text-foreground-300">/</span>
            <span className="font-semibold text-primary-900">{GATEWAY_COUNTDOWN.daysRemaining} Days</span>
            <span className="text-foreground-400">to Gateway</span>
          </div>
          <span className={`ml-auto text-[9px] font-bold px-2 py-0.5 rounded-full ${
            GATEWAY_PROGRESS_STATUS.label === 'On Track' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {GATEWAY_PROGRESS_STATUS.label}
          </span>
        </div>
      </div>
    </div>
  );
}