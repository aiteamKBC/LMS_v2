import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { fetchProgrammes, fetchCohorts, fetchGroups } from '@/api/curriculum';
import { fetchCaseOwners } from '@/api/staffUsers';
import { createEnrolmentUser } from '@/api/enrolmentUsers';
import { listEmployers, type EmployerRow } from '@/api/employers';
import { COUNTRY_OPTIONS as ALL_COUNTRIES, DEFAULT_COUNTRY } from '@/lib/countries';
import type { UserListRow } from '../types';
import { Modal } from './Modal';
import { formatError } from '../wizard/steps/fields';
import { inputClass, btnPrimary, btnSecondary } from './ui';

// ============================================================================
// Create user — Aptem-shaped "Add user" form, opened from the Users list.
//
// The layout mirrors Aptem's own Add-user screen (label column on the left,
// field on the right, grouped into sections) so staff moving between the two
// systems see the same fields in the same order.
//
// Both learner kinds live in the SINGLE enrolment."Enrolment_Users" table. The
// learner type at the foot of the form is written to its "Learner_type" column,
// so there's one endpoint and one destination — no field is lost either way.
// ============================================================================

type LearnerKind = 'apprenticeship' | 'commercial';

type FieldType = 'text' | 'email' | 'tel' | 'date' | 'select' | 'radio' | 'checkbox' | 'textarea';

interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  /** Shown under the field as muted helper text. */
  hint?: string;
  /** Restrict this field to one destination table (default: both). */
  only?: LearnerKind;
  /**
   * Options are loaded from the database rather than given in `options`.
   * The programme/cohort/group trio is a cascade — each level stays disabled
   * until its parent is chosen. `caseOwner` and `employer` are independent,
   * loaded once.
   */
  lookup?: 'programme' | 'cohort' | 'group' | 'caseOwner' | 'employer';
  /**
   * This field's value is filled in from another field rather than typed. Shown
   * read-only, since editing it would just be overwritten by the next change to
   * its source — and a value that disagrees with the employer record would be
   * worse than no value.
   */
  derivedFrom?: 'employer';
}

interface SectionDef {
  title: string;
  icon: string;
  fields: FieldDef[];
}

const opts = (values: string[]) => values.map((v) => ({ value: v, label: v }));

const YES_NO = [
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
];

const GENDER_OPTIONS = opts(['Male', 'Female', 'Prefer not to say']);
// The full country list, shared with the employer and organisation forms. Still
// UK-first — see src/lib/countries.ts.
const COUNTRY_OPTIONS = opts(ALL_COUNTRIES);
const PROVIDER_OPTIONS = opts(['Kent Business College']);

