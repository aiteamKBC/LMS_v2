import type { ReactNode } from 'react';
import { useWizard } from '../WizardContext';
import { useToast } from '@/hooks/useToast';
import { COUNTRY_OPTIONS, NATIONALITY_OPTIONS } from '@/lib/countries';
import { YES_NO_SELECT } from '@/mocks/enrolment-console';
import { YesNoRadio, inputClass, btnPrimary, btnSecondary } from '../../components/ui';
import IlrEligibilityEvidence from './IlrEligibilityEvidence';
import { useEmployerDetailsPrefill } from './useEmployerDetailsPrefill';
import { LabeledInput, LabeledSelect, LabeledTextarea, StepHeading } from './fields';
import { downloadIlrDocument } from './ilrDocument';
import { IlrText } from './ilrAdditionalText';
import { requiredMessage, useMissingCheck } from '../stepErrors';

function Fieldset({ legend, intro, children }: { legend: string; intro?: string; children: ReactNode }) {
  return (
    <fieldset className="border border-foreground-100 rounded-xl p-4 mb-4">
      <legend className="text-[13px] font-heading font-semibold text-foreground-800 px-1">{legend}</legend>
      {intro && <p className="text-[12px] text-foreground-500 mb-3 leading-relaxed">{intro}</p>}
      {children}
    </fieldset>
  );
}

