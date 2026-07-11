import { useWizard } from '../WizardContext';
import { SEX_OPTIONS } from '@/mocks/enrolment-console';
import { LabeledInput, LabeledSelect, StepHeading } from './fields';

export default function PersonalDetails() {
  const { draft, setSection } = useWizard();
  const pd = draft.personalDetails;
  const set = (patch: Partial<typeof pd>) => setSection('personalDetails', { ...pd, ...patch });

  return (
    <div>
      <StepHeading title="Personal Details" />
      <div className="max-w-3xl">
        <LabeledInput label="First Name" value={pd.firstName} onChange={(v) => set({ firstName: v })} />
        <LabeledInput label="Last Name" value={pd.lastName} onChange={(v) => set({ lastName: v })} />
        <LabeledInput label="Email" type="email" value={pd.email} onChange={(v) => set({ email: v })} />
        <LabeledInput label="Phone" type="tel" value={pd.phone} onChange={(v) => set({ phone: v })} />
        <LabeledInput label="Address" value={pd.address} onChange={(v) => set({ address: v })} />
        <LabeledInput label="Date of Birth" type="date" value={pd.dob} onChange={(v) => set({ dob: v })} />
        <LabeledInput label="Age" type="number" value={pd.age != null ? String(pd.age) : ''} onChange={(v) => set({ age: v ? Number(v) : undefined })} />
        <LabeledSelect label="Sex" value={pd.sex} options={SEX_OPTIONS} onChange={(v) => set({ sex: v })} />
      </div>
    </div>
  );
}
