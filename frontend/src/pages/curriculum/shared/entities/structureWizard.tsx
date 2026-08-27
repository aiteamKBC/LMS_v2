// ============================================================================
// The guided run through Programme -> Cohort -> Group -> Module -> weeks.
//
// This is a second way IN, not a second implementation. Each record step opens
// the exact same drawer the record type's own page opens — ProgrammeFormDrawer,
// CohortFormDrawer, GroupFormDrawer, ModuleFormDrawer — so there is still one
// form, one validation rule set and one save path per record. What the wizard
// adds is the chain: the record a step just created is handed to the next step
// as its parent, so a programme, its first cohort, that cohort's first group and
// the group's first module can be set up without closing anything, walking to
// the sidebar and picking the parent again by hand.
//
// One step is the wizard's own rather than a record form, and it closes the run:
// the weeks handoff. The wizard's work ends with the module — the components
// inside its weeks are the Module Builder's to author — so the last page says so,
// lists what is still outstanding, and leaves the rail above it as the record of
// what the run created.
//
// The drawer-per-page route is untouched and remains the way to add a record to
// an existing parent. This is for the from-nothing case, where the records are
// really one piece of work.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { useCurriculumData } from '@/hooks/useCurriculumData';
import { useCurriculumStaffProfiles } from '@/hooks/useCurriculumStaffProfiles';
import {
  type CurriculumCohort,
  type CurriculumGroup,
  type CurriculumModule,
  type CurriculumProgramme,
} from '@/lib/curriculumApi';
import { cleanText, normaliseKey, programmeIdentity, sameIdentifier } from './model';
import { CohortFormDrawer, GroupFormDrawer, ProgrammeFormDrawer } from './forms';
import { ModuleFormDrawer, type ModuleFormTarget, type SavedModuleRef } from './moduleForm';
import { type FormChainStep } from './ui';
import { StructureWizardOutlineStep } from './structureWizardOutline';

/** Steps that create a record through that record's own form. */
export type StructureWizardRecordStep = 'programme' | 'cohort' | 'group' | 'module';
export type StructureWizardStep = StructureWizardRecordStep | 'outline';

/** What one run of the wizard actually wrote. Every field is optional: a step can be skipped. */
export interface StructureWizardCreated {
  programme?: CurriculumProgramme;
  cohort?: CurriculumCohort;
  group?: CurriculumGroup;
  module?: SavedModuleRef;
}

const RECORD_STEPS: StructureWizardRecordStep[] = ['programme', 'cohort', 'group', 'module'];
const STEP_ORDER: StructureWizardStep[] = [...RECORD_STEPS, 'outline'];

const STEP_META: Record<StructureWizardStep, {
  label: string;
  icon: string;
  /** The submit button while the chain still has a step after this one. */
  continueLabel: string;
  /** Moving on without creating this record — the next form picks a stored one instead. */
  skipLabel: string;
  /** What the step after this one is for, named in the brief. */
  nextIs: string;
}> = {
  programme: {
    label: 'Programme',
    icon: 'ri-layout-masonry-line',
    continueLabel: 'Create programme & continue',
    skipLabel: 'Use an existing programme',
    nextIs: 'its first cohort',
  },
  cohort: {
    label: 'Cohort',
    icon: 'ri-calendar-event-line',
    continueLabel: 'Create cohort & continue',
    skipLabel: 'Use an existing cohort',
    nextIs: 'the cohort’s first group',
  },
  group: {
    label: 'Group',
    icon: 'ri-team-line',
    continueLabel: 'Create group & continue',
    skipLabel: 'Use an existing group',
    nextIs: 'the group’s first module',
  },
  module: {
    label: 'Module',
    icon: 'ri-stack-line',
    continueLabel: 'Create module & continue',
    skipLabel: 'Finish without a module',
    nextIs: 'where its weeks get their components',
  },
  outline: {
    label: 'Weeks',
    icon: 'ri-layout-row-line',
    // The last step: it writes nothing, so there is nothing to skip past and
    // nothing after it to continue to.
    continueLabel: 'Finish',
    skipLabel: '',
    nextIs: '',
  },
};

/** A record a step just wrote, dropped into the collection the next step reads. */
function withRecord<T>(list: T[], record: T | undefined, key: (item: T) => string): T[] {
  if (!record) return list;
  const id = key(record);
  if (!id) return list;
  return list.some(item => sameIdentifier(key(item), id))
    ? list.map(item => (sameIdentifier(key(item), id) ? record : item))
    : [...list, record];
}

