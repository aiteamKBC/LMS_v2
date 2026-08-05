import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { createStaffUser, POSITION_OPTIONS } from '@/api/staffUsers';
import type { StaffUserRow } from '@/api/staffUsers';
import { Modal } from './Modal';
import { inputClass, btnPrimary, btnSecondary } from './ui';

// ============================================================================
// Create admin — Aptem-shaped "Add user" form for staff accounts.
//
// Mirrors Aptem's admin variant of the Add-user screen: the user type is fixed
// (this form only creates staff), and email is entered twice to catch typos in
// an address the account holder will need to sign in with.
//
// Writes to enrolment."Staff_users" via createStaffUser — staff are not learners,
// so they never touch Enrolment_Users / Commercial_users. The position asked for
// at the foot of the form is the staff role.
// ============================================================================

type FieldType = 'text' | 'email' | 'tel' | 'date' | 'radio';

interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
}

const GENDER_OPTIONS = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
];

const FIELDS: FieldDef[] = [
  { name: 'firstName', label: 'First name', type: 'text', required: true, placeholder: 'firstname' },
  { name: 'lastName', label: 'Surname', type: 'text', required: true, placeholder: 'lastname' },
  { name: 'gender', label: 'Gender', type: 'radio', options: GENDER_OPTIONS },
  { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'you@youremail.com' },
  { name: 'confirmEmail', label: 'Confirm email', type: 'email', required: true, placeholder: 'you@youremail.com' },
  { name: 'phone', label: 'Mobile', type: 'tel', placeholder: 'NNN NNNN NNNN or +NNN NNN NNN NNNN' },
  { name: 'title', label: 'Title', type: 'text', placeholder: 'title' },
  { name: 'organization', label: 'Organisation', type: 'text', placeholder: 'e.g. Kent Business College' },
];

export function CreateAdminModal({ onClose, onCreated }: { onClose: () => void; onCreated: (row: StaffUserRow) => void }) {
  const { success, error } = useToast();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [position, setPosition] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const setField = (name: string, value: string) => setFormData((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const missing = FIELDS.filter((f) => f.required && !formData[f.name]?.trim());
    if (missing.length > 0) {
      error('Missing details', `Please complete: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    // Compared case-insensitively: addresses aren't case-sensitive in practice,
    // and a capitalisation difference isn't the typo this check is for.
    const email = (formData.email ?? '').trim();
    if (email.toLowerCase() !== (formData.confirmEmail ?? '').trim().toLowerCase()) {
      error('Emails do not match', 'Please check the email and confirmation match.');
      return;
    }
    if (!position) {
      error('Position required', 'Please choose the position for this admin.');
      return;
    }

    const name = `${formData.firstName ?? ''} ${formData.lastName ?? ''}`.trim();
    setSubmitting(true);
    try {
      const row = await createStaffUser({
        username: name,
        email,
        position,
        // Staff share the learner tables' Type/Status vocabulary; "Admin" marks
        // the row as a non-learner, and the position carries the actual role.
        type: 'Admin',
        status: 'FullUser',
        phone: formData.phone,
        title: formData.title,
        gender: formData.gender,
        organization: formData.organization,
      });
      success('Admin created', `${row.name || name} was saved as ${position}.`);
      onCreated(row);
      onClose();
    } catch (err) {
      error('Could not create admin', err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  /** One Aptem-style row: label on the left, control on the right. */
  const renderField = (field: FieldDef, index: number) => {
    const value = formData[field.name] ?? '';
    return (
      <div
        key={field.name}
        className={`grid grid-cols-1 sm:grid-cols-[minmax(160px,240px)_1fr] gap-1 sm:gap-4 px-4 py-2.5 items-start ${
          index % 2 === 1 ? 'bg-background-100/40' : ''
        }`}
      >
        <label htmlFor={`ca-${field.name}`} className="text-[12px] font-medium text-foreground-600 sm:py-2 leading-snug">
          {field.label}
          {field.required ? <span className="text-red-500 ml-0.5">*</span> : <span className="text-foreground-300 ml-1">(O)</span>}
        </label>
        <div className="min-w-0">
          {field.type === 'radio' ? (
            <div className="flex flex-wrap items-center gap-4 sm:py-2">
              {field.options?.map((opt) => (
                <label key={opt.value} className="flex items-center gap-1.5 text-[13px] text-foreground-700 cursor-pointer">
                  <input
                    type="radio"
                    name={`ca-${field.name}`}
                    checked={value === opt.value}
                    onChange={() => setField(field.name, opt.value)}
                    className="accent-primary-500"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          ) : (
            <input
              id={`ca-${field.name}`}
              type={field.type}
              value={value}
              placeholder={field.placeholder}
              onChange={(e) => setField(field.name, e.target.value)}
              className={inputClass}
            />
          )}
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
            {submitting ? <><AppIcon className="ri-loader-4-line animate-spin" />Saving…</> : <><AppIcon className="ri-shield-user-line" />Create</>}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <section className="rounded-xl border border-foreground-200/70 overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-2.5 bg-background-100/70 border-b border-foreground-200/60">
            <AppIcon className="ri-shield-user-line text-primary-500" />
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-foreground-600">Identity</h3>
          </header>
          <div className="divide-y divide-foreground-100">
            {/* Fixed, not a picker: this form only creates staff accounts. */}
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(160px,240px)_1fr] gap-1 sm:gap-4 px-4 py-2.5 items-start">
              <span className="text-[12px] font-medium text-foreground-600 sm:py-2">User type</span>
              <p className="text-[13px] font-semibold text-primary-700 sm:py-2">Admin</p>
            </div>
            {FIELDS.map(renderField)}
          </div>
        </section>

        {/* Position — asked for at the end of the form, as requested. */}
        <section className="rounded-xl border-2 border-primary-200 overflow-hidden">
          <header className="flex items-center gap-2 px-4 py-2.5 bg-primary-50 border-b border-primary-200/60">
            <AppIcon className="ri-briefcase-line text-primary-500" />
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-primary-700">
              Position<span className="text-red-500 ml-0.5">*</span>
            </h3>
          </header>
          <div className="p-4 space-y-2.5">
            <p className="text-[12px] text-foreground-500">Choose this admin’s position.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {POSITION_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition-smooth ${
                    position === opt
                      ? 'border-primary-400 bg-primary-50/60'
                      : 'border-foreground-200 hover:bg-background-100/60'
                  }`}
                >
                  <input
                    type="radio"
                    name="ca-position"
                    checked={position === opt}
                    onChange={() => setPosition(opt)}
                    className="accent-primary-500"
                  />
                  <span className="text-[13px] font-medium text-foreground-800">{opt}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* allow Enter-to-submit without a visible duplicate button */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
