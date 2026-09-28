import { useEffect, useState, type ReactNode } from 'react';
import { ageFromDob, useWizard } from '../WizardContext';
import { fetchIlrLearnerRecord, type IlrLearnerRecord } from '@/api/ilrLearnerRecord';
import { FieldRow, YesNoRadio, inputClass } from '../../components/ui';
import { LabeledInput, LabeledSelect, SignatureField, StepHeading } from './fields';
import { ILR_SIGNATURE_LABEL, ilrDetailsMissing } from '../validation';
import { FieldError, invalidClass, requiredMessage, useMissing, useMissingCheck } from '../stepErrors';
import type { IlrLearnerDetails as IlrLearnerDetailsState } from '../../types';
import {
  BENEFIT_CLAIM_BASIS_OPTIONS,
  EMPLOYMENT_STATUS_OPTIONS,
  ETHNICITY_OPTIONS,
  IN_PAID_EMPLOYMENT,
  LEGAL_SEX_OPTIONS,
  LENGTH_OF_UNEMPLOYMENT_OPTIONS,
  NOT_IN_PAID_EMPLOYMENT,
  NO_BENEFITS,
  PRIOR_ATTAINMENT_OPTIONS,
  STATE_BENEFIT_OPTIONS,
  labels,
} from '../ilrLearnerDetailsOptions';

/**
 * ILR Learner Details — the Individualised Learner Record's learner details,
 * health, education and employment questions, and its privacy declaration.
 *
 * Separate from the Extended ILR step and stored separately
 * (enrolment."Wizard_Ilr_Learner_Details"). Anything the learner record already
 * holds — name, DOB, current address, phone, email — is shown read-only from
 * it rather than retyped, so the ILR cannot disagree with the record.
 */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 border-b-2 border-primary-100 pb-1.5 font-heading text-[14px] font-semibold text-foreground-900">
        <span className="border-b-2 border-primary-500 pb-1.5">{title}</span>
      </h3>
      {children}
    </section>
  );
}

/** A required Yes/No — the shared radio row with the wizard's required star, red while unanswered after Next. */
function RequiredYesNo({ missingKey, ...props }: { legend: string; name: string; value: boolean | null; onChange: (v: boolean) => void; missingKey: string }) {
  const missing = useMissing(missingKey);
  return <YesNoRadio {...props} legend={`${props.legend} *`} error={missing ? requiredMessage(props.legend, 'choose') : undefined} />;
}

const NI_OR_APPLIED_KEY = 'National Insurance number, or confirm you have applied for one';

/** "DD/MM/YYYY" for a stored ISO date, or the value as stored. */
function displayDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

const NI_RE = /^[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]$/i;

