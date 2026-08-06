import { useCallback, useEffect, useState } from 'react';
import { WorkspaceShell } from '@/components/feature/WorkspaceShell';
import { roleNavMap } from '@/mocks/navigation';
import { useMyLearner } from '@/hooks/useMyLearner';
import { useToast } from '@/hooks/useToast';
import {
  fetchAgreement,
  signAgreement,
  fmtAgreementDate,
  type AgreementResponse,
} from '@/api/apprenticeshipAgreement';
import {
  buildApprenticeshipAgreementPdf,
  renderAgreementPdf,
  agreementFilename,
} from '@/lib/apprenticeshipAgreementPdf';
import {
  fetchIlrDocument,
  signIlrDocument,
  type IlrResponse,
} from '@/api/ilrDocument';
import { buildIlrPdf, renderIlrPdf, ilrFilename } from '@/lib/ilrDocumentPdf';
import { DocumentCard, Field } from './DocumentCard';

// ============================================================================
// Compliance documents — the learner's statutory paperwork.
//
// Two documents today, each with its own table, signatories and lifecycle:
//   * Apprenticeship Agreement — signed by the learner and their EMPLOYER.
//   * Individual Learner Record — signed by the learner and the PROVIDER. The
//     employer has no part in an ILR and never sees it.
//
// Both are issued by the provider, and both render their PDF on demand from the
// record so the file always carries the signatures actually on file.
// ============================================================================

const learnerNav = roleNavMap.learner;

