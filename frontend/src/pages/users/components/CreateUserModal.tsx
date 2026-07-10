import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { DEMO_PROGRAMMES, DEMO_COHORTS } from '@/mocks/demo-core';
import { createEnrolmentUser, STATUS_OPTIONS, TYPE_OPTIONS, PROGRAMME_STATUS_OPTIONS } from '@/api/enrolmentUsers';
import type { UserListRow } from '../types';
import { Modal } from './Modal';
import { inputClass, btnPrimary, btnSecondary } from './ui';

// ============================================================================
// Create user — inline modal opened from the Users list search section.
// Writes a new row to enrolment."Enrolment_Users" via the API.
// ============================================================================

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'date' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  colSpan?: boolean;
}

const opts = (values: string[]) => values.map((v) => ({ value: v, label: v }));
const programmeOptions = DEMO_PROGRAMMES.map((p) => ({ value: p.title, label: `${p.title} · ${p.level}` }));
const cohortOptions = DEMO_COHORTS.map((c) => ({ value: c.name, label: c.name }));

const FIELDS: FieldDef[] = [
  { name: 'firstName', label: 'First name', type: 'text', required: true, placeholder: 'e.g. Sophie' },
  { name: 'lastName', label: 'Last name', type: 'text', required: true, placeholder: 'e.g. Williams' },
  { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'name@example.com', colSpan: true },
  { name: 'phone', label: 'Phone', type: 'tel', placeholder: '07700 900000' },
  { name: 'dob', label: 'Date of birth', type: 'date' },
  { name: 'type', label: 'Type', type: 'select', required: true, options: opts(TYPE_OPTIONS) },
  { name: 'status', label: 'Status', type: 'select', required: true, options: opts(STATUS_OPTIONS) },
  { name: 'programme', label: 'Programme', type: 'select', options: programmeOptions, colSpan: true },
  { name: 'programmeStatus', label: 'Programme status', type: 'select', options: opts(PROGRAMME_STATUS_OPTIONS) },
  { name: 'cohort', label: 'Cohort', type: 'select', options: cohortOptions },
  { name: 'group', label: 'Group', type: 'text', placeholder: 'e.g. PCP - April 2026' },
  { name: 'employer', label: 'Employer', type: 'text', placeholder: 'e.g. Al Fanar Construction' },
  { name: 'lineManager', label: 'Line manager', type: 'text', placeholder: 'e.g. Jane Smith' },
  { name: 'organization', label: 'Organisation', type: 'text', placeholder: 'e.g. Kent Business College' },
];

// Sensible defaults so the two required selects start on a valid value.
const INITIAL: Record<string, string> = { type: 'User', status: 'FullUser' };

export function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (row: UserListRow) => void }) {
  const { success, error } = useToast();
  const [formData, setFormData] = useState<Record<string, string>>(INITIAL);
  const [submitting, setSubmitting] = useState(false);

  const setField = (name: string, value: string) => setFormData((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const missing = FIELDS.filter((f) => f.required && !formData[f.name]?.trim());
    if (missing.length > 0) {
      error('Missing details', `Please complete: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    const name = `${formData.firstName ?? ''} ${formData.lastName ?? ''}`.trim();
    setSubmitting(true);
    try {
      const row = await createEnrolmentUser({
        username: name,
        email: formData.email ?? '',
        phone: formData.phone,
        dob: formData.dob,
        type: formData.type,
        status: formData.status,
        programme: formData.programme,
        programmeStatus: formData.programmeStatus,
        cohort: formData.cohort,
        group: formData.group,
        employer: formData.employer,
        lineManager: formData.lineManager,
        organization: formData.organization,
      });
      success('User created', `${row.name || name} was saved to the database.`);
      onCreated(row);
      onClose();
    } catch (err) {
      error('Could not create user', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Create user"
      size="max-w-2xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => handleSubmit()} disabled={submitting}>
            {submitting ? <><i className="ri-loader-4-line animate-spin" />Saving…</> : <><i className="ri-user-add-line" />Create User</>}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELDS.map((field) => (
          <div key={field.name} className={field.colSpan ? 'sm:col-span-2' : ''}>
            <label className="block text-[11px] uppercase tracking-wider font-medium text-foreground-500 mb-1.5">
              {field.label}
              {field.required && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            {field.type === 'select' ? (
              <select value={formData[field.name] ?? ''} onChange={(e) => setField(field.name, e.target.value)} className={`${inputClass} cursor-pointer`}>
                <option value="">Select…</option>
                {field.options?.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            ) : (
              <input type={field.type} value={formData[field.name] ?? ''} placeholder={field.placeholder} onChange={(e) => setField(field.name, e.target.value)} className={inputClass} />
            )}
          </div>
        ))}
        {/* allow Enter-to-submit without a visible duplicate button */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
