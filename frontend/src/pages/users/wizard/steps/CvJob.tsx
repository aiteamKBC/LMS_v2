import { useWizard } from '../WizardContext';
import { FieldRow, inputClass, FileList } from '../../components/ui';
import { LabeledInput, LabeledSelect, StepHeading } from './fields';

const FS_ENROL_OPTIONS = ['Yes - English', 'Yes - Maths', 'Yes - English and Maths', 'No', 'Not applicable'];

export default function CvJob() {
  const { draft, setSection } = useWizard();
  const cv = draft.cvJob;
  const set = (patch: Partial<typeof cv>) => setSection('cvJob', { ...cv, ...patch });

  return (
    <div>
      <StepHeading title="CV/Job Description" subtitle="Your Work Experience" />
      <p className="text-[13px] text-foreground-500 mb-5 max-w-3xl leading-relaxed">
        It is important that we match your previous experience and current job role and responsibilities to ensure this
        apprenticeship is the most appropriate route for you.
      </p>
      <div className="max-w-3xl">
        <FieldRow label="Please upload an up to date CV which includes your current job role:">
          {cv.cvFile ? (
            <FileList files={[{ id: 'cv', name: cv.cvFile }]} onDelete={() => set({ cvFile: undefined })} />
          ) : (
            <label className="inline-flex items-center gap-2 px-3 py-2 text-[13px] bg-background-100 text-foreground-600 rounded-lg border border-background-200 hover:bg-background-200 transition-smooth cursor-pointer">
              <i className="ri-upload-2-line" />Upload CV
              <input type="file" className="hidden" onChange={(e) => set({ cvFile: e.target.files?.[0]?.name })} />
            </label>
          )}
        </FieldRow>
        <FieldRow label="If you do not have a CV to upload, please list your previous experience and description of your current job role and responsibilities:">
          <textarea rows={5} value={cv.experienceText ?? ''} onChange={(e) => set({ experienceText: e.target.value })} className={inputClass} />
        </FieldRow>
        <LabeledInput
          label="Do you have any project management qualifications? If yes, please name them. If not, just write 'no.'"
          value={cv.pmQualifications}
          onChange={(v) => set({ pmQualifications: v })}
          placeholder="e.g. Site Management Safety Training Scheme"
        />
        <LabeledSelect
          label="If you do not have GCSEs available, or if you do not meet the required grades in English and Maths, would you like to enrol in a funded Functional Skills course in these subjects?"
          value={cv.functionalSkillsEnrol ?? ''}
          options={FS_ENROL_OPTIONS}
          onChange={(v) => set({ functionalSkillsEnrol: v })}
        />
      </div>
    </div>
  );
}
