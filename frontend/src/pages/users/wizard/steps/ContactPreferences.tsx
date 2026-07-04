import type { ReactNode } from 'react';
import { useWizard } from '../WizardContext';
import { COUNTRY_OPTIONS, NATIONALITY_OPTIONS, WAGE_BAND_OPTIONS, GENDER_IDENTITY_OPTIONS, YES_NO_SELECT } from '@/mocks/enrolment-console';
import { YesNoRadio, FileList, inputClass } from '../../components/ui';
import { LabeledInput, LabeledSelect, LabeledTextarea, StepHeading } from './fields';

function Fieldset({ legend, intro, children }: { legend: string; intro?: string; children: ReactNode }) {
  return (
    <fieldset className="border border-foreground-100 rounded-xl p-4 mb-4">
      <legend className="text-[13px] font-heading font-semibold text-foreground-800 px-1">{legend}</legend>
      {intro && <p className="text-[12px] text-foreground-500 mb-3 leading-relaxed">{intro}</p>}
      {children}
    </fieldset>
  );
}

export default function ContactPreferences() {
  const { draft, setSection } = useWizard();
  const cp = draft.contactPreferences;
  const set = (patch: Partial<typeof cp>) => setSection('contactPreferences', { ...cp, ...patch });

  return (
    <div>
      <StepHeading title="Contact Preferences" />
      <div className="max-w-3xl">
        <Fieldset legend="Contact Preferences" intro="Where the use of your contact details is not part of our statutory duties, you can give your consent to be contacted about:">
          <YesNoRadio legend="About courses or learning opportunities" name="c-courses" value={cp.consent.courses} onChange={(v) => set({ consent: { ...cp.consent, courses: v } })} />
          <YesNoRadio legend="For surveys and research" name="c-surveys" value={cp.consent.surveys} onChange={(v) => set({ consent: { ...cp.consent, surveys: v } })} />
          <YesNoRadio legend="By post" name="c-post" value={cp.consent.byPost} onChange={(v) => set({ consent: { ...cp.consent, byPost: v } })} />
          <YesNoRadio legend="By phone" name="c-phone" value={cp.consent.byPhone} onChange={(v) => set({ consent: { ...cp.consent, byPhone: v } })} />
          <YesNoRadio legend="By e-mail" name="c-email" value={cp.consent.byEmail} onChange={(v) => set({ consent: { ...cp.consent, byEmail: v } })} />
        </Fieldset>

        <Fieldset legend="Emergency contact details / Next of kin">
          <LabeledInput label="Full name" value={cp.nextOfKin.fullName} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, fullName: v } })} />
          <LabeledInput label="Relationship to you" value={cp.nextOfKin.relationship} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, relationship: v } })} />
          <LabeledInput label="Email address" type="email" value={cp.nextOfKin.email} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, email: v } })} />
          <LabeledInput label="Phone number" type="tel" value={cp.nextOfKin.phone} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, phone: v } })} />
          <YesNoRadio legend="Address same as learner?" name="nok-same" value={cp.nextOfKin.sameAddressAsLearner} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, sameAddressAsLearner: v } })} />
          <LabeledInput label="Postcode" value={cp.nextOfKin.postcode ?? ''} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, postcode: v } })} />
          <LabeledInput label="Address" value={cp.nextOfKin.address ?? ''} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, address: v } })} />
          <LabeledInput label="Address 2" value={cp.nextOfKin.address2 ?? ''} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, address2: v } })} />
          <LabeledInput label="City" value={cp.nextOfKin.city ?? ''} onChange={(v) => set({ nextOfKin: { ...cp.nextOfKin, city: v } })} />
        </Fieldset>

        <Fieldset legend="Eligibility">
          <LabeledSelect label="Country of birth" value={cp.eligibility.countryOfBirth} options={COUNTRY_OPTIONS} onChange={(v) => set({ eligibility: { ...cp.eligibility, countryOfBirth: v } })} />
          <YesNoRadio legend="Are you primarily employed in England?" name="e-eng" value={cp.eligibility.employedInEngland} onChange={(v) => set({ eligibility: { ...cp.eligibility, employedInEngland: v } })} />
          <LabeledSelect label="Country of residence" value={cp.eligibility.countryOfResidence} options={COUNTRY_OPTIONS} onChange={(v) => set({ eligibility: { ...cp.eligibility, countryOfResidence: v } })} />
          <YesNoRadio legend="Are you a UK/EEA National?" name="e-ukeea" value={cp.eligibility.ukEeaNational} onChange={(v) => set({ eligibility: { ...cp.eligibility, ukEeaNational: v } })} />
          <LabeledSelect label="Nationality" value={cp.eligibility.nationality} options={NATIONALITY_OPTIONS} onChange={(v) => set({ eligibility: { ...cp.eligibility, nationality: v } })} />
          <YesNoRadio legend="Have you been resident in the UK/EEA for the previous 3 years?" name="e-res3" value={cp.eligibility.residentPrev3Years} onChange={(v) => set({ eligibility: { ...cp.eligibility, residentPrev3Years: v } })} />
          <LabeledInput label="How many full years have you lived in the UK?" type="number" value={cp.eligibility.yearsInUk != null ? String(cp.eligibility.yearsInUk) : ''} onChange={(v) => set({ eligibility: { ...cp.eligibility, yearsInUk: v ? Number(v) : undefined } })} />
          <YesNoRadio legend="Do you require a Work Permit?" name="e-wp" value={cp.eligibility.requiresWorkPermit} onChange={(v) => set({ eligibility: { ...cp.eligibility, requiresWorkPermit: v } })} />
          <div className="pt-3">
            <p className="text-[12px] text-foreground-500 mb-2 leading-relaxed">
              UK nationals: provide a passport or birth certificate. Non-UK / EEA nationals: provide evidence of your right to work and residency status. Please describe and upload your evidence below.
            </p>
            <textarea rows={2} value={cp.eligibility.evidenceDescription ?? ''} onChange={(e) => set({ eligibility: { ...cp.eligibility, evidenceDescription: e.target.value } })} placeholder="Describe the evidence provided…" className={`${inputClass} mb-2`} />
            <FileList
              files={cp.eligibility.evidenceFiles.map((n, i) => ({ id: `${n}-${i}`, name: n }))}
              onDelete={(id) => set({ eligibility: { ...cp.eligibility, evidenceFiles: cp.eligibility.evidenceFiles.filter((_, i) => `${cp.eligibility.evidenceFiles[i]}-${i}` !== id) } })}
              emptyText="No evidence uploaded"
              addLabel="Add evidence"
              onAdd={() => {}}
            />
            <label className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 text-[12px] bg-background-100 text-foreground-600 rounded-lg border border-background-200 hover:bg-background-200 transition-smooth cursor-pointer">
              <i className="ri-upload-2-line" />Upload file
              <input type="file" multiple className="hidden" onChange={(e) => set({ eligibility: { ...cp.eligibility, evidenceFiles: [...cp.eligibility.evidenceFiles, ...Array.from(e.target.files ?? []).map((f) => f.name)] } })} />
            </label>
          </div>
        </Fieldset>

        <Fieldset legend="Other training">
          <YesNoRadio legend="Have you attended any other government funded training programmes in the last 12 months?" name="ot-gov" value={cp.otherGovFundedTraining12m} onChange={(v) => set({ otherGovFundedTraining12m: v })} />
        </Fieldset>

        <Fieldset legend="Personal Circumstances">
          <LabeledTextarea label="What is your current home situation? Who do you live with?" value={cp.circumstances.homeSituation} onChange={(v) => set({ circumstances: { ...cp.circumstances, homeSituation: v } })} />
          <LabeledTextarea label="Do you have any caring responsibilities?" value={cp.circumstances.caringResponsibilities} onChange={(v) => set({ circumstances: { ...cp.circumstances, caringResponsibilities: v } })} />
          <LabeledTextarea label="Are there any other personal circumstances you want to tell us about?" value={cp.circumstances.other} onChange={(v) => set({ circumstances: { ...cp.circumstances, other: v } })} />
          <LabeledTextarea label="What support, if any, do you need to achieve this programme? (for example, childcare, travel planning, holidays etc.)" value={cp.circumstances.supportNeeded} onChange={(v) => set({ circumstances: { ...cp.circumstances, supportNeeded: v } })} />
          <YesNoRadio legend="Care leaver" name="pc-care" value={cp.circumstances.careLeaver} onChange={(v) => set({ circumstances: { ...cp.circumstances, careLeaver: v } })} />
        </Fieldset>

        <Fieldset legend="Programme understanding">
          <LabeledTextarea label="What is your understanding of the programme you are applying for?" value={cp.understanding.programmeUnderstanding} onChange={(v) => set({ understanding: { ...cp.understanding, programmeUnderstanding: v } })} />
          <LabeledTextarea label="How will this programme help you in your career development/aspirations, and/or with your progression?" value={cp.understanding.careerProgression} onChange={(v) => set({ understanding: { ...cp.understanding, careerProgression: v } })} />
        </Fieldset>

        <Fieldset legend="Additional information">
          <LabeledSelect label="Please confirm your 'current wage rate per hour' is equal to or higher than:" value={cp.additional.wageRateBand} options={WAGE_BAND_OPTIONS} onChange={(v) => set({ additional: { ...cp.additional, wageRateBand: v } })} />
          <LabeledSelect label="If you have identified any long term disability, health problem or any learning difficulties, can you confirm if this can be discussed with your employer, where appropriate?" value={cp.additional.disabilityDiscussEmployer} options={YES_NO_SELECT} onChange={(v) => set({ additional: { ...cp.additional, disabilityDiscussEmployer: v } })} />
          <LabeledInput label="If selected other, please confirm your weekly or annual income" value={cp.additional.otherIncome ?? ''} onChange={(v) => set({ additional: { ...cp.additional, otherIncome: v } })} />
          <YesNoRadio legend="Are you aged between 16 and 18?" name="a-1618" value={cp.additional.aged16to18} onChange={(v) => set({ additional: { ...cp.additional, aged16to18: v } })} />
          <YesNoRadio legend="Are you aged between 19 and 24?" name="a-1924" value={cp.additional.aged19to24} onChange={(v) => set({ additional: { ...cp.additional, aged19to24: v } })} />
        </Fieldset>

        <Fieldset legend="Media Consent">
          <p className="text-[12px] text-foreground-500 mb-3 leading-relaxed">
            Kent Business College may capture photographs, video or written testimonials during your programme for use in marketing,
            case studies and social media.
          </p>
          <YesNoRadio legend="Do you give Kent Business College consent for the above?" name="m-consent" value={cp.media.consent} onChange={(v) => set({ media: { ...cp.media, consent: v } })} />
          <p className="text-[12px] text-foreground-500 my-3 leading-relaxed">
            The DfE only offers two gender options for statutory reporting. Please tell us how you would like to be known.
          </p>
          <LabeledInput label="What name do you prefer to be called?" value={cp.media.preferredName} onChange={(v) => set({ media: { ...cp.media, preferredName: v } })} />
          <LabeledSelect label="Gender Identity" value={cp.media.genderIdentity} options={GENDER_IDENTITY_OPTIONS} onChange={(v) => set({ media: { ...cp.media, genderIdentity: v } })} />
          <LabeledInput label="If other please detail" value={cp.media.genderOther ?? ''} onChange={(v) => set({ media: { ...cp.media, genderOther: v } })} />
          <LabeledSelect label="What are your preferred pronouns?" value={cp.media.pronouns} options={['He/Him', 'She/Her', 'They/Them', 'Prefer not to say']} onChange={(v) => set({ media: { ...cp.media, pronouns: v } })} />
        </Fieldset>

        <Fieldset legend="Declarations / consents">
          <YesNoRadio legend="I understand that my Personal Learning Record (PLR) information will be shared with Kent Business College and other relevant organisations" name="d-plr" value={cp.declarations.plrShared} onChange={(v) => set({ declarations: { ...cp.declarations, plrShared: v } })} />
          <YesNoRadio legend="I understand that I am on a programme that is part funded by the DfE, and that members of the qualification and funding authorities may contact me in connection to my apprenticeship" name="d-dfe" value={cp.declarations.dfeContact} onChange={(v) => set({ declarations: { ...cp.declarations, dfeContact: v } })} />
          <YesNoRadio legend="I understand that relevant personal details will be provided to the End Point and Awarding Organisation so that Registration and Certification can take place" name="d-epao" value={cp.declarations.epaoDetails} onChange={(v) => set({ declarations: { ...cp.declarations, epaoDetails: v } })} />
          <YesNoRadio legend="I understand that Kent Business College will hold any relevant copies of my certificates for audit purposes" name="d-certs" value={cp.declarations.kbcHoldsCerts} onChange={(v) => set({ declarations: { ...cp.declarations, kbcHoldsCerts: v } })} />
          <YesNoRadio legend="I confirm that all the information contained in this application is accurate and true" name="d-accurate" value={cp.declarations.infoAccurate} onChange={(v) => set({ declarations: { ...cp.declarations, infoAccurate: v } })} />
        </Fieldset>
      </div>
    </div>
  );
}
