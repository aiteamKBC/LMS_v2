import { useEffect, type ReactNode } from 'react';
import { useWizard } from '../WizardContext';
import { useToast } from '@/hooks/useToast';
import { COUNTRY_OPTIONS, NATIONALITY_OPTIONS, WAGE_BAND_OPTIONS } from '@/mocks/enrolment-console';
import { YesNoRadio, FileList, inputClass, btnPrimary, btnSecondary } from '../../components/ui';
import { LabeledInput, LabeledSelect, LabeledTextarea, SignatureField, StepHeading } from './fields';
import { downloadIlrDocument } from './ilrDocument';

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

  // The learner already signed on Personal details, so reuse that signature here
  // rather than asking for the same mark twice.
  //
  // Copied into the ILR block rather than only displayed: the PDF export and the
  // "learner signed" flag both read learnerSignature.signatureUrl, so a purely
  // visual fallback would show a signature on screen but file a blank one. Runs
  // once, only while this block has no signature of its own — replacing or
  // clearing it on this step then wins, so a deliberately different declaration
  // signature is never overwritten.
  const personalSignature = draft.personalDetails.signature;
  const usingPersonalSignature = !ilr.learnerSignature.signatureUrl && Boolean(personalSignature);

  useEffect(() => {
    if (!usingPersonalSignature) return;
    set({
      learnerSignature: {
        ...ilr.learnerSignature,
        signatureUrl: personalSignature,
        date: ilr.learnerSignature.date || draft.personalDetails.signatureDate || new Date().toISOString().slice(0, 10),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usingPersonalSignature, personalSignature]);

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
          <YesNoRadio legend="By post" name="c-post" value={ilr.contact.byPost} onChange={(v) => set({ contact: { ...ilr.contact, byPost: v } })} />
          <YesNoRadio legend="By phone" name="c-phone" value={ilr.contact.byPhone} onChange={(v) => set({ contact: { ...ilr.contact, byPhone: v } })} />
          <YesNoRadio legend="By e-mail" name="c-email" value={ilr.contact.byEmail} onChange={(v) => set({ contact: { ...ilr.contact, byEmail: v } })} />
        </Fieldset>

        <Fieldset legend="Emergency contact details / Next of kin">
          <LabeledInput label="Full name" value={ilr.nextOfKin.fullName} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, fullName: v } })} />
          <LabeledInput label="Relationship to you" value={ilr.nextOfKin.relationship} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, relationship: v } })} />
          <LabeledInput label="Email address" type="email" value={ilr.nextOfKin.email} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, email: v } })} />
          <LabeledInput label="Phone number" type="tel" value={ilr.nextOfKin.phone} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, phone: v } })} />
          <YesNoRadio legend="Address same as learner?" name="nok-same" value={ilr.nextOfKin.sameAddressAsLearner} onChange={(v) => set({ nextOfKin: { ...ilr.nextOfKin, sameAddressAsLearner: v } })} />
        </Fieldset>

        <Fieldset legend="Eligibility">
          <YesNoRadio legend="Are you primarily employed in England?" name="e-eng" value={ilr.eligibility.employedInEngland} onChange={(v) => set({ eligibility: { ...ilr.eligibility, employedInEngland: v } })} />
          <LabeledSelect label="Please state your country of residence" value={ilr.eligibility.countryOfResidence} options={COUNTRY_OPTIONS} onChange={(v) => set({ eligibility: { ...ilr.eligibility, countryOfResidence: v } })} />
          <YesNoRadio legend="Are you a UK/EEA National?" name="e-ukeea" value={ilr.eligibility.ukEeaNational} onChange={(v) => set({ eligibility: { ...ilr.eligibility, ukEeaNational: v } })} />
          <LabeledSelect label="Please state your nationality" value={ilr.eligibility.nationality} options={NATIONALITY_OPTIONS} onChange={(v) => set({ eligibility: { ...ilr.eligibility, nationality: v } })} />
          <YesNoRadio legend="Have you been resident in the UK/EEA for the previous 3 years?" name="e-res3" value={ilr.eligibility.residentPrev3Years} onChange={(v) => set({ eligibility: { ...ilr.eligibility, residentPrev3Years: v } })} />
          <LabeledInput label="How many full years have you lived in the UK?" type="number" value={ilr.eligibility.yearsInUk != null ? String(ilr.eligibility.yearsInUk) : ''} onChange={(v) => set({ eligibility: { ...ilr.eligibility, yearsInUk: v ? Number(v) : undefined } })} />
          <YesNoRadio legend="Do you require a Work Permit?" name="e-wp" value={ilr.eligibility.requiresWorkPermit} onChange={(v) => set({ eligibility: { ...ilr.eligibility, requiresWorkPermit: v } })} />

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
            <FileList
              files={ilr.eligibility.evidenceFiles.map((n, i) => ({ id: `${n}-${i}`, name: n }))}
              onDelete={(id) => set({ eligibility: { ...ilr.eligibility, evidenceFiles: ilr.eligibility.evidenceFiles.filter((_, i) => `${ilr.eligibility.evidenceFiles[i]}-${i}` !== id) } })}
              emptyText="No evidence uploaded"
              addLabel="Add evidence"
            />
            <label className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 text-[12px] bg-background-100 text-foreground-600 rounded-lg border border-background-200 hover:bg-background-200 transition-smooth cursor-pointer">
              <i className="ri-upload-2-line" />Upload file
              <input type="file" multiple className="hidden" onChange={(e) => set({ eligibility: { ...ilr.eligibility, evidenceFiles: [...ilr.eligibility.evidenceFiles, ...Array.from(e.target.files ?? []).map((f) => f.name)] } })} />
            </label>
          </div>
        </Fieldset>

        <Fieldset legend="Employer Details" intro="Please provide the address you work at:">
          <LabeledInput label="Organisation Name" value={ilr.employer.organisationName} onChange={(v) => set({ employer: { ...ilr.employer, organisationName: v } })} />
          <LabeledInput label="Postcode" value={ilr.employer.postcode} onChange={(v) => set({ employer: { ...ilr.employer, postcode: v } })} />
          <LabeledInput label="Address" value={ilr.employer.address} onChange={(v) => set({ employer: { ...ilr.employer, address: v } })} />
          <LabeledInput label="City" value={ilr.employer.city} onChange={(v) => set({ employer: { ...ilr.employer, city: v } })} />
          <LabeledInput label="Line Manager name" value={ilr.employer.lineManagerName} onChange={(v) => set({ employer: { ...ilr.employer, lineManagerName: v } })} />
          <LabeledInput label="Line Manager email" type="email" value={ilr.employer.lineManagerEmail} onChange={(v) => set({ employer: { ...ilr.employer, lineManagerEmail: v } })} />
          <LabeledInput label="Line Manager phone" type="tel" value={ilr.employer.lineManagerPhone} onChange={(v) => set({ employer: { ...ilr.employer, lineManagerPhone: v } })} />
        </Fieldset>

        <Fieldset legend="Other training">
          <YesNoRadio legend="Have you attended any other government funded training programmes in the last 12 months?" name="ot-gov" value={ilr.otherTraining.attended12m} onChange={(v) => set({ otherTraining: { ...ilr.otherTraining, attended12m: v } })} />
          {ilr.otherTraining.attended12m && (
            <LabeledInput label="When was it completed?" type="date" value={ilr.otherTraining.completedWhen} onChange={(v) => set({ otherTraining: { ...ilr.otherTraining, completedWhen: v } })} />
          )}
        </Fieldset>

        <Fieldset legend="Personal Circumstances">
          <LabeledTextarea label="Do you have any caring responsibilities?" value={ilr.circumstances.caringResponsibilities} onChange={(v) => set({ circumstances: { ...ilr.circumstances, caringResponsibilities: v } })} />
          <LabeledTextarea label="Are there any other personal circumstances you want to tell us about?" value={ilr.circumstances.other} onChange={(v) => set({ circumstances: { ...ilr.circumstances, other: v } })} />
          <YesNoRadio legend="Care leaver" name="pc-care" value={ilr.circumstances.careLeaver} onChange={(v) => set({ circumstances: { ...ilr.circumstances, careLeaver: v } })} />
        </Fieldset>

        <Fieldset legend="Programme understanding">
          <LabeledTextarea label="What is your understanding of the programme you are applying for?" value={ilr.understanding.programmeUnderstanding} onChange={(v) => set({ understanding: { ...ilr.understanding, programmeUnderstanding: v } })} />
          <LabeledTextarea label="How will this programme help you in your career development/aspirations, and/or with your progression?" rows={5} value={ilr.understanding.careerProgression} onChange={(v) => set({ understanding: { ...ilr.understanding, careerProgression: v } })} />
        </Fieldset>

        <Fieldset legend="Additional information">
          <YesNoRadio legend="Are you aged between 16 and 18?" name="a-1618" value={ilr.additional.aged16to18} onChange={(v) => set({ additional: { ...ilr.additional, aged16to18: v } })} />
          <YesNoRadio legend="Are you aged between 19 and 24?" name="a-1924" value={ilr.additional.aged19to24} onChange={(v) => set({ additional: { ...ilr.additional, aged19to24: v } })} />
        </Fieldset>

        <Fieldset legend="Media Consent" intro="On occasion, Kent Business College may use your photograph or recordings in promotional material, on social media and other publications relating to our training provision.">
          <YesNoRadio legend="Do you give Kent Business College consent for the above?" name="m-consent" value={ilr.media.consent} onChange={(v) => set({ media: { ...ilr.media, consent: v } })} />
          <YesNoRadio legend="I understand that my Personal Learning Record (PLR) information will be shared with Kent Business College and other relevant organisations" name="d-plr" value={ilr.declarations.plrShared} onChange={(v) => set({ declarations: { ...ilr.declarations, plrShared: v } })} />
          <YesNoRadio legend="I understand that I am on programme that is part funded by the DfE. I understand that members of the qualification and funding authorities may contact me in connection to my apprenticeship" name="d-dfe" value={ilr.declarations.dfeContact} onChange={(v) => set({ declarations: { ...ilr.declarations, dfeContact: v } })} />
          <YesNoRadio legend="I understand that relevant personal details will be provided to the End Point and Awarding Organisation so that Registration and Certification can take place" name="d-epao" value={ilr.declarations.epaoDetails} onChange={(v) => set({ declarations: { ...ilr.declarations, epaoDetails: v } })} />
          <YesNoRadio legend="I understand that Kentbusinesscollege will hold any relevant copies of my certificates for audit purposes" name="d-certs" value={ilr.declarations.kbcHoldsCerts} onChange={(v) => set({ declarations: { ...ilr.declarations, kbcHoldsCerts: v } })} />
          <YesNoRadio legend="I confirm that all the information contained in this application is accurate and true" name="d-accurate" value={ilr.declarations.infoAccurate} onChange={(v) => set({ declarations: { ...ilr.declarations, infoAccurate: v } })} />
          <YesNoRadio legend="Could you confirm whether you expect to spend more than 50% of your working hours in England? (The measure of 50% should exclude any time expected to be spent outside of England in remote and/or hybrid working)" name="d-50pc" value={ilr.declarations.over50PercentEngland} onChange={(v) => set({ declarations: { ...ilr.declarations, over50PercentEngland: v } })} />
          <LabeledSelect label={'Please confirm your "current wage rate per hour" is equal to or higher than:'} value={ilr.declarations.wageRateBand} options={WAGE_BAND_OPTIONS} onChange={(v) => set({ declarations: { ...ilr.declarations, wageRateBand: v } })} />
          <p className="text-[12px] text-foreground-500 py-2 leading-relaxed">
            If you are not sure use this link to check:{' '}
            <a href="https://www.gov.uk/become-apprentice/pay-and-conditions" target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
              https://www.gov.uk/become-apprentice/pay-and-conditions
            </a>
          </p>
          <YesNoRadio legend="Have you ever been known by any other name?" name="d-othername" value={ilr.declarations.knownByOtherName} onChange={(v) => set({ declarations: { ...ilr.declarations, knownByOtherName: v } })} />
          <p className="text-[12px] text-foreground-500 py-2 leading-relaxed">
            Your personal learning record (PLR) is a permanent online record of your qualifications and achievements. Your Training
            Provider needs to access your PLR records to identify if you have any qualifications that could be considered as Recognised
            Prior Learning or exemptions.
          </p>
          <p className="text-[12px] text-foreground-500 pb-2 leading-relaxed">
            Your Personal Learning Record (PLR) data may be shared with authorised organisations where required for apprenticeship
            delivery, compliance, funding, quality assurance, assessment, and audit purposes. This may include the Department for
            Education (DfE), End-Point Assessment Organisations (EPAOs), Ofsted, awarding bodies, employers, auditors, and other
            authorised partners. Your data will be retained for a period of 6 years, in line with relevant funding, our compliance
            record, and record-keeping requirements.
          </p>
          <YesNoRadio legend="Please confirm that you are aware your training provider will need to access your PLR:" name="d-plraccess" value={ilr.declarations.plrAccessAware} onChange={(v) => set({ declarations: { ...ilr.declarations, plrAccessAware: v } })} />
        </Fieldset>

        {/* Learning declaration — mirrors the signature page of the printed document. */}
        <Fieldset legend="Learning declaration">
          <div className="text-[12px] text-foreground-600 leading-relaxed space-y-2 mb-3">
            <p>I confirm my agreement to share my Personal Learning Record (PLR) information with Kent Business College and other relevant bodies.</p>
            <p>I understand that my programme is supported and funded by the Department of Education (DfE) on behalf of the Secretary of State. I am happy to be contacted by the relevant funding authorities in connection with this programme.</p>
            <p>I confirm all the information completed in this Application for learning document is accurate.</p>
          </div>
          <LabeledInput label="First Names" value={ilr.learnerSignature.firstNames} onChange={(v) => set({ learnerSignature: { ...ilr.learnerSignature, firstNames: v } })} />
          <LabeledInput label="Surname" value={ilr.learnerSignature.surname} onChange={(v) => set({ learnerSignature: { ...ilr.learnerSignature, surname: v } })} />
          <LabeledInput label="Date" type="date" value={ilr.learnerSignature.date} onChange={(v) => set({ learnerSignature: { ...ilr.learnerSignature, date: v } })} />
          <SignatureField
            label="Learner signature"
            value={ilr.learnerSignature.signatureUrl}
            onChange={(v) => set({ learnerSignature: { ...ilr.learnerSignature, signatureUrl: v || undefined, date: v && !ilr.learnerSignature.date ? new Date().toISOString().slice(0, 10) : ilr.learnerSignature.date } })}
          />
          {Boolean(personalSignature) && ilr.learnerSignature.signatureUrl === personalSignature && (
            <p className="text-[11px] text-foreground-400 -mt-1 mb-1">
              <i className="ri-information-line mr-1" />Using the signature from your Personal details. Replace it here to sign this declaration differently.
            </p>
          )}
        </Fieldset>

        <Fieldset legend="Provider / Sub-contractor Declaration">
          <p className="text-[12px] text-foreground-600 leading-relaxed mb-3">
            I confirm I have seen evidence to verify the learners identity, immigration permission (if applicable) and relevant
            eligibility for this qualification/funding.
          </p>
          <LabeledInput label="Print Name" value={ilr.providerSignature.printName} onChange={(v) => set({ providerSignature: { ...ilr.providerSignature, printName: v } })} />
          <LabeledInput label="Date" type="date" value={ilr.providerSignature.date} onChange={(v) => set({ providerSignature: { ...ilr.providerSignature, date: v } })} />
          <SignatureField
            label="Provider signature"
            value={ilr.providerSignature.signatureUrl}
            onChange={(v) => set({ providerSignature: { ...ilr.providerSignature, signatureUrl: v || undefined, date: v && !ilr.providerSignature.date ? new Date().toISOString().slice(0, 10) : ilr.providerSignature.date } })}
          />
        </Fieldset>

        {/* Save + export. The document renders whatever is on screen, so it can
            be produced before saving; saving persists to enrolment."Extended_ILR". */}
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <button className={btnPrimary} onClick={() => downloadIlrDocument(ilr, board)}>
            <i className="ri-file-download-line" />Download ILR document
          </button>
          {/* Plain "Save progress" lives in the wizard footer on every step; this
              one additionally files the PDF into Compliance documents. */}
          <button className={btnSecondary} onClick={saveAndFile} disabled={ilrSaving || ilrFiling}>
            {ilrFiling ? <><i className="ri-loader-4-line animate-spin" />Filing…</> : <><i className="ri-folder-upload-line" />Save &amp; file document</>}
          </button>
          {ilrSavedAt && !ilrSaving && !ilrFiling && (
            <span className="text-[12px] text-emerald-600 inline-flex items-center gap-1">
              <i className="ri-check-line" />Saved
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
