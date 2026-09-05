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
  isTutorConflictError,
  previewModuleSessionPlan,
  tutorConflictMessage,
  updateCurriculumModule,
  type CurriculumGroup,
  type CurriculumCohort,
  type CurriculumHoliday,
  type CurriculumModule,
  type CurriculumProgramme,
  type CurriculumSessionPlanPreview,
} from '@/lib/curriculumApi';
import type { SelectOption } from '@/components/feature/SelectField';
import { createNewModule, liveSessionNamesByNumber, loadModuleStructure } from '../../module-builder/moduleAuthoringData';
import {
  cleanText,
  cohortsForProgramme,
  formatDateLabel,
  groupsForScope,
  moduleCohortDateError,
  normaliseKey,
  programmeIdentity,
  programmeSelectValue,
  sameFormValues,
  sameIdentifier,
  visibleNotes,
  weekendDateNotice,
} from './model';
import {
  ColorControl,
  CoverImageControl,
  EntityDrawer,
  FormField,
  MultiSelectControl,
  SelectControl,
  TextAreaControl,
  TextControl,
  type FormChainStep,
  type MultiSelectOption,
} from './ui';
import { useFormSeedGuard } from './useDrawerState';

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
  /** The stored cover image: a URL, or a data: URL for an uploaded file. */
  coverImage?: string;
  deliveryUsages?: ModuleFormDeliveryRef[];
}

/**
 * A saved module reduced to what this form reads, so re-opening it edits the
 * record rather than starting a second one. It lives here, beside the shape it
 * builds, because every door onto this form needs it — the structure wizard
 * stepping back to its module step, and a programme workspace opening one of
 * its module rows.
 */
export function moduleFormTarget(module: CurriculumModule | undefined | null): ModuleFormTarget | null {
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
    coverImage: module.coverImage,
  };
}

