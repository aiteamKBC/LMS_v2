import { ENGAGEMENT_PROGRAMMES, type ProgrammeCode, type ProgrammeFilterValue } from '@/mocks/engagement-data';

interface ProgrammeFilterProps {
  value: ProgrammeFilterValue;
  onChange: (value: ProgrammeFilterValue) => void;
  /** Optional per-programme match counts, keyed by 'all' + each code. */
  counts?: Partial<Record<ProgrammeFilterValue, number>>;
  className?: string;
}

/**
 * Segmented pill-row filter for the four engagement programmes. Pills show the
 * short code (PCP/APM/MM/ME); the full programme name is exposed as a tooltip.
 * Matches the pill styling used across the engagement pages.
 */
export function ProgrammeFilter({ value, onChange, counts, className }: ProgrammeFilterProps) {
  const options: { key: ProgrammeFilterValue; label: string; title: string }[] = [
    { key: 'all', label: 'All Programmes', title: 'All programmes' },
    ...ENGAGEMENT_PROGRAMMES.map(p => ({ key: p.code as ProgrammeCode, label: p.code, title: `${p.name} (${p.level})` })),
  ];

  return (
    <div className={`flex items-center gap-1 bg-background-100 rounded-xl p-1 overflow-x-auto ${className ?? ''}`}>
      {options.map(opt => {
        const active = value === opt.key;
        const count = counts?.[opt.key];
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            title={opt.title}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-smooth whitespace-nowrap cursor-pointer ${
              active ? 'bg-[#541EA0] text-white shadow-sm' : 'text-foreground-500 hover:text-foreground-700'
            }`}
          >
            {opt.key === 'all' && <AppIcon className="ri-apps-line text-sm"></AppIcon>}
            {opt.label}
            {count != null && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full leading-none ${active ? 'bg-white/20 text-white' : 'bg-background-200/70 text-foreground-500'}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
