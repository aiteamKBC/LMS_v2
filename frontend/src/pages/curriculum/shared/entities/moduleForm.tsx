// ============================================================================
// The create/edit form for a Module.
//
// It sits apart from `forms.tsx` on purpose: creating a module has to build the
// same authoring skeleton the Module Builder reads, which means importing
// `module-builder/moduleAuthoringData`. Keeping that import out of the shared
// forms file keeps the Programmes, Cohorts and Groups pages off the authoring
// chunk.
//
// One form, two canonical save paths â€” neither of them reimplemented here:
//   * placed in a group -> POST /curriculum/groups/<id>/modules/, which bounds
//     both module dates to the cohort's delivery window, builds the session plan
//     from the group's delivery days and holidays, refuses a tutor
//     double-booking and mirrors the assignment onto the tutor's profile (the
//     notification);
//   * no group yet      -> POST /curriculum/modules/, a catalogue draft that
//     gets its cohort, group, tutor and dates when it is placed later.
// Editing goes through PATCH /curriculum/modules/<id>/, which carries the same
// cohort window, conflict check and tutor notification as the create-in-group
// path.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from '@/components/feature/AppIcon';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { DatePickerField } from '@/components/feature/DatePickerField';
import { TutorClashNotice } from '@/components/feature/TutorClashNotice';
import { useTutorAvailability } from '@/hooks/useTutorAvailability';
import {
  createGroupModule,
  previewModuleSessionPlan,
  tutorConflictMessage,
  updateCurriculumModule,
  type CurriculumGroup,
  type CurriculumCohort,
  type CurriculumHoliday,
  type CurriculumProgramme,
  type CurriculumSessionPlanPreview,
} from '@/lib/curriculumApi';
import type { SelectOption } from '@/components/feature/SelectField';
import { createNewModule } from '../../module-builder/moduleAuthoringData';
import {
  cleanText,
  cohortsForProgramme,
  formatDateLabel,
  groupsForScope,
  moduleCohortDateError,
  normaliseKey,
  programmeIdentity,
  sameFormValues,
  sameIdentifier,
  visibleNotes,
} from './model';
import {
  ColorControl,
  EntityDrawer,
  FormField,
  SelectControl,
  TextAreaControl,
  TextControl,
} from './ui';

export interface ModuleFormDefaults {
  programmeId?: string;
  cohortId?: string;
  groupId?: string;
}

interface ModuleFormDeliveryRef {
  programmeId?: string;
  programme?: string;
  cohortId?: string;
  cohort?: string;
  groupId?: string;
  group?: string;
  tutor?: string;
  startDate?: string;
  endDate?: string;
  sessions?: number;
}

/**
 * The module being edited, reduced to what this form reads and writes. Declared
 * rather than reusing `CurriculumModule` because the Module Builder holds its
 * modules as authoring catalogue items â€” same records, different field names â€”
 * and both call sites must end up patching the same canonical id.
 */
export interface ModuleFormTarget {
  /** Canonical module catalogue id: what PATCH /curriculum/modules/<id>/ takes. */
  id: string;
  name: string;
  programmeId?: string;
  programme?: string;
  cohortId?: string;
  groupId?: string;
  sessionsNumber?: number;
  weeks?: number;
  startDate?: string;
  /** The stored end date, shown until the session-plan preview returns its own. */
  endDate?: string;
  tutor?: string;
  status?: string;
  notes?: string;
  color?: string;
  deliveryUsages?: ModuleFormDeliveryRef[];
}

/** What a successful save hands back, so the caller can go straight to the module. */
export interface SavedModuleRef {
  catalogueId: string;
  name: string;
  created: boolean;
}

const UNASSIGNED = 'unassigned';
const TRUE_FLAGS = new Set(['1', 'true', 'yes', 'y', 'on']);
const FALSE_FLAGS = new Set(['0', 'false', 'no', 'n', 'off']);

type ProgrammeVisibilityFields = CurriculumProgramme & {
  is_active?: unknown;
  is_archived?: unknown;
  is_archive?: unknown;
  archived?: unknown;
  deletedAt?: unknown;
  deleted_at?: unknown;
};

function flagIsTrue(value: unknown): boolean {
  return value === true || TRUE_FLAGS.has(normaliseKey(value));
}

function flagIsFalse(value: unknown): boolean {
  return value === false || FALSE_FLAGS.has(normaliseKey(value));
}

function isSelectableProgramme(programme: CurriculumProgramme): boolean {
  const row = programme as ProgrammeVisibilityFields;
  const archived = programme.isArchived === true
    || flagIsTrue(row.is_archived)
    || flagIsTrue(row.is_archive)
    || flagIsTrue(row.archived)
    || Boolean(cleanText(row.deletedAt || row.deleted_at))
    || normaliseKey(programme.status) === 'archived';
  const inactive = programme.isActive === false || flagIsFalse(row.is_active);
  return !archived && !inactive;
}

