import { useMemo, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { showCurriculumAlert, showCurriculumConfirm } from '@/components/feature/CurriculumSweetAlert';
import { curriculumNavItems } from '@/mocks/navigation';
import { useCurriculumEntities } from '@/hooks/useCurriculumEntities';
import {
  archiveCurriculumHoliday,
  createCurriculumHoliday,
  updateCurriculumHoliday,
  type CurriculumHoliday,
} from '@/lib/curriculumApi';
import { cleanText, formatDateLabel, matchesSearch, normaliseKey } from '../shared/entities/model';
import {
  EntityDrawer,
  EntityEmptyState,
  EntityFilterBar,
  EntityHero,
  EntityTable,
  FormField,
  InlineError,
  PlainCell,
  RowActions,
  StackedCell,
  TextControl,
} from '../shared/entities/ui';
import { useDrawerState } from '../shared/entities/useDrawerState';
import { HolidayTypeControl, type HolidayTypeOption } from './HolidayTypeControl';

// Holidays used to be reachable only from inside the structure wizard, which
// made a calendar-wide concern a side effect of editing one programme. They are
// their own records, so they get their own page.
//
// A holiday changes dates by being *selected on a cohort*: the cohort's session
// plan then skips it. This page therefore shows which cohorts have selected each
// holiday, so the effect of deleting one is visible before it happens.

const GRID = 'grid grid-cols-[minmax(190px,1.4fr)_130px_130px_100px_minmax(160px,1.1fr)_120px_92px]';

const COLUMNS = [
  { label: 'Holiday' },
  { label: 'Start' },
  { label: 'End' },
  { label: 'Days', align: 'center' as const },
  { label: 'Used by cohorts' },
  { label: 'Type' },
  { label: 'Actions', align: 'right' as const },
];

// Ready-made names offered inside the drawer's add-a-type form. They are not
// types until a holiday carries one: the `holidays` table is the only place a
// type is kept, so a name nobody has used cannot be renamed or removed and has
// no business sitting in the list as though it could.
const TYPE_SUGGESTIONS: Array<{ name: string; color: string }> = [
  { name: 'Bank holiday', color: '#dc2626' },
  { name: 'College closure', color: '#ea580c' },
  { name: 'Half term', color: '#2563eb' },
  { name: 'Christmas', color: '#16a34a' },
  { name: 'Easter', color: '#be123c' },
  { name: 'Summer', color: '#0f766e' },
  { name: 'Exam week', color: '#7c3aed' },
  { name: 'Staff training', color: '#0891b2' },
];

const DEFAULT_TYPE_COLOR = '#dc2626';

interface HolidayForm {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  type: string;
  color: string;
}

const EMPTY_FORM: HolidayForm = {
  id: '',
  label: '',
  startDate: '',
  endDate: '',
  type: '',
  color: DEFAULT_TYPE_COLOR,
};

function inclusiveDays(holiday: CurriculumHoliday) {
  const start = new Date(holiday.startDate);
  const end = new Date(holiday.endDate || holiday.startDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

export default function CurriculumHolidaysPage() {
  const { cohorts, holidays, loading, loaded, error, reload } = useCurriculumEntities({ includeHolidays: true });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  // Types added in the drawer but not saved against a holiday yet. They live
  // here rather than in the form so a type stays offered while the user fills
  // the rest of the holiday in.
  const [draftTypes, setDraftTypes] = useState<Array<{ name: string; color: string }>>([]);
  const drawer = useDrawerState<HolidayForm>(EMPTY_FORM);

  const cohortsByHoliday = useMemo(() => {
    const map = new Map<string, string[]>();
    cohorts.forEach(cohort => {
      (cohort.holidayIds || []).forEach(id => {
        const key = normaliseKey(id);
        if (!key) return;
        map.set(key, [...(map.get(key) || []), cohort.name]);
      });
    });
    return map;
  }, [cohorts]);

  const types = useMemo(
    () => Array.from(new Set(holidays.map(holiday => cleanText(holiday.type)).filter(Boolean))).sort(),
    [holidays],
  );

  // The Type list in the drawer: every type the saved holidays carry — the most
  // used first, since that is the one a new holiday most likely needs — then
  // anything added here and not saved yet. The stored spelling and colour are
  // used as they are; they are what the calendar already shows.
  const typeOptions = useMemo<HolidayTypeOption[]>(() => {
    const byKey = new Map<string, HolidayTypeOption>();
    holidays.forEach(holiday => {
      const name = cleanText(holiday.type);
      if (!name) return;
      const key = normaliseKey(name);
      const existing = byKey.get(key);
      byKey.set(key, {
        name: existing?.name || name,
        color: existing?.color || cleanText(holiday.color) || DEFAULT_TYPE_COLOR,
        usedBy: (existing?.usedBy || 0) + 1,
      });
    });
    const saved = [...byKey.values()].sort(
      (a, b) => b.usedBy - a.usedBy || a.name.localeCompare(b.name),
    );
    const drafts = draftTypes
      .filter(draft => !byKey.has(normaliseKey(draft.name)))
      .map<HolidayTypeOption>(draft => ({ ...draft, usedBy: 0, draft: true }));
    return [...saved, ...drafts];
  }, [draftTypes, holidays]);

  // Only names the calendar has not used yet are worth suggesting.
  const typeSuggestions = useMemo(
    () => TYPE_SUGGESTIONS.filter(
      suggestion => !typeOptions.some(type => normaliseKey(type.name) === normaliseKey(suggestion.name)),
    ),
    [typeOptions],
  );

  const holidaysWithType = (name: string) => holidays.filter(
    holiday => normaliseKey(holiday.type) === normaliseKey(name),
  );

  const visibleHolidays = useMemo(() => {
    const sorted = [...holidays].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    return sorted.filter(holiday => {
      if (typeFilter && normaliseKey(holiday.type) !== normaliseKey(typeFilter)) return false;
      return matchesSearch(search, [holiday.label, holiday.type, holiday.startDate, holiday.endDate]);
    });
  }, [holidays, search, typeFilter]);

  // A new type is only a piece of text until a holiday carries it, so adding one
  // selects it on the open form and waits for the save.
  const createType = (name: string, color: string) => {
    setDraftTypes(previous => (
      previous.some(draft => normaliseKey(draft.name) === normaliseKey(name))
        ? previous
        : [...previous, { name, color }]
    ));
    drawer.patch({ type: name, color });
  };

  // Renaming or recolouring a type means rewriting the holidays that carry it —
  // there is nowhere else the type is kept.
  const renameType = async (type: HolidayTypeOption, name: string, color: string) => {
    const renamed = normaliseKey(name) !== normaliseKey(type.name);
    const recoloured = normaliseKey(color) !== normaliseKey(type.color);
    if (!renamed && !recoloured) return;
    const selected = normaliseKey(drawer.form.type) === normaliseKey(type.name);

    const affected = holidaysWithType(type.name);
    if (!affected.length) {
      setDraftTypes(previous => previous.map(draft => (
        normaliseKey(draft.name) === normaliseKey(type.name) ? { name, color } : draft
      )));
      if (selected) drawer.patch({ type: name, color });
      return;
    }

    await showCurriculumConfirm({
      title: renamed ? 'Rename this type?' : 'Recolour this type?',
      text: `${affected.length} holiday${affected.length === 1 ? '' : 's'} carry "${type.name}"`
        + `${renamed ? ` and will be saved as "${name}"` : ''}`
        + `${recoloured ? `${renamed ? ', and take' : ' and will take'} the new colour` : ''}.`
        + ' Their dates and the cohorts that selected them do not change.',
      icon: 'warning',
      confirmButtonText: renamed ? 'Rename type' : 'Recolour type',
      onConfirm: async () => {
        for (const holiday of affected) {
          await updateCurriculumHoliday(holiday.id, { type: name, color });
        }
        await reload({ silent: true });
        if (selected) drawer.patch({ type: name, color });
        if (normaliseKey(typeFilter) === normaliseKey(type.name)) setTypeFilter(name);
      },
      successTitle: 'Type updated',
    });
  };

  // Removing a type clears the text on the holidays that carry it; the holidays
  // themselves stay, because a holiday is what shifts the sessions, not its type.
  const deleteType = async (type: HolidayTypeOption) => {
    const selected = normaliseKey(drawer.form.type) === normaliseKey(type.name);
    const affected = holidaysWithType(type.name);
    if (!affected.length) {
      setDraftTypes(previous => previous.filter(draft => normaliseKey(draft.name) !== normaliseKey(type.name)));
      if (selected) drawer.patch({ type: '' });
      return;
    }

    await showCurriculumConfirm({
      title: 'Remove this type?',
      text: `${affected.length} holiday${affected.length === 1 ? '' : 's'} carry "${type.name}".`
        + ' Removing the type leaves those holidays, their dates and the cohorts that selected them exactly as they are —'
        + ' they simply show no type until one is set.',
      icon: 'warning',
      confirmButtonText: 'Remove type',
      onConfirm: async () => {
        for (const holiday of affected) {
          await updateCurriculumHoliday(holiday.id, { type: '' });
        }
        await reload({ silent: true });
        if (selected) drawer.patch({ type: '' });
        if (normaliseKey(typeFilter) === normaliseKey(type.name)) setTypeFilter('');
      },
      successTitle: 'Type removed',
    });
  };

  const save = async () => {
    const form = drawer.form;
    if (!form.label.trim()) { drawer.setError('Give the holiday a name.'); return; }
    if (!form.startDate) { drawer.setError('Set the start date.'); return; }
    if (form.endDate && form.endDate < form.startDate) {
      drawer.setError('The end date cannot be before the start date.');
      return;
    }

    drawer.setSaving(true);
    drawer.setError(null);
    try {
      const payload = {
        label: form.label.trim(),
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        type: form.type,
        color: form.color,
      };
      if (form.id) await updateCurriculumHoliday(form.id, payload);
      else await createCurriculumHoliday(payload);
      drawer.close();
      await reload({ silent: true });
      await showCurriculumAlert({
        title: form.id ? 'Holiday updated' : 'Holiday added',
        text: `${payload.label} is saved. Cohorts that select it will skip these dates.`,
        timer: 1800,
      });
    } catch (err) {
      drawer.setError(err instanceof Error ? err.message : 'The holiday could not be saved.');
    } finally {
      drawer.setSaving(false);
    }
  };

  const archive = async (holiday: CurriculumHoliday) => {
    const users = cohortsByHoliday.get(normaliseKey(holiday.id)) || [];
    await showCurriculumConfirm({
      title: 'Archive holiday?',
      text: users.length
        ? `${holiday.label} is selected by ${users.length} cohort${users.length === 1 ? '' : 's'} (${users.slice(0, 3).join(', ')}${users.length > 3 ? '…' : ''}). Archiving it stops it shifting future session dates. Sessions already generated keep their dates.`
        : `${holiday.label} will be archived. No cohort currently selects it.`,
      icon: 'warning',
      confirmButtonText: 'Archive holiday',
      onConfirm: async () => {
        await archiveCurriculumHoliday(holiday.id);
        await reload({ silent: true });
      },
      successTitle: 'Holiday archived',
    });
  };

  return (
    <WorkspaceShell
      role="curriculum"
      roleLabel="Curriculum Designer"
      navItems={curriculumNavItems}
      workspaceLabel="Curriculum Studio"
      pageTitle="Holidays"
      pageSubtitle="Non-delivery dates that shift generated sessions for the cohorts that select them"
      userName="Rachel Myers"
      userRole="Curriculum Designer"
    >
      <div className="min-h-full space-y-5 bg-background-50 p-4 sm:p-6">
        <EntityHero
          eyebrow="Curriculum Studio"
          title="Holidays"
          description="Maintain the holiday calendar once, here. A cohort selects the holidays that apply to it, and its modules' session dates skip them."
          loading={loading && !loaded}
          stats={[
            { icon: 'ri-calendar-close-line', label: 'Holidays', value: holidays.length },
            { icon: 'ri-time-line', label: 'Non-delivery days', value: holidays.reduce((sum, holiday) => sum + inclusiveDays(holiday), 0) },
            { icon: 'ri-price-tag-3-line', label: 'Types', value: types.length },
            { icon: 'ri-calendar-event-line', label: 'Cohorts using them', value: cohortsByHoliday.size ? cohorts.filter(cohort => (cohort.holidayIds || []).length).length : 0 },
          ]}
          primaryAction={{ label: 'Add Holiday', onClick: () => drawer.openWith(EMPTY_FORM) }}
        />

        {error && <InlineError message={error} onRetry={() => void reload()} />}

        <EntityFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="Search holidays..."
          selects={[
            {
              label: 'Type',
              value: typeFilter,
              onChange: setTypeFilter,
              options: [{ value: '', label: 'All types' }, ...types.map(type => ({ value: type, label: type }))],
            },
          ]}
          onReset={() => { setSearch(''); setTypeFilter(''); }}
          summary={loaded ? `Showing ${visibleHolidays.length} of ${holidays.length} holidays` : undefined}
        />

        <EntityTable
          columns={COLUMNS}
          gridClass={GRID}
          rows={visibleHolidays}
          rowKey={holiday => String(holiday.id)}
          loading={loading && !loaded}
          empty={(
            <EntityEmptyState
              icon="ri-calendar-close-line"
              title={holidays.length ? 'No holidays match these filters' : 'No holidays yet'}
              message={holidays.length
                ? 'Clear a filter, or search for a different holiday.'
                : 'Add the dates the college is closed so session plans can skip them.'}
              action={holidays.length ? undefined : { label: 'Add Holiday', onClick: () => drawer.openWith(EMPTY_FORM) }}
            />
          )}
          renderRow={holiday => {
            const users = cohortsByHoliday.get(normaliseKey(holiday.id)) || [];
            return (
              <>
                <StackedCell
                  primary={(
                    <span className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: holiday.color || '#dc2626' }} />
                      {holiday.label}
                    </span>
                  )}
                  secondary={`ID ${holiday.id}`}
                />
                <PlainCell>{formatDateLabel(holiday.startDate)}</PlainCell>
                <PlainCell>{formatDateLabel(holiday.endDate || holiday.startDate)}</PlainCell>
                <PlainCell align="center">{inclusiveDays(holiday)}</PlainCell>
                <PlainCell>{users.length ? users.join(', ') : 'Not selected by any cohort'}</PlainCell>
                <PlainCell>{cleanText(holiday.type, '—')}</PlainCell>
                <RowActions
                  actions={[
                    {
                      icon: 'ri-edit-line',
                      label: 'Edit holiday',
                      onClick: () => drawer.openWith({
                        id: String(holiday.id),
                        label: holiday.label || '',
                        startDate: holiday.startDate || '',
                        endDate: holiday.endDate || '',
                        type: cleanText(holiday.type),
                        color: holiday.color || '#dc2626',
                      }),
                    },
                    { icon: 'ri-archive-line', label: 'Archive holiday', tone: 'danger', onClick: () => void archive(holiday) },
                  ]}
                />
              </>
            );
          }}
        />
      </div>

      <EntityDrawer
        open={drawer.open}
        title={drawer.form.id ? 'Edit holiday' : 'Add holiday'}
        subtitle="Holidays only change dates for cohorts that select them — set that on the cohort."
        onClose={drawer.close}
        onSubmit={save}
        submitLabel={drawer.form.id ? 'Save holiday' : 'Add holiday'}
        saving={drawer.saving}
        error={drawer.error}
        dirty={drawer.dirty}
        width="w-[460px]"
      >
        <FormField label="Name" required>
          <TextControl value={drawer.form.label} onChange={value => drawer.patch({ label: value })} placeholder="e.g. Christmas closure" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Start date" required>
            <TextControl type="date" value={drawer.form.startDate} onChange={value => drawer.patch({ startDate: value })} />
          </FormField>
          <FormField label="End date" hint="Leave blank for a single day.">
            <TextControl type="date" value={drawer.form.endDate} onChange={value => drawer.patch({ endDate: value })} />
          </FormField>
        </div>
        <HolidayTypeControl
          types={typeOptions}
          suggestions={typeSuggestions}
          value={drawer.form.type}
          disabled={drawer.saving}
          onSelect={type => drawer.patch({ type: type.name, color: type.color })}
          onCreate={createType}
          onRename={(type, name, color) => void renameType(type, name, color)}
          onDelete={type => void deleteType(type)}
        />
      </EntityDrawer>
    </WorkspaceShell>
  );
}
