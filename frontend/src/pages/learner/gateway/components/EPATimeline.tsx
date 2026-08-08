import { useState } from 'react';
import { EPA_JOURNEY_STAGES, CURRENT_POSITION } from '@/mocks/gateway-readiness';

export function EPATimeline() {
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);

  return (
    <section className="bg-background-50 rounded-xl border border-background-200/50 p-5 card-premium">
      <div className="flex items-start gap-3 mb-5">
        <span className="w-9 h-9 rounded-lg bg-accent-100 flex items-center justify-center shrink-0">
          <AppIcon className="ri-route-line text-accent-700"></AppIcon>
        </span>
        <div>
          <h3 className="text-sm font-heading font-semibold text-foreground-900">EPA Readiness Timeline</h3>
          <p className="text-xs text-foreground-400 mt-0.5">Your journey from apprenticeship start to EPA certification</p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground-700">Current Position:</span>
          <span className="text-xs font-bold text-primary-700 bg-primary-100 px-2 py-0.5 rounded-full">Week {CURRENT_POSITION.week}</span>
        </div>
        <span className="text-xs font-semibold text-foreground-700 bg-background-100 px-2 py-0.5 rounded-full">
          Stage: {CURRENT_POSITION.stage}
        </span>
      </div>

      <div className="relative">
        <div className="flex items-center justify-between gap-1">
          {EPA_JOURNEY_STAGES.map((stage, index) => {
            const isCurrent = stage.current;
            const isCompleted = stage.completed;
            const isHovered = hoveredStage === stage.id;
            const isGateway = stage.id === 's4';
            const isEPA = stage.id === 's5';

            return (
              <div
                key={stage.id}
                className="flex flex-col items-center flex-1 relative"
                onMouseEnter={() => setHoveredStage(stage.id)}
                onMouseLeave={() => setHoveredStage(null)}
              >
                {/* Connector line */}
                {index < EPA_JOURNEY_STAGES.length - 1 && (
                  <div className={`absolute top-3 left-[calc(50%+12px)] right-[calc(-50%+12px)] h-0.5 z-0 ${
                    isCompleted ? 'bg-emerald-400' : 'bg-background-200'
                  }`}>
                    {/* Mock meeting dots between Gateway and EPA */}
                    {isGateway && (
                      <div className="absolute inset-0 flex items-center justify-around px-3">
                        <span className="w-1.5 h-1.5 rounded-full bg-secondary-400 opacity-60" title="Mock Meeting 1"></span>
                        <span className="w-1.5 h-1.5 rounded-full bg-secondary-400 opacity-40" title="Mock Meeting 2"></span>
                        <span className="w-1.5 h-1.5 rounded-full bg-secondary-400 opacity-20" title="Mock Meeting 3"></span>
                      </div>
                    )}
                  </div>
                )}
                {/* Stage dot */}
                <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isCompleted ? 'bg-emerald-500 text-white' :
                  isCurrent ? 'bg-primary-500 text-white ring-4 ring-primary-100 animate-pulse-slow' :
                  'bg-background-200 text-foreground-400'
                } ${isHovered ? 'scale-125' : ''}`}>
                  {isCompleted ? (
                    <AppIcon className="ri-check-line text-xs"></AppIcon>
                  ) : isCurrent ? (
                    <AppIcon className="ri-map-pin-line text-xs"></AppIcon>
                  ) : (
                    <span className="text-[9px] font-bold">{index + 1}</span>
                  )}
                </div>
                {/* Label */}
                <span className={`text-[9px] font-semibold mt-2 text-center leading-tight transition-colors ${
                  isCompleted ? 'text-emerald-600' :
                  isCurrent ? 'text-primary-700' :
                  'text-foreground-400'
                }`}>
                  {stage.label}
                </span>
                {/* Hover tooltip */}
                {isHovered && (
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-20 bg-foreground-900 text-white text-[9px] font-semibold px-2 py-1 rounded-md whitespace-nowrap animate-in fade-in duration-200">
                    {isCompleted ? 'Completed' : isCurrent ? 'Current Stage' : 'Upcoming'}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-foreground-900"></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}