/** Staff names for the coach and tutor pickers, in the shape those forms expect. */
function profileNames(profiles: Array<{ name?: string; email?: string }>, fallbacks: string[]): string[] {
  const names = new Set<string>();
  profiles.forEach(profile => {
    const name = cleanText(profile.name) || cleanText(profile.email);
    if (name) names.add(name);
  });
  fallbacks.forEach(value => {
    const name = cleanText(value);
    if (name && normaliseKey(name) !== 'unassigned') names.add(name);
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

/** How many of `list` sit under `parentId`. Zero when there is no parent yet — an unset id matches nothing. */
function countUnder<T>(list: T[], parentId: string, parentOf: (item: T) => string): number {
  if (!parentId) return 0;
  return list.filter(item => sameIdentifier(parentOf(item), parentId)).length;
}

/** The `CurriculumModule` the run just created, once a refresh has brought it back. */
function findModule(modules: CurriculumModule[], catalogueId: string): CurriculumModule | undefined {
  if (!catalogueId) return undefined;
  return modules.find(module => [module.moduleCatalogueId, module.catalogueId, module.moduleId, module.id]
    .some(value => sameIdentifier(cleanText(value), catalogueId)));
}

/** Reduced to what the module form reads, so re-opening it edits rather than duplicates. */
function moduleFormTarget(module: CurriculumModule | undefined): ModuleFormTarget | null {
  if (!module) return null;
  const id = cleanText(module.moduleCatalogueId) || cleanText(module.catalogueId) || cleanText(module.moduleId) || cleanText(module.id);
  if (!id) return null;
  return {
    id,
    name: module.name || '',
    programmeId: module.programmeId,
    programme: module.programme,
    cohortId: module.cohortId,
    groupId: module.groupId,
    sessionsNumber: module.sessionsNumber,
    weeks: module.weeks,
    startDate: module.startDate,
    endDate: module.endDate,
    tutor: module.tutor,
    status: module.status,
    notes: module.notes,
    color: module.color,
  };
}

/**
 * Where in the chain the reader is, and what the earlier steps produced. Held
 * above the form's own fields so it stays put while they scroll.
 */
function WizardRail({
  steps,
  step,
  created,
  resolved,
}: {
  steps: StructureWizardStep[];
  step: StructureWizardStep;
  created: StructureWizardCreated;
  /** The parent chain as resolved, whether this run created those records or not. */
  resolved: { programme: string; cohort: string; group: string; module: string };
}) {
  const index = Math.max(0, steps.indexOf(step));
  /**
   * What a step contributed. `made` separates a record this run wrote from one it
   * was pointed at: a step can be skipped and the parent picked in the next form
   * instead, and a rail that showed nothing for it read as though the record were
   * missing rather than merely chosen elsewhere.
   */
  const contribution = (candidate: StructureWizardStep): { name: string; made: boolean } => {
    if (candidate === 'programme') return { name: cleanText(created.programme?.name) || resolved.programme, made: Boolean(created.programme) };
    if (candidate === 'cohort') return { name: cleanText(created.cohort?.name) || resolved.cohort, made: Boolean(created.cohort) };
    if (candidate === 'group') return { name: cleanText(created.group?.name) || resolved.group, made: Boolean(created.group) };
    if (candidate === 'module') return { name: cleanText(created.module?.name), made: Boolean(created.module) };
    return { name: '', made: false };
  };

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((candidate, position) => {
        const meta = STEP_META[candidate];
        const { name, made } = contribution(candidate);
        const done = position < index;
        const current = position === index;
        // Emerald is reserved for what the run wrote. A step it passed over
        // without creating anything stays neutral, however it was resolved.
        const wrote = done && made;
        return (
          <div key={candidate} className="flex min-w-0 flex-1 items-center gap-1.5">
            <div
              className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
                current
                  ? 'border-primary-300 bg-primary-50'
                  : wrote
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-background-200 bg-background-50'
              }`}
            >
              <AppIcon
                className={`${wrote ? 'ri-check-line' : done && name ? 'ri-links-line' : meta.icon} shrink-0 text-sm ${
                  current ? 'text-primary-700' : wrote ? 'text-emerald-600' : 'text-foreground-400'
                }`}
              ></AppIcon>
              <span className="min-w-0">
                <span
                  className={`block text-[11px] font-bold leading-4 ${
                    current ? 'text-primary-800' : wrote ? 'text-emerald-700' : 'text-foreground-400'
                  }`}
                >
                  {meta.label}
                </span>
                {name && (
                  <span className="block truncate text-[10px] leading-4 text-foreground-500" title={name}>
                    {made ? name : `${name} (existing)`}
                  </span>
                )}
              </span>
            </div>
            {position < steps.length - 1 && (
              <AppIcon className="ri-arrow-right-s-line shrink-0 text-sm text-foreground-300"></AppIcon>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * What this step is about to do, said in terms of the run rather than the form:
 * which parent it lands under, what is already stored there, and what comes next.
 * The form below it only knows about its own record.
 */
function WizardStepBrief({
  steps,
  step,
  inherited,
  siblingCount,
}: {
  steps: StructureWizardStep[];
  step: StructureWizardStep;
  /** The resolved parent chain, most general first. Blank entries are dropped. */
  inherited: string[];
  /** How many records of this kind already sit under the resolved parent. */
  siblingCount: number;
}) {
  const index = Math.max(0, steps.indexOf(step));
  const meta = STEP_META[step];
  const trail = inherited.filter(Boolean);
  const parent = trail.length ? trail[trail.length - 1] : '';
  const nextStep = steps[index + 1];

  const doing = step === 'outline'
    ? `Nothing left to create — ${parent || 'the new module'} is saved, and its weeks are filled in the Module Builder.`
    : parent
      ? `Creating a ${meta.label.toLowerCase()} under ${parent}.`
      : `Creating a ${meta.label.toLowerCase()}.`;

  return (
    <div className="mt-2.5 space-y-1">
      <p className="text-[11px] font-bold leading-4 text-foreground-700">
        Step {index + 1} of {steps.length} — {doing}
      </p>
      {trail.length > 1 && (
        <p className="truncate text-[11px] leading-4 text-foreground-500">
          <AppIcon className="ri-links-line mr-1 text-[11px]"></AppIcon>
          Inherits {trail.join(' → ')}
        </p>
      )}
      {siblingCount > 0 && step !== 'outline' && (
        <p className="text-[11px] leading-4 text-foreground-500">
          <AppIcon className="ri-stack-line mr-1 text-[11px]"></AppIcon>
          {siblingCount} {siblingCount === 1 ? `${meta.label.toLowerCase()} is` : `${meta.label.toLowerCase()}s are`} already stored there.
        </p>
      )}
      <p className="text-[11px] leading-4 text-foreground-400">
        {nextStep
          ? `Saved as you go — next is ${STEP_META[step].nextIs || STEP_META[nextStep].label.toLowerCase()}. You can stop at any step.`
          : 'Everything above is already saved. Finishing just closes the run.'}
      </p>
    </div>
  );
}

/**
 * Cheap to mount and closed by default: the collections it needs are fetched on
 * the way in, not on every page load. The host page keeps its own list in step
 * through `onStepSaved`, which is called with each record as it is written.
 */
export function CurriculumStructureWizard({
  open,
  from = 'programme',
  defaults,
  onClose,
  onStepSaved,
  onFinished,
}: {
  open: boolean;
  /** The record step the chain starts at. Steps before it are not offered. */
  from?: StructureWizardRecordStep;
  /** Parents already known — the programme filter a page was scoped to, say. */
  defaults?: { programmeId?: string; cohortId?: string; groupId?: string };
  onClose: () => void;
  /** Called with each record as it is saved, so the host list can paint it. */
  onStepSaved?: (created: StructureWizardCreated) => unknown | Promise<unknown>;
  /** Called once, with everything the run wrote, as the wizard closes. */
  onFinished?: (created: StructureWizardCreated) => void;
}) {
  const [step, setStep] = useState<StructureWizardStep>(from);
  const [created, setCreated] = useState<StructureWizardCreated>({});

  // Its own data, loaded when the wizard opens. The pages that offer it hold
  // different slices of the curriculum (Cohorts has holidays but no staff,
  // Groups the reverse), and a chain needs all of it whichever door it came in
  // through.
  const { data, reload } = useCurriculumData({ autoLoad: false, compact: true, includeHolidays: true });
  const { tutors, coaches, reload: reloadStaff } = useCurriculumStaffProfiles({ autoLoad: false });

  // `useCurriculumData` hands back a fresh `reload` closure on every render, so
  // the open transition is tracked by hand: the body below is a no-op unless the
  // wizard has just been opened, however often the effect itself re-runs.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!open) { openedRef.current = false; return; }
    if (openedRef.current) return;
    openedRef.current = true;
    setStep(from);
    setCreated({});
    void reload({ silent: true });
    reloadStaff({ silent: true });
  }, [from, open, reload, reloadStaff]);

  // The record a step just wrote is merged in locally, so the next step can
  // resolve its parent without waiting for the background refresh to land.
  const programmes = useMemo(
    () => withRecord(data?.programmes || [], created.programme, programme => programmeIdentity(programme)),
    [created.programme, data?.programmes],
  );
  const cohorts = useMemo(
    () => withRecord(data?.cohorts || [], created.cohort, cohort => cleanText(cohort.id)),
    [created.cohort, data?.cohorts],
  );
  const groups = useMemo(
    () => withRecord(data?.groups || [], created.group, group => cleanText(group.id)),
    [created.group, data?.groups],
  );
  const holidays = useMemo(() => data?.holidays || [], [data?.holidays]);
  const modules = useMemo(() => data?.modules || [], [data?.modules]);

  const coachNames = useMemo(
    () => profileNames(coaches, groups.map(group => cleanText(group.coach))),
    [coaches, groups],
  );
  const tutorNames = useMemo(
    () => profileNames(tutors, modules.map(module => cleanText(module.tutor))),
    [modules, tutors],
  );

  // The parents every step below is opened against: what this run created first,
  // then the parents the module form resolved, then whatever the host page knew.
  // The module form's answer matters because a skipped step leaves the parent to
  // be picked there, and without it the run would report "Not set" for a cohort
  // and group the module demonstrably sits under.
  const chainDefaults = useMemo(() => ({
    programmeId: (created.programme ? programmeIdentity(created.programme) : '')
      || cleanText(created.cohort?.programmeId)
      || cleanText(created.module?.programmeId)
      || cleanText(defaults?.programmeId),
    cohortId: cleanText(created.cohort?.id)
      || cleanText(created.group?.cohortId)
      || cleanText(created.module?.cohortId)
      || cleanText(defaults?.cohortId),
    groupId: cleanText(created.group?.id)
      || cleanText(created.module?.groupIds?.[0])
      || cleanText(defaults?.groupId),
  }), [created.cohort, created.group, created.module, created.programme, defaults]);

  // Names for the rail and the brief: what this run created wins, then what the
  // resolved id points at in the stored collections, then the name the module form
  // reported — which is the only source when the record is too fresh to be in the
  // collections yet.
  const chainNames = useMemo(() => {
    const programme = programmes.find(item => sameIdentifier(programmeIdentity(item), chainDefaults.programmeId));
    const cohort = cohorts.find(item => sameIdentifier(cleanText(item.id), chainDefaults.cohortId));
    const group = groups.find(item => sameIdentifier(cleanText(item.id), chainDefaults.groupId));
    return {
      programme: cleanText(created.programme?.name) || cleanText(programme?.name) || cleanText(created.module?.programmeName),
      cohort: cleanText(created.cohort?.name) || cleanText(cohort?.name) || cleanText(created.module?.cohortName),
      // A module can be placed in several groups at once, and the run should say
      // so rather than name the first and imply it was the only one.
      group: cleanText(created.group?.name)
        || (created.module?.groupNames?.length ? created.module.groupNames.join(', ') : '')
        || cleanText(group?.name),
      module: cleanText(created.module?.name),
    };
  }, [chainDefaults, cohorts, created, groups, programmes]);

  const siblingCounts = useMemo(() => ({
    programme: programmes.length,
    cohort: countUnder(cohorts, chainDefaults.programmeId, cohort => cleanText(cohort.programmeId)),
    group: countUnder(groups, chainDefaults.cohortId, group => cleanText(group.cohortId)),
    module: countUnder(modules, chainDefaults.groupId, module => cleanText(module.groupId)),
  }), [chainDefaults, cohorts, groups, modules, programmes]);

  const savedModuleId = cleanText(created.module?.catalogueId);
  const savedModule = useMemo(() => findModule(modules, savedModuleId), [modules, savedModuleId]);
  const savedModuleTarget = useMemo(() => moduleFormTarget(savedModule), [savedModule]);

  // The outline step has nothing to work on until a module exists, so it drops
  // out of the run — and out of the rail — when this run did not create one.
  const steps = useMemo(() => {
    const start = Math.max(0, STEP_ORDER.indexOf(from));
    return STEP_ORDER.slice(start).filter(candidate => candidate !== 'outline' || Boolean(savedModuleId));
  }, [from, savedModuleId]);

  // `steps` is recomputed as the run writes records, so the current step is
  // resolved against it rather than held as an index that could drift.
  const position = Math.max(0, steps.indexOf(step));
  const nextStep = steps[position + 1];
  const previousStep = position > 0 ? steps[position - 1] : undefined;

  /**
   * `announce` is off when the run was stopped from the leave confirm: that
   * dialog has just named what stays saved, and following it with a second modal
   * saying the same thing only makes the way out feel like an obstacle course.
   */
  const finish = (result: StructureWizardCreated, announce = true) => {
    onClose();
    onFinished?.(result);
    const trail = [
      cleanText(result.programme?.name),
      cleanText(result.cohort?.name),
      cleanText(result.group?.name),
      cleanText(result.module?.name),
    ].filter(Boolean);
    if (!announce || !trail.length) return;
    void showCurriculumAlert({
      title: trail.length > 1 ? 'Structure created' : 'Saved',
      // The KSB warning the programme form would have given on its own is said
      // here instead, so a whole run confirms once rather than at every step.
      text: `${trail.join(' → ')} ${trail.length > 1 ? 'are' : 'is'} saved and linked.${
        result.module ? ' Add the components inside its weeks in the Module Builder.' : ''
      }${
        result.programme
          ? ' The programme has no KSB source yet — nothing beneath it can be mapped or measured until one is applied.'
          : ''
      }`,
      timer: result.programme ? undefined : 3200,
    });
  };

  /** Forward to the next step in the run, or out of it if this was the last. */
  const goForward = (state: StructureWizardCreated) => {
    // Recomputed from `state`, not from `steps`: the module this save just
    // created is what brings the outline step into the run.
    const start = Math.max(0, STEP_ORDER.indexOf(from));
    const nextSteps = STEP_ORDER.slice(start)
      .filter(candidate => candidate !== 'outline' || Boolean(cleanText(state.module?.catalogueId)));
    const at = Math.max(0, nextSteps.indexOf(step));
    const target = nextSteps[at + 1];
    if (!target) { finish(state); return; }
    setStep(target);
  };

  /**
   * One step is done. The record goes into the chain, the host page is told, and
   * the next step opens against it — or the run ends if this was the last.
   */
  const advance = (next: StructureWizardCreated) => {
    const merged = { ...created, ...next };
    setCreated(merged);
    // Fire and forget on purpose: the step that just saved is being replaced, so
    // holding its spinner up for the host's refresh only delays the next form.
    void Promise.resolve(onStepSaved?.(next)).catch(() => undefined);
    void reload({ silent: true });
    goForward(merged);
  };

  /** Cancel, Escape, the backdrop or the cross — the run stops where it is. */
  const exit = () => finish(created, false);

  // Nothing this run wrote is undone by leaving, so once a step has saved the
  // way out stops calling itself Cancel.
  const written = Boolean(created.programme || created.cohort || created.group || created.module);

  /** What each step inherits, for the brief above its fields. */
  const inheritedFor = (target: StructureWizardStep): string[] => {
    if (target === 'programme') return [];
    if (target === 'cohort') return [chainNames.programme];
    if (target === 'group') return [chainNames.programme, chainNames.cohort];
    if (target === 'module') return [chainNames.programme, chainNames.cohort, chainNames.group];
    return [chainNames.module];
  };

  /**
   * The cross, Escape and the backdrop end the whole run, not just this form, so
   * a step asks before it goes — even with nothing typed, which a form on its own
   * page would close silently. What the run already wrote is named, so "discard"
   * is never read as undoing it.
   */
  const closeConfirmFor = (target: StructureWizardStep): FormChainStep['closeConfirm'] => {
    if (target === 'outline') return undefined;
    const saved = [
      cleanText(created.programme?.name),
      cleanText(created.cohort?.name),
      cleanText(created.group?.name),
      cleanText(created.module?.name),
    ].filter(Boolean);
    const step = STEP_META[target].label.toLowerCase();
    return {
      title: saved.length ? 'Stop the guided setup here?' : 'Leave the guided setup?',
      text: saved.length
        ? `${saved.join(' → ')} ${saved.length > 1 ? 'stay' : 'stays'} saved. This ${step} has not been created yet, and closing now ends the run without it.`
        : `Nothing has been created yet. Closing now ends the run and this ${step} is not saved.`,
      confirmLabel: saved.length ? 'Stop here' : 'Discard',
    };
  };

  const siblingCountFor = (target: StructureWizardStep): number =>
    target === 'programme' || target === 'cohort' || target === 'group' || target === 'module'
      ? siblingCounts[target]
      : 0;

  const chainFor = (target: StructureWizardStep): FormChainStep => ({
    chained: true,
    width: 'w-[760px]',
    banner: (
      <>
        <WizardRail steps={steps} step={step} created={created} resolved={chainNames} />
        <WizardStepBrief steps={steps} step={target} inherited={inheritedFor(target)} siblingCount={siblingCountFor(target)} />
      </>
    ),
    // A record step with nothing after it keeps its form's own label ("Create
    // module"), since there is no "& continue" to promise. The weeks handoff is
    // always last and says Finish.
    submitLabel: target === 'outline' || nextStep ? STEP_META[target].continueLabel : undefined,
    cancelLabel: written ? 'Stop here' : undefined,
    closeConfirm: closeConfirmFor(target),
    // The weeks handoff creates nothing, so it carries no skip label and is the
    // only step without this button.
    extraAction: STEP_META[target].skipLabel ? {
      label: STEP_META[target].skipLabel,
      icon: 'ri-skip-forward-line',
      onClick: () => goForward(created),
      confirmWhenDirty: 'This form has answers that have not been saved. Moving on now throws them away.',
    } : undefined,
    // Nothing written is undone by stepping back -- the previous step's record
    // stays saved, and reopening its form against it (below) edits it in place
    // rather than creating a second one.
    backAction: previousStep ? {
      label: `Back to ${STEP_META[previousStep].label}`,
      icon: 'ri-arrow-left-line',
      onClick: () => setStep(previousStep),
      confirmWhenDirty: 'This form has answers that have not been saved. Going back now throws them away.',
    } : undefined,
  });

  // Everything the run still leaves for someone to do, said on the last step
  // rather than discovered later.
  const outstanding = useMemo(() => {
    const items: string[] = [];
    if (created.programme && !cleanText(created.programme.ksbProfileSourceId)) {
      items.push('The new programme has no KSB source. Nothing beneath it can be mapped or measured until one is applied on the Programmes page.');
    }
    if (created.module) {
      items.push('The module’s weeks have no components yet. Open the Module Builder to add them, and to write their titles, content and KSB mappings.');
    }
    if (!created.module && steps.includes('module')) {
      items.push('No module was created, so this group has nothing to deliver yet.');
    }
    return items;
  }, [created, steps]);

  return (
    <>
      <ProgrammeFormDrawer
        open={open && step === 'programme'}
        // Set only once this step has already saved and the run has stepped
        // back to it, so "Back" reopens the same record to edit instead of
        // starting a second one.
        programme={created.programme}
        chain={chainFor('programme')}
        onClose={exit}
        onSaved={result => advance({ programme: result?.programme })}
      />
      <CohortFormDrawer
        open={open && step === 'cohort'}
        cohort={created.cohort}
        defaults={{ programmeId: chainDefaults.programmeId }}
        programmes={programmes}
        holidays={holidays}
        chain={chainFor('cohort')}
        onClose={exit}
        onSaved={result => advance({ cohort: result?.cohort })}
      />
      <GroupFormDrawer
        open={open && step === 'group'}
        group={created.group}
        defaults={{ programmeId: chainDefaults.programmeId, cohortId: chainDefaults.cohortId }}
        programmes={programmes}
        cohorts={cohorts}
        coachNames={coachNames}
        chain={chainFor('group')}
        onClose={exit}
        onSaved={result => advance({ group: result?.group })}
      />
      <ModuleFormDrawer
        open={open && step === 'module'}
        // Only once the refresh has brought the saved module back in full:
        // re-opening it on a partial record would blank the fields it holds.
        module={savedModuleTarget}
        defaults={{
          programmeId: chainDefaults.programmeId,
          cohortId: chainDefaults.cohortId,
          groupId: chainDefaults.groupId,
        }}
        programmes={programmes}
        cohorts={cohorts}
        groups={groups}
        holidays={holidays}
        tutorNames={tutorNames}
        chain={chainFor('module')}
        onClose={exit}
        onSaved={saved => advance({ module: saved })}
      />
      {open && step === 'outline' && savedModuleId && (
        <StructureWizardOutlineStep
          open
          moduleName={cleanText(created.module?.name)}
          outstanding={outstanding}
          chain={chainFor('outline')}
          onClose={exit}
          // The last step writes nothing, so finishing here is the whole of it —
          // no record to hand over and no refresh to trigger.
          onDone={() => finish(created)}
        />
      )}
    </>
  );
}
