import { useEffect, useId, useState } from 'react';
import type { ClassifiedLearner } from '@/api/adminEvidence';

export function LearnerNameInput({ value, learners, loading, error, onChange, onSelect }: {
  value: string;
  learners: ClassifiedLearner[];
  loading: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const expanded = open && value.trim().length > 0;
  const matches = loading || error ? [] : learners.filter(learner =>
    learner.fullName.toLowerCase().includes(value.trim().toLowerCase()),
  ).slice(0, 10);
  const activeId = expanded && matches[active] ? `${id}-option-${matches[active].learnerId}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const select = (name: string) => {
    onSelect(name);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative space-y-1 text-xs font-medium text-foreground-600">
      <label htmlFor={id}>Learner</label>
      <input id={id} role="combobox" autoComplete="off" aria-autocomplete="list"
        aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined}
        aria-activedescendant={activeId} value={value}
        onFocus={() => { setOpen(true); setActive(-1); }}
        onBlur={() => setOpen(false)}
        onChange={event => { onChange(event.target.value); setOpen(true); setActive(-1); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); setActive(-1); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            if (matches.length) setActive(previous => event.key === 'ArrowDown'
              ? (previous + 1) % matches.length
              : (previous <= 0 ? matches.length - 1 : previous - 1));
          }
          if (event.key === 'Enter' && expanded && matches[active]) {
            event.preventDefault();
            select(matches[active].fullName);
          }
        }}
        placeholder="Search learner name"
        className="w-full rounded-xl border border-foreground-200/60 bg-background-50 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary-200" />
      {expanded && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-background-200 bg-background-50 shadow-lg">
          <div id={`${id}-list`} role="listbox" aria-label="Suggested learners" aria-busy={loading} className="max-h-64 overflow-y-auto p-1">
            {matches.map((learner, index) => (
              <button key={learner.learnerId} id={`${id}-option-${learner.learnerId}`} type="button" role="option"
                tabIndex={-1} aria-selected={active === index}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActive(index)} onClick={() => select(learner.fullName)}
                className={`block w-full rounded-lg px-3 py-2 text-left ${active === index ? 'bg-primary-50 text-primary-800' : 'text-foreground-800 hover:bg-background-100'}`}>
                <span className="block text-[13px] font-semibold">{learner.fullName}</span>
                <span className="block truncate text-[11px] font-normal text-foreground-400">{learner.programme}</span>
              </button>
            ))}
          </div>
          {!matches.length && <p role="status" className="px-3 py-2 text-xs text-foreground-500">
            {loading ? 'Searching learners...' : error ? 'Could not load suggestions.' : 'No matching learners.'}
          </p>}
        </div>
      )}
    </div>
  );
}