export default function LearnerCompliancePage() {
  const { id } = useMyLearner();
  const toast = useToast();

  const [agreementData, setAgreementData] = useState<AgreementResponse | null>(null);
  const [ilrData, setIlrData] = useState<IlrResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [agreement, ilr] = await Promise.all([fetchAgreement(id), fetchIlrDocument(id)]);
      setAgreementData(agreement);
      setIlrData(ilr);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your compliance documents.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Apprenticeship Agreement ----
  const agreement = agreementData?.agreement ?? null;
  const agreementName = agreementData?.particulars.apprenticeName || '';
  const agreementPdf = () => {
    if (!agreementData) return null;
    return agreement
      ? renderAgreementPdf(agreement)
      : buildApprenticeshipAgreementPdf(agreementData.particulars);
  };
  const agreementShown = agreement ? agreement.particulars : agreementData?.particulars;

  // ---- Individual Learner Record ----
  const ilr = ilrData?.document ?? null;
  const ilrPdf = () => {
    if (!ilrData) return null;
    return ilr ? renderIlrPdf(ilr) : buildIlrPdf(ilrData.learnerDetails, ilrData.answers);
  };
  const ilrShown = ilr ? ilr.learnerDetails : ilrData?.learnerDetails;

  const openPdf = (doc: ReturnType<typeof agreementPdf>) => {
    if (doc) window.open(doc.output('bloburl'), '_blank', 'noopener');
  };

  const sign = async (
    kind: 'agreement' | 'ilr',
    mark: string,
    name: string,
    otherParty: string,
  ) => {
    if (!mark) {
      toast.error('Signature required', 'Enter your name to sign.');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'agreement') await signAgreement(id, 'apprentice', name, mark);
      else await signIlrDocument(id, 'learner', name, mark);
      toast.success('Signed', `Your ${otherParty} still needs to sign this document.`);
      await load();
    } catch (err) {
      toast.error('Could not sign', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkspaceShell
      role="learner"
      roleLabel={learnerNav.label}
      navItems={learnerNav.items}
      workspaceLabel={learnerNav.workspaceLabel}
      pageTitle="Compliance documents"
      pageSubtitle="Your statutory apprenticeship paperwork"
    >
      <div className="p-6 space-y-6">
        {loading ? (
          <p className="py-16 text-center text-[13px] text-foreground-400">Loading your documents…</p>
        ) : error ? (
          <div className="rounded-xl border border-foreground-200/60 bg-background-50 p-6 text-center">
            <p className="text-[13px] text-red-600">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-3 rounded-lg border border-foreground-200 px-3 py-1.5 text-[12px] font-medium text-foreground-600 hover:border-primary-300 hover:bg-primary-50/60 hover:text-primary-700 cursor-pointer"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <DocumentCard
              title="Apprenticeship Agreement"
              blurb="The agreement between you and your employer. It sets out your apprenticeship standard, the dates it runs, and your planned off-the-job training hours."
              signedBy="You and your employer"
              issued={Boolean(agreement)}
              fullySigned={Boolean(agreement?.fullySigned)}
              learner={agreement?.signatures.apprentice}
              other={agreement?.signatures.employer}
              otherLabel="Employer"
              savedSignature={agreementData?.savedLearnerSignature?.signature}
              savedSignatureDate={agreementData?.savedLearnerSignature?.date}
              signatoryName={agreementName}
              busy={busy}
              fmtDate={fmtAgreementDate}
              onPreview={() => openPdf(agreementPdf())}
              onDownload={() => agreementPdf()?.save(agreementFilename(agreementName))}
              onSign={(mark) => void sign('agreement', mark, agreementName, 'employer')}
              fields={
                agreementShown && (
                  <>
                    <Field label="Apprentice" value={agreementShown.apprenticeName} />
                    <Field label="Employer" value={agreementShown.employerName} />
                    <Field label="Apprenticeship standard" value={agreementShown.standard} />
                    <Field label="Start date" value={fmtAgreementDate(agreementShown.startDate)} />
                    <Field label="End date" value={fmtAgreementDate(agreementShown.endDate)} />
                    <Field
                      label="Duration of practical period"
                      value={agreementShown.durationWeeks != null ? `${agreementShown.durationWeeks} weeks` : ''}
                    />
                    <Field
                      label="Planned off-the-job training"
                      value={agreementShown.plannedOtjHours != null ? `${agreementShown.plannedOtjHours} hours` : ''}
                      hint={
                        agreementData?.meta.moduleCount
                          ? `from ${agreementData.meta.moduleCount} module${agreementData.meta.moduleCount === 1 ? '' : 's'} on your learning plan`
                          : undefined
                      }
                    />
                  </>
                )
              }
            />

            <DocumentCard
              title="Individual Learner Record"
              blurb="Your enrolment record: your details, eligibility and the information you gave during onboarding. Your training provider confirms they have seen your identity and eligibility evidence."
              signedBy="You and your training provider"
              issued={Boolean(ilr)}
              fullySigned={Boolean(ilr?.fullySigned)}
              learner={ilr?.signatures.learner}
              other={ilr?.signatures.provider}
              otherLabel="Provider"
              savedSignature={ilrData?.savedLearnerSignature?.signature}
              savedSignatureDate={ilrData?.savedLearnerSignature?.date}
              signatoryName={ilrData?.learner.name}
              busy={busy}
              fmtDate={fmtAgreementDate}
              onPreview={() => openPdf(ilrPdf())}
              onDownload={() => ilrPdf()?.save(ilrFilename(ilrData?.learner.name || ''))}
              onSign={(mark) => void sign('ilr', mark, ilrData?.learner.name || '', 'training provider')}
              fields={
                ilrShown && (
                  <>
                    <Field
                      label="Name"
                      value={[ilrShown.givenNames, ilrShown.familyName].filter(Boolean).join(' ')}
                    />
                    <Field label="Date of birth" value={fmtAgreementDate(ilrShown.dateOfBirth)} />
                    <Field label="ULN" value={ilrShown.uln ?? ''} />
                    <Field label="National insurance number" value={ilrShown.nationalInsuranceNumber ?? ''} />
                    <Field label="Sex" value={ilrShown.sex ?? ''} />
                    <Field label="Telephone" value={ilrShown.telephone ?? ''} />
                  </>
                )
              }
            />
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