// The form, section by section, in Aptem's order.
const SECTIONS: SectionDef[] = [
  {
    title: 'Invitation',
    icon: 'ri-mail-send-line',
    fields: [
      {
        name: 'inviteToPlatform',
        label: 'Would you like to invite this user into the platform?',
        type: 'radio',
        options: YES_NO,
        hint: 'Choosing “Yes” flags the record so an invitation email can be sent after enrolment.',
      },
    ],
  },
  {
    title: 'Identity',
    icon: 'ri-user-line',
    fields: [
      { name: 'firstName', label: 'First name', type: 'text', required: true, placeholder: 'firstname' },
      { name: 'lastName', label: 'Surname', type: 'text', required: true, placeholder: 'lastname' },
      { name: 'preferredName', label: 'Preferred name', type: 'text', placeholder: 'e.g. Soph' },
      { name: 'title', label: 'Title', type: 'text', placeholder: 'title' },
      { name: 'gender', label: 'Gender', type: 'radio', options: GENDER_OPTIONS },
      { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@youremail.com' },
      { name: 'phone', label: 'Mobile', type: 'tel', placeholder: 'NNN NNNN NNNN or +NNN NNN NNN NNNN' },
      { name: 'dob', label: 'Date of birth', type: 'date' },
      { name: 'niNumber', label: 'National Insurance number', type: 'text', placeholder: 'AB123456A' },
    ],
  },
  {
    title: 'Referral',
    icon: 'ri-share-forward-line',
    fields: [
      { name: 'referrer', label: 'Referrer', type: 'text', placeholder: 'e.g. Jobcentre Plus' },
      { name: 'referrerAddress', label: 'Referrer address', type: 'text' },
      { name: 'referrerContact', label: 'Referrer contact', type: 'text' },
    ],
  },
  {
    title: 'Programme',
    icon: 'ri-book-open-line',
    // Programme -> Cohort -> Group is a live cascade off the `curriculum` schema
    // (programmes / cohorts / groups), so only real authored combinations can be
    // picked. Options are loaded at render time — see the `lookup` fields below.
    fields: [
      { name: 'programme', label: 'Programme', type: 'select', lookup: 'programme' },
      { name: 'cohort', label: 'Cohort', type: 'select', lookup: 'cohort' },
      { name: 'group', label: 'Group', type: 'select', lookup: 'group' },
    ],
  },
  {
    title: 'Address',
    icon: 'ri-map-pin-line',
    fields: [
      { name: 'postcode', label: 'Postcode', type: 'text', placeholder: 'CT1 1AA' },
      { name: 'addressLine1', label: 'Address 1', type: 'text' },
      { name: 'addressLine2', label: 'Address 2', type: 'text' },
      { name: 'townCity', label: 'Town/City', type: 'text' },
      { name: 'county', label: 'County', type: 'text' },
      { name: 'country', label: 'Country', type: 'select', options: COUNTRY_OPTIONS },
    ],
  },
  {
    title: 'Delivery & employer',
    icon: 'ri-building-line',
    fields: [
      { name: 'caseOwner', label: 'Case owner', type: 'select', lookup: 'caseOwner' },
      { name: 'learningProvider', label: 'Learning provider', type: 'select', options: PROVIDER_OPTIONS },
      // Picked from enrolment."Employers" — choosing one auto-fills the
      // organisation below it from that employer's Employer Group.
      { name: 'employer', label: 'Employer', type: 'select', lookup: 'employer' },
      { name: 'employerAddress', label: 'Employer address', type: 'text' },
      { name: 'lineManager', label: 'Manager', type: 'text', placeholder: 'e.g. Jane Smith' },
      { name: 'mentor', label: 'Mentor', type: 'text' },
      {
        name: 'organization',
        label: 'Organisation',
        type: 'text',
        placeholder: 'e.g. Kent Business College',
        derivedFrom: 'employer',
        hint: 'Filled from the selected employer’s organisation.',
      },
      { name: 'referenceNumber', label: 'Reference number', type: 'text', placeholder: 'refnumber' },
      { name: 'extendedBreak', label: 'Extended break', type: 'text' },
    ],
  },
];

// Defaults chosen to match Aptem's own initial state: invite off.
// Type/Status aren't asked for here — they're stamped on submit.
const INITIAL: Record<string, string> = {
  inviteToPlatform: 'false',
  learningProvider: 'Kent Business College',
  country: DEFAULT_COUNTRY,
};

/** Fields visible for the chosen destination table. */
function visibleFields(kind: LearnerKind): FieldDef[] {
  return SECTIONS.flatMap((s) => s.fields).filter((f) => !f.only || f.only === kind);
}

export function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (row: UserListRow) => void }) {
  const { success, error } = useToast();
  const [formData, setFormData] = useState<Record<string, string>>(INITIAL);
  const [kind, setKind] = useState<LearnerKind>('apprenticeship');
  const [submitting, setSubmitting] = useState(false);

  // Live curriculum cascade: programmes load once, then cohorts follow the chosen
  // programme and groups follow the chosen cohort.
  const [programmes, setProgrammes] = useState<string[]>([]);
  const [cohorts, setCohorts] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  // Case owners come from Staff_users (positions Caseowner / Admin) — independent
  // of the programme cascade, so loaded once alongside programmes.
  const [caseOwners, setCaseOwners] = useState<string[]>([]);
  // Whole employer records, not just names: picking one has to read its
  // organisation to auto-fill the Organisation field below.
  const [employers, setEmployers] = useState<EmployerRow[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [employerError, setEmployerError] = useState<string | null>(null);

  const programme = formData.programme ?? '';
  const cohort = formData.cohort ?? '';

  const setField = (name: string, value: string) =>
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      // Picking a new programme/cohort invalidates the levels below it.
      if (name === 'programme') { next.cohort = ''; next.group = ''; }
      if (name === 'cohort') { next.group = ''; }
      // The employer select carries the record's id (names repeat, ids don't),
      // so the stored employer name and the derived organisation are both looked
      // up from it. Clearing the employer clears the organisation with it, rather
      // than stranding a company the chosen employer has nothing to do with.
      if (name === 'employerId') {
        const picked = employers.find((e) => e.id === value);
        next.employer = picked?.name ?? '';
        next.organization = picked ? picked.employerGroupNames.join(', ') : '';
      }
      return next;
    });
  const isOn = (name: string) => formData[name] === 'true';

  useEffect(() => {
    let cancelled = false;
    fetchProgrammes()
      .then((rows) => { if (!cancelled) setProgrammes(rows); })
      .catch((e: Error) => { if (!cancelled) setLookupError(e.message); });
    // Failure here is reported separately from the programme cascade, whose error
    // renders under the Programme section.
    fetchCaseOwners()
      .then((rows) => { if (!cancelled) setCaseOwners(rows); })
      .catch((e: Error) => { if (!cancelled) setStaffError(e.message); });
    // A failure here doesn't block the form — but it must not be silent either.
    // Reported separately so "the lookup broke" can't be mistaken for "no
    // employers exist yet", which is what the empty-state hint means.
    listEmployers()
      .then((res) => { if (!cancelled) setEmployers(res.results); })
      .catch((e: Error) => { if (!cancelled) setEmployerError(e.message); });
    return () => { cancelled = true; };
  }, []);

  // Changing a parent clears its descendants, so a stale cohort/group can never
  // be submitted alongside a newly chosen programme.
  useEffect(() => {
    let cancelled = false;
    setCohorts([]);
    setGroups([]);
    if (!programme) return;
    fetchCohorts(programme)
      .then((rows) => { if (!cancelled) setCohorts(rows); })
      .catch((e: Error) => { if (!cancelled) setLookupError(e.message); });
    return () => { cancelled = true; };
  }, [programme]);

  useEffect(() => {
    let cancelled = false;
    setGroups([]);
    if (!programme || !cohort) return;
    fetchGroups(programme, cohort)
      .then((rows) => { if (!cancelled) setGroups(rows); })
      .catch((e: Error) => { if (!cancelled) setLookupError(e.message); });
    return () => { cancelled = true; };
  }, [programme, cohort]);

  /**
   * Options + disabled state for a database-backed field.
   *
   * `employer` is absent on purpose: its options are id/label pairs rather than
   * plain strings, so renderField handles that select directly.
   */
  const lookupState = (level: Exclude<NonNullable<FieldDef['lookup']>, 'employer'>) => {
    if (level === 'programme') return { values: programmes, disabled: false, waitingFor: '', empty: 'None available' };
    if (level === 'cohort') return { values: cohorts, disabled: !programme, waitingFor: 'programme', empty: 'None available' };
    if (level === 'group') return { values: groups, disabled: !cohort, waitingFor: 'cohort', empty: 'None available' };
    return {
      values: caseOwners,
      disabled: false,
      waitingFor: '',
      // Case owners are staff accounts, so an empty list means none exist yet
      // rather than a bad selection upstream.
      empty: 'No case owners — create an admin first',
    };
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const missing = visibleFields(kind).filter((f) => f.required && !formData[f.name]?.trim());
    if (missing.length > 0) {
      error('Missing details', `Please complete: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    // Typed fields must also be well-formed — `type="email"`/`type="tel"` don't
    // enforce anything on their own, so a single letter would otherwise be saved
    // as someone's email address.
    const malformed = visibleFields(kind)
      .map((f) => {
        const msg = f.type === 'email' || f.type === 'tel'
          ? formatError(f.type, formData[f.name] ?? '')
          : '';
        return msg ? `${f.label} — ${msg}` : '';
      })
      .filter(Boolean);
    if (malformed.length > 0) {
      error('Check these details', malformed.join('; '));
      return;
    }
    const name = `${formData.firstName ?? ''} ${formData.lastName ?? ''}`.trim();

    // Every Aptem field the two endpoints share. Booleans are sent as real
    // booleans; the backend coerces and stores them in boolean columns.
    const shared = {
      username: name,
      email: formData.email ?? '',
      phone: formData.phone,
      dob: formData.dob,
      // Type and Status are no longer asked for on this form, so both are
      // stamped rather than left null: the directory reads Type for its
      // learner-vs-admin styling and the Learning-plan link, and Status for its
      // Subscription-status column and status filter.
      type: 'User',
      status: 'FullUser',
      // Programme / cohort / group come from the live curriculum cascade.
      programme: formData.programme,
      cohort: formData.cohort,
      group: formData.group,
      employer: formData.employer,
      // The employer's record id, alongside the display name above: the name is
      // what listings show, this is what reaches the rest of that employer's
      // data. Empty string -> null so "no employer" clears the reference rather
      // than failing the unknown-id check.
      employerId: formData.employerId ? Number(formData.employerId) : null,
      lineManager: formData.lineManager,
      organization: formData.organization,
      title: formData.title,
      preferredName: formData.preferredName,
      gender: formData.gender,
      niNumber: formData.niNumber,
      referrer: formData.referrer,
      referrerAddress: formData.referrerAddress,
      referrerContact: formData.referrerContact,
      postcode: formData.postcode,
      addressLine1: formData.addressLine1,
      addressLine2: formData.addressLine2,
      townCity: formData.townCity,
      county: formData.county,
      country: formData.country,
      caseOwner: formData.caseOwner,
      learningProvider: formData.learningProvider,
      employerAddress: formData.employerAddress,
      mentor: formData.mentor,
      referenceNumber: formData.referenceNumber,
      extendedBreak: formData.extendedBreak,
      inviteToPlatform: isOn('inviteToPlatform'),
    };

    setSubmitting(true);
    try {
      // One table, one endpoint: the learner-type switch is just a field now, so
      // both kinds take the same path and the response already carries the row's
      // learnerType/source.
      const row = await createEnrolmentUser({ ...shared, learnerType: kind });
      const label = kind === 'commercial' ? 'Commercial learner' : 'Apprenticeship learner';
      success(`${label} created`, `${row.name || name} was saved to Enrolment_Users.`);
      onCreated(row);
      onClose();
    } catch (err) {
      error('Could not create user', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  /** One Aptem-style row: label on the left, control on the right. */
  const renderField = (field: FieldDef, index: number) => {
    if (field.only && field.only !== kind) return null;
    const value = formData[field.name] ?? '';
    return (
      <div
        key={field.name}
        className={`grid grid-cols-1 sm:grid-cols-[minmax(160px,240px)_1fr] gap-1 sm:gap-4 px-4 py-2.5 items-start ${
          index % 2 === 1 ? 'bg-background-100/40' : ''
        }`}
      >
        <label htmlFor={`cu-${field.name}`} className="text-[12px] font-medium text-foreground-600 sm:py-2 leading-snug">
          {field.label}
          {field.required ? <span className="text-red-500 ml-0.5">*</span> : <span className="text-foreground-300 ml-1">(O)</span>}
        </label>
        <div className="min-w-0">
          {field.lookup === 'employer' ? (
            /* Keyed on the record id, not the name: two employers can share a
               name, and picking the wrong record would auto-fill the wrong
               organisation. `employer` itself still stores the name, which is
               what the learner column holds. */
            <select
              id={`cu-${field.name}`}
              value={formData.employerId ?? ''}
              onChange={(e) => setField('employerId', e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">
                {employerError
                  ? 'Could not load employers — see below'
                  : employers.length === 0
                    ? 'No employers — create an employer profile first'
                    : 'Select…'}
              </option>
              {employers.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employerGroupNames.length ? `${e.name} — ${e.employerGroupNames.join(', ')}` : e.name}
                </option>
              ))}
            </select>
          ) : field.derivedFrom ? (
            /* Read-only: it mirrors the employer's organisation, so a typed value
               would be silently replaced on the next employer change. */
            <input
              id={`cu-${field.name}`}
              type="text"
              value={value}
              readOnly
              placeholder={formData.employerId ? '—' : 'Select an employer first…'}
              className={`${inputClass} bg-background-100/60 text-foreground-600 cursor-not-allowed`}
            />
          ) : field.lookup ? (
            (() => {
              const { values, disabled, waitingFor, empty } = lookupState(field.lookup);
              return (
                <select
                  id={`cu-${field.name}`}
                  value={value}
                  disabled={disabled}
                  onChange={(e) => setField(field.name, e.target.value)}
                  className={`${inputClass} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <option value="">
                    {disabled ? `Select a ${waitingFor} first…` : values.length === 0 ? empty : 'Select…'}
                  </option>
                  {values.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              );
            })()
          ) : field.type === 'select' ? (
            <select
              id={`cu-${field.name}`}
              value={value}
              onChange={(e) => setField(field.name, e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">Select…</option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : field.type === 'radio' ? (
            <div className="flex flex-wrap items-center gap-4 sm:py-2">
              {field.options?.map((opt) => (
                <label key={opt.value} className="flex items-center gap-1.5 text-[13px] text-foreground-700 cursor-pointer">
                  <input
                    type="radio"
                    name={`cu-${field.name}`}
                    checked={value === opt.value}
                    onChange={() => setField(field.name, opt.value)}
                    className="accent-primary-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          ) : field.type === 'checkbox' ? (
            <div className="sm:py-2">
              <input
                id={`cu-${field.name}`}
                type="checkbox"
                checked={value === 'true'}
                onChange={(e) => setField(field.name, e.target.checked ? 'true' : 'false')}
                className="accent-primary-500 w-4 h-4 cursor-pointer"
              />
            </div>
          ) : field.type === 'textarea' ? (
            <textarea
              id={`cu-${field.name}`}
              value={value}
              rows={3}
              placeholder={field.placeholder}
              onChange={(e) => setField(field.name, e.target.value)}
              className={inputClass}
            />
          ) : (
            <input
              id={`cu-${field.name}`}
              type={field.type}
              value={value}
              placeholder={field.placeholder}
              onChange={(e) => setField(field.name, e.target.value)}
              className={inputClass}
            />
          )}
          {field.hint && <p className="text-[11px] text-foreground-400 mt-1">{field.hint}</p>}
        </div>
      </div>
    );
  };

  return (
    <Modal
      title="Add user"
      size="max-w-3xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose} disabled={submitting}>Close</button>
          <button type="button" className={btnPrimary} onClick={() => handleSubmit()} disabled={submitting}>
            {submitting ? <><AppIcon className="ri-loader-4-line animate-spin" />Saving…</> : <><AppIcon className="ri-user-add-line" />Create</>}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {SECTIONS.map((section) => {
          const fields = section.fields.filter((f) => !f.only || f.only === kind);
          if (fields.length === 0) return null;
          return (
            <section key={section.title} className="rounded-xl border border-foreground-200/70 overflow-hidden">
              <header className="flex items-center gap-2 px-4 py-2.5 bg-background-100/70 border-b border-foreground-200/60">
                <AppIcon className={`${section.icon} text-primary-500`} />
                <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground-600">{section.title}</h3>
              </header>
              <div className="divide-y divide-foreground-100">{fields.map(renderField)}</div>
              {section.title === 'Programme' && lookupError && (
                <p className="px-4 py-2 text-[11px] text-red-600 border-t border-foreground-100">
                  <AppIcon className="ri-error-warning-line mr-1" />Could not load curriculum options: {lookupError}
                </p>
              )}
              {section.title === 'Delivery & employer' && staffError && (
                <p className="px-4 py-2 text-[11px] text-red-600 border-t border-foreground-100">
                  <AppIcon className="ri-error-warning-line mr-1" />Could not load case owners: {staffError}
                </p>
              )}
              {section.title === 'Delivery & employer' && employerError && (
                <p className="px-4 py-2 text-[11px] text-red-600 border-t border-foreground-100">
                  <i className="ri-error-warning-line mr-1" />Could not load employers: {employerError}. The
                  dropdown is empty because the lookup failed, not because no employers exist — if the backend was
                  started before this feature was added, restart it.
                </p>
              )}
            </section>
          );
        })}

        {/* Destination table. Last in the form, as requested — this is the switch
            that decides which table the row is written to. */}
        <section className="rounded-xl border-2 border-primary-200 overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-2.5 bg-primary-50 border-b border-primary-200/60">
            <AppIcon className="ri-git-branch-line text-primary-500" />
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-primary-700">Learner type</h3>
          </header>
          <div className="p-4 space-y-2.5">
            <p className="text-[12px] text-foreground-500">
              Both kinds are stored in the same learner table; this sets which kind the record is.
            </p>
            {([
              {
                value: 'apprenticeship' as LearnerKind,
                label: 'Apprenticeship learner',
                detail: 'Full ILR, compliance documents and the enrolment wizard.',
              },
              {
                value: 'commercial' as LearnerKind,
                label: 'Commercial learner',
                detail: 'Commercial delivery, no funded-ILR compliance trail.',
              },
            ]).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-smooth ${
                  kind === opt.value
                    ? 'border-primary-400 bg-primary-50/60'
                    : 'border-foreground-200 hover:bg-background-100/60'
                }`}
              >
                <input
                  type="radio"
                  name="cu-learner-kind"
                  checked={kind === opt.value}
                  onChange={() => setKind(opt.value)}
                  className="accent-primary-500 mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-foreground-800">{opt.label}</span>
                  <span className="block text-[11px] text-foreground-400 mt-0.5">{opt.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* allow Enter-to-submit without a visible duplicate button */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
