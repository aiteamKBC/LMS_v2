import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import {
  fetchLearningPlan,
  saveLearningPlan,
  formatHours,
  type LearningPlanModule,
  type LearningPlanResponse,
} from '@/api/learningPlan';
import { Modal } from './Modal';
import { btnPrimary, btnSecondary, inputClass } from './ui';

// ============================================================================
// Learning plan — the modules a learner will actually be taught.
//
// Opens pre-filled with the module set attached to the learner's group, so the
// common case is "looks right, close it". Staff can drop a module the learner
// doesn't need, or add one taught to another group on the SAME programme —
// crossing programmes is refused server-side, since those modules map to
// different KSBs and funding.
//
// Each module carries its off-the-job hours, and the plan shows a running
// total, because that total is the commitment being agreed.
// ============================================================================

interface Props {
  learnerId: string;
  learnerName: string;
  onClose: () => void;
  /** Called after a successful save, so the list can refresh. */
  onSaved?: () => void;
}

export function LearningPlanModal({ learnerId, learnerName, onClose, onSaved }: Props) {
  const toast = useToast();
  const [data, setData] = useState<LearningPlanResponse | null>(null);
  const [plan, setPlan] = useState<LearningPlanModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchLearningPlan(learnerId);
        if (cancelled) return;
        setData(res);
        setPlan(res.plan);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the learning plan.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [learnerId]);

  const chosen = useMemo(() => new Set(plan.map((m) => m.moduleId)), [plan]);

  // Anything on the programme that isn't already on the plan. Derived from the
  // full catalogue rather than the server's `available`, so a module removed in
  // this session becomes re-addable without a round trip.
  const addable = useMemo(() => {
    if (!data) return [];
    const catalogue = [...data.available, ...data.preset, ...data.plan];
    const seen = new Set<string>();
    const unique = catalogue.filter((m) => {
      if (seen.has(m.moduleId) || chosen.has(m.moduleId) || m.orphaned) return false;
      seen.add(m.moduleId);
      return true;
    });
    const q = search.trim().toLowerCase();
    return q
      ? unique.filter((m) => `${m.moduleTitle} ${m.groupName}`.toLowerCase().includes(q))
      : unique;
  }, [data, chosen, search]);

  const totalHours = useMemo(
    () => plan.reduce((sum, m) => sum + Number(m.hours || 0), 0),
    [plan],
  );

  const dirty = useMemo(() => {
    if (!data) return false;
    const before = data.plan.map((m) => m.moduleId).join('|');
    return before !== plan.map((m) => m.moduleId).join('|');
  }, [data, plan]);

  const remove = (moduleId: string) => setPlan((rows) => rows.filter((m) => m.moduleId !== moduleId));
  const add = (module: LearningPlanModule) => {
    setPlan((rows) => [...rows, module]);
    setSearch('');
  };

  const resetToGroup = () => {
    if (data) setPlan(data.preset);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await saveLearningPlan(learnerId, plan.map((m) => m.moduleId));
      setData(res);
      setPlan(res.plan);
      toast.success(
        'Learning plan saved',
        `${res.totals.moduleCount} module${res.totals.moduleCount === 1 ? '' : 's'} · ${formatHours(res.totals.totalHours)}`,
      );
      onSaved?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save the learning plan.';
      setError(message);
      toast.error('Save failed', message);
    } finally {
      setSaving(false);
    }
  };

  const learner = data?.learner;

  return (
    <Modal
      title={
        <span className="flex items-baseline gap-2">
          <span>Learning plan</span>
          <span className="text-[12px] font-normal text-foreground-400">{learnerName}</span>
        </span>
      }
      onClose={onClose}
      size="max-w-4xl"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <span className="text-[12px] text-foreground-500">
            {plan.length} module{plan.length === 1 ? '' : 's'} ·{' '}
            <strong className="text-foreground-800">{formatHours(totalHours)}</strong> total
          </span>
          <span className="flex items-center gap-2">
            <button type="button" className={btnSecondary} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save learning plan'}
            </button>
          </span>
        </div>
      }
    >
      {loading ? (
        <p className="py-10 text-center text-[13px] text-foreground-400">Loading learning plan…</p>
      ) : error && !data ? (
        <p className="py-10 text-center text-[13px] text-red-600">{error}</p>
      ) : (
        <div className="space-y-5">
          {/* Context: which programme/group this plan came from. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-foreground-500">
            <span>
              Programme: <strong className="text-foreground-800">{learner?.programme || '—'}</strong>
            </span>
            <span>
              Group: <strong className="text-foreground-800">{learner?.group || '—'}</strong>
            </span>
            {!data?.saved && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                Pre-filled from group — not saved yet
              </span>
            )}
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}

          {/* The plan itself. */}
          <div className="rounded-xl border border-foreground-200/60 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-background-100/60 text-left">
                  <th className="py-2 px-3 font-semibold text-foreground-600">Module</th>
                  <th className="py-2 px-3 font-semibold text-foreground-600">Group</th>
                  <th className="py-2 px-3 font-semibold text-foreground-600 text-right">Hours</th>
                  <th className="py-2 px-3 w-10" />
                </tr>
              </thead>
              <tbody>
                {plan.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-foreground-400">
                      No modules on this plan yet — add one below.
                    </td>
                  </tr>
                )}
                {plan.map((m) => (
                  <tr key={m.moduleId} className="border-t border-foreground-200/50">
                    <td className="py-2 px-3 text-foreground-900">
                      {m.moduleTitle}
                      {m.orphaned && (
                        <span
                          className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                          title="Saved on this plan but no longer in the programme catalogue"
                        >
                          Not in catalogue
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-foreground-500">{m.groupName || '—'}</td>
                    <td className="py-2 px-3 text-right font-medium text-foreground-700">
                      {formatHours(m.hours)}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => remove(m.moduleId)}
                        title={`Remove ${m.moduleTitle}`}
                        className="text-foreground-400 hover:text-red-600 cursor-pointer"
                      >
                        <i className="ri-close-line" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-foreground-300/50 bg-background-100/40">
                  <td className="py-2 px-3 font-semibold text-foreground-700" colSpan={2}>
                    Total
                  </td>
                  <td className="py-2 px-3 text-right font-bold text-foreground-900">
                    {formatHours(totalHours)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Add a module from another group on the same programme. */}
          <div>
            <div className="flex items-center justify-between gap-3 mb-2">
              <button
                type="button"
                onClick={() => setPicker((v) => !v)}
                className="text-[12px] font-semibold text-primary-600 hover:underline cursor-pointer"
              >
                <i className={`ri-${picker ? 'subtract' : 'add'}-line mr-1`} />
                Add a module from this programme
              </button>
              {data && data.preset.length > 0 && (
                <button
                  type="button"
                  onClick={resetToGroup}
                  className="text-[12px] text-foreground-500 hover:text-foreground-800 hover:underline cursor-pointer"
                >
                  Reset to group default
                </button>
              )}
            </div>

            {picker && (
              <div className="rounded-xl border border-foreground-200/60 p-3 space-y-2">
                <input
                  className={inputClass}
                  placeholder="Search modules on this programme…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="max-h-56 overflow-y-auto divide-y divide-foreground-200/40">
                  {addable.length === 0 && (
                    <p className="py-4 text-center text-[12px] text-foreground-400">
                      No other modules available on {learner?.programme || 'this programme'}.
                    </p>
                  )}
                  {addable.map((m) => (
                    <div key={m.moduleId} className="flex items-center gap-3 py-2">
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-[13px] text-foreground-900">{m.moduleTitle}</span>
                        <span className="block text-[11px] text-foreground-400">
                          {m.groupName || 'No group'} · {formatHours(m.hours)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => add(m)}
                        className="rounded-lg border border-foreground-200 px-2.5 py-1 text-[11px] font-semibold text-foreground-600 hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer whitespace-nowrap"
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