export default function IlrLearnerDetails() {
  const { userId, isCommercial, draft, setSection, board } = useWizard();
  const missing = useMissingCheck();
  const d = draft.ilrDetails;
  const set = (patch: Partial<IlrLearnerDetailsState>) => setSection('ilrDetails', { ...d, ...patch });

  const [record, setRecord] = useState<IlrLearnerRecord | null>(null);
  const [recordError, setRecordError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchIlrLearnerRecord(isCommercial ? 'commercial' : 'apprenticeship', userId)
      .then((r) => { if (!cancelled) setRecord(r); })
      .catch((e: Error) => { if (!cancelled) setRecordError(e.message); });
    return () => { cancelled = true; };
  }, [userId, isCommercial]);

  // "Since birth" means the years at this address are the learner's age, from
  // the date of birth on their record (or their Personal details as a fallback).
  const ageYears = ageFromDob(record?.dateOfBirth || draft.personalDetails.dob) ?? null;

  // Everything this step fills in by itself, as ONE update: separate updates in
  // the same render would each start from the same stale section and the later
  // one would undo the earlier. An answer the learner already gave is kept.
  //  * the prior postcode starts as the current one (most learners have not
  //    moved since enrolling), and the NI number as the one staff verified;
  //  * "Since birth" keeps the years in step with the learner's age.
  // The certification signature is deliberately NOT filled in: the learner
  // signs it themselves, by clicking to sign.
  useEffect(() => {
    const fill: Partial<IlrLearnerDetailsState> = {};
    if (record?.currentPostcode && !d.postcodePriorToEnrolment) fill.postcodePriorToEnrolment = record.currentPostcode;
    if (record?.nationalInsuranceNumber && !d.niNumber) fill.niNumber = record.nationalInsuranceNumber;
    if (d.sinceBirth === true && ageYears !== null && d.yearsAtAddress !== ageYears) fill.yearsAtAddress = ageYears;
    if (Object.keys(fill).length) set(fill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, ageYears, d.sinceBirth]);

  const niError = d.niNumber.trim() && !NI_RE.test(d.niNumber.trim())
    ? 'Enter a valid National Insurance number, for example AB 12 34 56 C'
    : missing(NI_OR_APPLIED_KEY) ? 'Please enter your National Insurance number, or tick below to confirm you have applied for one.' : '';
  const legalSexMissing = Boolean(missing('Legal Sex'));
  const signatoryName = record ? [record.givenNames, record.familyName].filter(Boolean).join(' ') : '';
  // The certification comes last: clicking to sign while a required question
  // is unanswered lists what is missing instead. Same rule as the step's
  // completeness check, so the two cannot disagree.
  const missingBeforeSign = ilrDetailsMissing(draft).filter((label) => label !== ILR_SIGNATURE_LABEL);
  const noop = () => {};

  // Follow-up questions depend on earlier answers. Changing an answer clears the
  // follow-ups it no longer asks, so a hidden question never keeps a stale value.
  const inPaidEmployment = d.employmentStatus === IN_PAID_EMPLOYMENT;
  const notInPaidEmployment = NOT_IN_PAID_EMPLOYMENT.includes(d.employmentStatus);
  const claimsBenefit = Boolean(d.stateBenefits) && d.stateBenefits !== NO_BENEFITS;
  const changeEmploymentStatus = (status: string) => set({
    employmentStatus: status,
    ...(status === IN_PAID_EMPLOYMENT ? {} : { employmentStartDate: '', jobTitle: '', selfEmployed: null }),
    ...(NOT_IN_PAID_EMPLOYMENT.includes(status)
      // Preselected, as on the paper form: most learners out of work have been
      // for under six months.
      ? { lengthOfUnemployment: d.lengthOfUnemployment || LENGTH_OF_UNEMPLOYMENT_OPTIONS[0].label }
      : { lengthOfUnemployment: '', volunteers: null }),
  });

  return (
    <div>
      <StepHeading title="ILR" subtitle="Individualised Learner Record" />

      <Section title="Learner Details">
        {recordError && (
          <p className="mb-2 text-[12px] text-red-600"><i className="ri-error-warning-line mr-1" />{recordError}</p>
        )}
        <p className="mb-2 text-[12px] text-foreground-500">
          The greyed-out details come from your learner record. If any of them are wrong, please tell the enrolment team.
        </p>
        <LabeledInput label="Family name" value={record?.familyName ?? ''} onChange={noop} readOnly />
        <LabeledInput label="Given names" value={record?.givenNames ?? ''} onChange={noop} readOnly />
        <LabeledInput label="Date of birth" value={displayDate(record?.dateOfBirth ?? '')} onChange={noop} readOnly />
        <LabeledInput label="Current postcode" value={record?.currentPostcode ?? ''} onChange={noop} readOnly />
        <LabeledInput label="Current address line 1" value={record?.addressLine1 ?? ''} onChange={noop} readOnly />
        <LabeledInput label="Current address line 2" value={record?.addressLine2 ?? ''} onChange={noop} readOnly />
        <LabeledInput label="Current address line 3" value={record?.addressLine3 ?? ''} onChange={noop} readOnly />
        <LabeledInput label="Current address line 4" value={record?.addressLine4 ?? ''} onChange={noop} readOnly />

        <FieldRow label="How long have you been at this address (years)?">
          <div className="flex flex-wrap items-center gap-4">
            <input
              type="number"
              min={0}
              max={120}
              aria-label="Years at this address"
              value={d.sinceBirth ? ageYears ?? '' : d.yearsAtAddress ?? ''}
              disabled={d.sinceBirth === true}
              title={d.sinceBirth ? 'Worked out from your date of birth' : undefined}
              onChange={(e) => {
                const n = e.target.value === '' ? null : Math.max(0, Math.min(120, Math.floor(Number(e.target.value))));
                set({ yearsAtAddress: Number.isNaN(n) ? null : n });
              }}
              // Grey when worked out from the date of birth, like the other
              // values this step fills in itself.
              className={`${inputClass} !w-28 disabled:!bg-background-200 disabled:!border-foreground-200 disabled:!text-foreground-600 disabled:cursor-default`}
            />
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-foreground-700">
              <input
                type="checkbox"
                checked={d.sinceBirth === true}
                // Ticking fills the years with the learner's age; unticking
                // clears it for them to type how long they have lived there.
                onChange={(e) => set({ sinceBirth: e.target.checked, yearsAtAddress: e.target.checked ? ageYears : null })}
                className="accent-primary-500"
              />
              Since birth
            </label>
          </div>
        </FieldRow>

        <LabeledInput label="Telephone number" value={record?.telephone ?? ''} onChange={noop} readOnly />
        <LabeledInput
          label="Postcode prior to enrolment"
          missingKey="Postcode prior to enrolment"
          required
          value={d.postcodePriorToEnrolment}
          onChange={(v) => set({ postcodePriorToEnrolment: v.toUpperCase() })}
          placeholder="CT1 1AA"
        />
        <FieldRow label="National Insurance number">
          <input
            value={d.niNumber}
            onChange={(e) => set({ niNumber: e.target.value.toUpperCase(), niApplied: e.target.value.trim() ? null : d.niApplied })}
            placeholder="AB 12 34 56 C"
            aria-invalid={niError ? true : undefined}
            className={`${inputClass}${niError ? invalidClass : ''}`}
          />
          {niError && <FieldError message={niError} />}
        </FieldRow>
        {!d.niNumber.trim() && (
          <>
            <p className="py-2 text-[12px] leading-relaxed text-foreground-600">
              If you do not have a National Insurance Number, you need to apply for one by phoning:
              Telephone: 0800 141 2075 | Textphone: 0800 141 2438
            </p>
            <FieldRow label="Please confirm that you have done so by ticking the box to the right." required>
              <input
                type="checkbox"
                aria-label="I have applied for a National Insurance number"
                aria-invalid={missing(NI_OR_APPLIED_KEY) ? true : undefined}
                checked={d.niApplied === true}
                onChange={(e) => set({ niApplied: e.target.checked })}
                className="accent-primary-500"
              />
            </FieldRow>
          </>
        )}
        <LabeledInput label="Email address" value={record?.email ?? ''} onChange={noop} readOnly />

        <FieldRow label="Legal Sex" required>
          <div role="radiogroup" aria-label="Legal Sex" className={`inline-flex items-center gap-5${legalSexMissing ? ' rounded-lg border border-red-500 px-2.5 py-1' : ''}`}>
            {LEGAL_SEX_OPTIONS.map((option) => (
              <label key={option} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-foreground-700">
                <input
                  type="radio"
                  name="ilr-legal-sex"
                  checked={d.legalSex === option}
                  onChange={() => set({ legalSex: option })}
                  aria-invalid={legalSexMissing || undefined}
                  className="accent-primary-500"
                />
                {option}
              </label>
            ))}
          </div>
          {legalSexMissing && <div><FieldError message="Please select your legal sex." /></div>}
        </FieldRow>
        <LabeledInput label="What pronouns do you use?" value={d.pronouns} onChange={(v) => set({ pronouns: v })} />
        <LabeledSelect label="Ethnicity" missingKey="Ethnicity" required value={d.ethnicity} options={labels(ETHNICITY_OPTIONS)} onChange={(v) => set({ ethnicity: v })} />
      </Section>

      <Section title="Health">
        <RequiredYesNo
          legend="Do you consider yourself to have a long-term disability, health problem or any learning difficulties?"
          name="ilr-disability"
          missingKey="Long-term disability, health problem or learning difficulty"
          value={d.longTermDisability}
          onChange={(v) => set({ longTermDisability: v })}
        />
      </Section>

      <Section title="Education level">
        <LabeledSelect
          label="Please select from the drop-down list the highest-level qualification you have achieved to date."
          missingKey="Highest qualification achieved"
          required
          value={d.highestQualification}
          options={labels(PRIOR_ATTAINMENT_OPTIONS)}
          onChange={(v) => set({ highestQualification: v })}
        />
      </Section>

      <Section title="Employment Status">
        <LabeledSelect label="Status" missingKey="Employment status" required value={d.employmentStatus} options={labels(EMPLOYMENT_STATUS_OPTIONS)} onChange={changeEmploymentStatus} />
        {inPaidEmployment && (
          <>
            <LabeledInput
              label="Start date with Employer"
              missingKey="Start date with employer"
              type="date"
              required
              value={d.employmentStartDate ?? ''}
              onChange={(v) => set({ employmentStartDate: v })}
            />
            <LabeledInput label="Job title" value={d.jobTitle ?? ''} onChange={(v) => set({ jobTitle: v })} />
            <YesNoRadio legend="Are you self employed?" name="ilr-self-employed" value={d.selfEmployed ?? null} onChange={(v) => set({ selfEmployed: v })} />
          </>
        )}
        <RequiredYesNo
          legend="Are you currently in full-time education or training?"
          name="ilr-fulltime"
          missingKey="Full-time education or training"
          value={d.fullTimeEducation}
          onChange={(v) => set({ fullTimeEducation: v, expectedLeavingDate: v ? d.expectedLeavingDate : '' })}
        />
        {d.fullTimeEducation === true && (
          <LabeledInput
            label="Please provide expected leaving date"
            type="date"
            value={d.expectedLeavingDate ?? ''}
            onChange={(v) => set({ expectedLeavingDate: v })}
          />
        )}
        {notInPaidEmployment && (
          <>
            <LabeledSelect
              label="Length of unemployment"
              value={d.lengthOfUnemployment ?? ''}
              options={labels(LENGTH_OF_UNEMPLOYMENT_OPTIONS)}
              onChange={(v) => set({ lengthOfUnemployment: v })}
            />
            <YesNoRadio legend="Do you volunteer?" name="ilr-volunteer" value={d.volunteers ?? null} onChange={(v) => set({ volunteers: v })} />
          </>
        )}
        <FieldRow label="If you are in receipt of any additional state benefits please select the correct option from the drop down menu">
          <select
            value={d.stateBenefits}
            onChange={(e) => set({ stateBenefits: e.target.value, benefitClaimBasis: e.target.value === NO_BENEFITS ? '' : d.benefitClaimBasis })}
            className={`${inputClass} cursor-pointer`}
          >
            {STATE_BENEFIT_OPTIONS.map((o) => <option key={o.label} value={o.label}>{o.label}</option>)}
          </select>
        </FieldRow>
        {claimsBenefit && (
          <LabeledSelect
            label="Please confirm this is in your own right or as part of a joint claim (not as a dependant)"
            value={d.benefitClaimBasis ?? ''}
            options={BENEFIT_CLAIM_BASIS_OPTIONS}
            onChange={(v) => set({ benefitClaimBasis: v })}
            placeholder=""
          />
        )}
      </Section>

      <Section title="Declaration">
        <div className="max-h-80 space-y-3 overflow-y-auto rounded-lg border border-foreground-100 bg-background-50 p-4 text-[12px] leading-relaxed text-foreground-700">
          <p className="font-semibold text-foreground-900">
            Training providers should ensure that all learners have seen this privacy notice as part of their enrolment process.
          </p>
          <p>
            This privacy notice is issued on behalf of the Secretary of State for the Department of Education (DfE) to inform
            learners about the Individualised Learner Record (ILR) and how their personal information is used in the ILR. Your
            personal information is used by the DfE to exercise our functions under article 6(1)(e) of the UK GDPR and to meet
            our statutory responsibilities, including under the Apprenticeships, Skills, Children and Learning Act 2009. Our
            lawful basis for using your special category personal data is covered under Substantial Public Interest based in law
            (Article 9(2)(g)) of UK GDPR legislation. This processing is under Section 54 of the Further and Higher Education Act
            (1992).
          </p>
          <p>
            The ILR collects data about learners and learning undertaken. Publicly funded colleges, training organisations, local
            authorities, and employers (FE providers) must collect and return the data each year under the terms of a funding
            agreement, contract or grant agreement. It helps ensure that public money is being spent in line with government
            targets. It is also used for education, training, employment, and well-being purposes, including research.
          </p>
          <p>
            We retain your ILR learner data for 20 years for operational purposes (e.g. to fund your learning and to publish
            official statistics). Your personal data is then retained in our research databases until you are aged 80 years so
            that it can be used for long-term research purposes. For more information about the ILR and the data collected,
            please see the ILR specification at{' '}
            <a className="text-primary-600 underline" href="https://www.gov.uk/government/collections/individualised-learner-record-ilr" target="_blank" rel="noreferrer">
              https://www.gov.uk/government/collections/individualised-learner-record-ilr
            </a>
          </p>
          <p>
            ILR data is shared with third parties where it complies with DfE data sharing procedures and where the law allows
            it. The DfE and the English European Social Fund (ESF) Managing Authority (or agents acting on their behalf) may
            contact learners to carry out research and evaluation to inform the effectiveness of training.
          </p>
          <p>
            For more information about how your personal data is used and your individual rights, please see the DfE Personal
            Information Charter{' '}
            <a className="text-primary-600 underline" href="https://www.gov.uk/government/organisations/department-for-education/about/personal-information-charter" target="_blank" rel="noreferrer">
              (https://www.gov.uk/government/organisations/department-for-education/about/personal-information-charter)
            </a>{' '}
            and the DfE Privacy Notice{' '}
            <a className="text-primary-600 underline" href="https://www.gov.uk/government/publications/privacy-notice-for-key-stage-5-and-adult-education" target="_blank" rel="noreferrer">
              (https://www.gov.uk/government/publications/privacy-notice-for-key-stage-5-and-adult-education)
            </a>
          </p>
          <div>
            <p>If you would like to get in touch with us or request a copy of the personal information DfE holds about you, you can contact the DfE in the following ways:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                Using our online contact form{' '}
                <a className="text-primary-600 underline" href="https://form.education.gov.uk/service/Contact_the_Department_for_Education" target="_blank" rel="noreferrer">
                  https://form.education.gov.uk/service/Contact_the_Department_for_Education
                </a>
              </li>
              <li>By telephoning the DfE Helpline on 0370 000 2288</li>
              <li>Or in writing to: Data Protection Officer, Department for Education, 4th floor, 2 St Paul’s Place, 125 Norfolk Street, Sheffield, S1 2FJ</li>
            </ul>
          </div>
          <p>
            If you are unhappy with how we have used your personal data, you can complain to the Information Commissioner’s
            Office (ICO) at: Wycliffe House, Water Lane, Wilmslow, Cheshire, SK9 5AF. You can also call their helpline on
            0303 123 1113 or visit{' '}
            <a className="text-primary-600 underline" href="https://www.ico.org.uk" target="_blank" rel="noreferrer">https://www.ico.org.uk</a>
          </p>
          <p>Date last updated: January 2026</p>
        </div>

        <div className="mt-4 rounded-lg border border-foreground-100 p-4 text-[12px] leading-relaxed text-foreground-700">
          <p className="mb-1 font-semibold text-foreground-900">How we use your personal information</p>
          <p>
            The information I have given on this form is correct. I agree that my admission as a student to Kent Business
            College is subject to regulations. I agree to provide any additional information which may be required and to inform
            the training provider of any alteration to the information provided. I agree to Kent Business College storing,
            processing and sharing (with external parties associated with the learning programme detailed in this agreement)
            personal data contained in this form, or other data including electronic photographic images, which the training
            provider may obtain from me or other people, whilst I am a student. I agree to being contacted by SMS/Email and to the
            processing of data for any purposes connected with my studies or my health and safety whilst on the premises or for
            any other legitimate reason. I agree to conduct myself at all times in a manner which upholds the good reputation of
            the training provider and which does not obstruct the administration and work of the training provider, of the
            learning or enjoyment of its students and to abide at all times by all Kent Business College values, rules,
            regulations, policies and procedures.
          </p>
        </div>

        <p className="mt-4 text-[13px] font-medium text-foreground-800">
          I certify that the information contained on this form is correct <span className="text-red-500">*</span>
        </p>
        <SignatureField
          label="Learner signature"
          signatoryName={signatoryName}
          // The learner's saved signature — from Personal details, or the one
          // they gave at first sign-in. Applied only when they click to sign.
          savedValue={draft.personalDetails.signature || board.contact.savedSignature}
          missingBeforeSign={missingBeforeSign}
          missingKey={ILR_SIGNATURE_LABEL}
          value={d.signature ?? undefined}
          onChange={(v) => set({
            signature: v || null,
            signatureDate: v && !d.signatureDate ? new Date().toISOString().slice(0, 10) : v ? d.signatureDate : '',
          })}
        />
      </Section>
    </div>
  );
}
