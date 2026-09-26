import { useEffect, useMemo, useRef, useState } from 'react';
import {
  assignCurriculumLearners, fetchLearnerAssignments, unassignCurriculumLearners,
  type AssignmentLearner, type LearnerAssignmentDirectory,
  type LearnerAssignmentResult, type LearnerAssignmentTarget,
} from '@/api/curriculumLearnerAssignments';
import { AppIcon } from '@/components/feature/AppIcon';
import { EntityDrawer } from './ui';

const inputClass = 'w-full rounded-lg border border-foreground-200 bg-background-50 px-3 py-2 text-[12px] text-foreground-900 focus:border-primary-500';

/** What the caller needs to repaint its own count without refetching the list. */
export interface LearnerAssignmentOutcome extends LearnerAssignmentResult {
  learnerCount: number;
}

export function LearnerAssignmentDrawer({ target, onClose, onAssigned }: {
  target: LearnerAssignmentTarget | null;
  onClose: () => void;
  onAssigned: (result: LearnerAssignmentOutcome) => void;
}) {
  // Remount on scope changes so no learner selection can leak to another target.
  return target ? <AssignmentForm key={`${target.scope}:${target.id}`} target={target} onClose={onClose} onAssigned={onAssigned} /> : null;
}

function AssignmentForm({ target, onClose, onAssigned }: {
  target: LearnerAssignmentTarget;
  onClose: () => void;
  onAssigned: (result: LearnerAssignmentOutcome) => void;
}) {
  const [data, setData] = useState<LearnerAssignmentDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [query, setQuery] = useState('');
  const [programme, setProgramme] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('');
  const [assignment, setAssignment] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [toRemove, setToRemove] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchLearnerAssignments(target, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Unable to load learners.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [target, retry]);

  const options = useMemo(() => {
    const values = (key: 'programme' | 'company' | 'programmeStatus') =>
      [...new Set((data?.learners || []).map(learner => learner[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { programmes: values('programme'), companies: values('company'), statuses: values('programmeStatus') };
  }, [data]);
  const visible = useMemo(() => (data?.learners || []).filter(learner => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const name = `${learner.name} ${learner.email}`.toLocaleLowerCase();
    return terms.every(term => name.includes(term))
      && (!programme || learner.programme === programme)
      && (!company || learner.company === company)
      && (!status || learner.programmeStatus === status)
      && (!assignment || learner.assigned === (assignment === 'assigned'));
  }).sort((left, right) => Number(right.assigned) - Number(left.assigned)), [data, query, programme, company, status, assignment]);
  const selectable = visible.filter(learner => !learner.assigned);
  const allSelected = selectable.length > 0 && selectable.every(learner => selected.has(learner.id));
  const visibleSelected = visible.filter(learner => selected.has(learner.id)).length;

  const toggleAll = () => setSelected(previous => {
    const next = new Set(previous);
    selectable.forEach(learner => { if (allSelected) next.delete(learner.id); else next.add(learner.id); });
    return next;
  });
  const canUnassign = target.scope === 'module';
  const toggle = (learner: AssignmentLearner) => {
    if (learner.assigned) {
      if (!canUnassign) return;
      setToRemove(previous => {
        const next = new Set(previous);
        if (next.has(learner.id)) next.delete(learner.id); else next.add(learner.id);
        return next;
      });
      return;
    }
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(learner.id)) next.delete(learner.id); else next.add(learner.id);
      return next;
    });
  };
  const submit = async () => {
    if (!data || loading || (!selected.size && !toRemove.size) || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      let result: LearnerAssignmentResult | null = null;
      let added = 0;
      let removed = 0;
      if (selected.size) {
        result = await assignCurriculumLearners(target, [...selected]);
        added = result.changedCount;
      }
      if (toRemove.size) {
        result = await unassignCurriculumLearners(target, [...toRemove]);
        removed = result.changedCount;
      }
      if (result) {
        // changedCount is only the learners the server actually moved, so this
        // lands on the same figure a list reload would show -- without waiting
        // for one, which is the slow read that leaves the badge stale.
        const assignedBefore = data.learners.filter(learner => learner.assigned).length;
        onAssigned({ ...result, learnerCount: Math.max(0, assignedBefore + added - removed) });
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update learner assignments. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const reset = () => { setQuery(''); setProgramme(''); setCompany(''); setStatus(''); setAssignment(''); };

  return (
    <EntityDrawer open title={`Assign learners to ${target.scope}`} subtitle={target.name}
      width="w-[820px]" onClose={onClose} onSubmit={submit}
      saving={saving} error={error} submitDisabled={loading || !data || (!selected.size && !toRemove.size)}
      submitLabel={saving ? 'Saving…' : [
        selected.size ? `Assign ${selected.size} learner${selected.size === 1 ? '' : 's'}` : '',
        toRemove.size ? `Remove ${toRemove.size} learner${toRemove.size === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' · ') || 'Save changes'}>
      <div role="note" className="rounded-xl border border-primary-200 bg-primary-50 p-3 text-[12px] leading-5 text-primary-900">
        {target.scope === 'cohort'
          ? `Selected learners will join this cohort and receive all ${data ? data.target.moduleCount : ''} modules in it.`
          : 'Selected learners will receive this module only. Their programme, cohort and other module assignments stay as they are. Uncheck an already-assigned learner to remove them from this module.'}
      </div>
      <fieldset disabled={loading || saving} className="space-y-3">
        <label className="block text-[11px] font-bold text-foreground-600">
          Search by name or email
          <input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} className={`${inputClass} mt-1`} placeholder="Search learners…" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['Programme', programme, setProgramme, options.programmes],
            ['Company', company, setCompany, options.companies],
            ['Programme status', status, setStatus, options.statuses],
          ] as const).map(([label, value, change, values]) => (
            <label key={label} className="block text-[11px] font-bold text-foreground-600">{label}
              <select value={value} onChange={event => change(event.target.value)} className={`${inputClass} mt-1`}>
                <option value="">All {label.toLowerCase() === 'company' ? 'companies' : label.toLowerCase() === 'programme' ? 'programmes' : 'statuses'}</option>
                {values.map(item => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          ))}
          <label className="block text-[11px] font-bold text-foreground-600">Assignment
            <select value={assignment} onChange={event => setAssignment(event.target.value)} className={`${inputClass} mt-1`}>
              <option value="">All learners</option><option value="unassigned">Not assigned</option><option value="assigned">Already assigned</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <span aria-live="polite">
            {visible.length} learners · {selected.size} selected{selected.size > visibleSelected ? ` (${selected.size - visibleSelected} outside these filters)` : ''}
            {toRemove.size > 0 && ` · ${toRemove.size} to remove`}
          </span>
          <div className="flex gap-3">
            <button type="button" onClick={() => { setSelected(new Set()); setToRemove(new Set()); }} disabled={!selected.size && !toRemove.size} className="font-bold text-primary-700 disabled:opacity-40">Clear selection</button>
            <button type="button" onClick={reset} className="font-bold text-primary-700">Reset filters</button>
          </div>
        </div>
      </fieldset>
      {loading ? <p role="status" className="py-10 text-center text-[13px] text-foreground-500">Loading learners…</p>
        : !data ? <button type="button" onClick={() => setRetry(value => value + 1)} className="text-[12px] font-bold text-primary-700">Try again</button>
          : <div className="overflow-hidden rounded-xl border border-foreground-200">
            <label className="flex items-center gap-3 border-b border-foreground-200 bg-background-100 px-4 py-3 text-[12px] font-bold">
              <input type="checkbox" checked={allSelected} disabled={saving || !selectable.length} onChange={toggleAll} />
              Select all filtered learners ({selectable.length} available)
            </label>
            <div className="max-h-[42vh] overflow-auto">
              {visible.length === 0 ? <p className="p-8 text-center text-[12px] text-foreground-500">No learners match these filters.</p>
                : visible.map(learner => {
                  const marked = learner.assigned && toRemove.has(learner.id);
                  return (
                    <label key={learner.id} className={`flex items-start gap-3 border-b border-foreground-100 p-4 last:border-0 ${marked ? 'bg-rose-50/60' : learner.assigned ? 'bg-background-100/70' : 'hover:bg-primary-50/40'}`}>
                      <input className="mt-1" type="checkbox" aria-label={`Select ${learner.name}`}
                        checked={learner.assigned ? !marked : selected.has(learner.id)}
                        disabled={saving || (learner.assigned && !canUnassign)} onChange={() => toggle(learner)} />
                      <span className="min-w-0 flex-1 text-[12px]">
                        <span className="block font-bold text-foreground-900">{learner.name}</span>
                        <span className="block break-all text-foreground-500">{learner.email}</span>
                        <span className="mt-1 block text-foreground-600">{[learner.programme, learner.company, learner.programmeStatus].filter(Boolean).join(' · ') || 'No programme or company recorded'}</span>
                      </span>
                      {learner.assigned && (marked
                        ? <span className="shrink-0 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700"><AppIcon className="ri-close-line mr-1" />Will be removed</span>
                        : <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700"><AppIcon className="ri-check-line mr-1" />Already assigned</span>)}
                    </label>
                  );
                })}
            </div>
          </div>}
    </EntityDrawer>
  );
}