export function ModuleFormDrawer({
  open,
  module,
  defaults,
  programmes,
  cohorts,
  groups,
  holidays = [],
  tutorNames = [],
  lockGroup = false,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Present when editing; absent when creating. */
  module?: ModuleFormTarget | null;
  defaults?: ModuleFormDefaults;
  programmes: CurriculumProgramme[];
  cohorts: CurriculumCohort[];
  groups: CurriculumGroup[];
  /** Used to preview the session dates the backend will generate. */
  holidays?: CurriculumHoliday[];
  tutorNames?: string[];
  /** True inside a Group workspace, where the parent is not up for debate. */
  lockGroup?: boolean;
  onClose: () => void;
  onSaved: (saved: SavedModuleRef) => unknown | Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [sessionsNumber, setSessionsNumber] = useState('1');
  const [startDate, setStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [tutor, setTutor] = useState('');
  const [status, setStatus] = useState('draft');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<CurriculumSessionPlanPreview | null>(null);
  // True from the moment weeks/start date/delivery days change until the
  // session-plan preview catches up with them. Saving while this is true
  // would PATCH the end date from the *previous* weeks value, since the
  // preview (and the end date it feeds) is fetched on a 300ms debounce.
  const [planLoading, setPlanLoading] = useState(false);
  const [sessionPreviewOpen, setSessionPreviewOpen] = useState(false);
  // What the drawer opened with, for the unsaved-changes check below.
  const baseline = useRef<Record<string, unknown>>({});
  const selectableProgrammes = useMemo(
    () => programmes.filter(isSelectableProgramme),
    [programmes],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setPlan(null);
    setSessionPreviewOpen(false);

    const storedDelivery = module?.deliveryUsages?.[0];
    const parentGroup = groups.find(group => (
      sameIdentifier(group.id, module?.groupId || storedDelivery?.groupId || defaults?.groupId)
      || sameIdentifier(group.name, storedDelivery?.group)
    ));
    const parentCohort = cohorts.find(cohort => (
      sameIdentifier(cohort.id, module?.cohortId || storedDelivery?.cohortId || parentGroup?.cohortId || defaults?.cohortId)
      || sameIdentifier(cohort.name, storedDelivery?.cohort)
    ));
    const resolvedProgrammeId = cleanText(parentCohort?.programmeId)
      || cleanText(parentGroup?.programmeId)
      || cleanText(module?.programmeId)
      || cleanText(storedDelivery?.programmeId)
      || cleanText(module?.programme)
      || cleanText(storedDelivery?.programme)
      || defaults?.programmeId
      || (selectableProgrammes.length === 1 ? programmeIdentity(selectableProgrammes[0]) : '');

    const directTutor = cleanText(module?.tutor);
    const storedTutor = normaliseKey(directTutor) === UNASSIGNED
      ? cleanText(storedDelivery?.tutor)
      : directTutor || cleanText(storedDelivery?.tutor);
    const initial = {
      name: cleanText(module?.name),
      programmeId: resolvedProgrammeId,
      cohortId: cleanText(parentCohort?.id) || cleanText(module?.cohortId) || cleanText(storedDelivery?.cohortId) || defaults?.cohortId || '',
      groupId: cleanText(parentGroup?.id) || cleanText(module?.groupId) || cleanText(storedDelivery?.groupId) || defaults?.groupId || '',
      // Seeded from the authored week count only. Seeding from `sessionsNumber`
      // (or the delivery's `sessions`) put a delivery-day-multiplied number in the
      // Weeks box, which then saved back multiplied again on every round-trip.
      sessionsNumber: String(module?.weeks || module?.sessionsNumber || storedDelivery?.sessions || 1),
      // A new module inside a cohort starts when the cohort does â€” the same
      // default the backend falls back to when no start date is sent.
      startDate: cleanText(module?.startDate) || cleanText(storedDelivery?.startDate) || (module ? '' : cleanText(parentCohort?.startDate)),
      targetEndDate: cleanText(module?.endDate) || cleanText(storedDelivery?.endDate),
      tutor: normaliseKey(storedTutor) === UNASSIGNED ? '' : storedTutor,
      status: cleanText(module?.status) || 'draft',
      description: visibleNotes(module?.notes),
      color: module?.color || parentGroup?.color || '#2563eb',
    };
    baseline.current = initial;
    console.log('[TEMP-DEBUG moduleForm] drawer (re)initialised. module prop =', module, 'initial state =', initial);
    setName(initial.name);
    setProgrammeId(initial.programmeId);
    setCohortId(initial.cohortId);
    setGroupId(initial.groupId);
    setSessionsNumber(initial.sessionsNumber);
    setStartDate(initial.startDate);
    setTargetEndDate(initial.targetEndDate);
    setTutor(initial.tutor);
    setStatus(initial.status);
    setDescription(initial.description);
    setColor(initial.color);
  }, [cohorts, defaults?.cohortId, defaults?.groupId, defaults?.programmeId, groups, module, open, selectableProgrammes]);

  const dirty = !sameFormValues(
    { name, programmeId, cohortId, groupId, sessionsNumber, startDate, targetEndDate, tutor, status, description, color },
    baseline.current,
  );
  // Only the fields the session plan is built from. A plan refresh is worth
  // waiting for once one of them has moved -- on an untouched drawer the stored
  // end date is already the right answer, so blocking Save there would just stop
  // an unrelated edit (a rename, a colour) from saving at all.
  const sessionInputsTouched = String(sessionsNumber) !== String(baseline.current.sessionsNumber ?? '')
    || startDate !== String(baseline.current.startDate ?? '');

  const programmeOptions = useMemo(
    () => selectableProgrammes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [selectableProgrammes],
  );
  const availableCohorts = useMemo(
    () => cohortsForProgramme(cohorts, programmes, programmeId),
    [cohorts, programmeId, programmes],
  );
  const availableGroups = useMemo(
    () => groupsForScope(groups, cohorts, programmes, { programmeId, cohortId }),
    [cohortId, cohorts, groups, programmeId, programmes],
  );
  const selectedGroup = useMemo(
    () => groups.find(group => sameIdentifier(group.id, groupId)),
    [groupId, groups],
  );
  const selectedCohort = useMemo(
    () => cohorts.find(cohort => sameIdentifier(cohort.id, cohortId || selectedGroup?.cohortId)),
    [cohortId, cohorts, selectedGroup],
  );

  // The holidays that apply are the ones the parent cohort selected â€” the same
  // set the backend skips when it generates this module's session dates.
  const cohortHolidays = useMemo(() => {
    const ids = new Set((selectedCohort?.holidayIds || []).map(holidayId => normaliseKey(holidayId)));
    return holidays.filter(holiday => ids.has(normaliseKey(holiday.id)));
  }, [holidays, selectedCohort]);

  // The end date is the backend's own session-plan calculation, so what the
  // drawer shows cannot drift from what the save stores.
  const weekDays = cleanText(selectedGroup?.weekDays);
  // A group can deliver on more than one day a week (e.g. Mon + Wed), so the
  // number of calendar sessions is the weeks entered times how many delivery
  // days the group runs - not the weeks value on its own.
  const deliveryDaysPerWeek = weekDays ? weekDays.split(',').map(day => day.trim()).filter(Boolean).length : 0;
  const weeksEntered = Math.max(1, Number(sessionsNumber) || 1);
  const totalSessions = Math.round(weeksEntered * Math.max(1, deliveryDaysPerWeek));
  useEffect(() => {
    if (!open || !startDate) { setPlan(null); setPlanLoading(false); return undefined; }
    let active = true;
    setPlanLoading(true);
    const timer = setTimeout(() => {
      previewModuleSessionPlan({
        startDate,
        numberOfSessions: totalSessions,
        weekDays,
        holidays: cohortHolidays,
      })
        .then(result => { if (active) setPlan(result); })
        .catch(() => { if (active) setPlan(null); })
        .finally(() => { if (active) setPlanLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [cohortHolidays, open, totalSessions, startDate, weekDays]);

  // Save waits on this: the end date it would send is still the previous weeks
  // value until the debounced preview lands.
  const awaitingPlan = planLoading && sessionInputsTouched;
  const calculatedEndDate = plan?.finalEndDate || '';
  const manualEndDate = cleanText(targetEndDate);
  // Manual wins: the generated plan can suggest an end date, but the drawer is
  // allowed to store the date the user picked.
  const endDate = manualEndDate || calculatedEndDate || cleanText(module?.endDate);
  // Either what the date is made of, or the backend's own sentence naming what
  // is still missing before it can be calculated.
  const endDateHelper = endDate
    ? manualEndDate
      ? calculatedEndDate && calculatedEndDate !== manualEndDate
        ? `Set by hand. Generated sessions currently finish ${formatDateLabel(calculatedEndDate)}.`
        : 'Set by hand. Clear it to use the calculated date.'
      : `The last of ${totalSessions} session${totalSessions === 1 ? '' : 's'} across ${sessionsNumber} week${Number(sessionsNumber) === 1 ? '' : 's'}${weekDays ? ` on ${weekDays}` : ''}${cohortHolidays.length ? `, skipping ${cohortHolidays.length} holiday${cohortHolidays.length === 1 ? '' : 's'}` : ''}.`
    : plan?.warnings?.[0] || 'Set the start date, the weeks and the group delivery day to calculate it.';
  // The cohort's delivery window is the module's boundary, and the end date is
  // usually the generated plan's -- so this is checked on what the drawer will
  // actually send, not only on what was typed. Shown while the form is open and
  // enforced again on submit; the backend refuses the same three cases.
  // Split per field so each message lands on the date it is about; the two are
  // independent checks, so an out-of-window start does not hide a run-past end.
  const startDateError = moduleCohortDateError(selectedCohort, startDate, undefined);
  const endDateError = moduleCohortDateError(selectedCohort, undefined, endDate);
  const dateWindowError = startDateError || endDateError;
  const shiftedSessionCount = useMemo(
    () => (plan?.sessions || []).filter(session => session.skippedHolidays?.length).length,
    [plan],
  );
  const canOpenSessionPreview = Boolean(plan?.sessions?.length);

  // ==========================================================================
  // Tutor availability, asked while the tutor is still being picked.
  //
  // The save enforces the rule and always has. Finding out *from* the refusal is
  // the worst moment to find out: the form is filled in, Create has been pressed
  // and the choice was never going to work. So the same question is asked of the
  // same rule as soon as the slot can be dated, and the answer annotates the
  // picker rather than replacing the page with a sentence.
  //
  // The times come from the group, like the ones the save sends, and the cohort
  // holidays go with them -- they move the session dates, and a clash is about
  // the day a session actually runs on.
  // ==========================================================================
  const groupStartTime = cleanText(selectedGroup?.startTime);
  const groupEndTime = cleanText(selectedGroup?.endTime);
  const conflictSlot = useMemo(() => (
    startDate && weekDays && totalSessions > 0
      ? {
        startDate,
        sessionsNumber: totalSessions,
        weekDays,
        startTime: groupStartTime || undefined,
        endTime: groupEndTime || undefined,
        cohortId: cohortId || cleanText(selectedGroup?.cohortId) || undefined,
        holidays: cohortHolidays,
        // Editing: the module must not be reported as blocking its own slot.
        moduleCatalogueId: module?.id || undefined,
      }
      : null
  ), [cohortHolidays, cohortId, groupEndTime, groupStartTime, module?.id, selectedGroup?.cohortId, startDate, totalSessions, weekDays]);
  // Destructured rather than used through the hook's return value, which is a
  // fresh object every render: the memos below key off the parts that actually
  // move, so a keystroke in the name field does not rebuild the picker.
  const { verdictFor, bookable, sessionDates, loading: checkingTutors } = useTutorAvailability(
    conflictSlot,
    { enabled: open },
  );
  const tutorVerdict = verdictFor(tutor);
  const tutorClash = tutorVerdict && !tutorVerdict.available ? tutorVerdict : null;
  const tutorVerdicts = useMemo(
    () => tutorNames.map(tutorName => ({ tutorName, verdict: verdictFor(tutorName) })),
    // `verdictFor` closes over the roster, so it changes exactly when the answers
    // do -- which is the dependency this list has.
    [tutorNames, verdictFor],
  );
  // Named on the notice as one-click swaps, so the warning carries its own fix.
  const freeTutorNames = useMemo(() => (
    bookable
      ? tutorVerdicts.filter(item => item.verdict?.available).map(item => item.tutorName).slice(0, 4)
      : []
  ), [bookable, tutorVerdicts]);
  const tutorOptions = useMemo<SelectOption[]>(() => tutorVerdicts.map(({ tutorName, verdict }) => {
    if (!verdict || verdict.available) {
      return {
        value: tutorName,
        label: tutorName,
        // Only grouped once there is an answer to group by: headings over an
        // unchecked list would say "free" about names nobody has checked.
        group: bookable ? 'Free in this slot' : undefined,
      };
    }
    const clash = verdict.conflicts[0];
    const also = verdict.conflicts.length - 1;
    return {
      value: tutorName,
      label: tutorName,
      // The reason travels with the row: picking a busy name is still allowed --
      // the delivery day or the time may be what moves instead -- but not by
      // accident.
      description: `${clash.moduleName} ${clash.startTime}-${clash.endTime}${also > 0 ? ` +${also} more` : ''}`,
      meta: `${verdict.conflicts.reduce((count, item) => count + item.dates.length, 0)} clashes`,
      icon: 'ri-error-warning-line',
      group: 'Already teaching then',
    };
  }), [bookable, tutorVerdicts]);
  // The field says what it knows: which slot the names were checked against, or
  // what is still missing before anything can be checked. "Checked before it
  // saves" was the old promise, and it is now kept before the save, not by it.
  const tutorHint = checkingTutors
    ? 'Checking who is already teaching in this slot...'
    : bookable
      ? `Checked against ${sessionDates.length} session${sessionDates.length === 1 ? '' : 's'}${groupStartTime && groupEndTime ? ` at ${groupStartTime}-${groupEndTime}` : ''}.`
      : 'Set the group, the start date and the weeks to check who is free.';

  const changeProgramme = (value: string) => {
    setProgrammeId(value);
    setCohortId('');
    setGroupId('');
  };
  const changeCohort = (value: string) => {
    setCohortId(value);
    setGroupId('');
    const cohort = cohorts.find(item => sameIdentifier(item.id, value));
    // Only seeds an empty field: a date the user already picked stays put.
    if (!startDate && cohort?.startDate) setStartDate(cohort.startDate);
  };
  const changeGroup = (value: string) => {
    setGroupId(value);
    const group = groups.find(item => sameIdentifier(item.id, value));
    if (group?.cohortId && !cohortId) setCohortId(group.cohortId);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the module a name.'); return; }
    if (!module && !programmeId && !groupId) { setError('Choose the programme this module belongs to.'); return; }
    if (dateWindowError) {
      console.log('[TEMP-DEBUG moduleForm] blocked by dateWindowError', dateWindowError, { startDate, endDate, selectedCohort });
      setError(dateWindowError); return;
    }
    // Pre-empted rather than sent: the save enforces this and would refuse, so
    // firing it only trades an instant answer for a round-trip and the same
    // refusal. The clash itself is spelled out under the Tutor field, so this is
    // the pointer to it rather than a second copy of it.
    if (tutorClash) {
      setError(
        `${tutorClash.tutor} is already teaching in this slot. Change the tutor, the delivery day or the time - the clashing sessions are listed under Tutor.`,
      );
      return;
    }
    if (awaitingPlan) return;
    const weeks = Math.max(1, Math.round(Number(sessionsNumber) || 1));
    const sessions = totalSessions;

    const programme = programmes.find(item => sameIdentifier(programmeIdentity(item), programmeId))
      || programmes.find(item => sameIdentifier(item.name, programmeId));

    setSaving(true);
    setError(null);
    try {
      if (module) {
        const patchPayload = {
          name: trimmed,
          notes: description,
          status,
          color,
          // The two counts are sent apart, because they mean different things and
          // different features read them: `weeks` is what the week builder
          // authors and what the catalogue shows as "N weeks"; `sessionsNumber`
          // is the calendar total (weeks x the group's delivery days) that the
          // session dates, the tutor conflict check and the Teams series run on.
          sessionsNumber: sessions,
          weeks,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          tutor,
          programmeId: programme ? programmeIdentity(programme) : programmeId || undefined,
          programmeName: programme?.name || undefined,
          cohortId: cohortId || undefined,
          cohortName: selectedCohort?.name || undefined,
          groupId: groupId || undefined,
          groupName: selectedGroup?.name || undefined,
          weekDays: weekDays || undefined,
          startTime: cleanText(selectedGroup?.startTime) || undefined,
          endTime: cleanText(selectedGroup?.endTime) || undefined,
        };
        console.log('[TEMP-DEBUG moduleForm] baseline at open', baseline.current);
        console.log('[TEMP-DEBUG moduleForm] current form state', { name, programmeId, cohortId, groupId, sessionsNumber, startDate, targetEndDate, endDate, tutor, status, description, color });
        console.log('[TEMP-DEBUG moduleForm] PATCH module.id =', module.id, 'payload =', patchPayload);
        // The PATCH merges onto the stored structure, so only what this form
        // owns is sent: the weeks, components and KSB mappings authored in the
        // Module Builder are left exactly as they are.
        const patchResult = await updateCurriculumModule(module.id, patchPayload);
        console.log('[TEMP-DEBUG moduleForm] PATCH response =', patchResult);
        // The caller's refresh runs BEFORE the drawer closes, so `saving` keeps the
        // spinner up and the buttons dimmed until the list actually holds the new
        // numbers. Closing first left a window -- as long as the round-trip, which
        // is seconds on a slow connection -- where reopening the drawer offered the
        // pre-save weeks and saving again wrote them straight back.
        await onSaved({ catalogueId: module.id, name: trimmed, created: false });
        console.log('[TEMP-DEBUG moduleForm] onSaved() resolved for', module.id);
        onClose();
        await showCurriculumAlert({ title: 'Module updated', text: `${trimmed} is saved.`, timer: 1800 });
        return;
      }

      if (groupId) {
        // Attaching to a group is the endpoint that owns the delivery rules:
        // cohort date bounds, the session plan and the tutor conflict check.
        const result = await createGroupModule(groupId, {
          moduleName: trimmed,
          programmeId: programme ? programmeIdentity(programme) : programmeId,
          cohortId: cohortId || selectedGroup?.cohortId,
          groupId,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          sessionsNumber: sessions,
          weeks,
          tutor: tutor || undefined,
          weekDays: weekDays || undefined,
          startTime: cleanText(selectedGroup?.startTime) || undefined,
          endTime: cleanText(selectedGroup?.endTime) || undefined,
          color,
          notes: description,
          holidays: cohortHolidays,
        }) as { created?: Array<Record<string, unknown>>; updatedModules?: Array<Record<string, unknown>> };
        const saved = (result.created || [])[0] || (result.updatedModules || [])[0] || {};
        const catalogueId = String(
          saved.moduleCatalogueId || saved.catalogueId || saved.structureId || saved.id || '',
        );
        onClose();
        await onSaved({ catalogueId, name: trimmed, created: true });
        return;
      }

      // No group yet: a catalogue draft. It still carries the programme (and the
      // cohort when one was chosen) so it is findable, and it can be placed in a
      // group from this same drawer later.
      const created = await createNewModule({
        title: trimmed,
        description,
        programme: programme?.name || programmeId || 'Unassigned programme',
        programmeId: programme ? programmeIdentity(programme) : programmeId,
        cohortId: cohortId || '',
        cohortName: selectedCohort?.name || '',
        weeks,
        sessionsNumber: sessions,
        startDate: startDate || '',
        endDate: endDate || '',
        status: 'draft',
      });
      onClose();
      await onSaved({ catalogueId: created.catalogueId || created.id, name: trimmed, created: true });
    } catch (err) {
      console.log('[TEMP-DEBUG moduleForm] submit() threw', err);
      // A tutor already booked in that slot is reported by the backend as a
      // sentence worth showing verbatim.
      setError(tutorConflictMessage(err) || (err instanceof Error ? err.message : 'The module could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  const placementHint = groupId
    ? 'Saved against this group, with its delivery days and holidays.'
    : cohortId
      ? 'Saved against this cohort. Pick a group to give it delivery dates and a tutor.'
      : 'No group yet - the module is created as a catalogue draft.';

  return (
    <EntityDrawer
      open={open}
      title={module ? 'Edit module' : 'Add module'}
      subtitle={module
        ? 'Placement, dates and tutor. Weeks and components stay in the Module Builder.'
        : 'Where the module lives and when it runs. Weeks and components are authored next, in the Module Builder.'}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={module ? 'Save module' : 'Create module'}
      width="w-[760px]"
      saving={saving || awaitingPlan}
      error={error}
      dirty={dirty}
    >
      {!lockGroup && (
        <>
          <FormField label="Programme" required={!module} hint="Filters the cohorts and groups below.">
            <SelectControl
              value={programmeId}
              onChange={changeProgramme}
              options={programmeOptions}
              placeholder="Select a programme"
            />
          </FormField>
          <FormField label="Cohort" hint="Narrows the groups and seeds the start date.">
            <SelectControl
              value={cohortId}
              onChange={changeCohort}
              options={availableCohorts.map(cohort => ({ value: cohort.id, label: cohort.name }))}
              placeholder={availableCohorts.length ? 'No cohort yet' : 'No cohorts for this programme'}
            />
          </FormField>
          <FormField label="Group" hint={placementHint}>
            <SelectControl
              value={groupId}
              onChange={changeGroup}
              options={availableGroups.map(group => ({ value: group.id, label: group.name }))}
              placeholder={availableGroups.length ? 'No group yet' : 'No groups for this cohort'}
            />
          </FormField>
        </>
      )}
      <FormField label="Module name" required>
        <TextControl value={name} onChange={setName} placeholder="e.g. Data Modelling" />
      </FormField>
      <FormField
        label="Weeks"
        hint={
          deliveryDaysPerWeek > 1
            ? `= ${totalSessions} sessions (${deliveryDaysPerWeek} delivery days x ${sessionsNumber || 1} weeks). Each week is authored in the Module Builder.`
            : 'How long the module runs. Each week is authored in the Module Builder.'
        }
      >
        <TextControl type="number" min={1} max={104} value={sessionsNumber} onChange={setSessionsNumber} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <DatePickerField
          label="Start date"
          value={startDate}
          onChange={setStartDate}
          min={selectedCohort?.startDate || undefined}
          max={selectedCohort?.practicalEndDate || selectedCohort?.endDate || undefined}
          error={startDateError || undefined}
          helper={selectedCohort ? `Within ${formatDateLabel(selectedCohort.startDate)} - ${formatDateLabel(selectedCohort.practicalEndDate || selectedCohort.endDate)}` : undefined}
        />
        <DatePickerField
          label="End date"
          value={endDate}
          onChange={setTargetEndDate}
          min={startDate || selectedCohort?.startDate || undefined}
          max={selectedCohort?.practicalEndDate || selectedCohort?.endDate || undefined}
          placeholder="Calculated or target"
          error={endDateError || undefined}
          helper={endDateHelper}
        />
      </div>
      <div className="rounded-lg border border-background-200 bg-background-50 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground-400">Session dates</p>
            <p className="mt-1 text-[12px] leading-5 text-foreground-500">
              {canOpenSessionPreview
                ? `${plan?.sessions.length || 0} planned session${(plan?.sessions.length || 0) === 1 ? '' : 's'}${shiftedSessionCount ? `, ${shiftedSessionCount} shifted by holidays` : ', no holiday shifts'}.`
                : plan?.warnings?.[0] || 'Choose a group delivery day and start date to preview the sessions.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSessionPreviewOpen(true)}
            disabled={!canOpenSessionPreview}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-3 text-[12px] font-bold text-primary-700 transition-smooth hover:bg-primary-100 disabled:cursor-not-allowed disabled:border-background-200 disabled:bg-background-100 disabled:text-foreground-300"
          >
            <AppIcon className="ri-calendar-schedule-line text-sm"></AppIcon>
            View sessions
          </button>
        </div>
      </div>
      <FormField label="Tutor" hint={tutorHint}>
        <SelectControl
          value={tutor}
          onChange={setTutor}
          options={tutorOptions}
          placeholder="Unassigned"
        />
      </FormField>
      {tutorClash && (
        <TutorClashNotice
          verdict={tutorClash}
          sessionDates={sessionDates}
          freeTutors={freeTutorNames}
          onPickTutor={setTutor}
        />
      )}
      <FormField label="Notes">
        <TextAreaControl value={description} onChange={setDescription} placeholder="Optional delivery notes" />
      </FormField>
      <FormField label="Colour">
        <ColorControl value={color} onChange={setColor} />
      </FormField>
      {sessionPreviewOpen && plan && (
        <ModuleSessionPreviewModal
          moduleName={name || module?.name || 'Module'}
          plan={plan}
          holidays={cohortHolidays}
          onClose={() => setSessionPreviewOpen(false)}
        />
      )}
    </EntityDrawer>
  );
}

/** One row of the session preview timeline: a normal session, a session a holiday blocked, or that session's replacement date. */
type SessionTimelineEntry =
  | { kind: 'session'; date: string; day: string; sessionNumber: number }
  | { kind: 'blocked'; date: string; sessionNumber: number; holidayNames: string[]; replacementDate: string }
  | { kind: 'replacement'; date: string; day: string; sessionNumber: number };

function monthKeyOf(value: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(String(value || '').trim());
  return match ? `${match[1]}-${match[2]}` : '';
}

function monthLabelOf(key: string): string {
  const parsed = new Date(`${key}-01T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return key;
  return parsed.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function ModuleSessionPreviewModal({
  moduleName,
  plan,
  holidays,
  onClose,
}: {
  moduleName: string;
  plan: CurriculumSessionPlanPreview;
  holidays: CurriculumHoliday[];
  onClose: () => void;
}) {
  const shifted = plan.sessions.filter(session => session.skippedHolidays?.length);
  const holidayLabel = (date: string) => {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return 'Selected holiday';
    const match = holidays.find(holiday => {
      const start = new Date(holiday.startDate);
      const end = new Date(holiday.endDate || holiday.startDate);
      return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= value && value <= end;
    });
    return match?.label || 'Selected holiday';
  };

  const entries: SessionTimelineEntry[] = [];
  plan.sessions.forEach(session => {
    const skippedDates = session.skippedHolidays || [];
    if (skippedDates.length) {
      entries.push({
        kind: 'blocked',
        date: skippedDates[0],
        sessionNumber: session.sessionNumber,
        holidayNames: Array.from(new Set(skippedDates.map(holidayLabel))),
        replacementDate: session.date,
      });
      entries.push({ kind: 'replacement', date: session.date, day: session.day, sessionNumber: session.sessionNumber });
    } else {
      entries.push({ kind: 'session', date: session.date, day: session.day, sessionNumber: session.sessionNumber });
    }
  });
  entries.sort((a, b) => a.date.localeCompare(b.date));

  const monthGroups: Array<{ key: string; label: string; entries: SessionTimelineEntry[] }> = [];
  entries.forEach(entry => {
    const key = monthKeyOf(entry.date);
    const current = monthGroups[monthGroups.length - 1];
    if (current && current.key === key) {
      current.entries.push(entry);
      return;
    }
    monthGroups.push({ key, label: monthLabelOf(key), entries: [entry] });
  });

  const holidaysForMonth = (key: string) => {
    const [yearText, monthText] = key.split('-');
    const year = Number(yearText);
    const month = Number(monthText) - 1;
    if (Number.isNaN(year) || Number.isNaN(month)) return [];
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    return holidays.filter(holiday => {
      const start = new Date(holiday.startDate);
      const end = new Date(holiday.endDate || holiday.startDate);
      return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= monthEnd && end >= monthStart;
    });
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="module-session-preview-title"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-background-50 shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-background-200 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Module sessions</p>
            <h2 id="module-session-preview-title" className="mt-1 text-lg font-heading font-bold text-foreground-900">
              {moduleName}
            </h2>
            <p className="mt-1 text-[12px] text-foreground-500">
              {plan.sessions.length} session{plan.sessions.length === 1 ? '' : 's'} planned. Final date {formatDateLabel(plan.finalEndDate)}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close session preview"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground-500 transition-smooth hover:bg-background-100 hover:text-foreground-900"
          >
            <AppIcon className="ri-close-line text-lg"></AppIcon>
          </button>
        </div>
        {shifted.length > 0 && (
          <div className="flex shrink-0 items-start gap-2 border-b border-amber-200 bg-amber-50 px-5 py-3 text-[12px] font-semibold text-amber-800">
            <AppIcon className="ri-alert-line mt-0.5 shrink-0 text-sm"></AppIcon>
            <span>
              {shifted.length} planned session{shifted.length === 1 ? ' was' : 's were'} skipped on holiday weeks. Counted sessions
              stay at {plan.sessions.length}; delivery now ends on {formatDateLabel(plan.finalEndDate)}.
            </span>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {monthGroups.map(group => {
            const delivered = group.entries.filter(entry => entry.kind !== 'blocked').length;
            const skippedCount = group.entries.filter(entry => entry.kind === 'blocked').length;
            const monthHolidays = group.key ? holidaysForMonth(group.key) : [];
            return (
              <div key={group.key || 'unscheduled'} className="flex flex-col gap-3 border-b border-background-200 py-4 last:border-b-0 sm:flex-row">
                <div className="w-full shrink-0 sm:w-32">
                  <p className="text-[13px] font-heading font-bold text-foreground-900">{group.label}</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-400">
                    {delivered} delivered
                  </p>
                  {skippedCount > 0 && (
                    <p className="text-[11px] font-semibold text-red-600">{skippedCount} skipped</p>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {group.entries.map((entry, index) => {
                    if (entry.kind === 'blocked') {
                      return (
                        <div key={`${entry.sessionNumber}-blocked-${index}`} className="overflow-hidden rounded-lg border border-red-200 bg-red-50">
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                            <span className="flex items-center gap-2 text-[12px]">
                              <AppIcon className="ri-close-circle-fill shrink-0 text-sm text-red-600"></AppIcon>
                              <span className="font-bold text-red-700">{formatDateLabel(entry.date)}</span>
                              <span className="italic text-foreground-400">Not named yet</span>
                            </span>
                            <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                              Shifted to replacement
                            </span>
                          </div>
                          <div className="border-t border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] font-medium text-red-700">
                            Blocked by {entry.holidayNames.join(', ')}; replacement scheduled on {formatDateLabel(entry.replacementDate)}.
                          </div>
                        </div>
                      );
                    }
                    const isReplacement = entry.kind === 'replacement';
                    return (
                      <div
                        key={`${entry.sessionNumber}-${entry.kind}`}
                        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[12px] ${
                          isReplacement ? 'border-emerald-200 bg-emerald-50' : 'border-background-200 bg-background-0'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`font-bold ${isReplacement ? 'text-emerald-700' : 'text-foreground-900'}`}>
                            {formatDateLabel(entry.date)}
                          </span>
                          <span className="text-foreground-400">({entry.day})</span>
                          <span className="italic text-foreground-400">Not named yet</span>
                        </span>
                        {isReplacement && (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                            Replacement delivered
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="w-full shrink-0 space-y-1 sm:w-56">
                  {monthHolidays.map(holiday => (
                    <p key={holiday.id} className="text-[11px] leading-5 text-foreground-500">
                      <span className="font-semibold text-foreground-700">{holiday.label}</span>
                      {holiday.type && <span className="text-foreground-400"> ({holiday.type})</span>}
                      <br />
                      {formatDateLabel(holiday.startDate)} - {formatDateLabel(holiday.endDate || holiday.startDate)}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
          {plan.warnings.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700">
              {plan.warnings.join(' ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
