import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { fetchCoachDirectory, type DirectoryCoach } from '@/api/coachDirectory';

const EMPTY_VALUE = '--';

function initials(name: string, email: string) {
  const source = name.trim() || email.split('@')[0].replace(/[._-]+/g, ' ');
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return `${first}${last}`.toUpperCase();
}

function matches(coach: DirectoryCoach, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${coach.name} ${coach.email}`.toLowerCase().includes(needle);
}

/**
 * The coach an administrator is opening the workspace as.
 *
 * An admin has no caseload of their own, so `/workspace/coach` shows this
 * instead of a dashboard of zeros: one card per account holding Coach access,
 * and the workspace loads that coach's data once one is chosen.
 */
export function CoachDirectoryPicker({
  onSelect,
  onDirectoryLoaded,
}: {
  onSelect: (coach: DirectoryCoach) => void;
  onDirectoryLoaded?: (coaches: DirectoryCoach[]) => void;
}) {
  const [coaches, setCoaches] = useState<DirectoryCoach[]>([]);
  const [countsAvailable, setCountsAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchCoachDirectory(controller.signal)
      .then(directory => {
        if (controller.signal.aborted) return;
        setCoaches(directory.coaches);
        onDirectoryLoaded?.(directory.coaches);
        setCountsAvailable(directory.caseloadCountsAvailable);
      })
      .catch(loadError => {
        if (controller.signal.aborted) return;
        setCoaches([]);
        setError(loadError instanceof Error ? loadError.message : 'Unable to load the coach list.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [onDirectoryLoaded]);

  const filtered = useMemo(() => coaches.filter(coach => matches(coach, search)), [coaches, search]);

  return (
    <section className="rounded-2xl border border-foreground-200/70 bg-background-50 p-4 shadow-sm md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-heading font-semibold text-foreground-900">Open a coach workspace</h2>
          <p className="mt-1 text-sm text-foreground-400">
            Pick a coach to see their dashboard, caseload and calendar exactly as they do. Opening a
            workspace is read-only.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <AppIcon className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search name or email..."
            className="w-full rounded-lg border border-background-200 bg-background-50 py-2 pl-9 pr-3 text-sm text-foreground-800 placeholder-foreground-400 focus:border-primary-400 focus:outline-none"
          />
        </div>
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map(key => (
            <div key={key} className="h-[132px] animate-pulse rounded-2xl border border-foreground-200/60 bg-background-100/60" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-800">{error}</div>
      )}

      {!loading && !error && !coaches.length && (
        <EmptyState
          variant="empty"
          icon="ri-group-line"
          title="No coach accounts yet"
          description="Grant Coach access from the Users directory and they will appear here."
        />
      )}

      {!loading && !error && coaches.length > 0 && !filtered.length && (
        <EmptyState
          variant="no-matches"
          title="No coach matches your search"
          description={`Nobody matches "${search.trim()}". Try a different name or email.`}
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map(coach => (
              <button
                key={coach.email}
                type="button"
                onClick={() => onSelect(coach)}
                className="group flex cursor-pointer flex-col gap-3 rounded-2xl border border-foreground-200/60 bg-background-50 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary-300 focus:outline-none focus-visible:border-primary-400 focus-visible:ring-2 focus-visible:ring-primary-200"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
                    {initials(coach.name, coach.email)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground-900">{coach.name || coach.email}</p>
                    <p className="truncate text-[12px] text-foreground-400">{coach.email}</p>
                  </div>
                  <AppIcon className="ri-arrow-right-line mt-1 shrink-0 text-foreground-300 transition-colors group-hover:text-primary-500" />
                </div>

                <div className="flex items-center gap-4 border-t border-foreground-200/50 pt-3 text-[12px] text-foreground-500">
                  <span className="flex items-center gap-1.5">
                    <AppIcon className="ri-group-line text-foreground-400" />
                    <strong className="font-semibold text-foreground-800">
                      {countsAvailable ? coach.caseloadCount : EMPTY_VALUE}
                    </strong>
                    caseload
                  </span>
                  <span className="flex items-center gap-1.5">
                    <AppIcon className="ri-user-follow-line text-foreground-400" />
                    <strong className="font-semibold text-foreground-800">
                      {countsAvailable ? coach.activeLearnerCount : EMPTY_VALUE}
                    </strong>
                    active
                  </span>
                </div>
              </button>
            ))}
          </div>

          {!countsAvailable && (
            <p className="mt-4 text-[12px] text-foreground-400">
              Caseload numbers are unavailable right now. The coach list itself is current.
            </p>
          )}
        </>
      )}
    </section>
  );
}
