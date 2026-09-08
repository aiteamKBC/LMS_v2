import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { fetchComponentLibrary, fetchComponentLibraryDetail, type LibraryComponent, type LibraryComponentOrigin } from '@/lib/curriculumApi';
import { componentTypes } from './componentAuthoringModel';
import { formatHoursMinutes } from '@/lib/format';

/**
 * Pick components from anywhere in the curriculum and copy them into a week.
 *
 * Scope is deliberately everything: components in live modules, components in
 * archived ones, and detached library items whose module no longer exists - all
 * programmes, not just the current one. Reuse across programmes is the point.
 *
 * Selection is copied, never linked. The caller regenerates every id, so an
 * edit here can never reach back into the module a component came from.
 */

const ORIGIN_FILTERS: Array<{ value: LibraryComponentOrigin; label: string; hint: string }> = [
  { value: 'active', label: 'Active', hint: 'In a live module' },
  { value: 'archived', label: 'Archived', hint: 'In an archived module' },
  { value: 'library', label: 'Library', hint: 'Module deleted; kept for reuse' },
];

const ORIGIN_BADGE: Record<LibraryComponentOrigin, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-amber-50 text-amber-700 border-amber-200',
  library: 'bg-sky-50 text-sky-700 border-sky-200',
};

const SEARCH_DEBOUNCE_MS = 250;

export function ComponentLibraryModal({ weekLabel, onClose, onAddMany }: {
  weekLabel: string;
  onClose: () => void;
  onAddMany: (components: LibraryComponent[]) => void;
}) {
  const [rows, setRows] = useState<LibraryComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [origins, setOrigins] = useState<LibraryComponentOrigin[]>(['active', 'archived', 'library']);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  // Selections must survive a filter change, so the chosen rows are remembered
  // by id *and* by value - a row filtered out of view is still being added.
  const selectedRows = useRef<Map<string, LibraryComponent>>(new Map());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchComponentLibrary({
      search: debouncedSearch,
      types: typeFilter === 'all' ? [] : [typeFilter],
      origins,
      pageSize: 200,
    }, controller.signal)
      .then(results => {
        setRows(results);
        setLoading(false);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Unable to load the component library.');
        setLoading(false);
      });
    return () => controller.abort();
  }, [debouncedSearch, typeFilter, origins]);

  const toggleOrigin = useCallback((value: LibraryComponentOrigin) => {
    setOrigins(current => {
      const next = current.includes(value) ? current.filter(item => item !== value) : [...current, value];
      // Clearing every filter would show nothing at all, which reads as a bug.
      return next.length ? next : current;
    });
  }, []);

  const toggleSelected = useCallback((row: LibraryComponent) => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(row.id)) {
        next.delete(row.id);
        selectedRows.current.delete(row.id);
      } else {
        next.add(row.id);
        selectedRows.current.set(row.id, row);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    selectedRows.current.clear();
    setSelectedIds(new Set());
  }, []);

  const typeOptions = useMemo(
    () => [...componentTypes].sort((a, b) => a.label.localeCompare(b.label)),
    [],
  );

  // The list rows carry no `settings` or `ksbMappings` — those are fetched here,
  // for the chosen ids only, because a copy needs every field but a page of
  // search results does not.
  const add = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    setAdding(true);
    setError('');
    try {
      const detailed = await fetchComponentLibraryDetail(ids);
      const byId = new Map(detailed.map(row => [row.id, row]));
      // Fall back to the list row if detail is missing one, so a partial
      // response still adds something rather than silently dropping it.
      const picked = ids
        .map(id => byId.get(id) || selectedRows.current.get(id))
        .filter((row): row is LibraryComponent => Boolean(row));
      if (picked.length) onAddMany(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load those components.');
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-background-50 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-4 bg-primary-950 px-5 py-4 text-white">
          <div className="min-w-0">
            <h3 className="font-heading text-sm font-bold text-white">Reuse existing components</h3>
            <p className="mt-0.5 truncate text-[11px] text-white/70">Copies into {weekLabel}. The originals are never changed.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/10 hover:bg-white/20">
            <AppIcon className="ri-close-line"></AppIcon>
          </button>
        </div>

        <div className="space-y-3 border-b border-background-200 px-5 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <AppIcon className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-foreground-400"></AppIcon>
              <input
                type="text"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search by title or description"
                className="h-8 w-full rounded-md border border-foreground-200/60 bg-background-50 pl-7 pr-2 text-[11px] font-semibold text-foreground-900 outline-none focus:border-primary-300"
              />
            </div>
            <select
              value={typeFilter}
              onChange={event => setTypeFilter(event.target.value)}
              className="h-8 rounded-md border border-foreground-200/60 bg-background-50 px-2 text-[11px] font-semibold text-foreground-900 outline-none focus:border-primary-300 sm:w-[180px]"
            >
              <option value="all">All activity types</option>
              {typeOptions.map(option => (
                <option key={option.type} value={option.type}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {ORIGIN_FILTERS.map(filter => {
              const on = origins.includes(filter.value);
              return (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={on}
                  title={filter.hint}
                  onClick={() => toggleOrigin(filter.value)}
                  className={`rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-smooth ${on ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-background-200 bg-background-100 text-foreground-400'}`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-foreground-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-background-300 border-t-primary-500" />
              Searching the library…
            </div>
          ) : rows.length ? (
            <div className="space-y-2">
              {rows.map(row => {
                const selected = selectedIds.has(row.id);
                const provenance = [row.originModuleTitle, row.originWeekLabel].filter(Boolean).join(' · ');
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => toggleSelected(row)}
                    className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-smooth ${selected ? 'border-primary-400 bg-primary-50' : 'border-background-200 bg-background-50 hover:border-primary-300'}`}
                  >
                    <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border ${selected ? 'border-primary-500 bg-primary-500 text-white' : 'border-background-300 bg-background-50'}`}>
                      {selected && <AppIcon className="ri-check-line text-[11px]"></AppIcon>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[13px] font-bold text-foreground-900">{row.title || 'Untitled component'}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${ORIGIN_BADGE[row.origin]}`}>{row.origin}</span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-foreground-500">
                        {row.type}
                        {row.programme ? ` · ${row.programme}` : ''}
                        {typeof row.expectedOtjh === 'number' ? ` · ${formatHoursMinutes(row.expectedOtjh)} OTJH` : ''}
                        {row.ksbRefs?.length ? ` · ${row.ksbRefs.length} KSBs` : ''}
                      </span>
                      {provenance && (
                        <span className="mt-0.5 block truncate text-[10px] text-foreground-400">from {provenance}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-12 text-center text-[12px] text-foreground-400">
              No components match those filters.
            </p>
          )}
          {error && <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-background-200 bg-background-100 px-5 py-3">
          <button
            type="button"
            onClick={clearSelection}
            disabled={!selectedIds.size}
            className="text-[11px] font-semibold text-foreground-500 hover:text-foreground-800 disabled:opacity-40"
          >
            Clear selection
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-background-300 bg-background-50 px-3 py-1.5 text-[12px] font-semibold text-foreground-700 hover:bg-background-200">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void add()}
              disabled={!selectedIds.size || adding}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-primary-700 disabled:opacity-40"
            >
              {adding
                ? 'Copying…'
                : selectedIds.size
                  ? `Add ${selectedIds.size} component${selectedIds.size === 1 ? '' : 's'}`
                  : 'Add components'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ComponentLibraryModal;
