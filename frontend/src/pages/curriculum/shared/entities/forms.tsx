// ============================================================================
// The create/edit forms for Programmes, Cohorts and Groups.
//
// Both the global page (Curriculum -> Cohorts) and the contextual workspace
// (Programme -> its Cohorts, Cohort -> its Groups) open the *same* component, so
// there is one form, one validation rule set and one save path per entity. Each
// one writes through the canonical endpoint in `lib/curriculumApi`; none of the
// date, holiday or parent-link rules are reimplemented here.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { showCurriculumAlert } from '@/components/feature/CurriculumSweetAlert';
import {
  createCurriculumCohort,
  createCurriculumGroup,
  createCurriculumProgramme,
  previewCohortEndDate,
  updateCurriculumCohort,
  updateCurriculumGroup,
  updateCurriculumProgramme,
  type CurriculumCohort,
  type CurriculumCohortEndDatePreview,
  type CurriculumGroup,
  type CurriculumHoliday,
  type CurriculumProgramme,
} from '@/lib/curriculumApi';
import { cleanText, cohortWeekCapacity, cohortsForProgramme, formatDateLabel, normaliseKey, programmeIdentity, sameFormValues, sameIdentifier } from './model';
import {
  ColorControl,
  EntityDrawer,
  FormField,
  SelectControl,
  TextAreaControl,
  TextControl,
  WeekdayControl,
  type FormChainStep,
} from './ui';
import { useFormSeedGuard } from './useDrawerState';
import { AppIcon } from '@/components/feature/AppIcon';
import { DatePickerField } from '@/components/feature/DatePickerField';

// --------------------------------------------------------------- programme

/**
 * Programme-level information only. A programme is independently saveable — it
 * does not require a cohort, group or module to exist. Its cohorts, groups and
 * modules are added afterwards, each from the one form that record type has.
 */
