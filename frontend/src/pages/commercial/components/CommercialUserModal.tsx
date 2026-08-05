import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { createCommercialUser, type CommercialUserRow } from '@/api/commercialUsers';
import { PROGRAMME_STATUS_OPTIONS } from '@/api/enrolmentUsers';
import { Modal } from '@/pages/users/components/Modal';
import { inputClass, btnPrimary, btnSecondary } from '@/pages/users/components/ui';

// ============================================================================
// Create commercial user — inline modal opened from the Learners hub.
// Writes a new row to enrolment."Commercial_users".
// ============================================================================

interface FieldDef {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: string[];
  colSpan?: boolean;
}

const FIELDS: FieldDef[] = [
  { name: 'username', label: 'Full name', type: 'text', required: true, placeholder: 'e.g. Sophie Williams', colSpan: true },
  { name: 'email', label: 'Email', type: 'email', required: true, placeholder: 'name@example.com', colSpan: true },
  { name: 'phone', label: 'Phone', type: 'tel', placeholder: '07700 900000' },
  { name: 'programmeStatus', label: 'Programme status', type: 'select', options: PROGRAMME_STATUS_OPTIONS },
  { name: 'employer', label: 'Employer', type: 'text', placeholder: 'e.g. Al Fanar Construction' },
  { name: 'lineManager', label: 'Line manager', type: 'text', placeholder: 'e.g. Jane Smith' },
  { name: 'organization', label: 'Organisation', type: 'text', placeholder: 'e.g. Kent Business College', colSpan: true },
];

export function CommercialUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: (row: CommercialUserRow) => void }) {
  const { success, error } = useToast();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const setField = (name: string, value: string) => setFormData((prev) => ({ ...prev, [name]: value }));

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const missing = FIELDS.filter((f) => f.required && !formData[f.name]?.trim());
    if (missing.length > 0) {
      error('Missing details', `Please complete: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    setSubmitting(true);
    try {
      const row = await createCommercialUser({
        username: formData.username,
        email: formData.email,
        phone: formData.phone,
        employer: formData.employer,
        lineManager: formData.lineManager,
        organization: formData.organization,
        programmeStatus: formData.programmeStatus,
      });
      success('User created', `${row.username} was saved to the database.`);
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
      title="Add commercial learner"
      size="max-w-2xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => handleSubmit()} disabled={submitting}>
            {submitting ? <><AppIcon className="ri-loader-4-line animate-spin" />Saving…</> : <><AppIcon className="ri-user-add-line" />Create learner</>}
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
              <select
                value={formData[field.name] ?? ''}
                onChange={(e) => setField(field.name, e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                <option value="">Select…</option>
                {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={field.type}
                value={formData[field.name] ?? ''}
                placeholder={field.placeholder}
                onChange={(e) => setField(field.name, e.target.value)}
                className={inputClass}
              />
            )}
          </div>
        ))}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