export default function Ilr() {
  const { board, draft, setSection, saveIlr, ilrSaving, ilrSavedAt, fileIlrDocument, ilrFiling } = useWizard();
  const { success, error } = useToast();
  const ilr = draft.ilr;
  const set = (patch: Partial<typeof ilr>) => setSection('ilr', { ...ilr, ...patch });
  // Empty Employer Details are filled from the learner's employer and organisation.
  useEmployerDetailsPrefill();
  // Red Yes/No rows once Next is pressed with them unanswered.
  const missing = useMissingCheck();
  const yn = (key: string) => (missing(key) ? requiredMessage('', 'choose') : undefined);

  const ai = ilr.additionalInformation;
  const setAi = (patch: Partial<typeof ai>) => set({ additionalInformation: { ...ai, ...patch } });

  // The learning and provider declarations (and their signature blocks) are no
  // longer on this step, so the Personal details signature is no longer copied
  // into the ILR either: it would sign a declaration the learner never saw.

  // Save the answers and file the PDF together: a filed document that doesn't
  // match the stored answers would be worse than not filing at all.
  const saveAndFile = async () => {
    try {
      await saveIlr();
      await fileIlrDocument();
      success('Document filed', 'The ILR PDF is now under Compliance documents on this learner’s profile.');
    } catch (e) {
      error('Could not file the ILR document', e instanceof Error ? e.message : 'Unexpected error');
    }
  };

  return (
    <div>
      <StepHeading title="Extended ILR" subtitle="Learner Details Data Capture Form" />

      <div className="max-w-3xl">
        <Fieldset legend="Contact Preferences" intro="How would you prefer to be contacted?">
          <YesNoRadio legend="By post" name="c-post" error={yn('Contact by post')} value={ilr.contact.byPost} onChange={(v) => set({ contact: { ...ilr.contact, byPost: v } })} />
          <YesNoRadio legend="By phone" name="c-phone" error={yn('Contact by phone')} value={ilr.contact.byPhone} onChange={(v) => set({ contact: { ...ilr.contact, byPhone: v } })} />
          <YesNoRadio legend="By e-mail" name="c-email" error={yn('Contact by e-mail')} value={ilr.contact.byEmail} onChange={(v) => set({ contact: { ...ilr.contact, byEmail: v } })} />
        </Fieldset>

        <Fieldset legend="Emergency contact details / Next of kin">
          <LabeledInput label="Full name" missingKey="Next of kin — full name" value={ilr.nextOfKin.fullName} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, fullName: v } })} />
          <LabeledInput label="Relationship to you" missingKey="Next of kin — relationship" value={ilr.nextOfKin.relationship} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, relationship: v } })} />
          <LabeledInput label="Email address" type="email" missingKey="Next of kin — email" value={ilr.nextOfKin.email} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, email: v } })} />
          <LabeledInput label="Phone number" type="tel" missingKey="Next of kin — phone" value={ilr.nextOfKin.phone} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, phone: v } })} />
          {/* Answering Yes clears the contact's own address, so a hidden answer is never saved or printed. */}
          <YesNoRadio legend="Address same as learner?" name="nok-same" error={yn('Next of kin — same address')} value={ilr.nextOfKin.sameAddressAsLearner} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, sameAddressAsLearner: v, ...(v ? { postcode: '', address: '' } : {}) } })} />
          {ilr.nextOfKin.sameAddressAsLearner === false && (
            <>
              <LabeledInput label="Postcode" placeholder="Post Code" missingKey="Next of kin — postcode" value={ilr.nextOfKin.postcode ?? ''} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, postcode: v } })} />
              <LabeledInput label="Address" missingKey="Next of kin — address" value={ilr.nextOfKin.address ?? ''} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, address: v } })} />
            </>
          )}
        </Fieldset>

        <Fieldset legend="Eligibility">
          <YesNoRadio legend="Are you primarily employed in England?" name="e-eng" error={yn('Employed in England')} value={ilr.eligibility.employedInEngland} onChange={(v) => set({ eligibility: { ...ilr.eligibility, employedInEngland: v } })} />
          <LabeledSelect label="Please state your country of residence" missingKey="Country of residence" value={ilr.eligibility.countryOfResidence} options={COUNTRY_OPTIONS} onChange={(v) => set({ eligibility: { ...ilr.eligibility, countryOfResidence: v } })} />
          <YesNoRadio legend="Are you a UK/EEA National?" name="e-ukeea" error={yn('UK / EEA national')} value={ilr.eligibility.ukEeaNational} onChange={(v) => set({ eligibility: { ...ilr.eligibility, ukEeaNational: v } })} />
          <LabeledSelect label="Please state your nationality" missingKey="Nationality" value={ilr.eligibility.nationality} options={NATIONALITY_OPTIONS} onChange={(v) => set({ eligibility: { ...ilr.eligibility, nationality: v } })} />
          <YesNoRadio legend="Have you been resident in the UK/EEA for the previous 3 years?" name="e-res3" error={yn('Resident for the previous 3 years')} value={ilr.eligibility.residentPrev3Years} onChange={(v) => set({ eligibility: { ...ilr.eligibility, residentPrev3Years: v } })} />
          <LabeledInput label="How many full years have you lived in the UK?" type="number" missingKey="Years in the UK" value={ilr.eligibility.yearsInUk != null ? String(ilr.eligibility.yearsInUk) : ''} onChange={(v) => set({ eligibility: { ...ilr.eligibility, yearsInUk: v ? Number(v) : undefined } })} />
          <YesNoRadio legend="Do you require a Work Permit?" name="e-wp" error={yn('Requires a work permit')} value={ilr.eligibility.requiresWorkPermit} onChange={(v) => set({ eligibility: { ...ilr.eligibility, requiresWorkPermit: v } })} />

          <div className="pt-3">
            <p className="text-[12px] text-foreground-500 mb-2 leading-relaxed">
              Please upload a copy of your proof of identification and residency using the ‘Add evidence’ button below. In the text box,
              please provide written information about the evidence provided (for example, passport, Application Registration Card).
            </p>
            <p className="text-[12px] text-foreground-500 mb-2 leading-relaxed">
              For UK nationals: valid proof of identification and residency — passport or birth certificate. For non-UK nationals:
              passport or birth certificate for identification, and for residency a valid visa, Home Office letter, Immigration and
              Nationality Department letter or Application Registration Card (ARC), with the start of UK residency 3 years prior to the
              enrolment date. For EEA nationals: proof of pre-settled or settled status under the EU Settlement Scheme.
            </p>
            <textarea
              rows={2}
              value={ilr.eligibility.evidenceDescription}
              onChange={(e) => set({ eligibility: { ...ilr.eligibility, evidenceDescription: e.target.value } })}
              placeholder="Describe the evidence provided…"
              className={`${inputClass} mb-2`}
            />
            {/* Stored in Azure with its blob path on the Extended_ILR row, not in the answers. */}
            <IlrEligibilityEvidence />
          </div>
        </Fieldset>

        <Fieldset legend="Employer Details" intro="Please provide the address you work at:">
          <LabeledInput label="Organisation Name" missingKey="Employer — organisation name" value={ilr.employer.organisationName} onChange={(v) => set({ employer: { ...ilr.employer, organisationName: v } })} />
          <LabeledInput label="Postcode" missingKey="Employer — postcode" value={ilr.employer.postcode} onChange={(v) => set({ employer: { ...ilr.employer, postcode: v } })} />
          <LabeledInput label="Address" missingKey="Employer — address" value={ilr.employer.address} onChange={(v) => set({ employer: { ...ilr.employer, address: v } })} />
          <LabeledInput label="City" missingKey="Employer — city" value={ilr.employer.city} onChange={(v) => set({ employer: { ...ilr.employer, city: v } })} />
          <LabeledInput label="Line Manager name" missingKey="Line manager — name" value={ilr.employer.lineManagerName} onChange={(v) => set({ employer: { ...ilr.employer, lineManagerName: v } })} />
          <LabeledInput label="Line Manager email" type="email" missingKey="Line manager — email" value={ilr.employer.lineManagerEmail} onChange={(v) => set({ employer: { ...ilr.employer, lineManagerEmail: v } })} />
          <LabeledInput label="Line Manager phone" type="tel" missingKey="Line manager — phone" value={ilr.employer.lineManagerPhone} onChange={(v) => set({ employer: { ...ilr.employer, lineManagerPhone: v } })} />
        </Fieldset>

        <Fieldset legend="Other training">
          <YesNoRadio legend="Have you attended any other government funded training programmes in the last 12 months?" name="ot-gov" error={yn('Other training in the last 12 months')} value={ilr.otherTraining.attended12m} onChange={(v) => set({ otherTraining: { ...ilr.otherTraining, attended12m: v } })} />
          {ilr.otherTraining.attended12m && (
            <LabeledInput label="When was it completed?" type="date" missingKey="Other training — when completed" value={ilr.otherTraining.completedWhen} onChange={(v) => set({ otherTraining: { ...ilr.otherTraining, completedWhen: v } })} />
          )}
        </Fieldset>

        <Fieldset legend="Personal Circumstances">
          <LabeledTextarea label="Do you have any caring responsibilities?" missingKey="Caring responsibilities" value={ilr.circumstances.caringResponsibilities} onChange={(v) => set({ circumstances: { ...ilr.circumstances, caringResponsibilities: v } })} />
          <LabeledTextarea label="Are there any other personal circumstances you want to tell us about?" value={ilr.circumstances.other} onChange={(v) => set({ circumstances: { ...ilr.circumstances, other: v } })} />
          <YesNoRadio legend="Care leaver" name="pc-care" error={yn('Care leaver')} value={ilr.circumstances.careLeaver} onChange={(v) => set({ circumstances: { ...ilr.circumstances, careLeaver: v } })} />
        </Fieldset>

        <Fieldset legend="Programme understanding">
          <LabeledTextarea label="What is your understanding of the programme you are applying for?" missingKey="Understanding of the programme" value={ilr.understanding.programmeUnderstanding} onChange={(v) => set({ understanding: { ...ilr.understanding, programmeUnderstanding: v } })} />
          <LabeledTextarea label="How will this programme help you in your career development/aspirations, and/or with your progression?" rows={5} missingKey="Career progression" value={ilr.understanding.careerProgression} onChange={(v) => set({ understanding: { ...ilr.understanding, careerProgression: v } })} />
        </Fieldset>

        {/* Replaced the age questions, media consent, the learning declaration and
            the provider declaration. Wording shared with the PDF (ilrAdditionalText). */}
        <Fieldset legend="Additional Information">
          <LabeledTextarea label={IlrText.jobRoleRelevance} required rows={4} missingKey="Job role and the programme" value={ai.jobRoleRelevance} onChange={(v) => setAi({ jobRoleRelevance: v })} />
          <LabeledSelect label={IlrText.residenceNotForFullTimeEducation} required missingKey="Residence not for full-time education" value={ai.residenceNotForFullTimeEducation} options={YES_NO_SELECT} onChange={(v) => setAi({ residenceNotForFullTimeEducation: v })} />

          <h4 className="text-[13px] font-heading font-semibold text-foreground-800 pt-4 pb-1">EHCP Status</h4>
          <p className="text-[12px] text-foreground-500 pb-2 leading-relaxed">{IlrText.ehcpSharing}</p>
          <LabeledSelect label={IlrText.ehcp} required missingKey="EHCP" value={ai.ehcp} options={YES_NO_SELECT} onChange={(v) => setAi({ ehcp: v })} />
          <p className="text-[12px] text-foreground-500 py-2 leading-relaxed">{IlrText.ehcpUse}</p>

          <YesNoRadio legend={IlrText.over50PercentEngland} name="d-50pc" error={yn('Declaration — over 50% in England')} value={ilr.declarations.over50PercentEngland} onChange={(v) => set({ declarations: { ...ilr.declarations, over50PercentEngland: v } })} />
          <LabeledSelect label={IlrText.wageRateBand} required missingKey="Wage rate band" value={ilr.declarations.wageRateBand} options={[...IlrText.wageRateOptions]} onChange={(v) => set({ declarations: { ...ilr.declarations, wageRateBand: v } })} />
          <p className="text-[12px] text-foreground-500 py-2 leading-relaxed">
            If you are not sure use this link to check:{' '}
            <a href={IlrText.wageRateLink} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
              {IlrText.wageRateLink}
            </a>
          </p>
          {/* Answering No clears the listed names, so a hidden answer is never saved or printed. */}
          <YesNoRadio legend={IlrText.knownByOtherName} name="d-othername" error={yn('Known by another name')} value={ilr.declarations.knownByOtherName} onChange={(v) => set({ declarations: { ...ilr.declarations, knownByOtherName: v }, ...(v ? {} : { additionalInformation: { ...ai, otherNames: '' } }) })} />
          {ilr.declarations.knownByOtherName === true && (
            <LabeledTextarea label={IlrText.otherNames} value={ai.otherNames} onChange={(v) => setAi({ otherNames: v })} />
          )}

          <p className="text-[12px] text-foreground-600 font-medium pt-3 pb-2 leading-relaxed">{IlrText.plrRecord}</p>
          <p className="text-[12px] text-foreground-500 pb-2 leading-relaxed">{IlrText.plrSharing}</p>
          <YesNoRadio legend={IlrText.plrAccessAware} name="d-plraccess" error={yn('Aware provider will access PLR')} value={ilr.declarations.plrAccessAware} onChange={(v) => set({ declarations: { ...ilr.declarations, plrAccessAware: v } })} />
        </Fieldset>

        {/* Save + export. The document renders whatever is on screen, so it can
            be produced before saving; saving persists to enrolment."Extended_ILR". */}
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button className={btnPrimary} onClick={() => downloadIlrDocument(ilr, board)}>
            <AppIcon className="ri-file-download-line" />Download ILR document
          </button>
          {/* A plain save is the wizard footer's job — Next on the learner side,
              "Save progress" on the staff side; this one additionally files the
              PDF into Compliance documents. */}
          <button className={btnSecondary} onClick={saveAndFile} disabled={ilrSaving || ilrFiling}>
            {ilrFiling ? <><AppIcon className="ri-loader-4-line animate-spin" />Filing…</> : <><AppIcon className="ri-folder-upload-line" />Save &amp; file document</>}
          </button>
          {ilrSavedAt && !ilrSaving && !ilrFiling && (
            <span className="text-[12px] text-emerald-600 inline-flex items-center gap-1">
              <AppIcon className="ri-check-line" />Saved
            </span>
          )}
        </div>
        <p className="text-[12px] text-foreground-500 mb-2">
          The document contains every answer above plus the signature blocks, ready to print and sign.
          Filing it stores a copy against this learner’s Compliance documents.
        </p>
      </div>
    </div>
  );
}
