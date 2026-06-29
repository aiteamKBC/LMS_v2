import { useState } from 'react';
import { JourneyStage } from '../data';

interface StageCardProps {
  stage: JourneyStage;
  isLast: boolean;
  isVisible: boolean;
}

const colorStyles = {
  accent: {
    dot: 'bg-accent-500 text-foreground-950',
    dotShadow: 'shadow-accent-500/25',
    bar: 'bg-accent-500',
    stageBadge: 'bg-accent-50 text-accent-600 border-accent-200/40',
    durationBadge: 'bg-accent-50 text-accent-700 border-accent-200/40',
    detailIcon: 'bg-accent-50 border-accent-200/40 text-accent-600',
    expandText: 'text-accent-600 hover:text-accent-700',
    watermark: 'text-accent-100/40',
  },
  primary: {
    dot: 'bg-primary-500 text-white',
    dotShadow: 'shadow-primary-500/25',
    bar: 'bg-primary-500',
    stageBadge: 'bg-primary-50 text-primary-600 border-primary-200/40',
    durationBadge: 'bg-primary-50 text-primary-700 border-primary-200/40',
    detailIcon: 'bg-primary-50 border-primary-200/40 text-primary-600',
    expandText: 'text-primary-600 hover:text-primary-700',
    watermark: 'text-primary-100/40',
  },
  secondary: {
    dot: 'bg-secondary-500 text-white',
    dotShadow: 'shadow-secondary-500/25',
    bar: 'bg-secondary-500',
    stageBadge: 'bg-secondary-50 text-secondary-600 border-secondary-200/40',
    durationBadge: 'bg-secondary-50 text-secondary-700 border-secondary-200/40',
    detailIcon: 'bg-secondary-50 border-secondary-200/40 text-secondary-600',
    expandText: 'text-secondary-600 hover:text-secondary-700',
    watermark: 'text-secondary-100/40',
  },
};

export default function StageCard({ stage, isLast, isVisible }: StageCardProps) {
  const [expanded, setExpanded] = useState(false);
  const c = colorStyles[stage.color];

  return (
    <div
      className={`flex gap-4 md:gap-8 transition-all duration-700 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
      }`}
    >
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div
          className={`w-12 h-12 md:w-14 md:h-14 rounded-2xl flex items-center justify-center shadow-lg ${c.dot} ${c.dotShadow}`}
        >
          <i className={`${stage.icon} text-xl`} />
        </div>
        {!isLast && (
          <div className="w-px flex-1 bg-background-200 mt-3 min-h-[40px]" />
        )}
      </div>

      {/* Card */}
      <div className="flex-1 min-w-0 bg-background-50 rounded-2xl border border-foreground-200 overflow-hidden transition-all duration-500 hover:shadow-lg hover:shadow-foreground-950/5 hover:-translate-y-0.5 group">
        {/* Top colored bar */}
        <div className={`h-1 ${c.bar}`} />

        <div className="relative p-6 md:p-8">
          {/* Watermark number */}
          <div
            className={`absolute top-3 right-4 md:right-6 text-[56px] md:text-[80px] font-heading font-bold leading-none select-none ${c.watermark}`}
          >
            {stage.number}
          </div>

          {/* Header */}
          <div className="relative z-10 flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <span
                className={`inline-block text-[12px] font-semibold px-3 py-1 rounded-full border ${c.stageBadge}`}
              >
                Stage
                {' '}
                {stage.number}
              </span>
              <h3 className="text-[22px] md:text-[28px] font-heading font-semibold text-foreground-900 mt-3 leading-tight">
                {stage.title}
              </h3>
              <p className="text-[13px] text-foreground-400 mt-1">
                {stage.subtitle}
              </p>
            </div>
            <span
              className={`inline-block text-[12px] font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap ${c.durationBadge}`}
            >
              {stage.duration}
            </span>
          </div>

          {/* Summary */}
          <p className="relative z-10 text-[14px] md:text-[15px] text-foreground-500 leading-relaxed mb-5">
            {stage.summary}
          </p>

          {/* Key Activities */}
          <div className="relative z-10 flex flex-wrap gap-2 mb-5">
            {stage.keyActivities.map((activity) => (
              <span
                key={activity}
                className="text-[11px] font-medium px-3 py-1.5 rounded-lg bg-background-100 text-foreground-500 border border-foreground-200"
              >
                {activity}
              </span>
            ))}
          </div>

          {/* Expand Button */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={`relative z-10 text-[13px] font-medium flex items-center gap-2 transition-colors ${c.expandText}`}
          >
            <i className={`ri-${expanded ? 'arrow-up-s' : 'arrow-down-s'}-line text-[16px]`} />
            {expanded ? 'Hide details' : `View all ${stage.details.length} steps`}
          </button>

          {/* Expanded Details */}
          <div
            className={`relative z-10 grid transition-all duration-700 ease-in-out ${
              expanded
                ? 'grid-rows-[1fr] opacity-100 mt-5 pt-5 border-t border-foreground-200'
                : 'grid-rows-[0fr] opacity-0 mt-0 pt-0 border-t-0'
            }`}
          >
            <div className="overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {stage.details.map((detail) => (
                  <div
                    key={detail.label}
                    className="flex items-start gap-3 p-3 rounded-xl bg-background-100 border border-background-200/40"
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${c.detailIcon}`}
                    >
                      <i className={`${detail.icon} text-[14px]`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground-900">
                        {detail.label}
                      </p>
                      <p className="text-[12px] text-foreground-400 mt-0.5 leading-relaxed">
                        {detail.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}