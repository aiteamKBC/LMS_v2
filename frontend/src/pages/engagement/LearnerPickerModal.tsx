import { useMemo, useState } from 'react';
import { ProgrammeFilter } from '@/components/feature/ProgrammeFilter';
import { ENGAGEMENT_LEARNERS, filterByProgramme, countByProgramme, type EngagementLearner, type ProgrammeFilterValue } from '@/mocks/engagement-data';

// Optional per-learner daily status, keyed by learner id. When provided, each
// row shows a "flash cards opened today?" chip. Kept structural (not tied to
// the api type) so this picker stays reusable across pages that don't need it.
interface PickerLearnerStatus {
  usedToday: number;
  remainingToday: number;
  done: boolean;
}

interface LearnerPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (learner: EngagementLearner) => void;
  selectedId?: string;
  statuses?: Record<string, PickerLearnerStatus>;
}

const sortedLearners = [...ENGAGEMENT_LEARNERS].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Full-screen learner search overlay — replaces a flat alphabetical <select>
 * (unusable once the roster grows past a handful of names) with search +
 * programme filter + a scannable card list. Opens on top of a parent modal.
 */
export function LearnerPickerModal({ open, onClose, onSelect, selectedId, statuses }: LearnerPickerModalProps) {
  const [search, setSearch] = useState('');
  const [programmeFilter, setProgrammeFilter] = useState<ProgrammeFilterValue>('all');

  const counts = countByProgramme(sortedLearners);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return filterByProgramme(sortedLearners, programmeFilter).filter(l => {
      if (!q) return true;
      return l.name.toLowerCase().includes(q) || l.cohort.toLowerCase().includes(q) || l.email.toLowerCase().includes(q);
    });
  }, [search, programmeFilter]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-foreground-950/60 backdrop-blur-sm"></div>
      <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><i className="ri-user-search-line text-lg"></i></span>
            <div>
              <h3 className="text-base font-heading font-semibold text-foreground-900">Select a Learner</h3>
              <p className="text-[11px] text-foreground-400">{filtered.length} of {sortedLearners.length} learners</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><i className="ri-close-line text-lg"></i></button>
        </div>

        <div className="p-4 border-b border-foreground-200/60 space-y-3 shrink-0">
          <div className="relative">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></i>
            <input
              type="text"
              autoFocus
              placeholder="Search by name, cohort, or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <ProgrammeFilter value={programmeFilter} onChange={setProgrammeFilter} counts={counts} />
        </div>

        <div className="overflow-y-auto p-3 space-y-1.5 flex-1">
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-10">
              <i className="ri-user-search-line text-2xl text-foreground-300"></i>
              <p className="text-sm font-semibold text-foreground-700">No learners match</p>
              <p className="text-[11px] text-foreground-400">Try a different name, cohort, or programme filter.</p>
            </div>
          )}
          {filtered.map(l => {
            const active = l.id === selectedId;
            const status = statuses?.[l.id];
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => { onSelect(l); onClose(); }}
                className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-smooth cursor-pointer ${
                  active ? 'border-primary-400 bg-primary-50' : 'border-transparent hover:bg-background-100 hover:border-foreground-200/60'
                }`}
              >
                <div className="w-9 h-9 rounded-full shrink-0 overflow-hidden bg-primary-100">
                  {l.avatarImg ? (
                    <img src={l.avatarImg} alt={l.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] font-bold text-primary-600">{l.name.charAt(0)}</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-foreground-900 truncate">{l.name}</p>
                  <p className="text-[10px] text-foreground-400 truncate">{l.cohort}</p>
                </div>
                {statuses && (
                  status?.done ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><i className="ri-check-double-line"></i>Done today</span>
                  ) : status && status.usedToday > 0 ? (
                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{status.usedToday}/{status.usedToday + status.remainingToday} today</span>
                  ) : (
                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-foreground-100 text-foreground-400">Not started</span>
                  )
                )}
                <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary-50 text-secondary-700">{l.programmeCode}</span>
                {active && <i className="ri-check-line text-primary-500 shrink-0"></i>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
