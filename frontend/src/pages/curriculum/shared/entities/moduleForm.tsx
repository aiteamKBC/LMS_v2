// ============================================================================
// The create/edit form for a Module.
//
// It sits apart from `forms.tsx` on purpose: creating a module has to build the
// same authoring skeleton the Module Builder reads, which means importing
// `module-builder/moduleAuthoringData`. Keeping that import out of the shared
// forms file keeps the Programmes, Cohorts and Groups pages off the authoring
// chunk.
//
// One form, two canonical save paths — neither of them reimplemented here:
//   * placed in a group -> POST /curriculum/groups/<id>/modules/, which checks
//     the start date against the cohort, builds the session plan from the
//     group's delivery days and holidays, refuses a tutor double-booking and
//     mirrors the assignment onto the tutor's profile (the notification);
//   * no group yet      -> POST /curriculum/modules/, a catalogue draft that
//     gets its cohort, group, tutor and dates when it is placed later.
// Editing goes through PATCH /curriculum/modules/<id>/, which carries the same
// conflict check and tutor notification as the create-in-group path.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import { DatePickerField } from '@/components/feature/DatePickerField';
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
import { createNewModule } from '../../module-builder/moduleAuthoringData';
import {
  cleanText,
  cohortsForProgramme,
  formatDateLabel,
  groupsForScope,
  normaliseKey,
  programmeIdentity,
  sameFormValues,
  sameIdentifier,
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

/**
 * The module being edited, reduced to what this form reads and writes. Declared
 * rather than reusing `CurriculumModule` because the Module Builder holds its
 * modules as authoring catalogue items — same records, different field names —
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
  tutor?: string;
  status?: string;
  notes?: string;
  color?: string;
}

/** What a successful save hands back, so the caller can go straight to the module. */
export interface SavedModuleRef {
  catalogueId: string;
  name: string;
  created: boolean;
}

const UNASSIGNED = 'unassigned';

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
  const [tutor, setTutor] = useState('');
  const [status, setStatus] = useState('draft');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<CurriculumSessionPlanPreview | null>(null);
  // What the drawer opened with, for the unsaved-changes check below.
  const baseline = useRef<Record<string, unknown>>({});

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSaving(false);
    setPlan(null);

    const parentGroup = groups.find(group => sameIdentifier(group.id, module?.groupId || defaults?.groupId));
    const parentCohort = cohorts.find(cohort => sameIdentifier(cohort.id, module?.cohortId || parentGroup?.cohortId || defaults?.cohortId));
    const resolvedProgrammeId = cleanText(parentCohort?.programmeId)
      || cleanText(parentGroup?.programmeId)
      || cleanText(module?.programmeId)
      || cleanText(module?.programme)
      || defaults?.programmeId
      || (programmes.length === 1 ? programmeIdentity(programmes[0]) : '');

    const storedTutor = cleanText(module?.tutor);
    const initial = {
      name: cleanText(module?.name),
      programmeId: resolvedProgrammeId,
      cohortId: cleanText(parentCohort?.id) || cleanText(module?.cohortId) || defaults?.cohortId || '',
      groupId: cleanText(parentGroup?.id) || cleanText(module?.groupId) || defaults?.groupId || '',
      sessionsNumber: String(module?.sessionsNumber || module?.weeks || 1),
      // A new module inside a cohort starts when the cohort does — the same
      // default the backend falls back to when no start date is sent.
      startDate: cleanText(module?.startDate) || (module ? '' : cleanText(parentCohort?.startDate)),
      tutor: normaliseKey(storedTutor) === UNASSIGNED ? '' : storedTutor,
      status: cleanText(module?.status) || 'draft',
      description: cleanText(module?.notes),
      color: module?.color || parentGroup?.color || '#2563eb',
    };
    baseline.current = initial;
    setName(initial.name);
    setProgrammeId(initial.programmeId);
    setCohortId(initial.cohortId);
    setGroupId(initial.groupId);
    setSessionsNumber(initial.sessionsNumber);
    setStartDate(initial.startDate);
    setTutor(initial.tutor);
    setStatus(initial.status);
    setDescription(initial.description);
    setColor(initial.color);
  }, [cohorts, defaults?.cohortId, defaults?.groupId, defaults?.programmeId, groups, module, open, programmes]);

  const dirty = !sameFormValues(
    { name, programmeId, cohortId, groupId, sessionsNumber, startDate, tutor, status, description, color },
    baseline.current,
  );

  const programmeOptions = useMemo(
    () => programmes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [programmes],
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

  // The holidays that apply are the ones the parent cohort selected — the same
  // set the backend skips when it generates this module's session dates.
  const cohortHolidays = useMemo(() => {
    const ids = new Set((selectedCohort?.holidayIds || []).map(holidayId => normaliseKey(holidayId)));
    return holidays.filter(holiday => ids.has(normaliseKey(holiday.id)));
  }, [holidays, selectedCohort]);

  // The end date is the backend's own session-plan calculation, so what the
  // drawer shows cannot drift from what the save stores.
  const weekDays = cleanText(selectedGroup?.weekDays);
  useEffect(() => {
    if (!open || !startDate) { setPlan(null); return undefined; }
    let active = true;
    const timer = setTimeout(() => {
      previewModuleSessionPlan({
        startDate,
        numberOfSessions: Math.max(1, Number(sessionsNumber) || 1),
        weekDays,
        holidays: cohortHolidays,
      })
        .then(result => { if (active) setPlan(result); })
        .catch(() => { if (active) setPlan(null); })
        .finally(() => {});
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [cohortHolidays, open, sessionsNumber, startDate, weekDays]);

  const endDate = plan?.finalEndDate || '';

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
    const sessions = Math.max(1, Math.round(Number(sessionsNumber) || 1));

    const programme = programmes.find(item => sameIdentifier(programmeIdentity(item), programmeId))
      || programmes.find(item => sameIdentifier(item.name, programmeId));

    setSaving(true);
    setError(null);
    try {
      if (module) {
        // The PATCH merges onto the stored structure, so only what this form
        // owns is sent: the weeks, components and KSB mappings authored in the
        // Module Builder are left exactly as they are.
        await updateCurriculumModule(module.id, {
          name: trimmed,
          notes: description,
          status,
          color,
          sessionsNumber: sessions,
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
        });
        onClose();
        await onSaved({ catalogueId: module.id, name: trimmed, created: false });
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
          weeks: sessions,
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
        weeks: sessions,
        sessionsNumber: sessions,
        startDate: startDate || '',
        endDate: endDate || '',
        status: 'draft',
      });
      onClose();
      await onSaved({ catalogueId: created.catalogueId || created.id, name: trimmed, created: true });
    } catch (err) {
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
      : 'No group yet — the module is created as a catalogue draft.';

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
              options={availableCohorts.map(cohort => ({ value: cohort.id, label: `${cohort.name} · ${cohort.programme}` }))}
              placeholder={availableCohorts.length ? 'No cohort yet' : 'No cohorts for this programme'}
            />
          </FormField>
          <FormField label="Group" hint={placementHint}>
            <SelectControl
              value={groupId}
              onChange={changeGroup}
              options={availableGroups.map(group => ({ value: group.id, label: `${group.name} · ${group.cohort}` }))}
              placeholder={availableGroups.length ? 'No group yet' : 'No groups for this cohort'}
            />
          </FormField>
        </>
      )}
      <FormField label="Module name" required>
        <TextControl value={name} onChange={setName} placeholder="e.g. Data Modelling" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Sessions" hint="One week is authored per session.">
          <TextControl type="number" min={1} max={104} value={sessionsNumber} onChange={setSessionsNumber} />
        </FormField>
        <DatePickerField
          label="Start date"
          value={startDate}
          onChange={setStartDate}
          min={selectedCohort?.startDate || undefined}
          max={selectedCohort?.practicalEndDate || selectedCohort?.endDate || undefined}
          helper={selectedCohort ? `Within ${formatDateLabel(selectedCohort.startDate)} – ${formatDateLabel(selectedCohort.practicalEndDate || selectedCohort.endDate)}` : undefined}
        />
      </div>
      {endDate && (
        <p className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5 text-[12px] font-semibold text-primary-700">
          {`${sessionsNumber} session${Number(sessionsNumber) === 1 ? '' : 's'} run ${formatDateLabel(startDate)} – ${formatDateLabel(endDate)}`}
          {weekDays ? ` on ${weekDays}` : ''}
          {cohortHolidays.length ? `, skipping ${cohortHolidays.length} holiday${cohortHolidays.length === 1 ? '' : 's'}` : ''}
          .
        </p>
      )}
      <FormField label="Tutor" hint="Checked against the tutor's existing sessions before it saves.">
        <SelectControl
          value={tutor}
          onChange={setTutor}
          options={tutorNames.map(tutorName => ({ value: tutorName, label: tutorName }))}
          placeholder="Unassigned"
        />
      </FormField>
      {module && (
        <FormField label="Status">
          <SelectControl
            value={status}
            onChange={setStatus}
            options={[
              { value: 'draft', label: 'Draft' },
              { value: 'review', label: 'In review' },
              { value: 'published', label: 'Published' },
            ]}
          />
        </FormField>
      )}
      <FormField label="Notes">
        <TextAreaControl value={description} onChange={setDescription} placeholder="Optional delivery notes" />
      </FormField>
      <FormField label="Colour">
        <ColorControl value={color} onChange={setColor} />
      </FormField>
    </EntityDrawer>
  );
}