export function ProgrammeFormDrawer({
  open,
  programme,
  chain,
  onClose,
  onSaved,
}: {
  open: boolean;
  programme?: CurriculumProgramme | null;
  /** Set when the structure wizard is driving this form as one step of a chain. */
  chain?: FormChainStep;
  onClose: () => void;
  /**
   * Handed the programme a create just made, so the caller can carry straight on
   * to the KSB source it still needs. Absent on an edit.
   */
  onSaved: (result?: { programme: CurriculumProgramme }) => unknown | Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6941c6');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the drawer opened with. Comparing the live values against it tells an
  // untouched form from one holding answers that a save has not taken yet.
  const baseline = useRef<Record<string, unknown>>({});

  useEffect(() => {
    if (!open) return;
    const initial = {
      name: cleanText(programme?.name),
      level: cleanText(programme?.level).replace(/\D/g, ''),
      description: cleanText(programme?.description),
      color: programme?.color || '#6941c6',
    };
    baseline.current = initial;
    setError(null);
    setSaving(false);
    setName(initial.name);
    setLevel(initial.level);
    setDescription(initial.description);
    setColor(initial.color);
  }, [open, programme]);

  const dirty = !sameFormValues({ name, level, description, color }, baseline.current);

  const submit = async () => {
    if (!name.trim()) { setError('Give the programme a name.'); return; }
    setSaving(true);
    setError(null);
    try {
      // standard/owner/status/requiredOtjh are deliberately not sent: the input
      // type is a Partial and the backend leaves an omitted key untouched, so
      // dropping the fields from the form cannot clear a stored value.
      const payload = {
        name: name.trim(),
        level: level.trim() ? `LVL-${level.trim()}` : '',
        description: description.trim(),
        color,
      };
      let created: CurriculumProgramme | null = null;
      if (programme) await updateCurriculumProgramme(programmeIdentity(programme), payload);
      else created = (await createCurriculumProgramme(payload)).programme || null;
      // In a chain the record is handed straight back: the wizard moves to the
      // next step and says what was created once, at the end of the run.
      if (chain?.chained) {
        await onSaved(created ? { programme: created } : undefined);
        return;
      }
      onClose();
      const refreshed = Promise.resolve(onSaved(created ? { programme: created } : undefined))
        .catch(() => undefined);
      await showCurriculumAlert({
        title: programme ? 'Programme updated' : 'Programme created',
        // A cohort used to be named as the next step, which is the wrong one:
        // nothing beneath a programme can be mapped or measured until it has a
        // KSB source, so that is what the reader is sent to do. Left unsaid, the
        // programme sits there looking finished and the omission only surfaces
        // later, on the KSB mapping page, as an empty screen.
        text: programme
          ? `${payload.name} is saved.`
          : `${payload.name} is saved. It has no KSB source yet — modules under it have nothing to map against and its coverage cannot be measured until one is applied.`,
        timer: programme ? 2200 : undefined,
      });
      await refreshed;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The programme could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntityDrawer
      open={open}
      title={programme ? 'Edit programme' : 'Add programme'}
      subtitle={chain
        ? 'Programme-level details only. The cohort, group and module that go under it are the steps after this one.'
        : 'Programme-level details only. Cohorts, groups and modules are added later, from their own pages.'}
      banner={chain?.banner}
      onClose={onClose}
      onSubmit={submit}
      closeConfirm={chain?.closeConfirm}
      submitLabel={chain?.submitLabel || (programme ? 'Save programme' : 'Create programme')}
      cancelLabel={chain?.cancelLabel}
      extraAction={chain?.extraAction}
      backAction={chain?.backAction}
      width={chain?.width}
      saving={saving}
      error={error}
      dirty={dirty}
    >
      <FormField label="Programme name" required>
        <TextControl value={name} onChange={setName} placeholder="e.g. Data Analyst" />
      </FormField>
      <FormField label="Level" hint={level ? `Will be saved as LVL-${level}` : 'Numbers only, e.g. 4'}>
        <TextControl value={level} onChange={value => setLevel(value.replace(/\D/g, ''))} placeholder="e.g. 4" inputMode="numeric" />
      </FormField>
      <FormField label="Description">
        <TextAreaControl value={description} onChange={setDescription} placeholder="What this programme covers" />
      </FormField>
      <FormField label="Colour">
        <ColorControl value={color} onChange={setColor} />
      </FormField>
    </EntityDrawer>
  );
}

// ------------------------------------------------------------------ cohort

export interface CohortFormDefaults {
  programmeId?: string;
}

export function CohortFormDrawer({
  open,
  cohort,
  defaults,
  programmes,
  holidays,
  chain,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Present when editing; absent when creating. */
  cohort?: CurriculumCohort | null;
  defaults?: CohortFormDefaults;
  programmes: CurriculumProgramme[];
  holidays: CurriculumHoliday[];
  /** Set when the structure wizard is driving this form as one step of a chain. */
  chain?: FormChainStep;
  onClose: () => void;
  /**
   * Handed the record the save wrote, so the list can paint it before the
   * background refresh gets back — see `EntityTable`'s highlightKey.
   */
  onSaved: (result?: { cohort: CurriculumCohort }) => unknown | Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [durationMonths, setDurationMonths] = useState('12');
  const [practicalEndDate, setPracticalEndDate] = useState('');
  // True once the practical end date has been typed or picked by hand. It goes
  // back to false the moment the start date or duration changes, so the field
  // follows the calculation again unless the user nudges it a second time.
  const [practicalEndIsManual, setPracticalEndIsManual] = useState(false);
  const [epaMonths, setEpaMonths] = useState('');
  const [apprenticeshipEndOverride, setApprenticeshipEndOverride] = useState('');
  const [color, setColor] = useState('#6d28d9');
  const [holidayIds, setHolidayIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CurriculumCohortEndDatePreview | null>(null);
  // What the drawer opened with, for the unsaved-changes check further down.
  const baseline = useRef<Record<string, unknown>>({});

  // Only an authored practical end date counts as an edit: in automatic mode the
  // field mirrors whatever the backend preview returns, which is not something
  // the user typed and must not make an untouched drawer ask before it closes.
  const authoredPracticalEnd = practicalEndIsManual ? practicalEndDate : '';
  const dirty = !sameFormValues({
    name,
    programmeId,
    startDate,
    durationMonths,
    practicalEndDate: authoredPracticalEnd,
    epaMonths,
    apprenticeshipEndOverride,
    color,
    holidayIds,
  }, baseline.current);
  // `programmes` is in the seeding effect's dependencies and gets a new identity
  // on every background refresh; without this the list landing mid-edit reset the
  // form. See useFormSeedGuard.
  const allowSeed = useFormSeedGuard(dirty);

  useEffect(() => {
    if (!allowSeed(open, cleanText(cohort?.id) || 'new-cohort')) return;
    setError(null);
    setSaving(false);
    if (cohort) {
      // A stored cohort already carries a practical end date, and it may have
      // been authored rather than calculated. Treat it as manual so reopening
      // the drawer cannot quietly move it back onto the duration rule.
      const storedPracticalEnd = cohort.practicalEndDate || cohort.endDate || '';
      const initial = {
        name: cohort.name || '',
        programmeId: cleanText(cohort.programmeId) || cleanText(cohort.programme),
        startDate: cohort.startDate || '',
        durationMonths: cohort.durationMonths == null ? '' : String(cohort.durationMonths),
        practicalEndDate: storedPracticalEnd,
        epaMonths: cohort.epaMonths == null ? '' : String(cohort.epaMonths),
        apprenticeshipEndOverride: cohort.apprenticeshipEndOverride || '',
        color: cohort.color || '#6d28d9',
        holidayIds: (cohort.holidayIds || []).map(String),
      };
      baseline.current = initial;
      setName(initial.name);
      setProgrammeId(initial.programmeId);
      setStartDate(initial.startDate);
      setDurationMonths(initial.durationMonths);
      setPracticalEndDate(storedPracticalEnd);
      setPracticalEndIsManual(Boolean(storedPracticalEnd));
      setEpaMonths(initial.epaMonths);
      setApprenticeshipEndOverride(initial.apprenticeshipEndOverride);
      setColor(initial.color);
      setHolidayIds(initial.holidayIds);
      return;
    }
    const initial = {
      name: '',
      programmeId: defaults?.programmeId || (programmes.length === 1 ? programmeIdentity(programmes[0]) : ''),
      startDate: '',
      durationMonths: '12',
      practicalEndDate: '',
      epaMonths: '',
      apprenticeshipEndOverride: '',
      color: '#6d28d9',
      holidayIds: [] as string[],
    };
    baseline.current = initial;
    setName(initial.name);
    setProgrammeId(initial.programmeId);
    setStartDate(initial.startDate);
    setDurationMonths(initial.durationMonths);
    setPracticalEndDate(initial.practicalEndDate);
    setPracticalEndIsManual(false);
    setEpaMonths(initial.epaMonths);
    setApprenticeshipEndOverride(initial.apprenticeshipEndOverride);
    setColor(initial.color);
    setHolidayIds(initial.holidayIds);
  }, [allowSeed, cohort, defaults?.programmeId, open, programmes]);

  // `authoredPracticalEnd` above is also what the preview is given: in automatic
  // mode the backend works the practical end out from the start date and
  // duration, and the field below mirrors whatever comes back.

  // The practical end / EPA / apprenticeship end dates come from the backend's
  // own calculation, so the preview cannot drift from what a save will store.
  useEffect(() => {
    if (!open || !startDate || (!durationMonths && !authoredPracticalEnd)) { setPreview(null); return undefined; }
    let active = true;
    const timer = setTimeout(() => {
      previewCohortEndDate({
        startDate,
        durationMonths: Number(durationMonths) || 0,
        practicalEndDate: authoredPracticalEnd || null,
        epaMonths: epaMonths === '' ? null : Number(epaMonths),
        apprenticeshipEndOverride: apprenticeshipEndOverride || null,
      })
        .then(result => {
          if (!active) return;
          setPreview(result);
          if (!authoredPracticalEnd) {
            setPracticalEndDate(result.calculatedEndDate || result.practicalEndDate || result.endDate || '');
          }
        })
        .catch(() => { if (active) setPreview(null); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [apprenticeshipEndOverride, authoredPracticalEnd, durationMonths, epaMonths, open, startDate]);

  // Both end dates are shown as the real date the cohort carries, not as blank
  // "override" boxes: the delivery team reads them off the screen, and moving
  // one a day either way is a normal edit rather than an exception.
  const calculatedPracticalEnd = preview?.calculatedEndDate || '';
  const apprenticeshipEndDate = apprenticeshipEndOverride || preview?.apprenticeshipEndDate || '';
  const showPracticalEndReset = practicalEndIsManual && Boolean(calculatedPracticalEnd) && calculatedPracticalEnd !== practicalEndDate;

  // Changing what feeds the calculation hands the practical end date back to it.
  const changeStartDate = (value: string) => { setStartDate(value); setPracticalEndIsManual(false); };
  const changeDurationMonths = (value: string) => { setDurationMonths(value); setPracticalEndIsManual(false); };
  const changePracticalEndDate = (value: string) => {
    setPracticalEndDate(value);
    setPracticalEndIsManual(Boolean(value));
  };
  const resetPracticalEndDate = () => {
    setPracticalEndIsManual(false);
    setPracticalEndDate(calculatedPracticalEnd);
  };

  // The cohort period the holidays below are measured against: start date ->
  // the practical end from the contracted duration. Holidays are shown inside
  // that fixed window, then used later by module session planning when a
  // generated session clashes with one of the selected dates.
  const periodStart = startDate;
  const periodEnd = preview?.baseEndDate || practicalEndDate || preview?.practicalEndDate || preview?.endDate || cohort?.practicalEndDate || cohort?.endDate || '';
  const periodLabel = periodStart && periodEnd ? `${formatDateLabel(periodStart)} – ${formatDateLabel(periodEnd)}` : '';

  const programmeOptions = useMemo(
    () => programmes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [programmes],
  );

  // The ticked holidays themselves, so the week count below can say which weeks
  // of the period one of them lands in.
  const selectedHolidays = useMemo(() => {
    const ids = new Set(holidayIds.map(String));
    return holidays.filter(holiday => ids.has(String(holiday.id)));
  }, [holidayIds, holidays]);

  // The floor and the ceiling on how many weeks this cohort has to deliver in.
  // The period itself never moves, so the two numbers bracket the same window:
  // every week when nothing is ticked, and the weeks left once each week holding
  // a ticked holiday is taken out.
  const weekCapacity = useMemo(
    () => cohortWeekCapacity(periodStart, periodEnd, selectedHolidays),
    [periodEnd, periodStart, selectedHolidays],
  );

  const submit = async () => {
    if (!name.trim()) { setError('Give the cohort a name.'); return; }
    if (!programmeId) { setError('Choose the programme this cohort belongs to.'); return; }
    if (!startDate) { setError('Set the cohort start date.'); return; }

    const programme = programmes.find(item => sameIdentifier(programmeIdentity(item), programmeId))
      || programmes.find(item => sameIdentifier(item.name, programmeId));
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        programme: programme?.name || programmeId,
        programmeId: programme ? programmeIdentity(programme) : programmeId,
        startDate,
        // Only an authored practical end date is sent. In automatic mode the
        // backend derives it from the start date and duration, which cannot go
        // stale behind the debounced preview the way this field can.
        endDate: authoredPracticalEnd || undefined,
        durationMonths: Number(durationMonths) || undefined,
        epaMonths: epaMonths === '' ? null : Number(epaMonths),
        apprenticeshipEndOverride: apprenticeshipEndOverride || null,
        color,
        holidayIds,
      };
      // What the list should show straight away. A create gets the stored row
      // back from the endpoint; an edit merges the payload over the record the
      // drawer opened on, with the dates the preview has already worked out.
      let saved: CurriculumCohort | null = null;
      if (cohort) {
        await updateCurriculumCohort(cohort.id, payload);
        saved = {
          ...cohort,
          name: payload.name,
          programme: payload.programme,
          programmeId: payload.programmeId,
          startDate,
          durationMonths: payload.durationMonths ?? cohort.durationMonths,
          endDate: practicalEndDate || cohort.endDate,
          practicalEndDate: practicalEndDate || cohort.practicalEndDate,
          epaMonths: payload.epaMonths,
          apprenticeshipEndDate: apprenticeshipEndDate || cohort.apprenticeshipEndDate,
          apprenticeshipEndOverride: apprenticeshipEndOverride || '',
          color,
          holidayIds,
        };
      } else {
        saved = (await createCurriculumCohort(payload)).cohort || null;
      }
      // See the programme form: in a chain the wizard owns closing and confirming.
      if (chain?.chained) {
        await onSaved(saved ? { cohort: saved } : undefined);
        return;
      }
      onClose();
      // The refresh runs behind the confirmation rather than in front of it: it
      // takes seconds, and holding the message back until it returned is what
      // made a finished save look like nothing had happened.
      const refreshed = Promise.resolve(onSaved(saved ? { cohort: saved } : undefined))
        .catch(() => undefined);
      await showCurriculumAlert({
        title: cohort ? 'Cohort updated' : 'Cohort created',
        text: `${payload.name} is saved against ${payload.programme}.`,
        timer: 1800,
      });
      await refreshed;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The cohort could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntityDrawer
      open={open}
      title={cohort ? 'Edit cohort' : 'Add cohort'}
      subtitle="A cohort belongs to one programme. Its practical end, EPA window and apprenticeship end date use the same rules as the rest of the LMS."
      banner={chain?.banner}
      onClose={onClose}
      onSubmit={submit}
      closeConfirm={chain?.closeConfirm}
      submitLabel={chain?.submitLabel || (cohort ? 'Save cohort' : 'Create cohort')}
      cancelLabel={chain?.cancelLabel}
      extraAction={chain?.extraAction}
      backAction={chain?.backAction}
      width={chain?.width}
      saving={saving}
      error={error}
      dirty={dirty}
    >
      <FormField label="Programme" required>
        <SelectControl value={programmeId} onChange={setProgrammeId} options={programmeOptions} placeholder="Select a programme" />
      </FormField>
      <FormField label="Cohort name" required>
        <TextControl value={name} onChange={setName} placeholder="e.g. September 2026" />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <DatePickerField label="Start date" required value={startDate} onChange={changeStartDate} />
        <FormField label="Duration (months)">
          <TextControl type="number" min={1} max={72} value={durationMonths} onChange={changeDurationMonths} />
        </FormField>
        <div>
          <DatePickerField
            label="Practical end date"
            value={practicalEndDate}
            onChange={changePracticalEndDate}
            min={startDate || undefined}
            helper={showPracticalEndReset
              ? 'Set by hand. Clear the field to go back to the calculated date.'
              : 'The start date plus the contracted duration, less a day. Selected holidays do not move this cohort date.'}
          />
          {showPracticalEndReset && (
            <button
              type="button"
              onClick={resetPracticalEndDate}
              className="mt-1 text-[11px] font-bold text-primary-700 transition-smooth hover:text-primary-800 hover:underline"
            >
              Reset to {formatDateLabel(calculatedPracticalEnd)}
            </button>
          )}
        </div>
        <FormField label="EPA period (months)" hint="Blank means none recorded, which is not the same as zero.">
          <TextControl type="number" min={0} max={24} value={epaMonths} onChange={setEpaMonths} />
        </FormField>
        <div>
          <DatePickerField
            label="Apprenticeship end date"
            value={apprenticeshipEndDate}
            onChange={setApprenticeshipEndOverride}
            min={practicalEndDate || startDate || undefined}
            helper={apprenticeshipEndOverride
              ? 'Set by hand. Clear the field to go back to the calculated date.'
              : apprenticeshipEndDate
                ? 'The practical end date plus the EPA period. Pick another date to override it.'
                : 'Set an EPA period, or pick the date this apprenticeship ends.'}
          />
          {apprenticeshipEndOverride && preview?.apprenticeshipEndDate && preview.apprenticeshipEndDate !== apprenticeshipEndOverride && (
            <button
              type="button"
              onClick={() => setApprenticeshipEndOverride('')}
              className="mt-1 text-[11px] font-bold text-primary-700 transition-smooth hover:text-primary-800 hover:underline"
            >
              Reset to {formatDateLabel(preview.apprenticeshipEndDate)}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Contract dates</p>
        {startDate && (practicalEndDate || apprenticeshipEndDate) ? (
          <div className="mt-2 space-y-1.5 text-[12px] text-foreground-700">
            <p><span className="font-bold">Practical:</span> {formatDateLabel(startDate)} – {formatDateLabel(practicalEndDate)}</p>
            <p><span className="font-bold">Apprenticeship:</span> {formatDateLabel(startDate)} – {formatDateLabel(apprenticeshipEndDate)}</p>
            {weekCapacity.totalWeeks > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold">Weeks:</span>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-100 px-2 py-0.5 text-[11px] font-bold text-primary-800">
                  {weekCapacity.totalWeeks} min
                </span>
                {weekCapacity.holidayWeeks > 0 && (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                      +{weekCapacity.holidayDays} {weekCapacity.holidayDays === 1 ? 'day' : 'days'} holiday (~{weekCapacity.holidayWeeks} {weekCapacity.holidayWeeks === 1 ? 'week' : 'weeks'})
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-foreground-200 bg-white px-2 py-0.5 text-[11px] font-bold text-foreground-800">
                      ~{weekCapacity.maxWeeks} max
                    </span>
                  </>
                )}
                {!weekCapacity.holidayWeeks && (
                  <span className="text-[11px] text-foreground-500">no holidays ticked</span>
                )}
              </div>
            )}
            {holidayIds.length > 0 && (
              <p className="text-[11px] text-foreground-500">
                Selected holidays are saved for module scheduling. If a module session clashes with one, that module plan is extended; these cohort contract dates stay fixed.
              </p>
            )}
            {(preview?.warnings || []).map(warning => (
              <p key={warning} className="text-[11px] font-semibold text-amber-700">{warning}</p>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-foreground-500">Set a start date and duration to see the cohort's dates.</p>
        )}
      </div>

      <FormField label="Colour">
        <ColorControl value={color} onChange={setColor} />
      </FormField>

      <FormField
        label={periodLabel ? `Holidays in this cohort's period (${periodLabel})` : 'Holidays'}
        hint={periodLabel
          ? `Only holidays that fall inside ${periodLabel} are listed. Tick the ones that apply to this cohort: when a generated module session lands on one of those dates, that session is skipped and the module end date extends by the clash. The cohort practical and apprenticeship end dates stay fixed.`
          : "Set the start date and duration to narrow this list to the holidays inside the cohort's own period. Ticked holidays are used by module scheduling only: clashing sessions are skipped and the affected module end date extends, while cohort dates stay fixed."}
      >
        <HolidayPicker
          holidays={holidays}
          selected={holidayIds}
          onChange={setHolidayIds}
          periodStart={periodStart}
          periodEnd={periodEnd}
          periodLabel={periodLabel}
        />
      </FormField>

      {weekCapacity.totalWeeks > 0 && (
        <div className="rounded-xl border border-background-200 bg-background-100 p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-500">Weeks in this cohort</p>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border border-primary-200 bg-primary-50 px-2 py-2">
              <p className="text-lg font-heading font-bold text-primary-700">{weekCapacity.totalWeeks}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-primary-700">Minimum</p>
            </div>
            <div className={`rounded-lg border px-2 py-2 ${weekCapacity.holidayWeeks ? 'border-amber-200 bg-amber-50' : 'border-background-200 bg-background-50'}`}>
              <p className={`text-lg font-heading font-bold ${weekCapacity.holidayWeeks ? 'text-amber-700' : 'text-foreground-300'}`}>~{weekCapacity.holidayWeeks}</p>
              <p className={`text-[10px] font-bold uppercase tracking-wide ${weekCapacity.holidayWeeks ? 'text-amber-700' : 'text-foreground-400'}`}>
                Holiday weeks{weekCapacity.holidayDays > 0 ? ` (${weekCapacity.holidayDays}d exact)` : ''}
              </p>
            </div>
            <div className="rounded-lg border border-background-200 bg-background-50 px-2 py-2">
              <p className="text-lg font-heading font-bold text-foreground-900">{weekCapacity.holidayWeeks ? '~' : ''}{weekCapacity.maxWeeks}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-foreground-400">Maximum</p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] leading-5 text-foreground-500">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 font-bold text-primary-800">{weekCapacity.totalWeeks} weeks</span>
            <span>with no holiday ticked{periodLabel ? ` (${periodLabel})` : ''}.</span>
            {weekCapacity.holidayWeeks ? (
              <>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800">
                  {weekCapacity.holidayDays} ticked {weekCapacity.holidayDays === 1 ? 'holiday day' : 'holiday days'} (~{weekCapacity.holidayWeeks} {weekCapacity.holidayWeeks === 1 ? 'week' : 'weeks'})
                </span>
                <span>push a clashing module out by that much, up to roughly</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-foreground-900 px-2 py-0.5 font-bold text-white">~{weekCapacity.maxWeeks} weeks</span>
                <span>— the cohort's own contract dates stay fixed either way.</span>
              </>
            ) : (
              <span>Tick a holiday to see the maximum grow.</span>
            )}
          </div>
        </div>
      )}
    </EntityDrawer>
  );
}

/** How many days a holiday itself spans, start to end inclusive -- shown so a 2-day and a 5-day holiday read differently rather than both just being "a holiday". */
function holidayDaySpan(holiday: CurriculumHoliday): number {
  const start = Date.parse(`${cleanText(holiday.startDate)}T00:00:00Z`);
  const end = Date.parse(`${cleanText(holiday.endDate) || cleanText(holiday.startDate)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

function HolidayPicker({
  holidays,
  selected,
  onChange,
  periodStart,
  periodEnd,
  periodLabel,
}: {
  holidays: CurriculumHoliday[];
  selected: string[];
  onChange: (value: string[]) => void;
  /** Cohort start date. Empty until the form has one. */
  periodStart: string;
  /** Practical end date of the cohort. Empty until the form has one. */
  periodEnd: string;
  /** Human-readable period, empty when the period is not known yet. */
  periodLabel: string;
}) {
  const selectedKeys = useMemo(() => new Set(selected.map(String)), [selected]);
  // The same inclusive overlap test the backend uses (date_ranges_overlap): a
  // holiday belongs to this cohort when it touches the period at all. A holiday
  // already selected but now outside the period keeps its own heading instead of
  // disappearing, so editing the dates can never hide a stored selection.
  const { inPeriod, outsidePeriod } = useMemo(() => {
    if (!periodStart || !periodEnd) return { inPeriod: holidays, outsidePeriod: [] as CurriculumHoliday[] };
    const inside: CurriculumHoliday[] = [];
    const outside: CurriculumHoliday[] = [];
    holidays.forEach(holiday => {
      const holidayStart = cleanText(holiday.startDate);
      const holidayEnd = cleanText(holiday.endDate) || holidayStart;
      if (holidayStart && holidayStart <= periodEnd && holidayEnd >= periodStart) inside.push(holiday);
      else if (selectedKeys.has(String(holiday.id))) outside.push(holiday);
    });
    return { inPeriod: inside, outsidePeriod: outside };
  }, [holidays, periodEnd, periodStart, selectedKeys]);

  if (!holidays.length) {
    return (
      <p className="rounded-lg border border-background-200 bg-background-100 px-3 py-2.5 text-[12px] text-foreground-500">
        No holidays recorded yet. Add them on the Holidays page.
      </p>
    );
  }
  const inPeriodIds = inPeriod.map(holiday => String(holiday.id));
  const selectedInPeriodCount = inPeriodIds.filter(id => selectedKeys.has(id)).length;
  const allInPeriodSelected = inPeriodIds.length > 0 && selectedInPeriodCount === inPeriodIds.length;
  const selectAllInPeriod = () => {
    const next = Array.from(new Set([...selected.map(String), ...inPeriodIds]));
    onChange(next);
  };
  const clearInPeriod = () => {
    const inPeriodSet = new Set(inPeriodIds);
    onChange(selected.map(String).filter(id => !inPeriodSet.has(id)));
  };
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  };
  const holidayRow = (holiday: CurriculumHoliday, outside: boolean) => {
    const id = String(holiday.id);
    const active = selectedKeys.has(id);
    const dayCount = holidayDaySpan(holiday);
    return (
      <button
        key={id}
        type="button"
        onClick={() => toggle(id)}
        className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-smooth ${
          active ? 'border-primary-300 bg-primary-50' : 'border-transparent hover:bg-background-100'
        }`}
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${active ? 'border-primary-600 bg-primary-600 text-white' : 'border-background-300'}`}>
          {active && <AppIcon className="ri-check-line text-[10px]"></AppIcon>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold text-foreground-900">{holiday.label}</span>
            {outside && (
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                Outside period
              </span>
            )}
            {dayCount > 0 && (
              <span className="shrink-0 rounded-full bg-background-200 px-1.5 py-0.5 text-[9px] font-bold text-foreground-600">
                {dayCount} {dayCount === 1 ? 'day' : 'days'}
              </span>
            )}
          </span>
          <span className="block text-[11px] text-foreground-400">
            {formatDateLabel(holiday.startDate)} – {formatDateLabel(holiday.endDate || holiday.startDate)}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      {inPeriod.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-foreground-500">
            {selectedInPeriodCount} of {inPeriod.length} selected
          </p>
          <button
            type="button"
            aria-label={allInPeriodSelected ? 'Clear selected holidays' : 'Select all holidays'}
            onClick={allInPeriodSelected ? clearInPeriod : selectAllInPeriod}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 text-[11px] font-bold text-primary-700 transition-smooth hover:bg-primary-100"
          >
            <AppIcon className={allInPeriodSelected ? 'ri-checkbox-blank-line text-sm' : 'ri-checkbox-multiple-line text-sm'}></AppIcon>
            {allInPeriodSelected ? 'Clear selected holidays' : 'Select all holidays'}
          </button>
        </div>
      )}
      <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-background-200 bg-background-50 p-2">
        {inPeriod.length ? inPeriod.map(holiday => holidayRow(holiday, false)) : (
          <p className="px-1 py-2 text-[12px] text-foreground-500">
            None of the {holidays.length} recorded holidays fall inside {periodLabel || "this cohort's period"}.
          </p>
        )}
        {outsidePeriod.length > 0 && (
          <>
            <p className="px-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-amber-700">
              Selected, but outside this period
            </p>
            {outsidePeriod.map(holiday => holidayRow(holiday, true))}
          </>
        )}
      </div>
      {periodLabel && inPeriod.length > 0 && !selected.length && (
        <p className="text-[11px] font-semibold text-amber-700">
          Nothing ticked: none of the {inPeriod.length} holidays in this period is skipped when module sessions are generated.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- group

export interface GroupFormDefaults {
  programmeId?: string;
  cohortId?: string;
}

export function GroupFormDrawer({
  open,
  group,
  defaults,
  programmes,
  cohorts,
  coachNames,
  lockCohort = false,
  chain,
  onClose,
  onSaved,
}: {
  open: boolean;
  group?: CurriculumGroup | null;
  defaults?: GroupFormDefaults;
  programmes: CurriculumProgramme[];
  cohorts: CurriculumCohort[];
  coachNames: string[];
  /** True inside a Cohort workspace, where the parent is not up for debate. */
  lockCohort?: boolean;
  /** Set when the structure wizard is driving this form as one step of a chain. */
  chain?: FormChainStep;
  onClose: () => void;
  /** Handed the record the save wrote, so the list can paint it immediately. */
  onSaved: (result?: { group: CurriculumGroup }) => unknown | Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [programmeId, setProgrammeId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [coach, setCoach] = useState('');
  const [weekDays, setWeekDays] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('11:00');
  const [color, setColor] = useState('#2563eb');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the drawer opened with, for the unsaved-changes check below.
  const baseline = useRef<Record<string, unknown>>({});

  const dirty = !sameFormValues(
    { name, programmeId, cohortId, coach, weekDays, startTime, endTime, color },
    baseline.current,
  );
  // `cohorts` is a dependency of the seeding effect and gets a new identity on
  // every background refresh; without this a reload landing mid-edit reset the
  // form. See useFormSeedGuard.
  const allowSeed = useFormSeedGuard(dirty);

  useEffect(() => {
    if (!allowSeed(open, cleanText(group?.id) || 'new-group')) return;
    setError(null);
    setSaving(false);
    if (group) {
      const parent = cohorts.find(cohort => normaliseKey(cohort.id) === normaliseKey(group.cohortId));
      const initial = {
        name: group.name || '',
        programmeId: cleanText(parent?.programmeId) || cleanText(group.programmeId) || cleanText(group.programme),
        cohortId: cleanText(group.cohortId),
        coach: normaliseKey(group.coach) === 'unassigned' ? '' : cleanText(group.coach),
        weekDays: cleanText(group.weekDays),
        startTime: cleanText(group.startTime) || '09:00',
        endTime: cleanText(group.endTime) || '11:00',
        color: group.color || '#2563eb',
      };
      baseline.current = initial;
      setName(initial.name);
      setProgrammeId(initial.programmeId);
      setCohortId(initial.cohortId);
      setCoach(initial.coach);
      setWeekDays(initial.weekDays);
      setStartTime(initial.startTime);
      setEndTime(initial.endTime);
      setColor(initial.color);
      return;
    }
    const parent = cohorts.find(cohort => normaliseKey(cohort.id) === normaliseKey(defaults?.cohortId));
    const initial = {
      name: '',
      programmeId: cleanText(parent?.programmeId) || defaults?.programmeId || '',
      cohortId: defaults?.cohortId || '',
      coach: '',
      weekDays: '',
      startTime: '09:00',
      endTime: '11:00',
      color: '#2563eb',
    };
    baseline.current = initial;
    setName(initial.name);
    setProgrammeId(initial.programmeId);
    setCohortId(initial.cohortId);
    setCoach(initial.coach);
    setWeekDays(initial.weekDays);
    setStartTime(initial.startTime);
    setEndTime(initial.endTime);
    setColor(initial.color);
  }, [allowSeed, cohorts, defaults?.cohortId, defaults?.programmeId, group, open]);

  const programmeOptions = useMemo(
    () => programmes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [programmes],
  );
  const availableCohorts = useMemo(
    () => cohortsForProgramme(cohorts, programmes, programmeId),
    [cohorts, programmeId, programmes],
  );

  const submit = async () => {
    if (!name.trim()) { setError('Give the group a name.'); return; }
    if (!cohortId) { setError('Choose the cohort this group belongs to.'); return; }

    setSaving(true);
    setError(null);
    try {
      // Only cohortId is sent as a parent. The backend reads the programme off
      // the cohort, which is what keeps Programme -> Cohort -> Group intact.
      const payload = { name: name.trim(), cohortId, coach, weekDays, startTime, endTime, color };
      // Status is deliberately absent: a group's status is not shown anywhere, and
      // the group PATCH only writes it when the key is present, so leaving it out
      // keeps whatever is stored.
      let saved: CurriculumGroup | null = null;
      if (group) {
        await updateCurriculumGroup(group.id, payload);
        saved = { ...group, ...payload };
      } else {
        saved = (await createCurriculumGroup(payload)).group || null;
      }
      // See the programme form: in a chain the wizard owns closing and confirming.
      if (chain?.chained) {
        await onSaved(saved ? { group: saved } : undefined);
        return;
      }
      onClose();
      // As with the cohort drawer: confirm now, refresh behind it.
      const refreshed = Promise.resolve(onSaved(saved ? { group: saved } : undefined))
        .catch(() => undefined);
      await showCurriculumAlert({
        title: group ? 'Group updated' : 'Group created',
        text: `${payload.name} is saved against its cohort.`,
        timer: 1800,
      });
      await refreshed;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The group could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <EntityDrawer
      open={open}
      title={group ? 'Edit group' : 'Add group'}
      subtitle="Programme only narrows the cohort list. The group is stored against the cohort."
      banner={chain?.banner}
      onClose={onClose}
      onSubmit={submit}
      closeConfirm={chain?.closeConfirm}
      submitLabel={chain?.submitLabel || (group ? 'Save group' : 'Create group')}
      cancelLabel={chain?.cancelLabel}
      extraAction={chain?.extraAction}
      backAction={chain?.backAction}
      width={chain?.width}
      saving={saving}
      error={error}
      dirty={dirty}
    >
      {!lockCohort && (
        <>
          <FormField label="Programme" hint="Filters the cohorts below.">
            <SelectControl
              value={programmeId}
              onChange={value => { setProgrammeId(value); setCohortId(''); }}
              options={programmeOptions}
              placeholder="All programmes"
            />
          </FormField>
          <FormField label="Cohort" required>
            <SelectControl
              value={cohortId}
              onChange={setCohortId}
              options={availableCohorts.map(cohort => ({ value: cohort.id, label: `${cohort.name} · ${cohort.programme}` }))}
              placeholder={availableCohorts.length ? 'Select a cohort' : 'No cohorts for this programme'}
            />
          </FormField>
        </>
      )}
      <FormField label="Group name" required>
        <TextControl value={name} onChange={setName} placeholder="e.g. Group A" />
      </FormField>
      <FormField label="Coach">
        <SelectControl
          value={coach}
          onChange={setCoach}
          options={coachNames.map(coachName => ({ value: coachName, label: coachName }))}
          placeholder="Unassigned"
        />
      </FormField>
      <FormField label="Delivery days">
        <WeekdayControl value={weekDays} onChange={setWeekDays} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Start time">
          <TextControl type="time" value={startTime} onChange={setStartTime} />
        </FormField>
        <FormField label="End time">
          <TextControl type="time" value={endTime} onChange={setEndTime} />
        </FormField>
      </div>
      <FormField label="Colour">
        <ColorControl value={color} onChange={setColor} />
      </FormField>
    </EntityDrawer>
  );
}
