import { useEffect, useMemo, useState } from 'react';
import { fetchEnrolmentUsers } from '@/api/enrolmentUsers';

// The minimal, real fields a staff member needs to pick a learner and act on
// their behalf (award recognition, preview a flash-card deck). Deliberately
// smaller than the full learner directory row — this picker's only job is
// "which real learner", not learner analytics.
export interface PickedLearner {
  id: string;
  name: string;
  email: string;
  cohort: string;
  programme: string;
}

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
  onSelect: (learner: PickedLearner) => void;
  selectedId?: string;
  statuses?: Record<string, PickerLearnerStatus>;
}

/**
 * Full-screen learner search overlay — replaces a flat alphabetical <select>
 * (unusable once the roster grows past a handful of names) with search + a
 * scannable card list. Opens on top of a parent modal.
 *
 * Backed by the real enrolment learner directory (`fetchEnrolmentUsers`), not
 * a mock roster — the id it hands back is the same integer id a learner's own
 * session resolves to (`account.subjectId`), which is what makes a staff
 * grant/award land in that learner's own points balance.
 */
export function LearnerPickerModal({ open, onClose, onSelect, selectedId, statuses }: LearnerPickerModalProps) {
  const [search, setSearch] = useState('');
  const [learners, setLearners] = useState<PickedLearner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchEnrolmentUsers()
      .then(rows => {
        if (cancelled) return;
        setLearners(
          rows.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            cohort: row.cohort || '',
            programme: row.programme || '',
          })),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load learners.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const sortedLearners = useMemo(() => [...learners].sort((a, b) => a.name.localeCompare(b.name)), [learners]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedLearners;
    return sortedLearners.filter(l =>
      l.name.toLowerCase().includes(q) || l.cohort.toLowerCase().includes(q) ||
      l.email.toLowerCase().includes(q) || l.programme.toLowerCase().includes(q),
    );
  }, [search, sortedLearners]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-foreground-950/60 backdrop-blur-sm"></div>
      <div className="relative bg-background-50 rounded-2xl border border-foreground-200/60 max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-foreground-400/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-primary-100 text-primary-600 flex items-center justify-center"><AppIcon className="ri-user-search-line text-lg"></AppIcon></span>
            <div>
              <h3 className="text-base font-heading font-semibold text-foreground-900">Select a Learner</h3>
              <p className="text-[11px] text-foreground-400">{filtered.length} of {sortedLearners.length} learners</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-background-100 text-foreground-400 hover:text-foreground-600 flex items-center justify-center transition-smooth cursor-pointer"><AppIcon className="ri-close-line text-lg"></AppIcon></button>
        </div>

        <div className="p-4 border-b border-foreground-200/60 shrink-0">
          <div className="relative">
            <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm"></AppIcon>
            <input
              type="text"
              autoFocus
              placeholder="Search by name, cohort, programme, or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-background-50 border border-foreground-200/60 rounded-lg text-[12px] text-foreground-700 focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
        </div>

        <div className="overflow-y-auto p-3 space-y-1.5 flex-1">
          {loading && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-10">
              <AppIcon className="ri-loader-4-line text-2xl text-foreground-300 animate-spin"></AppIcon>
              <p className="text-[11px] text-foreground-400">Loading learners…</p>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-10">
              <AppIcon className="ri-wifi-off-line text-2xl text-foreground-300"></AppIcon>
              <p className="text-sm font-semibold text-foreground-700">Could not load learners</p>
              <p className="text-[11px] text-foreground-400">{error}</p>
            </div>
          )}

          {!loading && !error && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-10">
              <AppIcon className="ri-user-search-line text-2xl text-foreground-300"></AppIcon>
              <p className="text-sm font-semibold text-foreground-700">No learners match</p>
              <p className="text-[11px] text-foreground-400">Try a different name, cohort, or programme.</p>
            </div>
          )}

          {!loading && !error && filtered.map(l => {
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
                <div className="w-9 h-9 rounded-full shrink-0 overflow-hidden bg-primary-100 flex items-center justify-center text-[11px] font-bold text-primary-600">
                  {l.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-foreground-900 truncate">{l.name}</p>
                  <p className="text-[10px] text-foreground-400 truncate">{l.cohort || l.programme || l.email}</p>
                </div>
                {statuses && (
                  status?.done ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><AppIcon className="ri-check-double-line"></AppIcon>Done today</span>
                  ) : status && status.usedToday > 0 ? (
                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{status.usedToday}/{status.usedToday + status.remainingToday} today</span>
                  ) : (
                    <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-foreground-100 text-foreground-400">Not started</span>
                  )
                )}
                {active && <AppIcon className="ri-check-line text-primary-500 shrink-0"></AppIcon>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
