import { useEffect, useMemo, useRef, useState } from 'react';
import {
  applyCurriculumLearnerAssignments, fetchLearnerAssignments,
  type AssignmentLearner, type LearnerAssignmentApplyResult,
  type LearnerAssignmentDirectory, type LearnerAssignmentProgress,
  type LearnerAssignmentTarget,
} from '@/api/curriculumLearnerAssignments';
import { AppIcon } from '@/components/feature/AppIcon';
import { EntityDrawer } from './ui';

const inputClass = 'w-full rounded-lg border border-foreground-200 bg-background-50 px-3 py-2 text-[12px] text-foreground-900 focus:border-primary-500';

/** What the caller needs to repaint its own count without refetching the list. */
export interface LearnerAssignmentOutcome {
  assignedCount: number;
  changedCount: number;
  moduleCount: number;
  learnerCount: number;
}

type Tab = 'available' | 'assigned';

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
  const [progress, setProgress] = useState<LearnerAssignmentProgress | null>(null);
  const [report, setReport] = useState<LearnerAssignmentApplyResult | null>(null);
  const [tab, setTab] = useState<Tab>('available');
  const [query, setQuery] = useState('');
  const [programme, setProgramme] = useState('');
  const [company, setCompany] = useState('');
  const [status, setStatus] = useState('');
  const [toAdd, setToAdd] = useState<Set<string>>(() => new Set());
  const [toRemove, setToRemove] = useState<Set<string>>(() => new Set());
  const [reviewOpen, setReviewOpen] = useState(false);

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

  const canUnassign = target.scope === 'module';
  const learners = data?.learners || [];
  const byId = useMemo(() => new Map(learners.map(learner => [learner.id, learner])), [learners]);

  const options = useMemo(() => {
    const values = (key: 'programme' | 'company' | 'programmeStatus') =>
      [...new Set(learners.map(learner => learner[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { programmes: values('programme'), companies: values('company'), statuses: values('programmeStatus') };
  }, [learners]);

  const matchesFilters = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (learner: AssignmentLearner) => {
      const name = `${learner.name} ${learner.email}`.toLocaleLowerCase();
      return terms.every(term => name.includes(term))
        && (!programme || learner.programme === programme)
        && (!company || learner.company === company)
        && (!status || learner.programmeStatus === status);
    };
  }, [query, programme, company, status]);

  const available = useMemo(() => learners.filter(learner => !learner.assigned), [learners]);
  const assigned = useMemo(() => learners.filter(learner => learner.assigned), [learners]);
  const visibleAvailable = useMemo(() => available.filter(matchesFilters), [available, matchesFilters]);
  const visibleAssigned = useMemo(() => assigned.filter(matchesFilters), [assigned, matchesFilters]);
  const visible = tab === 'available' ? visibleAvailable : visibleAssigned;

  const allVisibleAdded = visibleAvailable.length > 0 && visibleAvailable.every(learner => toAdd.has(learner.id));
  const allVisibleRemoved = visibleAssigned.length > 0 && visibleAssigned.every(learner => toRemove.has(learner.id));

  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };
  const toggleAdd = (id: string) => setToAdd(previous => toggleIn(previous, id));
  const toggleRemove = (id: string) => { if (canUnassign) setToRemove(previous => toggleIn(previous, id)); };
  const toggleAllVisible = () => {
    if (tab === 'available') {
      setToAdd(previous => {
        const next = new Set(previous);
        visibleAvailable.forEach(learner => { if (allVisibleAdded) next.delete(learner.id); else next.add(learner.id); });
        return next;
      });
      return;
    }
    if (!canUnassign) return;
    setToRemove(previous => {
      const next = new Set(previous);
      visibleAssigned.forEach(learner => { if (allVisibleRemoved) next.delete(learner.id); else next.add(learner.id); });
      return next;
    });
  };

  const pending = toAdd.size + toRemove.size;
  const clearSelection = () => { setToAdd(new Set()); setToRemove(new Set()); setReviewOpen(false); };
  const resetFilters = () => { setQuery(''); setProgramme(''); setCompany(''); setStatus(''); };

  const submit = async () => {
    if (!data || loading || !pending || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setReport(null);
    setProgress(null);
    try {
      const result = await applyCurriculumLearnerAssignments(
        target, { add: [...toAdd], remove: [...toRemove] }, setProgress,
      );
      const assignedBefore = assigned.length;
      const learnerCount = Math.max(0, assignedBefore + result.added.length - result.removed.length);
      if (result.added.length || result.removed.length) {
        onAssigned({
          assignedCount: result.added.length + result.removed.length,
          changedCount: result.changedCount,
          moduleCount: result.moduleCount || data.target.moduleCount,
          learnerCount,
        });
      }
      if (!result.failed.length) {
        onClose();
        return;
      }
      // Partial success: keep the drawer open on exactly what did not save, and
      // reload so the two tabs show what the server actually holds now.
      const failed = new Set(result.failed);
      setToAdd(previous => new Set([...previous].filter(id => failed.has(id))));
      setToRemove(previous => new Set([...previous].filter(id => failed.has(id))));
      setReport(result);
      setRetry(value => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update learner assignments. Please try again.');
    } finally {
      savingRef.current = false;
      setSaving(false);
      setProgress(null);
    }
  };

  const submitLabel = saving
    ? progress ? `Saving ${progress.done} of ${progress.total}…` : 'Saving…'
    : [
      toAdd.size ? `Add ${toAdd.size}` : '',
      toRemove.size ? `Remove ${toRemove.size}` : '',
    ].filter(Boolean).join(' · ') || 'Save changes';

  const reviewChips = [
    ...[...toAdd].map(id => ({ id, kind: 'add' as const })),
    ...[...toRemove].map(id => ({ id, kind: 'remove' as const })),
  ];

  return (
    <EntityDrawer open title={`Assign learners to ${target.scope}`} subtitle={target.name}
      width="w-[880px]" onClose={onClose} onSubmit={submit}
      saving={saving} error={error} dirty={pending > 0}
      submitDisabled={loading || !data || !pending} submitLabel={submitLabel}>

      <div role="note" className="rounded-xl border border-primary-200 bg-primary-50 p-3 text-[12px] leading-5 text-primary-900">
        {target.scope === 'cohort'
          ? `Learners you add join this cohort and receive all ${data ? data.target.moduleCount : ''} modules in it. Removing a learner from a cohort is not done here — open the module they should leave.`
          : 'Learners you add receive this module only. Their programme, cohort and other module assignments stay as they are. Use the Currently assigned tab to take a learner off this module.'}
      </div>

      {report && (
        <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[12px] leading-5 text-amber-900">
          <span className="block font-bold">Saved part of this change.</span>
          <span className="block">
            {report.added.length} added · {report.removed.length} removed · {report.failed.length} not saved.
          </span>
          {report.failureMessage && <span className="mt-1 block">Reason given: {report.failureMessage}</span>}
          <span className="mt-1 block">
            {report.abandoned
              ? 'The server failed twice in a row, so the rest was not attempted. The learners left selected are the ones still to do.'
              : 'The learners left selected are the ones that did not save. Press the button again to retry just those.'}
          </span>
        </div>
      )}

      <fieldset disabled={loading || saving} className="space-y-3">
        <label className="block text-[11px] font-bold text-foreground-600">
          Search by name or email
          <input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} className={`${inputClass} mt-1`} placeholder="Search learners…" />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
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
        </div>
      </fieldset>

      <div className="flex gap-2 border-b border-foreground-200" role="tablist">
        {([
          ['available', `Available (${available.length})`],
          ['assigned', `Currently assigned (${assigned.length})`],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} disabled={saving}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12px] font-bold ${tab === key
              ? 'border-primary-600 text-primary-800'
              : 'border-transparent text-foreground-500 hover:text-foreground-800'}`}>
            {label}
            {key === 'available' && toAdd.size > 0 && <span className="ml-2 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] text-primary-800">{toAdd.size} to add</span>}
            {key === 'assigned' && toRemove.size > 0 && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] text-rose-800">{toRemove.size} to remove</span>}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span aria-live="polite">
          Showing {visible.length} of {(tab === 'available' ? available : assigned).length}
          {pending > 0 && ` · ${toAdd.size} to add · ${toRemove.size} to remove`}
        </span>
        <div className="flex gap-3">
          {pending > 0 && (
            <button type="button" onClick={() => setReviewOpen(open => !open)} className="font-bold text-primary-700">
              {reviewOpen ? 'Hide selection' : `Review selection (${pending})`}
            </button>
          )}
          <button type="button" onClick={clearSelection} disabled={!pending} className="font-bold text-primary-700 disabled:opacity-40">Clear selection</button>
          <button type="button" onClick={resetFilters} className="font-bold text-primary-700">Reset filters</button>
        </div>
      </div>

      {reviewOpen && pending > 0 && (
        // The old drawer only ever counted the selections a filter had hidden.
        // Naming them is what makes "15 selected (15 outside these filters)"
        // something a person can check before they press save.
        <div className="flex flex-wrap gap-2 rounded-xl border border-foreground-200 bg-background-100 p-3">
          {reviewChips.map(({ id, kind }) => (
            <span key={`${kind}:${id}`} className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${kind === 'add' ? 'bg-primary-100 text-primary-900' : 'bg-rose-100 text-rose-900'}`}>
              {kind === 'add' ? 'Add' : 'Remove'} · {byId.get(id)?.name || byId.get(id)?.email || id}
              <button type="button" disabled={saving} aria-label={`Undo ${kind === 'add' ? 'add' : 'remove'} ${byId.get(id)?.name || id}`}
                onClick={() => (kind === 'add' ? toggleAdd(id) : toggleRemove(id))}
                className="ml-1 font-bold">×</button>
            </span>
          ))}
        </div>
      )}

      {loading ? <p role="status" className="py-10 text-center text-[13px] text-foreground-500">Loading learners…</p>
        : !data ? <button type="button" onClick={() => setRetry(value => value + 1)} className="text-[12px] font-bold text-primary-700">Try again</button>
          : <div className="overflow-hidden rounded-xl border border-foreground-200">
            {tab === 'available' ? (
              <label className="flex items-center gap-3 border-b border-foreground-200 bg-background-100 px-4 py-3 text-[12px] font-bold">
                <input type="checkbox" checked={allVisibleAdded} disabled={saving || !visibleAvailable.length} onChange={toggleAllVisible} />
                Select all filtered learners ({visibleAvailable.length} available)
              </label>
            ) : canUnassign ? (
              <div className="flex items-center justify-between gap-3 border-b border-foreground-200 bg-background-100 px-4 py-3 text-[12px] font-bold">
                <span>{visibleAssigned.length} assigned learner{visibleAssigned.length === 1 ? '' : 's'} shown</span>
                <button type="button" disabled={saving || !visibleAssigned.length} onClick={toggleAllVisible}
                  className="font-bold text-rose-700 disabled:opacity-40">
                  {allVisibleRemoved ? 'Keep all filtered learners' : 'Remove all filtered learners'}
                </button>
              </div>
            ) : (
              <p className="border-b border-foreground-200 bg-background-100 px-4 py-3 text-[12px] text-foreground-600">
                Cohort membership is not removed here. Open the module a learner should leave.
              </p>
            )}
            <div className="max-h-[42vh] overflow-auto">
              {visible.length === 0 ? (
                <p className="p-8 text-center text-[12px] text-foreground-500">
                  {tab === 'available'
                    ? 'No unassigned learners match these filters.'
                    : 'No assigned learners match these filters.'}
                </p>
              ) : visible.map(learner => {
                const marked = tab === 'available' ? toAdd.has(learner.id) : toRemove.has(learner.id);
                const facts = [learner.programme, learner.company, learner.programmeStatus].filter(Boolean).join(' · ') || 'No programme or company recorded';
                if (tab === 'assigned') {
                  return (
                    <div key={learner.id} className={`flex items-start gap-3 border-b border-foreground-100 p-4 last:border-0 ${marked ? 'bg-rose-50/60' : ''}`}>
                      <span className="min-w-0 flex-1 text-[12px]">
                        <span className="block font-bold text-foreground-900">{learner.name}</span>
                        <span className="block break-all text-foreground-500">{learner.email}</span>
                        <span className="mt-1 block text-foreground-600">{facts}</span>
                      </span>
                      {marked && <span className="shrink-0 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700"><AppIcon className="ri-close-line mr-1" />Will be removed</span>}
                      {canUnassign && (
                        <button type="button" disabled={saving} onClick={() => toggleRemove(learner.id)}
                          className={`shrink-0 rounded-lg border px-3 py-1 text-[11px] font-bold ${marked
                            ? 'border-foreground-300 text-foreground-700'
                            : 'border-rose-300 text-rose-700 hover:bg-rose-50'}`}>
                          {marked ? `Keep ${learner.name.split(' ')[0] || 'learner'}` : 'Remove'}
                        </button>
                      )}
                    </div>
                  );
                }
                return (
                  <label key={learner.id} className={`flex items-start gap-3 border-b border-foreground-100 p-4 last:border-0 ${marked ? 'bg-primary-50/50' : 'hover:bg-primary-50/40'}`}>
                    <input className="mt-1" type="checkbox" aria-label={`Select ${learner.name}`}
                      checked={marked} disabled={saving} onChange={() => toggleAdd(learner.id)} />
                    <span className="min-w-0 flex-1 text-[12px]">
                      <span className="block font-bold text-foreground-900">{learner.name}</span>
                      <span className="block break-all text-foreground-500">{learner.email}</span>
                      <span className="mt-1 block text-foreground-600">{facts}</span>
                    </span>
                    {marked && <span className="shrink-0 rounded-full bg-primary-50 px-2 py-1 text-[10px] font-bold text-primary-800"><AppIcon className="ri-check-line mr-1" />Will be added</span>}
                  </label>
                );
              })}
            </div>
          </div>}
    </EntityDrawer>
  );
}
