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
import { cleanText, cohortsForProgramme, formatDateLabel, normaliseKey, programmeIdentity, sameFormValues, sameIdentifier } from './model';
import {
  ColorControl,
  EntityDrawer,
  FormField,
  SelectControl,
  TextAreaControl,
  TextControl,
  WeekdayControl,
} from './ui';
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
  onClose,
  onSaved,
}: {
  open: boolean;
  programme?: CurriculumProgramme | null;
  onClose: () => void;
  onSaved: () => unknown | Promise<unknown>;
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
      level: cleanText(programme?.level),
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
        level: level.trim(),
        description: description.trim(),
        color,
      };
      if (programme) await updateCurriculumProgramme(programmeIdentity(programme), payload);
      else await createCurriculumProgramme(payload);
      onClose();
      await onSaved();
      await showCurriculumAlert({
        title: programme ? 'Programme updated' : 'Programme created',
        text: programme
          ? `${payload.name} is saved.`
          : `${payload.name} is saved. Add a cohort whenever you are ready.`,
        timer: 2200,
      });
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
      subtitle="Programme-level details only. Cohorts, groups and modules are added later, from their own pages."
      onClose={onClose}
      onSubmit={submit}
      submitLabel={programme ? 'Save programme' : 'Create programme'}
      saving={saving}
      error={error}
      dirty={dirty}
    >
      <FormField label="Programme name" required>
        <TextControl value={name} onChange={setName} placeholder="e.g. Data Analyst" />
      </FormField>
      <FormField label="Level">
        <TextControl value={level} onChange={setLevel} placeholder="e.g. 4" />
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
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Present when editing; absent when creating. */
  cohort?: CurriculumCohort | null;
  defaults?: CohortFormDefaults;
  programmes: CurriculumProgramme[];
  holidays: CurriculumHoliday[];
  onClose: () => void;
  onSaved: () => unknown | Promise<unknown>;
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

  useEffect(() => {
    if (!open) return;
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
  }, [cohort, defaults?.programmeId, open, programmes]);

  // Only an authored date is sent to the preview: in automatic mode the backend
  // works the practical end out from the start date and duration, and the field
  // below mirrors whatever comes back.
  const authoredPracticalEnd = practicalEndIsManual ? practicalEndDate : '';

  // The date ranges the practical end date is extended by. An empty tick list
  // means every holiday in the period applies -- the same fallback the picker
  // states and the session generator uses -- so an untouched cohort's dates
  // cannot disagree with the sessions it will actually produce.
  const selectedHolidayRanges = useMemo(() => {
    const base = preview?.baseEndDate || '';
    if (!startDate || !base) return [] as { startDate: string; endDate: string }[];
    const ticked = new Set(holidayIds.map(normaliseKey));
    const inPeriod = holidays.filter(holiday => {
      const holidayStart = cleanText(holiday.startDate);
      const holidayEnd = cleanText(holiday.endDate) || holidayStart;
      return Boolean(holidayStart) && holidayStart <= base && holidayEnd >= startDate;
    });
    const applied = ticked.size
      ? inPeriod.filter(holiday => ticked.has(normaliseKey(holiday.id)))
      : inPeriod;
    // The label travels with the range so the hint can name the holiday that
    // moved the date rather than only reporting a total.
    return applied.map(holiday => ({
      label: cleanText(holiday.label),
      startDate: cleanText(holiday.startDate),
      endDate: cleanText(holiday.endDate) || cleanText(holiday.startDate),
    }));
  }, [holidayIds, holidays, preview?.baseEndDate, startDate]);

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
        holidays: selectedHolidayRanges,
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
  }, [apprenticeshipEndOverride, authoredPracticalEnd, durationMonths, epaMonths, open, selectedHolidayRanges, startDate]);

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

  // What the hint above the dates reports. Null unless holidays actually moved
  // the practical end date: an authored date wins over the extension, and there
  // is nothing to explain when the duration rule stands on its own.
  const holidayExtension = useMemo(() => {
    const days = preview?.holidayExtensionDays || 0;
    const items = preview?.holidayExtensions || [];
    if (!days || !items.length || practicalEndIsManual) return null;
    return {
      days,
      items,
      baseEndDate: preview?.baseEndDate || '',
      contractedMonths: preview?.durationMonths || Number(durationMonths) || 0,
      // Only worth stating when it actually differs from the contracted figure.
      effectiveMonths:
        preview?.effectiveDurationMonths && preview.effectiveDurationMonths !== (preview?.durationMonths || 0)
          ? preview.effectiveDurationMonths
          : 0,
    };
  }, [durationMonths, practicalEndIsManual, preview]);

  // The cohort period the holidays below are measured against: start date ->
  // the *base* practical end, which is start plus duration before any holiday
  // extension. The extended date must not be used here: it grows with every
  // holiday picked, which would reveal holidays past the original window whose
  // selection would grow it again. The backend pins the same base window
  // (cohort_holiday_details / holiday_extension_days in curriculum_api/views.py).
  const periodStart = startDate;
  const periodEnd = preview?.baseEndDate || practicalEndDate || preview?.practicalEndDate || preview?.endDate || cohort?.practicalEndDate || cohort?.endDate || '';
  const periodLabel = periodStart && periodEnd ? `${formatDateLabel(periodStart)} – ${formatDateLabel(periodEnd)}` : '';

  const programmeOptions = useMemo(
    () => programmes.map(programme => ({ value: programmeIdentity(programme), label: programme.name })),
    [programmes],
  );

  // Only an authored practical end date counts as an edit: in automatic mode the
  // field mirrors whatever the backend preview returns, which is not something
  // the user typed and must not make an untouched drawer ask before it closes.
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
      if (cohort) await updateCurriculumCohort(cohort.id, payload);
      else await createCurriculumCohort(payload);
      onClose();
      await onSaved();
      await showCurriculumAlert({
        title: cohort ? 'Cohort updated' : 'Cohort created',
        text: `${payload.name} is saved against ${payload.programme}.`,
        timer: 1800,
      });
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
      onClose={onClose}
      onSubmit={submit}
      submitLabel={cohort ? 'Save cohort' : 'Create cohort'}
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
              : preview?.holidayExtensionDays
                ? `The start date plus the duration, less a day, plus the ${preview.holidayExtensionDays} day${preview.holidayExtensionDays === 1 ? '' : 's'} the selected holidays take. Pick another date to override it.`
                : 'The start date plus the duration, less a day. Pick another date to override it.'}
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
        <p className="text-[10px] font-bold uppercase tracking-wider text-primary-700">Learner dates</p>
        {startDate && (practicalEndDate || apprenticeshipEndDate) ? (
          <div className="mt-2 space-y-1.5 text-[12px] text-foreground-700">
            <p><span className="font-bold">Practical:</span> {formatDateLabel(startDate)} – {formatDateLabel(practicalEndDate)}</p>
            <p><span className="font-bold">Apprenticeship:</span> {formatDateLabel(startDate)} – {formatDateLabel(apprenticeshipEndDate)}</p>
            {holidayExtension && (
              // Why the dates below are not simply start + duration. The
              // contracted duration is unchanged -- what moved is when the
              // cohort actually finishes -- so the hint names each holiday and
              // its dates instead of leaving the reader with a bare total.
              <div className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="flex items-start gap-1.5 text-[11px] font-bold text-amber-800">
                  <AppIcon name="ri-information-line" className="mt-px shrink-0 text-[13px]" />
                  <span>
                    Extended by {holidayExtension.days} day{holidayExtension.days === 1 ? '' : 's'} of holiday.
                    {holidayExtension.effectiveMonths
                      ? ` The duration stays ${holidayExtension.contractedMonths} months, but the cohort now runs ${holidayExtension.effectiveMonths} months to its practical end date.`
                      : ''}
                  </span>
                </p>
                <ul className="mt-1.5 space-y-1 pl-[18px]">
                  {holidayExtension.items.map(item => (
                    <li key={`${item.label}-${item.startDate}`} className="text-[11px] text-amber-800">
                      <span className="font-semibold">{item.label || 'Holiday'}</span>
                      {' — '}
                      {formatDateLabel(item.startDate)}
                      {item.endDate && item.endDate !== item.startDate ? ` – ${formatDateLabel(item.endDate)}` : ''}
                      {` (+${item.days} day${item.days === 1 ? '' : 's'})`}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 pl-[18px] text-[11px] text-amber-700">
                  Practical end date moved from {formatDateLabel(holidayExtension.baseEndDate)} to {formatDateLabel(practicalEndDate)}.
                </p>
              </div>
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
          ? `Only holidays that fall inside ${periodLabel} are listed — the cohort's start date plus its duration, before any holiday extension. Selected holidays are skipped when this cohort's module sessions are generated, and the days they take push the practical and apprenticeship end dates out to match.`
          : "Set the start date and duration to narrow this list to the holidays inside the cohort's own period. Selected holidays are skipped when this cohort's module sessions are generated, and the days they take push the practical and apprenticeship end dates out to match."}
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
    </EntityDrawer>
  );
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
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id]);
  };
  const holidayRow = (holiday: CurriculumHoliday, outside: boolean) => {
    const id = String(holiday.id);
    const active = selectedKeys.has(id);
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
          Nothing ticked: generated sessions fall back to skipping all {inPeriod.length} holidays in this period. Tick the ones that apply to limit that.
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
  onClose: () => void;
  onSaved: () => unknown | Promise<unknown>;
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

  useEffect(() => {
    if (!open) return;
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
  }, [cohorts, defaults?.cohortId, defaults?.programmeId, group, open]);

  const dirty = !sameFormValues(
    { name, programmeId, cohortId, coach, weekDays, startTime, endTime, color },
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
      if (group) await updateCurriculumGroup(group.id, payload);
      else await createCurriculumGroup(payload);
      onClose();
      await onSaved();
      await showCurriculumAlert({
        title: group ? 'Group updated' : 'Group created',
        text: `${payload.name} is saved against its cohort.`,
        timer: 1800,
      });
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
      onClose={onClose}
      onSubmit={submit}
      submitLabel={group ? 'Save group' : 'Create group'}
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
