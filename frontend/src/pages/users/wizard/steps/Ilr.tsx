import { useState } from 'react';
import { useWizard } from '../WizardContext';
import { ETHNICITY_OPTIONS } from '@/mocks/enrolment-console';
import { FieldRow, inputClass, YesNoRadio, ActionLink, iconBtn, EmptyState, btnSecondary } from '../../components/ui';
import { LabeledInput, LabeledSelect, SignatureField, StepHeading } from './fields';

function ageOn31Aug(dobIso: string, startYear: number): number | null {
  if (!dobIso) return null;
  const d = new Date(dobIso);
  if (isNaN(d.getTime())) return null;
  const ref = new Date(startYear, 7, 31);
  let age = ref.getFullYear() - d.getFullYear();
  const m = ref.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) age--;
  return age;
}

export default function Ilr() {
  const { board, draft, setSection } = useWizard();
  const ilr = draft.ilr;
  const set = (patch: Partial<typeof ilr>) => setSection('ilr', { ...ilr, ...patch });

  const startYear = Number((board.programme.startDate || '').split('/')[2]) || new Date().getFullYear();
  const age = ageOn31Aug(ilr.dob, startYear);

  const [declOpen, setDeclOpen] = useState(false);
  const [paLevel, setPaLevel] = useState('');
  const [paDate, setPaDate] = useState('');
  const [esCode, setEsCode] = useState('');
  const [esDate, setEsDate] = useState('');

  const addPa = () => {
    if (!paLevel) return;
    set({ priorAttainment: [...ilr.priorAttainment, { level: paLevel, date: paDate }] });
    setPaLevel('');
    setPaDate('');
  };
  const addEs = () => {
    if (!esCode) return;
    set({ employmentStatus: [...ilr.employmentStatus, { code: esCode, date: esDate }] });
    setEsCode('');
    setEsDate('');
  };

  return (
    <div>
      <StepHeading title="Individualised Learner Record 2025/26" subtitle="Learner Details Data Capture Form" />
      <div className="max-w-3xl">
        <LabeledInput label="Family name" value={ilr.familyName} onChange={(v) => set({ familyName: v })} />
        <LabeledInput label="Given names" value={ilr.givenNames} onChange={(v) => set({ givenNames: v })} />
        <LabeledInput
          label="Date of birth"
          type="date"
          value={ilr.dob}
          onChange={(v) => set({ dob: v })}
          helper={age != null ? `Age ${age} on 31 Aug of the year programme started` : undefined}
        />
        <LabeledInput label="Current postcode" value={ilr.currentPostcode} onChange={(v) => set({ currentPostcode: v })} />
        <LabeledInput label="Current address line 1" value={ilr.addressLine1} onChange={(v) => set({ addressLine1: v })} />
        <LabeledInput label="Current address line 2" value={ilr.addressLine2} onChange={(v) => set({ addressLine2: v })} />
        <LabeledInput label="Current address line 3" value={ilr.addressLine3} onChange={(v) => set({ addressLine3: v })} />
        <LabeledInput label="Current address line 4" value={ilr.addressLine4} onChange={(v) => set({ addressLine4: v })} />
        <LabeledInput label="How long have you been at this address (years)?" type="number" value={ilr.yearsAtAddress != null ? String(ilr.yearsAtAddress) : ''} onChange={(v) => set({ yearsAtAddress: v ? Number(v) : undefined })} />
        <LabeledInput label="Telephone number" type="tel" value={ilr.telephone} onChange={(v) => set({ telephone: v })} />
        <LabeledInput label="Postcode prior to enrolment" required value={ilr.postcodePriorToEnrolment} onChange={(v) => set({ postcodePriorToEnrolment: v })} />
        <LabeledInput label="National insurance number" value={ilr.niNumber} onChange={(v) => set({ niNumber: v })} placeholder="QQ 12 34 56 C" />
        <LabeledInput label="Email address" type="email" value={ilr.email} onChange={(v) => set({ email: v })} />

        <FieldRow label="Legal Sex">
          <div className="flex items-center gap-5">
            {(['Male', 'Female'] as const).map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-[12px] text-foreground-700 cursor-pointer">
                <input type="radio" name="legalSex" checked={ilr.legalSex === s} onChange={() => set({ legalSex: s })} className="accent-primary-500" />
                {s}
              </label>
            ))}
          </div>
        </FieldRow>

        <LabeledInput label="What pronouns do you use?" value={ilr.pronouns ?? ''} onChange={(v) => set({ pronouns: v })} />
        <LabeledSelect label="Ethnicity" required value={ilr.ethnicityCode} options={ETHNICITY_OPTIONS} onChange={(v) => set({ ethnicityCode: v })} />
        <YesNoRadio
          legend="Do you consider yourself to have a long term disability, health problem or any learning difficulties?"
          name="disability"
          value={ilr.hasLongTermDisability}
          onChange={(v) => set({ hasLongTermDisability: v })}
        />
      </div>

      {/* Learner Funding and Monitoring */}
      <div className="mt-6 max-w-3xl">
        <h3 className="text-[13px] font-heading font-semibold text-foreground-800 mb-1">Learner Funding and Monitoring</h3>
        <p className="text-[12px] text-foreground-500 mb-4 leading-relaxed">Please select the highest qualification you have achieved and confirm your current employment status.</p>

        {/* Prior attainment */}
        <div className="border border-foreground-100 rounded-lg p-3 mb-4">
          <p className="text-[12px] font-semibold text-foreground-700 mb-2">Prior Attainment</p>
          {ilr.priorAttainment.length === 0 ? <EmptyState text="No prior attainment added" /> : (
            <div className="divide-y divide-foreground-100 mb-2">
              {ilr.priorAttainment.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-[12px] text-foreground-700">
                  <span>{p.level} · {p.date || '—'}</span>
                  <button className={iconBtn} aria-label="Remove" onClick={() => set({ priorAttainment: ilr.priorAttainment.filter((_, j) => j !== i) })}><i className="ri-close-line text-sm" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <input value={paLevel} onChange={(e) => setPaLevel(e.target.value)} placeholder="Level 6" className={`${inputClass} w-32`} />
            <input type="date" value={paDate} onChange={(e) => setPaDate(e.target.value)} className={`${inputClass} w-44`} />
            <button className={btnSecondary} onClick={addPa}><i className="ri-add-line" />Add prior attainment</button>
          </div>
        </div>

        {/* Employment status */}
        <div className="border border-foreground-100 rounded-lg p-3">
          <p className="text-[12px] font-semibold text-foreground-700 mb-2">Employment status</p>
          {ilr.employmentStatus.length === 0 ? <EmptyState text="No employment status added" /> : (
            <div className="divide-y divide-foreground-100 mb-2">
              {ilr.employmentStatus.map((p, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 text-[12px] text-foreground-700">
                  <span>{p.code} · {p.date || '—'}</span>
                  <button className={iconBtn} aria-label="Remove" onClick={() => set({ employmentStatus: ilr.employmentStatus.filter((_, j) => j !== i) })}><i className="ri-close-line text-sm" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <input value={esCode} onChange={(e) => setEsCode(e.target.value)} placeholder="10 - In paid employment" className={`${inputClass} w-64`} />
            <input type="date" value={esDate} onChange={(e) => setEsDate(e.target.value)} className={`${inputClass} w-44`} />
            <button className={btnSecondary} onClick={addEs}><i className="ri-add-line" />Add employment status</button>
          </div>
        </div>
      </div>

      {/* Declaration */}
      <div className="mt-6 max-w-3xl">
        <button onClick={() => setDeclOpen((o) => !o)} className="flex items-center gap-2 text-[13px] font-heading font-semibold text-foreground-800 cursor-pointer">
          <i className={`ri-arrow-down-s-line text-foreground-400 transition-transform ${declOpen ? '' : '-rotate-90'}`} />
          Declaration
        </button>
        {declOpen && (
          <div className="text-[12px] text-foreground-600 leading-relaxed mt-2 space-y-2 border border-foreground-100 rounded-lg p-3 max-h-56 overflow-y-auto">
            <p>The information you provide will be processed in accordance with the ESFA ILR privacy notice. Your personal data is collected by the learning provider and shared with the Department for Education (DfE) and its agencies for the purposes of funding, monitoring, and quality assurance of education and training.</p>
            <p>Your information may be shared with third parties, including the End Point Assessment Organisation and Awarding Organisation, and may be used for statistical and research purposes. You have the right to request access to your data and to object to its processing in certain circumstances.</p>
            <p>By signing below you confirm that the information provided is accurate and that you understand how your data will be used.</p>
          </div>
        )}
        <SignatureField value={ilr.signatureUrl} onChange={(v) => set({ signatureUrl: v || undefined })} />
      </div>
    </div>
  );
}