/** What a successful save hands back, so the caller can go straight to the module. */
export interface SavedModuleRef {
  catalogueId: string;
  name: string;
  created: boolean;
  /**
   * Where this save actually placed the module. A caller driving a chain (the
   * structure wizard) needs it: the parent may have been picked in this form
   * rather than created by an earlier step, and only the form knows which.
   */
  programmeId?: string;
  programmeName?: string;
  cohortId?: string;
  cohortName?: string;
  /** Every group the module was placed in — one module regularly runs for several. */
  groupIds?: string[];
  groupNames?: string[];
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
  chain,
  onClose,
  onSaved,
  onSavingChange,
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
  /** Set when the structure wizard is driving this form as one step of a chain. */
  chain?: FormChainStep;
  onClose: () => void;
  onSaved: (saved: SavedModuleRef) => unknown | Promise<unknown>;
  /** Lets the owning table keep its progress line visible for the whole save. */
  onSavingChange?: (saving: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [cohortId, setCohortId] = useState('');
  // Which groups this save places the module in. The same module is regularly
  // taught to more than one group of a cohort, and each group needs a delivery of
  // its own -- its own session dates off its own delivery days, its own tutor
  // booking -- so this is a list rather than the single choice it used to be.
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [sessionsNumber, setSessionsNumber] = useState('1');
  const [startDate, setStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [tutor, setTutor] = useState('');
  const [status, setStatus] = useState('draft');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#2563eb');
  // Optional module artwork. Either a pasted URL or a data: URL read off the
  // picked file -- the same two shapes a free course's cover takes, stored on
  // the module row rather than uploaded anywhere.
  const [coverImage, setCoverImage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A group whose attach was refused for a tutor double-booking, offered a
  // one-click override rather than a dead end: two deliveries of the same
  // module really can share a tutor (a co-taught slot), and the backend
  // already accepts `allowTutorConflict` for exactly that -- this is just the
  // first screen that surfaces it instead of stopping at the 409.
  const [tutorConflictGroup, setTutorConflictGroup] = useState<{ groupId: string; groupName: string } | null>(null);
  // Groups already attached (or explicitly overridden) in this submit session,
  // so retrying after "Book anyway" does not re-create the ones that already
  // succeeded before the refusal.
  const attachedThisSession = useRef<Set<string>>(new Set());
  const overrideGroupIds = useRef<Set<string>>(new Set());
  // The first group's catalogue id from a create-path run, kept across a
  // "Book anyway" retry so the later groups attach to the same module rather
  // than each minting their own.
  const createdCatalogueId = useRef('');
  const [plan, setPlan] = useState<CurriculumSessionPlanPreview | null>(null);
  // The inputs `plan` was fetched for. A plan whose key no longer matches the
  // form is stale, and the locally projected end date is used instead of it.
  const [planFor, setPlanFor] = useState('');
  // True while the debounced session-plan preview is in flight. It no longer
  // holds the save back: the end date is projected locally the moment the weeks
  // or the start date move, so a save can never carry the previous value's date.
  const [planLoading, setPlanLoading] = useState(false);
  const [sessionPreviewOpen, setSessionPreviewOpen] = useState(false);
  // Closed on a genuine open/close or a different module only -- never on the
  // main seeding effect below, which also re-fires on a clean background
  // refresh (a new `module` object identity with the same content). Sharing
  // that reset used to yank the preview shut, and its session-names fetch,
  // mid-flight; nothing then reopened it, so the names stayed "loading" forever.
  useEffect(() => {
    setSessionPreviewOpen(false);
  }, [open, cleanText(module?.id)]);
  // What the drawer opened with, for the unsaved-changes check below.
  const baseline = useRef<Record<string, unknown>>({});
  const selectableProgrammes = useMemo(
    () => programmes.filter(isSelectableProgramme),
    [programmes],
  );

  // The structure wizard drives this same form as the last step of its chain.
  const chained = Boolean(chain?.chained);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [onSavingChange, saving]);

  const dirty = !sameFormValues(
    { name, programmeId, cohortId, groupIds, sessionsNumber, startDate, targetEndDate, tutor, status, description, color, coverImage },
    baseline.current,
  );
  // The seeding effect below has to depend on `groups`, `cohorts` and
  // `programmes` to resolve the module's parent chain, and those arrays get a new
  // identity whenever the page refreshes them -- the Module Builder in particular
  // fetches its picker scope *after* this drawer is already open. Re-seeding then
  // wiped whatever had been chosen. See useFormSeedGuard.
  const allowSeed = useFormSeedGuard(dirty);

  // The delivery this drawer owns when editing: the module row's own group. It
  // stays the one a PATCH moves; every other ticked group gets its own delivery.
  const ownGroupId = cleanText(module?.groupId) || cleanText(module?.deliveryUsages?.[0]?.groupId);
  // Groups this module already runs for through another delivery. They are shown
  // ticked and locked -- re-sending them would overwrite that delivery's own
  // tutor and dates with this form's.
  const attachedGroupIds = useMemo(() => {
    const seen = new Set<string>();
    (module?.deliveryUsages || []).forEach(usage => {
      const id = cleanText(usage.groupId);
      if (id && !sameIdentifier(id, ownGroupId)) seen.add(id);
    });
    return Array.from(seen);
  }, [module?.deliveryUsages, ownGroupId]);

  useEffect(() => {
    if (!allowSeed(open, cleanText(module?.id) || 'new-module')) return;
    setError(null);
    setSaving(false);
    setPlan(null);
    setPlanFor('');
    setTutorConflictGroup(null);
    attachedThisSession.current = new Set();
    overrideGroupIds.current = new Set();
    createdCatalogueId.current = '';

    const storedDelivery = module?.deliveryUsages?.[0];
    const parentGroup = groups.find(group => (
      sameIdentifier(group.id, module?.groupId || storedDelivery?.groupId || defaults?.groupId)
      || sameIdentifier(group.name, storedDelivery?.group)
    ));
    const parentCohort = cohorts.find(cohort => (
      sameIdentifier(cohort.id, module?.cohortId || storedDelivery?.cohortId || parentGroup?.cohortId || defaults?.cohortId)
      || sameIdentifier(cohort.name, storedDelivery?.cohort)
    ));
    // Snapped onto the option values with programmeSelectValue: every source
    // below names the programme in whatever shape wrote it, and a <select>
    // matches by exact string. See the helper for what that used to cost.
    const resolvedProgrammeId = programmeSelectValue(
      selectableProgrammes,
      cleanText(parentCohort?.programmeId)
        || cleanText(parentGroup?.programmeId)
        || cleanText(module?.programmeId)
        || cleanText(storedDelivery?.programmeId)
        || cleanText(module?.programme)
        || cleanText(storedDelivery?.programme)
        || defaults?.programmeId,
    ) || (selectableProgrammes.length === 1 ? programmeIdentity(selectableProgrammes[0]) : '');

    const directTutor = cleanText(module?.tutor);
    const storedTutor = normaliseKey(directTutor) === UNASSIGNED
      ? cleanText(storedDelivery?.tutor)
      : directTutor || cleanText(storedDelivery?.tutor);
    const initial = {
      name: cleanText(module?.name),
      programmeId: resolvedProgrammeId,
      cohortId: cleanText(parentCohort?.id) || cleanText(module?.cohortId) || cleanText(storedDelivery?.cohortId) || defaults?.cohortId || '',
      // The module's own group first: `primaryGroupId` below reads position 0 as
      // the delivery a PATCH belongs to when nothing more specific matches.
      groupIds: Array.from(new Set([
        cleanText(parentGroup?.id) || cleanText(module?.groupId) || cleanText(storedDelivery?.groupId) || defaults?.groupId || '',
        ...attachedGroupIds,
      ].filter(Boolean))),
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
      coverImage: cleanText(module?.coverImage),
    };
    baseline.current = initial;
    console.log('[TEMP-DEBUG moduleForm] drawer (re)initialised. module prop =', module, 'initial state =', initial);
    setName(initial.name);
    setProgrammeId(initial.programmeId);
    setCohortId(initial.cohortId);
    setGroupIds(initial.groupIds);
    setSessionsNumber(initial.sessionsNumber);
    setStartDate(initial.startDate);
    setTargetEndDate(initial.targetEndDate);
    setTutor(initial.tutor);
    setStatus(initial.status);
    setDescription(initial.description);
    setColor(initial.color);
    setCoverImage(initial.coverImage);
  }, [allowSeed, attachedGroupIds, cohorts, defaults?.cohortId, defaults?.groupId, defaults?.programmeId, groups, module, open, selectableProgrammes]);

  const programmeOptions = useMemo(
    () => selectableProgrammes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [selectableProgrammes],
  );
  const availableCohorts = useMemo(
    () => cohortsForProgramme(cohorts, programmes, programmeId),
    [cohorts, programmeId, programmes],
  );
  // The cohort is what makes this list answerable: a group carries its cohort's
  // dates and holidays, so the placement only means something once the cohort is
  // named. `groupsForScope` would answer a programme-only scope with every group
  // under it -- right for a filter toolbar reading "All cohorts", wrong for a
  // picker where ticking one of them would place the module in a cohort the form
  // above has not chosen.
  const availableGroups = useMemo(
    () => (cohortId ? groupsForScope(groups, cohorts, programmes, { programmeId, cohortId }) : []),
    [cohortId, cohorts, groups, programmeId, programmes],
  );
  // The delivery the previews, the tutor check and (when editing) the PATCH are
  // about. Every other ticked group gets its own delivery on save, generated from
  // its own delivery days by the backend.
  const primaryGroupId = useMemo(
    () => groupIds.find(id => sameIdentifier(id, ownGroupId)) || groupIds[0] || '',
    [groupIds, ownGroupId],
  );
  const selectedGroups = useMemo(
    () => groupIds
      .map(id => groups.find(group => sameIdentifier(group.id, id)))
      .filter((group): group is CurriculumGroup => Boolean(group)),
    [groupIds, groups],
  );
  const selectedGroup = useMemo(
    () => groups.find(group => sameIdentifier(group.id, primaryGroupId)),
    [groups, primaryGroupId],
  );
  const selectedCohort = useMemo(
    () => cohorts.find(cohort => sameIdentifier(cohort.id, cohortId || selectedGroup?.cohortId)),
    [cohortId, cohorts, selectedGroup],
  );
  // Every cohort the ticked groups belong to. Usually one; the date window is
  // checked against all of them, because a module placed in two cohorts has to
  // fit inside both.
  const selectedCohorts = useMemo(() => {
    const seen = new Map<string, CurriculumCohort>();
    selectedGroups.forEach(group => {
      const cohort = cohorts.find(item => sameIdentifier(item.id, group.cohortId));
      if (cohort) seen.set(normaliseKey(cohort.id), cohort);
    });
    if (!seen.size && selectedCohort) seen.set(normaliseKey(selectedCohort.id), selectedCohort);
    return Array.from(seen.values());
  }, [cohorts, selectedCohort, selectedGroups]);

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
  // Everything the plan is built from, in one string: what the preview in state
  // was fetched for is compared against it below, so a plan left over from the
  // previous weeks value is never read as this one's answer.
  const planInputs = useMemo(
    () => JSON.stringify([startDate, totalSessions, weekDays, cohortHolidays.map(holiday => holiday.id)]),
    [cohortHolidays, startDate, totalSessions, weekDays],
  );
  useEffect(() => {
    if (!open || !startDate) { setPlan(null); setPlanFor(''); setPlanLoading(false); return undefined; }
    let active = true;
    setPlanLoading(true);
    const timer = setTimeout(() => {
      previewModuleSessionPlan({
        startDate,
        numberOfSessions: totalSessions,
        weekDays,
        holidays: cohortHolidays,
      })
        .then(result => { if (active) { setPlan(result); setPlanFor(planInputs); } })
        .catch(() => { if (active) { setPlan(null); setPlanFor(''); } })
        .finally(() => { if (active) setPlanLoading(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [cohortHolidays, open, planInputs, totalSessions, startDate, weekDays]);

  // The same walk the backend does, run here so the End date moves on the very
  // keystroke that changed the weeks or the start date instead of 300ms later
  // when the debounced preview lands. The server's own plan still wins the
  // moment it arrives -- this only fills the gap the debounce used to leave
  // blank (or, worse, filled with the previous weeks value's answer).
  const projectedEndDate = useMemo(
    () => projectModuleEndDate(startDate, totalSessions, weekDays, cohortHolidays),
    [cohortHolidays, startDate, totalSessions, weekDays],
  );
  const planIsCurrent = Boolean(plan) && planFor === planInputs;
  const calculatedEndDate = (planIsCurrent ? plan?.finalEndDate : '') || projectedEndDate || '';
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
        : 'Set by hand. The weeks above were counted from it; change the weeks to recalculate the date instead.'
      : `The last of ${totalSessions} session${totalSessions === 1 ? '' : 's'} across ${sessionsNumber} week${Number(sessionsNumber) === 1 ? '' : 's'}${weekDays ? ` on ${weekDays}` : ''}${cohortHolidays.length ? `, skipping ${cohortHolidays.length} holiday${cohortHolidays.length === 1 ? '' : 's'}` : ''}.`
    : plan?.warnings?.[0] || 'Set the start date, the weeks and the group delivery day to calculate it.';
  // The cohort's delivery window is the module's boundary, and the end date is
  // usually the generated plan's -- so this is checked on what the drawer will
  // actually send, not only on what was typed. Shown while the form is open and
  // enforced again on submit; the backend refuses the same three cases.
  // Split per field so each message lands on the date it is about; the two are
  // independent checks, so an out-of-window start does not hide a run-past end.
  const startDateError = selectedCohorts.length
    ? selectedCohorts.map(cohort => moduleCohortDateError(cohort, startDate, undefined)).find(Boolean) || null
    : moduleCohortDateError(selectedCohort, startDate, undefined);
  const endDateError = selectedCohorts.length
    ? selectedCohorts.map(cohort => moduleCohortDateError(cohort, undefined, endDate)).find(Boolean) || null
    : moduleCohortDateError(selectedCohort, undefined, endDate);
  const dateWindowError = startDateError || endDateError;
  // Not a refusal -- a weekend or bank-holiday start is still saved -- just a
  // heads-up, since the module will not actually deliver on that day.
  const startDateNotice = useMemo(() => describeNonDeliveryDate(startDate, cohortHolidays), [startDate, cohortHolidays]);
  const shiftedSessionCount = useMemo(
    () => (plan?.sessions || []).filter(session => session.skippedHolidays?.length).length,
    [plan],
  );
  const canOpenSessionPreview = Boolean(plan?.sessions?.length);

  // A planned date is only half of a session; the other half is what is taught
  // on it, which lives on the week's live-session component. The dates come
  // from the plan preview, which knows nothing about this module, so the names
  // are read from the module's authored weeks and matched by session number.
  //
  // Asked for when the preview is opened rather than when the drawer is: every
  // other field here is editable without it, and the structure read is the
  // module's whole authoring payload.
  const moduleCatalogueId = cleanText(module?.id);
  const [sessionNames, setSessionNames] = useState<Array<string | null>>([]);
  const [sessionNamesLoading, setSessionNamesLoading] = useState(false);
  // A failed read is not an unauthored week: the timeline has to say the names
  // could not be read rather than report every session as missing one.
  const [sessionNamesError, setSessionNamesError] = useState(false);
  // Which module has already been asked for, held in a ref rather than in state
  // on purpose. As state it had to be a dependency of the effect below, and the
  // effect's own success set it -- so the re-render that followed re-ran the
  // effect, and the cleanup marked the still-settling request stale before the
  // handler that clears `sessionNamesLoading` had run. The flag stayed true and
  // every row read "Reading the weeks..." for good. A ref keeps the effect's
  // dependencies to things the effect does not itself write.
  const sessionNamesRequestedFor = useRef('');
  useEffect(() => {
    if (!sessionPreviewOpen || !moduleCatalogueId) return undefined;
    if (sessionNamesRequestedFor.current === moduleCatalogueId) return undefined;
    sessionNamesRequestedFor.current = moduleCatalogueId;
    let active = true;
    setSessionNamesLoading(true);
    setSessionNamesError(false);
    loadModuleStructure(moduleCatalogueId)
      .then(structure => {
        if (!active) return;
        setSessionNames(liveSessionNamesByNumber(structure));
        setSessionNamesLoading(false);
      })
      .catch(() => {
        if (!active) return;
        // Cleared so re-opening the preview asks again: a failed read is worth
        // retrying, an answered one is not.
        sessionNamesRequestedFor.current = '';
        setSessionNames([]);
        setSessionNamesError(true);
        setSessionNamesLoading(false);
      });
    return () => { active = false; };
  }, [moduleCatalogueId, sessionPreviewOpen]);

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
    setGroupIds([]);
  };
  // Weeks and dates are two views of the same span, and either one can be the
  // one the user knows: a module planned as "eight weeks from the 3rd" is typed
  // as weeks, one contracted to finish on a fixed date is typed as dates. So the
  // drawer solves for whichever field was not just touched.
  //
  //   * weeks moved      -> the end date is recalculated (the manual one drops);
  //   * end date moved   -> the weeks are recalculated from start -> end;
  //   * start date moved -> with an end date held by hand, the weeks are
  //                         recalculated and that end date stays put; with none,
  //                         the end date is recalculated from the weeks as before.
  const weeksBetweenDates = (from: string, to: string) => (
    projectModuleWeeks(from, to, weekDays, cohortHolidays, deliveryDaysPerWeek)
  );
  const changeStartDate = (value: string) => {
    setStartDate(value);
    const held = cleanText(targetEndDate);
    const recalculated = held ? weeksBetweenDates(value, held) : 0;
    // Only when the span is still readable forwards: a start date dragged past
    // the end date has no week count, and clearing the end date is the honest
    // answer rather than inventing one.
    if (recalculated > 0) setSessionsNumber(String(recalculated));
    else setTargetEndDate('');
  };
  const changeWeeks = (value: string) => {
    setSessionsNumber(value);
    setTargetEndDate('');
  };
  const changeEndDate = (value: string) => {
    setTargetEndDate(value);
    const recalculated = weeksBetweenDates(startDate, value);
    if (recalculated > 0) setSessionsNumber(String(recalculated));
  };
  const changeCohort = (value: string) => {
    setCohortId(value);
    setGroupIds([]);
    const cohort = cohorts.find(item => sameIdentifier(item.id, value));
    // Only seeds an empty field: a date the user already picked stays put.
    if (!startDate && cohort?.startDate) changeStartDate(cohort.startDate);
  };
  const changeGroups = (next: string[]) => {
    setGroupIds(next);
    const group = groups.find(item => sameIdentifier(item.id, next[0]));
    if (group?.cohortId && !cohortId) setCohortId(group.cohortId);
  };

  // Attached-but-out-of-scope groups are appended rather than dropped: a module
  // already running for a group in another cohort must still be visible here, or
  // the list would silently claim it does not.
  const groupOptions = useMemo<MultiSelectOption[]>(() => {
    const rows = [...availableGroups];
    [ownGroupId, ...attachedGroupIds].forEach(id => {
      if (!id || rows.some(group => sameIdentifier(group.id, id))) return;
      const group = groups.find(item => sameIdentifier(item.id, id));
      if (group) rows.push(group);
    });
    return rows.map(group => {
      const cohort = cohorts.find(item => sameIdentifier(item.id, group.cohortId));
      const schedule = cleanText(group.weekDays);
      const alreadyRuns = attachedGroupIds.some(id => sameIdentifier(id, group.id));
      return {
        value: group.id,
        label: group.name,
        description: [cleanText(cohort?.name), schedule, cleanText(group.coach)].filter(Boolean).join(' · ') || undefined,
        badge: alreadyRuns ? 'Already runs this' : undefined,
        locked: alreadyRuns,
      };
    });
  }, [attachedGroupIds, availableGroups, cohorts, groups, ownGroupId]);

  // Named so the reader knows the previews below are one group's, not all of them.
  const otherGroupCount = selectedGroups.filter(group => !sameIdentifier(group.id, primaryGroupId)).length;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Give the module a name.'); return; }
    if (!module && !programmeId && !groupIds.length) { setError('Choose the programme this module belongs to.'); return; }
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
    const weeks = Math.max(1, Math.round(Number(sessionsNumber) || 1));
    const sessions = totalSessions;

    const programme = programmes.find(item => sameIdentifier(programmeIdentity(item), programmeId))
      || programmes.find(item => sameIdentifier(item.name, programmeId));

    // Handed back with every save so a chain can report the parents this form
    // resolved, whichever of them the person picked here rather than created.
    const savedParents = () => ({
      programmeId: programme ? programmeIdentity(programme) : cleanText(programmeId),
      programmeName: cleanText(programme?.name),
      cohortId: cleanText(cohortId) || cleanText(selectedCohort?.id),
      cohortName: cleanText(selectedCohort?.name),
      groupIds: selectedGroups.map(group => cleanText(group.id)).filter(Boolean),
      groupNames: selectedGroups.map(group => cleanText(group.name)).filter(Boolean),
    });

    /**
     * One group's delivery of this module.
     *
     * Everything schedule-shaped is read off the group being attached to, not off
     * the primary one: a second group may run on different days, at a different
     * time, under a cohort with a different holiday selection. Only the primary
     * group's end date is sent, because that is the one this drawer previewed;
     * for the others the backend generates the plan from their own days.
     */
    const attachToGroup = (group: CurriculumGroup) => {
      const groupWeekDays = cleanText(group.weekDays);
      const groupDeliveryDays = groupWeekDays
        ? groupWeekDays.split(',').map(day => day.trim()).filter(Boolean).length
        : 0;
      const groupCohort = cohorts.find(item => sameIdentifier(item.id, group.cohortId));
      const groupHolidayIds = new Set((groupCohort?.holidayIds || []).map(holidayId => normaliseKey(holidayId)));
      const isPrimary = sameIdentifier(group.id, primaryGroupId);
      return createGroupModule(group.id, {
        moduleName: trimmed,
        programmeId: programme ? programmeIdentity(programme) : programmeId,
        cohortId: cleanText(group.cohortId) || cohortId,
        groupId: group.id,
        startDate: startDate || undefined,
        endDate: isPrimary ? (endDate || undefined) : undefined,
        sessionsNumber: Math.round(weeks * Math.max(1, groupDeliveryDays)),
        weeks,
        allowTutorConflict: overrideGroupIds.current.has(group.id) || undefined,
        tutor: tutor || undefined,
        weekDays: groupWeekDays || undefined,
        startTime: cleanText(group.startTime) || undefined,
        endTime: cleanText(group.endTime) || undefined,
        color,
        coverImage,
        notes: description,
        holidays: holidays.filter(holiday => groupHolidayIds.has(normaliseKey(holiday.id))),
      }) as Promise<{ created?: Array<Record<string, unknown>>; updatedModules?: Array<Record<string, unknown>> }>;
    };

    setSaving(true);
    setError(null);
    setTutorConflictGroup(null);
    let failingGroup: CurriculumGroup | null = null;
    try {
      if (module) {
        const patchPayload = {
          name: trimmed,
          notes: description,
          status,
          color,
          coverImage,
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
          groupId: primaryGroupId || undefined,
          groupName: selectedGroup?.name || undefined,
          weekDays: weekDays || undefined,
          startTime: cleanText(selectedGroup?.startTime) || undefined,
          endTime: cleanText(selectedGroup?.endTime) || undefined,
        };
        console.log('[TEMP-DEBUG moduleForm] baseline at open', baseline.current);
        console.log('[TEMP-DEBUG moduleForm] current form state', { name, programmeId, cohortId, groupIds, sessionsNumber, startDate, targetEndDate, endDate, tutor, status, description, color });
        console.log('[TEMP-DEBUG moduleForm] PATCH module.id =', module.id, 'payload =', patchPayload);
        // The PATCH merges onto the stored structure, so only what this form
        // owns is sent: the weeks, components and KSB mappings authored in the
        // Module Builder are left exactly as they are.
        const patchResult = await updateCurriculumModule(module.id, patchPayload);
        console.log('[TEMP-DEBUG moduleForm] PATCH response =', patchResult);
        // Groups ticked on top of the module's own: each gets a delivery of its
        // own rather than sharing this one, so its dates come from its own
        // delivery days and its tutor booking is checked against its own slot.
        // Sequential on purpose -- the backend compares each attachment against
        // the ones already accepted, which a parallel burst would defeat.
        const newGroups = selectedGroups.filter(group => (
          !sameIdentifier(group.id, primaryGroupId)
          && !attachedGroupIds.some(id => sameIdentifier(id, group.id))
        ));
        for (const group of newGroups) {
          if (attachedThisSession.current.has(group.id)) continue;
          failingGroup = group;
          await attachToGroup(group);
          attachedThisSession.current.add(group.id);
        }
        // The caller's refresh runs BEFORE the drawer closes, so `saving` keeps the
        // spinner up and the buttons dimmed until the list actually holds the new
        // numbers. Closing first left a window -- as long as the round-trip, which
        // is seconds on a slow connection -- where reopening the drawer offered the
        // pre-save weeks and saving again wrote them straight back.
        await onSaved({ catalogueId: module.id, name: trimmed, created: false, ...savedParents() });
        console.log('[TEMP-DEBUG moduleForm] onSaved() resolved for', module.id);
        // In a chain the wizard owns closing and confirming, so that a run of
        // four steps says what it created once rather than four times.
        if (chained) return;
        onClose();
        await showCurriculumAlert({
          title: 'Module updated',
          text: newGroups.length
            ? `${trimmed} is saved, and now also runs for ${newGroups.map(group => group.name).join(', ')}.`
            : `${trimmed} is saved.`,
          timer: newGroups.length ? 2600 : 1800,
        });
        return;
      }

      if (selectedGroups.length) {
        // Attaching to a group is the endpoint that owns the delivery rules:
        // cohort date bounds, the session plan and the tutor conflict check. It
        // is called once per group, in order, so a clash between two of the new
        // deliveries is caught by the same rule as a clash with a stored one.
        const ordered = [
          ...selectedGroups.filter(group => sameIdentifier(group.id, primaryGroupId)),
          ...selectedGroups.filter(group => !sameIdentifier(group.id, primaryGroupId)),
        ];
        for (const group of ordered) {
          if (attachedThisSession.current.has(group.id)) continue;
          failingGroup = group;
          const result = await attachToGroup(group);
          const saved = (result.created || [])[0] || (result.updatedModules || [])[0] || {};
          const id = String(saved.moduleCatalogueId || saved.catalogueId || saved.structureId || saved.id || '');
          if (!createdCatalogueId.current) createdCatalogueId.current = id;
          attachedThisSession.current.add(group.id);
        }
        if (!chained) onClose();
        await onSaved({ catalogueId: createdCatalogueId.current, name: trimmed, created: true, ...savedParents() });
        if (!chained && ordered.length > 1) {
          // Worth saying out loud: one press produced one delivery per group, and
          // each of them is authored and scheduled separately from here on.
          await showCurriculumAlert({
            title: 'Module created for each group',
            text: `${trimmed} now runs for ${ordered.map(group => group.name).join(', ')}. Each group has its own dates and tutor.`,
            timer: 3000,
          });
        }
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
        coverImage,
      });
      if (!chained) onClose();
      await onSaved({ catalogueId: created.catalogueId || created.id, name: trimmed, created: true, ...savedParents() });
    } catch (err) {
      console.log('[TEMP-DEBUG moduleForm] submit() threw', err);
      // A tutor already booked in that slot is reported by the backend as a
      // sentence worth showing verbatim.
      setError(tutorConflictMessage(err) || (err instanceof Error ? err.message : 'The module could not be saved.'));
      if (isTutorConflictError(err) && failingGroup) {
        setTutorConflictGroup({ groupId: failingGroup.id, groupName: failingGroup.name });
      }
    } finally {
      setSaving(false);
    }
  };

  const bookConflictAnyway = () => {
    if (!tutorConflictGroup) return;
    overrideGroupIds.current.add(tutorConflictGroup.groupId);
    setTutorConflictGroup(null);
    void submit();
  };

  const placementHint = selectedGroups.length > 1
    ? `Tick as many groups as run this module. Each gets its own delivery from its own days and holidays; the dates and tutor below are ${selectedGroup?.name || 'the first group'}'s.`
    : selectedGroups.length === 1
      ? 'Saved against this group, with its delivery days and holidays. Tick another group to run the same module for it too.'
      : cohortId
        ? 'Saved against this cohort. Tick one or more groups to give it delivery dates and a tutor.'
        : 'Groups appear once a cohort is chosen. Without one the module is created as a catalogue draft.';

  return (
    <EntityDrawer
      open={open}
      title={module ? 'Edit module' : 'Add module'}
      subtitle={module
        ? 'Placement, dates and tutor. Weeks and components stay in the Module Builder.'
        : 'Where the module lives and when it runs. Weeks and components are authored next, in the Module Builder.'}
      banner={chain?.banner}
      onClose={onClose}
      onSubmit={submit}
      closeConfirm={chain?.closeConfirm}
      submitLabel={chain?.submitLabel || (module ? 'Save module' : 'Create module')}
      cancelLabel={chain?.cancelLabel}
      extraAction={chain?.extraAction}
      backAction={chain?.backAction}
      width={chain?.width || 'w-[760px]'}
      saving={saving}
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
          <FormField
            as="group"
            label={selectedGroups.length > 1 ? `Groups (${selectedGroups.length})` : 'Groups'}
            hint={placementHint}
          >
            <MultiSelectControl
              value={groupIds}
              onChange={changeGroups}
              options={groupOptions}
              selectAllLabel="groups"
              emptyMessage={
                cohortId
                  ? 'No groups for this cohort.'
                  : programmeId
                    ? 'Select a cohort above to see its groups.'
                    : 'Select a programme and cohort above to see its groups.'
              }
            />
          </FormField>
          {otherGroupCount > 0 && (
            <p className="-mt-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-[11px] leading-5 text-primary-800">
              <AppIcon className="ri-information-line mr-1 text-sm"></AppIcon>
              {module
                ? `Saving updates ${selectedGroup?.name || 'this group'}'s delivery and creates ${otherGroupCount} more, one per other ticked group.`
                : `Saving creates ${selectedGroups.length} deliveries of this module, one per ticked group.`}
              {' '}The session dates and tutor check below are {selectedGroup?.name || 'the first group'}'s; every other group is dated from its own delivery days.
            </p>
          )}
        </>
      )}
      <FormField label="Module name" required>
        <TextControl value={name} onChange={setName} placeholder="e.g. Data Modelling" />
      </FormField>
      <FormField
        label="Weeks"
        hint={
          deliveryDaysPerWeek > 1
            ? `= ${totalSessions} sessions (${deliveryDaysPerWeek} delivery days x ${sessionsNumber || 1} weeks). Counted from the dates below when you set them; each week is authored in the Module Builder.`
            : 'How long the module runs, counted from the dates below when you set them. Each week is authored in the Module Builder.'
        }
      >
        <TextControl type="number" min={1} max={104} value={sessionsNumber} onChange={changeWeeks} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <DatePickerField
          label="Start date"
          value={startDate}
          onChange={changeStartDate}
          min={selectedCohort?.startDate || undefined}
          max={selectedCohort?.practicalEndDate || selectedCohort?.endDate || undefined}
          error={startDateError || undefined}
          warning={startDateNotice || undefined}
          helper={
            selectedCohort
              ? `Within ${formatDateLabel(selectedCohort.startDate)} - ${formatDateLabel(selectedCohort.practicalEndDate || selectedCohort.endDate)}.`
              : undefined
          }
        />
        <DatePickerField
          label="End date"
          value={endDate}
          onChange={changeEndDate}
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
      {tutorConflictGroup && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
          <p className="text-[12px] leading-5 text-red-700">
            The save was refused because of that clash. If this is a deliberate
            co-taught slot for {tutorConflictGroup.groupName}, you can book the tutor
            anyway and save regardless.
          </p>
          <button
            type="button"
            onClick={bookConflictAnyway}
            disabled={saving}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 text-[12px] font-bold text-red-700 transition-smooth hover:bg-red-100 disabled:opacity-50"
          >
            Book anyway
          </button>
        </div>
      )}
      <FormField label="Notes">
        <TextAreaControl value={description} onChange={setDescription} placeholder="Optional delivery notes" />
      </FormField>
      <FormField label="Colour">
        <ColorControl value={color} onChange={setColor} />
      </FormField>
      <FormField
        label="Cover image"
        hint="Optional. The Module Builder card shows it in place of the module icon; leave it empty to keep the icon."
      >
        <CoverImageControl
          value={coverImage}
          onChange={setCoverImage}
          onError={setError}
          alt={`${name || 'Module'} cover`}
        />
      </FormField>
      {sessionPreviewOpen && plan && (
        <ModuleSessionPreviewModal
          moduleName={name || module?.name || 'Module'}
          plan={plan}
          holidays={cohortHolidays}
          sessionNames={sessionNames}
          sessionNamesLoading={sessionNamesLoading}
          sessionNamesError={sessionNamesError}
          onClose={() => setSessionPreviewOpen(false)}
        />
      )}
    </EntityDrawer>
  );
}

/**
 * A weekend or a ticked holiday isn't refused as a start date -- it's still saved
 * as typed -- but the module won't actually deliver that day, so the picker warns
 * about it instead of staying silent.
 */
function describeNonDeliveryDate(dateValue: string, holidays: CurriculumHoliday[]): string {
  const date = dateFromYmd(dateValue);
  if (!date) return '';
  // The weekend half of this check is the cohort drawer's too, so the sentence
  // lives in `model.ts` and both drawers read the one copy of it.
  const weekend = weekendDateNotice(dateValue);
  if (weekend) return weekend;
  const holiday = holidays.find(item => {
    const start = dateFromYmd(item.startDate);
    const end = dateFromYmd(item.endDate || item.startDate);
    return start && end && start <= date && date <= end;
  });
  if (holiday) {
    return `That date falls inside ${holiday.label || 'a ticked holiday'} — England's bank holiday period, so no delivery runs then.`;
  }
  return '';
}

/** Monday-first weekday indexes, the way `parse_delivery_days` reads a group's schedule. */
const WEEKDAY_INDEX: Record<string, number> = {
  monday: 0, mon: 0,
  tuesday: 1, tue: 1,
  wednesday: 2, wed: 2,
  thursday: 3, thu: 3,
  friday: 4, fri: 4,
  saturday: 5, sat: 5,
  sunday: 6, sun: 6,
};

function deliveryDayIndexes(weekDays: string): number[] {
  const days: number[] = [];
  String(weekDays || '').toLowerCase().split(/[,/|+&\s]+/).forEach(token => {
    const index = WEEKDAY_INDEX[token.trim()];
    if (index !== undefined && !days.includes(index)) days.push(index);
  });
  return days;
}

function holidayDateKeys(holidays: CurriculumHoliday[]): Set<string> {
  const keys = new Set<string>();
  (holidays || []).forEach(holiday => {
    const start = dateFromYmd(holiday.startDate);
    const end = dateFromYmd(holiday.endDate || holiday.startDate) || start;
    if (!start || !end) return;
    const cursor = new Date(start);
    while (cursor <= end) {
      keys.add(ymdOf(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return keys;
}

function ymdOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The date the last session lands on -- the same walk `build_module_session_plan`
 * does on the server, run locally so the End date field answers the keystroke
 * that changed the weeks or the start date rather than the debounced preview
 * that follows it. Deliberately identical in shape to the backend loop: step a
 * day at a time from the start, count the delivery days, skip the ones a ticked
 * holiday covers. Returns '' whenever the backend would also refuse to
 * calculate -- no start date, no sessions, or a group with no delivery day.
 */
function projectModuleEndDate(
  startDate: string,
  numberOfSessions: number,
  weekDays: string,
  holidays: CurriculumHoliday[],
): string {
  const start = dateFromYmd(startDate);
  const days = deliveryDayIndexes(weekDays);
  const sessionCount = Math.max(0, Math.round(Number(numberOfSessions) || 0));
  if (!start || !days.length || sessionCount <= 0) return '';

  const blocked = holidayDateKeys(holidays);
  const cursor = new Date(start);
  let found = 0;
  let guardDays = Math.max(3650, sessionCount * 21);
  while (found < sessionCount && guardDays > 0) {
    // JS counts weeks from Sunday; the delivery days are Monday-first.
    const weekday = (cursor.getDay() + 6) % 7;
    if (days.includes(weekday) && !blocked.has(ymdOf(cursor))) {
      found += 1;
      if (found === sessionCount) return ymdOf(cursor);
    }
    cursor.setDate(cursor.getDate() + 1);
    guardDays -= 1;
  }
  return '';
}

/**
 * How many weeks a start and an end date span -- `projectModuleEndDate` run
 * backwards, so the Weeks box answers a date the user picked rather than the
 * other way round.
 *
 * Counted in delivery days, not calendar days: the same walk, stepping a day at
 * a time from the start to the end, counting the days this group actually runs
 * and skipping the ones a ticked holiday covers. A group teaching Mon + Wed that
 * runs 11 sessions is 6 weeks, not 5.5 -- a part-week is still a week the
 * builder has to author, so the division rounds up.
 *
 * With no group chosen yet there are no delivery days to count, and the span
 * falls back to whole calendar weeks. Returns 0 whenever there is nothing to
 * count -- a missing date, or an end date before the start.
 */
function projectModuleWeeks(
  startDate: string,
  endDate: string,
  weekDays: string,
  holidays: CurriculumHoliday[],
  deliveryDaysPerWeek: number,
): number {
  const start = dateFromYmd(startDate);
  const end = dateFromYmd(endDate);
  if (!start || !end || end < start) return 0;

  const days = deliveryDayIndexes(weekDays);
  const perWeek = Math.max(1, deliveryDaysPerWeek || days.length);
  if (!days.length) {
    // No delivery pattern to count against: the span in whole calendar weeks,
    // inclusive of both ends, which is what the box would have been typed with.
    const calendarDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    return clampModuleWeeks(Math.ceil(calendarDays / 7));
  }

  const blocked = holidayDateKeys(holidays);
  const cursor = new Date(start);
  let sessions = 0;
  let guardDays = 3650;
  while (cursor <= end && guardDays > 0) {
    const weekday = (cursor.getDay() + 6) % 7;
    if (days.includes(weekday) && !blocked.has(ymdOf(cursor))) sessions += 1;
    cursor.setDate(cursor.getDate() + 1);
    guardDays -= 1;
  }
  if (!sessions) return 0;
  return clampModuleWeeks(Math.ceil(sessions / perWeek));
}

/** The Weeks input's own bounds, so a computed count is never one it refuses. */
function clampModuleWeeks(weeks: number): number {
  if (!Number.isFinite(weeks) || weeks <= 0) return 0;
  return Math.min(104, Math.max(1, Math.round(weeks)));
}

function dateFromYmd(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
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
  sessionNames,
  sessionNamesLoading,
  sessionNamesError,
  onClose,
}: {
  moduleName: string;
  plan: CurriculumSessionPlanPreview;
  holidays: CurriculumHoliday[];
  /** The live-session component titles, by session number. See `liveSessionNamesByNumber`. */
  sessionNames: Array<string | null>;
  sessionNamesLoading: boolean;
  sessionNamesError: boolean;
  onClose: () => void;
}) {
  const shifted = plan.sessions.filter(session => session.skippedHolidays?.length);
  // No weeks at all: a module being created has none yet, and cannot have any
  // until it is saved. That is one fact about the module, not ten facts about
  // its dates, so it is said once above the timeline and the rows stay dates.
  const noWeeksAuthored = !sessionNamesLoading && !sessionNamesError && !sessionNames.length;
  // The name of the live session that runs on this date, or the reason this
  // particular date has none -- a week that holds no live session, or one whose
  // live session was never named. Both are gaps the person can go and close.
  const sessionNameOf = (sessionNumber: number): { text: string; authored: boolean } => {
    if (sessionNamesLoading) return { text: 'Reading the weeks...', authored: false };
    if (sessionNamesError) return { text: 'Session names could not be read', authored: false };
    if (noWeeksAuthored) return { text: '', authored: false };
    const name = sessionNames[sessionNumber - 1];
    if (name === undefined) return { text: 'No week authored for this session', authored: false };
    if (name === null) return { text: 'This week holds no live session', authored: false };
    return name ? { text: name, authored: true } : { text: 'Live session not named', authored: false };
  };
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
        {noWeeksAuthored && (
          <div className="flex shrink-0 items-start gap-2 border-b border-background-200 bg-background-100 px-5 py-3 text-[12px] text-foreground-600">
            <AppIcon className="ri-information-line mt-0.5 shrink-0 text-sm"></AppIcon>
            <span>
              These are the dates. Each session is named after the live session in its week,
              authored in the Module Builder once this module is saved.
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
                    const sessionName = sessionNameOf(entry.sessionNumber);
                    if (entry.kind === 'blocked') {
                      return (
                        <div key={`${entry.sessionNumber}-blocked-${index}`} className="overflow-hidden rounded-lg border border-red-200 bg-red-50">
                          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                            <span className="flex items-center gap-2 text-[12px]">
                              <AppIcon className="ri-close-circle-fill shrink-0 text-sm text-red-600"></AppIcon>
                              <span className="font-bold text-red-700">{formatDateLabel(entry.date)}</span>
                              {sessionName.text && (
                                <span className={sessionName.authored ? 'font-semibold text-red-700' : 'italic text-foreground-400'}>
                                  {sessionName.text}
                                </span>
                              )}
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
                          {sessionName.text && (
                            <span className={sessionName.authored
                              ? `font-semibold ${isReplacement ? 'text-emerald-700' : 'text-foreground-700'}`
                              : 'italic text-foreground-400'}
                            >
                              {sessionName.text}
                            </span>
                          )}
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
